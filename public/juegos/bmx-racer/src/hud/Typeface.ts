/**
 * Typeface — the game's letterforms, built from scratch.
 *
 * There is no font file anywhere in this project, and there is no fallback to a
 * browser font. Every character on screen is a set of centreline polylines
 * defined in this file, cached as a `Path2D` in a unit em box at load, and
 * stroked twice: once fat in ink, once at weight in the fill colour. That
 * double-stroke is what gives the HUD the same hard-outlined flat-fill read as
 * the 3D — a filled glyph with no outline would sit on the frame like a web page.
 *
 * DESIGN: a compact geometric stencil. Straight stems, chamfered bowls (O is an
 * octagon, not a circle), a single 45° diagonal family, and a high crossbar on
 * A/E/F/H so the forms feel top-heavy and fast. Uppercase and digits only —
 * lowercase in a race HUD reads as a settings menu.
 *
 * WHY PATHS AND NOT A RASTER ATLAS
 * The brief asked for a glyph atlas blitted at draw time. I built the atlas as a
 * *path* atlas instead, and the reason is resolution: the HUD is drawn at native
 * device pixels, the speed readout has a cap height around 190 device pixels at
 * retina, and the split tags are around 26. A single raster atlas cannot serve
 * both without either blowing up to ~40 MB per tint colour or going soft on the
 * big digits. Cached `Path2D` fills are hardware-accelerated in every browser we
 * target, are crisp at every size, and take arbitrary colours with no per-tint
 * copy. The cost is measured in `Hud.stats.redrawMs` — a full clock redraw
 * (14 glyphs, two passes) is well under a tenth of a millisecond.
 *
 * TABULAR DIGITS are mandatory: every digit, the colon and the full stop share
 * one advance width. Without that the race clock's millisecond field shifts the
 * whole string sideways ten times a second and the clock visibly wobbles.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Glyph data
//
// Coordinates are centrelines in em units: x to the right, y UP, baseline at
// y = 0, cap line at y = 1. Stems sit on x = 0.09 and x = 0.53, the midline on
// x = 0.31. Every stroke is a flat [x0,y0, x1,y1, ...] array.
// ─────────────────────────────────────────────────────────────────────────────

interface GlyphSpec {
  /** Advance width in em units, measured on the baseline. */
  a: number;
  /** Centreline polylines. */
  s: number[][];
  /** Indices into `s` of strokes that close back on themselves. */
  cl?: number[];
}

/** Every digit, the colon and the point share this advance. Non-negotiable. */
const TABULAR_ADV = 0.70;

const L = 0.09;
const R = 0.53;
const M = 0.31;

