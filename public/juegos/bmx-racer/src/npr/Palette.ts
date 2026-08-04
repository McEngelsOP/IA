/**
 * Palette — the one committed art direction, in one file.
 *
 * DIRECTION: "dawn-gold alpine". Low warm sun raking across the mountain from
 * the east-southeast, cool violet-slate shadows (never grey, never black), and
 * a teal-shifted haze stacking the far ridges into flat paper layers.
 *
 * Rules this file enforces on the rest of the project:
 *
 *  1. No material invents its own colours. Every band colour in the game is a
 *     constant declared here. If a shader needs a colour, it comes from a
 *     preset below or it does not ship.
 *  2. Shadows are chromatic. The dark band of every ramp is a desaturated,
 *     hue-rotated cousin of its lit band, pushed toward VIOLET_SHADOW — not a
 *     multiply toward black. This is the single biggest difference between
 *     "cel shader" and "cel painting".
 *  3. Lit bands are warmer and slightly desaturated at the top end, so the
 *     brightest band reads as sunlight rather than as saturated pigment.
 *  4. Every ramp is 3 or 4 hard steps. Never a gradient. Never a smoothstep
 *     between bands wider than the anti-aliasing width.
 *
 * Colours are authored in sRGB hex (what you'd pick in a paint program) and
 * converted once at load. Do not hand-author linear values.
 */

import { Color, SRGBColorSpace, Vector3 } from 'three';

/** Author in sRGB hex; three converts to working space on assignment. */
function c(hex: number): Color {
  return new Color().setHex(hex, SRGBColorSpace);
}

// ── Key light ────────────────────────────────────────────────────────────────
// Low dawn sun. Elevation ~22°, azimuth from the east-southeast so it rakes
// across the descent line and throws long shadows down the fall line.
export const SUN_ELEVATION_DEG = 21.5;
export const SUN_AZIMUTH_DEG = 116;

export const SUN_DIRECTION = (() => {
  const el = (SUN_ELEVATION_DEG * Math.PI) / 180;
  const az = (SUN_AZIMUTH_DEG * Math.PI) / 180;
  // Direction the light travels FROM (i.e. toward the sun).
  return new Vector3(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)).normalize();
})();

export const SUN_COLOR = c(0xffd9a0);          // warm gold, not white
export const SUN_RIM_COLOR = c(0xfff0cf);      // slightly hotter for rim/spec
export const SKY_BOUNCE = c(0x8fa9d8);         // cool skylight filling shadow
export const GROUND_BOUNCE = c(0xa8845c);      // warm dirt bounce into undersides
export const VIOLET_SHADOW = c(0x4a3f6b);      // the shadow hue everything leans to
export const INK = c(0x1d1626);                // outline ink — near-black violet, never #000

// ── Sky ──────────────────────────────────────────────────────────────────────
export const SKY = {
  zenith: c(0x3f6bb5),
  upper: c(0x74a6d9),
  horizon: c(0xf0cf9e),
  belowHorizon: c(0xc99a72),
  sunDisc: c(0xfff6e0),
  sunGlow: c(0xffcf8a),
  cloudLit: c(0xfff5e2),
  cloudMid: c(0xe4d3e8),
  cloudShadow: c(0x9d92c4),
  /** Height in world units where the dome's horizon band sits. */
  horizonSharpness: 7.5,
};

