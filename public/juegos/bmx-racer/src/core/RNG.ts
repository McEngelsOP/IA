/**
 * RNG — seeded, deterministic, cheap.
 *
 * The whole world is generated from seeds, so a given seed must always produce
 * the same mountain, the same tree placement, the same rock scatter. That is
 * what makes the capture harness able to photograph "the same frame" across
 * builds, and what lets the ghost replay line up with the terrain it was set on.
 *
 * Never use Math.random() anywhere in world generation. Use a named stream.
 */

/** mulberry32 — small, fast, good enough distribution for scatter and noise. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Hash a string into a 32-bit seed, so streams can be named rather than numbered. */
export function hashString(str: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * A named random stream. Two streams with different names never correlate,
 * which means adding a new scatter pass cannot shift the trees that already
 * exist. This matters more than it sounds — without it, every tweak to one
 * generator reshuffles the entire world and invalidates every captured frame.
 */
export class Rng {
  private next01: () => number;
  readonly seed: number;

  constructor(seedOrName: number | string) {
    this.seed = typeof seedOrName === 'string' ? hashString(seedOrName) : seedOrName >>> 0;
    this.next01 = mulberry32(this.seed);
  }

  /** Derive a child stream — deterministic, independent of sibling usage. */
  fork(name: string): Rng {
    return new Rng((this.seed ^ hashString(name)) >>> 0);
  }

  /** Uniform [0,1). */
  next(): number {
    return this.next01();
  }

  /** Uniform [min,max). */
  range(min: number, max: number): number {
    return min + this.next01() * (max - min);
  }

  /** Uniform integer [min,max]. */
  int(min: number, max: number): number {
    return Math.floor(min + this.next01() * (max - min + 1));
  }

  /** True with probability p. */
  chance(p: number): boolean {
    return this.next01() < p;
  }

  /** Symmetric [-1,1]. */
  signed(): number {
    return this.next01() * 2 - 1;
  }

  /** Approximately normal, mean 0, sd 1 — sum of 4 uniforms (fast, adequate). */
  gaussian(): number {
    let s = 0;
    for (let i = 0; i < 4; i++) s += this.next01();
    return (s - 2) * 1.732;
  }

  /** Pick one element. */
  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next01() * arr.length) % arr.length];
  }

  /** Weighted pick. `weights` need not be normalised. */
  pickWeighted<T>(arr: readonly T[], weights: readonly number[]): T {
    let total = 0;
    for (const w of weights) total += w;
    let r = this.next01() * total;
    for (let i = 0; i < arr.length; i++) {
      r -= weights[i];
      if (r <= 0) return arr[i];
    }
    return arr[arr.length - 1];
  }

  /** In-place Fisher–Yates. */
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next01() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  /** A point uniformly inside the unit disc — used for scatter jitter. */
  inDisc(): [number, number] {
    const r = Math.sqrt(this.next01());
    const a = this.next01() * Math.PI * 2;
    return [Math.cos(a) * r, Math.sin(a) * r];
  }

  /** A direction uniformly on the unit sphere — used for debris velocities. */
  onSphere(): [number, number, number] {
    const z = this.next01() * 2 - 1;
    const a = this.next01() * Math.PI * 2;
    const r = Math.sqrt(1 - z * z);
    return [Math.cos(a) * r, Math.sin(a) * r, z];
  }
}

/** The one world seed. Change it and you get a different mountain. */
export const WORLD_SEED = 0x5eed_10de;
