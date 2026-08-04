/**
 * Zones — what the ground is MADE of, decided once, on the CPU, with hard edges.
 *
 * The art direction has one non-negotiable rule about terrain materials: there
 * are no blends. A cel background painter does not airbrush grass into scree;
 * they draw a line and change the paint. Every zone boundary in this game is a
 * hard step between two completely different ramps.
 *
 * That is easy to say and easy to get wrong in three separate ways:
 *
 *  1. A hard threshold on altitude alone draws a CONTOUR LINE across the
 *     mountain. Perfectly horizontal, perfectly smooth, instantly readable as a
 *     computer artefact. The fix is to perturb the boundary with low-frequency
 *     noise — but the perturbation has to be large (tens of metres of effective
 *     altitude) or it just makes the contour wobble rather than dissolve, and
 *     each boundary needs its OWN noise field or all of them wobble in lockstep
 *     and the mountain reads as a stack of displaced contours.
 *
 *  2. A hard threshold on a noisy input produces salt-and-pepper speckle where
 *     the input hovers near the threshold. Speckle is worse than a smooth blend:
 *     it aliases, it shimmers under camera motion, and it reads as noise rather
 *     than as material. A single majority filter at the end removes isolated
 *     texels without touching genuine boundaries.
 *
 *  3. A 2m-resolution zone map sampled with NearestFilter has 2m staircase
 *     edges. At 5m from the camera that is unmistakable pixelation. The CPU
 *     classification here is only responsible for the LARGE-scale shape of each
 *     boundary; the sub-texel raggedness is added in the fragment shader, which
 *     jitters the zone lookup by a couple of texels of high-frequency noise.
 *     Between the two, a boundary is irregular at every scale and still hard.
 *
 * Inputs are altitude, slope, and the erosion map. Erosion matters more than it
 * sounds: it is the only input that knows about DRAINAGE, so it is what puts
 * bedrock in the bottom of a gully and loose scree on the fan below it, which
 * is the difference between a mountain that has weather and one that has been
 * painted by altitude.
 */

import {
  ClampToEdgeWrapping,
  DataTexture,
  NearestFilter,
  NearestMipmapNearestFilter,
  RedFormat,
  UnsignedByteType,
} from 'three';

import { Noise2D } from '../core/Noise';
import { SurfaceKind } from '../game/Contracts';
import { WORLD_HALF, WORLD_SIZE, ZONE } from '../game/WorldConstants';
import { SUN_DIRECTION } from '../npr/Palette';
import { clamp, clamp01 } from '../core/MathX';
import type { CorridorField } from './Heightfield';

/** SurfaceKind has 7 members; every per-zone uniform array is this long. */
export const ZONE_KIND_COUNT = 7;

/** Slope is stored as a byte over [0, PI/2]. 0.35 degrees per step is plenty. */
export const SLOPE_QUANT = Math.PI / 2 / 255;

export interface ZoneField {
  /** One SurfaceKind per texel, row-major (iz * size + ix). */
  zone: Uint8Array;
  size: number;
  /** Texel count per SurfaceKind — reported at boot, used to sanity-check. */
  counts: Int32Array;
  /** R8, NearestFilter. Sampled by the terrain material. */
  texture: DataTexture;
}

