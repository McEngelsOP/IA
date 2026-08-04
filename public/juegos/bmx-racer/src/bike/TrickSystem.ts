/**
 * TrickSystem — the air state machine, the scoring, and the boost meter.
 *
 * There are two genuinely different kinds of trick here and conflating them is
 * the usual mistake:
 *
 *  • ROTATION tricks (360, backflip, frontflip) are not "performed", they are
 *    OBSERVED. The player rotates the bike with air control; this system watches
 *    the integrated body rotation and names what happened. That means a 540 is
 *    just a 360 that kept going, a botched flip that only reaches 200° scores
 *    nothing, and the player never has to learn a trick button for them — they
 *    learn the physics. Detecting them from input instead would mean the score
 *    and the visible rotation could disagree, which reads as broken immediately.
 *
 *  • POSE tricks (tabletop, x-up, superman, tailwhip, no-footer) are committed
 *    by an input modifier and run an out-and-back phase envelope. They only bank
 *    if the pose has RETURNED TO NEUTRAL before touchdown. That return is the
 *    entire risk/reward: holding a superman to the last frame is worth more air
 *    time but you have to get your feet back on.
 *
 * `committed` in the contract means "fully returned to neutral and can be
 * landed". We set it when every active pose is home AND every rotation is within
 * tolerance of a whole revolution. Landing with committed false is a bail: the
 * pending score is lost and the landing quality is savaged, which usually means
 * a crash.
 *
 * The rider rig renders the poses; it reads `kind` and `phase`. The bike model
 * reads `visual` for the two tricks that move the BIKE rather than the rider —
 * a tailwhip spins the frame around the steerer, an x-up twists the bars.
 */

import { TrickKind, type TrickState } from '../game/Contracts';
import { BIKE } from '../game/WorldConstants';
import { clamp, clamp01, smoothstep, TAU } from '../core/MathX';

// ─────────────────────────────────────────────────────────────────────────────
// Tuning
// ─────────────────────────────────────────────────────────────────────────────

export const TRICK_TUNE = {
  /** Base points, before rotation / air-time / combo multipliers. */
  base: {
    [TrickKind.None]: 0,
    [TrickKind.Tabletop]: 300,
    [TrickKind.XUp]: 240,
    [TrickKind.Superman]: 520,
    [TrickKind.Tailwhip]: 680,
    [TrickKind.Spin360]: 800,
    [TrickKind.Backflip]: 1250,
    [TrickKind.Frontflip]: 1450,
    [TrickKind.Manual]: 0, // scored per second, see manualRate
    [TrickKind.NoFooter]: 220,
  } as Record<TrickKind, number>,

  /** Points per second of a held manual, scaled by how close to the balance point. */
  manualRate: 165,
  /** Points per second of a held nose manual / endo. */
  endoRate: 210,

  /** Seconds a pose trick takes to reach full extension, and to come home. */
  poseOut: 0.26,
  poseHome: 0.22,
  /** Minimum air time before a pose trick can be started at all. */
  minAirForPose: 0.16,
  /** A pose held longer than this starts to look like a bail. */
  poseHoldMax: 1.9,

  /** Extra rotations beyond the first are worth this much of the base each. */
  rotationBonus: 0.85,
  /** Air time multiplier saturates here. */
  airTimeFull: 2.4,
  airTimeBonus: 0.6,
  /** Each additional distinct trick in one air multiplies the whole air by this. */
  comboStep: 0.35,
  /** How close to a whole revolution counts as "landed straight", radians. */
  rotationTolerance: 0.62,
  /** Landing quality below this bails the whole air. */
  bailQuality: 0.16,
};

/** How the bike model must be deformed for the trick currently running. */
export interface TrickVisual {
  /** Frame rotation about the steering axis — the tailwhip. Radians. */
  whipAngle: number;
  /** Bar twist about the steering axis — the x-up. Radians, on top of steer. */
  barTwist: number;
  /** 0..1 blend for rider-only poses. The rig owns the actual pose. */
  poseBlend: number;
  /** Which pose the blend refers to. */
  poseKind: TrickKind;
  /** Set for one step when a trick banks. HUD/FX read it then clear. */
  bankedThisStep: boolean;
  bankedKind: TrickKind;
  bankedPoints: number;
  bankedCombo: number;
  /** Set for one step when an air is bailed. */
  bailedThisStep: boolean;
}

