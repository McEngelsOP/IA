/**
 * Engine — renderer ownership, the frame loop, and the adaptive resolution
 * governor that keeps the 60fps lock.
 *
 * The frame budget is the whole reason this file is opinionated:
 *
 *  • Physics runs on a FIXED 120Hz step with an accumulator, and rendering
 *    interpolates between the last two states. A variable-step bike simulation
 *    changes handling when the frame rate changes, which is unacceptable in a
 *    racing game; and a fixed step without interpolation judders.
 *
 *  • The accumulator is clamped. If the tab is backgrounded for four seconds we
 *    do NOT then run 480 physics steps in one frame — we drop the backlog. The
 *    spiral-of-death is the classic way a fixed-step loop turns one hitch into
 *    a permanent stutter.
 *
 *  • Pixel ratio is governed, not fixed. We measure a rolling GPU-side frame
 *    time and walk the render scale between bounds. The governor is slow to
 *    drop and much slower to climb back, with a dead band, so it never
 *    oscillates — a resolution that pumps once a second is more distracting
 *    than one that is simply slightly lower.
 */

import {
  Clock,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
  SRGBColorSpace,
  NoToneMapping,
  Vector2,
  LinearSRGBColorSpace,
} from 'three';
import { clamp } from './MathX';

export interface EngineOptions {
  container: HTMLElement;
  /** Upper bound on device pixel ratio. Retina caps at 2. */
  maxPixelRatio?: number;
  minPixelRatio?: number;
  /** Target frame time in ms. 16.67 = 60fps. */
  targetFrameMs?: number;
  /** Disable the governor (capture harness pins resolution). */
  fixedPixelRatio?: number | null;
  fov?: number;
  near?: number;
  far?: number;
}

export type FixedUpdateFn = (dt: number, tick: number) => void;
export type RenderFn = (dt: number, alpha: number, elapsed: number) => void;

/** Physics runs at this rate, always. */
export const FIXED_HZ = 120;
export const FIXED_DT = 1 / FIXED_HZ;
/** Never run more than this many physics steps in one frame. */
const MAX_STEPS_PER_FRAME = 6;

export class Engine {
  readonly renderer: WebGLRenderer;
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
  readonly clock = new Clock(false);
  readonly size = new Vector2(1, 1);
  /** Render-target size in device pixels, after the resolution governor. */
  readonly renderSize = new Vector2(1, 1);

  private container: HTMLElement;
  private opts: Required<Omit<EngineOptions, 'container' | 'fixedPixelRatio'>> & {
    fixedPixelRatio: number | null;
  };

  private accumulator = 0;
  private tick = 0;
  private elapsed = 0;
  private rafId = 0;
  private running = false;

  private fixedUpdate: FixedUpdateFn = () => {};
  private renderFn: RenderFn = () => {};
  private resizeListeners: ((w: number, h: number) => void)[] = [];

  // ── Resolution governor state ─────────────────────────────────────────────
  private pixelRatio: number;
  private frameTimes: number[] = [];
  private lastFrameStamp = 0;
  private governorCooldown = 0;

  // ── Live stats, surfaced to the HUD's debug overlay ───────────────────────
  readonly stats = {
    fps: 0,
    frameMs: 0,
    cpuMs: 0,
    drawCalls: 0,
    triangles: 0,
    programs: 0,
    pixelRatio: 1,
    physicsSteps: 0,
  };
  private fpsAccum = 0;
  private fpsCount = 0;

