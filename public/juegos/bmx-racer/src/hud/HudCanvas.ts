/**
 * HudCanvas — the drawing substrate.
 *
 * The HUD is a set of independent canvas-2D layers, each uploaded to its own
 * texture and drawn as one screen-space quad. There is no DOM anywhere in it
 * and no fullscreen canvas.
 *
 * WHY LAYERS AND NOT ONE CANVAS
 * A single 3840×2160 HUD canvas redrawn every frame is roughly 8 megapixels of
 * clear + 8 megapixels of texture upload per frame. That is a guaranteed
 * multi-millisecond spike at retina and it would eat the whole 60fps budget on
 * its own. Instead each element owns a small canvas sized to its own rectangle,
 * carries a dirty flag, and only the layers whose *content* changed are redrawn
 * and re-uploaded. In a normal racing frame that is the clock (0.10 Mpx), the
 * speed block (0.40 Mpx) and sometimes the route profile — about 0.7 Mpx total
 * instead of 8.
 *
 * WHY EACH LAYER HAS A BACKGROUND CANVAS
 * Most of what a panel draws is furniture: the skewed slab, the ink border, the
 * corner ticks, the static label. That geometry never changes between frames but
 * re-stroking it costs more than the dynamic content it frames. Each layer keeps
 * a second canvas holding only the furniture, rendered once (on resize or on a
 * genuine layout change), and every dynamic redraw starts with a single
 * `drawImage` blit of it. A blit of a same-size canvas is a straight GPU copy.
 *
 * COLOUR SPACE
 * The canvases are authored in sRGB — the same hex values as `HUD_PALETTE` — and
 * the textures are tagged as linear so three performs no conversion on sample.
 * The quads then write those bytes straight into the default framebuffer. The
 * HUD is composited on top of the finished, graded frame, so the numbers you
 * author here are literally the numbers that appear on screen. Marking the
 * texture sRGB would decode to linear on sample and, because a raw
 * ShaderMaterial does no output encode, would wash the whole HUD out.
 */

import {
  Color,
  DoubleSide,
  Group,
  LinearFilter,
  LinearSRGBColorSpace,
  Mesh,
  NormalBlending,
  PlaneGeometry,
  ShaderMaterial,
  Texture,
  GLSL3,
  Vector4,
} from 'three';

// ─────────────────────────────────────────────────────────────────────────────
// Colour helpers
// ─────────────────────────────────────────────────────────────────────────────

const cssCache = new Map<Color, string>();
const rgbCache = new Map<Color, [number, number, number]>();
const alphaCache = new Map<string, string>();

/**
 * The authored sRGB bytes of a palette Color.
 *
 * `Color` stores linear-sRGB (three's colour management converts on assignment),
 * so going back to canvas means running the real sRGB transfer function, not a
 * gamma-2.2 approximation — the two differ by several units in the dark end,
 * which is exactly where the ink colour lives.
 */
function bytes(c: Color): [number, number, number] {
  let v = rgbCache.get(c);
  if (!v) {
    const hex = c.getHexString('srgb');
    v = [
      parseInt(hex.slice(0, 2), 16),
      parseInt(hex.slice(2, 4), 16),
      parseInt(hex.slice(4, 6), 16),
    ];
    rgbCache.set(c, v);
  }
  return v;
}

/** The authored sRGB hex of a palette Color, as a CSS string. Cached. */
export function css(c: Color): string {
  let s = cssCache.get(c);
  if (s === undefined) {
    s = '#' + c.getHexString('srgb');
    cssCache.set(c, s);
  }
  return s;
}

/**
 * Palette colour with an alpha. Cached by (colour, quantised alpha) so the
 * common translucent panel fills never allocate a string during a redraw.
 */
export function cssA(c: Color, alpha: number): string {
  const v = bytes(c);
  const a = Math.round(Math.max(0, Math.min(1, alpha)) * 100);
  const key = `${v[0]},${v[1]},${v[2]},${a}`;
  let s = alphaCache.get(key);
  if (s === undefined) {
    s = `rgba(${v[0]},${v[1]},${v[2]},${(a / 100).toFixed(2)})`;
    alphaCache.set(key, s);
  }
  return s;
}