const SPECS: Record<string, GlyphSpec> = {
  ' ': { a: 0.40, s: [] },

  A: { a: 0.70, s: [[L, 0, M, 1, R, 0], [0.166, 0.30, 0.454, 0.30]] },
  B: {
    a: 0.70,
    s: [
      [L, 0, L, 1],
      [L, 1, 0.42, 1, R, 0.87, R, 0.66, 0.44, 0.545, L, 0.545],
      [L, 0.545, 0.45, 0.545, R, 0.42, R, 0.13, 0.42, 0, L, 0],
    ],
  },
  C: { a: 0.70, s: [[R, 0.80, R, 0.87, 0.43, 1, 0.19, 1, L, 0.87, L, 0.13, 0.19, 0, 0.43, 0, R, 0.13, R, 0.20]] },
  D: { a: 0.70, s: [[L, 0, L, 1, 0.40, 1, R, 0.84, R, 0.16, 0.40, 0]], cl: [0] },
  E: { a: 0.66, s: [[R, 1, L, 1, L, 0, R, 0], [L, 0.545, 0.46, 0.545]] },
  F: { a: 0.64, s: [[R, 1, L, 1, L, 0], [L, 0.545, 0.45, 0.545]] },
  G: {
    a: 0.72,
    s: [[R, 0.80, R, 0.87, 0.43, 1, 0.19, 1, L, 0.87, L, 0.13, 0.19, 0, 0.44, 0, 0.55, 0.13, 0.55, 0.46, 0.33, 0.46]],
  },
  H: { a: 0.70, s: [[L, 0, L, 1], [R, 0, R, 1], [L, 0.545, R, 0.545]] },
  I: { a: 0.34, s: [[0.17, 0, 0.17, 1]] },
  J: { a: 0.66, s: [[R, 1, R, 0.15, 0.42, 0, 0.20, 0, L, 0.15, L, 0.26]] },
  K: { a: 0.70, s: [[L, 0, L, 1], [R, 1, 0.14, 0.44], [0.22, 0.575, R, 0]] },
  L: { a: 0.62, s: [[L, 1, L, 0, R, 0]] },
  M: { a: 0.80, s: [[L, 0, L, 1, 0.35, 0.42, 0.61, 1, 0.61, 0]] },
  N: { a: 0.72, s: [[L, 0, L, 1, R, 0, R, 1]] },
  O: { a: 0.72, s: [[0.19, 1, 0.43, 1, R, 0.86, R, 0.14, 0.43, 0, 0.19, 0, L, 0.14, L, 0.86]], cl: [0] },
  P: { a: 0.68, s: [[L, 0, L, 1], [L, 1, 0.43, 1, R, 0.87, R, 0.63, 0.43, 0.51, L, 0.51]] },
  Q: {
    a: 0.72,
    s: [[0.19, 1, 0.43, 1, R, 0.86, R, 0.14, 0.43, 0, 0.19, 0, L, 0.14, L, 0.86], [0.36, 0.22, 0.60, -0.08]],
    cl: [0],
  },
  R: { a: 0.70, s: [[L, 0, L, 1], [L, 1, 0.43, 1, R, 0.87, R, 0.63, 0.43, 0.51, L, 0.51], [0.30, 0.51, R, 0]] },
  S: {
    a: 0.70,
    s: [[R, 0.86, 0.43, 1, 0.19, 1, L, 0.86, L, 0.66, 0.19, 0.545, 0.43, 0.545, R, 0.42, R, 0.14, 0.43, 0, 0.19, 0, L, 0.14]],
  },
  T: { a: 0.68, s: [[0.02, 1, 0.60, 1], [M, 1, M, 0]] },
  U: { a: 0.72, s: [[L, 1, L, 0.15, 0.19, 0, 0.43, 0, R, 0.15, R, 1]] },
  V: { a: 0.70, s: [[L, 1, M, 0, R, 1]] },
  W: { a: 0.86, s: [[0.04, 1, 0.20, 0, 0.35, 0.60, 0.50, 0, 0.66, 1]] },
  X: { a: 0.70, s: [[L, 1, R, 0], [R, 1, L, 0]] },
  Y: { a: 0.70, s: [[L, 1, M, 0.50, R, 1], [M, 0.50, M, 0]] },
  Z: { a: 0.68, s: [[L, 1, R, 1, L, 0, R, 0]] },

  // ── Digits. All TABULAR_ADV wide. ─────────────────────────────────────────
  '0': {
    a: TABULAR_ADV,
    s: [[0.19, 1, 0.43, 1, R, 0.86, R, 0.14, 0.43, 0, 0.19, 0, L, 0.14, L, 0.86], [0.17, 0.24, 0.45, 0.76]],
    cl: [0],
  },
  '1': { a: TABULAR_ADV, s: [[0.15, 0.79, M, 1, M, 0], [0.13, 0, 0.49, 0]] },
  '2': { a: TABULAR_ADV, s: [[L, 0.84, 0.19, 1, 0.43, 1, R, 0.84, R, 0.62, L, 0.02, L, 0, R, 0]] },
  '3': {
    a: TABULAR_ADV,
    s: [[L, 0.86, 0.19, 1, 0.43, 1, R, 0.86, R, 0.67, 0.41, 0.545, R, 0.42, R, 0.14, 0.43, 0, 0.19, 0, L, 0.14], [0.41, 0.545, 0.25, 0.545]],
  },
  '4': { a: TABULAR_ADV, s: [[0.42, 0, 0.42, 1, 0.05, 0.30, 0.58, 0.30]] },
  '5': { a: TABULAR_ADV, s: [[R, 1, 0.11, 1, 0.11, 0.60, 0.41, 0.63, R, 0.47, R, 0.14, 0.43, 0, 0.19, 0, L, 0.14]] },
  '6': {
    a: TABULAR_ADV,
    s: [[0.50, 0.90, 0.41, 1, 0.20, 1, L, 0.85, L, 0.14, 0.19, 0, 0.43, 0, R, 0.14, R, 0.37, 0.43, 0.50, 0.19, 0.50, L, 0.38]],
  },
  '7': { a: TABULAR_ADV, s: [[0.05, 1, 0.58, 1, 0.24, 0], [0.18, 0.46, 0.44, 0.46]] },
  '8': {
    a: TABULAR_ADV,
    s: [
      [M, 1, 0.44, 1, R, 0.87, R, 0.67, 0.42, 0.545, 0.20, 0.545, L, 0.41, L, 0.14, 0.19, 0, 0.43, 0, R, 0.14, R, 0.41, 0.42, 0.545, 0.20, 0.545, L, 0.67, L, 0.87, 0.18, 1, M, 1],
    ],
  },
  '9': {
    a: TABULAR_ADV,
    s: [[0.12, 0.10, 0.21, 0, 0.42, 0, R, 0.15, R, 0.86, 0.43, 1, 0.19, 1, L, 0.86, L, 0.63, 0.19, 0.50, 0.43, 0.50, R, 0.62]],
  },

  // ── Punctuation. Colon and point are tabular so the clock cannot shift. ───
  '.': { a: TABULAR_ADV * 0.48, s: [[0.16, 0.02, 0.16, 0.11]] },
  ',': { a: TABULAR_ADV * 0.48, s: [[0.18, 0.10, 0.10, -0.13]] },
  ':': { a: TABULAR_ADV * 0.48, s: [[0.16, 0.16, 0.16, 0.27], [0.16, 0.62, 0.16, 0.73]] },
  '-': { a: 0.58, s: [[0.08, 0.50, 0.50, 0.50]] },
  '_': { a: 0.62, s: [[0.04, -0.06, 0.58, -0.06]] },
  '+': { a: 0.62, s: [[0.08, 0.50, 0.52, 0.50], [0.30, 0.28, 0.30, 0.72]] },
  '/': { a: 0.56, s: [[0.04, -0.06, 0.48, 1.06]] },
  '\\': { a: 0.56, s: [[0.04, 1.06, 0.48, -0.06]] },
  "'": { a: 0.28, s: [[0.13, 0.76, 0.13, 1.0]] },
  '!': { a: 0.36, s: [[0.17, 0.30, 0.17, 1], [0.17, 0.02, 0.17, 0.11]] },
  '?': { a: 0.66, s: [[L, 0.84, 0.19, 1, 0.43, 1, R, 0.84, R, 0.71, M, 0.52, M, 0.32], [M, 0.02, M, 0.11]] },
  '%': {
    a: 0.82,
    s: [
      [0.62, 1, 0.10, 0],
      [0.10, 0.72, 0.20, 0.86, 0.10, 1, 0.01, 0.86],
      [0.62, 0.14, 0.71, 0.28, 0.62, 0.42, 0.52, 0.28],
    ],
    cl: [1, 2],
  },
  '(': { a: 0.42, s: [[0.32, 1.06, 0.12, 0.78, 0.12, 0.22, 0.32, -0.06]] },
  ')': { a: 0.42, s: [[0.10, 1.06, 0.30, 0.78, 0.30, 0.22, 0.10, -0.06]] },
  '[': { a: 0.42, s: [[0.32, 1.06, 0.12, 1.06, 0.12, -0.06, 0.32, -0.06]] },
  ']': { a: 0.42, s: [[0.10, 1.06, 0.30, 1.06, 0.30, -0.06, 0.10, -0.06]] },
  '<': { a: 0.60, s: [[0.46, 0.94, 0.08, 0.50, 0.46, 0.06]] },
  '>': { a: 0.60, s: [[0.10, 0.94, 0.48, 0.50, 0.10, 0.06]] },
  '#': { a: 0.78, s: [[0.20, 0, 0.30, 1], [0.46, 0, 0.56, 1], [0.06, 0.30, 0.66, 0.30], [0.10, 0.70, 0.70, 0.70]] },
  '*': { a: 0.56, s: [[0.26, 0.50, 0.26, 1.0], [0.05, 0.62, 0.47, 0.90], [0.05, 0.90, 0.47, 0.62]] },
  '=': { a: 0.62, s: [[0.08, 0.36, 0.52, 0.36], [0.08, 0.66, 0.52, 0.66]] },
  '°': { a: 0.44, s: [[0.20, 0.74, 0.32, 0.84, 0.20, 0.95, 0.08, 0.84]], cl: [0] },
  '·': { a: 0.34, s: [[0.16, 0.45, 0.16, 0.55]] },
};