export interface ClassifyOptions {
  height: Float32Array;
  /** Byte slope field from `computeSlopeField`. */
  slope: Uint8Array;
  /** Normalised erosion map, roughly [-1, 1]. Negative = cut, positive = fill. */
  erosion: Float32Array;
  corridor: CorridorField;
  /** SurfaceKind + 1 per texel from `carveFeatures`; 0 = no override. */
  kindOverride: Uint8Array;
  size: number;
  seed?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Slope
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Steepest-descent slope per texel, in radians, quantised to a byte.
 *
 * Central differences rather than forward differences: a forward difference is
 * half a texel off-centre, which biases every slope in the same direction and
 * puts a systematic one-texel offset between the zone map and the geometry it
 * is supposed to describe. On a 2m grid that offset is visible along a cliff.
 */
export function computeSlopeField(height: Float32Array, size: number, cellSize: number): Uint8Array {
  const out = new Uint8Array(size * size);
  const inv2c = 1 / (2 * cellSize);
  const toByte = 255 / (Math.PI / 2);

  for (let iz = 0; iz < size; iz++) {
    const row = iz * size;
    const rowUp = (iz > 0 ? iz - 1 : 0) * size;
    const rowDn = (iz < size - 1 ? iz + 1 : size - 1) * size;
    for (let ix = 0; ix < size; ix++) {
      const xl = ix > 0 ? ix - 1 : 0;
      const xr = ix < size - 1 ? ix + 1 : size - 1;
      const dhdx = (height[row + xr] - height[row + xl]) * inv2c;
      const dhdz = (height[rowDn + ix] - height[rowUp + ix]) * inv2c;
      // atan of the gradient magnitude IS the slope; no need to build a normal.
      const s = Math.atan(Math.sqrt(dhdx * dhdx + dhdz * dhdz));
      out[row + ix] = clamp(Math.round(s * toByte), 0, 255);
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Coarse perturbation fields
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Boundary perturbation is low-frequency by design — the whole point is to move
 * a boundary by tens of metres of effective altitude, not to fizz it. So it is
 * evaluated on a coarse grid and bilinearly upsampled rather than being called
 * four million times. That turns ~80 million simplex evaluations into ~300,000
 * and costs nothing visually, because the field it is approximating has a
 * wavelength two orders of magnitude larger than the sample spacing.
 */
interface CoarseField {
  data: Float32Array;
  n: number;
}

function buildCoarseField(n: number, noise: Noise2D, freq: number, octaves: number): CoarseField {
  const data = new Float32Array(n * n);
  const step = WORLD_SIZE / (n - 1);
  for (let j = 0; j < n; j++) {
    const z = -WORLD_HALF + j * step;
    for (let i = 0; i < n; i++) {
      const x = -WORLD_HALF + i * step;
      data[j * n + i] = noise.fbm(x * freq, z * freq, octaves);
    }
  }
  return { data, n };
}

/** Bilinear fetch by normalised [0,1] position. Returns roughly [-1, 1]. */
function sampleCoarse(f: CoarseField, u: number, v: number): number {
  const n = f.n;
  const gx = clamp(u * (n - 1), 0, n - 1.0001);
  const gz = clamp(v * (n - 1), 0, n - 1.0001);
  const x0 = gx | 0;
  const z0 = gz | 0;
  const fx = gx - x0;
  const fz = gz - z0;
  const i0 = z0 * n + x0;
  const i1 = i0 + n;
  const a = f.data[i0] + (f.data[i0 + 1] - f.data[i0]) * fx;
  const b = f.data[i1] + (f.data[i1 + 1] - f.data[i1]) * fx;
  return a + (b - a) * fz;
}

// ─────────────────────────────────────────────────────────────────────────────
// Classification
// ─────────────────────────────────────────────────────────────────────────────

/** How much effective altitude the coarse and mid noise fields can shift a boundary. */
const PERTURB_COARSE_M = 34;
const PERTURB_MID_M = 11;

/**
 * Snow scour, expressed as metres of effective altitude the ground LOSES.
 *
 * Snow does not lie evenly on a mountain, and treating the snow line as a pure
 * altitude threshold is what produces the tell-tale white blanket with a
 * contour-shaped bottom edge. Two things strip it:
 *
 *  - SLOPE. Anything steep sheds its own load. Over roughly 30° a face holds
 *    almost nothing, which is why real summits read as dark rock ribs with
 *    white packed into the gullies BETWEEN them — the exact silhouette this
 *    game's wide shots need, and the reason the technical start can be
 *    "exposed rock" while still sitting at 630 m.
 *  - ASPECT. The sun-facing side melts out first. With the committed sun in
 *    the east-southeast this scours the whole eastern flank and leaves the
 *    western bowls white, which also happens to put the snow where the frame
 *    is already in shadow.
 */
const SNOW_SLOPE_SHED_M = 210;
const SNOW_ASPECT_MELT_M = 58;

/**
 * Box-blur radius, in texels, applied to the snow rule's INPUTS.
 *
 * The scour rule above is correct physics and it was producing leprosy: the
 * summit rendered as hundreds of small white blotches with fringed, torn
 * perimeters scattered over lavender scree, reading as mould rather than as
 * drifts. The reason is that it was evaluated per texel against a per-texel
 * height. Slope on a 2 m grid is a HIGH-FREQUENCY field — it flips several
 * hundred metres of effective altitude between one texel and the next on any
 * broken ground — and aspect, which comes from a raw central difference, is
 * worse. Thresholding either produces speckle by construction, and the
 * despeckle pass at the end can only remove islands of one and two texels; a
 * five-texel blotch survives it intact and there were thousands of them.
 *
 * Blurring the INPUTS rather than the resulting mask is the difference between
 * "is this hillside steep" and "is this texel steep", and only the first of
 * those is a question about where snow lies. At 2 m per texel a radius of 7,
 * twice, integrates over roughly a fifty-metre neighbourhood — a slope face,
 * not a bump — and the boundary that falls out is a long, readable curve that
 * the shader's own jitter can then fray.
 *
 * The snow test also reads a BLURRED height for the same reason. Everything
 * else in the classifier keeps the sharp one: a snow line is a weather
 * boundary, whereas a rock band is a fact about the specific texel.
 */
const SNOW_SMOOTH_RADIUS = 7;
const SNOW_SMOOTH_PASSES = 2;

/**
 * The same argument, one step further — and the sentence above about a rock
 * band being "a fact about the specific texel" was the last place this bug
 * was still living.
 *
 * A character map of the zone field over the far wall of the valley, one
 * glyph per texel, came back as a fifty-fifty INTERLEAVE of rock and scree
 * covering thousands of texels:
 *
 *     RRRRssRRRsRssRsRsRsRsssRsRRssssssRRRRRRRss
 *     RRRRRRRsRRRsRRsRssssssssssRRsRsRssRsRsRRRR
 *
 * That is not a material boundary. It is a threshold being applied to a field
 * that is noisier than the threshold's own margin: `slope` comes from a
 * central difference on a 2 m grid, so on any face whose average gradient
 * happens to sit near the scree angle it crosses back and forth between every
 * adjacent pair of texels. Both kinds then paint almost the same lavender at
 * 300 m, so the FILL is invisible — but the outline pass inks every one of
 * those thousands of tiny islands, and the far slopes rendered as a maze of
 * hairline polygons laid over flat snow. Disabling the zone ID channel in the
 * prepass removed the maze completely and left a clean painted hillside,
 * which is what identified it.
 *
 * Despeckle cannot fix this: it removes islands of one and two texels, and a
 * dither field is made of islands that each have a neighbour of their own
 * kind. The threshold has to stop being asked a question the data cannot
 * answer. A radius of 4 twice integrates over about a twenty-five metre
 * neighbourhood — big enough to be a slope face, small enough that a genuine
 * cliff band twenty metres wide still clears the angle.
 *
 * The PERTURBATION stays sharp-edged and is what keeps the resulting boundary
 * from looking smoothed: pSlope is a coarse field, so it displaces the whole
 * boundary in long wanders rather than fraying it per texel.
 */
const FORM_SMOOTH_RADIUS = 4;
const FORM_SMOOTH_PASSES = 2;

/** The sun's horizontal bearing, normalised. Read once from the palette. */
const SUN_HORIZ_LEN = Math.hypot(SUN_DIRECTION.x, SUN_DIRECTION.z) || 1;
const SUN_HORIZ_X = SUN_DIRECTION.x / SUN_HORIZ_LEN;
const SUN_HORIZ_Z = SUN_DIRECTION.z / SUN_HORIZ_LEN;
/** Slope perturbation, radians. Keeps the "always rock" cliff cut irregular. */
const PERTURB_SLOPE_RAD = 0.11;

/**
 * Classify every texel of the mountain into a SurfaceKind.
 *
 * Order of authority, highest first:
 *   1. Authored feature overrides (the ravine walls, the stream floor, the rock
 *      garden). These are gameplay geometry — if the carve says rock, it is rock.
 *   2. Slope. A face steeper than the repose angle cannot hold soil, at any
 *      altitude, and this is the rule that puts rock bands on ridge flanks.
 *   3. Erosion. Deeply cut ground exposes bedrock; deposition fans are loose.
 *   4. Altitude bands, perturbed.
 *   5. The trail apron — a narrow band of worn ground either side of the route,
 *      but only where the ground was grass. Worn scree is still scree.
 */
export function classifyZones(o: ClassifyOptions): ZoneField {
  const { height, slope, erosion, corridor, kindOverride, size } = o;
  const seed = o.seed ?? 'zones';

  const zone = new Uint8Array(size * size);

  // Four independent perturbation fields. Independent is the point: if the
  // grass/dirt boundary and the dirt/rock boundary shared a noise field they
  // would deform identically and the mountain would read as a set of parallel
  // displaced contour lines, which is exactly the artefact we are removing.
  const pLow = buildCoarseField(192, new Noise2D(`${seed}:low`), 0.00085, 4);
  const pMid = buildCoarseField(384, new Noise2D(`${seed}:mid`), 0.0042, 3);
  const pRock = buildCoarseField(192, new Noise2D(`${seed}:rockline`), 0.0011, 4);
  const pSnow = buildCoarseField(192, new Noise2D(`${seed}:snowline`), 0.00072, 4);
  const pSlope = buildCoarseField(256, new Noise2D(`${seed}:slope`), 0.0026, 3);
  const pApron = buildCoarseField(256, new Noise2D(`${seed}:apron`), 0.0031, 3);

  // The erosion map is used twice in this project, and the two uses want
  // opposite things from it. The SHADER wants it raw: fine, streaky droplet
  // paths that read as gully marks, and it can afford them because the mip
  // chain filters them. The CLASSIFIER must not see them — thresholding a
  // high-frequency field is the textbook way to produce salt-and-pepper, and
  // here it manifests as a broad haze of dirt speckled through grass wherever
  // the deposition map happens to straddle the threshold. So the classifier
  // gets its own blurred copy, at a scale where "this is a fan" is a statement
  // about a hillside rather than about a droplet.
  const eroSmooth = boxBlur(erosion, size, 3, 2);

  // ── The snow rule's low-passed inputs ──────────────────────────────────────
  // See SNOW_SMOOTH_RADIUS. Slope has to be un-quantised into radians first;
  // aspect is built here rather than reused from the main loop because the main
  // loop wants the sharp version and this one must not have it.
  const slopeRad = new Float32Array(size * size);
  const sunFace = new Float32Array(size * size);
  for (let iz = 0; iz < size; iz++) {
    const row = iz * size;
    const izm = iz > 0 ? row - size : row;
    const izp = iz < size - 1 ? row + size : row;
    for (let ix = 0; ix < size; ix++) {
      slopeRad[row + ix] = slope[row + ix] * SLOPE_QUANT;
      const ixm = ix > 0 ? ix - 1 : ix;
      const ixp = ix < size - 1 ? ix + 1 : ix;
      const dhdx = height[row + ixp] - height[row + ixm];
      const dhdz = height[izp + ix] - height[izm + ix];
      const aLen = Math.hypot(dhdx, dhdz);
      // The horizontal component of the surface normal points DOWNHILL.
      sunFace[row + ix] =
        aLen > 1e-6 ? (-dhdx * SUN_HORIZ_X + -dhdz * SUN_HORIZ_Z) / aLen : 0;
    }
  }
  const slopeSnow = boxBlur(slopeRad, size, SNOW_SMOOTH_RADIUS, SNOW_SMOOTH_PASSES);
  const aspectSnow = boxBlur(sunFace, size, SNOW_SMOOTH_RADIUS, SNOW_SMOOTH_PASSES);
  const heightSnow = boxBlur(height, size, SNOW_SMOOTH_RADIUS, SNOW_SMOOTH_PASSES);

  // The slope every OTHER rule reads. See FORM_SMOOTH_RADIUS: the raw field is
  // noisier than the margin of the angles being tested against it, which turned
  // the rock/scree boundary into a dither instead of an edge.
  const slopeForm = boxBlur(slopeRad, size, FORM_SMOOTH_RADIUS, FORM_SMOOTH_PASSES);

  const invSpan = 1 / (size - 1);

  for (let iz = 0; iz < size; iz++) {
    const row = iz * size;
    const v = iz * invSpan;
    for (let ix = 0; ix < size; ix++) {
      const i = row + ix;

      // ── 1. Authored overrides win outright ────────────────────────────────
      const ov = kindOverride[i];
      if (ov !== 0) {
        zone[i] = ov - 1;
        continue;
      }

      const u = ix * invSpan;
      const h = height[i];
      // slopeForm, not slope[i]: the low-passed field. The perturbation on top
      // is coarse and is what keeps the boundary irregular.
      const sl = slopeForm[i] + sampleCoarse(pSlope, u, v) * PERTURB_SLOPE_RAD;
      const ero = eroSmooth[i];

      // Effective altitude: the real height plus two octaves of wander. Every
      // boundary reads this, then adds its own dedicated offset on top.
      const hp =
        h + sampleCoarse(pLow, u, v) * PERTURB_COARSE_M + sampleCoarse(pMid, u, v) * PERTURB_MID_M;

      let kind: SurfaceKind;

      // ── The snow test, and ONLY the snow test, reads the low-passed fields ─
      // See SNOW_SMOOTH_RADIUS. Every term here is an assertion about a
      // hillside; every term elsewhere in this function is an assertion about a
      // texel, and mixing the two is what turned the summit into leprosy.
      const snowScour =
        slopeSnow[i] * SNOW_SLOPE_SHED_M + Math.max(0, aspectSnow[i]) * SNOW_ASPECT_MELT_M;
      const hpSnow =
        heightSnow[i] +
        sampleCoarse(pLow, u, v) * PERTURB_COARSE_M +
        sampleCoarse(pMid, u, v) * PERTURB_MID_M;

      if (sl > ZONE.rockSlopeRad + sampleCoarse(pRock, u, v) * 0.10) {
        // ── 2. Anything genuinely steep is bedrock, at every altitude ───────
        kind = SurfaceKind.Rock;
      } else if (hpSnow - snowScour > ZONE.screeTop + sampleCoarse(pSnow, u, v) * 26) {
        kind = SurfaceKind.Snow;
      } else if (hp > ZONE.rockTop) {
        kind = SurfaceKind.Scree;
      } else if (hp > ZONE.dirtTop) {
        kind = sl > ZONE.screeSlopeRad ? SurfaceKind.Scree : SurfaceKind.Rock;
      } else if (hp > ZONE.grassTop) {
        kind = sl > ZONE.screeSlopeRad ? SurfaceKind.Scree : SurfaceKind.Dirt;
      } else {
        kind = sl > ZONE.screeSlopeRad ? SurfaceKind.Dirt : SurfaceKind.Grass;
      }

      // ── 3. Erosion ────────────────────────────────────────────────────────
      if (ero < -0.42 && kind !== SurfaceKind.Snow) {
        // A gully cut this deep has taken the soil with it.
        kind = SurfaceKind.Rock;
      } else if (ero > 0.32 && sl < 0.44 && kind !== SurfaceKind.Snow) {
        // An alluvial fan. Loose above the tree line, packed dirt below it.
        //
        // Snow is exempt, and that exemption is load-bearing: a deposition fan
        // under a snowfield is still under the snow. Without the guard the fan
        // map punches warm scree blobs straight through the white, which reads
        // as spilled paint rather than as terrain.
        kind = hp > ZONE.dirtTop ? SurfaceKind.Scree : SurfaceKind.Dirt;
      }

      // ── 3b. Standing water ────────────────────────────────────────────────
      // Water is the LAST altitude rule rather than the first, and it demands
      // flat ground as well as low ground. Testing it first — the obvious
      // ordering — paints every cliff face below the water line blue, which on
      // a mountain whose valley floor sits near that line is a large fraction
      // of the visible far distance.
      if (hp < ZONE.waterLine && sl < 0.20) kind = SurfaceKind.Water;

      // ── 4. The trail apron ────────────────────────────────────────────────
      // Ground beside a trail through a meadow is worn to dirt. Ground beside a
      // trail across a scree face is still scree — riders do not compact talus.
      if (kind === SurfaceKind.Grass) {
        const apron = 6.5 + (sampleCoarse(pApron, u, v) * 0.5 + 0.5) * 8.5;
        if (corridor.dist[i] < apron) kind = SurfaceKind.Dirt;
      }

      zone[i] = kind;
    }
  }

  // Twice: one pass removes single-texel islands, the second removes the
  // two-texel pairs the first pass leaves behind. A third changes nothing.
  despeckle(zone, size);
  despeckle(zone, size);

  const counts = new Int32Array(ZONE_KIND_COUNT);
  for (let i = 0; i < zone.length; i++) counts[zone[i]]++;

  return { zone, size, counts, texture: makeZoneTexture(zone, size) };
}

/**
 * Separable box blur over a square field, `passes` times.
 *
 * Repeated box blurs converge on a Gaussian, and two passes of a small radius
 * is both cheaper and smoother than one pass of a large one.
 */
function boxBlur(src: Float32Array, size: number, radius: number, passes: number): Float32Array {
  let a = src.slice();
  let b = new Float32Array(src.length);
  const inv = 1 / (radius * 2 + 1);

  for (let p = 0; p < passes; p++) {
    // Horizontal.
    for (let iz = 0; iz < size; iz++) {
      const row = iz * size;
      let sum = 0;
      for (let k = -radius; k <= radius; k++) sum += a[row + clamp(k, 0, size - 1)];
      for (let ix = 0; ix < size; ix++) {
        b[row + ix] = sum * inv;
        sum -= a[row + clamp(ix - radius, 0, size - 1)];
        sum += a[row + clamp(ix + radius + 1, 0, size - 1)];
      }
    }
    // Vertical.
    for (let ix = 0; ix < size; ix++) {
      let sum = 0;
      for (let k = -radius; k <= radius; k++) sum += b[clamp(k, 0, size - 1) * size + ix];
      for (let iz = 0; iz < size; iz++) {
        a[iz * size + ix] = sum * inv;
        sum -= b[clamp(iz - radius, 0, size - 1) * size + ix];
        sum += b[clamp(iz + radius + 1, 0, size - 1) * size + ix];
      }
    }
  }
  b = a;
  return b;
}

/**
 * One majority pass over the 8-neighbourhood.
 *
 * Only isolated texels are replaced: a texel whose kind appears NOWHERE among
 * its eight neighbours, and where some single other kind holds at least five of
 * them. That condition is deliberately strict — it cannot erode a genuine
 * boundary (every texel on a straight boundary has at least three neighbours of
 * its own kind) but it removes every one-texel island the thresholds produced.
 */
function despeckle(zone: Uint8Array, size: number): void {
  const src = zone.slice();
  const tally = new Int32Array(ZONE_KIND_COUNT);

  for (let iz = 1; iz < size - 1; iz++) {
    const row = iz * size;
    for (let ix = 1; ix < size - 1; ix++) {
      const i = row + ix;
      const me = src[i];
      tally.fill(0);
      tally[src[i - size - 1]]++;
      tally[src[i - size]]++;
      tally[src[i - size + 1]]++;
      tally[src[i - 1]]++;
      tally[src[i + 1]]++;
      tally[src[i + size - 1]]++;
      tally[src[i + size]]++;
      tally[src[i + size + 1]]++;
      if (tally[me] !== 0) continue;

      let best = me;
      let bestN = 0;
      for (let k = 0; k < ZONE_KIND_COUNT; k++) {
        if (tally[k] > bestN) {
          bestN = tally[k];
          best = k;
        }
      }
      if (bestN >= 5) zone[i] = best;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Texture
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tie-break order for the majority filter, most durable first.
 *
 * A 2x2 block that splits two-two has no majority, and which of the two wins
 * decides what a thin feature looks like from a kilometre away. Water and trail
 * are RIBBONS one or two texels wide — the stream and the course — and if they
 * lose every tie they evaporate at the second mip level and the valley loses
 * both its river and its road. Snow and rock are the two kinds that carry the
 * mountain's silhouette. Grass and dirt are the background field and can afford
 * to give way, because there is always more of them.
 */
const MIP_PRIORITY: SurfaceKind[] = [
  SurfaceKind.Water,
  SurfaceKind.Trail,
  SurfaceKind.Snow,
  SurfaceKind.Rock,
  SurfaceKind.Scree,
  SurfaceKind.Dirt,
  SurfaceKind.Grass,
];

/**
 * A MAJORITY mip chain over the zone map.
 *
 * This is the single most important thing in this file, and it is not an
 * optimisation — it is the only way a nearest-sampled material index can
 * survive minification.
 *
 * The zone map is a 2 m grid of material INDICES. It cannot be linearly
 * filtered (halfway between rock 0 and grass 2 is dirt 1) and it cannot be
 * box-mipped for the same reason, so the shipping code sampled level 0 and
 * tried to tame the resulting aliasing by snapping the LOOKUP to a
 * power-of-two texel block sized from the screen-space derivative. That works
 * exactly until the block size hits its clamp. Past that the block is smaller
 * than a screen pixel, adjacent pixels resolve to blocks several apart, and the
 * far field breaks into hard alternating stripes of two completely different
 * ramps — the orange-and-lavender television static covering every oblique
 * slope in these frames, and, on the summit, the white stipple that made the
 * snowfields look like splatter.
 *
 * A majority filter is the correct reduction for an index field: it answers
 * "what is this hillside made of" rather than "what is the average of these
 * four material numbers", which is a meaningless question. Each level is the
 * modal kind of its 2x2 parent, ties broken by MIP_PRIORITY, so a stream stays
 * a stream all the way out and a snowfield minifies into a single flat shape
 * with a drawn edge instead of dissolving into pepper.
 *
 * The chain is built lazily off `texture.version` (see makeZoneTexture) so the
 * track carve, which rewrites texels and sets needsUpdate, cannot leave the
 * coarse levels describing the mountain as it was before the trail was cut.
 */
export function buildZoneMips(
  zone: Uint8Array,
  size: number,
): { data: Uint8Array; width: number; height: number }[] {
  const levels: { data: Uint8Array; width: number; height: number }[] = [
    { data: zone, width: size, height: size },
  ];

  const rank = new Int32Array(ZONE_KIND_COUNT);
  for (let r = 0; r < MIP_PRIORITY.length; r++) rank[MIP_PRIORITY[r]] = r;

  let src = zone;
  let n = size;
  while (n > 1) {
    const m = n >> 1;
    const dst = new Uint8Array(m * m);
    for (let z = 0; z < m; z++) {
      const r0 = (z * 2) * n;
      const r1 = r0 + n;
      const drow = z * m;
      for (let x = 0; x < m; x++) {
        const x0 = x * 2;
        const a = src[r0 + x0];
        const b = src[r0 + x0 + 1];
        const c = src[r1 + x0];
        const d = src[r1 + x0 + 1];

        // Four samples: the mode is decided by hand rather than with a tally
        // array, because this loop runs about five and a half million times at
        // boot and an Int32Array.fill() per texel is most of that cost.
        let best = a;
        let bestN = 1;
        // a's count
        let cn = 1 + (b === a ? 1 : 0) + (c === a ? 1 : 0) + (d === a ? 1 : 0);
        bestN = cn;
        if (b !== a) {
          cn = 1 + (c === b ? 1 : 0) + (d === b ? 1 : 0);
          if (cn > bestN || (cn === bestN && rank[b] < rank[best])) {
            best = b;
            bestN = cn;
          }
        }
        if (c !== a && c !== b) {
          cn = 1 + (d === c ? 1 : 0);
          if (cn > bestN || (cn === bestN && rank[c] < rank[best])) {
            best = c;
            bestN = cn;
          }
        }
        if (d !== a && d !== b && d !== c) {
          if (1 > bestN || (1 === bestN && rank[d] < rank[best])) {
            best = d;
            bestN = 1;
          }
        }
        dst[drow + x] = best;
      }
    }
    levels.push({ data: dst, width: m, height: m });
    src = dst;
    n = m;
  }
  return levels;
}

/**
 * The shader-samplable zone map, with its majority mip chain attached.
 *
 * NearestMipmapNearest and NEVER a linear filter in either direction:
 * interpolating a material INDEX is meaningless — halfway between rock (0) and
 * grass (2) is dirt (1), so a linear filter would draw a one-texel stripe of
 * dirt along every rock/grass boundary in the world. The mip chain is not
 * three's (which is a box filter, and therefore that same average by another
 * name) but the majority chain above, uploaded by hand.
 *
 * `mipmaps` is an ACCESSOR keyed to the texture's own version counter. three
 * reads it once per upload, and the only writer of the zone field —
 * `applyTrackCarve` — signals its edits the only way three understands, by
 * setting needsUpdate. Rebuilding on read is therefore the one place that
 * cannot be forgotten, and it costs nothing on the frames where nothing
 * changed.
 */
export function makeZoneTexture(zone: Uint8Array, size: number): DataTexture {
  const tex = new DataTexture(zone, size, size, RedFormat, UnsignedByteType);
  tex.minFilter = NearestMipmapNearestFilter;
  tex.magFilter = NearestFilter;
  tex.wrapS = ClampToEdgeWrapping;
  tex.wrapT = ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.flipY = false;
  tex.name = 'terrain:zone';

  let built = -1;
  let chain: { data: Uint8Array; width: number; height: number }[] = [];
  Object.defineProperty(tex, 'mipmaps', {
    configurable: true,
    get(): { data: Uint8Array; width: number; height: number }[] {
      if (built !== tex.version) {
        chain = buildZoneMips(zone, size);
        built = tex.version;
      }
      return chain;
    },
    set(): void {
      /* three assigns [] in the Texture constructor and on copy; ignored. */
    },
  });

  tex.needsUpdate = true;
  return tex;
}

/** Deepest mip level of the zone chain — log2(size). The shader clamps to it. */
export function zoneMipLevels(size: number): number {
  return Math.round(Math.log2(size));
}

// ─────────────────────────────────────────────────────────────────────────────
// Queries and edits
// ─────────────────────────────────────────────────────────────────────────────

/** Nearest-texel zone lookup by fractional grid coordinate. */
export function zoneAtGrid(field: ZoneField, gx: number, gz: number): SurfaceKind {
  const x = clamp(Math.round(gx), 0, field.size - 1);
  const z = clamp(Math.round(gz), 0, field.size - 1);
  return field.zone[z * field.size + x] as SurfaceKind;
}

/**
 * Stamp a kind into a world-space disc. Used by `applyTrackCarve` to mark the
 * corridor under the ribbon as Trail so the physics reports trail grip even
 * where a wheel drops off the mesh edge onto the carved ground.
 */
export function stampZoneDisc(
  field: ZoneField,
  cx: number,
  cz: number,
  radius: number,
  kind: SurfaceKind,
): void {
  const size = field.size;
  const mps = WORLD_SIZE / size;
  const w2g = (v: number): number => (v + WORLD_HALF) / mps;
  const g2w = (i: number): number => -WORLD_HALF + i * mps;

  const ix0 = clamp(Math.floor(w2g(cx - radius)), 0, size - 1);
  const ix1 = clamp(Math.ceil(w2g(cx + radius)), 0, size - 1);
  const iz0 = clamp(Math.floor(w2g(cz - radius)), 0, size - 1);
  const iz1 = clamp(Math.ceil(w2g(cz + radius)), 0, size - 1);
  const r2 = radius * radius;

  for (let iz = iz0; iz <= iz1; iz++) {
    const dz = g2w(iz) - cz;
    const row = iz * size;
    for (let ix = ix0; ix <= ix1; ix++) {
      const dx = g2w(ix) - cx;
      if (dx * dx + dz * dz > r2) continue;
      field.zone[row + ix] = kind;
    }
  }
}

/** Human-readable zone census, for the boot log. */
export function describeZones(field: ZoneField): string {
  const names = ['rock', 'dirt', 'grass', 'scree', 'snow', 'water', 'trail'];
  const total = field.size * field.size;
  const parts: string[] = [];
  for (let k = 0; k < ZONE_KIND_COUNT; k++) {
    const pct = (field.counts[k] / total) * 100;
    if (pct >= 0.05) parts.push(`${names[k]} ${pct.toFixed(1)}%`);
  }
  return parts.join(', ');
}

/** Clamp a normalised coverage fraction — used by the scatter density fields. */
export function zoneCoverage(field: ZoneField, kind: SurfaceKind): number {
  return clamp01(field.counts[kind] / (field.size * field.size));
}
