/**
 * GeneratedTextures — every texel in this game is written here or in a shader.
 *
 * No image files, no fetches, no data URIs pasted from somewhere else. Canvas
 * 2D and typed arrays only. This module produces:
 *
 *   • the hatch atlas (three screen-tone tiers packed into RGB)
 *   • matcaps for metal, skin and glass — our substitute for a cubemap probe
 *   • the colour-grading LUT, built from the palette's grade constants
 *   • paper grain, dust puff shapes, canopy cards, bark, dirt, and the
 *     cel-cloud mask used by the sky dome
 *
 * Everything is cached by key so a texture is only rasterised once.
 */

import {
  CanvasTexture,
  ClampToEdgeWrapping,
  Data3DTexture,
  DataTexture,
  FloatType,
  LinearFilter,
  LinearSRGBColorSpace,
  NearestFilter,
  RedFormat,
  RepeatWrapping,
  RGBAFormat,
  SRGBColorSpace,
  Texture,
  UnsignedByteType,
} from 'three';
import { Rng } from '../core/RNG';
import { TileableNoise, Worley2D } from '../core/Noise';
import { GRADE, HUD_PALETTE, INK } from './Palette';

const cache = new Map<string, Texture>();

function canvas(size: number): { cv: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const cv = document.createElement('canvas');
  cv.width = size;
  cv.height = size;
  const ctx = cv.getContext('2d', { willReadFrequently: false })!;
  return { cv, ctx };
}

function cached<T extends Texture>(key: string, build: () => T): T {
  const hit = cache.get(key);
  if (hit) return hit as T;
  const tex = build();
  tex.name = key;
  cache.set(key, tex);
  return tex;
}

// ─────────────────────────────────────────────────────────────────────────────
// Hatch atlas
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Three screen-tone tiers packed into one texture:
 *   R = dense cross-hatch  (deepest shadow)
 *   G = single-direction hatch (mid shadow)
 *   B = halftone dot screen (available for a dot-based variant)
 *
 * Drawn with real strokes of varying weight and slight positional jitter, not
 * a mathematical grid — a perfectly regular hatch reads as a filter, and the
 * whole point of this pass is that it should read as somebody's pen.
 */
