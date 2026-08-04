/**
 * AIRider — a CPU rider that is a real physics rider.
 *
 * The single most important decision in this file: the AI does NOT drive along
 * the spline. It produces a BikeInput — steer, pedal, brake, crouch, air
 * rotation — and hands it to the same IBike the player uses. Everything else
 * follows from that. It can enter a corner too fast and slide off the outside.
 * It can mistime a preload and jump flat. It can be knocked off line by another
 * rider and have to recover. None of that is scripted; it falls out of feeding
 * a slightly-wrong input into a correct simulation.
 *
 * The controller is a three-layer stack:
 *
 *   1. TrackTracker  — where am I on the ribbon? Maintained incrementally with
 *      a local Newton correction, so we call the (allocating) ITrack.project
 *      only a few times a second instead of 120.
 *   2. Planner (~15Hz, staggered per rider) — reads the track and the terrain
 *      ahead and produces a target speed, a target lateral offset, and the
 *      distance to the next launch. This is where the expensive work lives.
 *   3. Controller (every physics step) — a PD loop on heading error toward a
 *      lookahead point, plus speed control, plus the preload/air state machine.
 *
 * Layer 2 is deliberately slow and layer 3 deliberately fast: a rider that
 * re-planned every step would be superhuman, and one that steered at 15Hz would
 * weave. The lag between them is a large part of why they feel human.
 *
 * This file also houses two things shared with PlayerRacer, because they belong
 * to "the rider layer" rather than to the AI specifically: TrackTracker and
 * TrickDriver.
 */

import { Object3D, Quaternion, Vector3 } from 'three';

import {
  BikeInput,
  BikeMode,
  BikeState,
  IBike,
  IRacer,
  IRiderRig,
  ITerrain,
  ITrack,
  RaceContext,
  RacePhase,
  RacerProgress,
  TrackSampleResult,
  TrackSectionKind,
  TrickKind,
  TrickState,
} from '../game/Contracts';
import { BIKE, COUNTDOWN_SECONDS } from '../game/WorldConstants';
import { Rng } from '../core/RNG';
import {
  clamp,
  clamp01,
  dampHL,
  lerp,
  moveTowards,
  shortAngle,
  smoothstep,
} from '../core/MathX';
import { Personality, RunForm, cautionScalar, rollRunForm } from './Personality';

// ── Module-scope scratch. Nothing in an update path may allocate. ────────────
const _v0 = new Vector3();
const _v1 = new Vector3();
const _v2 = new Vector3();
const _v3 = new Vector3();
const _q0 = new Quaternion();

const FORWARD = new Vector3(0, 0, 1);
const UP = new Vector3(0, 1, 0);

/**
 * The lateral acceleration a rider plans around, as a fraction of grip*gravity.
 * The physical limit is far higher than anyone rides at, so planning against the
 * raw limit produces an AI that never touches the brakes. 0.55 puts the planned
 * corner speed roughly where a good human ends up.
 */
const LATERAL_BUDGET = 0.55;

/**
 * A single scalar on the AI steer output, kept at 1.0 — and the swept data
 * saying why a scalar is the wrong tool here.
 *
 * The bike was made much more responsive for the player (lean servo gains
 * roughly doubled, lateral grip up a quarter, max lean 49 to 58 degrees: at
 * full lock for two seconds it went from 45 degrees of heading change with 2
 * degrees of lean to 94 with 46). The personalities' gains are all "steer
 * command per radian of heading error", so they only mean anything against a
 * fixed vehicle response, and the obvious move is to scale them.
 *
 * There is no scale that works. Worst excursion per rider, in metres:
 *
 *   trim   ai0    ai1    ai2    sum
 *   0.55   35.8   20.9    6.4   63.1
 *   1.00   15.5    5.6    6.3   27.4
 *   1.35    7.5   34.9    5.5   47.9
 *   1.80    8.7   40.0   33.2   81.9
 *
 * ai0 wants MORE gain and ai1 wants much less; they are different personalities
 * with different steerKp/Kd/lateralGain and their optima genuinely diverge.
 * 1.0 is the best available compromise and it is a compromise, not a solution.
 * The real fix is a per-personality re-tune against the current bike, which is
 * a subsystem pass and is written down here rather than hidden behind a number
 * that looks tuned.
 */
const AI_RESPONSE_TRIM = 1.0;

/** How far ahead the planner scans for corners, metres. */
const CORNER_SCAN = 110;
/** Sampling step for that scan, metres. Fine enough to catch a hairpin entry. */
const CORNER_STEP = 5;
/** How far ahead the planner looks for a jump lip, metres. */
const LIP_SCAN = 55;
const LIP_STEP = 2.5;

/** Planner rate. Staggered by rider index so they never all plan on one frame. */
const PLAN_INTERVAL = 1 / 15;

// ─────────────────────────────────────────────────────────────────────────────
// TrackTracker
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Maintains "where is this racer on the ribbon" without calling ITrack.project
 * every step. project() allocates a result object and does a global search; at
 * 4 racers × 120Hz that is 480 allocations a second for information that changes
 * smoothly.
 *
 * Instead we integrate the tangential velocity and then apply one Newton step —
 * the longitudinal residual between the racer and the sampled centreline point
 * IS the distance error, to first order — which locks the estimate to the spline
 * for free. A full project() runs a few times a second purely to recover from
 * teleports, big air over a corner cut, and accumulated curvature error.
 */
export class TrackTracker {
  /** Distance along the centreline, metres. */
  distance = 0;
  /** Signed lateral offset, metres. Positive = left of centre. */
  lateral = 0;
  /** Height above the ribbon surface, metres. */
  vertical = 0;
  /** The centreline sample at `distance`. Reused; never hold a reference. */
  readonly sample: TrackSampleResult;
  /** Signed speed along the track tangent, m/s. Negative = going backwards. */
  alongSpeed = 0;

  private track: ITrack;
  private sinceProject: number;
  private projectInterval: number;

  constructor(track: ITrack, phase = 0, projectInterval = 0.25) {
    this.track = track;
    this.projectInterval = projectInterval;
    this.sinceProject = phase * projectInterval;
    this.sample = track.sampleAtDistance(0);
  }

  reset(position: Vector3, hint = 0): void {
    const p = this.track.project(position, hint);
    this.distance = p.distance;
    this.lateral = p.lateral;
    this.vertical = p.vertical;
    copySample(p.sample, this.sample);
    this.alongSpeed = 0;
    this.sinceProject = 0;
  }

  update(position: Vector3, velocity: Vector3, dt: number): void {
    const s = this.sample;
    this.alongSpeed = velocity.dot(s.tangent);
    this.distance += this.alongSpeed * dt;

    this.sinceProject += dt;
    if (this.sinceProject >= this.projectInterval) {
      this.sinceProject = 0;
      // hintDistance keeps the search local; the track implementation is free to
      // ignore it, in which case this is simply a little slower.
      const p = this.track.project(position, this.distance);
      this.distance = p.distance;
      this.lateral = p.lateral;
      this.vertical = p.vertical;
      copySample(p.sample, this.sample);
      return;
    }

    this.distance = clamp(this.distance, 0, this.track.length);
    this.track.sampleAtDistance(this.distance, s);

    // One Newton correction: project the offset onto the tangent and fold it
    // back into the arc length. Damped at 0.7 so a bad sample cannot oscillate.
    _v0.copy(position).sub(s.position);
    const longitudinal = _v0.dot(s.tangent);
    if (Math.abs(longitudinal) > 0.02) {
      this.distance = clamp(this.distance + longitudinal * 0.7, 0, this.track.length);
      this.track.sampleAtDistance(this.distance, s);
      _v0.copy(position).sub(s.position);
    }
    this.lateral = _v0.dot(s.left);
    this.vertical = _v0.dot(s.up);
  }
}

