/**
 * Heightfield — the noise stack, the corridor prior, and the feature carving.
 *
 * The mountain is built in three distinct acts, and the order matters more than
 * any individual layer:
 *
 *   1. NOISE STACK (this file, `buildBaseHeightfield`)
 *      A domain-warped massif whose large-scale profile is *literally* the
 *      course descent profile, plus ridged multifractal crests, billow
 *      foothills, and two tiers of detail. This produces a mountain-shaped
 *      lump that is nowhere near good enough to ship on its own.
 *
 *   2. EROSION (Erosion.ts)
 *      Hydraulic droplets, then thermal talus relaxation. This is what turns
 *      the lump into a mountain: gullies on the flanks, sharpened ridgelines,
 *      alluvial fans where the gullies meet flat ground.
 *
 *   3. FEATURE CARVING (this file, `carveFeatures`)
 *      The ravine, the tabletop, the narrowed ridge, the stream. These are
 *      authored gameplay geometry and are carved LAST, because erosion would
 *      silt up a ravine and round off a jump lip, and "the jump eroded away"
 *      is not a debuggable failure mode.
 *
 * The corridor prior deserves its own note, because it is the one place where
 * terrain and course are genuinely coupled and the obvious implementation is
 * wrong.
 *
 * The obvious implementation is: find the nearest point on the route, look up
 * the target height, and lerp the terrain toward it inside some radius. That
 * fails in two specific ways. First, the nearest-point parameter is
 * discontinuous along the medial axis between two switchback legs, so two
 * adjacent legs 60m apart pull toward heights 15m different and you get a wall
 * down the middle. Second, lerping the *whole* field toward a smooth target
 * flattens everything inside the radius, which is exactly the bulldozed-ramp
 * read we are trying to avoid.
 *
 * So instead: the target height is a *kernel-weighted average* over every route
 * sample within 200m (smooth by construction, no medial-axis seam), the blend
 * only touches the LOW-FREQUENCY part of the stack (detail passes through at
 * full strength), the pull tops out at 78% rather than 100%, and then erosion
 * runs over the result and cuts real gullies across it.
 */

import { Noise2D } from '../core/Noise';
import { Rng } from '../core/RNG';
import { clamp, clamp01, lerp, smoothstep } from '../core/MathX';
import {
  HEIGHTMAP_SIZE,
  METRES_PER_SAMPLE,
  ROUTE,
  SUMMIT_HEIGHT,
  TERRAIN_FEATURES,
  VALLEY_HEIGHT,
  WORLD_HALF,
  corridorHeightAt,
  makeRouteFrame,
  routeAt,
  routeDistanceOf,
  tabletopGeometry,
  tabletopProfile,
} from '../game/WorldConstants';
import { SurfaceKind } from '../game/Contracts';

// ─────────────────────────────────────────────────────────────────────────────
// Grid helpers. Every field in the terrain system is a size² Float32Array in
// row-major (iz * size + ix) order, covering [-WORLD_HALF, +WORLD_HALF).
// ─────────────────────────────────────────────────────────────────────────────

export const GRID_SIZE = HEIGHTMAP_SIZE;

/** World X of grid column ix. */
export function gridToWorld(i: number): number {
  return -WORLD_HALF + i * METRES_PER_SAMPLE;
}

/** Fractional grid coordinate of a world X (or Z). */
export function worldToGrid(v: number): number {
  return (v + WORLD_HALF) / METRES_PER_SAMPLE;
}

/**
 * Allocation-free clamped bilinear fetch. This is on the physics hot path
 * (four wheels × 120Hz × several probes each), so it takes raw numbers, keeps
 * every temporary in a local, and never touches the heap.
 */
export function bilinearSample(field: Float32Array, size: number, gx: number, gz: number): number {
  const x = gx < 0 ? 0 : gx > size - 1.0001 ? size - 1.0001 : gx;
  const z = gz < 0 ? 0 : gz > size - 1.0001 ? size - 1.0001 : gz;
  const x0 = x | 0;
  const z0 = z | 0;
  const fx = x - x0;
  const fz = z - z0;
  const i0 = z0 * size + x0;
  const i1 = i0 + size;
  const h00 = field[i0];
  const h10 = field[i0 + 1];
  const h01 = field[i1];
  const h11 = field[i1 + 1];
  const a = h00 + (h10 - h00) * fx;
  const b = h01 + (h11 - h01) * fx;
  return a + (b - a) * fz;
}

/** Nearest-texel fetch for the integer-valued fields (zone ids). */
export function nearestSample(field: Uint8Array, size: number, gx: number, gz: number): number {
  const x = clamp(Math.round(gx), 0, size - 1);
  const z = clamp(Math.round(gz), 0, size - 1);
  return field[z * size + x];
}

