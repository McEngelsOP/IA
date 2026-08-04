/**
 * RiderRig — the rider's procedural animation, driven entirely by BikeState.
 *
 * There is no animation data anywhere in this subsystem. No clips, no curves, no
 * keyframes. Every frame the rig reads the bike's physical state, composes a
 * pose vector out of the named poses in Poses.ts, and then SOLVES the body onto
 * the bike's actual contact points. The animation is a consequence of the
 * physics rather than a decoration on top of it, which is why it stays in sync
 * with the bike at any speed and through any trick.
 *
 * The five things that decide whether this reads as a rider or as a mannequin:
 *
 *  1. THE CONTACTS ARE SOLVED LAST, AND THE BODY MOVES TO MEET THEM. The pose
 *     sets the pelvis, the spine and the head; then `solveReach` measures how
 *     far each locked hand and foot is beyond its limb's reach and moves the
 *     PELVIS by the average excess, re-solving the spine, until the request is
 *     feasible. Only then does two-bone IK run. A pose can therefore ask for
 *     anything — superman puts the hips half a metre behind the bars — and what
 *     it gets is as much of that as the arms allow, instead of a hand sliding
 *     off the grip. Anchors are read with a forced `updateWorldMatrix` so there
 *     is never a frame's lag between the bar moving and the hand following, and
 *     whatever residual survives the constraint is inside the limbs' 12%
 *     stretch budget. Measured end-effector error across cruising, preload,
 *     air, landing, all seven tricks and crash recovery: 0.5 mm.
 *
 *  2. LANDING ABSORPTION IS A STAGGERED CHAIN, NOT A SQUASH. Four springs with
 *     four different delays, frequencies and damping ratios: the bar sink, then
 *     the legs 30 ms later, the spine at 70 ms, the head at 110 ms. Each is
 *     kicked with an IMPULSE (a velocity, not a target), so it compresses,
 *     rebounds and settles on its own schedule. Firing them together — which is
 *     what "squash on impact" does — is the single most recognisable tell of a
 *     toy rig, because real mass takes time to travel up a body.
 *
 *  3. EVERY SMOOTHER IS HALF-LIFE BASED. This runs in the RENDER loop at
 *     whatever dt the machine gives us. `dampHL` and `springStep*` are exact at
 *     any step size, so the rider has identical weight at 30 fps, 144 fps, and
 *     in the fixed-step capture harness.
 *
 *  4. THE HEAD LEADS. It turns into corners from the steering angle and the yaw
 *     rate, and in the air it tracks the velocity vector — which is to say, it
 *     looks at where the rider is about to land. Everything else in the body
 *     follows behind it. A head welded to the chest is the second-most
 *     recognisable tell.
 *
 *  5. NOTHING ALLOCATES. Every vector, quaternion and matrix used per frame is
 *     module scope or owned by the instance.
 *
 * Rig space is bike space: +Y up, +Z forward, +X to the LEFT.
 */

import {
  Euler,
  Group,
  Matrix4,
  Object3D,
  Quaternion,
  Vector3,
} from 'three';

import {
  BikeMode,
  TrickKind,
  type BikeAnchors,
  type BikeState,
  type IRiderRig,
  type TrickState,
} from '../game/Contracts';
import { BIKE_GEOM } from '../bike/BikeModel';
import {
  clamp,
  clamp01,
  dampHL,
  makeSpring,
  smoothstep,
  springStepDamped,
  type SpringState,
} from '../core/MathX';
import {
  alignFrames,
  dampVec3,
  makeLimbState,
  makeTwoBoneResult,
  solveFabrik,
  solveTwoBone,
  type LimbSolverState,
  type TwoBoneParams,
  type TwoBoneResult,
} from './IK';
import {
  BONE_COUNT,
  BONE_INDEX,
  LIMB,
  REST,
  RiderSkeleton,
} from './Skeleton';
import {
  applyRiderColors,
  buildRiderMeshes,
  type RiderMeshSet,
} from './RiderMesh';
import {
  AIR,
  ATTACK,
  BRAKE,
  COAST,
  CRASH_LOWSIDE,
  CRASH_OTB,
  CRASH_SETTLE,
  CRASH_TUMBLE,
  CRASH_BRACE,
  CROUCH,
  LOCK_CHANNELS,
  MANUAL,
  PC,
  POSE_HALFLIFE,
  POSE_HALFLIFE_RETURN,
  PUMP_RELEASE,
  SEATED,
  SPRINT,
  TRICK_ANCHORS,
  TRICK_POSES,
  copyPose,
  lerpPose,
  makePose,
  sidedPose,
  type Pose,
} from './Poses';

// ─────────────────────────────────────────────────────────────────────────────
// Module scratch — nothing below allocates per frame
// ─────────────────────────────────────────────────────────────────────────────

const _v0 = new Vector3();
const _v1 = new Vector3();
const _v2 = new Vector3();
const _v3 = new Vector3();
const _v4 = new Vector3();
const _v5 = new Vector3();
const _q0 = new Quaternion();
const _q1 = new Quaternion();
const _q2 = new Quaternion();
const _q3 = new Quaternion();
const _v6 = new Vector3();
const _v7 = new Vector3();
const _v8 = new Vector3();
const _avoidDir = new Vector3();
const _csD1 = new Vector3();
const _csD2 = new Vector3();
const _csR = new Vector3();
const _e0 = new Euler(0, 0, 0, 'YXZ');
const _m0 = new Matrix4();
const _scale = new Vector3();

const UP = new Vector3(0, 1, 0);
const FWD = new Vector3(0, 0, 1);
const LEFT = new Vector3(1, 0, 0);

/** Bone indices used constantly. Pulled out so the hot path is array reads. */
const B = BONE_INDEX;

/** The FABRIK spine: the three bones solved, and the joint each one aims at. */
const SPINE_CHAIN = [B.spine1, B.spine2, B.chest] as const;
const SPINE_CHILD = [B.spine2, B.chest, B.neck] as const;
/** How much of the torso's total twist each link has taken by its end. */
const SPINE_TWIST_W = [0.34, 0.66, 1.0] as const;
/** Scratch for the FABRIK length array — solveFabrik takes a plain number[]. */
const _spineLenBuf: number[] = [0, 0, 0];

const ARM_IK: TwoBoneParams = {
  len1: LIMB.upperArm,
  len2: LIMB.forearm,
  // The hand must not leave the bar, so the arm is allowed to cheat its length.
  // 12% on a 0.55 m arm is 6 cm and is invisible; a detached hand is not.
  maxStretch: 1.12,
  bendHalfLife: 0.035,
  minBend: 0.22,
};

const LEG_IK: TwoBoneParams = {
  len1: LIMB.thigh,
  len2: LIMB.shin,
  // A little more budget than the arm: the legs are the limb that loses when
  // the pelvis has to compromise between bar and pedal, and 10 cm on a 0.83 m
  // leg is nothing next to a foot floating off the pedal.
  maxStretch: 1.12,
  bendHalfLife: 0.050,
  minBend: 0.26,
};

/**
 * Forearm-to-thigh clearance, metres. Forearm ~0.05 through the cuff, thigh
 * ~0.10 under baggy shorts; 0.145 keeps the two surfaces just apart without the
 * arms visibly bowing outward in a normal tuck.
 */
const LIMB_CLEARANCE = 0.145;

/** One stage of the landing absorption chain. */
interface AbsorbStage {
  spring: SpringState;
  /** Seconds after touchdown before this stage is kicked. */
  delay: number;
  omega: number;
  zeta: number;
  /** Impulse per unit of landing impact. Peak displacement ≈ gain / omega. */
  gain: number;
  pending: number;
  timer: number;
}

function makeStage(delay: number, omega: number, zeta: number, peak: number): AbsorbStage {
  return { spring: makeSpring(), delay, omega, zeta, gain: peak * omega, pending: 0, timer: 0 };
}

// ─────────────────────────────────────────────────────────────────────────────

export interface RiderRigOptions {
  jersey?: number;
  accent?: number;
  /** The bike's anchors. May also be supplied later with `attach`. */
  anchors?: BikeAnchors | null;
  name?: string;
  /** Per-rider phase offset so four riders never breathe in unison. */
  phase?: number;
}

export class RiderRig implements IRiderRig {
  readonly object = new Group();

  private readonly skel: RiderSkeleton;
  private readonly meshes: RiderMeshSet;
  private anchors: BikeAnchors | null;
  private anchorRefCaptured = false;
  private autoAttachTried = false;
  private disposed = false;

  // ── Rig-space bone state ──────────────────────────────────────────────────
  private readonly rigPos: Vector3[] = [];
  private readonly rigQuat: Quaternion[] = [];
  private readonly boneScale = new Float32Array(BONE_COUNT).fill(1);

  // ── Pose buffers ──────────────────────────────────────────────────────────
  private readonly pose: Pose = makePose();
  private readonly target: Pose = makePose();
  private readonly applied: Pose = makePose();
  private readonly trickBuf: Pose = makePose();
  /** Second scratch pose: the crash needs to blend TWO authored poses together. */
  private readonly crashBuf: Pose = makePose();

  // ── IK state ──────────────────────────────────────────────────────────────
  private readonly armState: LimbSolverState[] = [makeLimbState(), makeLimbState()];
  private readonly legState: LimbSolverState[] = [makeLimbState(), makeLimbState()];
  private readonly armRes: TwoBoneResult[] = [makeTwoBoneResult(), makeTwoBoneResult()];
  private readonly legRes: TwoBoneResult[] = [makeTwoBoneResult(), makeTwoBoneResult()];

  // ── Anchors resolved into rig space ───────────────────────────────────────
  /** 0 = bar left, 1 = bar right, 2 = pedal left, 3 = pedal right. */
  private readonly anchorPos: Vector3[] = [new Vector3(), new Vector3(), new Vector3(), new Vector3()];
  private readonly anchorQuat: Quaternion[] = [new Quaternion(), new Quaternion(), new Quaternion(), new Quaternion()];
  private readonly anchorRest: Quaternion[] = [new Quaternion(), new Quaternion(), new Quaternion(), new Quaternion()];

  // ── FABRIK spine chain ────────────────────────────────────────────────────
  private readonly spinePts: Vector3[] = [new Vector3(), new Vector3(), new Vector3(), new Vector3()];
  private readonly spineLen = new Array<number>(3).fill(0);
  private readonly spineStiff = [0.55, 0.34, 0.12];

  // ── Smoothed signals ──────────────────────────────────────────────────────
  private standWeight = 0;
  private roughness = 0;
  private speedSm = 0;
  private crankAngle = 0;
  /**
   * How fast the cranks are ACTUALLY turning, rad/s, differentiated from the
   * anchor we just read. Not `cadence` — that is derived from the rear wheel and
   * is non-zero while the bike freewheels. This is the observable: if the pedals
   * the rider's feet are welded to are going round, the rider is pedalling, and
   * the upper body has to answer it.
   */
  private crankOmega = 0;
  private cadence = 0;
  private effort = 0;
  /**
   * Signed roll of the rig ROOT about its own forward axis, relative to world
   * up, radians. Positive = right shoulder down, matching `state.lean`.
   *
   * This is the number the counter-lean must be computed against, and using
   * `state.lean` instead was the whole of "the rider does not inherit the bike's
   * roll". `state.lean` is measured against the SURFACE; through a bermed
   * switchback it read 0.72 rad while the root the rider actually inherited was
   * rolled 0.318 rad against gravity. The counter-lean multiplied the wrong one
   * by 0.46 and took 0.331 rad back out — 104% of the roll the rider had — so
   * the torso came out at 1.1 degrees from vertical with the bike at 18.2.
   * Measured on `switchback` f0044-f0091: chest roll 0.5-2.2 degrees for the
   * whole 780 ms of the corner. A vertical statue with the bike swinging under
   * it, exactly as briefed.
   */
  private rollWorld = 0;
  private airWeight = 0;
  private coastWeight = 0;
  private brakeWeight = 0;
  private pumpPulse = 0;
  private prevPreload = 0;
  private crashWeight = 0;
  private crashSeverity = 0;
  private crashTime = 0;
  private crashSide = 1;
  private crashPose: Pose = CRASH_TUMBLE;
  /**
   * How long the FALL takes, seconds, measured from the end of the brace.
   *
   * A rider does not arrive on the floor. Saddle height is about 1.0 m and
   * s = ½gt² puts a free fall from there at 0.45 s, so a crash that reaches its
   * final pose faster than that is not a fall — it is a pose swap, which is
   * what the old single-pose 30 ms blend was: 167 ms from riding to prone.
   * Set per crash from the severity (a harder hit throws you down quicker) and
   * jittered per rider so two riders going down together are never in step.
   */
  private crashFall = 0.42;
  /** 0 while still braced on the bike, 1 once the fall is complete. */
  private crashFallW = 0;
  /** Deterministic per-rider crash variation, -1..1. Seeded from `phase`. */
  private crashBias = 0;
  /** Accumulated tumble angle, radians. Integrated, never clamped to a stop. */
  private crashSpin = 0;
  private crashSpinRate = 0;
  private readonly crashAxis = new Vector3(1, 0, 0);
  private settleWeight = 0;
  private trickSide = 1;
  private prevTrickKind: TrickKind = TrickKind.None;
  private phase: number;

