/**
 * Noise — CPU-side coherent noise for terrain, scatter masks, and texture bakes.
 *
 * 2D simplex with a seeded permutation table, plus the fractal combinators the
 * terrain generator needs: fBm, ridged multifractal, billow, and domain warp.
 *
 * Why simplex rather than Perlin: Perlin's gradient lattice produces visible
 * axis-aligned creasing at low octave counts, and on a mountain silhouette that
 * reads as a grid. Simplex has no preferred direction, so ridgelines come out
 * of the generator already looking like they were carved rather than tiled.
 */

import { Rng } from './RNG';

const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;

// 12 gradient directions projected to 2D (the classic Gustavson set).
const GRAD2 = new Float32Array([
  1, 1, -1, 1, 1, -1, -1, -1,
  1, 0, -1, 0, 1, 0, -1, 0,
  0, 1, 0, -1, 0, 1, 0, -1,
]);

export class Noise2D {
  private perm = new Uint8Array(512);
  private permMod12 = new Uint8Array(512);

  constructor(seed: number | string = 0) {
    const rng = new Rng(seed);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    // Seeded Fisher–Yates over the permutation table.
    for (let i = 255; i > 0; i--) {
      const j = rng.int(0, i);
      const t = p[i];
      p[i] = p[j];
      p[j] = t;
    }
    for (let i = 0; i < 512; i++) {
      this.perm[i] = p[i & 255];
      this.permMod12[i] = this.perm[i] % 12;
    }
  }

  /** Raw simplex noise in roughly [-1,1]. */
  noise(xin: number, yin: number): number {
    const perm = this.perm;
    const permMod12 = this.permMod12;

    // Skew the input space to determine which simplex cell we're in.
    const s = (xin + yin) * F2;
    const i = Math.floor(xin + s);
    const j = Math.floor(yin + s);
    const t = (i + j) * G2;
    const X0 = i - t;
    const Y0 = j - t;
    const x0 = xin - X0;
    const y0 = yin - Y0;

    // Determine which triangle of the cell we're in.
    const i1 = x0 > y0 ? 1 : 0;
    const j1 = x0 > y0 ? 0 : 1;

    const x1 = x0 - i1 + G2;
    const y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2;
    const y2 = y0 - 1 + 2 * G2;

    const ii = i & 255;
    const jj = j & 255;

    let n0 = 0, n1 = 0, n2 = 0;

    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 > 0) {
      const gi0 = permMod12[ii + perm[jj]] * 2;
      t0 *= t0;
      n0 = t0 * t0 * (GRAD2[gi0] * x0 + GRAD2[gi0 + 1] * y0);
    }
    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 > 0) {
      const gi1 = permMod12[ii + i1 + perm[jj + j1]] * 2;
      t1 *= t1;
      n1 = t1 * t1 * (GRAD2[gi1] * x1 + GRAD2[gi1 + 1] * y1);
    }
    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 > 0) {
      const gi2 = permMod12[ii + 1 + perm[jj + 1]] * 2;
      t2 *= t2;
      n2 = t2 * t2 * (GRAD2[gi2] * x2 + GRAD2[gi2 + 1] * y2);
    }

    return 70 * (n0 + n1 + n2);
  }

  /** Noise mapped to [0,1]. */
  noise01(x: number, y: number): number {
    return this.noise(x, y) * 0.5 + 0.5;
  }

  /**
   * Fractional Brownian motion. The bread-and-butter shape: broad landforms
   * from the low octaves, surface detail from the high ones.
   */
  fbm(x: number, y: number, octaves = 6, lacunarity = 2.0, gain = 0.5): number {
    let amp = 1;
    let freq = 1;
    let sum = 0;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += amp * this.noise(x * freq, y * freq);
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / (norm || 1);
  }

  /**
   * Ridged multifractal. This is what makes mountains look like mountains
   * before erosion runs: sharp crests where |noise| approaches zero, and the
   * per-octave weighting concentrates detail on the ridges rather than
   * smearing it evenly. Returns roughly [0,1].
   */
  ridged(x: number, y: number, octaves = 6, lacunarity = 2.0, gain = 0.5, offset = 1.0): number {
    let sum = 0;
    let freq = 1;
    let amp = 0.5;
    let prev = 1;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
      let n = offset - Math.abs(this.noise(x * freq, y * freq));
      n *= n;
      // Weight this octave by the previous one — detail collects on the crests.
      n *= prev;
      prev = Math.min(n * 2, 1);
      sum += n * amp;
      norm += amp;
      freq *= lacunarity;
      amp *= gain;
    }
    return sum / (norm || 1);
  }

  /** Billow — absolute-value noise. Rounded, cloud-like; good for foothills. */
  billow(x: number, y: number, octaves = 5, lacunarity = 2.0, gain = 0.5): number {
    let amp = 1;
    let freq = 1;
    let sum = 0;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += amp * (Math.abs(this.noise(x * freq, y * freq)) * 2 - 1);
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / (norm || 1);
  }

  /**
   * Domain warp — offset the sample point by another noise field before
   * sampling. This is the single cheapest trick for making noise stop looking
   * like noise: it introduces the swirled, flow-like structure that real
   * geology has and pure fBm never does.
   */
  warp(x: number, y: number, strength: number, octaves = 4): [number, number] {
    const qx = this.fbm(x + 5.2, y + 1.3, octaves);
    const qy = this.fbm(x + 9.7, y + 8.4, octaves);
    return [x + strength * qx, y + strength * qy];
  }
}