// ── Quantised atmospheric depth ──────────────────────────────────────────────
// Four discrete haze layers. Far ridges snap between these instead of blending,
// which is what makes a wide shot read as stacked paper cut-outs.
export const FOG_BANDS = {
  count: 4,
  // Boundaries land at 40%, 63% and 82% of the near..far span after the
  // pow(t, 0.78) curve. With near=180/far=2600 that put them at 560 m, 1175 m
  // and 1855 m — while a typical composition here occupies 200-900 m, so every
  // pixel in frame sat on plateau 0 and there was nothing to step between.
  // Removing the continuous multiply was necessary but not sufficient: the
  // plateaus also have to be REACHABLE from where the camera actually stands.
  near: 45,
  far: 1150,
  /**
   * Colours from nearest band to furthest. Each step must be a visible jump.
   * These used to differ by ~9/255 per step, which is invisible even across a
   * hard boundary. They now brighten and shift teal with distance, which is
   * both real aerial perspective and the thing that makes a far ridge read as
   * a separate sheet of paper laid behind the one in front of it.
   */
  colors: [c(0xa9bed6), c(0xb4cbe0), c(0xc0d7e8), c(0xcce2ef)],
  /**
   * How much each band flattens toward its colour: 0 = clear, 1 = fully hazed.
   *
   * BAND 0 MUST BE ZERO. It is the plateau that covers everything from the
   * lens to the first boundary, so any strength in it is haze applied at point
   * blank. It used to be 0.16, and the continuous `t` multiply in
   * applyQuantizedFog hid that by fading it out near the camera — but that
   * multiply also swept the four plateaus back into a gradient, which is the
   * bug it was removed for. Removing it exposed the real one: 16% of a cool
   * blue was being laid over ground three metres from the camera.
   *
   * Measured on the bike-detail trail with fog forced off versus on: hue 359
   * and 24% saturation became hue 20 and 47%, against an authored 27 and 45%.
   * The entire "the palette has rotated to dusk-pink" finding across four
   * critic passes was this one number.
   */
  strengths: [0.0, 0.34, 0.66, 0.92],
  /** Extra warmth injected on the sun side of each band. */
  sunTint: c(0xffd5a3),
  sunTintStrength: 0.35,
};

// ── Ramp presets ─────────────────────────────────────────────────────────────
/**
 * A cel ramp: 3 or 4 hard bands with explicit thresholds on N·L.
 * `thresholds[i]` is where band i+1 begins. Length = colors.length - 1.
 */
export interface RampPreset {
  name: string;
  colors: Color[];
  thresholds: number[];
  /** Anti-alias width at the band edge, in N·L units. Keep tiny — 0.005–0.02. */
  edgeSoftness: number;
  /** Specular: 0 disables. Bands the highlight into a hard shape. */
  specStrength: number;
  specPower: number;
  specColor: Color;
  /** Fresnel rim: strength, exponent, colour. */
  rimStrength: number;
  rimPower: number;
  rimColor: Color;
  /** Hatch overlay opacity inside the darkest band. 0 = flat shadow. */
  hatchStrength: number;
  /** Hatch pattern scale multiplier (screen-space). */
  hatchScale: number;
  /** Outline hull thickness in world units at 1m from camera. 0 = no hull. */
  outlineWidth: number;
  /** Outline colour — usually INK, occasionally a tinted ink for foliage. */
  outlineColor: Color;
}

const defaults = {
  edgeSoftness: 0.012,
  specStrength: 0,
  specPower: 32,
  specColor: SUN_RIM_COLOR,
  rimStrength: 0,
  rimPower: 3.0,
  rimColor: SUN_RIM_COLOR,
  hatchStrength: 0.0,
  hatchScale: 1.0,
  outlineWidth: 0.0,
  outlineColor: INK,
};

function ramp(p: Partial<RampPreset> & Pick<RampPreset, 'name' | 'colors' | 'thresholds'>): RampPreset {
  return { ...defaults, ...p } as RampPreset;
}

/**
 * Every surface class in the game. Each is tuned independently — the whole
 * point of the brief is that rock does not respond to light the way skin does.
 *
 * Reading a ramp: colors[0] is the deepest shadow, last is the hottest light.
 * Thresholds are N·L values (0 = terminator, 1 = facing the sun).
 */