function copySample(src: TrackSampleResult, dst: TrackSampleResult): void {
  dst.position.copy(src.position);
  dst.tangent.copy(src.tangent);
  dst.left.copy(src.left);
  dst.up.copy(src.up);
  dst.halfWidth = src.halfWidth;
  dst.bank = src.bank;
  dst.curvature = src.curvature;
  dst.distance = src.distance;
  dst.t = src.t;
  dst.section = src.section;
}

// ─────────────────────────────────────────────────────────────────────────────
// TrickDriver
// ─────────────────────────────────────────────────────────────────────────────

/** Base score for each trick, before the air-time and cleanliness multipliers. */
const TRICK_SCORE: Record<TrickKind, number> = {
  [TrickKind.None]: 0,
  [TrickKind.Manual]: 24,
  [TrickKind.XUp]: 90,
  [TrickKind.Tabletop]: 130,
  [TrickKind.NoFooter]: 150,
  [TrickKind.Superman]: 210,
  [TrickKind.Tailwhip]: 260,
  [TrickKind.Spin360]: 320,
  [TrickKind.Frontflip]: 520,
  [TrickKind.Backflip]: 560,
};

/**
 * Turns "what the rider is doing in the air" into the TrickState the rig poses
 * from and the score the HUD shows.
 *
 * This lives in the AI package because somebody has to own it and both racer
 * types need it. If the bike physics ships its own trick state, RacerBase picks
 * that up instead (see `adoptExternalTrick`) and this driver stands down — the
 * one place in the subsystem where we sniff for another agent's implementation,
 * because duplicating trick scoring would be worse than the sniff.
 */
export class TrickDriver {
  readonly state: TrickState = {
    kind: TrickKind.None,
    phase: 0,
    rotations: 0,
    pendingScore: 0,
    committed: true,
  };

  /** Set by the rider each step: which pose trick is being held, if any. */
  poseIntent: TrickKind = TrickKind.None;

  private yawAccum = 0;
  private pitchAccum = 0;
  private airborne = false;
  private bankedThisAir = 0;
  private landedScore = 0;
  private landedKind: TrickKind = TrickKind.None;

  /** Score banked on the most recent landing; read once then cleared. */
  takeLanded(): { kind: TrickKind; score: number } | null {
    if (this.landedScore <= 0) return null;
    const r = { kind: this.landedKind, score: this.landedScore };
    this.landedScore = 0;
    this.landedKind = TrickKind.None;
    return r;
  }

  update(state: BikeState, input: BikeInput, dt: number): void {
    const s = this.state;
    const air = state.mode === BikeMode.Airborne;

    if (air && !this.airborne) {
      // Takeoff — clear the slate.
      this.yawAccum = 0;
      this.pitchAccum = 0;
      this.bankedThisAir = 0;
      s.rotations = 0;
      s.kind = TrickKind.None;
      s.pendingScore = 0;
      s.phase = 0;
      s.committed = false;
    }

    if (air) {
      // Integrate intent, not the bike's actual angular velocity: the rider's
      // commitment is what scores, and reading the physics back would double
      // count the rotation the landing tolerance is already judging.
      this.yawAccum += input.airYaw * BIKE.airYawRate * dt;
      this.pitchAccum += input.airPitch * BIKE.airPitchRate * dt;

      const spins = Math.abs(this.yawAccum) / (Math.PI * 2);
      const flips = Math.abs(this.pitchAccum) / (Math.PI * 2);

      let kind = this.poseIntent;
      let rotations = 0;
      if (flips >= spins && flips > 0.22) {
        kind = this.pitchAccum > 0 ? TrickKind.Backflip : TrickKind.Frontflip;
        rotations = flips;
      } else if (spins > 0.22) {
        kind = TrickKind.Spin360;
        rotations = spins;
      }
      s.kind = kind;
      s.rotations = rotations;

      // Pose tricks ramp in over ~0.22s and hold; rotation tricks use the
      // fractional rotation as their phase so the rig can pose through it.
      if (rotations > 0) {
        s.phase = rotations % 1;
      } else if (kind !== TrickKind.None) {
        s.phase = clamp01(s.phase + dt / 0.22);
      } else {
        s.phase = Math.max(0, s.phase - dt / 0.16);
      }

      // Committed = the trick has been returned to neutral and could be landed.
      // Rotations must be within ~28° of a whole turn; poses must be released.
      const rotFrac = rotations > 0 ? Math.abs(rotations - Math.round(rotations)) : 0;
      const poseHome = kind === TrickKind.None || this.poseIntent === TrickKind.None;
      s.committed = (rotations === 0 || rotFrac < 0.078) && (poseHome || rotations > 0);

      const whole = rotations > 0 ? Math.max(0, Math.round(rotations)) : 0;
      const base = TRICK_SCORE[s.kind] ?? 0;
      const rotMul = whole > 0 ? whole + (whole - 1) * 0.45 : 1; // doubles pay more
      const airMul = 1 + clamp01(state.airTime / 2.2) * 0.6;
      s.pendingScore = kind === TrickKind.None ? 0 : Math.round(base * rotMul * airMul);
    } else {
      if (this.airborne) {
        // Landing resolution.
        if (s.committed && s.pendingScore > 0 && state.mode !== BikeMode.Crashing) {
          const quality = clamp01(state.landingQuality || 0.7);
          this.landedScore = Math.round(s.pendingScore * lerp(0.55, 1.15, quality));
          this.landedKind = s.kind;
          this.bankedThisAir = this.landedScore;
        }
        s.kind = TrickKind.None;
        s.pendingScore = 0;
        s.rotations = 0;
        s.committed = true;
      }
      // A manual on the ground is a trick too — small, continuous, and the only
      // scoring the player gets on a flat section.
      if (state.manualling && state.manualAmount > 0.35) {
        s.kind = TrickKind.Manual;
        s.phase = state.manualAmount;
        s.pendingScore = 0;
        this.landedScore += TRICK_SCORE[TrickKind.Manual] * dt;
        this.landedKind = TrickKind.Manual;
      } else if (s.kind === TrickKind.Manual) {
        s.kind = TrickKind.None;
        s.phase = 0;
      }
    }

    this.airborne = air;
    void this.bankedThisAir;
  }