export function hatchAtlas(size = 512): Texture {
  return cached('hatch', () => {
    const { cv, ctx } = canvas(size);
    const rng = new Rng('hatch');

    // We draw each tier into its own offscreen pass then compose the channels.
    const drawStrokes = (
      spacing: number,
      angleDeg: number,
      weight: number,
      jitter: number,
      passes: number,
    ): ImageData => {
      const { cv: c2, ctx: g } = canvas(size);
      g.fillStyle = '#000';
      g.fillRect(0, 0, size, size);
      g.strokeStyle = '#fff';
      g.lineCap = 'butt';

      for (let pass = 0; pass < passes; pass++) {
        const a = ((angleDeg + pass * 90) * Math.PI) / 180;
        g.save();
        g.translate(size / 2, size / 2);
        g.rotate(a);
        g.translate(-size, -size);
        const span = size * 2;
        for (let y = 0; y <= span * 2; y += spacing) {
          // Weight and offset wobble per stroke so no two lines are identical.
          const w = weight * (0.62 + rng.next() * 0.76);
          const off = (rng.next() - 0.5) * jitter;
          g.lineWidth = w;
          g.globalAlpha = 0.55 + rng.next() * 0.45;
          g.beginPath();
          // Slight bow in the stroke — a hand-drawn line is never straight.
          const bow = (rng.next() - 0.5) * spacing * 0.8;
          g.moveTo(0, y + off);
          g.quadraticCurveTo(span, y + off + bow, span * 2, y + off);
          g.stroke();
        }
        g.restore();
      }
      return g.getImageData(0, 0, size, size);
    };

    const dense = drawStrokes(7, 34, 1.5, 1.6, 2);   // cross-hatch
    const mid = drawStrokes(11, 34, 1.4, 2.0, 1);    // single direction

    // Halftone dots, radius modulated by a low-frequency field so the screen
    // has the density variation of a real tone sheet.
    const { ctx: dotCtx } = canvas(size);
    dotCtx.fillStyle = '#000';
    dotCtx.fillRect(0, 0, size, size);
    dotCtx.fillStyle = '#fff';
    const noise = new TileableNoise(16, 'halftone');
    const pitch = 9;
    for (let y = 0; y < size; y += pitch) {
      for (let x = 0; x < size; x += pitch) {
        const stagger = ((y / pitch) & 1) * pitch * 0.5;
        const n = noise.fbm01((x + stagger) / size, y / size, 4, 3);
        const r = pitch * 0.20 * (0.6 + n * 0.95);
        dotCtx.beginPath();
        dotCtx.arc(x + stagger + pitch * 0.5, y + pitch * 0.5, r, 0, Math.PI * 2);
        dotCtx.fill();
      }
    }
    const dots = dotCtx.getImageData(0, 0, size, size);

    const out = ctx.createImageData(size, size);
    for (let i = 0; i < size * size; i++) {
      out.data[i * 4 + 0] = dense.data[i * 4];
      out.data[i * 4 + 1] = mid.data[i * 4];
      out.data[i * 4 + 2] = dots.data[i * 4];
      out.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(out, 0, 0);

    const tex = new CanvasTexture(cv);
    tex.wrapS = tex.wrapT = RepeatWrapping;
    // Linear here, not nearest: the hatch is sampled in screen space and a
    // nearest fetch would alias into moiré the moment the camera rolls.
    tex.minFilter = LinearFilter;
    tex.magFilter = LinearFilter;
    tex.colorSpace = LinearSRGBColorSpace;
    tex.generateMipmaps = true;
    tex.anisotropy = 4;
    return tex;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Matcaps
// ─────────────────────────────────────────────────────────────────────────────
/**
 * A matcap is a picture of a sphere lit exactly the way we want the material to
 * look. Sampling it by the view-space normal gives a convincing fake reflection
 * for free — no probe, no cubemap, no environment capture anywhere in the
 * project, which is exactly the constraint we're working under.
 *
 * These are painted with hard bands so that even the "reflection" is cel.
 */
function paintMatcap(
  size: number,
  bands: { at: number; color: string }[],
  hotspots: { x: number; y: number; r: number; color: string; hard: boolean }[],
  background: string,
): HTMLCanvasElement {
  const { cv, ctx } = canvas(size);
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, size, size);

  const cx = size / 2;
  const cy = size / 2;
  const R = size / 2;

  // Radial bands from the sphere's "top-left lit" convention outward.
  // Painted as hard-edged arcs so the matcap itself contains no gradients.
  for (let i = bands.length - 1; i >= 0; i--) {
    const b = bands[i];
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = b.color;
    ctx.beginPath();
    // Bands are offset discs — the classic way to build a lit sphere by hand.
    const off = (1 - b.at) * R * 0.85;
    ctx.arc(cx - off * 0.62, cy - off * 0.62, R * (0.35 + b.at * 0.95), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  for (const h of hotspots) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.clip();
    if (h.hard) {
      ctx.fillStyle = h.color;
      ctx.beginPath();
      ctx.ellipse(cx + h.x * R, cy + h.y * R, h.r * R, h.r * R * 0.62, -0.5, 0, Math.PI * 2);
      ctx.fill();
    } else {
      const g = ctx.createRadialGradient(cx + h.x * R, cy + h.y * R, 0, cx + h.x * R, cy + h.y * R, h.r * R);
      g.addColorStop(0, h.color);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, size, size);
    }
    ctx.restore();
  }

  // Mask to the disc — outside the sphere must be flat or the edges smear.
  const img = ctx.getImageData(0, 0, size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x - cx) / R;
      const dy = (y - cy) / R;
      if (dx * dx + dy * dy > 1.0) {
        const i = (y * size + x) * 4;
        // Clamp to the rim colour rather than to black.
        img.data[i] = img.data[i] * 0.4;
        img.data[i + 1] = img.data[i + 1] * 0.4;
        img.data[i + 2] = img.data[i + 2] * 0.4;
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}

export function matcapMetal(size = 256): Texture {
  return cached('matcap:metal', () => {
    const cv = paintMatcap(
      size,
      [
        { at: 0.0, color: '#241f36' },
        { at: 0.35, color: '#4a4763' },
        { at: 0.62, color: '#8f8ca4' },
        { at: 0.86, color: '#d9d5e0' },
      ],
      [
        { x: -0.34, y: -0.40, r: 0.20, color: '#fffaf0', hard: true },
        { x: 0.42, y: 0.46, r: 0.30, color: 'rgba(255,190,120,0.75)', hard: false },
        { x: 0.10, y: -0.72, r: 0.16, color: 'rgba(190,220,255,0.85)', hard: true },
      ],
      '#1b1728',
    );
    const t = new CanvasTexture(cv);
    t.colorSpace = SRGBColorSpace;
    t.minFilter = LinearFilter;
    t.magFilter = LinearFilter;
    t.wrapS = t.wrapT = ClampToEdgeWrapping;
    return t;
  });
}

export function matcapSkin(size = 256): Texture {
  return cached('matcap:skin', () => {
    const cv = paintMatcap(
      size,
      [
        { at: 0.0, color: '#7c4c58' },
        { at: 0.42, color: '#c08268' },
        { at: 0.78, color: '#f0bd97' },
      ],
      [
        { x: -0.30, y: -0.34, r: 0.26, color: 'rgba(255,238,214,0.55)', hard: false },
        { x: 0.46, y: 0.42, r: 0.34, color: 'rgba(210,110,110,0.40)', hard: false },
      ],
      '#5e3a4a',
    );
    const t = new CanvasTexture(cv);
    t.colorSpace = SRGBColorSpace;
    t.minFilter = LinearFilter;
    t.magFilter = LinearFilter;
    t.wrapS = t.wrapT = ClampToEdgeWrapping;
    return t;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Colour grading LUT
// ─────────────────────────────────────────────────────────────────────────────
/**
 * A 32³ 3D LUT built from the grade constants in Palette.ts: lift/gamma/gain,
 * a contrast S-curve, saturation, and a split-tone that pushes shadows toward
 * violet and highlights toward gold.
 *
 * Building it as a LUT rather than applying the maths per-pixel is not about
 * speed — it's about commitment. Once the grade is a table, every pixel in the
 * game goes through the identical transform, and the final image has one look
 * that no individual effect can drift away from.
 */
export function gradeLUT(size = 32): Data3DTexture {
  const key = `lut:${size}`;
  const hit = cache.get(key);
  if (hit) return hit as Data3DTexture;

  const data = new Float32Array(size * size * size * 4);
  const shadowTint = GRADE.shadowTint;
  const highTint = GRADE.highlightTint;

  let p = 0;
  for (let b = 0; b < size; b++) {
    for (let g = 0; g < size; g++) {
      for (let r = 0; r < size; r++) {
        let cr = r / (size - 1);
        let cg = g / (size - 1);
        let cb = b / (size - 1);

        // Lift / gamma / gain — the classic three-way grade.
        cr = Math.pow(Math.max(cr * GRADE.gain.x + GRADE.lift.x, 0), 1 / GRADE.gamma.x);
        cg = Math.pow(Math.max(cg * GRADE.gain.y + GRADE.lift.y, 0), 1 / GRADE.gamma.y);
        cb = Math.pow(Math.max(cb * GRADE.gain.z + GRADE.lift.z, 0), 1 / GRADE.gamma.z);

        // Contrast around a pivot below mid so the shadows stay rich.
        cr = (cr - GRADE.contrastPivot) * GRADE.contrast + GRADE.contrastPivot;
        cg = (cg - GRADE.contrastPivot) * GRADE.contrast + GRADE.contrastPivot;
        cb = (cb - GRADE.contrastPivot) * GRADE.contrast + GRADE.contrastPivot;

        // Split tone by luminance.
        const l = 0.2126 * cr + 0.7152 * cg + 0.0722 * cb;
        const sw = Math.max(0, 1 - l * 1.6);          // shadow weight
        const hw = Math.max(0, (l - 0.55) * 2.2);     // highlight weight
        const k = GRADE.splitStrength;
        cr += (shadowTint.r - 0.5) * sw * k + (highTint.r - 0.5) * hw * k;
        cg += (shadowTint.g - 0.5) * sw * k + (highTint.g - 0.5) * hw * k;
        cb += (shadowTint.b - 0.5) * sw * k + (highTint.b - 0.5) * hw * k;

        // Saturation last, so the split tone gets amplified with everything else.
        const l2 = 0.2126 * cr + 0.7152 * cg + 0.0722 * cb;
        cr = l2 + (cr - l2) * GRADE.saturation;
        cg = l2 + (cg - l2) * GRADE.saturation;
        cb = l2 + (cb - l2) * GRADE.saturation;

        data[p++] = Math.min(Math.max(cr, 0), 1.4);
        data[p++] = Math.min(Math.max(cg, 0), 1.4);
        data[p++] = Math.min(Math.max(cb, 0), 1.4);
        data[p++] = 1;
      }
    }
  }

  const tex = new Data3DTexture(data, size, size, size);
  tex.format = RGBAFormat;
  tex.type = FloatType;
  tex.minFilter = LinearFilter;
  tex.magFilter = LinearFilter;
  tex.wrapS = tex.wrapT = tex.wrapR = ClampToEdgeWrapping;
  tex.needsUpdate = true;
  tex.name = key;
  cache.set(key, tex);
  return tex;
}

// ─────────────────────────────────────────────────────────────────────────────
// Surface textures
// ─────────────────────────────────────────────────────────────────────────────

/** Paper grain for the final composite — a whisper of tooth over the image. */
export function paperGrain(size = 512): Texture {
  return cached('paper', () => {
    const { cv, ctx } = canvas(size);
    const img = ctx.createImageData(size, size);
    const n1 = new TileableNoise(64, 'paper-a');
    const n2 = new TileableNoise(256, 'paper-b');
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const u = x / size;
        const v = y / size;
        // Fibrous: one stretched octave for the grain direction, one isotropic.
        const fib = n1.fbm01(u * 1.0, v * 0.12, 8, 3);
        const tooth = n2.fbm01(u, v, 32, 3);
        const g = 128 + (fib - 0.5) * 46 + (tooth - 0.5) * 84;
        const i = (y * size + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.max(0, Math.min(255, g));
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    const t = new CanvasTexture(cv);
    t.wrapS = t.wrapT = RepeatWrapping;
    t.colorSpace = LinearSRGBColorSpace;
    return t;
  });
}

/**
 * A conifer canopy card: an alpha-cut silhouette of clustered needle masses.
 * Drawn as overlapping hand-shaped blobs with a ragged edge, because a
 * symmetrical procedural tree card reads as a billboard instantly.
 */
export function canopyCard(size = 256, seed = 'canopy'): Texture {
  return cached(`canopy:${seed}`, () => {
    const { cv, ctx } = canvas(size);
    ctx.clearRect(0, 0, size, size);
    const rng = new Rng(seed);

    ctx.fillStyle = '#ffffff';
    // Build the silhouette from a stack of downward-drooping needle clusters,
    // widest at the bottom — the conifer read.
    const tiers = 7;
    for (let t = 0; t < tiers; t++) {
      const ty = size * (0.10 + (t / tiers) * 0.86);
      const halfWidth = size * (0.06 + (t / tiers) * 0.42);
      const clusters = 5 + t * 2;
      for (let c = 0; c < clusters; c++) {
        const side = c % 2 === 0 ? -1 : 1;
        const frac = (c / clusters) * 0.95 + rng.next() * 0.08;
        const x = size / 2 + side * halfWidth * frac;
        const y = ty + (rng.next() - 0.5) * size * 0.045;
        const len = halfWidth * (0.32 + rng.next() * 0.42);
        const droop = size * 0.035 * (0.6 + rng.next());
        ctx.beginPath();
        ctx.moveTo(size / 2, ty - size * 0.01);
        ctx.quadraticCurveTo(x, y + droop * 0.4, x + side * len * 0.35, y + droop);
        ctx.quadraticCurveTo(x, y + droop * 1.5, size / 2, ty + size * 0.035);
        ctx.closePath();
        ctx.fill();
      }
    }
    // Central mass so the card isn't hollow.
    ctx.beginPath();
    ctx.moveTo(size / 2, size * 0.04);
    ctx.lineTo(size * 0.30, size * 0.97);
    ctx.lineTo(size * 0.70, size * 0.97);
    ctx.closePath();
    ctx.fill();

    // Chew the alpha edge with noise so the silhouette has needle raggedness.
    const img = ctx.getImageData(0, 0, size, size);
    const n = new TileableNoise(48, `${seed}-edge`);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = (y * size + x) * 4;
        if (img.data[i + 3] === 0) continue;
        const v = n.fbm01(x / size, y / size, 26, 3);
        if (v < 0.40) img.data[i + 3] = 0;
        // Tint the interior so the canopy has value variation before shading.
        const shade = 0.72 + n.fbm01(x / size, y / size, 7, 3) * 0.5;
        img.data[i] = Math.min(255, 255 * shade);
        img.data[i + 1] = Math.min(255, 255 * shade);
        img.data[i + 2] = Math.min(255, 255 * shade);
      }
    }
    ctx.putImageData(img, 0, 0);

    const t = new CanvasTexture(cv);
    t.colorSpace = SRGBColorSpace;
    t.wrapS = t.wrapT = ClampToEdgeWrapping;
    t.minFilter = LinearFilter;
    t.magFilter = LinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = 4;
    return t;
  });
}

/** Grass tuft card — a fan of blades, alpha cut. */
export function grassCard(size = 128, seed = 'grass'): Texture {
  return cached(`grasscard:${seed}`, () => {
    const { cv, ctx } = canvas(size);
    ctx.clearRect(0, 0, size, size);
    const rng = new Rng(seed);
    const blades = 11;
    for (let b = 0; b < blades; b++) {
      const x0 = size * (0.5 + (rng.next() - 0.5) * 0.55);
      const lean = (rng.next() - 0.5) * size * 0.55;
      const h = size * (0.45 + rng.next() * 0.5);
      const w = size * (0.020 + rng.next() * 0.022);
      const shade = 150 + rng.next() * 105;
      ctx.fillStyle = `rgb(${shade},${shade},${shade})`;
      ctx.beginPath();
      ctx.moveTo(x0 - w, size);
      ctx.quadraticCurveTo(x0 + lean * 0.4, size - h * 0.6, x0 + lean, size - h);
      ctx.quadraticCurveTo(x0 + lean * 0.4 + w * 1.4, size - h * 0.6, x0 + w, size);
      ctx.closePath();
      ctx.fill();
    }
    // A few wildflower dots — the Ghibli mountainside detail.
    for (let f = 0; f < 4; f++) {
      if (!rng.chance(0.55)) continue;
      const x = size * (0.2 + rng.next() * 0.6);
      const y = size * (0.25 + rng.next() * 0.35);
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(x, y, size * 0.030, 0, Math.PI * 2);
      ctx.fill();
    }
    const t = new CanvasTexture(cv);
    t.colorSpace = SRGBColorSpace;
    t.wrapS = t.wrapT = ClampToEdgeWrapping;
    t.generateMipmaps = true;
    t.anisotropy = 4;
    return t;
  });
}

/**
 * Hard-edged dust puff. Not a soft Gaussian sprite — a cel puff is a closed
 * shape with a defined contour and an ink line, the way smoke is drawn in
 * animation. RGB carries interior value, A carries the cut.
 */
export function dustPuff(size = 128, seed = 'puff0'): Texture {
  return cached(`puff:${seed}`, () => {
    const { cv, ctx } = canvas(size);
    ctx.clearRect(0, 0, size, size);
    const rng = new Rng(seed);
    const cx = size / 2;
    const cy = size / 2;

    // The contour: a ring of overlapping circles of varying radius, the
    // classic cartoon cloud construction.
    const lobes = 7 + rng.int(0, 3);
    const pts: { x: number; y: number; r: number }[] = [];
    for (let i = 0; i < lobes; i++) {
      const a = (i / lobes) * Math.PI * 2 + rng.range(-0.22, 0.22);
      const d = size * rng.range(0.14, 0.24);
      pts.push({
        x: cx + Math.cos(a) * d,
        y: cy + Math.sin(a) * d * 0.86,
        r: size * rng.range(0.115, 0.185),
      });
    }

    // Ink contour first, then the fill inset — gives a real drawn outline.
    ctx.fillStyle = '#000000';
    for (const p of pts) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r + size * 0.028, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#ffffff';
    for (const p of pts) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    // A single hard shadow lobe inside — puffs need a light side and a dark
    // side or they read as flat stickers.
    ctx.fillStyle = '#6a6a6a';
    ctx.save();
    ctx.beginPath();
    for (const p of pts) {
      ctx.moveTo(p.x + p.r, p.y);
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    }
    ctx.clip();
    ctx.beginPath();
    ctx.arc(cx + size * 0.14, cy + size * 0.16, size * 0.34, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Alpha from any non-transparent pixel; keep the ink ring as alpha too.
    const img = ctx.getImageData(0, 0, size, size);
    for (let i = 0; i < size * size; i++) {
      const a = img.data[i * 4 + 3];
      if (a > 8) img.data[i * 4 + 3] = 255;
      else img.data[i * 4 + 3] = 0;
    }
    ctx.putImageData(img, 0, 0);

    const t = new CanvasTexture(cv);
    t.colorSpace = SRGBColorSpace;
    t.wrapS = t.wrapT = ClampToEdgeWrapping;
    t.generateMipmaps = true;
    return t;
  });
}

/** Four puff variants so a dust burst never shows the same shape twice. */
export function dustPuffSet(): Texture[] {
  return [dustPuff(128, 'puff0'), dustPuff(128, 'puff1'), dustPuff(128, 'puff2'), dustPuff(128, 'puff3')];
}

/**
 * Cel cloud mask for the sky dome. Hard-thresholded fBm with a second pass of
 * erosion so the cloud edges have the scalloped, cut-paper contour of an anime
 * sky rather than the fluffy noise of a volumetric.
 */
export function celCloudMask(size = 1024, seed = 'clouds', coverage = 0.52): Texture {
  return cached(`clouds:${seed}:${coverage}`, () => {
    const { cv, ctx } = canvas(size);
    const img = ctx.createImageData(size, size);
    const base = new TileableNoise(32, `${seed}-base`);
    const detail = new TileableNoise(96, `${seed}-detail`);
    const warp = new TileableNoise(16, `${seed}-warp`);

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const u = x / size;
        const v = y / size;
        // Domain warp gives the clouds a wind-sheared drift.
        const wx = u + (warp.fbm01(u, v, 3, 3) - 0.5) * 0.16;
        const wy = v + (warp.fbm01(u + 0.31, v + 0.77, 3, 3) - 0.5) * 0.09;

        let d = base.fbm01(wx, wy, 5, 5, 0.55);
        d = d * 0.72 + detail.fbm01(wx, wy, 18, 3) * 0.28;

        // Hard threshold with a very narrow ramp — the cut-paper edge.
        const t = (d - (1 - coverage)) / 0.045;
        const a = Math.max(0, Math.min(1, t));

        // Interior value: two bands, lit top-right, shadowed underside.
        const lit = base.fbm01(wx + 0.02, wy - 0.02, 5, 5, 0.55);
        const band = lit > d ? 1.0 : 0.62;

        const i = (y * size + x) * 4;
        const c = Math.round(255 * band);
        img.data[i] = c;
        img.data[i + 1] = c;
        img.data[i + 2] = c;
        img.data[i + 3] = Math.round(255 * a);
      }
    }
    ctx.putImageData(img, 0, 0);
    const t = new CanvasTexture(cv);
    t.wrapS = t.wrapT = RepeatWrapping;
    t.colorSpace = LinearSRGBColorSpace;
    t.minFilter = LinearFilter;
    t.magFilter = LinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = 4;
    return t;
  });
}

/**
 * A worn dirt surface map for the trail ribbon: tyre lines, gravel speckle,
 * and a subtle braid where riders have picked different lines through a corner.
 * R = wear (0 fresh, 1 polished), G = gravel, B = moisture, A = 1.
 */
export function trailSurface(size = 512): Texture {
  return cached('trail-surface', () => {
    const { cv, ctx } = canvas(size);
    const img = ctx.createImageData(size, size);
    const grain = new TileableNoise(128, 'trail-grain');
    const braid = new TileableNoise(12, 'trail-braid');
    const worley = new Worley2D('trail-gravel');

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const u = x / size; // across the ribbon
        const v = y / size; // along the ribbon

        // Two tyre lines, wandering slowly along the length.
        const wander = (braid.fbm01(v * 3, 0.5, 3, 3) - 0.5) * 0.20;
        const l1 = Math.abs(u - (0.36 + wander));
        const l2 = Math.abs(u - (0.63 + wander * 0.7));
        const line = Math.max(
          1 - Math.min(l1, l2) / 0.075,
          0,
        );
        const wear = Math.min(1, line * (0.55 + grain.fbm01(u * 4, v * 12, 24, 3) * 0.7));

        const gravel = worley.f1(u * 34, v * 34);
        const moisture = grain.fbm01(u, v, 6, 4);

        const i = (y * size + x) * 4;
        img.data[i] = Math.round(255 * wear);
        img.data[i + 1] = Math.round(255 * gravel);
        img.data[i + 2] = Math.round(255 * moisture);
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    const t = new CanvasTexture(cv);
    t.wrapS = t.wrapT = RepeatWrapping;
    t.colorSpace = LinearSRGBColorSpace;
    t.anisotropy = 8;
    return t;
  });
}

/** Bark: vertical fissures from stretched worley borders. */
export function barkTexture(size = 256): Texture {
  return cached('bark', () => {
    const { cv, ctx } = canvas(size);
    const img = ctx.createImageData(size, size);
    const w = new Worley2D('bark');
    const n = new TileableNoise(64, 'bark-n');
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const u = x / size;
        const v = y / size;
        const b = w.border(u * 7, v * 26);
        const fis = Math.pow(1 - Math.min(b * 4.5, 1), 2.0);
        const grain = n.fbm01(u * 2, v * 14, 30, 3);
        const val = 1 - fis * 0.75 - grain * 0.18;
        const i = (y * size + x) * 4;
        const c = Math.round(255 * Math.max(0, Math.min(1, val)));
        img.data[i] = img.data[i + 1] = img.data[i + 2] = c;
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    const t = new CanvasTexture(cv);
    t.wrapS = t.wrapT = RepeatWrapping;
    t.colorSpace = LinearSRGBColorSpace;
    t.anisotropy = 4;
    return t;
  });
}

/**
 * A tiny 1D ramp used by post effects that need a hard palette lookup
 * (impact flash tinting, boost meter fill). NearestFilter, 8 stops.
 */
export function paletteRamp(colors: string[], steps = 8): DataTexture {
  const key = `ramp:${colors.join(',')}:${steps}`;
  const hit = cache.get(key);
  if (hit) return hit as DataTexture;
  const data = new Uint8Array(steps * 4);
  const el = document.createElement('canvas');
  el.width = steps;
  el.height = 1;
  const g = el.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, steps, 0);
  colors.forEach((c, i) => grad.addColorStop(i / Math.max(1, colors.length - 1), c));
  g.fillStyle = grad;
  g.fillRect(0, 0, steps, 1);
  const px = g.getImageData(0, 0, steps, 1).data;
  data.set(px);
  const t = new DataTexture(data, steps, 1, RGBAFormat, UnsignedByteType);
  t.minFilter = NearestFilter;
  t.magFilter = NearestFilter;
  t.wrapS = t.wrapT = ClampToEdgeWrapping;
  t.colorSpace = SRGBColorSpace;
  t.needsUpdate = true;
  cache.set(key, t);
  return t;
}

/** Blue-noise-ish dither mask for the LOD fade — avoids visible popping. */
export function ditherMask(size = 64): DataTexture {
  const key = `dither:${size}`;
  const hit = cache.get(key);
  if (hit) return hit as DataTexture;
  // Void-and-cluster is overkill; a well-scrambled Bayer gives a clean fade.
  const bayer8 = [
    0, 32, 8, 40, 2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26,
    12, 44, 4, 36, 14, 46, 6, 38, 60, 28, 52, 20, 62, 30, 54, 22,
    3, 35, 11, 43, 1, 33, 9, 41, 51, 19, 59, 27, 49, 17, 57, 25,
    15, 47, 7, 39, 13, 45, 5, 37, 63, 31, 55, 23, 61, 29, 53, 21,
  ];
  const data = new Uint8Array(size * size);
  const rng = new Rng('dither');
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const b = bayer8[(y % 8) * 8 + (x % 8)] / 64;
      // Jitter within the cell so large flat regions don't show the 8×8 grid.
      const j = (rng.next() - 0.5) * (1 / 64);
      data[y * size + x] = Math.max(0, Math.min(255, Math.round((b + j) * 255)));
    }
  }
  const t = new DataTexture(data, size, size, RedFormat, UnsignedByteType);
  t.minFilter = NearestFilter;
  t.magFilter = NearestFilter;
  t.wrapS = t.wrapT = RepeatWrapping;
  t.needsUpdate = true;
  cache.set(key, t);
  return t;
}

/** Install the shared generated textures into the global NPR uniform block. */
export function initGeneratedTextures(npr: {
  uHatchTex: { value: Texture | null };
  uMatcapMetal: { value: Texture | null };
  uMatcapSkin: { value: Texture | null };
}): void {
  npr.uHatchTex.value = hatchAtlas();
  npr.uMatcapMetal.value = matcapMetal();
  npr.uMatcapSkin.value = matcapSkin();
}

export function disposeGeneratedTextures(): void {
  for (const t of cache.values()) t.dispose();
  cache.clear();
}