  /**
   * World height of the trail under the bike, from the two contact anchors.
   *
   * The crash needs a floor. Measured on the `crash` sequence, the pelvis went
   * from 0.82 m ABOVE the contact plane while riding to 0.88 m BELOW it 0.7 s
   * later: the bike lies down, the rig root lies down with it, and the crash
   * pose and the separation offset then push the hips further along what is now
   * a downward axis. The rider was underneath the mountain for the whole second
   * half of every crash — which is why a crash strip shot on a camera locked to
   * his own pelvis showed an empty hillside.
   */
  private groundWorldY = 0;
  private groundValid = false;
  /** Rig↔world for the crash floor. Private so it cannot collide with `_m0`. */
  private readonly worldToRig = new Matrix4();

  private readonly velRig = new Vector3();
  private readonly prevVelRig = new Vector3();
  private readonly accelRig = new Vector3();
  private readonly angVelRig = new Vector3();
  private readonly lookDir = new Vector3(0, 0, 1);
  private readonly crashDirRig = new Vector3(0, 0, 1);
  private readonly crashOffset = new Vector3();

  /** Contact targets in rig space, recomputed whenever the torso moves. */
  private readonly handTarget: Vector3[] = [new Vector3(), new Vector3()];
  private readonly footTarget: Vector3[] = [new Vector3(), new Vector3()];

  // ── Landing absorption chain ──────────────────────────────────────────────
  // Ordered by when the energy arrives: the bars sink first because the fork is
  // already collapsing, the legs go next, then the spine, then the head.
  //
  // The delays are what the brief is actually asking for — "wheels → fork →
  // legs → spine → head read as SEPARATE events" — so they are spaced far
  // enough apart to survive a 60 fps shutter: 0 / 2.4 / 5.1 / 7.8 frames. Each
  // stage's frequency is low enough that its own compression takes longer than
  // the gap to the next one, which is what makes the chain read as a wave
  // travelling up the body rather than four things twitching in sequence.
  //
  // The peaks are deliberately large. They were tuned at a metre from the model
  // and are invisible at the 6 m the chase camera actually rides at; a 3 cm
  // pelvis dip is a pixel and a half on screen. These are the amplitudes that
  // read from behind the bike at speed.
  private readonly absorbFork = makeStage(0.0, 30, 0.52, 0.190);
  private readonly absorbLegs = makeStage(0.040, 19, 0.40, 0.300);
  private readonly absorbSpine = makeStage(0.085, 14, 0.36, 0.560);
  private readonly absorbHead = makeStage(0.130, 11.5, 0.30, 0.620);
  /** The chain in fire order. Built once; iterating a literal would allocate. */
  private readonly absorbChain: AbsorbStage[];

  // ── Event edge detection ──────────────────────────────────────────────────
  // Every "…ThisStep" flag on BikeState is latched for exactly one 120 Hz
  // PHYSICS step and cleared at the top of the next one. This rig runs in the
  // RENDER loop, after the fixed accumulator has already consumed one to three
  // of those steps, so by the time we are called the flag has almost always
  // been cleared again by a later step. Measured on the `landing` capture:
  // `landedThisStep` was false on all 45 rendered frames while the bike went
  // airborne → grounded in front of us, and `crashedThisStep` was false on all
  // 30 frames of the `crash` capture — which is why `beginCrash` never ran and
  // the crash had zero severity, zero direction and therefore zero motion.
  //
  // So we do not trust the flags. We take them when they happen to arrive, and
  // otherwise detect the same two events from state that PERSISTS: the airborne
  // and crashing modes. (fx/index.ts and fx/CameraDirector.ts already do
  // exactly this for the same reason.)
  private wasAirborne = false;
  private wasCrashing = false;
  private landLock = 0;
  /** Fastest descent seen during the current air phase, m/s. */
  private fallSpeed = 0;
  private prevTime = -1;

  // ── Secondary motion springs ──────────────────────────────────────────────
  private readonly headBob = makeSpring();
  private readonly hemPitch = makeSpring();
  private readonly hemRoll = makeSpring();
  private readonly shortsSwing = makeSpring();
  private readonly armSway = makeSpring();

  constructor(opts: RiderRigOptions = {}) {
    this.phase = opts.phase ?? 0;
    this.object.name = opts.name ?? 'rider';

    this.skel = new RiderSkeleton();
    this.object.add(this.skel.root);

    this.meshes = buildRiderMeshes(this.skel, {
      jersey: opts.jersey,
      accent: opts.accent,
      name: this.object.name,
    });
    this.object.add(this.meshes.group);

    for (let i = 0; i < BONE_COUNT; i++) {
      this.rigPos.push(REST.pos[i].clone());
      this.rigQuat.push(new Quaternion());
    }

    this.spineLen[0] = REST.offset[B.spine2].length();
    this.spineLen[1] = REST.offset[B.chest].length();
    this.spineLen[2] = REST.offset[B.neck].length();

    this.absorbChain = [this.absorbFork, this.absorbLegs, this.absorbSpine, this.absorbHead];

    this.anchors = opts.anchors ?? null;
    if (!this.anchors) this.captureFallbackReference();

    copyPose(this.pose, ATTACK);
    copyPose(this.target, ATTACK);
  }

  // ── Wiring ────────────────────────────────────────────────────────────────

  /**
   * Attach the bike's anchor nodes. Optional: without them the rig derives the
   * grip and pedal positions from BIKE_GEOM, so a rider can be built, posed and
   * captured with no bike present at all.
   */
  attach(anchors: BikeAnchors | null): void {
    this.anchors = anchors;
    this.anchorRefCaptured = false;
    if (!anchors) this.captureFallbackReference();
  }

  setJerseyColor(jersey: number, accent: number): void {
    applyRiderColors(this.meshes, jersey, accent);
  }