/** Mix two palette colours in sRGB and return a CSS string. */
export function cssMix(a: Color, b: Color, t: number): string {
  const x = bytes(a);
  const y = bytes(b);
  const k = Math.max(0, Math.min(1, t));
  const r = Math.round(x[0] + (y[0] - x[0]) * k);
  const g = Math.round(x[1] + (y[1] - x[1]) * k);
  const bl = Math.round(x[2] + (y[2] - x[2]) * k);
  return `rgb(${r},${g},${bl})`;
}

// ─────────────────────────────────────────────────────────────────────────────
// The screen-space quad shader
//
// The vertex program ignores the camera completely: it maps a unit plane
// straight into NDC through a rect uniform. That means the HUD is identical
// whether it is rendered with its own camera, no camera, or accidentally added
// to the main scene — there is no projection to get wrong.
// ─────────────────────────────────────────────────────────────────────────────

const QUAD_VS = /* glsl */ `
  precision highp float;
  uniform vec4 uRect;   // xy = NDC centre, zw = NDC half-size
  out vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(uRect.xy + position.xy * uRect.zw * 2.0, 0.0, 1.0);
  }
`;

const QUAD_FS = /* glsl */ `
  precision highp float;
  layout(location = 0) out vec4 fragColor;
  uniform sampler2D uMap;
  uniform float uAlpha;
  in vec2 vUv;
  void main() {
    vec4 t = texture(uMap, vUv);
    fragColor = vec4(t.rgb, t.a * uAlpha);
  }
`;

/** Solid-colour quad — the pause/results scrim. No canvas, no upload, ever. */
const SOLID_FS = /* glsl */ `
  precision highp float;
  layout(location = 0) out vec4 fragColor;
  uniform vec3 uColor;
  uniform float uAlpha;
  in vec2 vUv;
  void main() {
    fragColor = vec4(uColor, uAlpha);
  }
`;

let sharedQuad: PlaneGeometry | null = null;
function quadGeometry(): PlaneGeometry {
  if (!sharedQuad) sharedQuad = new PlaneGeometry(1, 1);
  return sharedQuad;
}

// ─────────────────────────────────────────────────────────────────────────────
// Layout
// ─────────────────────────────────────────────────────────────────────────────

export type Anchor =
  | 'top-left' | 'top' | 'top-right'
  | 'left' | 'center' | 'right'
  | 'bottom-left' | 'bottom' | 'bottom-right';

export interface LayerPlacement {
  anchor: Anchor;
  /** Offset from the anchor, design units. +x right, +y down, always inward. */
  dx: number;
  dy: number;
  /** Size in design units. */
  w: number;
  h: number;
}

/**
 * Design space is 1920×1080 *device* pixels. The scale factor is derived from
 * the render-target size, so the HUD covers the same fraction of the screen on
 * a 1080p window and on a 5K retina panel, and the layer canvases land on an
 * exact 1:1 pixel mapping with the framebuffer.
 */
export const DESIGN_W = 1920;
export const DESIGN_H = 1080;

export function uiScaleFor(width: number, height: number): number {
  return Math.max(0.40, Math.min(2.4, Math.min(width / DESIGN_W, height / DESIGN_H)));
}

// ─────────────────────────────────────────────────────────────────────────────
// Layer
// ─────────────────────────────────────────────────────────────────────────────

export class HudLayer {
  readonly name: string;
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  readonly texture: Texture;
  readonly mesh: Mesh;
  readonly material: ShaderMaterial;

  /** Design-space size. Drawing code works entirely in these units. */
  w: number;
  h: number;
  placement: LayerPlacement;

  /** Set to force a redraw on the next flush. */
  dirty = true;
  /** Set when the furniture needs rebuilding (resize, layout change). */
  furnitureDirty = true;
  /** 0 hides the layer entirely and skips the draw call. */
  alpha = 1;
  visible = true;

  /**
   * Enter/exit animation, applied to the QUAD rather than to the canvas.
   *
   * Sliding a panel on screen by redrawing its canvas at a moving offset would
   * dirty the layer every frame of the transition for no visual gain. Offsetting
   * and scaling the NDC rect instead is free: no clear, no redraw, no upload,
   * and it lets every element in the HUD have a real entrance without any of
   * them costing anything to animate.
   */
  slideX = 0;
  slideY = 0;
  scaleX = 1;
  scaleY = 1;

  /** Upper bound on the backing-store scale. Big layers cap this to save memory. */
  maxScale: number;