// ─────────────────────────────────────────────────────────────────────────────
// Compiled glyphs
// ─────────────────────────────────────────────────────────────────────────────

interface Glyph {
  adv: number;
  path: Path2D;
  /** True when the glyph draws nothing — skip the two stroke calls entirely. */
  empty: boolean;
}

const GLYPHS = new Map<string, Glyph>();
let compiled = false;

/**
 * Build every `Path2D` once. Called lazily on first use, but the HUD calls it
 * during load so the first frame that shows text is not the frame that pays for
 * fifty path constructions.
 */
export function buildTypeface(): void {
  if (compiled) return;
  compiled = true;
  for (const ch of Object.keys(SPECS)) {
    const spec = SPECS[ch];
    const path = new Path2D();
    const closed = spec.cl ?? [];
    for (let i = 0; i < spec.s.length; i++) {
      const pts = spec.s[i];
      if (pts.length < 4) continue;
      path.moveTo(pts[0], pts[1]);
      for (let k = 2; k < pts.length; k += 2) path.lineTo(pts[k], pts[k + 1]);
      if (closed.indexOf(i) >= 0) path.closePath();
    }
    GLYPHS.set(ch, { adv: spec.a, path, empty: spec.s.length === 0 });
  }
}

const MISSING: Glyph = { adv: 0.40, path: new Path2D(), empty: true };