/** Cooperative yield so the boot bar can animate during a long generation. */
export function yieldFrame(): Promise<void> {
  return new Promise<void>((res) => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => res());
    else setTimeout(res, 0);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// The descent profile, tabulated.
// ─────────────────────────────────────────────────────────────────────────────
/**
 * `corridorHeightAt` integrates a 512-step profile on every call. Called four
 * million times that is minutes of pure integration, so it is tabulated once.
 */
const PROFILE_STEPS = 1024;
const PROFILE_LUT = (() => {
  const t = new Float32Array(PROFILE_STEPS + 1);
  for (let i = 0; i <= PROFILE_STEPS; i++) t[i] = corridorHeightAt(i / PROFILE_STEPS);
  return t;
})();

/** Descent profile height at normalised route progress, linearly interpolated. */
export function profileAtT(t: number): number {
  const f = clamp01(t) * PROFILE_STEPS;
  const i = f | 0;
  const k = f - i;
  const a = PROFILE_LUT[i];
  const b = PROFILE_LUT[Math.min(i + 1, PROFILE_STEPS)];
  return a + (b - a) * k;
}

// ─────────────────────────────────────────────────────────────────────────────
// Route geometry
// ─────────────────────────────────────────────────────────────────────────────

export interface RouteSamples {
  x: Float32Array;
  z: Float32Array;
  /** Normalised arc-length progress 0..1. */
  t: Float32Array;
  /** Unit tangent, XZ. */
  tx: Float32Array;
  tz: Float32Array;
  count: number;
  length: number;
}

/**
 * Centripetal Catmull-Rom through the route controls.
 *
 * Uniform Catmull-Rom overshoots badly on the tight switchback triples (three
 * control points inside 90m with a near-180° direction change), which would put
 * the corridor prior — and therefore the rideable band — outside the corner.
 * The centripetal parameterisation is cusp- and loop-free by construction.
 */
function centripetalCR(
  p0x: number, p0z: number,
  p1x: number, p1z: number,
  p2x: number, p2z: number,
  p3x: number, p3z: number,
  s: number,
  out: { x: number; z: number },
): void {
  const d = (ax: number, az: number, bx: number, bz: number): number =>
    Math.max(Math.pow(Math.hypot(bx - ax, bz - az), 0.5), 1e-4);

  const t0 = 0;
  const t1 = t0 + d(p0x, p0z, p1x, p1z);
  const t2 = t1 + d(p1x, p1z, p2x, p2z);
  const t3 = t2 + d(p2x, p2z, p3x, p3z);
  const t = t1 + (t2 - t1) * s;

  const a1x = ((t1 - t) * p0x + (t - t0) * p1x) / (t1 - t0);
  const a1z = ((t1 - t) * p0z + (t - t0) * p1z) / (t1 - t0);
  const a2x = ((t2 - t) * p1x + (t - t1) * p2x) / (t2 - t1);
  const a2z = ((t2 - t) * p1z + (t - t1) * p2z) / (t2 - t1);
  const a3x = ((t3 - t) * p2x + (t - t2) * p3x) / (t3 - t2);
  const a3z = ((t3 - t) * p2z + (t - t2) * p3z) / (t3 - t2);

  const b1x = ((t2 - t) * a1x + (t - t0) * a2x) / (t2 - t0);
  const b1z = ((t2 - t) * a1z + (t - t0) * a2z) / (t2 - t0);
  const b2x = ((t3 - t) * a2x + (t - t1) * a3x) / (t3 - t1);
  const b2z = ((t3 - t) * a2z + (t - t1) * a3z) / (t3 - t1);

  out.x = ((t2 - t) * b1x + (t - t1) * b2x) / (t2 - t1);
  out.z = ((t2 - t) * b1z + (t - t1) * b2z) / (t2 - t1);
}

const _crOut = { x: 0, z: 0 };

/**
 * Resample the route spline at a roughly fixed arc-length spacing and tabulate
 * normalised progress. The terrain only ever needs the centreline — widths,
 * banks and sections are the track builder's business.
 */
export function buildRouteSamples(spacing = 4): RouteSamples {
  const n = ROUTE.length;
  const px = (i: number): number => ROUTE[clamp(i, 0, n - 1)].x;
  const pz = (i: number): number => ROUTE[clamp(i, 0, n - 1)].z;

  // Phantom endpoints by reflection so the spline starts and ends on the
  // first and last control point with a sensible tangent.
  const cx = (i: number): number => (i < 0 ? 2 * px(0) - px(1) : i > n - 1 ? 2 * px(n - 1) - px(n - 2) : px(i));
  const cz = (i: number): number => (i < 0 ? 2 * pz(0) - pz(1) : i > n - 1 ? 2 * pz(n - 1) - pz(n - 2) : pz(i));

  const xs: number[] = [];
  const zs: number[] = [];

  for (let i = 0; i < n - 1; i++) {
    const segLen = Math.hypot(px(i + 1) - px(i), pz(i + 1) - pz(i));
    // Oversample generously — the arc-length pass below fixes the spacing.
    const steps = Math.max(4, Math.ceil((segLen / spacing) * 2.2));
    for (let k = 0; k < steps; k++) {
      centripetalCR(cx(i - 1), cz(i - 1), cx(i), cz(i), cx(i + 1), cz(i + 1), cx(i + 2), cz(i + 2), k / steps, _crOut);
      xs.push(_crOut.x);
      zs.push(_crOut.z);
    }
  }
  xs.push(px(n - 1));
  zs.push(pz(n - 1));

  // Cumulative arc length, then resample to uniform spacing.
  const cum = new Float64Array(xs.length);
  for (let i = 1; i < xs.length; i++) {
    cum[i] = cum[i - 1] + Math.hypot(xs[i] - xs[i - 1], zs[i] - zs[i - 1]);
  }
  const total = cum[cum.length - 1];
  const count = Math.max(2, Math.round(total / spacing) + 1);

  const ox = new Float32Array(count);
  const oz = new Float32Array(count);
  const ot = new Float32Array(count);
  const otx = new Float32Array(count);
  const otz = new Float32Array(count);

  let cursor = 0;
  for (let i = 0; i < count; i++) {
    const target = (i / (count - 1)) * total;
    while (cursor < cum.length - 2 && cum[cursor + 1] < target) cursor++;
    const span = Math.max(cum[cursor + 1] - cum[cursor], 1e-6);
    const k = clamp01((target - cum[cursor]) / span);
    ox[i] = lerp(xs[cursor], xs[cursor + 1], k);
    oz[i] = lerp(zs[cursor], zs[cursor + 1], k);
    ot[i] = i / (count - 1);
  }
  for (let i = 0; i < count; i++) {
    const a = Math.max(0, i - 1);
    const b = Math.min(count - 1, i + 1);
    const dx = ox[b] - ox[a];
    const dz = oz[b] - oz[a];
    const l = Math.max(Math.hypot(dx, dz), 1e-6);
    otx[i] = dx / l;
    otz[i] = dz / l;
  }

  return { x: ox, z: oz, t: ot, tx: otx, tz: otz, count, length: total };
}

// ─────────────────────────────────────────────────────────────────────────────
// The corridor prior field
// ─────────────────────────────────────────────────────────────────────────────

export interface CorridorField {
  /** Distance in metres to the route centreline, capped at CORRIDOR_MAX. */
  dist: Float32Array;
  /** Kernel-weighted descent-profile height. Only meaningful where dist < max. */
  targetHeight: Float32Array;
  /** Kernel-weighted route progress 0..1. Used by zones and scatter. */
  progress: Float32Array;
}

/** Beyond this the corridor prior contributes nothing at all. */
export const CORRIDOR_MAX = 240;
/** Inside this the pull is at full strength. */
export const CORRIDOR_CORE = 100;
/** Kernel support for the smooth target-height average. */
const CORRIDOR_KERNEL = 210;
/** Peak strength of the pull. Deliberately not 1 — see the file header. */
const CORRIDOR_PULL = 0.78;

/**
 * Splat the route into three fields: distance, smooth target height, and smooth
 * route progress.
 *
 * Splatting outward from the route (rather than searching inward from every
 * texel) means the cost is proportional to the corridor area, not the world
 * area — about 6% of the map — and it gives the kernel-weighted average for
 * free, which is what removes the switchback medial-axis seam.
 */
export function buildCorridorField(route: RouteSamples, size: number): CorridorField {
  const dist = new Float32Array(size * size).fill(CORRIDOR_MAX);
  const targetHeight = new Float32Array(size * size);
  const progress = new Float32Array(size * size);
  const sumW = new Float32Array(size * size);
  const sumWH = new Float32Array(size * size);
  const sumWT = new Float32Array(size * size);

  const R = CORRIDOR_KERNEL;
  const R2 = R * R;
  // Resolution-relative, not METRES_PER_SAMPLE: this field is also built at
  // reduced resolution for headless tests and for the low-detail preset, and a
  // hard-coded 2m spacing would splat the corridor thousands of texels off the
  // route and leave every corridor-gated query reading "nowhere near the trail".
  const mps = (WORLD_HALF * 2) / size;
  const w2g = (v: number): number => (v + WORLD_HALF) / mps;
  const g2w = (i: number): number => -WORLD_HALF + i * mps;
  const rTexels = Math.ceil(R / mps);

  // Splat every ~10m of route. Any finer is wasted: the kernel is 210m wide.
  const stride = Math.max(1, Math.round(10 / (route.length / (route.count - 1))));

  for (let s = 0; s < route.count; s += stride) {
    const rx = route.x[s];
    const rz = route.z[s];
    const rt = route.t[s];
    const rh = profileAtT(rt);

    const gcx = w2g(rx);
    const gcz = w2g(rz);
    const ix0 = Math.max(0, Math.floor(gcx) - rTexels);
    const ix1 = Math.min(size - 1, Math.ceil(gcx) + rTexels);
    const iz0 = Math.max(0, Math.floor(gcz) - rTexels);
    const iz1 = Math.min(size - 1, Math.ceil(gcz) + rTexels);

    for (let iz = iz0; iz <= iz1; iz++) {
      const wz = g2w(iz) - rz;
      const wz2 = wz * wz;
      const row = iz * size;
      for (let ix = ix0; ix <= ix1; ix++) {
        const wx = g2w(ix) - rx;
        const d2 = wx * wx + wz2;
        if (d2 >= R2) continue;
        const i = row + ix;

        const d = Math.sqrt(d2);
        if (d < dist[i]) dist[i] = d;

        // Compact-support quartic kernel: smooth, C1 at the boundary, and no
        // transcendental in a 25-million-iteration loop.
        const u = 1 - d2 / R2;
        const w = u * u;
        sumW[i] += w;
        sumWH[i] += w * rh;
        sumWT[i] += w * rt;
      }
    }
  }

  for (let i = 0; i < sumW.length; i++) {
    const w = sumW[i];
    if (w > 1e-6) {
      targetHeight[i] = sumWH[i] / w;
      progress[i] = sumWT[i] / w;
    } else {
      targetHeight[i] = 0;
      progress[i] = -1;
    }
  }

  return { dist, targetHeight, progress };
}

/** Corridor blend weight at a given distance from the centreline. */
export function corridorWeight(d: number): number {
  return 1 - smoothstep(CORRIDOR_CORE, CORRIDOR_MAX, d);
}

// ─────────────────────────────────────────────────────────────────────────────
// The z → route-progress map, and the large-scale profile field
// ─────────────────────────────────────────────────────────────────────────────

const PZ_MIN = -2600;
const PZ_MAX = 2600;
const PZ_STEP = 5;
const PZ_COUNT = Math.round((PZ_MAX - PZ_MIN) / PZ_STEP) + 1;

/**
 * A table of large-scale terrain height as a function of world Z alone.
 *
 * This is the spine of the whole massif, and the reason it exists is worth
 * stating: the route's Z coordinate happens to be strictly monotonic from the
 * summit to the finish (checked against ROUTE — every control point advances in
 * Z). That means route progress is a well-defined function of Z, so the massif
 * can be built from the *same* descent profile the corridor prior pulls toward.
 *
 * The consequence is that the corridor prior almost never has to move the
 * ground: the free noise stack already sits at roughly the right elevation
 * along the whole course. All the prior does is correct the noise's local
 * deviation. That is the difference between a corridor that reads as terrain
 * and one that reads as a bulldozed ramp — the ramp is only visible when the
 * prior is doing a lot of work.
 */
function buildProfileZTable(route: RouteSamples): Float32Array {
  const table = new Float32Array(PZ_COUNT);
  const zStart = route.z[0];
  const zEnd = route.z[route.count - 1];

  let cursor = 0;
  for (let i = 0; i < PZ_COUNT; i++) {
    const z = PZ_MIN + i * PZ_STEP;

    if (z <= zStart) {
      // Above the start gate the mountain keeps climbing to its real summit.
      table[i] = SUMMIT_HEIGHT + 158 * smoothstep(0, 620, zStart - z);
      continue;
    }
    if (z >= zEnd) {
      // Past the finish the valley floor keeps falling away, gently.
      table[i] = VALLEY_HEIGHT - 26 * smoothstep(0, 700, z - zEnd);
      continue;
    }

    while (cursor < route.count - 2 && route.z[cursor + 1] < z) cursor++;
    const span = Math.max(route.z[cursor + 1] - route.z[cursor], 1e-6);
    const k = clamp01((z - route.z[cursor]) / span);
    const t = lerp(route.t[cursor], route.t[cursor + 1], k);
    table[i] = profileAtT(t);
  }
  return table;
}

function profileAtZ(table: Float32Array, z: number): number {
  const f = (z - PZ_MIN) / PZ_STEP;
  if (f <= 0) return table[0];
  if (f >= PZ_COUNT - 1) return table[PZ_COUNT - 1];
  const i = f | 0;
  const k = f - i;
  return table[i] + (table[i + 1] - table[i]) * k;
}

// ─────────────────────────────────────────────────────────────────────────────
// The noise stack
// ─────────────────────────────────────────────────────────────────────────────

export interface HeightfieldResult {
  height: Float32Array;
  corridor: CorridorField;
  route: RouteSamples;
  size: number;
}

export interface BuildOptions {
  size?: number;
  seed?: string;
  onProgress?: (frac: number) => void;
  /** Rows generated between cooperative yields. */
  chunkRows?: number;
}

/**
 * Build the pre-erosion heightfield.
 *
 * Layer inventory, each with a stated job:
 *
 *   base    — the descent profile as a function of warped Z. Gives the mountain
 *             a single coherent fall line instead of a bag of unrelated peaks.
 *   lateral — very-low-frequency fBm across the slope. Shoulders and cirques,
 *             so the fall line is not a straight chute.
 *   ridged  — ridged multifractal, masked to high altitude. This is the layer
 *             that makes the silhouette read as a mountain rather than as
 *             hills; without it the summit is a dome.
 *   billow  — absolute-value noise, masked to low altitude. Rounded foothills,
 *             which is what low ground actually looks like once it has been
 *             weathered for a few million years.
 *   detail  — two tiers of fBm for surface roughness. Erosion needs something
 *             to bite on; a perfectly smooth slope erodes into perfectly
 *             regular parallel gullies, which reads as a comb.
 *
 * Everything above `detail` is sampled through a two-level domain warp. Raw fBm
 * has a characteristic isotropic lumpiness that the eye picks out instantly;
 * warping it produces the sheared, flow-aligned structure real geology has.
 */
export async function buildBaseHeightfield(opts: BuildOptions = {}): Promise<HeightfieldResult> {
  const size = opts.size ?? GRID_SIZE;
  const seed = opts.seed ?? 'descent-mountain';
  const chunkRows = opts.chunkRows ?? 128;

  const route = buildRouteSamples(4);
  const corridor = buildCorridorField(route, size);
  const profileZ = buildProfileZTable(route);

  const nWarpA = new Noise2D(`${seed}:warpA`);
  const nWarpB = new Noise2D(`${seed}:warpB`);
  const nLateral = new Noise2D(`${seed}:lateral`);
  const nRidge = new Noise2D(`${seed}:ridge`);
  const nBillow = new Noise2D(`${seed}:billow`);
  const nDetail = new Noise2D(`${seed}:detail`);
  const nMicro = new Noise2D(`${seed}:micro`);

  const height = new Float32Array(size * size);
  const scale = size / GRID_SIZE; // so a 1024² generation still covers 4096m
  const mps = METRES_PER_SAMPLE / scale;

  for (let iz = 0; iz < size; iz++) {
    const z = -WORLD_HALF + iz * mps;
    const row = iz * size;

    for (let ix = 0; ix < size; ix++) {
      const x = -WORLD_HALF + ix * mps;

      // ── Domain warp, two levels ───────────────────────────────────────────
      // Level A is huge and slow: it bends the whole mountain's contour lines
      // so the fall line meanders instead of running dead straight down -Z.
      const wax = nWarpA.fbm(x * 0.00042, z * 0.00042, 4);
      const waz = nWarpA.fbm(x * 0.00042 + 31.7, z * 0.00042 + 13.1, 4);
      const ax = x + wax * 175;
      const az = z + waz * 175;
      // Level B is tighter and adds the swirl that reads as folded strata.
      const wbx = nWarpB.fbm(ax * 0.0016 + 5.3, az * 0.0016 + 9.1, 3);
      const wbz = nWarpB.fbm(ax * 0.0016 + 17.9, az * 0.0016 + 2.7, 3);
      const ux = ax + wbx * 52;
      const uz = az + wbz * 52;

      // ── Base descent profile ──────────────────────────────────────────────
      const base = profileAtZ(profileZ, uz);

      // Altitude masks, evaluated on the base so they are stable and cheap.
      const highMask = smoothstep(150, 470, base);
      const lowMask = 1 - smoothstep(130, 330, base);
      const relief = 0.34 + 0.66 * smoothstep(70, 460, base);

      // ── Lateral shaping ───────────────────────────────────────────────────
      const lateral = nLateral.fbm(ux * 0.00068, uz * 0.00068, 5) * 168 * relief;

      // ── Ridged multifractal: crests and spurs ─────────────────────────────
      const r = nRidge.ridged(ux * 0.00135, uz * 0.00135, 7, 2.03, 0.5, 1.0);
      const ridge = (r - 0.40) * 215 * highMask;

      // ── Billow: rounded foothills ─────────────────────────────────────────
      const bl = nBillow.billow(ux * 0.0021, uz * 0.0021, 5);
      const billow = bl * 48 * lowMask;

      // ── Detail. Kept out of the corridor blend so the trail band still has
      //    surface under it, and given to erosion as something to bite on. ───
      const d1 = nDetail.fbm(ux * 0.0090, uz * 0.0090, 5) * 10.5;
      const d2 = nMicro.fbm(x * 0.036, z * 0.036, 3) * 2.1;

      let low = base + lateral + ridge + billow;

      // ── Corridor prior ────────────────────────────────────────────────────
      const i = row + ix;
      const cw = corridorWeight(corridor.dist[i]);
      if (cw > 0.0005) {
        low = lerp(low, corridor.targetHeight[i], cw * CORRIDOR_PULL);
      }

      // Detail survives the corridor almost intact — this is what stops the
      // rideable band from reading as a poured concrete ribbon.
      let h = low + (d1 + d2) * (1 - 0.22 * cw);

      // ── Map edge ──────────────────────────────────────────────────────────
      // Calm the relief (not the profile) near the boundary so the clipmap's
      // clamp-to-edge continuation and the shader's procedural far-field hills
      // meet something quiet rather than a cliff.
      const m = Math.max(Math.abs(x), Math.abs(z));
      const edge = smoothstep(1860, WORLD_HALF, m);
      if (edge > 0) h = lerp(h, base, edge * 0.72);

      height[i] = h;
    }

    if ((iz % chunkRows) === chunkRows - 1) {
      opts.onProgress?.((iz + 1) / size);
      await yieldFrame();
    }
  }

  opts.onProgress?.(1);
  return { height, corridor, route, size };
}

// ─────────────────────────────────────────────────────────────────────────────
// Feature carving
// ─────────────────────────────────────────────────────────────────────────────

/** A half-buried boulder produced by the rock-garden carve. */
export interface CarvedBoulder {
  x: number;
  z: number;
  radius: number;
  height: number;
  rotation: number;
}

export interface CarveResult {
  /** SurfaceKind + 1 per texel, 0 = no override. Zones respects this. */
  kindOverride: Uint8Array;
  boulders: CarvedBoulder[];
  /** Texels the carve touched — erosion detail is neutralised here. */
  touched: Uint8Array;
}

/**
 * Carve the authored features into an already-eroded heightfield.
 *
 * These are gameplay geometry. They are authoritative: where a feature says the
 * ground is, the ground is. Every one of them reads the terrain first to find
 * its own reference elevation, so a feature sits *in* the mountain rather than
 * floating on an arbitrary absolute height.
 */
export function carveFeatures(
  height: Float32Array,
  size: number,
  corridor: CorridorField,
  seed = 'features',
): CarveResult {
  const kindOverride = new Uint8Array(size * size);
  const touched = new Uint8Array(size * size);
  const boulders: CarvedBoulder[] = [];
  const mps = (WORLD_HALF * 2) / size;
  const w2g = (v: number): number => (v + WORLD_HALF) / mps;
  const g2w = (i: number): number => -WORLD_HALF + i * mps;

  const rng = new Rng(seed);
  const nRough = new Noise2D(`${seed}:rough`);
  const _rf = makeRouteFrame();

  /** Iterate the texels inside a world-space AABB. */
  const forBox = (
    cx: number,
    cz: number,
    halfX: number,
    halfZ: number,
    fn: (i: number, x: number, z: number) => void,
  ): void => {
    const ix0 = clamp(Math.floor(w2g(cx - halfX)), 0, size - 1);
    const ix1 = clamp(Math.ceil(w2g(cx + halfX)), 0, size - 1);
    const iz0 = clamp(Math.floor(w2g(cz - halfZ)), 0, size - 1);
    const iz1 = clamp(Math.ceil(w2g(cz + halfZ)), 0, size - 1);
    for (let iz = iz0; iz <= iz1; iz++) {
      const z = g2w(iz);
      const row = iz * size;
      for (let ix = ix0; ix <= ix1; ix++) fn(row + ix, g2w(ix), z);
    }
  };

  /** Mean height over a disc — a feature's reference elevation. */
  const meanHeight = (cx: number, cz: number, radius: number): number => {
    let sum = 0;
    let n = 0;
    forBox(cx, cz, radius, radius, (i, x, z) => {
      const dx = x - cx;
      const dz = z - cz;
      if (dx * dx + dz * dz > radius * radius) return;
      sum += height[i];
      n++;
    });
    return n > 0 ? sum / n : 0;
  };

  const mark = (i: number, kind: SurfaceKind): void => {
    kindOverride[i] = kind + 1;
    touched[i] = 1;
  };

  for (const f of TERRAIN_FEATURES) {
    const fx = f.x ?? 0;
    const fz = f.z ?? 0;
    const p = f.params;

    switch (f.kind) {
      // ── Start plateau and finish flat ─────────────────────────────────────
      // Both are the same operation: a disc pulled toward its own mean, with a
      // generous feather so it does not read as a stamped circle.
      case 'start-plateau':
      case 'finish-flat': {
        const radius = p.radius;
        const flatness = p.flatness;
        const feather = radius * 0.9;
        const ref = meanHeight(fx, fz, radius * 0.75);
        forBox(fx, fz, radius + feather, radius + feather, (i, x, z) => {
          const d = Math.hypot(x - fx, z - fz);
          if (d > radius + feather) return;
          const w = (1 - smoothstep(radius, radius + feather, d)) * flatness;
          height[i] = lerp(height[i], ref, w);
          // The SURFACE of the two flats is not the same material, and marking
          // both as dirt was reading as a 52 m orange paint spill dropped on a
          // snowfield — the first thing the player ever sees.
          //
          // The start plateau sits at 630 m on an alpine summit: it is a scoured
          // rock bench, which is also exactly the "exposed rock technical start"
          // the course design calls for. The finish flat is on the valley floor,
          // where packed dirt is right. The override still wins over the snow
          // rule either way, which is what keeps the start clear of snow.
          //
          // Only the CORE is marked. Leaving the feathered rim unmarked lets the
          // normal altitude/slope classifier run there, so the plateau blends
          // into whatever the mountain is doing around it instead of ending at a
          // hard disc edge.
          if (w > 0.72) {
            mark(i, f.kind === 'start-plateau' ? SurfaceKind.Rock : SurfaceKind.Dirt);
          }
        });
        break;
      }

      // ── Tabletop ──────────────────────────────────────────────────────────
      // Built in the ROUTE'S OWN FRAME, on a fall line read out of the mountain.
      //
      // The two things this gets right that the previous version did not:
      //
      // 1. ORIENTATION. The mound used to run along a hardcoded (0.20, 0.98)
      //    azimuth while the route through here runs (0.097, 0.995) — 5.7
      //    degrees out, enough that the deck edge wandered 1.7 m across the
      //    racing line over its length and the "kicker" was partly a flank. The
      //    axis is now the route itself, sampled station by station, so the ramp
      //    runs along the track by construction and follows its curve.
      //
      // 2. THE REFERENCE ELEVATION. It used to be a straight lerp between two
      //    disc means 64 m apart, which is only the fall line if the mountain
      //    happens to be planar over 64 m. It is not. The reference is now the
      //    terrain's own profile along the route, laterally averaged to reject
      //    gully chatter, box-smoothed, and gradient-limited so the deck can
      //    never sit on a reference that climbs or plunges. The jump shape is
      //    then added on top of that as a pure function of route distance
      //    (`tabletopProfile`, shared with the track builder).
      //
      // The result is single-valued in XZ with a bounded gradient by
      // construction, which is the property a heightfield has to have and the
      // one the old carve broke.
      case 'tabletop': {
        const g = tabletopGeometry(f);
        // The anchor is the LIP, snapped onto the route.
        const sLip = routeDistanceOf(fx, fz);

        // ── Stations along the route, 1 m apart, spanning the whole footprint.
        const ST = 1;
        const nSt = Math.round((g.sMax - g.sMin) / ST) + 1;
        const stX = new Float64Array(nSt);
        const stZ = new Float64Array(nSt);
        const stNx = new Float64Array(nSt);
        const stNz = new Float64Array(nSt);
        const base = new Float64Array(nSt);
        for (let k = 0; k < nSt; k++) {
          routeAt(sLip + g.sMin + k * ST, _rf);
          stX[k] = _rf.x;
          stZ[k] = _rf.z;
          stNx[k] = _rf.tz;   // left-hand normal in plan
          stNz[k] = -_rf.tx;
        }

        // ── The fall line. Read BEFORE anything is written, three taps across
        //    the corridor so a gully clipping one side does not drag the deck
        //    down with it.
        for (let k = 0; k < nSt; k++) {
          let sum = 0;
          for (let t = -1; t <= 1; t++) {
            const o = t * 6;
            sum += bilinearSample(
              height, size,
              w2g(stX[k] + stNx[k] * o),
              w2g(stZ[k] + stNz[k] * o),
            );
          }
          base[k] = sum / 3;
        }
        // Box-smooth: erosion chatter under a jump is noise, not terrain.
        {
          const rad = 10;
          const tmp = base.slice();
          for (let k = 0; k < nSt; k++) {
            let sum = 0;
            let n = 0;
            for (let j = -rad; j <= rad; j++) {
              sum += tmp[clamp(k + j, 0, nSt - 1)];
              n++;
            }
            base[k] = sum / n;
          }
        }
        // Gradient limit, forward and backward and averaged. Caps the fall line
        // at 0.42 (23 degrees) and forbids it from CLIMBING at all: a jump built
        // on a rising reference points its landing ramp back up the hill, which
        // is the failure the old comment described and the old code caused.
        {
          const maxFall = 0.42 * ST;
          const fwd = base.slice();
          for (let k = 1; k < nSt; k++) {
            const d = fwd[k] - fwd[k - 1];
            if (d > 0) fwd[k] = fwd[k - 1];
            else if (d < -maxFall) fwd[k] = fwd[k - 1] - maxFall;
          }
          const bwd = base.slice();
          for (let k = nSt - 2; k >= 0; k--) {
            const d = bwd[k] - bwd[k + 1];
            if (d < 0) bwd[k] = bwd[k + 1];
            else if (d > maxFall) bwd[k] = bwd[k + 1] + maxFall;
          }
          for (let k = 0; k < nSt; k++) base[k] = (fwd[k] + bwd[k]) * 0.5;
        }

        // ── Footprint AABB from the stations themselves.
        const lateral = g.halfWidth + g.flank + 6;
        let bx0 = Infinity, bx1 = -Infinity, bz0 = Infinity, bz1 = -Infinity;
        for (let k = 0; k < nSt; k++) {
          if (stX[k] < bx0) bx0 = stX[k];
          if (stX[k] > bx1) bx1 = stX[k];
          if (stZ[k] < bz0) bz0 = stZ[k];
          if (stZ[k] > bz1) bz1 = stZ[k];
        }
        const bcx = (bx0 + bx1) * 0.5;
        const bcz = (bz0 + bz1) * 0.5;

        forBox(bcx, bcz, (bx1 - bx0) * 0.5 + lateral, (bz1 - bz0) * 0.5 + lateral, (i, x, z) => {
          // Project onto the station polyline: nearest station, then refined
          // onto the adjoining segment so `s` is continuous. A station-quantised
          // `s` would put a 1 m stair across the face.
          let bk = 0;
          let bd2 = Infinity;
          for (let k = 0; k < nSt; k++) {
            const ddx = stX[k] - x;
            const ddz = stZ[k] - z;
            const d2 = ddx * ddx + ddz * ddz;
            if (d2 < bd2) { bd2 = d2; bk = k; }
          }
          let kf = bk;
          let u = 0;
          let segD2 = Infinity;
          for (let j = -1; j <= 0; j++) {
            const a = bk + j;
            const b = a + 1;
            if (a < 0 || b >= nSt) continue;
            const sx = stX[b] - stX[a];
            const sz = stZ[b] - stZ[a];
            const l2 = sx * sx + sz * sz;
            if (l2 < 1e-12) continue;
            const t = clamp01(((x - stX[a]) * sx + (z - stZ[a]) * sz) / l2);
            const cx2 = stX[a] + sx * t;
            const cz2 = stZ[a] + sz * t;
            const d2 = (x - cx2) * (x - cx2) + (z - cz2) * (z - cz2);
            if (d2 < segD2) {
              segD2 = d2;
              kf = a + t;
              const l = Math.sqrt(l2);
              u = (x - cx2) * (sz / l) + (z - cz2) * (-sx / l);
            }
          }
          const au = Math.abs(u);
          if (au > lateral) return;

          const s = g.sMin + kf * ST;
          if (s <= g.sMin || s >= g.sMax) return;

          // Lateral fall-off: the mound has real 31 degree sides, not a cliff.
          const across = 1 - smoothstep(g.halfWidth, g.halfWidth + g.flank, au);
          // Longitudinal blend into untouched ground. The profile is already
          // zero at both ends, so this only feathers the FALL LINE correction.
          const along =
            smoothstep(g.sMin, g.sMin + g.feather, s) *
            (1 - smoothstep(g.sMax - g.feather, g.sMax, s));

          const k0 = clamp(Math.floor(kf), 0, nSt - 1);
          const k1 = Math.min(k0 + 1, nSt - 1);
          const ref = lerp(base[k0], base[k1], kf - k0);
          const add = tabletopProfile(g, s) * across;

          // Not 1: a trace of the mountain's own surface survives on the mound,
          // which is what stops a 40 x 60 m authored slab from reading as a
          // different material to the hillside it is cut into.
          const w = across * along * 0.95;
          height[i] = lerp(height[i], ref + add, w);
          if (add > 0.35 && w > 0.4) mark(i, SurfaceKind.Dirt);
        });
        break;
      }

      // ── Ravine ────────────────────────────────────────────────────────────
      // A genuine hole. 11.5m across at the lip, 26m deep, walls at ~80°. The
      // floor is V-shaped so it does not read as a trench with a concrete
      // bottom, and the rims are taken from the *pre-carve* terrain either side
      // so the gap edge is level rather than following local bumps.
      case 'ravine': {
        const halfW = p.width * 0.5;
        const depth = p.depth;
        const len = p.length;
        const ang = p.angle;
        const dirX = Math.sin(ang);
        const dirZ = Math.cos(ang);
        const nrmX = dirZ;
        const nrmZ = -dirX;
        const wall = 4.0;
        const rimAt = halfW + wall + 9;
        const reach = len * 0.5 + rimAt + 4;
        forBox(fx, fz, reach, reach, (i, x, z) => {
          const dx = x - fx;
          const dz = z - fz;
          const s = dx * dirX + dz * dirZ;
          if (Math.abs(s) > len * 0.5) return;
          const u = dx * nrmX + dz * nrmZ;
          const au = Math.abs(u);
          if (au > halfW + wall + 2) return;

          // Rim reference: the terrain a clear margin outside the cut.
          const side = u >= 0 ? 1 : -1;
          const rx = fx + dirX * s + nrmX * rimAt * side;
          const rz = fz + dirZ * s + nrmZ * rimAt * side;
          const rim = bilinearSample(height, size, w2g(rx), w2g(rz));

          // Depth profile: flat-bottomed with a V, then near-vertical walls.
          const inner = clamp01((halfW - au) / halfW);
          let cut: number;
          if (au <= halfW) {
            cut = depth - (1 - inner) * 3.5;
          } else {
            const k = clamp01((au - halfW) / wall);
            cut = (depth - 3.5) * (1 - k * k * (3 - 2 * k));
          }
          // Taper the ends so the ravine closes into the hillside.
          const endFade = 1 - smoothstep(len * 0.5 - 34, len * 0.5, Math.abs(s));
          cut *= endFade;
          if (cut <= 0.05) return;

          const target = rim - cut;
          if (target < height[i]) height[i] = target;
          mark(i, SurfaceKind.Rock);
        });
        break;
      }

      // ── Narrowed ridge ────────────────────────────────────────────────────
      // The crest is levelled to a smoothed spine and the flanks are dropped
      // hard. Exposure is the gameplay: the punishment for a wide line has to
      // be visible from the saddle, which means the drop must start within a
      // couple of metres of the ribbon edge.
      case 'ridge-narrow': {
        const len = p.length;
        const halfW = p.halfWidth;
        const drop = p.flankDrop;
        const ang = p.angle;
        const dirX = Math.sin(ang);
        const dirZ = Math.cos(ang);
        const nrmX = dirZ;
        const nrmZ = -dirX;

        // Sample the crest along the axis, then box-filter it. Without the
        // filter the "knife edge" inherits every erosion notch and reads as a
        // saw blade from side on.
        const nS = Math.ceil(len / 3) + 1;
        const crest = new Float32Array(nS);
        for (let k = 0; k < nS; k++) {
          const s = -len * 0.5 + (k / (nS - 1)) * len;
          crest[k] = bilinearSample(height, size, w2g(fx + dirX * s), w2g(fz + dirZ * s));
        }
        const crestS = new Float32Array(nS);
        const rad = 4;
        for (let k = 0; k < nS; k++) {
          let sum = 0;
          let n = 0;
          for (let j = -rad; j <= rad; j++) {
            const kk = clamp(k + j, 0, nS - 1);
            sum += crest[kk];
            n++;
          }
          crestS[k] = sum / n;
        }

        const flankReach = 62;
        const reach = len * 0.5 + flankReach + 6;
        forBox(fx, fz, reach, reach, (i, x, z) => {
          const dx = x - fx;
          const dz = z - fz;
          const s = dx * dirX + dz * dirZ;
          if (Math.abs(s) > len * 0.5) return;
          const au = Math.abs(dx * nrmX + dz * nrmZ);
          if (au > flankReach) return;

          const kf = clamp01((s + len * 0.5) / len) * (nS - 1);
          const k0 = kf | 0;
          const cH = lerp(crestS[k0], crestS[Math.min(k0 + 1, nS - 1)], kf - k0);
          const endFade = 1 - smoothstep(len * 0.5 - 55, len * 0.5, Math.abs(s));

          if (au <= halfW) {
            height[i] = lerp(height[i], cH, 0.72 * endFade);
          } else {
            const k = smoothstep(halfW, halfW + 26, au);
            const target = cH - drop * k * k;
            const blended = Math.min(height[i], target);
            height[i] = lerp(height[i], blended, endFade);
            if (au > halfW + 3) mark(i, SurfaceKind.Rock);
          }
        });
        break;
      }

      // ── Stream channel ────────────────────────────────────────────────────
      // Meandered, U-sectioned, with a flat wet floor. A straight channel reads
      // as a drainage ditch; the meander is what makes it read as water that
      // found its own way down.
      case 'stream-channel': {
        const halfW = p.width * 0.5;
        const depth = p.depth;
        const len = p.length;
        const ang = p.angle;
        const dirX = Math.sin(ang);
        const dirZ = Math.cos(ang);
        const nrmX = dirZ;
        const nrmZ = -dirX;
        const bank = 9;
        const meanderAmp = 7.5;
        const reach = len * 0.5 + halfW + bank + meanderAmp + 6;
        forBox(fx, fz, reach, reach, (i, x, z) => {
          const dx = x - fx;
          const dz = z - fz;
          const s = dx * dirX + dz * dirZ;
          if (Math.abs(s) > len * 0.5) return;
          const meander =
            Math.sin(s * 0.043) * meanderAmp + Math.sin(s * 0.017 + 1.9) * meanderAmp * 0.55;
          const u = dx * nrmX + dz * nrmZ - meander;
          const au = Math.abs(u);
          if (au > halfW + bank) return;

          const rimAt = halfW + bank + 5;
          const side = u >= 0 ? 1 : -1;
          const rim = bilinearSample(
            height,
            size,
            w2g(fx + dirX * s + nrmX * (rimAt * side + meander)),
            w2g(fz + dirZ * s + nrmZ * (rimAt * side + meander)),
          );

          const k = clamp01((au - halfW * 0.55) / (halfW * 0.45 + bank));
          const cut = depth * (1 - k * k * (3 - 2 * k));
          const endFade = 1 - smoothstep(len * 0.5 - 40, len * 0.5, Math.abs(s));
          const target = rim - cut * endFade;
          if (target < height[i]) height[i] = target;
          if (au < halfW * 0.7 && cut > depth * 0.6) mark(i, SurfaceKind.Water);
          else if (au < halfW + 2) mark(i, SurfaceKind.Rock);
        });
        break;
      }

      // ── Rock garden ───────────────────────────────────────────────────────
      // High-frequency ground roughness plus half-buried boulder domes. The
      // domes are in the HEIGHTFIELD, not just in the scatter, so the physics
      // and the visuals agree about where the rocks are — a rock garden the
      // wheels pass through is worse than no rock garden.
      case 'rock-garden': {
        const radius = p.radius;
        const rough = p.roughness;
        const count = Math.round(p.boulderCount);
        forBox(fx, fz, radius * 1.25, radius * 1.25, (i, x, z) => {
          const d = Math.hypot(x - fx, z - fz);
          if (d > radius * 1.25) return;
          const w = 1 - smoothstep(radius * 0.72, radius * 1.25, d);
          if (w <= 0.001) return;
          const n1 = nRough.fbm(x * 0.16, z * 0.16, 3);
          const n2 = nRough.ridged(x * 0.34 + 11, z * 0.34 + 7, 2, 2.0, 0.5, 1.0);
          height[i] += (n1 * 0.62 + (n2 - 0.42) * 0.9) * rough * 1.9 * w;
          if (w > 0.4) mark(i, SurfaceKind.Rock);
        });
        // Boulders, placed on a jittered ring pattern so they clump the way
        // real rockfall does instead of spreading evenly.
        for (let b = 0; b < count; b++) {
          const a = rng.next() * Math.PI * 2;
          const rr = radius * Math.sqrt(rng.next()) * 0.94;
          const bx = fx + Math.cos(a) * rr;
          const bz = fz + Math.sin(a) * rr;
          const br = rng.range(0.9, 2.6);
          const bh = br * rng.range(0.5, 0.95);
          boulders.push({ x: bx, z: bz, radius: br, height: bh, rotation: rng.next() * Math.PI * 2 });
          forBox(bx, bz, br * 1.4, br * 1.4, (i, x, z) => {
            const d = Math.hypot(x - bx, z - bz);
            if (d > br * 1.4) return;
            const k = clamp01(1 - d / br);
            // Ellipsoid cap, not a cone — the shoulder is what makes a rock
            // catch a wheel instead of ramping it.
            height[i] += bh * Math.sqrt(Math.max(0, k)) * (1 - smoothstep(br, br * 1.4, d));
            mark(i, SurfaceKind.Rock);
          });
        }
        break;
      }

      // ── Berm bowl (unused by the current feature list, kept complete) ─────
      case 'berm-bowl': {
        const radius = p.radius ?? 20;
        const depth = p.depth ?? 3;
        const ref = meanHeight(fx, fz, radius);
        forBox(fx, fz, radius, radius, (i, x, z) => {
          const d = Math.hypot(x - fx, z - fz);
          if (d > radius) return;
          const k = 1 - d / radius;
          height[i] = lerp(height[i], ref - depth * k * k, k);
          mark(i, SurfaceKind.Dirt);
        });
        break;
      }
    }
  }

  // Feathering pass: one 3-tap blur restricted to the boundary of the carved
  // regions. Without it the ravine rim and the ridge flanks meet the eroded
  // terrain on a hard texel step, and that step becomes a visible ring of
  // interior Sobel line in the render.
  const boundary: number[] = [];
  for (let iz = 1; iz < size - 1; iz++) {
    const row = iz * size;
    for (let ix = 1; ix < size - 1; ix++) {
      const i = row + ix;
      const t = touched[i];
      if (
        t !== touched[i - 1] || t !== touched[i + 1] ||
        t !== touched[i - size] || t !== touched[i + size]
      ) {
        boundary.push(i);
      }
    }
  }
  for (const i of boundary) {
    height[i] =
      height[i] * 0.5 +
      (height[i - 1] + height[i + 1] + height[i - size] + height[i + size]) * 0.125;
  }

  return { kindOverride, boulders, touched };
}

/**
 * Blur the erosion signal inside carved features. Erosion ran before carving,
 * so its deposition map still claims there is silt in the middle of the ravine
 * and scree on the tabletop deck; both would place scree geometry on authored
 * gameplay surfaces.
 */
export function neutraliseErosionInFeatures(
  erosion: Float32Array,
  touched: Uint8Array,
): void {
  for (let i = 0; i < erosion.length; i++) {
    if (touched[i]) erosion[i] *= 0.15;
  }
}

/** Min/max of a field, for reporting and for the material's height ramp. */
export function fieldRange(field: Float32Array): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < field.length; i++) {
    const v = field[i];
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return { min, max };
}