  reset(): void {
    const s = this.state;
    s.kind = TrickKind.None;
    s.phase = 0;
    s.rotations = 0;
    s.pendingScore = 0;
    s.committed = true;
    this.yawAccum = this.pitchAccum = 0;
    this.airborne = false;
    this.landedScore = 0;
    this.landedKind = TrickKind.None;
    this.poseIntent = TrickKind.None;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// RacerBase
// ─────────────────────────────────────────────────────────────────────────────

export interface RacerInit {
  id: string;
  name: string;
  colorIndex: number;
  bike: IBike;
  rig: IRiderRig;
  terrain: ITerrain;
  track: ITrack;
  checkpointCount: number;
  startPosition: Vector3;
  startForward: Vector3;
  phase: number;
}

/*
 * POST-MORTEM: the steering trim that used to live here, and what it was
 * really measuring. Kept because the data is the clearest example in this
 * repo of a measurement that is entirely real and entirely misread.
 *
 * A global `AI_STEER_TRIM = 0.36` multiplied the steer command. It was swept
 * against a 180-frame pack-race run, recording what fraction of frames the
 * controller spent at full lock, how far off the racing line it wandered, and
 * how much course it actually covered:
 *
 *   gain x   saturated   max |lat|   moved   end speed
 *      1.0        92%       3.9 m     23 m     7 km/h
 *      0.7        59%       6.8 m     23 m    12 km/h
 *      0.5        44%       7.6 m     32 m    37 km/h
 *      0.35       36%      24.3 m     26 m    21 km/h
 *      0.25       18%      25.7 m     40 m    27 km/h
 *
 * Every number in that table is accurate. The conclusion drawn from it — that
 * 0.36 was "the knee", a real trade-off between sawing the bars and drifting
 * off line — was wrong, and the table itself says so if you read it as
 * evidence about the SIGN rather than the gain.
 *
 * The steer command was inverted (see the note at the use site). So the loop
 * was positive feedback, and the sweep was measuring how fast a divergent loop
 * diverges. At gain 1.0 it slams to full lock in a fraction of a second and
 * stays there, which is why max lateral is SMALLEST at the highest gain — the
 * rider is pinned in a circle, not holding a line. Reducing the gain does not
 * trade accuracy for smoothness, it just weakens the divergence, so every step
 * down looks like an improvement in "moved" and "end speed" and never bottoms
 * out. A sweep whose answer is "less, and still less" all the way to the edge
 * of its range is not reporting an optimum. It is reporting the wrong sign.
 *
 * With the sign corrected the trim is gone entirely — not retuned, removed —
 * and the personalities run at their authored gains.
 */

/** Shared plumbing: progress bookkeeping, the scene node, trick adoption. */

export abstract class RacerBase implements IRacer {
  readonly id: string;
  readonly bike: IBike;
  readonly rig: IRiderRig;
  readonly progress: RacerProgress;
  readonly object = new Object3D();

  protected terrain: ITerrain;
  protected track: ITrack;
  protected tracker: TrackTracker;
  protected trickDriver = new TrickDriver();
  /** Non-null when the bike ships its own trick state and we defer to it. */
  protected externalTrick: TrickState | null = null;

  protected startPosition = new Vector3();
  protected startForward = new Vector3(0, 0, 1);

  readonly input: BikeInput = {
    steer: 0,
    pedal: 0,
    brakeRear: 0,
    brakeFront: 0,
    crouch: 0,
    pitchLean: 0,
    airPitch: 0,
    airYaw: 0,
    airRoll: 0,
    wantBoost: false,
    wantHop: false,
  };

  constructor(init: RacerInit) {
    this.id = init.id;
    this.bike = init.bike;
    this.rig = init.rig;
    this.terrain = init.terrain;
    this.track = init.track;
    this.startPosition.copy(init.startPosition);
    this.startForward.copy(init.startForward);

    this.object.name = `racer:${init.id}`;
    // Only adopt children that nobody else has parented — the bike and rig
    // factories are another agent's code and may already have placed them.
    if (!this.bike.object.parent) this.object.add(this.bike.object);
    if (!this.rig.object.parent) this.object.add(this.rig.object);

    this.tracker = new TrackTracker(init.track, init.phase);

    this.progress = {
      id: init.id,
      name: init.name,
      isPlayer: false,
      distance: 0,
      position: 1,
      raceTime: 0,
      finished: false,
      finishTime: null,
      splits: new Array(init.checkpointCount).fill(null),
      trickScore: 0,
      gapAhead: null,
      colorIndex: init.colorIndex,
      crashCount: 0,
    };

    this.adoptExternalTrick();
  }

  /**
   * If the bike physics exposes a `trick: TrickState`, that is the authority and
   * our driver becomes a no-op mirror. Checked once at construction.
   */
  private adoptExternalTrick(): void {
    const maybe = (this.bike as unknown as { trick?: TrickState }).trick;
    if (maybe && typeof maybe === 'object' && 'kind' in maybe && 'phase' in maybe) {
      this.externalTrick = maybe;
    }
  }

  get trick(): TrickState {
    return this.externalTrick ?? this.trickDriver.state;
  }

  /** Track-space distance, used by the director for positions. */
  get trackDistance(): number {
    return this.tracker.distance;
  }

  get trackLateral(): number {
    return this.tracker.lateral;
  }

  get trackSample(): TrackSampleResult {
    return this.tracker.sample;
  }

  /**
   * Re-seat this racer's track tracker after an external teleport.
   *
   * The capture harness moves racers straight to a point on the course, but the
   * tracker kept its previous distance — so an AI woke up believing it was
   * still on the start line and steered toward a target hundreds of metres
   * behind it. Measured: the pack covered 0 m in 40 s at a mean 1.16 m/s and
   * sat 97-98% off-track from frame zero. No capture has ever contained AI
   * riders actually riding.
   */
  reseat(position: Vector3, hintDistance = 0): void {
    this.tracker.reset(position, hintDistance);
    this.progress.distance = this.tracker.distance;
  }

  abstract gatherInput(dt: number, ctx: RaceContext): BikeInput;

  update(dt: number, _ctx: RaceContext): void {
    const s = this.bike.state;
    this.tracker.update(s.position, s.velocity, dt);
  }

  updateVisual(alpha: number, dt: number, time: number): void {
    this.bike.updateVisual(alpha, dt);
    this.rig.update(this.bike.state, this.trick, dt, time);
  }

  /** Called after the physics step so trick state sees the resolved landing. */
  postStep(dt: number): void {
    if (!this.externalTrick) this.trickDriver.update(this.bike.state, this.input, dt);
    const banked = this.trickDriver.takeLanded();
    if (banked) this.progress.trickScore += Math.round(banked.score);
  }

  reset(): void {
    this.bike.reset(this.startPosition, this.startForward);
    this.trickDriver.reset();
    this.tracker.reset(this.startPosition, 0);
    const p = this.progress;
    p.distance = 0;
    p.position = 1;
    p.raceTime = 0;
    p.finished = false;
    p.finishTime = null;
    p.splits.fill(null);
    p.trickScore = 0;
    p.gapAhead = null;
    p.crashCount = 0;
    zeroInput(this.input);
  }

  dispose(): void {
    this.bike.dispose();
    this.rig.dispose();
    this.object.removeFromParent();
  }
}

export function zeroInput(i: BikeInput): void {
  i.steer = 0;
  i.pedal = 0;
  i.brakeRear = 0;
  i.brakeFront = 0;
  i.crouch = 0;
  i.pitchLean = 0;
  i.airPitch = 0;
  i.airYaw = 0;
  i.airRoll = 0;
  i.wantBoost = false;
  i.wantHop = false;
}

// ─────────────────────────────────────────────────────────────────────────────
// AIRider
// ─────────────────────────────────────────────────────────────────────────────

export interface AIRiderInit extends RacerInit {
  personality: Personality;
  rng: Rng;
  /** 0..1 rubber-band scalar supplier, owned by the race director. */
  index: number;
}

/** What the planner produces. Read every step by the controller. */
interface Plan {
  /** Speed the rider is trying to hold right now, m/s. */
  targetSpeed: number;
  /** Where on the ribbon they want to be, metres from centre (left positive). */
  targetLateral: number;
  /** Distance ahead to the next launch point, metres. Infinity if none. */
  lipDistance: number;
  /** How much drop is on the far side of that launch, metres. */
  lipDrop: number;
  /** 0..1 how urgently they need to slow down. Drives brake blend. */
  brakeUrgency: number;
  /** Curvature at the corner they are planning for, signed. */
  planCurvature: number;
  /** Terrain roughness score ahead, 0 = billiard table. */
  roughness: number;
}

export class AIRider extends RacerBase {
  readonly personality: Personality;
  readonly form: RunForm;

  private rng: Rng;
  private plan: Plan = {
    targetSpeed: 10,
    targetLateral: 0,
    lipDistance: Infinity,
    lipDrop: 0,
    brakeUrgency: 0,
    planCurvature: 0,
    roughness: 0,
  };
  private planTimer: number;

  /** Rubber-band multiplier, set by the race director. 0.94 .. 1.06. */
  rubberBand = 1;

  // Controller state.
  private prevHeadingError = 0;
  private steerOut = 0;
  private smoothedTargetLateral = 0;
  private smoothedTargetSpeed = 10;
  private clock = 0;

  // Mistake state.
  private wobbleTime = 0;
  private wobbleDuration = 0;
  private wobbleDir = 1;
  private wobbleMag = 0;
  private sinceCrash = 999;

  // Jump state machine.
  private launchArmed = false;
  private launchTimingError = 0;
  private launchDistance = Infinity;
  private preloadOut = 0;
  private hopLatch = false;

  // Air state.
  private airPlan: TrickKind = TrickKind.None;
  private airRotSign = 1;
  private airDecided = false;

  // Avoidance, recomputed per step (cheap — three neighbours).
  private avoidLateral = 0;
  private avoidBrake = 0;

  private scratchSample: TrackSampleResult;

  constructor(init: AIRiderInit) {
    super(init);
    this.personality = init.personality;
    this.rng = init.rng;
    this.form = rollRunForm(init.personality, init.rng);
    // Stagger planning so four riders never plan on the same frame.
    this.planTimer = (init.index / 4) * PLAN_INTERVAL;
    this.scratchSample = init.track.sampleAtDistance(0);
    this.smoothedTargetLateral = this.form.lineOffset * 3;
  }

  override reset(): void {
    super.reset();
    this.plan.targetSpeed = 8;
    this.plan.targetLateral = 0;
    this.plan.lipDistance = Infinity;
    this.plan.brakeUrgency = 0;
    this.prevHeadingError = 0;
    this.steerOut = 0;
    this.smoothedTargetSpeed = 8;
    this.smoothedTargetLateral = this.form.lineOffset * 3;
    this.wobbleTime = 0;
    this.sinceCrash = 999;
    this.launchArmed = false;
    this.launchDistance = Infinity;
    this.preloadOut = 0;
    this.airDecided = false;
    this.avoidLateral = 0;
    this.avoidBrake = 0;
    this.clock = 0;
  }

  // ── Bookkeeping + planning ────────────────────────────────────────────────
  override update(dt: number, ctx: RaceContext): void {
    super.update(dt, ctx);
    this.clock += dt;
    this.sinceCrash += dt;

    const st = this.bike.state;
    if (st.crashedThisStep) {
      this.sinceCrash = 0;
      // A crash cancels any jump intent; nobody preloads while sliding.
      this.launchArmed = false;
      this.wobbleTime = 0;
    }

    this.planTimer -= dt;
    if (this.planTimer <= 0) {
      this.planTimer += PLAN_INTERVAL;
      this.replan(ctx);
    }

    this.updateWobble(dt);
  }

  // ── The planner ───────────────────────────────────────────────────────────
  /**
   * Runs at 15Hz. Everything expensive is here: the corner scan, the lip scan,
   * and the terrain line search. Splitting it out of the per-step controller is
   * what keeps four AI riders at well under a millisecond a frame.
   */
  private replan(ctx: RaceContext): void {
    const p = this.personality;
    const st = this.bike.state;
    const here = this.tracker.sample;
    const d0 = this.tracker.distance;
    const speed = Math.max(st.speed, 0.5);
    const caution = cautionScalar(p, this.sinceCrash);

    const grip = st.rear.surface?.grip ?? 1;
    const latBudget = grip * BIKE.gravity * LATERAL_BUDGET * p.cornerSpeedMul * caution;

    // ── Corner scan. Find the binding constraint: the corner whose entry speed
    // we cannot reach if we do not start braking now. Walking outward and
    // keeping the minimum permitted speed is the standard formulation and it
    // handles a sequence of tightening corners (the switchbacks) correctly.
    let permitted = p.straightSpeedMul * BIKE.spinOutSpeed * 1.35;
    let urgency = 0;
    let planCurv = here.curvature;
    const brakeAccel = p.planBrakeAccel * caution;

    for (let d = 0; d <= CORNER_SCAN; d += CORNER_STEP) {
      const sd = Math.min(d0 + d, this.track.length);
      const s = this.track.sampleAtDistance(sd, this.scratchSample);
      const k = Math.abs(s.curvature);

      // Corner speed from the lateral budget, helped by bank.
      const bankHelp = 1 + Math.abs(s.bank) * 0.55;
      let vCorner = k > 1e-4 ? Math.sqrt((latBudget * bankHelp) / k) : Infinity;

      // Narrow ribbon is its own speed limit — the ridge is not a grip problem,
      // it is a "there is nothing either side of you" problem.
      const vWidth = 8.5 + s.halfWidth * 1.9;
      vCorner = Math.min(vCorner, vWidth * (0.94 + p.cornerSpeedMul * 0.1));

      if (s.section === TrackSectionKind.RockGarden) vCorner = Math.min(vCorner, 15.5 * p.cornerSpeedMul);
      if (s.section === TrackSectionKind.StreamBed) vCorner = Math.min(vCorner, 14.0 * p.cornerSpeedMul);

      if (!isFinite(vCorner)) continue;

      // Distance we would need to shed the excess, scaled by the personality's
      // brake-point bias. Bias < 1 = commits later than physics allows.
      const need = Math.max(0, (speed * speed - vCorner * vCorner) / (2 * brakeAccel));
      const trigger = need / Math.max(p.brakePointBias, 0.2);
      if (d <= trigger) {
        if (vCorner < permitted) {
          permitted = vCorner;
          planCurv = s.curvature;
        }
        urgency = Math.max(urgency, clamp01((trigger - d) / Math.max(trigger, 1) + 0.15));
      } else if (d < 18 && vCorner < permitted) {
        // Already in the corner — hold its speed even if no braking is needed.
        permitted = vCorner;
        planCurv = s.curvature;
      }
    }

    // ── Speed noise. Low-frequency, per-rider phase. This is the difference
    // between a rider who is "always 0.4s a lap slower" and one who is
    // inconsistent — the erratic rider's amplitude is 7x the clean rider's.
    const noise =
      Math.sin(this.clock * p.speedNoiseFreq * Math.PI * 2 + this.form.noisePhase) * 0.62 +
      Math.sin(this.clock * p.speedNoiseFreq * 2.7 * Math.PI * 2 + this.form.noisePhase * 1.7) * 0.38;

    let target = permitted * this.form.formMul * (1 + noise * p.speedNoiseAmp) * this.rubberBand;

    // A rider in a crash/recovery mode has no speed target worth speaking of.
    if (st.mode === BikeMode.Crashing || st.mode === BikeMode.Recovering) target = Math.min(target, 6);

    // ── Off the trail ───────────────────────────────────────────────────────
    // Every speed above is derived from the TRACK: its curvature, its bank, its
    // width. None of that describes the open mountainside, and the controller
    // had no notion that it might not be on the track at all — so a rider who
    // ran wide kept racing at trail pace across terrain with no trail in it,
    // got further out, and eventually wedged against a slope it could not
    // climb. Measured after 100 s: lateral -20.6 m and -12.5 m on a trail whose
    // half-width is 4.6 m, both pinned at full lock and 2 km/h.
    //
    // A real rider who has run off does one thing first: slows down enough to
    // get back on. Scaled by how far out they are, and floored so they keep
    // enough momentum to actually climb back rather than bogging in scree.
    const offBy = Math.abs(this.tracker.lateral) - here.halfWidth;
    if (offBy > 0.5) {
      const out = clamp01((offBy - 0.5) / 6);
      target = Math.min(target, lerp(target, 6.5, out * p.recoverySkill));
    }

    // ── Lip scan ────────────────────────────────────────────────────────────
    // Runs before the line choice because it also produces the roughness figure
    // the line search keys off, and a one-tick-stale roughness is exactly the
    // sort of thing that makes a rider hit the first boulder of a rock garden.
    const lip = this.scanForLaunch(d0, here);
    this.plan.roughness = lip.roughness;

    // ── Line choice ─────────────────────────────────────────────────────────
    const lateralTarget = this.chooseLine(d0, here, planCurv, speed);

    const plan = this.plan;
    plan.targetSpeed = target;
    plan.targetLateral = lateralTarget;
    plan.brakeUrgency = urgency;
    plan.planCurvature = planCurv;
    plan.lipDistance = lip.distance;
    plan.lipDrop = lip.drop;
    plan.roughness = lip.roughness;

    // Arm the jump once, with a fresh timing error drawn per launch. Drawing it
    // once per launch (not per frame) is what makes a mistimed jump a discrete,
    // readable event rather than jitter.
    if (isFinite(lip.distance) && lip.distance < LIP_SCAN) {
      if (!this.launchArmed || lip.distance > this.launchDistance + 6) {
        this.launchArmed = true;
        this.launchTimingError = clamp(this.rng.gaussian(), -2.4, 2.4) * p.preloadSigma * this.form.riskMul;
      }
      this.launchDistance = lip.distance;
    } else if (this.launchArmed && !isFinite(lip.distance)) {
      this.launchArmed = false;
      this.launchDistance = Infinity;
    }

    // Wobble scheduling. Probability scales with how hard the rider is working:
    // lateral load, surface, roughness, and their own risk multiplier.
    this.rollWobble(st, planCurv, speed, grip, lip.roughness, ctx.dt);
  }

  /**
   * Racing line. Three additive terms:
   *   • the geometric line — outside on entry, inside at the apex;
   *   • the personality's resting offset plus a slow drift;
   *   • a terrain search through genuinely broken ground.
   */
  private chooseLine(d0: number, here: TrackSampleResult, planCurv: number, speed: number): number {
    const p = this.personality;
    const hw = here.halfWidth;

    // Geometric line. Positive curvature = turning left, so the apex is on the
    // left (positive lateral) and the entry is on the right.
    const lookCorner = clamp(speed * 1.15, 12, 34);
    const sAhead = this.track.sampleAtDistance(Math.min(d0 + lookCorner, this.track.length), this.scratchSample);
    const kNow = here.curvature;
    const kAhead = sAhead.curvature;

    // If the corner ahead is sharper than the one under us, we are on entry:
    // set up wide. If it is easing, we are on exit: run wide again. At the apex
    // both are similar and large, so we sit inside.
    const entering = Math.abs(kAhead) > Math.abs(kNow) + 2e-4;
    const kRef = entering ? kAhead : kNow;
    const strength = clamp01(Math.abs(kRef) * 260) * p.apexAggression * lerp(0.7, 1.15, this.form.commitment);

    // Sign: apex side is the inside of the turn = the direction of curvature.
    const apexSide = kRef > 0 ? 1 : -1;
    const geometric = entering ? -apexSide * strength : apexSide * strength;

    // Resting offset + drift.
    const drift =
      Math.sin(this.clock * p.lineDriftFreq * Math.PI * 2 + this.form.driftPhase) * p.lineDriftAmp;
    let offset = (this.form.lineOffset + drift + geometric) * hw * 0.82;

    // Terrain search — only where it earns its cost. Through the rock garden and
    // the stream bed the ribbon is deliberately broken, and a rider who ignores
    // that ploughs into every boulder on the course.
    if (
      here.section === TrackSectionKind.RockGarden ||
      here.section === TrackSectionKind.StreamBed ||
      this.plan.roughness > 0.6
    ) {
      offset = this.searchSmoothLine(d0, here, offset);
    }

    return clamp(offset, -hw * 0.94, hw * 0.94);
  }

  /**
   * Five candidate lateral offsets scored by how rough the ground under them is
   * over the next ~22m. Cheap: 5 × 3 heightAt calls, at 15Hz, per rider.
   */
  private searchSmoothLine(d0: number, here: TrackSampleResult, bias: number): number {
    const hw = here.halfWidth;
    let bestOffset = bias;
    let bestScore = -Infinity;

    for (let c = 0; c < 5; c++) {
      const off = (c / 4 - 0.5) * 2 * hw * 0.88;
      let rough = 0;
      for (let j = 1; j <= 3; j++) {
        const d = Math.min(d0 + j * 7.5, this.track.length);
        const s = this.track.sampleAtDistance(d, this.scratchSample);
        _v0.copy(s.position).addScaledVector(s.left, off);
        const h = this.terrain.heightAt(_v0.x, _v0.z);
        // Deviation from the ribbon surface IS the obstacle metric — a boulder
        // reads as a positive spike and a hole as a negative one, and both are
        // things you do not want to hit at 18 m/s.
        rough += Math.abs(h - s.position.y);
      }
      // Prefer smooth ground, then proximity to the line we already wanted.
      const score = -rough * 1.0 - Math.abs(off - bias) * 0.42;
      if (score > bestScore) {
        bestScore = score;
        bestOffset = off;
      }
    }
    // Never fully abandon the racing line for a marginally smoother rut.
    return lerp(bias, bestOffset, 0.72);
  }

  /**
   * Find the next place the rider will leave the ground. Two detectors:
   *   • a convex crest in the ribbon itself (the tabletop lip);
   *   • the terrain falling away from under the ribbon (the ravine, drop-offs).
   * Also accumulates a roughness figure the planner reuses for line choice and
   * wobble probability, since we are already walking the track here.
   */
  private scanForLaunch(d0: number, here: TrackSampleResult): { distance: number; drop: number; roughness: number } {
    let prevY = here.position.y;
    let prevSlope = 0;
    let found = Infinity;
    let drop = 0;
    let roughness = 0;
    let n = 0;

    for (let d = LIP_STEP; d <= LIP_SCAN; d += LIP_STEP) {
      const sd = Math.min(d0 + d, this.track.length);
      const s = this.track.sampleAtDistance(sd, this.scratchSample);
      const y = s.position.y;
      const slope = (y - prevY) / LIP_STEP;

      const ground = this.terrain.heightAt(s.position.x, s.position.z);
      const gap = s.position.y - ground;
      roughness += Math.abs(gap);
      n++;

      if (!isFinite(found)) {
        // Convex crest: the ribbon stops climbing and starts falling hard.
        if (d > LIP_STEP && prevSlope > -0.02 && slope < -0.16 && prevSlope - slope > 0.19) {
          found = d;
          drop = Math.max(0, prevY - y) * 4;
        }
        // Ground falls out from under the ribbon — a gap, not a lip.
        if (gap > 3.0) {
          found = Math.max(0, d - LIP_STEP);
          drop = gap;
        }
      }
      prevY = y;
      prevSlope = slope;
    }
    return { distance: found, drop, roughness: n > 0 ? roughness / n : 0 };
  }

  // ── Mistakes ──────────────────────────────────────────────────────────────
  private rollWobble(st: BikeState, curvature: number, speed: number, grip: number, roughness: number, dt: number): void {
    if (this.wobbleTime > 0) return;
    if (st.mode !== BikeMode.Grounded) return;
    const p = this.personality;

    // Load = how close the rider is to the friction limit right now.
    const latAccel = Math.abs(curvature) * speed * speed;
    const load = clamp01(latAccel / Math.max(grip * BIKE.gravity * 0.7, 1e-3));
    const slipTerm = clamp01((Math.abs(st.rear.lateralSlip) + Math.abs(st.front.lateralSlip)) / 5);
    const gripTerm = clamp01((1 - grip) * 1.5);
    const roughTerm = clamp01(roughness / 2.2);

    const rate =
      p.wobbleRate *
      this.form.riskMul *
      (0.22 + load * 1.5 + slipTerm * 1.1 + gripTerm * 0.8 + roughTerm * 0.7) *
      (this.sinceCrash < p.postCrashCaution ? 0.35 : 1);

    // Poisson trial over the planner interval, not the step, or the rate would
    // silently depend on the physics tick.
    if (this.rng.next() < rate * PLAN_INTERVAL) {
      this.wobbleDuration = 0.34 + this.rng.next() * 0.5;
      this.wobbleTime = this.wobbleDuration;
      this.wobbleDir = this.rng.chance(0.5) ? 1 : -1;
      // A wobble away from the corner's load is far more likely to become a
      // real loss of front end, which is why it is weighted toward the outside.
      if (Math.abs(curvature) > 4e-4 && this.rng.chance(0.65)) this.wobbleDir = curvature > 0 ? -1 : 1;
      this.wobbleMag = p.wobbleAmplitude * (0.6 + this.rng.next() * 0.7) * lerp(1.25, 0.7, p.recoverySkill);
    }
    void dt;
  }

  private updateWobble(dt: number): void {
    if (this.wobbleTime <= 0) return;
    this.wobbleTime -= dt;
    if (this.wobbleTime <= 0) this.wobbleTime = 0;
  }

  /** The disturbance to add to steer this step, and any brake panic with it. */
  private wobbleSteer(): number {
    if (this.wobbleTime <= 0) return 0;
    const p = this.personality;
    const k = this.wobbleTime / Math.max(this.wobbleDuration, 1e-3); // 1 → 0
    // Attack fast, then the rider's recovery skill decides how fast it decays.
    const env = Math.sin(k * Math.PI) * Math.pow(k, lerp(0.35, 1.9, p.recoverySkill));
    return this.wobbleDir * this.wobbleMag * env;
  }

  // ── Avoidance ─────────────────────────────────────────────────────────────
  /**
   * Lateral bias away from nearby riders. Deliberately asymmetric: a rider being
   * overtaken defends less than the overtaker attacks, so passes actually
   * complete instead of two riders locking side by side for a whole section.
   */
  private computeAvoidance(ctx: RaceContext): void {
    const p = this.personality;
    const me = this.bike.state;
    const s = this.tracker.sample;
    let bias = 0;
    let brake = 0;

    for (let i = 0; i < ctx.racers.length; i++) {
      const other = ctx.racers[i];
      if (other.id === this.id) continue;
      const o = other.bike.state;

      _v0.copy(o.position).sub(me.position);
      const dy = Math.abs(_v0.y);
      if (dy > 4) continue;
      const along = _v0.dot(s.tangent);
      const side = _v0.dot(s.left);
      if (along < -3.5 || along > 26) continue;
      if (Math.abs(side) > 6.5) continue;

      const closeness = 1 - clamp01(along / 26);
      const lateralCloseness = 1 - clamp01(Math.abs(side) / 6.5);
      const w = closeness * closeness * lateralCloseness;

      // Are we faster than them? Then this is an overtake, not a nurse-past.
      const closing = me.forwardSpeed - o.forwardSpeed;
      const overtaking = along > 0 && closing > 0.4;

      // Push away from their side. If we are dead behind, pick the side with
      // more ribbon left, biased toward the side we are already on.
      let dir: number;
      if (Math.abs(side) < 0.55) {
        const room = this.tracker.lateral;
        dir = room >= 0 ? 1 : -1;
        if (Math.abs(s.curvature) > 3e-4 && overtaking) {
          // Overtakers dive to the inside when there is a corner to do it in.
          dir = s.curvature > 0 ? 1 : -1;
        }
      } else {
        dir = side > 0 ? -1 : 1;
      }

      const gain = p.avoidanceGain * (overtaking ? 1 + p.overtakeAggression * 0.85 : 0.72);
      bias += dir * w * gain * 2.6;

      // If they are directly ahead, very close, and we cannot get past, ease off
      // rather than rear-ending them. Aggressive riders barely do this.
      if (along > 0 && along < 6.5 && Math.abs(side) < 1.4 && closing > 0) {
        brake = Math.max(brake, clamp01((6.5 - along) / 6.5) * (1 - p.overtakeAggression * 0.7));
      }
    }

    this.avoidLateral = clamp(bias, -s.halfWidth, s.halfWidth);
    this.avoidBrake = brake;
  }

  // ── The controller ────────────────────────────────────────────────────────
  gatherInput(dt: number, ctx: RaceContext): BikeInput {
    const i = this.input;
    const st = this.bike.state;
    const p = this.personality;

    if (ctx.phase === RacePhase.Countdown || ctx.phase === RacePhase.Attract || ctx.phase === RacePhase.Paused) {
      zeroInput(i);
      // Everyone holds the front brake on the line, and coils a little as the
      // countdown runs out. It reads on screen and it is what riders do.
      i.brakeFront = 1;
      i.brakeRear = 1;
      if (ctx.phase === RacePhase.Countdown) {
        const toGo = Math.max(0, COUNTDOWN_SECONDS - ctx.raceTime);
        i.crouch = clamp01(1 - toGo / 1.2) * 0.8;
      }
      return i;
    }

    if (this.progress.finished || st.mode === BikeMode.Finished) {
      zeroInput(i);
      i.brakeRear = 0.7;
      return i;
    }

    // Crashed: hands off. Physics owns the recovery; all we do is try to point
    // the bike back down the hill once it will listen again.
    if (st.mode === BikeMode.Crashing) {
      zeroInput(i);
      return i;
    }

    this.computeAvoidance(ctx);

    const s = this.tracker.sample;
    const caution = cautionScalar(p, this.sinceCrash);

    // ── Target line, smoothed. The smoothing is the rider's own hands: a target
    // that snapped would produce a steering step no human could make.
    let wantLateral = clamp(
      this.plan.targetLateral + this.avoidLateral,
      -s.halfWidth * 1.05,
      s.halfWidth * 1.05,
    );

    // Off the trail, stop racing and go back to the middle.
    //
    // A rider that has run wide was still chasing a RACING LINE — an offset up
    // to a full half-width toward the outside of the next corner — which is
    // both the wrong target and, at 12 m out, a target that keeps it out. The
    // measured shape was a slow oscillation rather than a divergence: out to
    // -7 m, back to +3, out to -15 m, back, on a roughly ten second period.
    // That is a loop being asked to hold a line it cannot reach while aiming
    // past the point it needs to get back to.
    //
    // So while off, the target is the centreline, flatly. The hands smoothing
    // below is what keeps this from reading as a snap.
    const outBy = Math.abs(this.tracker.lateral) - s.halfWidth;
    if (outBy > 0) wantLateral *= 1 - clamp01(outBy / 2.5);

    this.smoothedTargetLateral = dampHL(this.smoothedTargetLateral, wantLateral, 0.14, dt);

    // ── Lookahead point ─────────────────────────────────────────────────────
    const speed = Math.max(st.speed, 1);
    // Shorten the lookahead when off the trail. A rider recovering from an
    // excursion looks at where they are rejoining, not 25 m down the course —
    // a distant aim point barely differs in bearing from the one they are
    // already pointed at, so the heading error stays small while the position
    // error does not, and the loop takes seconds to do something urgent.
    const look =
      clamp(8 + speed * 0.95 * p.lookaheadScale, 8, 25) *
      (1 - 0.55 * clamp01((Math.abs(this.tracker.lateral) - s.halfWidth) / 4));
    const aheadD = Math.min(this.tracker.distance + look, this.track.length);
    const aim = this.track.sampleAtDistance(aheadD, this.scratchSample);
    _v1.copy(aim.position).addScaledVector(aim.left, this.smoothedTargetLateral);

    // ── Heading error, in the horizontal plane ──────────────────────────────
    _v2.copy(_v1).sub(st.position);
    _v2.y = 0;
    const targetYaw = Math.atan2(_v2.x, _v2.z);

    _v3.copy(FORWARD).applyQuaternion(_q0.copy(st.orientation));
    _v3.y = 0;
    if (_v3.lengthSq() < 1e-6) _v3.copy(s.tangent);
    const currentYaw = Math.atan2(_v3.x, _v3.z);

    const err = shortAngle(currentYaw, targetYaw);
    const errRate = (err - this.prevHeadingError) / Math.max(dt, 1e-4);
    this.prevHeadingError = err;

    // ── PD, plus an explicit lateral-offset term ────────────────────────────
    // The PD alone converges to a heading, not to a position — without the
    // lateral term a rider that gets pushed 2m off line runs the whole rest of
    // the section 2m off line, perfectly parallel to where it should be.
    const lateralErr = this.smoothedTargetLateral - this.tracker.lateral;
    // NEGATED, and the negation is the whole fix. Three conventions meet here
    // and two of them run opposite to the third:
    //
    //   yaw = atan2(x, z) increases toward +X, and +X is LEFT
    //     (`buildOrientation`: "Bike space is +Z forward, +Y up, +X left")
    //   shortAngle(a, b) returns b - a, so err > 0 means TARGET IS LEFT
    //   lateral = rel · left, so lateralErr < 0 means WE ARE LEFT OF THE LINE
    //   ...but `Wheel.ts`: "Positive steer is to the RIGHT"
    //
    // So `steer = +err * kp` commanded a right turn to reach a target on the
    // left, and the lateral term pushed further out the side it was already
    // off. Both error terms fed the bike away from the course.
    //
    // This is not a mistuned loop, it is positive feedback: it diverges rather
    // than wanders. Measured at the start line, 10 s in, heading error against
    // the course tangent — ai0 102 deg, ai1 173 deg (riding back up the
    // mountain), ai2 69 deg, with the pack covering 0.7-1.9 m in ten seconds.
    //
    // AI_STEER_TRIM lived here at 0.36 and is now gone. It was me tuning the
    // GAIN of a loop whose SIGN was wrong: with the sign inverted, every
    // reduction in gain genuinely improved the measured error, because the only
    // thing it was doing was weakening a divergent loop. That is why the sweep
    // bottomed out at 0.36 instead of at 1.0, and why 44% of frames sat at full
    // lock. A sweep that keeps recommending "less" all the way down is evidence
    // about the sign, not the gain.
    let steer = -(err * p.steerKp + errRate * p.steerKd + lateralErr * p.lateralGain) * AI_RESPONSE_TRIM;

    // Steering authority falls off with speed in the physics; ask for more when
    // fast so the closed loop keeps roughly constant response.
    steer *= 1 + clamp01(speed / 22) * 0.35;

    steer += this.wobbleSteer();

    // Counter-steer against a real slide, scaled by skill. This is the save.
    const slide = st.rear.lateralSlip;
    if (Math.abs(slide) > 0.6 && st.mode === BikeMode.Grounded) {
      steer += clamp(-slide * 0.16, -0.9, 0.9) * p.recoverySkill;
    }

    // Slew-limit the bars. A human cannot move them faster than this and the
    // limit is a surprisingly large part of why the output reads as a person.
    const maxSlew = lerp(5.5, 9.5, p.recoverySkill) * dt;
    this.steerOut = moveTowards(this.steerOut, clamp(steer, -1, 1), maxSlew);
    i.steer = clamp(this.steerOut, -1, 1);

    // ── Speed control ───────────────────────────────────────────────────────
    this.smoothedTargetSpeed = dampHL(this.smoothedTargetSpeed, this.plan.targetSpeed, 0.18, dt);
    // Judge speed by how fast the bike is ACTUALLY TRAVELLING, not by the
    // component of that travel along its own nose.
    //
    // `forwardSpeed` is signed along the bike's forward axis, so it collapses
    // toward zero the moment the bike is sliding rather than rolling — and a
    // sliding bike is exactly when the speed controller matters most. Measured
    // on ai1: 113 km/h against a 65 km/h target, ten metres off the trail on a
    // 20 degree face, with brakes at ZERO and PEDAL AT FULL. The rider was
    // travelling at 31 m/s sideways, the nose component read under 18, so the
    // loop concluded it was slow and drove it harder down the mountain. It
    // reached 113 km/h by pedalling into a slide.
    //
    // `speed` is the magnitude, so it can never under-report travel. Below the
    // slide threshold the two agree to within a percent and nothing changes;
    // this only bites where the old measure was lying.
    const travelling = Math.max(st.forwardSpeed, st.speed);
    const vErr = this.smoothedTargetSpeed - travelling;

    if (vErr > 0.4) {
      // 0.18, not 0.42, because the bike's drive authority more than doubled.
      //
      // This gain converts a speed error in m/s into a pedal demand, so it is
      // only meaningful relative to what full pedal actually produces. At
      // 460 N on 92 kg that was 5.0 m/s^2 and 0.42 asked for everything at a
      // 2.4 m/s error, which was aggressive but survivable. At 980 N it is
      // 10.6 m/s^2, and the same command drives twice the acceleration into a
      // loop tuned for half of it: the pack left the start line overshooting
      // its own planned corner speeds and ran wide, max |lateral| going from
      // 2.2 m to 12.9 m in the first twenty seconds.
      //
      // Scaled by the force ratio, which puts the closed loop back where it was
      // measured. Any future change to `pedalForce` has to come through here.
      i.pedal = clamp01(vErr * 0.18) * p.throttleDiscipline * caution;
      i.brakeRear = 0;
      i.brakeFront = 0;
    } else {
      i.pedal = 0;
      const over = -vErr;
      const urgency = Math.max(this.plan.brakeUrgency, clamp01(over / 5), this.avoidBrake);
      // Rear-biased braking. The front brake goes on only when the rider is
      // genuinely deep, and using it mid-corner is how they lose the front —
      // which is the intended failure mode for the aggressive rider.
      i.brakeRear = clamp01(urgency * 1.25);
      const cornering = clamp01(Math.abs(this.plan.planCurvature) * 380);
      const frontWilling = lerp(0.85, 0.25, cornering) * lerp(0.55, 1.0, 1 - p.brakePointBias + 0.5);
      i.brakeFront = clamp01((urgency - 0.35) * 1.6) * frontWilling;
      if (this.wobbleTime > 0 && p.recoverySkill < 0.7) {
        // Panic grab. Exactly the wrong input, which is the point.
        i.brakeFront = Math.max(i.brakeFront, 0.35 * (1 - p.recoverySkill));
      }
    }

    // ── Weight shift ────────────────────────────────────────────────────────
    // Back over the rear on the steeps and under braking; forward to keep the
    // front planted on the climbs and out of corners.
    const pitchOfTrack = -s.tangent.y;
    i.pitchLean = clamp(pitchOfTrack * 1.6 + i.brakeRear * 0.5 - i.pedal * 0.25, -1, 1);

    // ── Jump / preload state machine ────────────────────────────────────────
    this.updateLaunch(i, st, dt, speed);

    // ── Air ─────────────────────────────────────────────────────────────────
    if (st.mode === BikeMode.Airborne) {
      this.updateAir(i, st, dt);
      i.brakeFront = 0;
      i.brakeRear = 0;
      i.pedal = 0;
    } else {
      i.airPitch = 0;
      i.airYaw = 0;
      i.airRoll = 0;
      this.airDecided = false;
      this.trickDriver.poseIntent = TrickKind.None;
    }

    // ── Boost ───────────────────────────────────────────────────────────────
    // Spend it on the straight bits, where it converts to a lap time, and never
    // while trying to slow down. Aggressive riders spend it earlier.
    const straight = Math.abs(s.curvature) < 2.4e-4;
    const wantsSpeed = vErr > 1.0;
    i.wantBoost =
      st.boost > lerp(0.55, 0.22, p.overtakeAggression) &&
      straight &&
      wantsSpeed &&
      st.mode === BikeMode.Grounded &&
      this.sinceCrash > 1.5;

    return i;
  }

  /**
   * Preload → pop. The rider intends to be fully compressed `preloadLead`
   * seconds before the lip and to release exactly on it. `launchTimingError`
   * shifts the whole schedule; a positive error releases late (no pop, nose
   * heavy), a negative one releases early (the compression has already rebounded
   * by the lip — a flat, short jump). Both are visible from the saddle and both
   * are recoverable, which is what makes them mistakes rather than punishments.
   */
  private updateLaunch(i: BikeInput, st: BikeState, dt: number, speed: number): void {
    const p = this.personality;
    let want = 0;
    this.hopLatch = false;

    if (this.launchArmed && st.mode === BikeMode.Grounded && isFinite(this.launchDistance)) {
      // Distance closes between plans; integrate it so the timing is smooth.
      this.launchDistance -= Math.max(this.tracker.alongSpeed, 0) * dt;
      const tToLip = this.launchDistance / Math.max(speed, 2);
      const lead = p.preloadLead + this.launchTimingError;
      const release = 0.035 + this.launchTimingError * 0.55;

      if (tToLip < lead && tToLip > release) {
        // Ramp in over the lead window rather than slamming — a slammed preload
        // just unsettles the bike.
        want = p.preloadDepth * clamp01((lead - tToLip) / Math.max(lead * 0.7, 0.05));
      } else if (tToLip <= release) {
        want = 0;
        // Pop. Only bunny-hop if the preload was actually loaded — a rider who
        // mistimed the compression has nothing to release.
        if (this.preloadOut > 0.45) this.hopLatch = true;
      }

      if (this.launchDistance < -4) {
        this.launchArmed = false;
        this.launchDistance = Infinity;
      }
    }

    // Asymmetric: compress over ~90ms, release almost instantly. Same shape the
    // human input smoothing uses, for the same reason.
    this.preloadOut = moveTowards(this.preloadOut, want, dt / (want > this.preloadOut ? 0.09 : 0.03));
    i.crouch = Math.max(i.crouch, this.preloadOut);
    i.wantHop = this.hopLatch;
  }

  /**
   * In the air. Two jobs, in priority order: pick a trick if there is time and
   * appetite for one, and get the bike level with the landing before touchdown.
   * The second always wins in the last ~35% of the flight, which is why even the
   * aggressive rider usually lands a flip — and why when they do not, it is
   * because they committed to a rotation there was never time for.
   */
  private updateAir(i: BikeInput, st: BikeState, dt: number): void {
    const p = this.personality;

    // Remaining flight time from the ballistic solution. Using airHeight rather
    // than a raycast keeps this free.
    const vy = st.velocity.y;
    const h = Math.max(st.airHeight, 0);
    const g = BIKE.gravity;
    const tRemain = (vy + Math.sqrt(Math.max(vy * vy + 2 * g * h, 0))) / g;

    if (!this.airDecided && st.airTime > 0.12) {
      this.airDecided = true;
      this.airPlan = TrickKind.None;
      const appetite = p.trickAppetite * this.form.commitment * (this.sinceCrash > 3 ? 1 : 0.3);
      if (this.rng.next() < appetite) {
        const ambition = p.trickAmbition * this.form.commitment;
        if (tRemain > 1.45 && this.rng.next() < ambition) {
          this.airPlan = this.rng.chance(0.72) ? TrickKind.Backflip : TrickKind.Frontflip;
        } else if (tRemain > 0.95 && this.rng.next() < ambition + 0.25) {
          this.airPlan = TrickKind.Spin360;
          this.airRotSign = this.rng.chance(0.5) ? 1 : -1;
        } else if (tRemain > 0.5) {
          this.airPlan = this.rng.pick([TrickKind.Tabletop, TrickKind.XUp, TrickKind.NoFooter, TrickKind.Superman]);
        }
      }
    }

    // How much of the flight is left, 0..1. Below `levelAt` we stop tricking.
    const levelAt = lerp(0.42, 0.3, p.airControl);
    const flightLeft = clamp01(tRemain / Math.max(st.airTime + tRemain, 1e-3));
    const stillTricking = flightLeft > levelAt;

    i.airPitch = 0;
    i.airYaw = 0;
    i.airRoll = 0;

    if (stillTricking && this.airPlan !== TrickKind.None) {
      switch (this.airPlan) {
        case TrickKind.Backflip:
          i.airPitch = 1;
          break;
        case TrickKind.Frontflip:
          i.airPitch = -1;
          break;
        case TrickKind.Spin360:
          i.airYaw = this.airRotSign;
          break;
        default:
          this.trickDriver.poseIntent = this.airPlan;
          break;
      }
    } else {
      this.trickDriver.poseIntent = TrickKind.None;
      // Level for the landing. BikeState.pitch is defined relative to the ground
      // plane below, so the correct target is simply zero — chasing a predicted
      // impact-point slope on top of that double-counts and makes the rider nose
      // into downslope landings.
      const pitchErr = shortAngle(st.pitch, 0);
      i.airPitch = clamp(pitchErr * 2.4, -1, 1) * p.airControl;
      i.airRoll = clamp(-st.lean * 1.6, -1, 1) * p.airControl;
      // If the rider over-rotated a spin, unwind it rather than landing sideways.
      const rot = this.trick.rotations;
      if (rot > 0) {
        const frac = rot - Math.floor(rot);
        if (frac > 0.55) i.airYaw = this.airRotSign * p.airControl;
        else if (frac > 0.06) i.airYaw = -this.airRotSign * p.airControl * 0.8;
      }
    }

    // Tuck in the air — smaller, faster, and it reads as intent.
    i.crouch = stillTricking ? 0.25 : 0.55;
    void dt;
  }

  /**
   * Steepness of the ground the rider is about to land on, radians, positive
   * where the hill falls away in the direction of travel. Used to decide how
   * much of a landing this is going to be, not to aim the bike.
   */
  landingSteepness(): number {
    const st = this.bike.state;
    _v0.copy(st.position).addScaledVector(st.velocity, 0.45);
    const n = this.terrain.normalAt(_v0.x, _v0.z, _v1);
    _v2.copy(st.velocity);
    _v2.y = 0;
    if (_v2.lengthSq() < 1e-4) _v2.copy(this.tracker.sample.tangent);
    _v2.normalize();
    const along = -(n.x * _v2.x + n.z * _v2.z) / Math.max(n.y, 0.15);
    return clamp(Math.atan(along), -0.9, 0.9);
  }
}
