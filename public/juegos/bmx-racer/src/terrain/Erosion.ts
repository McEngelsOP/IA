/**
 * Erosion — droplet hydraulic simulation plus thermal talus relaxation.
 *
 * This is the single highest-value pass in the terrain system and it is worth
 * being explicit about why. Every fractal noise function ever written produces
 * terrain with the same tell: the drainage is wrong. Ridges do not converge on
 * valleys, valleys do not accumulate into larger valleys, and slopes have the
 * same statistical roughness at the top and the bottom. The eye reads that as
 * "computer generated" instantly, without being able to say why.
 *
 * Water fixes all three at once, and it does it by simulation rather than by
 * pastiche. A droplet accelerates downhill, picks up sediment in proportion to
 * how fast it is moving and how steep the ground is, and drops that sediment
 * the moment the ground flattens out. Run enough of them and you get:
 *
 *   • gullies that converge downhill into larger gullies,
 *   • ridgelines sharpened by the gullies eating in from both sides,
 *   • alluvial fans where a gully meets flat ground,
 *   • and smooth, silt-filled hollows where noise left a random pit.
 *
 * The thermal pass afterwards handles what water does not: dry rock does not
 * stand at 70°. Material above the angle of repose slides until the slope
 * settles, which is what gives scree slopes their characteristic constant
 * gradient and stops the render from being full of noise-steep spikes.
 *
 * Both passes also produce the EROSION MAP: a signed per-texel record of how
 * much material left (negative) or arrived (positive). The terrain material
 * uses it to place scree in the gullies and to darken the deposited fans, and
 * the scatter uses it to keep trees off freshly-cut ground. That map is a large
 * part of why the result reads as eroded rather than merely bumpy — the shading
 * agrees with the shape.
 */

import { Rng } from '../core/RNG';
import { clamp01 } from '../core/MathX';

export interface HydraulicParams {
  /** Droplet count. Budget: cost is linear in this. */
  droplets: number;
  /** Maximum steps before a droplet is retired. */
  maxLifetime: number;
  /** 0 = follows the gradient exactly, 1 = ignores it. Low values meander. */
  inertia: number;
  /** Sediment capacity per unit of (slope × speed × water). */
  capacity: number;
  /** Floor on capacity so a droplet on flat ground still carries something. */
  minCapacity: number;
  /** Fraction of the capacity deficit converted to erosion per step. */
  erodeSpeed: number;
  /** Fraction of the excess sediment dropped per step. */
  depositSpeed: number;
  /** Water lost per step, as a fraction. */
  evaporate: number;
  gravity: number;
  /** Erosion brush radius in texels. Prevents single-texel spikes. */
  brushRadius: number;
  /** Bias droplet spawns toward high ground, 0 = uniform. */
  altitudeBias: number;
  /** Droplets processed between cooperative yields. */
  batchSize: number;
}

export const DEFAULT_HYDRAULIC: HydraulicParams = {
  droplets: 620_000,
  maxLifetime: 74,
  inertia: 0.045,
  capacity: 5.2,
  minCapacity: 0.008,
  erodeSpeed: 0.42,
  depositSpeed: 0.32,
  evaporate: 0.0165,
  gravity: 10,
  brushRadius: 3,
  altitudeBias: 0.65,
  batchSize: 24_000,
};

export interface ThermalParams {
  /** Angle of repose in radians. Above this, material slides. */
  talusAngle: number;
  /** Passes. Each pass moves at most `rate` of the excess. */
  passes: number;
  rate: number;
  /** Above this altitude the repose angle stiffens (frozen rock, not scree). */
  rockAltitude: number;
}

export const DEFAULT_THERMAL: ThermalParams = {
  talusAngle: 0.62,
  passes: 14,
  rate: 0.42,
  rockAltitude: 430,
};