/** One trick currently running or already completed within this air. */
interface ActiveTrick {
  kind: TrickKind;
  /** 0 = neutral, 1 = full extension. */
  phase: number;
  /** +1 going out, -1 coming home, 0 finished. */
  dir: number;
  /** Seconds held at full extension. */
  held: number;
  /** Direction modifier: -1 left, +1 right. */
  side: number;
  /** True once the pose has come all the way home. */
  complete: boolean;
  /** Accumulated whole rotations, for rotation tricks. */
  rotations: number;
}

export interface TrickInput {
  trick1: boolean;
  trick2: boolean;
  steer: number;
  pitchLean: number;
}

const POSE_KINDS = new Set<TrickKind>([
  TrickKind.Tabletop,
  TrickKind.XUp,
  TrickKind.Superman,
  TrickKind.Tailwhip,
  TrickKind.NoFooter,
]);

export class TrickSystem {
  /** The contract-facing state. Read by the rig, HUD and race director. */
  readonly state: TrickState = {
    kind: TrickKind.None,
    phase: 0,
    rotations: 0,
    pendingScore: 0,
    committed: true,
  };

  readonly visual: TrickVisual = {
    whipAngle: 0,
    barTwist: 0,
    poseBlend: 0,
    poseKind: TrickKind.None,
    bankedThisStep: false,
    bankedKind: TrickKind.None,
    bankedPoints: 0,
    bankedCombo: 0,
    bailedThisStep: false,
  };

  /** Total banked score for the run. */
  score = 0;
  /** Boost meter 0..1. Filled by banked tricks and clean landings. */
  boost = 0;

  private active: ActiveTrick[] = [];
  /** Integrated body rotation about the bike's own axes since takeoff, radians. */
  private yawAccum = 0;
  private pitchAccum = 0;
  private rollAccum = 0;
  private airborne = false;
  private airTime = 0;
  /** Edge latches so a held modifier does not re-fire every step. */
  private prevTrick1 = false;
  private prevTrick2 = false;
  /** Manual scoring accumulator. */
  private manualPending = 0;
  /** Names of tricks already counted this air, for the combo multiplier. */
  private countedThisAir = new Set<TrickKind>();

  // ── Air lifecycle ─────────────────────────────────────────────────────────

  /** Called on the step the bike leaves the ground. */
  beginAir(): void {
    this.airborne = true;
    this.airTime = 0;
    this.yawAccum = 0;
    this.pitchAccum = 0;
    this.rollAccum = 0;
    this.active.length = 0;
    this.countedThisAir.clear();
    this.state.rotations = 0;
    this.state.pendingScore = 0;
    this.state.kind = TrickKind.None;
    this.state.phase = 0;
    this.state.committed = true;
    this.visual.whipAngle = 0;
    this.visual.barTwist = 0;
    this.visual.poseBlend = 0;
    this.visual.poseKind = TrickKind.None;
  }

  /**
   * Called every airborne physics step.
   * `bodyRates` are the bike's angular velocities about its OWN axes:
   * roll about forward, pitch about lateral, yaw about up. rad/s.
   */
  updateAir(
    input: TrickInput,
    dt: number,
    rollRate: number,
    pitchRate: number,
    yawRate: number,
  ): void {
    if (!this.airborne) return;
    this.airTime += dt;

    this.yawAccum += yawRate * dt;
    this.pitchAccum += pitchRate * dt;
    this.rollAccum += rollRate * dt;

    this.detectPoseInput(input);
    this.advancePoses(dt);
    this.updateRotations();
    this.publish();
  }