  private bg: HTMLCanvasElement | null = null;
  private bgCtx: CanvasRenderingContext2D | null = null;
  private allocScale = 0;
  private scale = 1;
  private rect = new Vector4(0, 0, 0.1, 0.1);
  private baseCx = 0;
  private baseCy = 0;
  private baseHw = 0.1;
  private baseHh = 0.1;
  private screenW = 1920;
  private screenH = 1080;
  private ui = 1;

  constructor(name: string, placement: LayerPlacement, opts?: { maxScale?: number; background?: boolean }) {
    this.name = name;
    this.placement = placement;
    this.w = placement.w;
    this.h = placement.h;
    this.maxScale = opts?.maxScale ?? 2.4;

    this.canvas = document.createElement('canvas');
    this.canvas.width = 4;
    this.canvas.height = 4;
    const ctx = this.canvas.getContext('2d', { alpha: true, desynchronized: false });
    if (!ctx) throw new Error('[hud] 2D context unavailable');
    this.ctx = ctx;

    if (opts?.background !== false) {
      this.bg = document.createElement('canvas');
      this.bg.width = 4;
      this.bg.height = 4;
      const b = this.bg.getContext('2d', { alpha: true });
      if (!b) throw new Error('[hud] 2D context unavailable');
      this.bgCtx = b;
    }

    this.texture = new Texture(this.canvas);
    this.texture.colorSpace = LinearSRGBColorSpace;
    this.texture.minFilter = LinearFilter;
    this.texture.magFilter = LinearFilter;
    this.texture.generateMipmaps = false;
    this.texture.premultiplyAlpha = false;
    this.texture.flipY = true;
    this.texture.needsUpdate = true;

    this.material = new ShaderMaterial({
      glslVersion: GLSL3,
      vertexShader: QUAD_VS,
      fragmentShader: QUAD_FS,
      uniforms: {
        uMap: { value: this.texture },
        uAlpha: { value: 1 },
        uRect: { value: this.rect },
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: NormalBlending,
      side: DoubleSide,
      toneMapped: false,
    });

    this.mesh = new Mesh(quadGeometry(), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 0;
    this.mesh.name = `hud:${name}`;
  }

  /** Design-space to canvas-pixel scale currently in force. */
  get pixelScale(): number {
    return this.scale;
  }

  /**
   * Recompute the NDC rect and, if the required resolution moved far enough,
   * reallocate the backing store. Reallocation is deliberately hysteretic: the
   * engine's resolution governor walks the pixel ratio in 0.125 steps and
   * reallocating eleven canvases on every step would cost more than the pixels
   * it saves.
   */
  layout(screenW: number, screenH: number, ui: number): boolean {
    const p = this.placement;
    this.screenW = screenW;
    this.screenH = screenH;
    this.ui = ui;
    const sw = this.w * ui;
    const sh = this.h * ui;

    let x = 0;
    let y = 0;
    const a = p.anchor;
    if (a === 'top-left' || a === 'left' || a === 'bottom-left') x = p.dx * ui;
    else if (a === 'top' || a === 'center' || a === 'bottom') x = screenW * 0.5 - sw * 0.5 + p.dx * ui;
    else x = screenW - sw - p.dx * ui;

    if (a === 'top-left' || a === 'top' || a === 'top-right') y = p.dy * ui;
    else if (a === 'left' || a === 'center' || a === 'right') y = screenH * 0.5 - sh * 0.5 + p.dy * ui;
    else y = screenH - sh - p.dy * ui;

    this.baseCx = ((x + sw * 0.5) / screenW) * 2 - 1;
    this.baseCy = 1 - ((y + sh * 0.5) / screenH) * 2;
    this.baseHw = sw / screenW;
    this.baseHh = sh / screenH;
    this.rect.set(this.baseCx, this.baseCy, this.baseHw, this.baseHh);

    const want = Math.min(ui, this.maxScale);
    const needAlloc = this.allocScale === 0 || Math.abs(want - this.allocScale) / this.allocScale > 0.18;
    if (needAlloc) {
      this.allocScale = want;
      this.scale = want;
      const cw = Math.max(2, Math.ceil(this.w * want));
      const ch = Math.max(2, Math.ceil(this.h * want));
      this.canvas.width = cw;
      this.canvas.height = ch;
      if (this.bg) {
        this.bg.width = cw;
        this.bg.height = ch;
      }
      this.furnitureDirty = true;
      this.dirty = true;
      return true;
    }
    return false;
  }

  /** Change the layer's design-space size (used when a panel's content grows). */
  setSize(w: number, h: number): void {
    if (w === this.w && h === this.h) return;
    this.w = w;
    this.h = h;
    this.placement.w = w;
    this.placement.h = h;
    this.allocScale = 0;
    this.furnitureDirty = true;
    this.dirty = true;
  }

  /**
   * Render the static furniture. The callback gets a context already scaled to
   * design units and cleared. Call `markFurniture()` to schedule it.
   */
  drawFurniture(fn: (ctx: CanvasRenderingContext2D, w: number, h: number) => void): void {
    if (!this.bgCtx || !this.bg) return;
    const c = this.bgCtx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, this.bg.width, this.bg.height);
    c.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    c.lineJoin = 'miter';
    c.lineCap = 'butt';
    c.miterLimit = 3;
    fn(c, this.w, this.h);
    this.furnitureDirty = false;
  }

  markFurniture(): void {
    this.furnitureDirty = true;
    this.dirty = true;
  }

  /** Clear the working canvas and blit the furniture back over it. */
  begin(): CanvasRenderingContext2D {
    const c = this.ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (this.bg) c.drawImage(this.bg, 0, 0);
    c.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    c.lineJoin = 'miter';
    c.lineCap = 'butt';
    c.miterLimit = 3;
    c.globalAlpha = 1;
    c.globalCompositeOperation = 'source-over';
    return c;
  }

  /** Mark the texture for upload. Called by the root after a redraw. */
  commit(): void {
    this.texture.needsUpdate = true;
    this.dirty = false;
  }

  applyAlpha(): void {
    (this.material.uniforms.uAlpha as { value: number }).value = this.alpha;
    this.rect.set(
      this.baseCx + (this.slideX * this.ui * 2) / this.screenW,
      this.baseCy - (this.slideY * this.ui * 2) / this.screenH,
      this.baseHw * this.scaleX,
      this.baseHh * this.scaleY,
    );
    this.mesh.visible = this.visible && this.alpha > 0.002;
  }

  dispose(): void {
    this.texture.dispose();
    this.material.dispose();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Solid quad (scrim)
// ─────────────────────────────────────────────────────────────────────────────

export class SolidQuad {
  readonly mesh: Mesh;
  readonly material: ShaderMaterial;
  private rect = new Vector4(0, 0, 1, 1);
  alpha = 0;

  constructor(color: Color) {
    this.material = new ShaderMaterial({
      glslVersion: GLSL3,
      vertexShader: QUAD_VS,
      fragmentShader: SOLID_FS,
      uniforms: {
        uColor: { value: color.clone() },
        uAlpha: { value: 0 },
        uRect: { value: this.rect },
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: NormalBlending,
      side: DoubleSide,
      toneMapped: false,
    });
    this.mesh = new Mesh(quadGeometry(), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.name = 'hud:scrim';
  }

  /** Full-screen, always. */
  layout(): void {
    this.rect.set(0, 0, 1, 1);
  }

  apply(): void {
    (this.material.uniforms.uAlpha as { value: number }).value = this.alpha;
    this.mesh.visible = this.alpha > 0.002;
  }

  dispose(): void {
    this.material.dispose();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Shape vocabulary
//
// Every panel in the HUD is built from these five primitives. They all share
// one rule: hard edges, flat fills, an ink outline of a fixed weight, and a
// consistent shear. That shear is the whole style decision — a centred rounded
// rectangle reads as an operating system, a skewed slab with cut corners reads
// as a race broadcast.
// ─────────────────────────────────────────────────────────────────────────────

/** The house shear. Applied to every panel edge and most text. */
export const SHEAR = 0.20;
/** Corner cut length, design units. */
export const CUT = 14;
/** Standard ink weight, design units. */
export const INK_W = 3.0;

/**
 * A skewed slab with two cut corners. `cuts` selects which corners are chamfered
 * as a 4-bit mask: 1 = top-left, 2 = top-right, 4 = bottom-right, 8 = bottom-left.
 * The top edge is displaced right by `shear * h` so the whole shape leans.
 */
export function slabPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  cuts = 0b0101,
  cut = CUT,
  shear = SHEAR,
): void {
  const s = shear * h;
  // Corners, clockwise from top-left, in the sheared frame.
  const tl = [x + s, y];
  const tr = [x + w + s, y];
  const br = [x + w, y + h];
  const bl = [x, y + h];

  ctx.beginPath();
  // top-left
  if (cuts & 1) {
    ctx.moveTo(tl[0] + cut, tl[1]);
  } else {
    ctx.moveTo(tl[0], tl[1]);
  }
  // top edge → top-right
  if (cuts & 2) {
    ctx.lineTo(tr[0] - cut, tr[1]);
    ctx.lineTo(tr[0] - cut * shear, tr[1] + cut);
  } else {
    ctx.lineTo(tr[0], tr[1]);
  }
  // right edge → bottom-right
  if (cuts & 4) {
    ctx.lineTo(br[0] + cut * shear, br[1] - cut);
    ctx.lineTo(br[0] - cut, br[1]);
  } else {
    ctx.lineTo(br[0], br[1]);
  }
  // bottom edge → bottom-left
  if (cuts & 8) {
    ctx.lineTo(bl[0] + cut, bl[1]);
    ctx.lineTo(bl[0] + cut * shear, bl[1] - cut);
  } else {
    ctx.lineTo(bl[0], bl[1]);
  }
  // left edge → close
  if (cuts & 1) {
    ctx.lineTo(tl[0] - cut * shear, tl[1] + cut);
  } else {
    ctx.lineTo(tl[0], tl[1]);
  }
  ctx.closePath();
}

export interface SlabStyle {
  fill?: string | null;
  ink?: string | null;
  inkWidth?: number;
  cuts?: number;
  cut?: number;
  shear?: number;
  /** A flat accent stripe along the bottom edge, design units tall. */
  accent?: string | null;
  accentHeight?: number;
}

export function slab(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  st: SlabStyle,
): void {
  const shear = st.shear ?? SHEAR;
  slabPath(ctx, x, y, w, h, st.cuts ?? 0b0101, st.cut ?? CUT, shear);
  if (st.fill) {
    ctx.fillStyle = st.fill;
    ctx.fill();
  }
  if (st.accent) {
    ctx.save();
    ctx.clip();
    const ah = st.accentHeight ?? 7;
    ctx.fillStyle = st.accent;
    ctx.fillRect(x - 20, y + h - ah, w + 60, ah);
    ctx.restore();
    // Re-establish the path — clip() consumed it.
    slabPath(ctx, x, y, w, h, st.cuts ?? 0b0101, st.cut ?? CUT, shear);
  }
  if (st.ink) {
    ctx.strokeStyle = st.ink;
    ctx.lineWidth = st.inkWidth ?? INK_W;
    ctx.stroke();
  }
}

/** A sheared parallelogram — the boost segment and the standings tag. */
export function bar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  fill: string | null,
  ink: string | null,
  inkWidth = INK_W,
  shear = SHEAR,
): void {
  const s = shear * h;
  ctx.beginPath();
  ctx.moveTo(x + s, y);
  ctx.lineTo(x + w + s, y);
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x, y + h);
  ctx.closePath();
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (ink) {
    ctx.strokeStyle = ink;
    ctx.lineWidth = inkWidth;
    ctx.stroke();
  }
}

/**
 * A chevron — the single most reused mark in the HUD. Used for the route-profile
 * player marker, the corner preview, the menu selection cursor and the gap tags.
 * `dir` is the direction it points in radians (0 = +x).
 */
export function chevron(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  thickness: number,
  dir: number,
  fill: string | null,
  ink: string | null,
  inkWidth = INK_W,
): void {
  const c = Math.cos(dir);
  const s = Math.sin(dir);
  // Local shape: an arrowhead of half-angle ~48°, with a notched tail so it
  // reads as a stroke rather than as a solid triangle.
  const pts = [
    [size, 0],
    [-size * 0.35, size * 0.92],
    [-size * 0.35 + thickness * 1.5, size * 0.92],
    [size - thickness * 1.7, 0],
    [-size * 0.35 + thickness * 1.5, -size * 0.92],
    [-size * 0.35, -size * 0.92],
  ];
  ctx.beginPath();
  for (let i = 0; i < pts.length; i++) {
    const px = cx + pts[i][0] * c - pts[i][1] * s;
    const py = cy + pts[i][0] * s + pts[i][1] * c;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (ink) {
    ctx.strokeStyle = ink;
    ctx.lineWidth = inkWidth;
    ctx.stroke();
  }
}

/** A solid triangle marker — AI positions on the route profile. */
export function tri(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  dir: number,
  fill: string,
  ink: string | null,
  inkWidth = 2.2,
): void {
  const c = Math.cos(dir);
  const s = Math.sin(dir);
  const pts = [
    [size, 0],
    [-size * 0.7, size * 0.78],
    [-size * 0.7, -size * 0.78],
  ];
  ctx.beginPath();
  for (let i = 0; i < 3; i++) {
    const px = cx + pts[i][0] * c - pts[i][1] * s;
    const py = cy + pts[i][0] * s + pts[i][1] * c;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  if (ink) {
    ctx.strokeStyle = ink;
    ctx.lineWidth = inkWidth;
    ctx.stroke();
  }
}

/** A hard-edged tick, used along the speed arc and the route profile. */
export function tick(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  width: number,
  color: string,
): void {
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.lineWidth = width;
  ctx.strokeStyle = color;
  ctx.stroke();
}

/**
 * Diagonal hazard stripes clipped to the current path. Used on the wrong-way
 * banner and the pause scrim edges. Deliberately drawn as hard bars, never as a
 * repeating pattern fill — a CanvasPattern would resample and go soft.
 */
export function hazard(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
  period = 26,
  duty = 0.5,
  phase = 0,
): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.fillStyle = color;
  const span = w + h;
  const off = ((phase % period) + period) % period;
  for (let i = -h; i < span; i += period) {
    const sx = x + i + off;
    ctx.beginPath();
    ctx.moveTo(sx, y + h);
    ctx.lineTo(sx + h, y);
    ctx.lineTo(sx + h + period * duty, y);
    ctx.lineTo(sx + period * duty, y + h);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

/**
 * Corner registration ticks — four short L-brackets just inside a rectangle.
 * This is the mark that makes a frame read as a viewfinder rather than a box,
 * and it is what surrounds the replay window on the results screen.
 */
export function cornerTicks(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  len: number,
  width: number,
  color: string,
): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x, y + len); ctx.lineTo(x, y); ctx.lineTo(x + len, y);
  ctx.moveTo(x + w - len, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + len);
  ctx.moveTo(x + w, y + h - len); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w - len, y + h);
  ctx.moveTo(x + len, y + h); ctx.lineTo(x, y + h); ctx.lineTo(x, y + h - len);
  ctx.stroke();
}

// ─────────────────────────────────────────────────────────────────────────────
// Root
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Owns the group, the layer list and the flush. Layers draw in insertion order,
 * so the list order below is the z-order of the HUD.
 */
export class HudCanvasRoot {
  readonly group = new Group();
  readonly layers: HudLayer[] = [];
  readonly scrim: SolidQuad;

  screenW = 1920;
  screenH = 1080;
  ui = 1;

  /** Live cost of the last flush, in milliseconds. Surfaced for the perf report. */
  readonly stats = { redrawMs: 0, layersRedrawn: 0, megapixels: 0 };

  constructor(scrimColor: Color) {
    this.group.name = 'hud';
    this.group.frustumCulled = false;
    this.group.matrixAutoUpdate = false;
    this.scrim = new SolidQuad(scrimColor);
    this.scrim.mesh.renderOrder = -1;
    this.group.add(this.scrim.mesh);
  }

  add(layer: HudLayer): HudLayer {
    layer.mesh.renderOrder = this.layers.length;
    this.layers.push(layer);
    this.group.add(layer.mesh);
    return layer;
  }

  resize(width: number, height: number): void {
    this.screenW = width;
    this.screenH = height;
    this.ui = uiScaleFor(width, height);
    this.scrim.layout();
    for (const l of this.layers) l.layout(width, height, this.ui);
  }

  /**
   * Redraw every dirty layer and upload it. `draw` is called with the layer and
   * a context already scaled into design units and pre-blitted with furniture.
   */
  flush(draw: (layer: HudLayer, ctx: CanvasRenderingContext2D) => void): void {
    const t0 = performance.now();
    let n = 0;
    let px = 0;
    for (const l of this.layers) {
      l.applyAlpha();
      if (!l.mesh.visible) continue;
      if (!l.dirty) continue;
      draw(l, l.begin());
      l.commit();
      n++;
      px += l.canvas.width * l.canvas.height;
    }
    this.scrim.apply();
    this.stats.redrawMs = performance.now() - t0;
    this.stats.layersRedrawn = n;
    this.stats.megapixels = px / 1e6;
  }

  dispose(): void {
    for (const l of this.layers) l.dispose();
    this.layers.length = 0;
    this.scrim.dispose();
    if (sharedQuad) {
      sharedQuad.dispose();
      sharedQuad = null;
    }
  }
}
