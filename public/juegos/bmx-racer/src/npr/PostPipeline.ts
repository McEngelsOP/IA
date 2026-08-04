/**
 * PostPipeline — everything that happens to the frame after geometry.
 *
 * The order below is the whole design:
 *
 *   1. SHADOWS      two texel-snapped sun cascades              ShadowCascades.ts
 *   2. G-BUFFER     MRT normal/depth + id/curvature/mask        passes/GBufferPass.ts
 *   3. MAIN         sky, hulls, opaques, transparents -> HDR    here
 *   4. LINES        Sobel interior line field -> ink buffer     passes/LinesPass.ts
 *   5. BLOOM        hard-threshold mip chain, half res down     passes/BloomPass.ts
 *   6. COMPOSITE    bloom, ink, speed lines, flash, grade       passes/CompositePass.ts
 *
 * Steps 1-3 are geometry passes and are the expensive half. They are kept to
 * four scene walks total (two cascades, one prepass, one main) by putting every
 * mesh on a render layer once and swapping materials from a cached list rather
 * than traversing and toggling visibility per pass — see passes/RenderLists.ts.
 *
 * Steps 4-6 are screen-space and the only full-resolution work in them is the
 * line field and the final composite. Bloom never touches a full-resolution
 * buffer except through one 13-tap downsample.
 *
 * WHAT THIS FILE DOES NOT DO, deliberately: it does not touch the camera, the
 * scene contents, or any material's authored parameters. It swaps `mesh.material`
 * for the duration of a pass and restores it in a `finally`, and it writes the
 * shadow uniforms into NprGlobals. Nothing else in the scene graph is mutated.
 */

import {
  Color,
  DepthFormat,
  DepthTexture,
  HalfFloatType,
  LinearFilter,
  NearestFilter,
  PerspectiveCamera,
  RGBAFormat,
  Scene,
  Texture,
  UnsignedIntType,
  WebGLRenderer,
  WebGLRenderTarget,
} from 'three';

import type { IPostPipeline } from '../game/Contracts';
import { NPR, POST_STATE } from './NprGlobals';
import { INK } from './Palette';
import { ShadowCascades, ShadowCascadeOptions } from './ShadowCascades';
import { SceneRegistry } from './passes/RenderLists';
import { GBufferPass } from './passes/GBufferPass';
import { LinesPass, LINE_DEBUG } from './passes/LinesPass';
import { BloomPass } from './passes/BloomPass';
import { CompositePass, COMPOSITE_DEBUG } from './passes/CompositePass';
import { disposeFullscreenGeometry } from './passes/Fullscreen';

export interface PostPipelineOptions {
  width: number;
  height: number;
  shadows?: ShadowCascadeOptions | false;
  /** Bloom mip levels below half resolution. */
  bloomLevels?: number;
  /** Interior line resolution scale. 1 = full. Below 1 softens the stroke. */
  lineScale?: number;
  /** Render target to composite into. null = the canvas. */
  outputTarget?: WebGLRenderTarget | null;
  /** Insert gl.finish() between passes and record per-pass CPU-visible time. */
  profile?: boolean;
}

export type PostDebugView =
  | 'off'
  | 'lines'
  | 'lines-normal'
  | 'lines-depth'
  | 'lines-id'
  | 'lines-hull'
  | 'curvature'
  | 'ink'
  | 'bloom'
  | 'ungraded';

const _clearSave = new Color();

export class PostPipeline implements IPostPipeline {
  readonly renderer: WebGLRenderer;
  readonly shadows: ShadowCascades | null;
  readonly gbuffer: GBufferPass;
  readonly lines: LinesPass;
  readonly bloom: BloomPass;
  readonly composite: CompositePass;
  readonly registry = new SceneRegistry();

  /** HDR scene target. Exposed so FX can read it if it ever needs to. */
  readonly hdr: WebGLRenderTarget;

  /** Where the composite lands. null = the canvas. */
  outputTarget: WebGLRenderTarget | null;

  /** Clear colour behind the sky. Only visible if the dome fails to draw. */
  readonly clearColor = new Color().copy(INK);

