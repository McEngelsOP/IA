/**
 * Replay — a full-fidelity 60Hz recording of the player's run.
 *
 * Two consumers, with very different needs:
 *   • the results screen, which wants the single best moment of the run cut
 *     into a cinematic;
 *   • debugging, which wants every frame.
 *
 * So this records everything and provides a query for the interesting bit,
 * rather than trying to be clever about what to keep.
 *
 * Allocation policy: `record()` runs inside the fixed-step loop, so it may not
 * allocate. Frames come from a preallocated pool and the public `frames` array
 * is filled with references to pooled objects — never with fresh literals. The
 * array itself grows amortised, which is one capacity realloc every few thousand
 * frames and is not something the GC notices.
 *
 * Note the decimation: the engine's fixed step is 120Hz but this records 60Hz.
 * Recording every physics step would double the memory for information nobody
 * can see, and the replay camera interpolates anyway.
 */

import { Quaternion, Vector3 } from 'three';

import { BikeMode, BikeState, IReplayRecorder, ReplayFrame, TrickKind } from '../game/Contracts';
import { clamp01 } from '../core/MathX';

export const REPLAY_HZ = 60;
const REPLAY_DT = 1 / REPLAY_HZ;

// ── Frame flag bits ──────────────────────────────────────────────────────────
export const RF_GROUNDED = 1 << 0;
export const RF_AIRBORNE = 1 << 1;
export const RF_CRASHING = 1 << 2;
export const RF_BOOSTING = 1 << 3;
export const RF_LANDED = 1 << 4;
export const RF_MANUAL = 1 << 5;
export const RF_FINISHED = 1 << 6;
/** Trick id occupies bits 8..15. */
export const RF_TRICK_SHIFT = 8;
export const RF_TRICK_MASK = 0xff << RF_TRICK_SHIFT;

/**
 * Stable numeric ids for tricks. Order is frozen — a stored ghost or replay from
 * an older build must decode to the same trick, so append only.
 */
export const TRICK_IDS: TrickKind[] = [
  TrickKind.None,
  TrickKind.Manual,
  TrickKind.XUp,
  TrickKind.Tabletop,
  TrickKind.NoFooter,
  TrickKind.Superman,
  TrickKind.Tailwhip,
  TrickKind.Spin360,
  TrickKind.Frontflip,
  TrickKind.Backflip,
];

export function trickId(k: TrickKind): number {
  const i = TRICK_IDS.indexOf(k);
  return i < 0 ? 0 : i;
}

export function trickFromId(id: number): TrickKind {
  return TRICK_IDS[id] ?? TrickKind.None;
}

export function packFlags(state: BikeState, trick: TrickKind): number {
  let f = 0;
  if (state.mode === BikeMode.Grounded) f |= RF_GROUNDED;
  if (state.mode === BikeMode.Airborne) f |= RF_AIRBORNE;
  if (state.mode === BikeMode.Crashing || state.mode === BikeMode.Recovering) f |= RF_CRASHING;
  if (state.mode === BikeMode.Finished) f |= RF_FINISHED;
  if (state.boosting) f |= RF_BOOSTING;
  if (state.landedThisStep) f |= RF_LANDED;
  if (state.manualling) f |= RF_MANUAL;
  f |= (trickId(trick) & 0xff) << RF_TRICK_SHIFT;
  return f;
}

function blankFrame(): ReplayFrame {
  return { t: 0, px: 0, py: 0, pz: 0, qx: 0, qy: 0, qz: 0, qw: 1, speed: 0, lean: 0, steer: 0, flags: 0 };
}

export interface AirWindow {
  start: number;
  end: number;
  peak: number;
}

/** Padding around the biggest air, seconds. Enough to see the run-in and the ride-out. */
const AIR_PAD_BEFORE = 1.15;
const AIR_PAD_AFTER = 1.7;
/** Airs shorter than this are hops, not moments. */
const MIN_AIR_TIME = 0.38;

export class Replay implements IReplayRecorder {
  /** Live view of the recording. Length is the frame count. Do not mutate. */
  readonly frames: ReplayFrame[] = [];

  private pool: ReplayFrame[] = [];
  private nextRecordAt = 0;
  private started = false;

  /** The trick currently being performed — set by the owner before record(). */
  currentTrick: TrickKind = TrickKind.None;

  /** Crash moments, for a possible bloopers cut. */
  readonly crashes: { t: number; severity: number }[] = [];

  constructor(capacityFrames = 8192) {
    this.grow(capacityFrames);
  }

  private grow(n: number): void {
    for (let i = 0; i < n; i++) this.pool.push(blankFrame());
  }

  get duration(): number {
    const n = this.frames.length;
    return n === 0 ? 0 : this.frames[n - 1].t - this.frames[0].t;
  }

