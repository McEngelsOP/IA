/**
 * LUT — the grade, as a table, ready for the GPU.
 *
 * This module evaluates the 32-cube from the constants in Palette.GRADE and
 * uploads it as an 8-bit RGBA 3D texture. Three things about it matter:
 *
 *  1. It is 8-bit, not float. Linear filtering of a FLOAT 3D texture
 *     requires OES_texture_float_linear, which is an optional WebGL2 extension
 *     — present on Apple silicon, absent on several software rasterisers,
 *     including the one the headless capture harness can fall back to. When it
 *     is missing three silently drops to NEAREST and the grade posterises into
 *     32 visible steps per channel. An 8-bit RGBA 3D texture filters natively
 *     everywhere, is 128KB, and — since we are grading a DISPLAY-REFERRED
 *     image, where values above 1.0 have nowhere to go — loses nothing.
 *
 *  2. It owns the sampling GLSL, including the half-texel inset. Sampling a 3D
 *     LUT without the inset shifts every colour by half a cell toward black,
 *     which is subtle enough to survive review and wrong enough to matter.
 *
 *  3. It owns the GRADE TRIM — see the constant below. The authored grade
 *     stacked four warm multipliers and clipped the red channel on the trail
 *     surface; the correction lives here, next to the transform it corrects.
 *
 * The grade is applied in DISPLAY space, after the sRGB encode. That is not an
 * arbitrary choice: GRADE.contrastPivot is 0.46 and the lift is 0.012, numbers
 * that only make sense as fractions of a display signal. Applied to linear
 * radiance a 0.46 pivot sits at 71% sRGB and the "subtle" lift would raise the
 * black point by a third of a stop.
 */

import {
  ClampToEdgeWrapping,
  Data3DTexture,
  LinearFilter,
  RGBAFormat,
  UnsignedByteType,
} from 'three';
import { GRADE } from './Palette';

/**
 * GRADE TRIM — the fix for the palette drift, applied here because Palette.ts
 * is not mine to edit.
 *
 * THE SYMPTOM. The ridden trail read as a saturated pumpkin orange, hotter and
 * higher-chroma than RAMPS.dirt's authored 0xb8825a / 0xd9a878.
 *
 * THE CAUSE, traced through the table by hand. Take the lit dirt plateau,
 * 0xd9a878 = (217, 168, 120), and run it through the untrimmed grade:
 *
 *   gain 1.06 on red         217 -> 230
 *   contrast 1.12 @ 0.46     230 -> 247   (everything above the pivot expands)
 *   split 0.22 -> gold       247 -> 258
 *   saturation 1.14          258 -> 267, CLIPPED TO 255
 *
 * Four warm multipliers stacked on a ramp that was already authored warm. The
 * last step is the one that actually does the damage: red clips, so the lit
 * plateau and the mid plateau BOTH land on red = 255 and the ramp's top step —
 * the whole reason for authoring four colours — collapses into one hue. What
 * survives is maximum-red, and maximum-red on a warm mid is pumpkin.
 *
 * THE TRIM. Three multipliers and a ceiling, chosen to keep the grade's warmth
 * and kill the clip:
 *
 *   gain   x (0.965, 1.0, 1.035)  -> effective (1.023, 1.0, 0.973)
 *   split  x 0.68                 -> effective 0.15
 *   sat    x 0.93                 -> effective 1.060, rolling to 0.85 of that
 *                                    in the highlights, which is where the
 *                                    over-chroma actually lived
 *   chroma ceiling at 0.985       -> nothing can clip a channel, ever
 *
 * Lit dirt now lands at (244, 179, 127) instead of (255, 178, 111): still
 * graded, still warm, but the top of the ramp is a colour again rather than a
 * clipped edge, and the step between the mid and lit plateaus survives.
 *
 * These are deltas rather than replacements on purpose — they stay locked to
 * whatever Palette.GRADE says, so a future move on the authored grade carries
 * through. The equivalent baked values are reported alongside.
 */