  constructor(options: EngineOptions) {
    this.container = options.container;
    this.opts = {
      maxPixelRatio: options.maxPixelRatio ?? 2,
      minPixelRatio: options.minPixelRatio ?? 0.75,
      targetFrameMs: options.targetFrameMs ?? 16.67,
      fixedPixelRatio: options.fixedPixelRatio ?? null,
      fov: options.fov ?? 62,
      near: options.near ?? 0.12,
      far: options.far ?? 6000,
    };

    this.pixelRatio = this.opts.fixedPixelRatio ?? Math.min(window.devicePixelRatio || 1, this.opts.maxPixelRatio);

    this.renderer = new WebGLRenderer({
      antialias: false, // we resolve edges ourselves; MSAA fights the Sobel pass
      alpha: false,
      stencil: false,
      depth: true,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: true, // the capture harness reads pixels back
      failIfMajorPerformanceCaveat: false,
    });

    // The main pass renders to a float target and the composite writes sRGB,
    // so the renderer itself stays in linear and does no tone mapping — the
    // generated LUT is the only grade in the pipeline.
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = NoToneMapping;
    this.renderer.autoClear = false;
    this.renderer.setClearColor(0x0d0a14, 1);
    this.renderer.debug.checkShaderErrors = import.meta.env.DEV;

    this.container.appendChild(this.renderer.domElement);
    this.renderer.domElement.tabIndex = 0;

    this.scene = new Scene();
    this.camera = new PerspectiveCamera(this.opts.fov, 1, this.opts.near, this.opts.far);
    this.camera.position.set(0, 5, 10);

    this.handleResize();
    window.addEventListener('resize', this.handleResize, { passive: true });

    // Losing the context mid-race would otherwise silently freeze the game.
    this.renderer.domElement.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      console.error('[engine] WebGL context lost');
      this.stop();
    });
  }

  onFixedUpdate(fn: FixedUpdateFn): void {
    this.fixedUpdate = fn;
  }

  onRender(fn: RenderFn): void {
    this.renderFn = fn;
  }

  onResize(fn: (w: number, h: number) => void): void {
    this.resizeListeners.push(fn);
    fn(this.renderSize.x, this.renderSize.y);
  }

  private handleResize = (): void => {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.size.set(w, h);
    this.applyPixelRatio();
  };

  private applyPixelRatio(): void {
    const pr = this.opts.fixedPixelRatio ?? this.pixelRatio;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(this.size.x, this.size.y, true);
    const rw = Math.max(1, Math.floor(this.size.x * pr));
    const rh = Math.max(1, Math.floor(this.size.y * pr));
    if (rw === this.renderSize.x && rh === this.renderSize.y) return;
    this.renderSize.set(rw, rh);
    this.camera.aspect = this.size.x / Math.max(1, this.size.y);
    this.camera.updateProjectionMatrix();
    this.stats.pixelRatio = pr;
    for (const fn of this.resizeListeners) fn(rw, rh);
  }

  /**
   * The governor. Runs on a rolling median of the last 40 frames — median
   * rather than mean so a single GC pause or a shader compile doesn't drag the
   * resolution down and take four seconds to recover.
   */
  private governResolution(frameMs: number): void {
    if (this.opts.fixedPixelRatio !== null) return;

    this.frameTimes.push(frameMs);
    if (this.frameTimes.length > 40) this.frameTimes.shift();
    if (this.frameTimes.length < 40) return;

    this.governorCooldown -= frameMs / 1000;
    if (this.governorCooldown > 0) return;

    const sorted = [...this.frameTimes].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const p90 = sorted[Math.floor(sorted.length * 0.9)];
    const target = this.opts.targetFrameMs;

    // Dead band: between 0.86 and 1.02 of target we do nothing at all.
    if (median > target * 1.02 || p90 > target * 1.35) {
      // Drop fast — a frame we can't afford is worth losing pixels over.
      const next = clamp(this.pixelRatio - 0.125, this.opts.minPixelRatio, this.opts.maxPixelRatio);
      if (next !== this.pixelRatio) {
        this.pixelRatio = next;
        this.applyPixelRatio();
        this.frameTimes.length = 0;
        this.governorCooldown = 0.4;
      }
    } else if (median < target * 0.86 && p90 < target * 0.95) {
      // Climb slowly, in smaller increments, with a long cooldown.
      const cap = Math.min(window.devicePixelRatio || 1, this.opts.maxPixelRatio);
      const next = clamp(this.pixelRatio + 0.0625, this.opts.minPixelRatio, cap);
      if (next !== this.pixelRatio) {
        this.pixelRatio = next;
        this.applyPixelRatio();
        this.frameTimes.length = 0;
        this.governorCooldown = 1.6;
      }
    }
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.clock.start();
    this.lastFrameStamp = performance.now();
    this.loop();
  }

  stop(): void {
    this.running = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
    this.clock.stop();
  }

  /**
   * Step the simulation and render exactly one frame, with an explicit dt.
   * Used by the capture harness so a recorded clip is perfectly deterministic
   * and independent of how fast the headless machine actually runs.
   */
  stepManual(dt: number): void {
    this.advance(dt);
  }

  private loop = (): void => {
    if (!this.running) return;
    this.rafId = requestAnimationFrame(this.loop);

    const now = performance.now();
    const frameMs = now - this.lastFrameStamp;
    this.lastFrameStamp = now;

    // Clamp the frame delta. A 4-second tab stall must not teleport the bike.
    const dt = Math.min(frameMs / 1000, 0.1);

    const cpuStart = now;
    this.advance(dt);
    this.stats.cpuMs = performance.now() - cpuStart;

    this.stats.frameMs = frameMs;
    this.fpsAccum += frameMs;
    this.fpsCount++;
    if (this.fpsAccum >= 500) {
      this.stats.fps = Math.round(1000 / (this.fpsAccum / this.fpsCount));
      this.fpsAccum = 0;
      this.fpsCount = 0;
    }

    const info = this.renderer.info;
    this.stats.drawCalls = info.render.calls;
    this.stats.triangles = info.render.triangles;
    this.stats.programs = info.programs?.length ?? 0;

    this.governResolution(frameMs);
  };

  private advance(dt: number): void {
    this.elapsed += dt;
    this.accumulator += dt;

    let steps = 0;
    while (this.accumulator >= FIXED_DT && steps < MAX_STEPS_PER_FRAME) {
      this.fixedUpdate(FIXED_DT, this.tick++);
      this.accumulator -= FIXED_DT;
      steps++;
    }
    // Drop any backlog beyond the cap rather than trying to catch up.
    if (steps === MAX_STEPS_PER_FRAME) this.accumulator = 0;
    this.stats.physicsSteps = steps;

    const alpha = this.accumulator / FIXED_DT;
    this.renderer.info.reset();
    this.renderFn(dt, alpha, this.elapsed);
  }

  get time(): number {
    return this.elapsed;
  }

  /** Force a specific render scale — the capture harness pins this to 2. */
  setFixedPixelRatio(pr: number | null): void {
    this.opts.fixedPixelRatio = pr;
    if (pr !== null) this.pixelRatio = pr;
    this.applyPixelRatio();
  }

  dispose(): void {
    this.stop();
    window.removeEventListener('resize', this.handleResize);
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