  /**
   * Try to start a pose trick from the modifier buttons.
   * trick1 + direction → tailwhip, trick1 alone → x-up.
   * trick2 + back → superman, trick2 + forward → no-footer, trick2 alone → tabletop.
   */
  private detectPoseInput(input: TrickInput): void {
    const t1Edge = input.trick1 && !this.prevTrick1;
    const t2Edge = input.trick2 && !this.prevTrick2;
    this.prevTrick1 = input.trick1;
    this.prevTrick2 = input.trick2;

    if (this.airTime < TRICK_TUNE.minAirForPose) return;
    if (!t1Edge && !t2Edge) return;
    // One pose at a time. Re-pressing during a pose sends it home early rather
    // than stacking, which is what a player expects from a panic tap.
    const running = this.active.find((a) => POSE_KINDS.has(a.kind) && !a.complete);
    if (running) {
      if (running.dir >= 0) running.dir = -1;
      return;
    }

    let kind: TrickKind;
    let side = input.steer >= 0 ? 1 : -1;
    if (t1Edge) {
      kind = Math.abs(input.steer) > 0.35 ? TrickKind.Tailwhip : TrickKind.XUp;
    } else {
      if (input.pitchLean > 0.4) kind = TrickKind.Superman;
      else if (input.pitchLean < -0.4) kind = TrickKind.NoFooter;
      else kind = TrickKind.Tabletop;
      side = input.steer >= 0 ? 1 : -1;
    }

    this.active.push({
      kind,
      phase: 0,
      dir: 1,
      held: 0,
      side,
      complete: false,
      rotations: 0,
    });
  }

  private advancePoses(dt: number): void {
    const hold = this.holdWanted;
    for (const a of this.active) {
      if (!POSE_KINDS.has(a.kind) || a.complete) continue;
      if (a.dir > 0) {
        a.phase += dt / TRICK_TUNE.poseOut;
        if (a.phase >= 1) {
          a.phase = 1;
          a.dir = 0;
        }
      } else if (a.dir === 0) {
        a.held += dt;
        // Held too long and it starts coming home on its own — you cannot just
        // park in a superman and hope the ground goes away.
        if (!hold || a.held > TRICK_TUNE.poseHoldMax) a.dir = -1;
      } else {
        a.phase -= dt / TRICK_TUNE.poseHome;
        if (a.phase <= 0) {
          a.phase = 0;
          a.dir = 0;
          a.complete = true;
        }
      }
    }
    this.updateVisualFromPoses();
  }

  /** True while the player is still holding the modifier that started the pose. */
  private get holdWanted(): boolean {
    return this.prevTrick1 || this.prevTrick2;
  }

  private updateVisualFromPoses(): void {
    let whip = 0;
    let twist = 0;
    let blend = 0;
    let poseKind = TrickKind.None;
    for (const a of this.active) {
      if (!POSE_KINDS.has(a.kind)) continue;
      const e = easePose(a.phase);
      if (a.kind === TrickKind.Tailwhip) {
        // A whip is a full 360 of the frame around the steerer, not a wobble.
        whip += a.side * e * TAU;
      } else if (a.kind === TrickKind.XUp) {
        // Bars cross over — 180 out and back.
        twist += a.side * e * Math.PI;
      }
      if (e > blend) {
        blend = e;
        poseKind = a.kind;
      }
    }
    this.visual.whipAngle = whip;
    this.visual.barTwist = twist;
    this.visual.poseBlend = blend;
    this.visual.poseKind = poseKind;
  }

  /** Name the rotation tricks from the integrated body rotation. */
  private updateRotations(): void {
    // Flips are pitch about the lateral axis; spins are yaw about the bike's up.
    // Both are counted in whole revolutions and only credited once the rotation
    // has actually been achieved, so a 340° flip is worth nothing.
    const flips = Math.floor(Math.abs(this.pitchAccum) / TAU + 1e-6);
    const spins = Math.floor(Math.abs(this.yawAccum) / TAU + 1e-6);

    if (flips > 0) {
      const kind = this.pitchAccum > 0 ? TrickKind.Backflip : TrickKind.Frontflip;
      this.ensureRotation(kind, flips);
    }
    if (spins > 0) {
      this.ensureRotation(TrickKind.Spin360, spins);
    }
  }

  private ensureRotation(kind: TrickKind, count: number): void {
    let a = this.active.find((x) => x.kind === kind);
    if (!a) {
      a = { kind, phase: 1, dir: 0, held: 0, side: 1, complete: true, rotations: 0 };
      this.active.push(a);
    }
    a.rotations = count;
  }