export const RAMPS = {
  // ── Terrain zones ──────────────────────────────────────────────────────────
  /** Exposed granite at the summit. Cool, high contrast, hard terminator. */
  rock: ramp({
    name: 'rock',
    colors: [c(0x3e3854), c(0x6a6180), c(0x9c93a8), c(0xc4b9bd)],
    thresholds: [0.06, 0.34, 0.68],
    edgeSoftness: 0.008,
    specStrength: 0.18,
    specPower: 48,
    hatchStrength: 0.22,
    hatchScale: 1.15,
  }),

  /** Packed trail dirt. Warm, mid-contrast, the surface you look at most. */
  dirt: ramp({
    name: 'dirt',
    colors: [c(0x54385a), c(0x8a5a4a), c(0xb8825a), c(0xd9a878)],
    thresholds: [0.08, 0.36, 0.72],
    edgeSoftness: 0.014,
    hatchStrength: 0.18,
  }),

  /** Alpine grass. Ghibli green — pushed toward emerald, high chroma. */
  grass: ramp({
    name: 'grass',
    colors: [c(0x2c4a4a), c(0x3f7a52), c(0x6faa54), c(0xa8ce6a)],
    thresholds: [0.05, 0.30, 0.66],
    edgeSoftness: 0.010,
    hatchStrength: 0.14,
    hatchScale: 1.4,
  }),

  /** Loose scree. Desaturated, bright, almost no shadow detail — reads as slip. */
  scree: ramp({
    name: 'scree',
    colors: [c(0x4d4560), c(0x7c7089), c(0xa79aa4), c(0xcabfbe)],
    thresholds: [0.10, 0.40, 0.74],
    edgeSoftness: 0.010,
    hatchStrength: 0.26,
    hatchScale: 0.85,
  }),

  /** Summit snow. Only three bands — snow has no mid-tone, that's the look. */
  snow: ramp({
    name: 'snow',
    colors: [c(0x8b9cd4), c(0xd6dbf0), c(0xfffdf6)],
    thresholds: [0.14, 0.52],
    edgeSoftness: 0.007,
    specStrength: 0.42,
    specPower: 90,
    hatchStrength: 0.10,
  }),

  /** Stream bed — wet rock. Dark, and the only terrain with a real highlight. */
  wetRock: ramp({
    name: 'wetRock',
    colors: [c(0x2a2c46), c(0x44506b), c(0x6b7a92), c(0x93a3ad)],
    thresholds: [0.08, 0.34, 0.70],
    edgeSoftness: 0.008,
    specStrength: 0.85,
    specPower: 120,
    hatchStrength: 0.20,
  }),

  /** Flowing water surface. */
  water: ramp({
    name: 'water',
    colors: [c(0x36567e), c(0x5b8bb0), c(0x9fd0dd), c(0xe6fbff)],
    thresholds: [0.20, 0.55, 0.82],
    edgeSoftness: 0.006,
    specStrength: 1.0,
    /**
     * REACHABLE exponents, not physical ones.
     *
     * These were 160 and 4, and on this course they are unreachable: with the
     * committed sun at 21.5 degrees and the chase camera looking down about 25,
     * N.H on level water tops out near 0.4 — and pow(0.4, 160) is zero to every
     * float in the machine. The Fresnel was similarly starved at N.V ~ 0.42
     * against a 0.42 threshold. The water carried a full specular and rim
     * declaration that could never produce a single lit pixel, which is why the
     * stream bed rendered as a flat painted puddle.
     *
     * A cel highlight is a drawn shape, not a microfacet distribution. It only
     * has to land where a painter would put it.
     */
    specPower: 4,
    rimStrength: 0.3,
    rimPower: 1.6,
  }),

  // ── Vegetation ─────────────────────────────────────────────────────────────
  /** Conifer canopy. Deep, saturated, with a tinted ink so it doesn't go muddy. */
  foliage: ramp({
    name: 'foliage',
    colors: [c(0x1f3a3c), c(0x2f6047), c(0x4d8c4c), c(0x82b85a)],
    thresholds: [0.04, 0.26, 0.62],
    edgeSoftness: 0.009,
    hatchStrength: 0.16,
    hatchScale: 1.6,
    outlineWidth: 0.020,
    outlineColor: c(0x16282e),
  }),

  /** Trunks and branches. */
  bark: ramp({
    name: 'bark',
    colors: [c(0x30253c), c(0x533c44), c(0x77574f), c(0x9a7660)],
    thresholds: [0.08, 0.38, 0.74],
    outlineWidth: 0.016,
  }),

  /** Grass tufts and wildflowers — brighter, so they pop off the terrain. */
  tuft: ramp({
    name: 'tuft',
    colors: [c(0x35604b), c(0x5a9a55), c(0x8dc264), c(0xc2e087)],
    thresholds: [0.06, 0.34, 0.70],
    edgeSoftness: 0.010,
  }),

  // ── The rider ──────────────────────────────────────────────────────────────
  /** Skin. Warm, only three bands, soft-ish terminator — never as hard as rock. */
  skin: ramp({
    name: 'skin',
    colors: [c(0x8a5560), c(0xd08d72), c(0xf5c39c)],
    thresholds: [0.16, 0.54],
    edgeSoftness: 0.026,
    rimStrength: 0.55,
    rimPower: 2.6,
    outlineWidth: 0.0060,
  }),

  /** Jersey — the player's colour. Saturated, four bands, crisp. */
  jerseyPlayer: ramp({
    name: 'jerseyPlayer',
    colors: [c(0x4a2340), c(0x9c3050), c(0xe0574c), c(0xff9a5c)],
    thresholds: [0.08, 0.36, 0.72],
    edgeSoftness: 0.010,
    rimStrength: 0.75,
    rimPower: 2.8,
    hatchStrength: 0.20,
    outlineWidth: 0.0075,
  }),

  /** Denim / trousers. */
  cloth: ramp({
    name: 'cloth',
    colors: [c(0x2c2b4e), c(0x414672), c(0x5d6795), c(0x8390b8)],
    thresholds: [0.10, 0.40, 0.76],
    edgeSoftness: 0.014,
    rimStrength: 0.45,
    rimPower: 3.0,
    hatchStrength: 0.22,
    outlineWidth: 0.0070,
  }),

  /** Helmet shell — glossy, hard banded highlight. */
  helmet: ramp({
    name: 'helmet',
    colors: [c(0x2b2440), c(0x4d4266), c(0x7d6f94), c(0xb6a8bf)],
    thresholds: [0.10, 0.40, 0.74],
    edgeSoftness: 0.006,
    // Reachable, and bounded below the bloom threshold.
    //
    // specPower 140 produced a smooth gradient bloom — the one thing on the
    // rider that read as PBR. And GRADE.bloomThreshold is 0.82 with the core
    // tier contributing 0.75x strength on a 0.55 base, so anything above about
    // 0.33 gets pushed straight back through the bloom pass and softens again.
    specStrength: 0.26,
    specPower: 16,
    rimStrength: 0.85,
    rimPower: 3.2,
    outlineWidth: 0.0080,
  }),

  /** Goggle lens — near-mirror, driven entirely by matcap + rim. */
  lens: ramp({
    name: 'lens',
    colors: [c(0x21304a), c(0x3b6a86), c(0x7fc0c4)],
    thresholds: [0.20, 0.58],
    edgeSoftness: 0.005,
    specStrength: 1.0,
    specPower: 200,
    rimStrength: 1.0,
    rimPower: 2.2,
    outlineWidth: 0.0050,
  }),

  /** Gloves, grips, shoes — matte rubber. */
  rubber: ramp({
    name: 'rubber',
    colors: [c(0x231d30), c(0x36304a), c(0x4c4560), c(0x67607a)],
    thresholds: [0.12, 0.44, 0.80],
    edgeSoftness: 0.012,
    rimStrength: 0.40,
    rimPower: 3.4,
    outlineWidth: 0.0060,
  }),

  // ── The bike ───────────────────────────────────────────────────────────────
  /** Anodised frame. Hard specular streak — this is where metal reads. */
  frame: ramp({
    name: 'frame',
    colors: [c(0x2a2140), c(0x53306a), c(0x8a4488), c(0xd0709a)],
    thresholds: [0.10, 0.40, 0.74],
    edgeSoftness: 0.006,
    specStrength: 1.0,
    specPower: 170,
    rimStrength: 0.9,
    rimPower: 3.0,
    outlineWidth: 0.0075,
  }),

  /** Raw / polished metal — forks, cranks, spokes. Matcap-driven. */
  metal: ramp({
    name: 'metal',
    colors: [c(0x2e2a42), c(0x5b5872), c(0x928fa4), c(0xd8d4dd)],
    thresholds: [0.08, 0.36, 0.70],
    edgeSoftness: 0.005,
    specStrength: 1.0,
    specPower: 220,
    rimStrength: 0.95,
    rimPower: 2.6,
    outlineWidth: 0.0065,
  }),

  /** Tyre rubber — matte, dark, wide dark band so the wheel reads as a shape. */
  tyre: ramp({
    name: 'tyre',
    colors: [c(0x1c1826), c(0x2c2738), c(0x413a50), c(0x5a5069)],
    thresholds: [0.16, 0.52, 0.84],
    edgeSoftness: 0.010,
    rimStrength: 0.55,
    rimPower: 3.6,
    outlineWidth: 0.0075,
  }),

  // ── Course furniture ───────────────────────────────────────────────────────
  /** Trail ribbon surface — a warmer, more worn variant of dirt. */
  trail: ramp({
    name: 'trail',
    colors: [c(0x5a3a56), c(0x94604a), c(0xc08a5c), c(0xe2b47f)],
    thresholds: [0.08, 0.34, 0.70],
    edgeSoftness: 0.014,
    hatchStrength: 0.16,
  }),

  /** Course markers, gates, flags — high chroma so they read at distance. */
  marker: ramp({
    name: 'marker',
    colors: [c(0x7a2340), c(0xd93f52), c(0xff7a5e), c(0xffc27a)],
    thresholds: [0.10, 0.42, 0.78],
    edgeSoftness: 0.008,
    rimStrength: 0.5,
    outlineWidth: 0.012,
  }),

  /** Timber — bridge planks, ramp lips, fence rails. */
  wood: ramp({
    name: 'wood',
    colors: [c(0x3a2a3e), c(0x6b4740), c(0x96694c), c(0xbb8f66)],
    thresholds: [0.08, 0.38, 0.74],
    outlineWidth: 0.010,
  }),
} as const satisfies Record<string, RampPreset>;