  record(t: number, state: BikeState): void {
    if (!this.started) {
      this.started = true;
      this.nextRecordAt = t;
    }
    if (state.crashedThisStep) this.crashes.push({ t, severity: state.crashSeverity });
    // Decimate to REPLAY_HZ. The accumulator form (rather than "t - last >= dt")
    // keeps the sample times on an exact grid, which matters because the results
    // cinematic scrubs by index and expects a constant rate.
    if (t < this.nextRecordAt) return;
    this.nextRecordAt += REPLAY_DT;
    // If the sim hitched and we are more than a frame behind, resync rather than
    // spending the next N steps catching up with duplicate samples.
    if (t > this.nextRecordAt + REPLAY_DT) this.nextRecordAt = t + REPLAY_DT;

    const idx = this.frames.length;
    if (idx >= this.pool.length) this.grow(4096);
    const f = this.pool[idx];

    f.t = t;
    f.px = state.position.x;
    f.py = state.position.y;
    f.pz = state.position.z;
    f.qx = state.orientation.x;
    f.qy = state.orientation.y;
    f.qz = state.orientation.z;
    f.qw = state.orientation.w;
    f.speed = state.speed;
    f.lean = state.lean;
    f.steer = state.steerAngle;
    f.flags = packFlags(state, this.currentTrick);

    this.frames.push(f);
  }

  /**
   * The window around the run's best air.
   *
   * "Best" is a blend of hang time and height rather than either alone: a long
   * flat gap jump and a short steep launch are both worth showing, but a 0.9s
   * float 1m off the deck is not, and neither is a 4m pop that lasts 0.4s.
   * `peak` is returned as height gained above the takeoff point, which is what
   * the camera director wants for framing.
   */
  getBiggestAir(): AirWindow | null {
    const f = this.frames;
    if (f.length < 4) return null;

    let bestScore = 0;
    let best: AirWindow | null = null;

    let i = 0;
    while (i < f.length) {
      if ((f[i].flags & RF_AIRBORNE) === 0) {
        i++;
        continue;
      }
      const takeoff = i;
      let peakY = f[i].py;
      while (i < f.length && (f[i].flags & RF_AIRBORNE) !== 0) {
        if (f[i].py > peakY) peakY = f[i].py;
        i++;
      }
      const landing = Math.min(i, f.length - 1);
      const dur = f[landing].t - f[takeoff].t;
      if (dur < MIN_AIR_TIME) continue;

      const height = Math.max(0, peakY - f[takeoff].py);
      // Hang time dominates but height breaks ties and rescues the big drops.
      const score = dur * 1.0 + height * 0.22 + clamp01(f[takeoff].speed / 22) * 0.35;
      if (score > bestScore) {
        bestScore = score;
        best = {
          start: Math.max(f[0].t, f[takeoff].t - AIR_PAD_BEFORE),
          end: Math.min(f[f.length - 1].t, f[landing].t + AIR_PAD_AFTER),
          peak: height,
        };
      }
    }
    return best;
  }

  /** The heaviest crash of the run, same windowing rules. */
  getBiggestCrash(): AirWindow | null {
    if (this.crashes.length === 0 || this.frames.length === 0) return null;
    let worst = this.crashes[0];
    for (const c of this.crashes) if (c.severity > worst.severity) worst = c;
    const t0 = this.frames[0].t;
    const t1 = this.frames[this.frames.length - 1].t;
    return {
      start: Math.max(t0, worst.t - 1.4),
      end: Math.min(t1, worst.t + 2.2),
      peak: worst.severity,
    };
  }

  /** Index of the last frame at or before `t`. Binary search; -1 if empty. */
  indexAt(t: number): number {
    const f = this.frames;
    if (f.length === 0) return -1;
    let lo = 0;
    let hi = f.length - 1;
    if (t <= f[0].t) return 0;
    if (t >= f[hi].t) return hi;
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1;
      if (f[mid].t <= t) lo = mid;
      else hi = mid;
    }
    return lo;
  }

  /** Interpolated pose at time `t`. Writes into the supplied objects. */
  sampleAt(t: number, outPos: Vector3, outQuat: Quaternion): boolean {
    const f = this.frames;
    if (f.length === 0) return false;
    const i = this.indexAt(t);
    const a = f[i];
    const b = f[Math.min(i + 1, f.length - 1)];
    const span = b.t - a.t;
    const k = span > 1e-6 ? clamp01((t - a.t) / span) : 0;
    outPos.set(a.px + (b.px - a.px) * k, a.py + (b.py - a.py) * k, a.pz + (b.pz - a.pz) * k);
    _qa.set(a.qx, a.qy, a.qz, a.qw);
    _qb.set(b.qx, b.qy, b.qz, b.qw);
    outQuat.copy(_qa).slerp(_qb, k);
    return true;
  }

  clear(): void {
    // Length assignment returns the pooled objects to the free list without
    // dropping them, so a restart does not churn 8000 objects through the GC.
    this.frames.length = 0;
    this.crashes.length = 0;
    this.nextRecordAt = 0;
    this.started = false;
    this.currentTrick = TrickKind.None;
  }
}

const _qa = new Quaternion();
const _qb = new Quaternion();