  /** Recompute the contract-facing summary from the active list. */
  private publish(): void {
    // Report the highest-value trick running, so the HUD names the thing the
    // player is most obviously doing.
    let best: ActiveTrick | null = null;
    let bestValue = -1;
    let totalRot = 0;
    for (const a of this.active) {
      const v = this.trickValue(a);
      totalRot += a.rotations;
      if (v > bestValue) {
        bestValue = v;
        best = a;
      }
    }

    this.state.kind = best ? best.kind : TrickKind.None;
    this.state.phase = best ? (POSE_KINDS.has(best.kind) ? best.phase : clamp01(this.airTime / 1.2)) : 0;
    this.state.rotations = totalRot;
    this.state.pendingScore = Math.round(this.airScore());
    this.state.committed = this.isCommitted();
  }

  private trickValue(a: ActiveTrick): number {
    const base = TRICK_TUNE.base[a.kind] ?? 0;
    const rot = a.rotations > 1 ? 1 + (a.rotations - 1) * TRICK_TUNE.rotationBonus : 1;
    return base * rot;
  }

  /** Points this air would bank right now at a perfect landing. */
  private airScore(): number {
    let sum = 0;
    let distinct = 0;
    for (const a of this.active) {
      const v = this.trickValue(a);
      if (v <= 0) continue;
      sum += v;
      distinct++;
    }
    if (sum <= 0) return 0;
    const airMul = 1 + clamp01(this.airTime / TRICK_TUNE.airTimeFull) * TRICK_TUNE.airTimeBonus;
    const comboMul = 1 + Math.max(0, distinct - 1) * TRICK_TUNE.comboStep;
    return sum * airMul * comboMul;
  }

  /**
   * Everything home and straight?
   * Poses must be back at neutral and rotations must be within tolerance of a
   * whole revolution — landing a 450 sideways is a bail, not a 360.
   */
  private isCommitted(): boolean {
    for (const a of this.active) {
      if (POSE_KINDS.has(a.kind) && !a.complete) return false;
    }
    if (!withinWholeTurn(this.pitchAccum)) return false;
    if (!withinWholeTurn(this.yawAccum)) return false;
    if (!withinWholeTurn(this.rollAccum)) return false;
    return true;
  }

  /**
   * Called on the step the bike touches down.
   * Returns the points banked (0 on a bail) and updates the boost meter.
   */
  land(landingQuality: number): number {
    if (!this.airborne) return 0;
    this.airborne = false;

    const committed = this.isCommitted();
    const raw = this.airScore();

    this.visual.bankedThisStep = false;
    this.visual.bailedThisStep = false;
    this.visual.whipAngle = 0;
    this.visual.barTwist = 0;
    this.visual.poseBlend = 0;
    this.visual.poseKind = TrickKind.None;

    if (!committed || landingQuality < TRICK_TUNE.bailQuality || raw <= 0) {
      if (raw > 0) this.visual.bailedThisStep = true;
      this.resetAir();
      return 0;
    }

    // Landing quality scales the bank. A scrappy but legal landing still pays,
    // just not fully — the incentive is to set up the landing, not just survive.
    const points = Math.round(raw * (0.55 + 0.45 * clamp01(landingQuality)));
    this.score += points;
    this.boost = clamp01(this.boost + points * BIKE.boostPerTrickPoint);

    let distinct = 0;
    let bankedKind = TrickKind.None;
    let bestValue = -1;
    for (const a of this.active) {
      const v = this.trickValue(a);
      if (v <= 0) continue;
      distinct++;
      if (v > bestValue) {
        bestValue = v;
        bankedKind = a.kind;
      }
    }

    this.visual.bankedThisStep = true;
    this.visual.bankedKind = bankedKind;
    this.visual.bankedPoints = points;
    this.visual.bankedCombo = distinct;

    this.resetAir();
    return points;
  }

  /** Called on the step a crash begins — everything pending is lost. */
  bail(): void {
    if (this.airborne && this.airScore() > 0) this.visual.bailedThisStep = true;
    this.airborne = false;
    this.resetAir();
  }

  private resetAir(): void {
    this.active.length = 0;
    this.countedThisAir.clear();
    this.state.kind = TrickKind.None;
    this.state.phase = 0;
    this.state.rotations = 0;
    this.state.pendingScore = 0;
    this.state.committed = true;
    this.yawAccum = 0;
    this.pitchAccum = 0;
    this.rollAccum = 0;
    this.airTime = 0;
  }

  // ── Ground tricks ─────────────────────────────────────────────────────────