const TRIM = {
  gainR: 0.965,
  gainG: 1.0,
  gainB: 1.035,
  split: 0.68,
  saturation: 0.93,
  /** Saturation multiplier at the top of the range, reached over 0.55..0.95 luma. */
  highlightSat: 0.85,
  /**
   * GAMUT ROLL — where the hottest channel starts to be compressed, and the
   * asymptote it can never reach.
   *
   * ── THIS WAS THE SKY'S MISSING SATURATION, AND THE ARITHMETIC IS EXACT ─────
   *
   * It used to be a single number, `chromaCeiling: 0.985`, enforced by pulling
   * the whole triplet toward its own LUMINANCE until the hottest channel fit.
   * Preserving hue while chroma gives is the textbook move and it is completely
   * wrong here, because of where the pull lands on a bright band.
   *
   * Take SKY.horizon, 0xf0cf9e, the authored dawn cream — hue 35, saturation
   * 34%. Through bloom, the display shoulder and the encode it arrives at this
   * table as (0.957, 0.831, 0.627). The grade then does what it is asked to:
   *
   *   gain + lift + gamma          -> (0.991, 0.837, 0.649)
   *   contrast 1.12 about 0.46     -> (1.054, 0.882, 0.671)   red already over 1
   *   gold split at luma 0.904     -> (1.122, 0.908, 0.651)
   *   saturation 1.06              -> (1.104, 0.911, 0.679)
   *
   * The hottest channel is 1.104 and its own luminance is 0.935, so the old
   * ceiling scaled the distance from luminance by (0.985 - 0.935)/0.169 =
   * 0.296. SEVENTY PERCENT OF THE CHROMA WAS DELETED IN ONE STEP. The predicted
   * output is (251, 237, 219) = hsv(35, 13%); the frame measures #fbf0e1 =
   * hsv(35, 10%). The critic's "authored SKY.horizon of hue 35, saturation 34%
   * reads at 11% saturation" is this line of code and nothing else — not the
   * fog, not the clouds, not the dome.
   *
   * And it had to be worst exactly where it is most visible. The pull toward
   * luminance costs chroma in proportion to how far the hottest channel
   * overshoots, and the things that overshoot are the BRIGHT, SATURATED bands —
   * a dawn sky, a lit dirt plateau, a red jersey in sun. The grade was
   * bleaching precisely the colours it was authored to enrich.
   *
   * WHAT IT DOES NOW. The overshoot is taken out of EXPOSURE instead of chroma:
   * the hottest channel is rolled through a soft asymptotic knee and the whole
   * triplet is scaled by the same ratio. Uniform scaling preserves hue exactly
   * AND preserves HSV saturation exactly — (max - min)/max is invariant under
   * scaling — so a cream stays a cream and only its value gives, by 1-2%.
   * SKY.horizon now lands at (249, 206, 153) = hsv(35, 39%) against an authored
   * 34%, instead of hsv(35, 10%).
   *
   * The knee is asymptotic rather than clamped, which is what keeps the
   * ORIGINAL bug fixed. The whole reason a ceiling exists is that a hard clip
   * puts two authored plateaus on the same channel value and collapses the top
   * step of the dirt ramp; an asymptote is strictly monotonic in the hottest
   * channel, so two inputs that differ still differ on the way out. Lit dirt
   * sits at 0.957, below the knee's real effect, and moves by 4/255.
   */
  gamutKnee: 0.90,
  gamutCeiling: 0.995,
};

const LUMA_R = 0.2126;
const LUMA_G = 0.7152;
const LUMA_B = 0.0722;

