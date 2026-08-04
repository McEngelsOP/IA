/**
 * Checkpoints — split timing, wrong-way detection, and the corner preview.
 *
 * All three are the same measurement seen three ways: project the racer onto
 * the centreline, and watch what the resulting distance does over time.
 *
 *   • A CROSSING is the distance stepping over a gate's distance between two
 *     samples. Doing it that way rather than with a trigger volume means a
 *     rider at 22 m/s cannot tunnel through a gate between physics steps, which
 *     is the classic failure of box-collider checkpoints in a fast game.
 *
 *   • WRONG WAY is sustained negative progress along the tangent. It has to be
 *     sustained: a rider who rails a berm at full lean momentarily has negative
 *     tangential velocity while their position is still tracking forward, and
 *     flashing WRONG WAY at them mid-corner is worse than not having the
 *     warning at all.
 *
 *   • The CORNER PREVIEW is the peak signed curvature in the window ahead, plus
 *     how far away that corner starts. The HUD indicator lives on it and so
 *     does the AI's braking point, so it is computed once here rather than
 *     twice with two slightly different definitions of "the next corner".
 */

import { Vector3 } from 'three';
import { Checkpoint } from '../game/Contracts';
import { CHECKPOINT_TS } from '../game/WorldConstants';
import { clamp, clamp01 } from '../core/MathX';
import { TrackSpline } from './TrackSpline';

const _fwd = new Vector3();

/** Curvature at which the corner-preview signal saturates (1/m). ~18m radius. */
const CORNER_SATURATION = 0.055;
/** Below this the track is straight enough that the HUD should show nothing. */
const CORNER_FLOOR = 0.009;

export interface CornerPreview {
  /** Signed, normalised -1..1. Positive = the corner goes left. */
  curvature: number;
  /** Metres to the corner entry. */
  distance: number;
}

export interface CheckpointEvent {
  kind: 'checkpoint' | 'finish';
  index: number;
  /** Race time at the crossing. */
  time: number;
  /** Time since the previous gate. */
  split: number;
  /** True if the racer crossed outside the gate posts. */
  missed: boolean;
}

/**
 * Per-racer state. One of these is owned by each racer; the Checkpoints object
 * itself is stateless with respect to racers, which is what lets the ghost and
 * the replay run through the same code without contaminating the live race.
 */
export class RacerTracker {
  readonly id: string;
  /** Monotonic progress. Never decreases — used for placings. */
  distance = 0;
  /** Live projection distance. May go backwards. */
  rawDistance = 0;
  lateral = 0;
  vertical = 0;
  /** True while the racer is within the rideable half-width. */
  onTrack = true;
  /** How far outside the ribbon the racer is, metres. 0 when on track. */
  offTrackBy = 0;
  nextCheckpoint = 0;
  splits: (number | null)[];
  missedGates = 0;
  wrongWay = false;
  wrongWayTimer = 0;
  finished = false;
  finishTime: number | null = null;
  /** Signed speed along the track tangent, m/s. */
  tangentSpeed = 0;
  cornerPreview: CornerPreview | null = null;

  /** Distance at the previous update; the crossing test needs both ends. */
  prevDistance = -1;
  lastGateTime = 0;
  private _preview: CornerPreview = { curvature: 0, distance: 0 };

  constructor(id: string, gateCount: number) {
    this.id = id;
    this.splits = new Array(gateCount).fill(null);
  }

  /** Internal — the preview object is reused, never reallocated. */
  previewSlot(): CornerPreview {
    return this._preview;
  }

  reset(): void {
    this.distance = 0;
    this.rawDistance = 0;
    this.lateral = 0;
    this.vertical = 0;
    this.onTrack = true;
    this.offTrackBy = 0;
    this.nextCheckpoint = 0;
    this.splits.fill(null);
    this.missedGates = 0;
    this.wrongWay = false;
    this.wrongWayTimer = 0;
    this.finished = false;
    this.finishTime = null;
    this.tangentSpeed = 0;
    this.cornerPreview = null;
    this.prevDistance = -1;
    this.lastGateTime = 0;
  }
}

export class Checkpoints {
  readonly gates: Checkpoint[] = [];

  constructor(private spline: TrackSpline, ts: readonly number[] = CHECKPOINT_TS) {
    const L = spline.length;
    for (let i = 0; i < ts.length; i++) {
      // The finish gate is pulled 1.5m short of the very end of the table. The
      // projection clamps at the end of the spline, so a gate placed exactly
      // AT the end can only be crossed by a sample that lands exactly on it.
      const d = clamp(ts[i] * L, 0, L - 1.5);
      const s = spline.sampleAtDistance(d);
      this.gates.push({
        index: i,
        distance: d,
        position: s.position.clone(),
        // Gate posts stand just outside the rideable width. Wide enough that
        // clipping one is a mistake you made, not a mistake the game made.
        halfWidth: s.halfWidth + 1.6,
        forward: s.tangent.clone(),
        isFinish: i === ts.length - 1,
      });
    }
  }

  createTracker(id: string): RacerTracker {
    return new RacerTracker(id, this.gates.length);
  }