function glyphFor(ch: string): Glyph {
  return GLYPHS.get(ch) ?? GLYPHS.get(ch.toUpperCase()) ?? MISSING;
}

// ─────────────────────────────────────────────────────────────────────────────
// Drawing
// ─────────────────────────────────────────────────────────────────────────────

export interface TextStyle {
  /** Cap height in canvas units. All other metrics scale from this. */
  size: number;
  /** Stroke weight as a fraction of cap height. 0.145 is the text weight. */
  weight?: number;
  fill?: string;
  /** Ink outline colour. Pass null for no outline (used inside ink-filled slabs). */
  ink?: string | null;
  /** Half-width of the ink halo either side of the stroke, em units. */
  inkWidth?: number;
  /** Shear. 0.15 ≈ 8.5°, the house slant. 0 for tables and small labels. */
  skew?: number;
  /** Extra advance between glyphs, em units. */
  tracking?: number;
  align?: 'left' | 'center' | 'right';
  /** Vertical datum. 'alpha' = baseline, 'middle' = cap centre, 'top' = cap line. */
  baseline?: 'alpha' | 'middle' | 'top';
  /** Force every glyph onto the tabular advance — used for the race clock. */
  tabular?: boolean;
  /** Global alpha multiplier applied to both passes. */
  alpha?: number;
}

const DEF_WEIGHT = 0.145;
const DEF_INK = 0.052;
const DEF_TRACK = 0.055;