  /**
   * Manuals score while grounded. `manualAmount` is 0..1 front wheel lift and
   * `balance` is how close to the balance point the rider is (1 = perfect).
   * Points bank continuously rather than at the end, because a manual has no
   * clean "landing" — you just run out of it.
   */
  updateGround(dt: number, manualAmount: number, balance: number, endoAmount: number): number {
    let gained = 0;
    if (manualAmount > 0.25) {
      gained += TRICK_TUNE.manualRate * dt * manualAmount * (0.45 + 0.55 * clamp01(balance));
    }
    if (endoAmount > 0.3) {
      gained += TRICK_TUNE.endoRate * dt * endoAmount;
    }
    if (gained > 0) {
      this.manualPending += gained;
      // Bank in whole points so the HUD ticker does not flicker.
      if (this.manualPending >= 1) {
        const whole = Math.floor(this.manualPending);
        this.manualPending -= whole;
        this.score += whole;
        this.boost = clamp01(this.boost + whole * BIKE.boostPerTrickPoint);
        if (manualAmount > 0.25) {
          this.state.kind = TrickKind.Manual;
          this.state.phase = clamp01(manualAmount);
        }
        return whole;
      }
    } else if (this.state.kind === TrickKind.Manual) {
      this.state.kind = TrickKind.None;
      this.state.phase = 0;
    }
    return 0;
  }

  /** Reward for a clean landing even with no trick — keeps the boost flowing. */
  rewardLanding(quality: number, impact: number): void {
    if (quality < 0.62) return;
    const q = smoothstep(0.62, 1, quality);
    this.boost = clamp01(this.boost + q * (0.035 + impact * 0.09));
  }

  /** Reward for a well-timed pump — the skill the whole game is built on. */
  rewardPump(quality: number): void {
    if (quality <= 0.05) return;
    this.boost = clamp01(this.boost + quality * 0.055);
  }

  /** Drain while boosting. Returns true if boost is actually available. */
  drainBoost(dt: number): boolean {
    if (this.boost <= 0.001) return false;
    this.boost = Math.max(0, this.boost - BIKE.boostDrainPerSecond * dt);
    return true;
  }

  /** Clear the one-step latches. Call at the end of every physics step. */
  clearEdges(): void {
    this.visual.bankedThisStep = false;
    this.visual.bailedThisStep = false;
  }

  reset(): void {
    this.resetAir();
    this.airborne = false;
    this.score = 0;
    this.boost = 0;
    this.manualPending = 0;
    this.prevTrick1 = false;
    this.prevTrick2 = false;
    this.visual.whipAngle = 0;
    this.visual.barTwist = 0;
    this.visual.poseBlend = 0;
    this.visual.poseKind = TrickKind.None;
    this.visual.bankedThisStep = false;
    this.visual.bailedThisStep = false;
  }

  /** Human-readable name for the HUD. Null when nothing is running. */
  get displayName(): string | null {
    const k = this.state.kind;
    if (k === TrickKind.None) return null;
    const r = this.state.rotations;
    if (k === TrickKind.Spin360) return r >= 2 ? `${r * 360}` : '360';
    if (k === TrickKind.Backflip) return r >= 2 ? `${r}x BACKFLIP` : 'BACKFLIP';
    if (k === TrickKind.Frontflip) return r >= 2 ? `${r}x FRONTFLIP` : 'FRONTFLIP';
    return k.toUpperCase().replace('-', ' ');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Pose envelope. Fast out, slight overshoot, settled hold — the shape an
 * animator would key. A linear phase reads as a machine moving a part.
 */
function easePose(p: number): number {
  const t = clamp01(p);
  return t * t * (3 - 2 * t) * (1 + 0.09 * Math.sin(t * Math.PI));
}

/** Is this accumulated rotation close enough to a whole number of turns? */
function withinWholeTurn(rot: number): boolean {
  const frac = Math.abs(rot) % TAU;
  const off = Math.min(frac, TAU - frac);
  return off <= TRICK_TUNE.rotationTolerance;
}

/** How straight the bike is, 0..1, for the landing quality blend. */
export function rotationStraightness(rot: number): number {
  const frac = Math.abs(rot) % TAU;
  const off = Math.min(frac, TAU - frac);
  return 1 - clamp01(off / TRICK_TUNE.rotationTolerance);
}

export { clamp as _clampReExport };