  /**
   * Advance one racer. Returns the gate event fired this step, or null.
   *
   * Only ever fires one event per call: two gates cannot be 0.3 seconds apart
   * on this course, and returning a list would mean allocating one.
   */
  update(
    tracker: RacerTracker,
    position: Vector3,
    velocity: Vector3,
    raceTime: number,
    dt: number,
  ): CheckpointEvent | null {
    const proj = this.spline.project(position, tracker.rawDistance > 0 ? tracker.rawDistance : undefined);
    const s = proj.sample;

    tracker.rawDistance = proj.distance;
    tracker.lateral = proj.lateral;
    tracker.vertical = proj.vertical;
    tracker.distance = Math.max(tracker.distance, proj.distance);

    const over = Math.abs(proj.lateral) - s.halfWidth;
    tracker.offTrackBy = Math.max(0, over);
    tracker.onTrack = over <= 0;

    _fwd.copy(s.tangent);
    tracker.tangentSpeed = velocity.dot(_fwd);

    // ── Wrong way ────────────────────────────────────────────────────────────
    // Two independent signals, either of which is enough: pointing back up the
    // hill under power, or having lost real ground against your own best.
    const reversing = tracker.tangentSpeed < -1.2;
    const backslid = tracker.distance - proj.distance > 12;
    if (reversing || backslid) tracker.wrongWayTimer = Math.min(2.5, tracker.wrongWayTimer + dt);
    else tracker.wrongWayTimer = Math.max(0, tracker.wrongWayTimer - dt * 2.2);
    if (!tracker.wrongWay && tracker.wrongWayTimer > 1.1) tracker.wrongWay = true;
    else if (tracker.wrongWay && tracker.wrongWayTimer <= 0.15) tracker.wrongWay = false;

    // ── Corner preview ───────────────────────────────────────────────────────
    tracker.cornerPreview = this.cornerPreview(proj.distance, tracker.previewSlot());

    // ── Gate crossing ────────────────────────────────────────────────────────
    let event: CheckpointEvent | null = null;
    if (!tracker.finished && tracker.nextCheckpoint < this.gates.length) {
      const g = this.gates[tracker.nextCheckpoint];
      const prev = tracker.prevDistance;
      const crossed = prev < g.distance && proj.distance >= g.distance;
      // The start gate sits at distance 0, which nothing can cross from below.
      const isStart = g.distance <= 0 && prev < 0;
      if (crossed || isStart) {
        const missed = Math.abs(proj.lateral) > g.halfWidth * 1.35;
        if (missed) tracker.missedGates++;
        tracker.splits[g.index] = raceTime;
        const split = raceTime - tracker.lastGateTime;
        tracker.lastGateTime = raceTime;
        tracker.nextCheckpoint++;
        if (g.isFinish) {
          tracker.finished = true;
          tracker.finishTime = raceTime;
        }
        event = {
          kind: g.isFinish ? 'finish' : 'checkpoint',
          index: g.index,
          time: raceTime,
          split,
          missed,
        };
      }
    }

    tracker.prevDistance = proj.distance;
    return event;
  }

  /**
   * The next corner ahead of `distance`.
   *
   * Scans a 50m window starting 8m ahead — near enough that the answer is
   * actionable, far enough that a rider at 20 m/s gets about two and a half
   * seconds of warning. Returns the peak signed curvature normalised to -1..1
   * and the distance to where the corner starts turning, not to its apex: an
   * indicator that lights up at the apex is an indicator that lights up too
   * late to be worth anything.
   */
  cornerPreview(distance: number, out?: CornerPreview): CornerPreview | null {
    const s = this.spline;
    const step = Math.max(1, Math.round(1.0 / s.spacing));
    const i0 = clamp(Math.round((distance + 8) / s.spacing), 0, s.count - 1);
    const i1 = clamp(Math.round((distance + 58) / s.spacing), 0, s.count - 1);
    if (i1 <= i0) return null;

    let peak = 0;
    let peakI = i0;
    for (let i = i0; i <= i1; i += step) {
      const k = s.curvature[i];
      if (Math.abs(k) > Math.abs(peak)) {
        peak = k;
        peakI = i;
      }
    }
    if (Math.abs(peak) < CORNER_FLOOR) return null;

    // Walk back from the peak to the point where the corner begins.
    const entryThreshold = Math.abs(peak) * 0.35;
    let entryI = peakI;
    while (entryI > i0 && Math.abs(s.curvature[entryI - step]) > entryThreshold) entryI -= step;

    const r = out ?? { curvature: 0, distance: 0 };
    r.curvature = clamp(peak / CORNER_SATURATION, -1, 1);
    r.distance = Math.max(0, entryI * s.spacing - distance);
    return r;
  }

  /**
   * Standings helper: 1-based live position, ordered by monotonic distance with
   * finishers locked to their finish order.
   */
  static rank(trackers: readonly RacerTracker[], out: number[]): void {
    const order = trackers.map((t, i) => i);
    order.sort((a, b) => {
      const A = trackers[a];
      const B = trackers[b];
      if (A.finished && B.finished) return (A.finishTime ?? 0) - (B.finishTime ?? 0);
      if (A.finished) return -1;
      if (B.finished) return 1;
      return B.distance - A.distance;
    });
    for (let p = 0; p < order.length; p++) out[order[p]] = p + 1;
  }

  /** 0..1 progress down the mountain. */
  progress(tracker: RacerTracker): number {
    return clamp01(tracker.distance / Math.max(1, this.spline.length));
  }
}