/**
 * Multi-octave value noise on a tileable grid — used for canvas texture bakes
 * where seamless wrapping matters more than isotropy.
 */
export class TileableNoise {
  private grid: Float32Array;
  private size: number;

  constructor(size: number, seed: number | string) {
    this.size = size;
    this.grid = new Float32Array(size * size);
    const rng = new Rng(seed);
    for (let i = 0; i < this.grid.length; i++) this.grid[i] = rng.next();
  }

  private at(x: number, y: number): number {
    return this.atPeriod(x, y, this.size);
  }

  /**
   * Lattice fetch wrapped on an ARBITRARY period, then folded into the grid.
   *
   * This is what actually makes the noise tileable, and the original did not
   * do it. `at` wrapped on `size`, so one octave closed over [0,1] only when
   * its frequency was an exact multiple of the grid size. None of them ever
   * were: the cloud mask ran freqs 5,10,20,40,80 against a 32 lattice, the
   * detail layer 18,36,72 against 96, the warp 3,6,12 against 16 — not one
   * closes. Every "tileable" texture in the project had a seam at u=1 and
   * v=1, which is what guillotined the cloud blobs at the tile edge and put a
   * hard straight line across the sky wherever the projection reached past
   * the edge.
   *
   * Wrapping on the octave's OWN frequency makes index 0 and index `freq`
   * the same lattice cell by construction, so every octave closes for any
   * frequency. The extra `% s` only folds the period onto the stored grid and
   * cannot break the wrap.
   */
  private atPeriod(x: number, y: number, period: number): number {
    const s = this.size;
    const p = period > 0 ? period : s;
    const xi = ((x % p) + p) % p;
    const yi = ((y % p) + p) % p;
    return this.grid[(yi % s) * s + (xi % s)];
  }

  /** Bilinear sample wrapped on `period` grid units rather than on `size`. */
  private sampleTiled(x: number, y: number, period: number): number {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    const ux = fx * fx * (3 - 2 * fx);
    const uy = fy * fy * (3 - 2 * fy);
    const a = this.atPeriod(x0, y0, period);
    const b = this.atPeriod(x0 + 1, y0, period);
    const c = this.atPeriod(x0, y0 + 1, period);
    const d = this.atPeriod(x0 + 1, y0 + 1, period);
    return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
  }

  /** Bilinear + smoothstep interpolated sample. Input in grid units. */
  sample(x: number, y: number): number {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    const ux = fx * fx * (3 - 2 * fx);
    const uy = fy * fy * (3 - 2 * fy);
    const a = this.at(x0, y0);
    const b = this.at(x0 + 1, y0);
    const c = this.at(x0, y0 + 1);
    const d = this.at(x0 + 1, y0 + 1);
    return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
  }

  /** Tileable fBm over uv. Integer frequencies close exactly, at any size. */
  fbm01(u: number, v: number, baseFreq = 4, octaves = 5, gain = 0.5): number {
    let sum = 0;
    let norm = 0;
    let amp = 1;
    let freq = baseFreq;
    for (let o = 0; o < octaves; o++) {
      // Wrap on this octave's own frequency, so the octave closes over [0,1]
      // whatever the grid size is. Inputs outside [0,1] wrap correctly too,
      // which is what lets a domain warp push past the edge safely.
      sum += amp * this.sampleTiled(u * freq, v * freq, freq);
      norm += amp;
      amp *= gain;
      freq *= 2;
    }
    return sum / (norm || 1);
  }
}

/**
 * Worley / cellular noise — F1 distance. Used for scree pebbling, rock facet
 * masks, and the cracked-mud pattern in the stream bed.
 */
export class Worley2D {
  private seed: number;

  constructor(seed: number | string = 0) {
    this.seed = new Rng(seed).int(0, 0xffff);
  }

  private hash2(ix: number, iy: number): [number, number] {
    let h = (ix * 374761393 + iy * 668265263 + this.seed * 2654435761) | 0;
    h = (h ^ (h >>> 13)) * 1274126177;
    h = h ^ (h >>> 16);
    const a = (h >>> 0) / 4294967296;
    let h2 = (h * 1103515245 + 12345) | 0;
    h2 = h2 ^ (h2 >>> 15);
    const b = (h2 >>> 0) / 4294967296;
    return [a, b];
  }

  /** F1 (nearest feature point distance), roughly [0,1] for unit cell size. */
  f1(x: number, y: number): number {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    let best = 1e9;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const [fx, fy] = this.hash2(ix + dx, iy + dy);
        const px = ix + dx + fx;
        const py = iy + dy + fy;
        const d = (px - x) * (px - x) + (py - y) * (py - y);
        if (d < best) best = d;
      }
    }
    return Math.min(Math.sqrt(best), 1);
  }

  /** F2 - F1 — the classic "cell border" field, ideal for cracks and facets. */
  border(x: number, y: number): number {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    let f1 = 1e9;
    let f2 = 1e9;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const [fx, fy] = this.hash2(ix + dx, iy + dy);
        const px = ix + dx + fx;
        const py = iy + dy + fy;
        const d = Math.sqrt((px - x) * (px - x) + (py - y) * (py - y));
        if (d < f1) {
          f2 = f1;
          f1 = d;
        } else if (d < f2) {
          f2 = d;
        }
      }
    }
    return Math.min(f2 - f1, 1);
  }
}