export interface ErosionResult {
  /** Signed erosion/deposition per texel, normalised to roughly [-1, 1]. */
  map: Float32Array;
  /** Raw metres moved, for reporting. */
  stats: {
    droplets: number;
    hydraulicMs: number;
    thermalMs: number;
    meanAbsDelta: number;
    maxErosion: number;
    maxDeposition: number;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// The erosion brush
// ─────────────────────────────────────────────────────────────────────────────
/**
 * A radius-weighted stamp, precomputed once.
 *
 * Applying erosion to the single texel under the droplet is the classic
 * mistake: the field develops one-texel pits that the next droplet falls into,
 * and the whole map turns into salt-and-pepper noise that no amount of
 * smoothing recovers. Spreading each erosion event over a small weighted disc
 * keeps the field continuous and lets gullies emerge as a statistical
 * consequence of many droplets rather than as individual scratches.
 */
interface Brush {
  dx: Int16Array;
  dz: Int16Array;
  w: Float32Array;
  count: number;
}

function buildBrush(radius: number): Brush {
  const dx: number[] = [];
  const dz: number[] = [];
  const w: number[] = [];
  let total = 0;
  for (let z = -radius; z <= radius; z++) {
    for (let x = -radius; x <= radius; x++) {
      const d = Math.sqrt(x * x + z * z);
      if (d > radius) continue;
      // Linear falloff. A Gaussian concentrates too much at the centre and
      // reintroduces the pitting the brush exists to prevent.
      const weight = 1 - d / radius;
      dx.push(x);
      dz.push(z);
      w.push(weight);
      total += weight;
    }
  }
  const inv = 1 / total;
  return {
    dx: Int16Array.from(dx),
    dz: Int16Array.from(dz),
    w: Float32Array.from(w, (v) => v * inv),
    count: dx.length,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Hydraulic erosion
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Run the droplet simulation in place on `height`.
 *
 * Chunked with `await` yields so the boot progress bar keeps animating; the
 * inner loop itself is a single flat function with every piece of droplet state
 * in a local, no objects, no allocation.
 */
export async function erodeHydraulic(
  height: Float32Array,
  size: number,
  erosionMap: Float32Array,
  params: Partial<HydraulicParams> = {},
  onProgress?: (frac: number) => void,
  seed = 'erosion',
): Promise<number> {
  const p: HydraulicParams = { ...DEFAULT_HYDRAULIC, ...params };
  const brush = buildBrush(p.brushRadius);
  const rng = new Rng(seed);
  const t0 = now();

  // Spawn bias field: a coarse normalised height so we can favour high ground
  // without a full CDF. Droplets born in the valley die in three steps and
  // contribute nothing but cost.
  let hMin = Infinity;
  let hMax = -Infinity;
  for (let i = 0; i < height.length; i++) {
    const v = height[i];
    if (v < hMin) hMin = v;
    if (v > hMax) hMax = v;
  }
  const hSpan = Math.max(hMax - hMin, 1e-3);

  const maxIndex = size - 2;
  const bd = brush.dx;
  const bz = brush.dz;
  const bw = brush.w;
  const bc = brush.count;

  let done = 0;
  while (done < p.droplets) {
    const end = Math.min(done + p.batchSize, p.droplets);

    for (let n = done; n < end; n++) {
      // ── Spawn ───────────────────────────────────────────────────────────
      let px = 0;
      let pz = 0;
      for (let attempt = 0; attempt < 4; attempt++) {
        px = rng.next() * maxIndex;
        pz = rng.next() * maxIndex;
        if (p.altitudeBias <= 0) break;
        const hi = ((pz | 0) * size + (px | 0)) | 0;
        const norm = (height[hi] - hMin) / hSpan;
        // Accept probability rises with altitude but never reaches zero, so
        // the foothills still get their share of drainage.
        if (rng.next() < 1 - p.altitudeBias + p.altitudeBias * norm) break;
      }

      let dirX = 0;
      let dirZ = 0;
      let speed = 1;
      let water = 1;
      let sediment = 0;

      for (let life = 0; life < p.maxLifetime; life++) {
        const nodeX = px | 0;
        const nodeZ = pz | 0;
        const cellX = px - nodeX;
        const cellZ = pz - nodeZ;
        const i0 = nodeZ * size + nodeX;
        const i1 = i0 + size;

        const h00 = height[i0];
        const h10 = height[i0 + 1];
        const h01 = height[i1];
        const h11 = height[i1 + 1];

        // Bilinear height and its analytic gradient.
        const gradX = (h10 - h00) * (1 - cellZ) + (h11 - h01) * cellZ;
        const gradZ = (h01 - h00) * (1 - cellX) + (h11 - h10) * cellX;
        const hHere =
          h00 * (1 - cellX) * (1 - cellZ) +
          h10 * cellX * (1 - cellZ) +
          h01 * (1 - cellX) * cellZ +
          h11 * cellX * cellZ;

        // Momentum: the droplet keeps some of its previous direction, which is
        // what lets it cut across a contour and carve a meander rather than
        // dropping straight down the steepest line into a single pit.
        dirX = dirX * p.inertia - gradX * (1 - p.inertia);
        dirZ = dirZ * p.inertia - gradZ * (1 - p.inertia);
        const dl = Math.sqrt(dirX * dirX + dirZ * dirZ);
        if (dl < 1e-6) break;
        dirX /= dl;
        dirZ /= dl;

        px += dirX;
        pz += dirZ;
        if (px < 1 || px >= maxIndex || pz < 1 || pz >= maxIndex) break;

        // Height at the new position.
        const nX = px | 0;
        const nZ = pz | 0;
        const fX = px - nX;
        const fZ = pz - nZ;
        const j0 = nZ * size + nX;
        const j1 = j0 + size;
        const g00 = height[j0];
        const g10 = height[j0 + 1];
        const g01 = height[j1];
        const g11 = height[j1 + 1];
        const hNew =
          g00 * (1 - fX) * (1 - fZ) + g10 * fX * (1 - fZ) + g01 * (1 - fX) * fZ + g11 * fX * fZ;

        const dh = hNew - hHere;

        const cap = Math.max(-dh * speed * water * p.capacity, p.minCapacity);

        if (sediment > cap || dh > 0) {
          // ── Deposit ─────────────────────────────────────────────────────
          // Going uphill: drop just enough to fill the step, which is what
          // builds an alluvial fan at the bottom of a gully instead of the
          // droplet climbing out the far side of a hollow.
          const amount = dh > 0 ? Math.min(dh, sediment) : (sediment - cap) * p.depositSpeed;
          sediment -= amount;
          const a00 = amount * (1 - cellX) * (1 - cellZ);
          const a10 = amount * cellX * (1 - cellZ);
          const a01 = amount * (1 - cellX) * cellZ;
          const a11 = amount * cellX * cellZ;
          height[i0] += a00;
          height[i0 + 1] += a10;
          height[i1] += a01;
          height[i1 + 1] += a11;
          erosionMap[i0] += a00;
          erosionMap[i0 + 1] += a10;
          erosionMap[i1] += a01;
          erosionMap[i1 + 1] += a11;
        } else {
          // ── Erode ───────────────────────────────────────────────────────
          // Never take more than the height difference, or the droplet digs a
          // hole under itself and the gradient inverts.
          const amount = Math.min((cap - sediment) * p.erodeSpeed, -dh);
          if (amount > 0) {
            for (let b = 0; b < bc; b++) {
              const bx = nodeX + bd[b];
              const bzz = nodeZ + bz[b];
              if (bx < 0 || bx >= size || bzz < 0 || bzz >= size) continue;
              const bi = bzz * size + bx;
              const take = amount * bw[b];
              height[bi] -= take;
              erosionMap[bi] -= take;
            }
            sediment += amount;
          }
        }

        // Speed from the drop. Clamped at zero: a droplet that has run out of
        // gravitational energy is finished, and letting speed go imaginary is
        // the classic NaN source in this algorithm.
        const sp2 = speed * speed - dh * p.gravity;
        speed = sp2 > 0 ? Math.sqrt(sp2) : 0;
        water *= 1 - p.evaporate;
        if (water < 0.01) break;
      }
    }

    done = end;
    onProgress?.(done / p.droplets);
    await yieldTick();
  }

  return now() - t0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Thermal erosion (talus relaxation)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Relax slopes steeper than the angle of repose.
 *
 * Implemented as a repeated four-neighbour redistribution rather than a
 * full eight-neighbour one: the diagonal terms cost 60% more and, over a dozen
 * passes, produce a visually identical settle because the material propagates
 * diagonally anyway. What matters is the *angle*, and that is exact in both.
 *
 * The repose angle stiffens with altitude. Loose scree on a mid-mountain flank
 * settles around 35°, but frost-shattered summit rock genuinely does stand at
 * 55-60°, and relaxing the summit to a scree angle turns a jagged peak into a
 * pyramid — which is exactly the failure mode that makes procedural mountains
 * look like sand piles.
 */
export function erodeThermal(
  height: Float32Array,
  size: number,
  erosionMap: Float32Array,
  cellSize: number,
  params: Partial<ThermalParams> = {},
): number {
  const p: ThermalParams = { ...DEFAULT_THERMAL, ...params };
  const t0 = now();

  const softMax = Math.tan(p.talusAngle) * cellSize;
  const hardMax = Math.tan(p.talusAngle + 0.30) * cellSize;
  const delta = new Float32Array(height.length);

  for (let pass = 0; pass < p.passes; pass++) {
    delta.fill(0);

    for (let iz = 1; iz < size - 1; iz++) {
      const row = iz * size;
      for (let ix = 1; ix < size - 1; ix++) {
        const i = row + ix;
        const h = height[i];

        // Altitude-dependent repose: high ground holds a steeper face.
        const stiff = clamp01((h - p.rockAltitude) / 140);
        const maxDrop = softMax + (hardMax - softMax) * stiff;

        // Find total excess against the four neighbours.
        let total = 0;
        const dL = h - height[i - 1] - maxDrop;
        const dR = h - height[i + 1] - maxDrop;
        const dU = h - height[i - size] - maxDrop;
        const dD = h - height[i + size] - maxDrop;
        if (dL > 0) total += dL;
        if (dR > 0) total += dR;
        if (dU > 0) total += dU;
        if (dD > 0) total += dD;
        if (total <= 0) continue;

        // Move a fraction of the *average* excess, distributed in proportion.
        const move = (total / 4) * p.rate;
        const inv = move / total;
        if (dL > 0) { const m = dL * inv; delta[i] -= m; delta[i - 1] += m; }
        if (dR > 0) { const m = dR * inv; delta[i] -= m; delta[i + 1] += m; }
        if (dU > 0) { const m = dU * inv; delta[i] -= m; delta[i - size] += m; }
        if (dD > 0) { const m = dD * inv; delta[i] -= m; delta[i + size] += m; }
      }
    }

    for (let i = 0; i < height.length; i++) {
      const d = delta[i];
      if (d !== 0) {
        height[i] += d;
        // Thermal movement counts toward the erosion map at reduced weight —
        // it is real material transport, but a scree face that has merely
        // settled should not read as strongly as a water-cut gully.
        erosionMap[i] += d * 0.45;
      }
    }
  }

  return now() - t0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Normalisation and upsampling
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Normalise the raw metres-moved map into roughly [-1, 1].
 *
 * Divided by a high percentile rather than by the maximum: a handful of texels
 * in the deepest gully carry ten times the movement of anything else, and
 * dividing by those flattens the entire rest of the map to zero.
 */
export function normaliseErosionMap(map: Float32Array): {
  meanAbs: number;
  maxErosion: number;
  maxDeposition: number;
} {
  let sumAbs = 0;
  let maxE = 0;
  let maxD = 0;
  // Histogram of |value| for a cheap percentile, 512 buckets over [0, 8m].
  const buckets = new Uint32Array(512);
  const bucketMax = 8;
  for (let i = 0; i < map.length; i++) {
    const v = map[i];
    const a = v < 0 ? -v : v;
    sumAbs += a;
    if (v < 0 && a > maxE) maxE = a;
    if (v > 0 && v > maxD) maxD = v;
    const b = Math.min(511, ((a / bucketMax) * 512) | 0);
    buckets[b]++;
  }
  const target = map.length * 0.985;
  let acc = 0;
  let p985 = bucketMax;
  for (let b = 0; b < 512; b++) {
    acc += buckets[b];
    if (acc >= target) {
      p985 = ((b + 1) / 512) * bucketMax;
      break;
    }
  }
  const scale = 1 / Math.max(p985, 0.05);
  for (let i = 0; i < map.length; i++) {
    const v = map[i] * scale;
    map[i] = v < -1 ? -1 : v > 1 ? 1 : v;
  }
  return { meanAbs: sumAbs / map.length, maxErosion: maxE, maxDeposition: maxD };
}

/**
 * Bilinear upsample of a square field.
 *
 * Used when erosion is run at a lower resolution than the shipping heightmap.
 * We upsample the erosion DELTA, not the height: the delta is smooth and
 * band-limited (it is the output of a diffusive process), so bilinear loses
 * essentially nothing, whereas upsampling the height itself would throw away
 * all the fine detail the noise stack generated at full resolution.
 */
export function upsampleField(src: Float32Array, srcSize: number, dstSize: number): Float32Array {
  const dst = new Float32Array(dstSize * dstSize);
  const ratio = (srcSize - 1) / (dstSize - 1);
  for (let z = 0; z < dstSize; z++) {
    const sz = z * ratio;
    const z0 = sz | 0;
    const z1 = Math.min(z0 + 1, srcSize - 1);
    const fz = sz - z0;
    const r0 = z0 * srcSize;
    const r1 = z1 * srcSize;
    const out = z * dstSize;
    for (let x = 0; x < dstSize; x++) {
      const sx = x * ratio;
      const x0 = sx | 0;
      const x1 = Math.min(x0 + 1, srcSize - 1);
      const fx = sx - x0;
      const a = src[r0 + x0] + (src[r0 + x1] - src[r0 + x0]) * fx;
      const b = src[r1 + x0] + (src[r1 + x1] - src[r1 + x0]) * fx;
      dst[out + x] = a + (b - a) * fz;
    }
  }
  return dst;
}

/** Downsample by simple box averaging. Exact when the ratio is a power of two. */
export function downsampleField(src: Float32Array, srcSize: number, dstSize: number): Float32Array {
  const dst = new Float32Array(dstSize * dstSize);
  const step = srcSize / dstSize;
  for (let z = 0; z < dstSize; z++) {
    const z0 = (z * step) | 0;
    const z1 = Math.min(srcSize, ((z + 1) * step) | 0);
    for (let x = 0; x < dstSize; x++) {
      const x0 = (x * step) | 0;
      const x1 = Math.min(srcSize, ((x + 1) * step) | 0);
      let sum = 0;
      let n = 0;
      for (let sz = z0; sz < z1; sz++) {
        const row = sz * srcSize;
        for (let sx = x0; sx < x1; sx++) {
          sum += src[row + sx];
          n++;
        }
      }
      dst[z * dstSize + x] = n > 0 ? sum / n : 0;
    }
  }
  return dst;
}

// ─────────────────────────────────────────────────────────────────────────────

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function yieldTick(): Promise<void> {
  return new Promise<void>((res) => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => res());
    else setTimeout(res, 0);
  });
}