export type RampName = keyof typeof RAMPS;

// ── Rider identity colours ───────────────────────────────────────────────────
/**
 * Four riders must be instantly distinguishable at 200m in silhouette-plus-hue.
 * These hues are chosen to sit at the corners of the palette so no two ever
 * read the same against grass, rock, or snow.
 */
export const RIDER_COLORS = [
  { key: 'player', jersey: c(0xe0574c), accent: c(0xff9a5c), frame: c(0x8a4488), name: 'YOU' },
  { key: 'kestrel', jersey: c(0x3f9ad9), accent: c(0x7fd8e8), frame: c(0x2f6f9c), name: 'KESTREL' },
  { key: 'mags', jersey: c(0xf2c14e), accent: c(0xfff0a8), frame: c(0xb8862c), name: 'MAGS' },
  { key: 'okoye', jersey: c(0x74c96b), accent: c(0xc6f095), frame: c(0x3d8a52), name: 'OKOYE' },
] as const;

// ── HUD ──────────────────────────────────────────────────────────────────────
export const HUD_PALETTE = {
  ink: c(0x1d1626),
  inkSoft: c(0x2f2540),
  paper: c(0xf6ead2),
  paperDim: c(0xd9c6a8),
  gold: c(0xf2c14e),
  goldHot: c(0xffe6a0),
  red: c(0xe0574c),
  teal: c(0x5fc9c4),
  violet: c(0x8a6fc4),
  boost: c(0xff9a5c),
  boostFull: c(0xfff0a8),
  shadow: c(0x2a2136),
};