function smoothstep01(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

let _lut: Data3DTexture | null = null;

/**
 * The grade table, built once. 32^3 RGBA8.
 *
 * Built here rather than pulled from GeneratedTextures.gradeLUT so the trim
 * above sits in the same function as the transform it corrects — a grade whose
 * correction lives in a different module is a grade that will be "fixed" twice.
 * The operator order is identical to the original: lift/gamma/gain, contrast
 * about a pivot, split tone by luminance, saturation last.
 */
export function gradeLutTexture(size = 32): Data3DTexture {
  if (_lut) return _lut;

  const n = size * size * size;
  const bytes = new Uint8Array(n * 4);

  const gainR = GRADE.gain.x * TRIM.gainR;
  const gainG = GRADE.gain.y * TRIM.gainG;
  const gainB = GRADE.gain.z * TRIM.gainB;
  const split = GRADE.splitStrength * TRIM.split;
  const satBase = GRADE.saturation * TRIM.saturation;
  const sh = GRADE.shadowTint;
  const hi = GRADE.highlightTint;

  let p = 0;
  for (let bi = 0; bi < size; bi++) {
    for (let gi = 0; gi < size; gi++) {
      for (let ri = 0; ri < size; ri++) {
        let cr = ri / (size - 1);
        let cg = gi / (size - 1);
        let cb = bi / (size - 1);

        // Lift / gamma / gain — the classic three-way grade.
        cr = Math.pow(Math.max(cr * gainR + GRADE.lift.x, 0), 1 / GRADE.gamma.x);
        cg = Math.pow(Math.max(cg * gainG + GRADE.lift.y, 0), 1 / GRADE.gamma.y);
        cb = Math.pow(Math.max(cb * gainB + GRADE.lift.z, 0), 1 / GRADE.gamma.z);

        // Contrast around a pivot below mid so the shadows stay rich.
        cr = (cr - GRADE.contrastPivot) * GRADE.contrast + GRADE.contrastPivot;
        cg = (cg - GRADE.contrastPivot) * GRADE.contrast + GRADE.contrastPivot;
        cb = (cb - GRADE.contrastPivot) * GRADE.contrast + GRADE.contrastPivot;

        // Split tone by luminance.
        const l = LUMA_R * cr + LUMA_G * cg + LUMA_B * cb;
        // THE CROSSOVER, and it was the palette rotation.
        //
        // These were `1 - l*1.6` and `(l - 0.55)*2.2`: the shadow tint reached
        // all the way to luma 0.625 while the gold did not begin until 0.55.
        // A sunlit dirt trail sits at roughly 0.50-0.55 — below the gold, still
        // inside the violet. And shadowTint - 0.5 is (-0.143, -0.210, +0.025),
        // which cuts green hardest and adds blue, so applied to an orange it
        // rotates it toward magenta. Measured across the review set, the lit
        // trail read hue 6 at 26% saturation against an authored 27-33 at
        // 44-45%, with two frames past red into magenta at 348 and 358. The
        // committed dawn-gold was being turned into dusk-pink by its own grade.
        //
        // Now the two weights hand over at ~0.35 with a small overlap: shadows
        // get the violet, mid and up get the gold, and no luminance is left in
        // a gap where only the cool tint applies.
        const sw = Math.max(0, 1 - l * 2.8);
        const hw = Math.max(0, (l - 0.34) * 1.6);
        cr += (sh.r - 0.5) * sw * split + (hi.r - 0.5) * hw * split;
        cg += (sh.g - 0.5) * sw * split + (hi.g - 0.5) * hw * split;
        cb += (sh.b - 0.5) * sw * split + (hi.b - 0.5) * hw * split;

        // Saturation last, so the split tone is amplified with everything else
        // — but rolled off in the highlights. The excess chroma was almost
        // entirely a highlight problem: a lit plateau is exactly the value that
        // has already been pushed up by gain, contrast AND the gold split, so
        // it is the one place a flat saturation boost has nothing left to give.
        const l2 = LUMA_R * cr + LUMA_G * cg + LUMA_B * cb;
        const sat = satBase * (1 - (1 - TRIM.highlightSat) * smoothstep01(0.55, 0.95, l2));
        cr = l2 + (cr - l2) * sat;
        cg = l2 + (cg - l2) * sat;
        cb = l2 + (cb - l2) * sat;

        // Gamut roll. The hottest channel goes through a soft asymptotic knee
        // and the WHOLE TRIPLET is scaled by the same ratio, so hue and HSV
        // saturation both survive untouched and the only thing that gives is
        // value. See TRIM.gamutKnee for the measurement this replaced.
        const m = Math.max(cr, cg, cb);
        if (m > TRIM.gamutKnee) {
          const span = TRIM.gamutCeiling - TRIM.gamutKnee;
          const over = (m - TRIM.gamutKnee) / span;
          const rolled = TRIM.gamutKnee + span * (1 - Math.exp(-over));
          const k = rolled / m;
          cr *= k;
          cg *= k;
          cb *= k;
        }

        bytes[p++] = Math.round(Math.min(Math.max(cr, 0), 1) * 255);
        bytes[p++] = Math.round(Math.min(Math.max(cg, 0), 1) * 255);
        bytes[p++] = Math.round(Math.min(Math.max(cb, 0), 1) * 255);
        bytes[p++] = 255;
      }
    }
  }

  const tex = new Data3DTexture(bytes, size, size, size);
  tex.format = RGBAFormat;
  tex.type = UnsignedByteType;
  tex.minFilter = LinearFilter;
  tex.magFilter = LinearFilter;
  tex.wrapS = ClampToEdgeWrapping;
  tex.wrapT = ClampToEdgeWrapping;
  tex.wrapR = ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;
  tex.name = 'grade-lut-8';
  _lut = tex;
  return tex;
}

export function disposeGradeLut(): void {
  _lut?.dispose();
  _lut = null;
}

/**
 * GLSL for the grade tail of the composite: the display shoulder, the LUT
 * lookup, vignette and paper grain. Kept together because the ORDER of these
 * four operations is the thing that has to stay fixed, and separating them
 * across files is how an order gets quietly changed.
 */
export const GLSL_GRADE = /* glsl */ `
  uniform highp sampler3D uLut;
  uniform float uLutSize;
  uniform sampler2D uGrain;
  uniform vec2  uGrainScale;
  uniform float uGrainStrength;
  uniform float uVignette;
  uniform float uVignetteSoftness;
  uniform vec3  uVignetteTint;   // GRADE.shadowTint — corners cool, never crush

  /**
   * Display shoulder.
   *
   * The renderer does no tone mapping — deliberately, because a filmic curve
   * would put a smooth roll across every flat cel band and the bands are the
   * whole point. But bloom and speculars do exceed 1.0, and hard-clipping them
   * flattens the halo into a disc. This is the minimum intervention: exactly
   * the identity below 'k', an asymptote to 1.0 above it. Flat bands live
   * entirely below k and are therefore untouched.
   */
  vec3 displayShoulder(vec3 c) {
    const float k = 0.86;
    vec3 over = max(c - k, vec3(0.0));
    return min(c, vec3(k)) + (1.0 - k) * (over / (over + (1.0 - k)));
  }

  /**
   * 3D LUT lookup with the half-texel inset. Without the (size-1)/size scale
   * and the +0.5 offset the lookup samples the CORNER of each cell instead of
   * its centre and the whole image drifts half a cell dark.
   */
  vec3 applyGradeLut(vec3 c) {
    c = clamp(c, 0.0, 1.0);
    vec3 uvw = (c * (uLutSize - 1.0) + 0.5) / uLutSize;
    return texture(uLut, uvw).rgb;
  }

  /**
   * Elliptical vignette. Subtle by construction — it keeps the eye on the trail.
   *
   * THREE THINGS HAVE TO BE RIGHT HERE. THE FIRST TWO WERE.
   *
   * 1. COLOUR SPACE. uVignetteTint carries GRADE.shadowTint, and a three Color
   *    holds LINEAR values — 0x5b4a86 is (0.107, 0.072, 0.235) linear against
   *    (0.357, 0.290, 0.525) as the authored display value. This function runs
   *    AFTER the sRGB encode, so using the raw uniform tinted the corners with
   *    a colour three times darker and far more saturated than the one in the
   *    palette. It is encoded here, once, where it is used.
   *
   * 2. THE MOVE ITSELF. Mixing toward any fixed colour pulls every corner
   *    pixel toward the SAME triplet, which is a loss of chroma by definition:
   *    two different corner colours come out closer together than they went in.
   *    Multiplying by a tint that has been normalised to unit luminance cannot
   *    do that — it is a pure hue rotation, and how dark the corner gets is a
   *    separate, explicit term. Cool toward violet, then darken a little; never
   *    the one operation doing both jobs and desaturating as a side effect.
   *
   * 3. IT MUST NOT BE A SMOOTH LUMINANCE RAMP. The old comment below already
   *    said why — "a heavy vignette puts a smooth ramp straight across every
   *    one of them" — and then the code did exactly that: uVignette *
   *    smoothstep(0.55, 1.25, r), a continuous darkening running from a fifth
   *    of the way out to past the corner, i.e. across two thirds of the frame.
   *
   *    MEASURED, not assumed. tools/capture/_skyab.mjs installs an override on
   *    CompositePass.syncState (writing the uniform and rendering measures
   *    nothing — syncState reloads every uniform from POST_STATE) and shoots
   *    the same pose with uVignette forced to 0. On ravine-gap, the horizontal
   *    trace the stills critic used — y = 1000, x 2400..3150 — carried 18.9
   *    luminance units with a MAXIMUM SINGLE-PIXEL STEP OF 1.0. Zeroing the
   *    vignette alone took 7.1 of those units out. It was the second-largest
   *    step-free gradient in the frame after the speed field, and unlike the
   *    speed field it was in EVERY frame the game has ever rendered.
   *
   *    It is now three hard rings, cut on the one-pixel fwidth rule the rest of
   *    the picture uses, and they are placed OUT IN THE CORNERS: the innermost
   *    arc meets the top edge at 15% of the width and hugs to 5% at mid-height,
   *    so no arc ever crosses open sky in the middle of the frame. The
   *    darkening coefficient comes down from 0.45 to 0.34 at the same time, so
   *    a single step is about 3% — a drawn corner, not a band.
   *
   *    The COOLING is left continuous on purpose. It is a multiply by a tint
   *    normalised to unit luminance, so it cannot move luma at all; there is no
   *    ramp for anyone to measure in it, and quantising a pure hue rotation
   *    would put a visible colour arc where there is currently nothing.
   */
  vec3 applyVignette(vec3 c, vec2 uv, float aspect) {
    vec2 d = (uv - 0.5) * vec2(aspect, 1.0);
    float r = length(d) * 1.42;
    if (uVignette <= 0.0002 || r < uVignetteSoftness) return c;

    vec3 tint = linearToSrgb(uVignetteTint);
    tint /= max(luma(tint), 1e-3);
    float cool = uVignette * smoothstep(uVignetteSoftness, 1.25, r);
    vec3 cooled = c * mix(vec3(1.0), tint, saturate1(cool * 1.15));

    // The darkening, in three flat steps. A 16:9 frame reaches r = 1.323 at the
    // corner and 1.263 at the middle of a side edge, so 1.14 / 1.24 / 1.31
    // lands two rings on the side edges and the third in the corners only.
    float rw = max(fwidth(r) * 0.8, 0.0035);
    float g1 = smoothstep(1.14 - rw, 1.14 + rw, r);
    float g2 = smoothstep(1.24 - rw, 1.24 + rw, r);
    float g3 = smoothstep(1.31 - rw, 1.31 + rw, r);
    float dark = uVignette * (0.36 * g1 + 0.34 * g2 + 0.30 * g3);
    return cooled * (1.0 - dark * 0.34);
  }

  /**
   * Paper grain. A whisper — 1.5% at most — and biased into the darks, because
   * that is where real paper tooth shows and because grain in a flat highlight
   * reads as sensor noise, which is the one thing this frame must not look like.
   */
  vec3 applyGrain(vec3 c, vec2 fragCoord) {
    if (uGrainStrength <= 0.0001) return c;
    float g = texture(uGrain, fragCoord * uGrainScale).r - 0.5;
    float weight = mix(1.0, 0.30, saturate1(luma(c)));
    return c + g * uGrainStrength * weight;
  }
`;