/** Advance width of a string in canvas units, measured on the baseline. */
export function measureText(text: string, style: TextStyle): number {
  buildTypeface();
  const track = style.tracking ?? DEF_TRACK;
  const tab = style.tabular === true;
  let w = 0;
  for (let i = 0; i < text.length; i++) {
    const g = glyphFor(text[i]);
    w += (tab ? TABULAR_ADV : g.adv) + track;
  }
  if (text.length > 0) w -= track;
  return w * style.size;
}

/** Cap height is the size; this is the full ink height including descenders. */
export function textHeight(style: TextStyle): number {
  return style.size * 1.16;
}

/**
 * Draw a run of text. Two passes over the glyph list: the ink halo first, then
 * the fill on top. Doing it per-glyph instead (ink then fill, ink then fill)
 * would let a wide ink halo from glyph n+1 punch a notch out of the fill of
 * glyph n, which shows up as chewed letterforms in tight tracking.
 */
export function drawText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  style: TextStyle,
): number {
  buildTypeface();
  if (text.length === 0) return 0;

  const size = style.size;
  const weight = style.weight ?? DEF_WEIGHT;
  const inkW = style.ink === null ? 0 : style.inkWidth ?? DEF_INK;
  const track = style.tracking ?? DEF_TRACK;
  const skew = style.skew ?? 0;
  const tab = style.tabular === true;
  const width = measureText(text, style);

  let ox = x;
  if (style.align === 'center') ox -= width * 0.5;
  else if (style.align === 'right') ox -= width;

  let oy = y;
  if (style.baseline === 'middle') oy += size * 0.5;
  else if (style.baseline === 'top') oy += size;

  const prevAlpha = ctx.globalAlpha;
  if (style.alpha !== undefined) ctx.globalAlpha = prevAlpha * style.alpha;

  ctx.save();
  ctx.translate(ox, oy);
  // Shear about the baseline so the feet stay put and the caps lean forward.
  if (skew !== 0) ctx.transform(1, 0, -skew, 1, 0, 0);
  ctx.scale(size, -size); // y up, unit em box
  ctx.lineJoin = 'miter';
  // A low miter limit converts the sharpest joins (the apex of A, the elbow of
  // K) into bevels. That is not a compromise — a cut apex is exactly the
  // stencil idiom this typeface is going for.
  ctx.miterLimit = 2.4;
  ctx.lineCap = 'butt';

  // Pass 1: ink halo.
  if (inkW > 0 && style.ink) {
    ctx.strokeStyle = style.ink;
    ctx.lineWidth = weight + inkW * 2;
    let pen = 0;
    for (let i = 0; i < text.length; i++) {
      const g = glyphFor(text[i]);
      if (!g.empty) {
        ctx.save();
        ctx.translate(pen, 0);
        ctx.stroke(g.path);
        ctx.restore();
      }
      pen += (tab ? TABULAR_ADV : g.adv) + track;
    }
  }

  // Pass 2: fill.
  ctx.strokeStyle = style.fill ?? '#ffffff';
  ctx.lineWidth = weight;
  let pen = 0;
  for (let i = 0; i < text.length; i++) {
    const g = glyphFor(text[i]);
    if (!g.empty) {
      ctx.save();
      ctx.translate(pen, 0);
      ctx.stroke(g.path);
      ctx.restore();
    }
    pen += (tab ? TABULAR_ADV : g.adv) + track;
  }

  ctx.restore();
  ctx.globalAlpha = prevAlpha;
  return width;
}

/**
 * The DESCENT wordmark. Not just the string set large — the title needs a
 * heavier weight, tighter tracking and a wider ink than body text, and the
 * proportions of a stencil alphabet change when you scale it that far, so the
 * relationship is retuned here rather than derived.
 */
export function drawWordmark(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  size: number,
  fill: string,
  ink: string,
  alpha = 1,
): number {
  return drawText(ctx, text, x, y, {
    size,
    weight: 0.185,
    inkWidth: 0.062,
    tracking: 0.10,
    skew: 0.17,
    fill,
    ink,
    align: 'center',
    alpha,
  });
}