// ── Bloom & grade ────────────────────────────────────────────────────────────
export const GRADE = {
  /** Hard threshold — only the hottest band and speculars bloom. Graphic, not soft. */
  bloomThreshold: 0.82,
  bloomKnee: 0.06,
  bloomIntensity: 0.62,
  bloomRadius: 1.25,

  /** LUT construction. See LUT.ts — these drive the generated grade. */
  lift: new Vector3(0.012, 0.006, 0.028),      // crush toward violet, not black
  gamma: new Vector3(0.98, 1.0, 1.04),
  gain: new Vector3(1.06, 1.0, 0.94),          // warm the highlights
  saturation: 1.14,
  /** Split-tone: shadows toward violet, highlights toward gold. */
  shadowTint: c(0x5b4a86),
  highlightTint: c(0xffd9a0),
  splitStrength: 0.22,
  /** Slight contrast S-curve pivot. */
  contrast: 1.12,
  contrastPivot: 0.46,
  /** Vignette — subtle, keeps the eye on the trail. */
  vignetteStrength: 0.28,
  vignetteSoftness: 0.55,
};

// ── Line work ────────────────────────────────────────────────────────────────
export const LINES = {
  /** Screen-space thickness the hull outline should hold, in device pixels. */
  targetPixels: 2.15,
  /** Hull width falls off past this distance so far objects don't go blobby. */
  distanceFalloffStart: 42,
  distanceFalloffEnd: 340,
  /** Minimum hull width multiplier at max distance. */
  minWidthScale: 0.30,

  /** How strongly curvature thickens the stroke. 0 = uniform, 1 = very variable. */
  curvatureWeight: 0.55,
  /** Curvature below this thins the line (flat areas → thin stroke). */
  curvatureFloor: 0.18,

  /** Sobel interior lines. */
  sobelNormalThreshold: 0.32,
  sobelNormalKnee: 0.22,
  sobelDepthThreshold: 0.0016,
  sobelDepthKnee: 0.0030,
  sobelIdThreshold: 0.5,
  sobelStrength: 0.86,
  /**
   * CONTOUR ink — the silhouette edge, as distinct from interior creases.
   *
   * It needs its own fade because terrain carries no inverted hull, so the
   * contour term is the ONLY thing that can ink a ridgeline. Sharing the
   * interior fade (120-700 m) scaled every ridge in the game to exactly zero,
   * since every ridgeline worth drawing is further away than that. The floor
   * matters as much as the range: a 2 km ridge should be a LIGHTER stroke,
   * never no stroke.
   */
  contourFadeStart: 700,
  contourFadeEnd: 4200,
  contourFloor: 0.46,
  contourStrength: 0.98,
  /**
   * How much haze is allowed to wash out the silhouette stroke.
   *
   * At the previous 0.30 a fully detected ridge arrived at sRGB luminance 85
   * against skies of 160-170 — a 33-point contrast that reads as a hairline
   * dropping in and out rather than as a drawn edge. Distance must lighten the
   * stroke through PRESSURE (contourFloor), which is what a pen does, not
   * through hue, which is what a photograph does.
   */
  contourFogCap: 0.12,
  /**
   * PEN PRESSURE. `pow(interior, 1/weight)` is the IDENTITY when interior is
   * 1.0, and every edge detector ends in a smoothstep that saturates — so on a
   * faceted solid four facet edges of dihedral 27-55 degrees all inked at
   * 0.85-0.91 and the rock read as a wireframe. That is why curvatureWeight and
   * curvatureFloor appeared to thin nothing: they were being handed a saturated
   * input. Pressure now comes from the SIZE of the fold rather than from a
   * saturated detector, and `pow` keeps only the width shoulder it was ever
   * good for.
   */
  pressureRange: [0.45, 1.05] as [number, number],
  /** Normal turn / depth step, as a multiple of the crease threshold. */
  pressureFold: [0.95, 2.66] as [number, number],
  /**
   * CORROBORATION. The terrain prepass writes its normal from the BLURRED
   * normal map (so the Sobel matches the paint) and its depth from the
   * rasteriser — the two channels describe different surfaces. A depth step on
   * painted terrain is therefore a self-occlusion contour, not a crease, unless
   * the paint's own normal turns with it.
   */
  corroboration: [0.34, 1.0] as [number, number],
  /**
   * DISTANCE IDENTITY. `RIDER_COLORS` promises riders are "instantly
   * distinguishable at 200 m in silhouette-plus-hue", and a plain Fresnel rim
   * plus fog cannot keep that promise: below about 40 px the rim collapses and
   * the grade desaturates the jersey toward the terrain.
   *
   * `fullPx` is the apparent size above which nothing is applied; `floorPx` is
   * where the floors reach full strength. The rim exponent is deliberately
   * OPEN (1.15, not the 0.85 that reads best up close) because measurement
   * showed the tighter rim was a NET LOSS below 25 px — a 15 px jersey is 24
   * pixels and a 23%-of-radius rim spent a third of them on cream, costing more
   * chroma than the floor recovered.
   */
  identityFullPx: 150,
  identityFloorPx: 14,
  identityChroma: 0.72,
  identityRim: 0.9,
  identityRimExponent: 1.15,
  identityInkFloor: 0.30,
  /**
   * Crease-detector scale invariance, in normal-difference per unit of
   * world-space span across a pixel. The normal Sobel had no scale invariance
   * at all: at a raking angle one pixel covers metres of ground, so a perfectly
   * flat plane produced a large normal difference and the detector inked
   * concentric arcs across uncreased terrain.
   */
  creaseRadius: 0.22,
  /**
   * Depth-comparison slack in half-float ulps. Below this the depth detector is
   * measuring quantisation noise rather than geometry.
   */
  depthQuantUlps: 2.2,

  /** Interior lines fade with distance so far geometry doesn't turn into noise. */
  sobelFadeStart: 120,
  sobelFadeEnd: 700,
  /**
   * Where the hull already drew ink, the Sobel pass is suppressed by this much.
   * Without it the two systems stack and silhouettes go muddy black.
   */
  hullSuppression: 0.85,
};