  profile: boolean;

  readonly stats = {
    shadowMs: 0,
    prepassMs: 0,
    mainMs: 0,
    linesMs: 0,
    bloomMs: 0,
    compositeMs: 0,
    totalMs: 0,
    casters: 0,
    prepassMeshes: 0,
  };

  private width: number;
  private height: number;
  private gl: WebGLRenderingContext | WebGL2RenderingContext;

  constructor(renderer: WebGLRenderer, options: PostPipelineOptions) {
    this.renderer = renderer;
    this.gl = renderer.getContext();
    this.width = Math.max(1, Math.floor(options.width));
    this.height = Math.max(1, Math.floor(options.height));
    this.outputTarget = options.outputTarget ?? null;
    this.profile = options.profile ?? false;

    this.shadows = options.shadows === false ? null : new ShadowCascades(options.shadows ?? {});
    this.shadows?.resize(this.width, this.height);

    this.gbuffer = new GBufferPass(this.width, this.height);

    // A DEPTH TEXTURE, not a renderbuffer. The line pass reads it to detect
    // where the inverted hull laid ink: hulls write depth here and are absent
    // from the G-buffer, so "main depth much nearer than G-buffer depth" is an
    // exact, tuning-free hull mask. See the header of LinesPass.ts.
    const depth = new DepthTexture(this.width, this.height, UnsignedIntType);
    depth.format = DepthFormat;
    depth.minFilter = NearestFilter;
    depth.magFilter = NearestFilter;
    depth.name = 'sceneDepth';

    this.hdr = new WebGLRenderTarget(this.width, this.height, {
      format: RGBAFormat,
      type: HalfFloatType,
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      depthBuffer: true,
      stencilBuffer: false,
      depthTexture: depth,
      generateMipmaps: false,
    });
    this.hdr.texture.name = 'hdrScene';

    this.lines = new LinesPass(this.width, this.height, { scale: options.lineScale ?? 1 });
    this.bloom = new BloomPass(this.width, this.height, { levels: options.bloomLevels ?? 4 });
    this.composite = new CompositePass(this.width, this.height);
  }

  /** The scene depth texture, in case FX ever wants soft particles. */
  get sceneDepth(): Texture | null {
    return this.hdr.depthTexture;
  }

  /** Force the shadow/prepass mesh lists to rebuild on the next frame. */
  invalidate(): void {
    this.registry.invalidate();
  }

  setDebugView(view: PostDebugView): void {
    this.lines.setDebug(
      view === 'lines' ? LINE_DEBUG.field
        : view === 'lines-normal' ? LINE_DEBUG.normal
        : view === 'lines-depth' ? LINE_DEBUG.depth
        : view === 'lines-id' ? LINE_DEBUG.id
        : view === 'lines-hull' ? LINE_DEBUG.hull
        : view === 'curvature' ? LINE_DEBUG.curvature
        : LINE_DEBUG.off,
    );
    this.composite.setDebug(
      view === 'ink' ? COMPOSITE_DEBUG.ink
        : view === 'bloom' ? COMPOSITE_DEBUG.bloom
        : view === 'ungraded' ? COMPOSITE_DEBUG.ungraded
        : view.startsWith('lines') || view === 'curvature' ? COMPOSITE_DEBUG.ink
        : COMPOSITE_DEBUG.off,
    );
  }