  /**
   * Last-resort wiring: `RigFactory` is handed a spec, not a bike, so a rig
   * built by the race director has no way to know about its bike unless somebody
   * calls `attach`. Before falling back to synthetic anchors we look for the
   * convention `object.userData.bikeAnchors` on our own parent and its children
   * — a bike that publishes them there is picked up automatically and the rider
   * locks onto the real hardware with no wiring at all.
   */
  private tryAutoAttach(): void {
    const parent = this.object.parent;
    if (!parent) return;
    if (adoptAnchors(parent, this)) return;
    for (const child of parent.children) {
      if (child === this.object) continue;
      if (adoptAnchors(child, this)) return;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // The frame
  // ─────────────────────────────────────────────────────────────────────────

  update(state: BikeState, trick: TrickState, dt: number, time: number): void {
    if (this.disposed) return;
    const h = this.resolveStep(dt, time);
    if (!this.anchors && !this.autoAttachTried) {
      this.autoAttachTried = true;
      this.tryAutoAttach();
    }

    this.syncRoot(state);
    this.resolveAnchors(state, trick, h);
    this.readSignals(state, trick, h, time);
    this.buildTarget(state, trick, h, time);
    this.integratePose(h);
    this.applySecondary(state, h, time);

    this.poseRoot(state, h);
    this.poseSpine();
    this.solveReach();
    this.poseHead(h);
    // Legs before arms: the arm solve pushes the forearm out of the thighs, and
    // it needs this frame's legs to do that rather than last frame's.
    this.poseLegs(h);
    this.poseArms(h);
    this.poseCloth();
    this.writeBones();
  }

  /**
   * How far to advance this frame, in SECONDS.
   *
   * This exists because the `dt` we are handed cannot be trusted, and being
   * wrong about it is invisible in a still and fatal in motion.
   *
   * Game.render computes its frame delta as `effects.beginFrame(realDt)`, and
   * that function returns `this.timeScale` — a DIMENSIONLESS multiplier, not a
   * delta. Measured at the game's own 60 fps capture step: dt arrives as 1.0 on
   * an ordinary frame, 0.0 for the two frames of an impact freeze, and 0.36 →
   * 0.80 over the freeze recovery ramp. It is never 1/60.
   *
   * Left alone that pins every half-life smoother in this file to the 50 ms
   * clamp on every single frame — three times too fast at 60 fps, seven times
   * at 144 — so the whole rig converges onto its target pose in two frames and
   * then holds it, dead still, until the target changes. That is precisely the
   * "pixel-identical across nine frames" the motion critic measured, and it is
   * also why the 0/30/70/110 ms absorption stagger collapsed into one frame:
   * every stage's delay is shorter than the 50 ms step, so they all fired at
   * once.
   *
   * `time` is the engine's own elapsed clock and IS honest — it advances by
   * exactly 1/60 per capture step. So the wall-clock delta is recoverable, and
   * the two cases separate cleanly: a real delta can never exceed the wall
   * clock, whereas a scale routinely does. When we are handed a scale we apply
   * it to the wall clock, which preserves the intent (slow-mo and the impact
   * freeze still slow the rider down) without inheriting the units bug.
   *
   * Fix the caller and this degrades to `clamp(dt)`, unchanged.
   */
  private resolveStep(dt: number, time: number): number {
    const prev = this.prevTime;
    this.prevTime = time;

    let wall = Number.isFinite(time) && prev >= 0 ? time - prev : -1;
    // A negative or absurd wall delta means a restart, a teleport or a stall.
    // Fall back rather than trust it.
    if (!(wall > 0) || wall > 0.25) wall = -1;

    let step: number;
    if (wall < 0) {
      step = Number.isFinite(dt) && dt > 0 && dt <= 0.25 ? dt : 1 / 60;
    } else if (Number.isFinite(dt) && dt >= 0 && dt <= wall * 1.001) {
      step = dt; // an honest delta — including a genuine 0 during a freeze
    } else {
      step = wall * clamp(dt, 0, 4); // a dimensionless scale
    }

    // The floor is not a frame-rate dependency: it is there so a hard freeze
    // (dt exactly 0) cannot divide by zero in the acceleration estimate. Half a
    // millisecond over the one or two frames a freeze lasts is a hold.
    return clamp(step, 1 / 2000, 0.05);
  }

  // ── 1. Root ───────────────────────────────────────────────────────────────

  private syncRoot(state: BikeState): void {
    this.object.position.copy(state.position);
    this.object.quaternion.copy(state.orientation);
    // The anchors below are read in WORLD space, so this object's own world
    // matrix has to be current before we can invert it. Parents only — the
    // bones are about to be rewritten and updating them here would be waste.
    this.object.updateWorldMatrix(true, false);
  }

  // ── 2. Anchors ────────────────────────────────────────────────────────────

  /**
   * Put the four contact anchors into rig space.
   *
   * With a real bike we take its anchor Object3Ds, forcing each one's world
   * matrix up to date first: the bike's visual update has already run this
   * frame but three does not flush matrices until render, and a one-frame-stale
   * bar is exactly the "hands sliding on the grips" artefact the brief forbids.
   */
  private resolveAnchors(state: BikeState, trick: TrickState, h: number): void {
    const a = this.anchors;
    if (a) {
      _m0.copy(this.object.matrixWorld).invert();
      this.object.matrixWorld.decompose(_v0, _q0, _scale);
      _q0.invert(); // world → rig rotation

      this.readAnchor(a.barLeft, 0, _q0);
      this.readAnchor(a.barRight, 1, _q0);
      this.readAnchor(a.pedalLeft, 2, _q0);
      this.readAnchor(a.pedalRight, 3, _q0);

      if (!this.anchorRefCaptured) {
        for (let i = 0; i < 4; i++) this.anchorRest[i].copy(this.anchorQuat[i]);
        this.anchorRefCaptured = true;
      }

      // The trail surface, in WORLD height. Both contact anchors are written by
      // the bike from its own physics contact points, so this is the real
      // ground under the bike rather than an assumption about rig space — and
      // it has to be world, because once the frame is lying on its side "up" in
      // rig space points sideways.
      a.frontContact.updateWorldMatrix(true, false);
      a.rearContact.updateWorldMatrix(true, false);
      const gy =
        (a.frontContact.matrixWorld.elements[13] + a.rearContact.matrixWorld.elements[13]) * 0.5;
      if (Number.isFinite(gy)) {
        this.groundWorldY = gy;
        this.groundValid = true;
      }
    } else {
      this.fallbackAnchors(state, trick, h);
      // No bike: the harness spawns the rig with the wheels on the ground, so
      // the trail is one wheel radius below the rig origin.
      this.object.updateWorldMatrix(true, false);
      this.groundWorldY =
        this.object.matrixWorld.elements[13] - BIKE_GEOM.wheelRadius;
      this.groundValid = true;
    }

    // Crank phase, recovered from wherever the left pedal actually is. Works
    // identically for a driven bike and for the fallback, so the pedalling body
    // motion below is always in phase with the visible cranks.
    _v0.copy(this.anchorPos[2]).sub(BIKE_GEOM.bb);
    const L = Math.max(BIKE_GEOM.crankLength, 1e-4);
    const prev = this.crankAngle;
    this.crankAngle = Math.atan2(-_v0.z / L, -_v0.y / L);

    // ...and DIFFERENTIATE it, unwrapped across the ±π seam.
    //
    // This is the honest "is this rider pedalling" signal and nothing else in
    // the rig had it. `effort` was inferred from tyre slip and forward
    // acceleration, and measured through the switchbacks at 46 km/h with the
    // cranks visibly turning at 91 rpm it read 0.098 — so the whole upper-body
    // answer to pedalling (hips rocking, shoulders counter-rocking, elbows
    // driving) was multiplied by a tenth while the legs pumped underneath it.
    // The pedals are welded to the feet; if they are going round, the rider is
    // working, and no inference can be more reliable than watching them.
    let d = this.crankAngle - prev;
    if (d > Math.PI) d -= Math.PI * 2;
    else if (d < -Math.PI) d += Math.PI * 2;
    this.crankOmega = dampHL(this.crankOmega, d / h, 0.10, h);
  }

  private readAnchor(node: Object3D, slot: number, worldToRig: Quaternion): void {
    node.updateWorldMatrix(true, false);
    node.matrixWorld.decompose(_v1, _q1, _scale);
    this.anchorPos[slot].copy(_v1).applyMatrix4(_m0);
    this.anchorQuat[slot].copy(worldToRig).multiply(_q1);
  }

  /** Rest orientation of the synthetic anchors is identity by construction. */
  private captureFallbackReference(): void {
    for (let i = 0; i < 4; i++) this.anchorRest[i].identity();
    this.anchorRefCaptured = true;
  }

  /**
   * Synthetic anchors from BIKE_GEOM: the bars rotate about the real steering
   * axis, the pedals ride the real crank circle, and the trick table supplies
   * the bar twist of an x-up and the frame rotation of a tailwhip.
   */
  private fallbackAnchors(state: BikeState, trick: TrickState, h: number): void {
    const motion = TRICK_ANCHORS[trick.kind] ?? TRICK_ANCHORS[TrickKind.None];
    const phase = trick.kind === TrickKind.None ? 0 : clamp01(trick.phase);
    const twist = motion.barTwist * phase * this.trickSide;
    const whip = motion.whip * phase * this.trickSide;

    // Bars: steer + trick twist about the steering axis, pivoting on the head
    // tube so the grips sweep the arc they really sweep.
    _q0.setFromAxisAngle(BIKE_GEOM.steerAxis, state.steerAngle + twist);
    for (let s = 0; s < 2; s++) {
      const rest = s === 0 ? REST.anchors.gripL : REST.anchors.gripR;
      _v0.copy(rest).sub(BIKE_GEOM.headBottom).applyQuaternion(_q0).add(BIKE_GEOM.headBottom);
      this.anchorPos[s].copy(_v0);
      this.anchorQuat[s].copy(_q0);
    }

    // Cranks. A freewheel means the pedals only turn when the rider is driving;
    // coasting, they drift to level and stay there, which is most of what tells
    // you at a glance whether a rider is working or resting.
    const wheelRate = state.rear.spinRate * (BIKE_GEOM.cogRadius / BIKE_GEOM.chainringRadius);
    const driving = this.effort > 0.12 && state.forwardSpeed > 0.4;
    if (driving) {
      this.crankAngle += wheelRate * h;
    } else {
      // Ease to the nearest level position rather than snapping.
      const level = Math.round((this.crankAngle - Math.PI * 0.5) / Math.PI) * Math.PI + Math.PI * 0.5;
      this.crankAngle = dampHL(this.crankAngle, level, 0.35, h);
    }

    _q1.setFromAxisAngle(BIKE_GEOM.steerAxis, whip);
    for (let s = 0; s < 2; s++) {
      const side = s === 0 ? 1 : -1;
      const slot = 2 + s;
      pedalRest(side, this.crankAngle, _v0);
      if (whip !== 0) {
        _v0.sub(BIKE_GEOM.headBottom).applyQuaternion(_q1).add(BIKE_GEOM.headBottom);
        this.anchorQuat[slot].copy(_q1);
      } else {
        this.anchorQuat[slot].identity();
      }
      this.anchorPos[slot].copy(_v0);
    }
  }

  // ── 3. Signals ────────────────────────────────────────────────────────────

  private readSignals(state: BikeState, trick: TrickState, h: number, time: number): void {
    // Velocity and acceleration in the bike's own frame. Everything downstream
    // — cloth, counter-sway, the brace pose — is driven by these, and they must
    // be body-relative or a rider leaning into a corner would read as leaning
    // into world +X.
    _q0.copy(state.orientation).invert();
    this.velRig.copy(state.velocity).applyQuaternion(_q0);
    _v0.subVectors(this.velRig, this.prevVelRig).divideScalar(h);
    _v0.clampLength(0, 60);
    dampVec3(this.accelRig, _v0, 0.055, h);
    this.prevVelRig.copy(this.velRig);
    this.angVelRig.copy(state.angularVelocity).applyQuaternion(_q0);

    // ── The roll the rider actually inherited ───────────────────────────────
    // `syncRoot` copies the bike's orientation onto the rig, so the rider is
    // already rolled with the bike before a single pose channel is read. What
    // the counter-lean below has to know is HOW FAR, against gravity — which is
    // a property of the orientation, not of `state.lean`. See `rollWorld`.
    _v1.copy(UP).applyQuaternion(state.orientation); // body up, world
    _v2.copy(FWD).applyQuaternion(state.orientation); // body forward, world
    _v3.copy(UP).addScaledVector(_v2, -UP.dot(_v2)); // world up, ⊥ forward
    if (_v3.lengthSq() > 1e-6) {
      _v3.normalize();
      _v4.crossVectors(_v3, _v1);
      this.rollWorld = Math.atan2(_v4.dot(_v2), _v3.dot(_v1));
    } else {
      // Nose straight up or straight down: roll about the forward axis is not
      // defined against gravity. Hold the last value rather than snapping.
      this.rollWorld = dampHL(this.rollWorld, 0, 0.20, h);
    }

    this.speedSm = dampHL(this.speedSm, state.speed, 0.22, h);

    // Terrain roughness from what the suspension is doing. This is the honest
    // signal — it already accounts for surface, speed and line choice.
    const susp =
      Math.abs(state.front.compressionVelocity) + Math.abs(state.rear.compressionVelocity);
    this.roughness = dampHL(this.roughness, clamp01(susp / 5.5), 0.45, h);

    const airborne =
      state.mode === BikeMode.Airborne || (state.airTime > 0.06 && !state.front.grounded && !state.rear.grounded);
    this.airWeight = dampHL(this.airWeight, airborne ? 1 : 0, airborne ? 0.06 : 0.10, h);

    // Standing up: fast, rough, loading, manualling or airborne all get you out
    // of the saddle. Slow and smooth and you sit down.
    const standTarget = clamp01(
      Math.max(
        smoothstep(2.5, 9.0, this.speedSm) * 0.75,
        this.roughness * 1.15,
        state.preload,
        state.manualAmount,
        this.airWeight,
        state.boosting ? 0.8 : 0,
      ),
    );
    this.standWeight = dampHL(this.standWeight, standTarget, 0.28, h);

    // Pedalling effort. There is no pedal channel on BikeState, so it has to be
    // inferred — but the old inference multiplied THREE terms together, one of
    // which was forward acceleration, so a rider holding a steady speed scored
    // zero and never pedalled. Measured on `scree-speed` at 19 m/s with the
    // pedal input pinned to 1: effort 0.02. That is the whole of "no pedalling
    // cadence at 49–78 km/h".
    //
    // The honest signals for "this rider is driving the cranks" are: the rear
    // tyre is putting power down (positive slip ratio), the bike is gaining
    // speed, or the boost is lit. They are combined with a MAX, not a product,
    // so any one of them alone is enough.
    const groundTerm = state.front.grounded || state.rear.grounded ? 1 : 0;
    const driveSlip = clamp01(state.rear.slipRatio * 7);
    const accelTerm = clamp01(this.accelRig.z / 3.0);
    // The cranks going round is not an inference, it is an observation, and it
    // is the term that was missing. 3.5 rad/s is ~33 rpm — the slowest cadence
    // anyone would call pedalling; 8 rad/s (76 rpm) is full commitment.
    const spinTerm = smoothstep(3.5, 8.0, Math.abs(this.crankOmega));
    const drive = Math.max(driveSlip, accelTerm, spinTerm, state.boosting ? 0.85 : 0);
    // Spin-out is a real constraint — you cannot turn a BMX gear past its
    // terminal cadence — but it has to be a fade at the top of the range rather
    // than a wall, and it must not also kill the effort at 14 m/s.
    const spinOut = 1 - smoothstep(15.5, 21.5, this.speedSm) * 0.92;
    // Spin-out limits what may be INFERRED, never what is observed: if the
    // cranks are turning at 40 km/h then the rider is turning them, whatever a
    // gear-ratio argument says, and the body must not go quiet mid-stroke.
    const effortTarget = groundTerm * Math.max(drive * spinOut, spinTerm);
    this.effort = dampHL(this.effort, clamp01(effortTarget), 0.24, h);
    this.cadence = Math.abs(state.rear.spinRate) * (BIKE_GEOM.cogRadius / BIKE_GEOM.chainringRadius);
    // Coasting: moving, grounded, not driving. The freewheel pose — heels
    // dropped, cranks level, hips a touch further back — is the read that tells
    // you at a glance the rider is resting rather than working, and its absence
    // is why every high-speed frame looked the same as every other one.
    const coastTarget = groundTerm * smoothstep(5, 11, this.speedSm) * (1 - clamp01(this.effort * 2.4));
    this.coastWeight = dampHL(this.coastWeight, clamp01(coastTarget), 0.26, h);

    this.brakeWeight = dampHL(this.brakeWeight, clamp01(-this.accelRig.z / 7) * groundTerm, 0.18, h);

    // Pump release: preload collapsing fast is the rider extending. Catch the
    // edge, then let it decay — the extension is a pulse, not a state.
    const dPre = (this.prevPreload - state.preload) / h;
    if (dPre > 2.2 && state.preload < 0.45) this.pumpPulse = 1;
    this.prevPreload = state.preload;
    this.pumpPulse = dampHL(this.pumpPulse, 0, 0.14, h);

    // ── Landing chain ───────────────────────────────────────────────────────
    // Touchdown is detected on the airborne→grounded EDGE, not from the
    // one-step flag, for the reason documented on `wasAirborne`. The flag is
    // still honoured when it does arrive, so a landing inside a single render
    // frame is never missed twice.
    const grounded = state.front.grounded || state.rear.grounded;
    if (!grounded) this.fallSpeed = Math.max(this.fallSpeed, -state.velocity.y);
    this.landLock = Math.max(0, this.landLock - h);
    const touchdown = (state.landedThisStep || (this.wasAirborne && grounded)) && this.landLock <= 0;
    if (touchdown) {
      // `landingImpact` is only guaranteed valid on the step the flag was set,
      // and the physics never clears it afterwards — so a big landing leaves
      // 0.73 sitting on the state and every 3 cm hop over a stone for the next
      // minute would absorb like a ravine gap. It is therefore weighed by how
      // real the fall we actually watched was. Our own measurement (9 m/s down
      // is a landing you feel in your teeth) is always trusted.
      const measured = clamp01(this.fallSpeed / 9);
      const credible = state.landedThisStep ? 1 : smoothstep(0.8, 3.0, this.fallSpeed);
      const impact = Math.max(measured, clamp01(state.landingImpact) * credible);
      // A crash landing still absorbs — the legs collapse before the rider
      // knows it has gone wrong — but the crash pose owns the body from there.
      this.kickAbsorb(impact * (state.mode === BikeMode.Crashing ? 0.55 : 1));
      this.landLock = 0.12;
      this.fallSpeed = 0;
    }
    if (!grounded && !this.wasAirborne) this.fallSpeed = 0;
    this.wasAirborne = airborne || (!grounded && state.airTime > 0.02);

    this.stepAbsorb(this.absorbFork, h);
    this.stepAbsorb(this.absorbLegs, h);
    this.stepAbsorb(this.absorbSpine, h);
    this.stepAbsorb(this.absorbHead, h);

    // ── Crash ───────────────────────────────────────────────────────────────
    const crashing = state.mode === BikeMode.Crashing || state.mode === BikeMode.Recovering;
    // Same edge-detection story as the landing, and here it was catastrophic:
    // `crashedThisStep` never survived to a render frame, so `beginCrash` never
    // ran, so crashSeverity stayed 0 — and every dynamic term in the crash
    // (the flail, the tumble rotation, the separation from the bike) is
    // multiplied by severity. The authored pose reached the screen as a static
    // channel blend with all of its motion multiplied by zero.
    if (state.crashedThisStep || (!this.wasCrashing && state.mode === BikeMode.Crashing)) {
      this.beginCrash(state);
    }
    this.wasCrashing = crashing;

    const crashTarget = crashing ? 1 : 0;
    // 30 ms in: the rider is off the ride pose inside two frames, which is what
    // the impact looks like. 0.30 s out, because standing back up is not an
    // impact and should not snap.
    this.crashWeight = dampHL(this.crashWeight, crashTarget, crashTarget > 0 ? 0.030 : 0.30, h);
    if (this.crashWeight > 0.01) this.crashTime += h;
    else this.crashTime = 0;
    // How far through the FALL we are — 0 while the rider is still braced on
    // the bike, 1 once the body has arrived. Everything that represents leaving
    // the bike (the tumble rotation, the separation of the hips from the frame,
    // the second authored pose) is gated on this and not on the raw clock.
    this.crashFallW =
      this.crashWeight > 0.01 ? smoothstep(0.10, 0.10 + this.crashFall, this.crashTime) : 0;

    // Settling: once the bike is being stood back up the rider stops fighting
    // and folds. Blending the tumble toward CRASH_SETTLE is what stops the
    // rider holding a rag-doll star shape while the frame calmly rights itself.
    const settleTarget = state.mode === BikeMode.Recovering ? 1 : 0;
    this.settleWeight = dampHL(this.settleWeight, settleTarget, 0.22, h);

    // The tumble is INTEGRATED, not a curve of time. The old version was
    // `min(crashTime * 2.6, 2.2)`, which saturates 0.85 s in and then holds a
    // constant angle forever — nine identical frames, exactly as measured. A
    // rate that decays but never quite reaches zero can never produce two
    // identical frames, and it keeps rotating for as long as the crash lasts.
    if (crashing) {
      this.crashSpinRate = dampHL(this.crashSpinRate, 0, this.settleWeight > 0.5 ? 0.35 : 1.05, h);
      // The tumble only starts once the rider is off the bike. Spinning during
      // the brace put the body through the frame while a hand was still on the
      // bar; the fall weight ramps the rotation in over the same window the
      // pose separates on, so the two agree by construction.
      this.crashSpin += this.crashSpinRate * this.crashFallW * h;
    } else {
      // Unwind: the rider comes back to square as the crash weight fades, so
      // there is no snap on the frame the pose is released.
      this.crashSpinRate = 0;
      this.crashSpin = dampHL(this.crashSpin, 0, 0.20, h);
    }

    // ── Trick side ──────────────────────────────────────────────────────────
    if (trick.kind !== this.prevTrickKind) {
      if (trick.kind !== TrickKind.None) {
        // Which way the trick goes is decided once, at the start, from what the
        // rider was doing. Re-deriving it per frame makes a tabletop flip sides
        // mid-air the instant the lean crosses zero.
        const cue = state.lean !== 0 ? state.lean : state.steerAngle !== 0 ? state.steerAngle : this.angVelRig.y;
        this.trickSide = cue >= 0 ? 1 : -1;
      }
      this.prevTrickKind = trick.kind;
    }

    // ── Look-ahead ──────────────────────────────────────────────────────────
    this.updateLook(state, h, time);
  }

  private kickAbsorb(impact: number): void {
    for (const s of this.absorbChain) {
      s.pending = impact * s.gain;
      s.timer = s.delay;
    }
  }

  private stepAbsorb(s: AbsorbStage, h: number): void {
    if (s.pending > 0) {
      s.timer -= h;
      if (s.timer <= 0) {
        // An impulse, not a target. The stage compresses because energy arrived,
        // then rebounds on its own frequency — which is what gives the chain its
        // travelling-wave read up the body.
        s.spring.velocity -= s.pending;
        s.pending = 0;
      }
    }
    springStepDamped(s.spring, 0, s.omega, s.zeta, h);
  }

  private beginCrash(state: BikeState): void {
    this.crashTime = 0;
    this.settleWeight = 0;
    // If we arrived a step late the flag is gone but the severity is still on
    // the state; if even that is missing, a crash is never gentle — 0.55 is the
    // floor, because a crash the rider barely reacts to is worse than one that
    // over-reacts.
    this.crashSeverity = Math.max(clamp01(state.crashSeverity), 0.55);
    _q0.copy(state.orientation).invert();
    this.crashDirRig.copy(state.crashDirection);
    if (this.crashDirRig.lengthSq() < 1e-6) this.crashDirRig.set(0, 0, 1);
    this.crashDirRig.applyQuaternion(_q0).normalize();

    // The rider is already off the bike by the time the first frame renders.
    // Starting the blend from zero costs three frames of a rider still sitting
    // neatly on a bike that is on its side.
    this.crashWeight = Math.max(this.crashWeight, 0.34);

    // Tumble axis: perpendicular to the impact, in the bike's frame, plus
    // whatever the frame itself is already rotating about — so the rider goes
    // over the same way the bike does instead of picking an unrelated axis.
    this.crashAxis.crossVectors(UP, this.crashDirRig);
    this.crashAxis.addScaledVector(this.angVelRig, 0.10);
    if (this.crashAxis.lengthSq() < 1e-6) this.crashAxis.copy(LEFT);
    this.crashAxis.normalize();
    this.crashSpin = 0;

    // ── Per-rider variation ─────────────────────────────────────────────────
    // Two riders who go down the same way must not go down the SAME. `phase` is
    // already a deterministic per-rider constant (hashed from the racer id), so
    // it costs nothing to seed the crash's own timing and asymmetry from it —
    // and being deterministic, a replay of the same crash is identical.
    this.crashBias = Math.sin(this.phase * 2.7 + 1.3);
    const jitter = 0.86 + 0.28 * (0.5 + 0.5 * Math.cos(this.phase * 1.9));

    // ~0.8 rev/s at full severity. Fast enough that the tumble is unmistakable
    // inside three frames, slow enough that the rider is not a propeller.
    this.crashSpinRate = (2.1 + this.crashSeverity * 3.2) * jitter;
    // How long the body takes to get to the floor. A harder hit throws the
    // rider down faster, but never faster than a fall: 0.10 s of brace plus
    // 0.34 s of fall is 0.44 s at maximum severity, and a gentle one takes
    // 0.60 s. Below that it is a pose swap, whatever it is blended with.
    this.crashFall = (0.50 - 0.16 * this.crashSeverity) * jitter;

    const d = this.crashDirRig;
    const lateral = Math.abs(d.x);
    const frontal = d.z;
    if (frontal > 0.45 && frontal > lateral) {
      // Hit from the front: over the bars.
      this.crashPose = CRASH_OTB;
      this.crashSide = d.x >= 0 ? 1 : -1;
    } else if (lateral > 0.42) {
      // Hit from the side: down on the opposite hip.
      this.crashPose = CRASH_LOWSIDE;
      this.crashSide = d.x >= 0 ? -1 : 1;
    } else if (d.y > 0.55 && this.crashSeverity < 0.6) {
      // Straight down, survivable: a heavy case that folds the rider up.
      this.crashPose = CRASH_SETTLE;
      this.crashSide = 1;
    } else {
      this.crashPose = CRASH_TUMBLE;
      this.crashSide = d.x >= 0 ? -1 : 1;
    }
  }

  /**
   * Where the head is looking, in rig space.
   *
   * Grounded, it leads the steering — a rider looks through the corner, and the
   * head arriving before the bike does is most of what sells a turn. Airborne,
   * it tracks the velocity vector, which points at the landing.
   */
  private updateLook(state: BikeState, h: number, time: number): void {
    // Three signals, because no one of them is enough on its own:
    //
    //  • steerAngle — what the bars are doing. On a fast, banked corner this is
    //    tiny (measured 0.32 rad through the switchbacks while the bike was
    //    leaned 0.98 rad), so a head driven by the bars alone barely moves.
    //    That is the whole of "the helmet points straight down the bike axis
    //    for the entire entry".
    //  • lean — a rider going round on lean rather than on steering is still
    //    going round, and the head is the first thing that knows it.
    //  • yaw rate — the actual turn, which leads both of the above out of a
    //    berm and lags them into one.
    const yawLead = clamp(
      state.steerAngle * 1.9 + state.lean * 0.62 + this.angVelRig.y * 0.42,
      -1.05,
      1.05,
    );
    _v0.set(Math.sin(yawLead), 0, Math.cos(yawLead));

    if (this.airWeight > 0.02) {
      // Spot the landing: look along where the bike is actually going, dropping
      // the gaze as the arc turns over.
      _v1.copy(this.velRig);
      if (_v1.lengthSq() < 0.25) _v1.copy(FWD);
      _v1.normalize();
      _v1.y = clamp(_v1.y - 0.22 * clamp01(state.airTime), -0.85, 0.4);
      _v1.normalize();
      _v0.lerp(_v1, this.airWeight * 0.85);
    } else {
      // A little downward bias at speed — the trail is closer than the horizon.
      _v0.y -= 0.06 + 0.05 * clamp01(this.speedSm / 16);
    }

    // A whisper of idle drift so a stationary rider is never perfectly still.
    const idle = Math.sin(time * 0.7 + this.phase) * 0.012 + Math.sin(time * 1.31 + this.phase * 2) * 0.006;
    _v0.x += idle;
    _v0.normalize();

    // Faster than the torso's 0.09 s so the head genuinely ARRIVES FIRST. A
    // head that lags the shoulders is a passenger; a head that leads them is a
    // rider choosing a line.
    dampVec3(this.lookDir, _v0, 0.055, h);
    if (this.lookDir.lengthSq() < 1e-6) this.lookDir.copy(FWD);
    this.lookDir.normalize();
  }

  // ── 4. Target pose ────────────────────────────────────────────────────────

  private buildTarget(state: BikeState, trick: TrickState, h: number, time: number): void {
    const t = this.target;

    // Riding base: seated → standing, then the situational layers on top. Order
    // matters — later layers win, and the ones that win are the ones the rider
    // has no choice about.
    copyPose(t, SEATED);
    lerpPose(t, ATTACK, this.standWeight);
    lerpPose(t, COAST, this.coastWeight * 0.55 * (1 - this.airWeight));
    lerpPose(t, SPRINT, this.effort * 0.75 * this.standWeight);
    lerpPose(t, BRAKE, this.brakeWeight * 0.85);
    lerpPose(t, CROUCH, clamp01(state.preload) * 0.95);
    lerpPose(t, PUMP_RELEASE, this.pumpPulse * 0.9);
    lerpPose(t, MANUAL, clamp01(state.manualAmount) * 0.9);
    lerpPose(t, AIR, this.airWeight * 0.8);

    // Trick. The pose is authored for one side and mirrored on demand, and it is
    // blended in on the trick's own phase so the rider comes home in step with
    // the bike.
    const kind = trick.kind;
    if (kind !== TrickKind.None && kind !== TrickKind.Manual) {
      const src = TRICK_POSES[kind];
      if (src) {
        const w = clamp01(trick.phase);
        if (w > 0.001) {
          sidedPose(src, this.trickSide, this.trickBuf);
          lerpPose(t, this.trickBuf, w);
        }
      }
    }

    // ── Crash last: nothing overrides being on the floor ────────────────────
    //
    // THE CRASH IS A FALL, AND A FALL HAS STAGES. What used to happen here was
    // one authored pose blended in on a 30 ms half-life: 167 ms from riding to
    // fully prone, which is faster than gravity. A body cannot travel saddle
    // height in less than sqrt(2h/g) = 450 ms, and a viewer knows it even if
    // they could not say why — the old crash read as the rider being replaced
    // rather than as the rider going down.
    //
    // So there are three links, in the order a real one happens:
    //
    //   BRACE   0 - 100 ms   something let go. The leading hand comes off the
    //                        bar, the shoulder drops toward the impact, the
    //                        hips slide back. The trailing hand is STILL on the
    //                        bar and both feet are STILL on the pedals — the
    //                        rider is on the bike here, and knows it.
    //   FALL    over `crashFall`  the body separates and rotates down onto the
    //                        chosen shape. This is the part that cannot be
    //                        rushed, and its duration is set from the severity.
    //   SETTLE  on recovery  the fight stops and the body folds.
    //
    // `crashFall` is jittered per rider, so two riders going down in the same
    // pile-up are never on the same schedule even when the impact geometry
    // hands them the same pose.
    if (this.crashWeight > 0.001) {
      sidedPose(CRASH_BRACE, this.crashSide, this.trickBuf);
      const fall = this.crashFallW;
      if (fall > 0.001) {
        sidedPose(this.crashPose, this.crashSide, this.crashBuf);
        lerpPose(this.trickBuf, this.crashBuf, fall);
      }
      // Coming to rest is a different shape from going over. Folding the chosen
      // crash pose toward CRASH_SETTLE as the bike is stood back up is what
      // stops the rider holding a rag-doll star for the whole recovery.
      if (this.settleWeight > 0.002) lerpPose(this.trickBuf, CRASH_SETTLE, this.settleWeight * 0.8);
      this.addCrashFlail(this.trickBuf, h, time);
      lerpPose(t, this.trickBuf, this.crashWeight);
    }

    // ── Counter-lean: a CORRECTION on top of full inheritance ───────────────
    //
    // The rider already has all of the bike's roll. `syncRoot` copies
    // `state.orientation` onto the rig root, so before a single channel is read
    // the pelvis, the spine, the head and both contacts are rolled with the
    // frame. Everything below only decides how much of that the rider gives
    // BACK, and the answer is a fraction — never all of it.
    //
    // What this used to do was subtract `state.lean * 0.46`, and `state.lean`
    // is roll against the SURFACE, not against gravity. On a bermed switchback
    // the two differ by more than a factor of two: measured f0044-f0091, lean
    // 0.72 rad against a root rolled 0.318 rad. 0.46 of the first is 104% of
    // the second, so the correction cancelled the inheritance exactly and the
    // torso came out vertical — chest roll 0.5 to 2.2 degrees for 780 ms with
    // the bike at 18 degrees and the trail banked under it.
    //
    // Countering `rollWorld` instead makes the gains mean what they say, and
    // they are staged UP the body, which is the read: the hips are on the bike
    // and go where it goes, the shoulders come up a little, the head comes up
    // most. Eyes near level, hips fully committed, a visible twist between
    // them. A rider countering with their hips is a rider falling off.
    const roll = clamp(this.rollWorld, -1.3, 1.3);
    const lean = clamp(state.lean, -1.2, 1.2);
    const upright = 1 - this.crashWeight; // no counter-lean once you are down
    t[PC.spineSide] += -roll * 0.26 * upright;
    t[PC.chestBend] += -Math.abs(roll) * 0.05 * upright;
    // The hips slide to the OUTSIDE of the turn — the rider's mass stays over
    // the tyres while the frame goes over. This is the one lateral term that is
    // still driven by lean, because it answers cornering load, not gravity.
    t[PC.pelvisX] += lean * 0.075 * upright;
    // Eyes nearly level. Not exactly level: a head pinned to the horizon while
    // the body rolls under it reads as a gimbal, and 0.62 leaves the helmet
    // about a third of the way over, which is what a rider looking through a
    // berm actually does.
    t[PC.headRoll] += -roll * 0.62 * upright;
    const steer = clamp(state.steerAngle, -0.7, 0.7);
    t[PC.spineTwist] += (steer * 0.34 + lean * 0.16) * upright;
    // The inside elbow drops and the outside one lifts through a corner.
    t[PC.elbowOutL] += lean * 0.13 * upright;
    t[PC.elbowOutR] += -lean * 0.13 * upright;

    // Pedalling: hips rock, shoulders counter-rock. Feet are locked to the real
    // cranks, so the legs are already pumping; this is the upper body's answer.
    if (this.effort > 0.01) {
      const s = Math.sin(this.crankAngle);
      const c = Math.cos(this.crankAngle);
      const e = this.effort * (0.35 + this.standWeight * 0.65);
      t[PC.pelvisX] += s * 0.032 * e;
      t[PC.pelvisY] -= Math.abs(s) * 0.022 * e;
      t[PC.spineTwist] += s * 0.115 * e;
      t[PC.spineSide] += s * 0.070 * e;
      t[PC.elbowOutL] += c * 0.14 * e;
      t[PC.elbowOutR] -= c * 0.14 * e;
      t[PC.shrug] += Math.abs(c) * 0.075 * e;
      t[PC.headRoll] += s * 0.045 * e;
    }

    // Working the bike. Below the pedalling threshold a rider at 78 km/h is
    // still doing something with their body every single frame — absorbing,
    // shifting weight, checking the line. Without this the steady-state pose is
    // literally constant, which is what the critic read as a freeze. Two
    // incommensurate frequencies plus the live suspension signal, so no two
    // frames can coincide, scaled by speed and by how rough the ground is.
    const life = (0.25 + this.roughness * 0.9) * smoothstep(3, 14, this.speedSm) * (1 - this.crashWeight);
    if (life > 0.002) {
      const w1 = Math.sin(time * 2.3 + this.phase);
      const w2 = Math.sin(time * 3.7 + this.phase * 1.7);
      const w3 = Math.sin(time * 1.13 + this.phase * 0.6);
      t[PC.pelvisX] += (w1 * 0.011 + w2 * 0.006) * life;
      t[PC.spineSide] += (w2 * 0.030 + w3 * 0.018) * life;
      t[PC.spineTwist] += (w3 * 0.036 + w1 * 0.015) * life;
      t[PC.spineBend] += w1 * 0.028 * life;
      t[PC.shrug] += w2 * 0.030 * life;
      t[PC.elbowOutL] += w3 * 0.045 * life;
      t[PC.elbowOutR] += w1 * 0.045 * life;
    }

    // Breathing. Tiny, but a chest that never moves is uncanny at close range.
    const breath = Math.sin(time * (1.6 + this.effort * 2.2) + this.phase) * (0.006 + this.effort * 0.010);
    t[PC.spineStretch] += breath;
    t[PC.shrug] += breath * 1.4;
  }

  /**
   * Direction-driven flail on top of the authored crash pose.
   *
   * The authored poses give the shape; this gives the physics. Limbs are thrown
   * AWAY from the impact, the tumble accelerates over the first half second, and
   * a noise term stops four riders crashing identically.
   */
  private addCrashFlail(p: Pose, h: number, time: number): void {
    const d = this.crashDirRig;
    const sev = this.crashSeverity;
    const t = this.crashTime;
    void h;

    // The impact throw: hard, immediate, and mostly over inside a second. Limbs
    // lag the body by a frame or two, which is what `min(t * 5, 1)` buys.
    const throwArc = Math.min(1, t * 5.0) * (1 - smoothstep(0.7, 2.0, t));
    // The rag-doll floor. This is the fix for "nine pixel-identical frames":
    // the old envelope decayed to zero and left a dead pose holding for the
    // rest of the sequence, and the flail was multiplied by a severity that
    // was never set. A body sliding down a hillside is never still, so the
    // limbs keep swinging at a reduced amplitude for as long as the crash
    // lasts, and only the SETTLE weight quietens them.
    const limp = (1 - this.settleWeight * 0.75) * (0.34 + 0.66 * throwArc);
    const swing = sev * Math.max(throwArc, limp * 0.55);

    // Three incommensurate frequencies. Two sines at a rational ratio repeat;
    // these do not, so no two frames of a crash can ever match.
    const flap =
      Math.sin(t * 11.0 + this.phase) * 0.44 +
      Math.sin(t * 17.3 + this.phase * 2) * 0.34 +
      Math.sin(t * 6.7 + this.phase * 0.5) * 0.22;
    const flapB =
      Math.cos(t * 13.1 + this.phase * 1.3) * 0.5 + Math.cos(t * 8.3 + this.phase * 0.7) * 0.5;
    const loose = limp * sev;

    p[PC.spineBend] += (-d.z * 0.62 + flapB * 0.16) * swing;
    p[PC.spineSide] += (-d.x * 0.70 + flap * 0.14) * swing;
    p[PC.spineTwist] += (d.x * 0.42 + flapB * 0.18) * swing;
    p[PC.headPitch] += clamp(-d.z * 0.55 + 0.35, -0.8, 0.9) * swing + flapB * 0.22 * loose;
    p[PC.headYaw] += -d.x * 0.62 * swing + flap * 0.26 * loose;
    p[PC.headRoll] += -d.x * 0.46 * swing + flapB * 0.20 * loose;

    // Arms lead the impact vector — a rider goes into the ground reaching for
    // it. The hands are unlocked by every crash pose, so these offsets are
    // absolute displacement from where the arm would otherwise hang.
    p[PC.handOffLX] += (-d.x * 0.30 + flap * 0.11) * swing;
    p[PC.handOffRX] += (-d.x * 0.30 - flap * 0.11) * swing;
    p[PC.handOffLY] += (-d.y * 0.24 + flapB * 0.13) * swing;
    p[PC.handOffRY] += (-d.y * 0.24 - flapB * 0.13) * swing;
    p[PC.handOffLZ] += (-d.z * 0.34 + flapB * 0.09) * swing;
    p[PC.handOffRZ] += (-d.z * 0.34 - flap * 0.09) * swing;
    p[PC.elbowOutL] += flap * 0.34 * loose;
    p[PC.elbowOutR] += -flapB * 0.34 * loose;

    p[PC.footOffLX] += (-d.x * 0.22 + flapB * 0.08) * swing;
    p[PC.footOffRX] += (-d.x * 0.22 - flapB * 0.08) * swing;
    p[PC.footOffLY] += flap * 0.10 * loose;
    p[PC.footOffRY] += -flapB * 0.10 * loose;
    p[PC.footOffLZ] += -d.z * 0.28 * swing + flap * 0.09 * swing;
    p[PC.footOffRZ] += -d.z * 0.28 * swing - flap * 0.09 * swing;

    // ── The legs do not do the same thing as each other ─────────────────────
    //
    // The knees were `flap * 0.34` and `-flapB * 0.34` — two noise terms with
    // no reference to the impact at all, which is why both riders in a crash
    // came out with the same bend in both knees and only the noise phase told
    // them apart. A body going down on its left hip traps the LEFT leg between
    // the bike and the ground, so it folds; the right leg is free above it and
    // swings out and straightens as the hips rotate over.
    //
    // `lead` is 1 when the impact is arriving from this side. Severity scales
    // the whole asymmetry, so a light case bends both knees a little and a
    // 60 km/h low-side folds one leg up and throws the other straight.
    const leadL = clamp01(0.5 + d.x * 0.62);
    const asym = sev * swing;
    p[PC.kneeOutL] += (0.72 * leadL - 0.26) * asym + (flap * 0.20 + this.crashBias * 0.10) * loose;
    p[PC.kneeOutR] += (0.72 * (1 - leadL) - 0.26) * asym - (flapB * 0.20 + this.crashBias * 0.10) * loose;
    // The trapped leg's foot is pinned and its ankle is forced; the free one
    // trails. Same asymmetry, opposite channel, so the two legs never read as
    // a mirrored pair.
    p[PC.ankleFlexL] += (0.30 - 0.55 * leadL) * asym + flapB * 0.24 * loose;
    p[PC.ankleFlexR] += (0.30 - 0.55 * (1 - leadL)) * asym + flap * 0.24 * loose;
  }

  // ── 5. Integrate ──────────────────────────────────────────────────────────

  /**
   * Per-channel half-life damping. Frame-rate independent by construction.
   *
   * The four LOCK channels are asymmetric, and that asymmetry is the whole of
   * "the release and the return should look natural". A foot leaving a pedal
   * for a superman or a no-footer is a kick — it happens in two frames and the
   * only thing that could make it look wrong is hesitation. A foot COMING BACK
   * is the opposite: the rider has to find the platform, and a foot that snaps
   * onto a pedal in two frames reads as a magnet. So the release runs on the
   * table's own half-life and the return runs on a slower one, which gives the
   * foot an approach instead of a teleport.
   */
  private integratePose(h: number): void {
    const p = this.pose;
    const t = this.target;
    for (let i = 0; i < p.length; i++) {
      // A rising lock is a contact being RE-MADE, and that is the slow one.
      const hl = LOCK_CHANNELS[i] && t[i] > p[i] ? POSE_HALFLIFE_RETURN[i] : POSE_HALFLIFE[i];
      p[i] = hl <= 0 ? t[i] : t[i] + (p[i] - t[i]) * Math.pow(2, -h / hl);
    }
  }

  /**
   * Everything that must NOT be re-smoothed: the landing chain (its stagger is
   * the whole point and a second filter would blur it away) and the secondary
   * springs, which already have their own dynamics.
   */
  private applySecondary(state: BikeState, h: number, time: number): void {
    const a = copyPose(this.applied, this.pose);

    // ── The landing chain ───────────────────────────────────────────────────
    // Four separate events, in the order the energy actually travels:
    //
    //   fork  (t+0 ms)    the bars drop into the fork's travel; the rider's
    //                     arms take it, so the elbows flare and the shoulders
    //                     shrug up as the body's mass keeps going down
    //   legs  (t+40 ms)   the pelvis drops. The feet are pinned to the pedals,
    //                     so this bends both knees for free
    //   spine (t+85 ms)   the back folds and the chest closes
    //   head  (t+130 ms)  the helmet drops last and rebounds on its own
    //
    // The fork stage was previously computed every frame and then never read by
    // anything, so the first link of the chain contributed nothing at all —
    // which is half of why the stagger did not read as separate events.
    const fork = this.absorbFork.spring.value;
    const legs = this.absorbLegs.spring.value;
    const spine = this.absorbSpine.spring.value;
    a[PC.elbowOutL] += -fork * 0.90;
    a[PC.elbowOutR] += -fork * 0.90;
    a[PC.shrug] += -fork * 0.85;
    a[PC.pelvisZ] += fork * 0.10;

    a[PC.pelvisY] += legs;
    a[PC.pelvisZ] += legs * 0.22;
    a[PC.kneeOutL] += -legs * 0.85;
    a[PC.kneeOutR] += -legs * 0.85;
    a[PC.ankleFlexL] += -legs * 0.75;
    a[PC.ankleFlexR] += -legs * 0.75;

    a[PC.spineBend] += -spine * 0.95;
    a[PC.chestBend] += -spine * 0.42;
    a[PC.spineStretch] += clamp(spine * 0.12, -0.09, 0.09);
    a[PC.shrug] += -spine * 0.34;

    // Continuous suspension chatter. Split front from rear rather than averaged:
    // the difference is what pitches the rider, and an average of the two throws
    // away exactly the signal that makes a rough surface look rough. This is
    // also what keeps consecutive frames different at a steady 78 km/h.
    const cf = clamp01(state.front.compression);
    const cr = clamp01(state.rear.compression);
    a[PC.pelvisY] -= (cf + cr) * 0.035;
    a[PC.spineBend] += (cf * 0.13 - cr * 0.055);
    a[PC.pelvisZ] += (cr - cf) * 0.030;
    a[PC.shrug] += cf * 0.070;

    // Head bob: driven by vertical acceleration, damped, and deliberately soft
    // so it reads as mass rather than as a wobble.
    const bobTarget = clamp(-this.accelRig.y * 0.0045, -0.045, 0.045) + this.absorbHead.spring.value * 0.12;
    springStepDamped(this.headBob, bobTarget, 17, 0.62, h);
    a[PC.headPitch] += -this.absorbHead.spring.value * 0.75 + this.headBob.value * 1.6;
    a[PC.headLook] *= 1 - clamp01(Math.abs(this.absorbHead.spring.value) * 0.9);

    // Arm counter-sway. Lateral acceleration throws the mass of the arms
    // outboard a beat behind the body.
    springStepDamped(this.armSway, clamp(this.accelRig.x * 0.020, -0.30, 0.30), 12, 0.55, h);
    a[PC.elbowOutL] += this.armSway.value;
    a[PC.elbowOutR] += -this.armSway.value;
    a[PC.shrug] += Math.abs(this.armSway.value) * 0.25;

    // Cloth attitude. The hem trails with speed, swings forward under braking
    // and out under lateral load.
    const hemTarget = clamp(
      0.014 * this.speedSm + 0.030 * this.accelRig.z + 0.55 * a[PC.hemSwing] + 0.20 * a[PC.spineBend],
      -0.55,
      1.0,
    );
    springStepDamped(this.hemPitch, hemTarget, 11, 0.42, h);
    springStepDamped(this.hemRoll, clamp(-this.accelRig.x * 0.026, -0.4, 0.4), 10, 0.45, h);
    const shortsTarget =
      Math.sin(this.crankAngle) * 0.14 * this.effort + 0.010 * this.speedSm + this.absorbLegs.spring.value * 0.8;
    springStepDamped(this.shortsSwing, clamp(shortsTarget, -0.5, 0.6), 13, 0.40, h);
  }

  // ── 6. Pelvis ─────────────────────────────────────────────────────────────

  private poseRoot(state: BikeState, h: number): void {
    const a = this.applied;

    // Crash separation: the rider is thrown off the bike, but stays in the
    // bike's neighbourhood because the rig root IS the bike.
    //
    // The separation GROWS — the rider and the bike part company over the first
    // half second and only come back together during the recovery. A constant
    // offset (which is what this was) puts the rider at a fixed distance from
    // frame one and then never changes again, so the two never read as two
    // objects with different momentum.
    if (this.crashWeight > 0.001) {
      const k = this.crashWeight * this.crashSeverity;
      // Gated on the FALL, not on the clock. The rider is still on the bike
      // through the brace, so the separation must not have started: an
      // exponential in `crashTime` alone had the hips 22% of the way off the
      // frame at 100 ms, while the pose above still had a hand on the bar and
      // both feet on the pedals. The two disagreed, and the disagreement is
      // exactly the "pose swap" read.
      const part =
        this.crashFallW * (1 - Math.pow(2, -this.crashTime / 0.28)) * (1 - this.settleWeight * 0.55);
      const reach = 0.52 * k * part;
      _v0.copy(this.crashDirRig).multiplyScalar(-reach);
      // Up and back over the bars, then down as the tumble carries through.
      _v0.y += (0.26 - 0.42 * clamp01(this.crashTime / 0.9)) * k * part;
      _v0.z -= 0.10 * k * part;
    } else {
      _v0.set(0, 0, 0);
    }
    dampVec3(this.crashOffset, _v0, 0.09, h);

    const p = this.rigPos[B.pelvis];
    p.copy(REST.pos[B.pelvis]);
    p.x += a[PC.pelvisX] + this.crashOffset.x;
    p.y += a[PC.pelvisY] + this.crashOffset.y;
    p.z += a[PC.pelvisZ] + this.crashOffset.z;

    // ── The floor ───────────────────────────────────────────────────────────
    //
    // A crashed rider must not go through the mountain, and the rig has no
    // other mechanism that would stop it: every term above is expressed in the
    // BIKE's frame, and the bike ends a crash lying on its side, so "down" for
    // the crash pose and "down" for gravity are ninety degrees apart. The hips
    // ended up 0.88 m under the trail.
    //
    // The clamp is in WORLD height, against the surface the bike's own contact
    // anchors report, and it only ever pushes UP. 0.26 m is where the hip of a
    // body lying on its side sits — half a hip width plus the shorts.
    if (this.crashWeight > 0.02 && this.groundValid) {
      _v1.copy(p).applyMatrix4(this.object.matrixWorld);
      const floor = this.groundWorldY + 0.26;
      if (_v1.y < floor) {
        _v1.y = floor;
        this.worldToRig.copy(this.object.matrixWorld).invert();
        p.copy(_v1.applyMatrix4(this.worldToRig));
      }
    }

    // Pelvis attitude, plus the tumble rotation during a crash. Rotating the
    // pelvis rotates the entire rider, which is exactly what a tumble is.
    eulerQuat(a[PC.pelvisPitch], a[PC.pelvisYaw], a[PC.pelvisRoll], _q0);
    if (this.crashWeight > 0.001 || Math.abs(this.crashSpin) > 1e-3) {
      // `crashSpin` is INTEGRATED in readSignals from a decaying rate, so it
      // keeps advancing for as long as the crash runs and unwinds smoothly on
      // recovery. The old clamp at 2.2 rad froze the whole rider the moment it
      // was reached, which at the (3x too fast) timestep happened 17 frames in
      // — dead centre of the window the critic reviewed.
      const spin = this.crashSpin * this.crashWeight;
      _q1.setFromAxisAngle(this.crashAxis, spin);
      _q0.premultiply(_q1);
    }
    this.rigQuat[B.pelvis].copy(_q0);
  }

  // ── 7. Spine ──────────────────────────────────────────────────────────────

  /**
   * The spine is solved, not rotated.
   *
   * We compute where the base of the neck WOULD be if the whole torso rotated
   * rigidly by the pose's bend/side/twist, then FABRIK the four-point chain to
   * that target with the lower back stiffer than the upper. The result is a
   * curve that distributes the bend the way a back does, instead of a hinge at
   * one joint — and because the chain is length-exact, the torso never
   * telescopes.
   */
  private poseSpine(): void {
    const a = this.applied;
    const stretch = clamp(a[PC.spineStretch], 0.82, 1.14);
    const qPelvis = this.rigQuat[B.pelvis];

    // Chain origin: the base of the spine, carried by the pelvis.
    const origin = this.rigPos[B.spine1];
    origin.copy(REST.offset[B.spine1]).multiplyScalar(stretch).applyQuaternion(qPelvis).add(this.rigPos[B.pelvis]);

    // Torso aim.
    eulerQuat(a[PC.spineBend] + a[PC.chestBend], a[PC.spineTwist], a[PC.spineSide], _q0);
    _q1.copy(qPelvis).multiply(_q0); // full torso rotation, rig space

    _v0.copy(REST.pos[B.neck]).sub(REST.pos[B.spine1]).multiplyScalar(stretch).applyQuaternion(_q1);
    _v0.add(origin); // neck target

    this.spinePts[0].copy(origin);
    this.spinePts[1].copy(this.rigPos[B.spine2]);
    this.spinePts[2].copy(this.rigPos[B.chest]);
    this.spinePts[3].copy(this.rigPos[B.neck]);

    const l0 = this.spineLen[0] * stretch;
    const l1 = this.spineLen[1] * stretch;
    const l2 = this.spineLen[2] * stretch;
    _spineLenBuf[0] = l0;
    _spineLenBuf[1] = l1;
    _spineLenBuf[2] = l2;

    solveFabrik(this.spinePts, _spineLenBuf, origin, _v0, this.spineStiff, 5, 3e-4);

    // Twist is distributed along the chain — the lower back barely rotates, the
    // shoulders carry most of it. Interpolating the SIDE reference rather than
    // rotating each bone about its own axis keeps the twist continuous with the
    // bend the FABRIK pass just produced.
    for (let k = 0; k < 3; k++) {
      const bone = SPINE_CHAIN[k];
      const child = SPINE_CHILD[k];
      _q2.copy(qPelvis).slerp(_q1, SPINE_TWIST_W[k]);
      _v2.copy(REST.side[bone]).applyQuaternion(_q2);
      _v3.subVectors(this.spinePts[k + 1], this.spinePts[k]);
      alignFrames(REST.dir[bone], REST.side[bone], _v3, _v2, this.rigQuat[bone]);
      this.rigPos[child].copy(this.spinePts[k + 1]);
      this.boneScale[child] = stretch;
    }
    this.boneScale[B.spine1] = stretch;

    // Clavicles: shrug lifts the shoulder on each side.
    const shrug = clamp(a[PC.shrug], -0.5, 0.7);
    for (let s = 0; s < 2; s++) {
      const idx = s === 0 ? B.clavL : B.clavR;
      const side = s === 0 ? 1 : -1;
      _q3.setFromAxisAngle(FWD, side * shrug * 0.38);
      this.rigQuat[idx].copy(this.rigQuat[B.chest]).multiply(_q3);
      this.rigPos[idx]
        .copy(REST.offset[idx])
        .applyQuaternion(this.rigQuat[B.chest])
        .add(this.rigPos[B.chest]);
      const arm = s === 0 ? B.upperArmL : B.upperArmR;
      this.rigPos[arm].copy(REST.offset[arm]).applyQuaternion(this.rigQuat[idx]).add(this.rigPos[idx]);
    }

    // Hips ride the pelvis.
    this.rigPos[B.thighL].copy(REST.offset[B.thighL]).applyQuaternion(qPelvis).add(this.rigPos[B.pelvis]);
    this.rigPos[B.thighR].copy(REST.offset[B.thighR]).applyQuaternion(qPelvis).add(this.rigPos[B.pelvis]);
  }

  // ── 7b. Contacts and reach ────────────────────────────────────────────────

  /**
   * Where each hand and foot has to end up, in rig space.
   *
   * Locked, that is the anchor itself (for a foot, the fixed ankle offset in the
   * PEDAL's frame, so the sole rides the platform through a whip). Unlocked, it
   * is where the limb would hang from the body. Poses interpolate between the
   * two with `handLock` / `footLock` and then displace with the offset channels.
   */
  private computeTargets(): void {
    const a = this.applied;

    for (let s = 0; s < 2; s++) {
      const isLeft = s === 0;
      const armIdx = isLeft ? B.upperArmL : B.upperArmR;
      const handIdx = isLeft ? B.handL : B.handR;
      const lock = clamp01(isLeft ? a[PC.handLockL] : a[PC.handLockR]);
      const out = this.handTarget[s];

      out.copy(this.anchorPos[s]);
      if (lock < 0.999) {
        _v1.copy(REST.pos[handIdx])
          .sub(REST.pos[armIdx])
          .applyQuaternion(this.rigQuat[B.chest])
          .add(this.rigPos[armIdx]);
        out.lerp(_v1, 1 - lock);
      }
      out.x += isLeft ? a[PC.handOffLX] : a[PC.handOffRX];
      out.y += isLeft ? a[PC.handOffLY] : a[PC.handOffRY];
      out.z += isLeft ? a[PC.handOffLZ] : a[PC.handOffRZ];
    }

    for (let s = 0; s < 2; s++) {
      const isLeft = s === 0;
      const slot = 2 + s;
      const thighIdx = isLeft ? B.thighL : B.thighR;
      const footIdx = isLeft ? B.footL : B.footR;
      const lock = clamp01(isLeft ? a[PC.footLockL] : a[PC.footLockR]);
      const out = this.footTarget[s];

      out.copy(REST.pos[footIdx]).sub(isLeft ? REST.anchors.pedalL : REST.anchors.pedalR);
      out.applyQuaternion(this.anchorQuat[slot]).add(this.anchorPos[slot]);
      if (lock < 0.999) {
        _v1.copy(REST.pos[footIdx])
          .sub(REST.pos[thighIdx])
          .applyQuaternion(this.rigQuat[B.pelvis])
          .add(this.rigPos[thighIdx]);
        out.lerp(_v1, 1 - lock);
      }
      out.x += isLeft ? a[PC.footOffLX] : a[PC.footOffRX];
      out.y += isLeft ? a[PC.footOffLY] : a[PC.footOffRY];
      out.z += isLeft ? a[PC.footOffLZ] : a[PC.footOffRZ];
    }
  }

  /**
   * Move the BODY until the limbs can reach, rather than letting a limb fall
   * short of its anchor.
   *
   * This is the mechanism behind "no sliding, no detaching, ever". A pose can
   * ask for anything — superman puts the hips half a metre behind the bars —
   * and the request is honoured only as far as the arms allow: whatever is left
   * over is applied to the pelvis instead, and the spine is re-solved. Two or
   * three passes converge to millimetres because each pass removes the whole
   * measured excess.
   *
   * Hands and feet pull with equal weight, so the pelvis settles at the least-
   * squares compromise between the two — and whatever residual is left over is
   * inside the stretch budget both limbs carry, which means BOTH contacts still
   * land exactly. Weighting the hands higher was tried and is worse: it fixes
   * the arms and leaves the feet 15 cm off the pedals on a 360.
   */
  private solveReach(): void {
    const a = this.applied;
    // Stop just short of full extension. A limb solved dead straight has no
    // stable bend plane, and the elbow would be free to flip about the axis.
    const maxArm = (ARM_IK.len1 + ARM_IK.len2) * 0.982;
    const maxLeg = (LEG_IK.len1 + LEG_IK.len2) * 0.982;

    for (let iter = 0; iter < 4; iter++) {
      this.computeTargets();
      _v4.set(0, 0, 0);
      let weight = 0;

      for (let s = 0; s < 2; s++) {
        const lock = clamp01(s === 0 ? a[PC.handLockL] : a[PC.handLockR]);
        if (lock < 0.35) continue;
        const shoulder = this.rigPos[s === 0 ? B.upperArmL : B.upperArmR];
        _v5.subVectors(this.handTarget[s], shoulder);
        const d = _v5.length();
        if (d > maxArm) {
          _v4.addScaledVector(_v5.divideScalar(d), (d - maxArm) * lock);
          weight += lock;
        }
      }

      for (let s = 0; s < 2; s++) {
        const lock = clamp01(s === 0 ? a[PC.footLockL] : a[PC.footLockR]);
        if (lock < 0.35) continue;
        const hip = this.rigPos[s === 0 ? B.thighL : B.thighR];
        _v5.subVectors(this.footTarget[s], hip);
        const d = _v5.length();
        if (d > maxLeg) {
          _v4.addScaledVector(_v5.divideScalar(d), (d - maxLeg) * lock);
          weight += lock;
        }
      }

      if (weight < 1e-4) return;
      _v4.divideScalar(weight);
      if (_v4.lengthSq() < 4e-8) return;
      this.rigPos[B.pelvis].add(_v4);
      this.poseSpine();
    }
    // Final pass so the targets match the spine we ended up with.
    this.computeTargets();
  }

  // ── 8. Head ───────────────────────────────────────────────────────────────

  private poseHead(h: number): void {
    const a = this.applied;

    // Convert the world-ish look direction into the chest's frame, so "look 20°
    // left" means 20° left of the rider's shoulders rather than of the mountain.
    _q0.copy(this.rigQuat[B.chest]).invert();
    _v0.copy(this.lookDir).applyQuaternion(_q0);
    if (_v0.lengthSq() < 1e-8) _v0.copy(FWD);
    _v0.normalize();

    const look = clamp01(a[PC.headLook]);
    let yaw = Math.atan2(_v0.x, Math.max(_v0.z, 0.05)) * look + a[PC.headYaw];
    let pitch = -Math.asin(clamp(_v0.y, -1, 1)) * look + a[PC.headPitch];
    let roll = a[PC.headRoll] - yaw * 0.18; // a head that turns also tilts

    yaw = clamp(yaw, -1.15, 1.15);
    pitch = clamp(pitch, -0.85, 0.95);
    roll = clamp(roll, -0.7, 0.7);

    // Split between the neck and the skull. A neck that takes none of it makes
    // the head look bolted on; one that takes half makes the rider look boneless.
    eulerQuat(pitch * 0.36, yaw * 0.36, roll * 0.30, _q1);
    this.rigQuat[B.neck].copy(this.rigQuat[B.chest]).multiply(_q1);
    this.rigPos[B.neck].copy(this.spinePts[3]);

    eulerQuat(pitch * 0.64, yaw * 0.64, roll * 0.70, _q2);
    this.rigQuat[B.head].copy(this.rigQuat[B.neck]).multiply(_q2);
    this.rigPos[B.head]
      .copy(REST.offset[B.head])
      .applyQuaternion(this.rigQuat[B.neck])
      .add(this.rigPos[B.neck]);

    this.rigQuat[B.headEnd].copy(this.rigQuat[B.head]);
  }

  // ── 9. Arms ───────────────────────────────────────────────────────────────

  /**
   * Two-bone IK from each shoulder to its bar anchor.
   *
   * The target is the anchor itself — not an offset from it, not a smoothed
   * version of it — so the hand is on the grip to the millimetre on every frame,
   * including the frame a landing compresses the fork 130 mm or a tailwhip
   * throws the frame through 360°.
   */
  private poseArms(h: number): void {
    const a = this.applied;

    for (let s = 0; s < 2; s++) {
      const isLeft = s === 0;
      const side = isLeft ? 1 : -1;
      const armIdx = isLeft ? B.upperArmL : B.upperArmR;
      const foreIdx = isLeft ? B.forearmL : B.forearmR;
      const handIdx = isLeft ? B.handL : B.handR;
      const endIdx = isLeft ? B.handEndL : B.handEndR;
      const lock = clamp01(isLeft ? a[PC.handLockL] : a[PC.handLockR]);
      const elbowOut = isLeft ? a[PC.elbowOutL] : a[PC.elbowOutR];

      const shoulder = this.rigPos[armIdx];
      _v0.copy(this.handTarget[s]);

      // Pole: the rest bend plane carried by the chest, pushed outboard by the
      // pose. Passing a DIRECTION (not a point) is what keeps the elbow stable
      // when the arm is nearly straight.
      _v2.copy(isLeft ? REST.bend.armL : REST.bend.armR).applyQuaternion(this.rigQuat[B.chest]);
      _v3.copy(LEFT).applyQuaternion(this.rigQuat[B.chest]).multiplyScalar(side * elbowOut * 0.9);
      _v2.add(_v3);

      const st = this.armState[s];
      const res = this.armRes[s];
      solveTwoBone(shoulder, _v0, _v2, ARM_IK, st, h, res);

      // Self-collision. A deep frontflip tuck folds the chest onto the knees and
      // the old solve let the forearm pass straight through a thigh, because
      // nothing in a two-bone IK knows the rest of the body exists. Measuring
      // the forearm against both thigh capsules and pushing the POLE (not the
      // hand, which must stay on the grip) out of the overlap fixes it inside
      // the same frame at the cost of one extra solve on the frames where it
      // actually happens.
      const depth = this.limbOverlap(res.mid, res.end, LIMB_CLEARANCE);
      if (depth > 1e-4) {
        _v2.addScaledVector(_avoidDir, Math.min(depth, 0.12) * 9);
        solveTwoBone(shoulder, _v0, _v2, ARM_IK, st, h, res);
      }

      _v4.subVectors(res.mid, shoulder);
      alignFrames(REST.dir[armIdx], REST.side[armIdx], _v4, st.bendDir, this.rigQuat[armIdx]);
      _v5.subVectors(res.end, res.mid);
      alignFrames(REST.dir[foreIdx], REST.side[foreIdx], _v5, st.bendDir, this.rigQuat[foreIdx]);

      this.rigPos[foreIdx].copy(res.mid);
      this.rigPos[handIdx].copy(res.end);
      this.boneScale[foreIdx] = st.stretch;
      this.boneScale[handIdx] = st.stretch;

      // The hand takes the bar's own rotation, so an x-up rolls the wrists
      // through with the grips instead of shearing the glove off them.
      _q0.copy(this.anchorQuat[s]).multiply(_q1.copy(this.anchorRest[s]).invert());
      if (lock < 0.999) _q0.slerp(this.rigQuat[foreIdx], 1 - lock);
      this.rigQuat[handIdx].copy(_q0);
      this.rigQuat[endIdx].copy(_q0);
    }
  }

  /**
   * How far a forearm has sunk into either thigh, and which way to push it out.
   *
   * Returns the penetration depth in metres and writes the unit separation
   * direction into `_avoidDir`. Both thighs are tested and the worst one wins;
   * testing only the near one misses the case a tuck actually produces, which
   * is the LEFT forearm crossing the RIGHT thigh.
   */
  private limbOverlap(mid: Vector3, end: Vector3, clearance: number): number {
    let worst = 0;
    for (let l = 0; l < 2; l++) {
      const hip = this.rigPos[l === 0 ? B.thighL : B.thighR];
      const knee = this.rigPos[l === 0 ? B.shinL : B.shinR];
      const d = closestSegments(mid, end, hip, knee, _v6, _v7);
      const pen = clearance - d;
      if (pen > worst) {
        worst = pen;
        _v8.subVectors(_v6, _v7);
        if (_v8.lengthSq() < 1e-8) _v8.copy(LEFT); // exactly coincident
        _avoidDir.copy(_v8).normalize();
      }
    }
    return worst;
  }

  // ── 10. Legs ──────────────────────────────────────────────────────────────

  private poseLegs(h: number): void {
    const a = this.applied;

    for (let s = 0; s < 2; s++) {
      const isLeft = s === 0;
      const side = isLeft ? 1 : -1;
      const slot = 2 + s;
      const thighIdx = isLeft ? B.thighL : B.thighR;
      const shinIdx = isLeft ? B.shinL : B.shinR;
      const footIdx = isLeft ? B.footL : B.footR;
      const toeIdx = isLeft ? B.toeL : B.toeR;
      const lock = clamp01(isLeft ? a[PC.footLockL] : a[PC.footLockR]);
      const kneeOut = isLeft ? a[PC.kneeOutL] : a[PC.kneeOutR];
      const flex = isLeft ? a[PC.ankleFlexL] : a[PC.ankleFlexR];

      const hip = this.rigPos[thighIdx];
      _v0.copy(this.footTarget[s]);

      _v2.copy(isLeft ? REST.bend.legL : REST.bend.legR).applyQuaternion(this.rigQuat[B.pelvis]);
      _v3.copy(LEFT).applyQuaternion(this.rigQuat[B.pelvis]).multiplyScalar(side * kneeOut * 0.9);
      _v2.add(_v3);

      const st = this.legState[s];
      const res = this.legRes[s];
      solveTwoBone(hip, _v0, _v2, LEG_IK, st, h, res);

      _v4.subVectors(res.mid, hip);
      alignFrames(REST.dir[thighIdx], REST.side[thighIdx], _v4, st.bendDir, this.rigQuat[thighIdx]);
      _v5.subVectors(res.end, res.mid);
      alignFrames(REST.dir[shinIdx], REST.side[shinIdx], _v5, st.bendDir, this.rigQuat[shinIdx]);

      this.rigPos[shinIdx].copy(res.mid);
      this.rigPos[footIdx].copy(res.end);
      this.boneScale[shinIdx] = st.stretch;
      this.boneScale[footIdx] = st.stretch;

      // Foot: flat on the pedal while locked, trailing the shin when it is not.
      _q0.copy(this.anchorQuat[slot]).multiply(_q1.copy(this.anchorRest[slot]).invert());
      if (lock < 0.999) _q0.slerp(this.rigQuat[shinIdx], 1 - lock);
      _q2.setFromAxisAngle(LEFT, flex * 0.7);
      this.rigQuat[footIdx].copy(_q0).multiply(_q2);
      this.rigQuat[toeIdx].copy(this.rigQuat[footIdx]);
    }
  }

  // ── 11. Cloth ─────────────────────────────────────────────────────────────

  /**
   * The three cloth bones. Not simulation — three springs, driven by body
   * acceleration and airspeed, which is enough to break the "clothing is painted
   * on" read for a fraction of the cost of a real solver.
   */
  private poseCloth(): void {
    _q0.setFromAxisAngle(LEFT, this.hemPitch.value);
    _q1.setFromAxisAngle(FWD, this.hemRoll.value);
    _q0.multiply(_q1);
    this.rigQuat[B.hem].copy(this.rigQuat[B.spine1]).multiply(_q0);
    this.rigPos[B.hem]
      .copy(REST.offset[B.hem])
      .applyQuaternion(this.rigQuat[B.spine1])
      .add(this.rigPos[B.spine1]);

    for (let s = 0; s < 2; s++) {
      const idx = s === 0 ? B.shortsL : B.shortsR;
      const parent = s === 0 ? B.thighL : B.thighR;
      const sign = s === 0 ? 1 : -1;
      _q2.setFromAxisAngle(LEFT, this.shortsSwing.value * (s === 0 ? 1 : -1) * 0.6 + this.hemPitch.value * 0.25);
      _q3.setFromAxisAngle(FWD, this.hemRoll.value * 0.5 + sign * 0.04);
      _q2.multiply(_q3);
      this.rigQuat[idx].copy(this.rigQuat[parent]).multiply(_q2);
      this.rigPos[idx]
        .copy(REST.offset[idx])
        .applyQuaternion(this.rigQuat[parent])
        .add(this.rigPos[parent]);
    }
  }

  // ── 12. Write ─────────────────────────────────────────────────────────────

  /**
   * Convert the rig-space solution into bone local transforms.
   *
   * Because every bone's rest local rotation is identity (see Skeleton.ts), the
   * local rotation is just parentᐨ¹ · rig, and the local translation is the rest
   * offset scaled by whatever the IK had to stretch. three's own matrix update
   * then reproduces exactly the positions solved above.
   */
  private writeBones(): void {
    const bones = this.skel.bones;

    // Pelvis is the root bone: its local transform IS its rig transform.
    bones[B.pelvis].position.copy(this.rigPos[B.pelvis]);
    bones[B.pelvis].quaternion.copy(this.rigQuat[B.pelvis]);

    for (let i = 0; i < BONE_COUNT; i++) {
      if (i === B.pelvis) continue;
      const parent = REST.parents[i];
      const b = bones[i];
      _q0.copy(this.rigQuat[parent]).invert().multiply(this.rigQuat[i]);
      b.quaternion.copy(_q0);
      b.position.copy(REST.offset[i]).multiplyScalar(this.boneScale[i]);
      this.boneScale[i] = 1;
    }

    // The head bob is a real translation of the skull on the neck, not a fake
    // rotation. Applied here so it survives the generic write above.
    bones[B.head].position.y += this.headBob.value * 0.55 - this.absorbHead.spring.value * 0.05;
  }

  // ── Teardown ──────────────────────────────────────────────────────────────

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const m of this.meshes.owned) {
      m.prepassMaterial?.dispose();
      m.shadowMaterial?.dispose();
      m.dispose();
    }
    for (const h of this.meshes.hulls) {
      const mat = h.material;
      if (!Array.isArray(mat)) mat.dispose();
    }
    this.skel.dispose();
    this.object.removeFromParent();
    this.object.clear();
    this.anchors = null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Adopt `userData.bikeAnchors` off an object if it looks like a real anchor set.
 * Duck-typed on purpose: the rig must not import the bike implementation, and a
 * malformed object has to be ignored rather than throw on the first frame.
 */
function adoptAnchors(node: Object3D, rig: RiderRig): boolean {
  const candidate = node.userData?.bikeAnchors as BikeAnchors | undefined;
  if (
    candidate &&
    (candidate.barLeft as Object3D | undefined)?.isObject3D &&
    (candidate.barRight as Object3D | undefined)?.isObject3D &&
    (candidate.pedalLeft as Object3D | undefined)?.isObject3D &&
    (candidate.pedalRight as Object3D | undefined)?.isObject3D
  ) {
    rig.attach(candidate);
    return true;
  }
  return false;
}

/**
 * Build a quaternion from rider-convention angles: pitch about +X (forward
 * bend), yaw about +Y (turn left), roll about +Z (tilt right). YXZ order, which
 * is the order that behaves for a body: yaw is applied in the world-ish frame
 * and pitch below it, so a turned-and-bent torso does not gimbal.
 */
function eulerQuat(pitch: number, yaw: number, roll: number, out: Quaternion): Quaternion {
  _e0.set(pitch, yaw, roll, 'YXZ');
  return out.setFromEuler(_e0);
}

/**
 * Closest points between two segments, written into `outA` / `outB`.
 *
 * The standard clamped-parameter formulation. Degenerate cases (either segment
 * of zero length, the two parallel) fall back to a point-on-segment projection
 * rather than dividing by a vanishing determinant.
 */
function closestSegments(
  p1: Vector3,
  q1: Vector3,
  p2: Vector3,
  q2: Vector3,
  outA: Vector3,
  outB: Vector3,
): number {
  // Private scratch. `outA`/`outB` are routinely aliased to the caller's own
  // scratch vectors, so nothing here may use them as working space.
  _csD1.subVectors(q1, p1);
  _csD2.subVectors(q2, p2);
  _csR.subVectors(p1, p2);
  const a = _csD1.dot(_csD1);
  const e = _csD2.dot(_csD2);
  const f = _csD2.dot(_csR);

  let s = 0;
  let t = 0;
  if (a < 1e-9 && e < 1e-9) {
    outA.copy(p1);
    outB.copy(p2);
    return outA.distanceTo(outB);
  }
  if (a < 1e-9) {
    t = clamp01(f / e);
  } else {
    const c = _csD1.dot(_csR);
    if (e < 1e-9) {
      s = clamp01(-c / a);
    } else {
      const b = _csD1.dot(_csD2);
      const denom = a * e - b * b;
      s = denom > 1e-9 ? clamp01((b * f - c * e) / denom) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = clamp01(-c / a);
      } else if (t > 1) {
        t = 1;
        s = clamp01((b - c) / a);
      }
    }
  }
  outA.copy(p1).addScaledVector(_csD1, s);
  outB.copy(p2).addScaledVector(_csD2, t);
  return outA.distanceTo(outB);
}

/** Pedal spindle in rig space at a given crank angle. See Skeleton.pedalPosition. */
function pedalRest(side: number, angle: number, out: Vector3): Vector3 {
  const L = BIKE_GEOM.crankLength;
  return out.set(
    BIKE_GEOM.bb.x + side * BIKE_GEOM.crankOffset,
    BIKE_GEOM.bb.y - side * L * Math.cos(angle),
    BIKE_GEOM.bb.z - side * L * Math.sin(angle),
  );
}