  render(scene: Scene, camera: PerspectiveCamera, _dt: number, time: number): void {
    const r = this.renderer;
    const t0 = this.profile ? performance.now() : 0;
    let t = t0;

    this.registry.maybeRefresh(scene);
    this.stats.casters = this.registry.casters.length;
    this.stats.prepassMeshes = this.registry.prepass.length;

    // ── 1. Sun cascades ─────────────────────────────────────────────────────
    this.shadows?.render(r, scene, camera, this.registry);
    if (this.profile) t = this.mark('shadowMs', t);

    // ── 2. G-buffer ─────────────────────────────────────────────────────────
    this.gbuffer.render(r, scene, camera, this.registry);
    if (this.profile) t = this.mark('prepassMs', t);

    // ── 3. Main pass ────────────────────────────────────────────────────────
    // One render call: the sky dome sorts first on renderOrder -1000, hulls
    // sort ahead of their meshes on renderOrder -1, opaques then transparents.
    // Nothing here needs to know about any of that.
    r.getClearColor(_clearSave);
    const prevAlpha = r.getClearAlpha();
    r.setRenderTarget(this.hdr);
    r.setClearColor(this.clearColor, 1);
    r.clear(true, true, false);
    r.render(scene, camera);
    r.setClearColor(_clearSave, prevAlpha);
    if (this.profile) t = this.mark('mainMs', t);

    // ── 4. Interior lines ───────────────────────────────────────────────────
    this.lines.render(
      r,
      camera,
      this.gbuffer.normalDepth,
      this.gbuffer.aux,
      this.hdr.depthTexture,
    );
    if (this.profile) t = this.mark('linesMs', t);

    // ── 5. Bloom ────────────────────────────────────────────────────────────
    this.bloom.render(r, this.hdr.texture, this.width, this.height);
    if (this.profile) t = this.mark('bloomMs', t);

    // ── 6. Composite ────────────────────────────────────────────────────────
    this.composite.syncState(time);
    this.composite.render(
      r,
      this.hdr.texture,
      this.bloom.texture,
      this.lines.target.texture,
      this.outputTarget,
    );
    if (this.profile) {
      t = this.mark('compositeMs', t);
      this.stats.totalMs = this.stats.totalMs * 0.9 + (t - t0) * 0.1;
    }

    // Leave the renderer pointing at the output so a HUD pass can draw straight
    // on top without having to know what the pipeline did.
    r.setRenderTarget(this.outputTarget);
  }

  private mark(key: keyof PostPipeline['stats'], since: number): number {
    // gl.finish() is a serialising hammer, which is exactly what you want when
    // ATTRIBUTING cost and exactly what you must not ship. Hence the flag.
    this.gl.finish();
    const now = performance.now();
    const s = this.stats as unknown as Record<string, number>;
    s[key as string] = s[key as string] * 0.9 + (now - since) * 0.1;
    return now;
  }

  resize(width: number, height: number): void {
    const w = Math.max(1, Math.floor(width));
    const h = Math.max(1, Math.floor(height));
    if (w === this.width && h === this.height) return;
    this.width = w;
    this.height = h;

    this.hdr.setSize(w, h);
    this.gbuffer.setSize(w, h);
    this.lines.setSize(w, h);
    this.bloom.setSize(w, h);
    this.composite.setSize(w, h);
    this.shadows?.resize(w, h);
    NPR.uResolution.value.set(w, h);
  }

  dispose(): void {
    this.shadows?.dispose();
    this.gbuffer.dispose();
    this.lines.dispose();
    this.bloom.dispose();
    this.composite.dispose();
    this.hdr.depthTexture?.dispose();
    this.hdr.dispose();
    disposeFullscreenGeometry();
  }
}

/**
 * Convenience for the game loop: decay the one-shot post dials.
 *
 * The flash and the ink flood are set to a value by whatever triggered them
 * (a landing, a crash) and must fall off on their own — otherwise every
 * subsystem that can trigger one also has to remember to clear it, and the
 * first one that forgets leaves the frame white. Call once per frame.
 */
export function decayPostState(dt: number): void {
  // Half-lives chosen so a hit reads for 2-3 frames at 60fps and is gone by 6.
  POST_STATE.impactFlash *= Math.pow(2, -dt / 0.045);
  POST_STATE.inkFlood *= Math.pow(2, -dt / 0.16);
  POST_STATE.chromaticAberration *= Math.pow(2, -dt / 0.09);
  if (POST_STATE.impactFlash < 0.002) POST_STATE.impactFlash = 0;
  if (POST_STATE.inkFlood < 0.002) POST_STATE.inkFlood = 0;
  if (POST_STATE.chromaticAberration < 0.002) POST_STATE.chromaticAberration = 0;
}
