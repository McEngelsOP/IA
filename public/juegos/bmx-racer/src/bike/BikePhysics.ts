/**
 * BikePhysics — arcade handling with real weight.
 *
 * A rigid body with two raycast wheels. The wheels (Wheel.ts) own the
 * suspension and the tyre model; this file owns the body, the control laws and
 * the state machine. It runs at a FIXED 120 Hz from the engine's accumulator —
 * never at frame rate — so handling cannot change with the frame rate.
 *
 * The four decisions that define how this bike feels:
 *
 *  1. LEAN IS SERVOED, NOT FREE. A 92 kg mass on a 1.08 m wheelbase with a
 *     1.02 m centre of mass is genuinely unstable: simulated honestly it falls
 *     over the instant you stop steering. Real riders stabilise it with a
 *     continuous balance loop, so the bike does too — a critically damped PD
 *     controller drives the roll angle (measured against the CONTACT NORMAL,
 *     not against world up) toward a target set by steering and speed. Because
 *     the reference is the contact normal, the same controller also lays the
 *     bike over onto a berm and stands it up again on the exit for free.
 *
 *  2. THE LEAN IS WHAT TURNS THE BIKE. The steer angle exists and matters at
 *     walking pace, but above ~8 m/s the cornering force comes overwhelmingly
 *     from camber thrust in the tyre model. This is why braking mid-corner
 *     pushes you wide: the friction circle takes the lateral budget away.
 *
 *  3. AIR CONTROL IS AUTHORITY, NOT ATTITUDE. Airborne, input adds angular
 *     acceleration toward a target rate; releasing input does NOT null the
 *     rotation. A flip you started keeps going, which is the only way a
 *     backflip can be a commitment rather than a button.
 *
 *  4. THE PUMP IS A TIMING WINDOW. Crouching stores charge; releasing spends it
 *     as an impulse along the contact normal. If the release lands within
 *     PUMP_WINDOW of the wheels actually leaving the ground — either side of it
 *     — the stored charge is also added to the vertical velocity directly. That
 *     double payoff is deliberate: it is what makes a well-timed lip release
 *     feel categorically different from an early one rather than just slightly
 *     better.
 *
 *  5. THE BIKE IS HELD DOWN, NOT JUST SPRUNG DOWN. A raycast suspension is a
 *     spring, and a spring returns what it absorbs. 92 kg on 90–130 mm of
 *     travel, over ground that deviates 0.4 m from straight inside a 6 m
 *     window, is a pogo stick — measured at 72% airborne on a descent that
 *     should have been the fastest part of the course. A rider is not a spring:
 *     they absorb with their arms and legs and push the wheels back down. So
 *     the suspension force has a real ceiling, a bottom-out is resolved
 *     inelastically, and while the bike is in contact its velocity along the
 *     contact normal may not run away from the ground. See `holdGround`.
 *
 * Body space: +Y up, +Z forward, +X to the LEFT. `position` is the body origin:
 * mid-wheelbase, on the axle line, suspension topped out.
 *
 * SIGNS, because two of them are counter-intuitive and the comments used to be
 * wrong about both:
 *   • `lean`  is positive to the RIGHT, measured against the contact normal.
 *   • `pitch` is `asin(-forward · n)`, which is POSITIVE WHEN THE NOSE IS DOWN.
 *   • a torque about the body's LEFT axis is positive when it puts the NOSE
 *     DOWN (right-handed rotation about +X takes +Z toward -Y).
 */

import { Object3D, Quaternion, Vector3 } from 'three';

import {
  BikeMode,
  type BikeInput,
  type BikeState,
  type SurfaceProperties,
} from '../game/Contracts';
import { BIKE } from '../game/WorldConstants';
import {
  DEFAULT_SURFACE,
  FRONT_TYRE,
  REAR_TYRE,
  Wheel,
  createFallbackTerrain,
  type BikeTerrain,
  type SuspendResult,
} from './Wheel';
import { BIKE_GEOM, FRONT_MOUNT, REAR_MOUNT } from './BikeModel';
import { clamp, clamp01, dampHL, lerp, moveTowards } from '../core/MathX';

// ─────────────────────────────────────────────────────────────────────────────
// Tuning that belongs to the body rather than to a wheel or the world
// ─────────────────────────────────────────────────────────────────────────────

export const BODY_TUNE = {
  /** Diagonal inertia in body space: about X (pitch), Y (yaw), Z (roll). */
  inertiaPitch: 33,
  inertiaYaw: 23,
  inertiaRoll: 16,

  /**
   * Lean controller. omega_n = sqrt(kP); zeta = kD / (2*sqrt(kP)).
   *
   * These gains only mean that once the gravitational tipping moment has been
   * removed — see `cancelTipMoment`. With it left in, the loop's own stiffness
   * (inertiaRoll * leanKp = 2368 N·m/rad) was cancelled almost exactly by
   * m·g·h (92 * 20.4 * 1.287 = 2415 N·m/rad), leaving a NET ROLL STIFFNESS OF
   * ABOUT ZERO. That is why the bike sat at 27° of lean with the stick
   * centred and lay all the way down (measured |lean| of 3.13 rad — inverted)
   * in the switchbacks, the stream bed and the rock garden: roll was a free
   * integrator and the first bump decided which way it went.
   */
  /**
   * Lean servo gains, raised from 168 / 27.
   *
   * Lean is the corner: the steer input asks for a cornering acceleration and
   * `tan(lean) = a / g` is the angle that holds it, so if the servo does not
   * REACH its target the bike does not turn however much authority the tyres
   * have. Measured at the old gains, holding full lock for two seconds from
   * 21 km/h: the demanded lean was around 30 degrees and the achieved lean was
   * TWO. The bike came round 45 degrees in that time, all of it from the bars,
   * with the lean contributing essentially nothing.
   *
   * That is the "controls are very weak" report, and it is not an authority
   * problem — it is a servo that never arrives.
   */
  leanKp: 340,
  leanKd: 41,
  /**
   * How much of the gravitational tipping moment the balance loop takes off the
   * bike. 1 = the rider holds their weight perfectly over the contact line and
   * lean is a pure servo; 0 = the bike falls over. Held slightly under 1 so a
   * hard landing or a berm still has a little weight in it.
   */
  tipCancel: 0.94,
  /** How fast the bars move to the demanded angle, radians per second. */
  steerRate: 8.6,
  /**
   * How firmly the rider holds the bars, N·m per radian.
   *
   * The front tyre's lateral force acts `trail` behind the steering axis, so it
   * torques the wheel toward its own direction of travel — that is the castor
   * that makes a bike track straight, and the only thing resisting it is the
   * rider's arms. So the bars sit where the demand and the self-aligning torque
   * balance, not where the demand alone says.
   *
   * The number matters most in the place the bars were previously inert: a
   * nose-first landing. Measured on `tabletop-air`, the front wheel touched
   * down alone with 3° of slip and 5.6 kN on it, and because all of that grip
   * was 0.54 m AHEAD of the centre of mass the yaw ran away — 0.13 rad/s to
   * 4.8 rad/s over 22 steps, 160° of spin, and 53 → 17 km/h scrubbed off
   * sideways with no steer input at all. A real front wheel cannot hold 3° of
   * slip under 5.6 kN: 210 N·m of aligning torque is far past what anyone's
   * arms hold and the wheel simply castors straight. At this stiffness it does,
   * and the equilibrium slip angle under that load is a fifth of what it was.
   *
   * In a steady corner the same term costs almost nothing, because camber
   * thrust — which is where a leaned bike's cornering force comes from — makes
   * essentially no aligning torque. See Wheel.alignTorque.
   */
  barStiffness: 1250,
  /** Hard limit on how far the castor may push the bars off the demand, rad. */
  barGive: 0.30,
  /** Speed at which lean fully replaces steer as the cornering mechanism. */
  /**
   * Speed at which the turn is fully carried by lean rather than by the bars.
   * Lowered from 9.5: at 34 km/h the rider was still only being granted a
   * fraction of the lean the corner needed, which is most of a technical
   * section spent unable to turn properly.
   */
  leanAuthoritySpeed: 6.2,

  /**
   * Pitch: manual/endo authority and the passive stabiliser toward the slope.
   *
   * The stabiliser's DAMPING is the important number and it used to be far too
   * low. The pitch mode is a 3.6 Hz spring between the two wheels at zeta 0.55,
   * and at 19 m/s the ground feeds it at almost exactly that frequency — the
   * bike porpoised at 4 Hz with the wheels alternating (measured: only 14% of
   * steps had BOTH wheels loaded, against 34% front-only and 32% rear-only).
   * Worse, the inter-wheel damping only acts while both wheels are down, which
   * during a porpoise is exactly when they are not. This term does not care.
   */
  /**
   * Manual and endo are TARGET ANGLES, radians, reached by the stabiliser.
   * 0.50 rad of nose-up is a proper manual and sits just under the 0.42 rad
   * wheelie balance point where the rear contact's own moment would take over
   * and loop the bike; 0.34 rad of nose-down is an endo you can hold.
   */
  manualPitch: 0.50,
  endoPitch: 0.34,
  pitchStabiliserKp: 34,
  pitchStabiliserKd: 16,
  /**
   * What the pitch servo may spend, N·m. Neutral is weak on purpose so the
   * ground still moves the bike around under the rider; asking for a manual or
   * an endo buys real authority. Lifting the front wheel needs more than the
   * 1013 N·m the loaded rear contact pushes back with, which is why the old
   * 470 N·m `manualTorque` could not do it at all.
   */
  pitchNeutralTorque: 1150,
  pitchIntentTorque: 2600,
  /** Yaw damping — kills the residual spin a two-wheeled body accumulates. */
  yawDamp: 1.6,

  /** Airborne. */
  airAuthority: 13.5,
  airIdleDamp: 0.24,
  /** Above this the bike auto-levels toward the slope it is falling onto. */
  airAssistStart: 0.55,
  airAssist: 1.05,
  /**
   * Seconds of airtime over which the ground balance loop fades out. Short
   * flights — a wheel skipping a stone — are not jumps and the rider does not
   * stop balancing for them. See `controlAirborne`.
   */
  skimBalance: 0.30,
  skimAuthority: 0.85,

  /** Preload and pump. */
  pumpChargeTime: 0.42,
  pumpDecayTime: 0.55,
  pumpImpulse: 3.05,      // m/s along the contact normal at full charge
  pumpWindow: 0.16,       // s — the release-to-takeoff window worth learning
  pumpAirBonus: 2.70,     // m/s added on top if the window is hit
  hopImpulse: 3.55,
  /** Nose-up kick on a bunny hop, N·m — a hop is a rear-first lift. */
  hopNoseLift: 300,

  /** Crash. */
  crashMinTime: 1.15,
  crashSettleSpeed: 2.6,
  recoverTime: 0.85,
  /** Lean beyond this while grounded and moving is a low-side. */
  lowSideLean: 1.28,
  /** Deceleration above this in one step is a wall strike, in m/s. */
  wallImpactSpeed: 7.5,

  /**
   * Rolling resistance scale — the surface table supplies the per-surface part.
   *
   * DO NOT lower this to make the bike faster. It was briefly cut to 15 along
   * with the drive and drag changes, on the reasoning that it was part of what
   * made the bike sluggish. It is not: on trail (0.24) it costs 6.2 N against
   * 980 N of drive, which is nothing. What it actually governs is the PENALTY
   * FOR LEAVING THE TRAIL — scree is 0.70 and snow 1.05, so this is the term
   * that makes open mountainside slow.
   *
   * Halving it doubled how far a rider who ran wide travelled before the ground
   * pulled them up, and the AI's excursions went from a maximum of 3.0-3.9 m to
   * 11.8-16.6 m. Measured by A/B with identical AI code, which is the only
   * reason the cause was ever attributed correctly: the symptom looked exactly
   * like a steering bug, and three attempts to fix it as one changed nothing.
   *
   * Drive force, spin-out speed and drag are where speed comes from.
   */
  rollingResistance: 26,

  // ── Ground hold ───────────────────────────────────────────────────────────
  /**
   * Downforce as a multiple of the bike's weight, applied along the contact
   * normal as the suspension runs out of droop. This is the rider pushing the
   * bars and the pedals into the ground over a roller. The old value (0.34,
   * gated on a term that measured body/ground misalignment rather than
   * curvature) could not hold the wheels down over anything: at 19 m/s a 0.2 m
   * roller on a 6 m wavelength needs about 4 g to follow, and gravity alone
   * supplies 1. This does not have to supply all of it — it has to supply
   * enough that the wheel skims instead of launching.
   */
  crestHold: 2.2,
  /** Speed at which crestHold reaches full strength, m/s. */
  crestHoldSpeed: 8,
  /**
   * How fast the bike may separate from the ground while in contact, m/s. The
   * suspension may return this much of a landing on top of it (a coefficient of
   * restitution). Above these, the bike is being thrown by its own springs, and
   * that is the pogo. Deliberately generous enough that the suspension still
   * visibly rebounds.
   */
  holdRelease: 0.62,
  holdRestitution: 0.17,
  /**
   * Seconds after a hop or a pump during which the ground hold is off. Nothing
   * else in the simulation is allowed to launch the bike, so this is exactly
   * "the bike leaves the ground when, and only when, the rider says so, or when
   * the ground falls away from underneath it".
   */
  holdGrace: 0.22,
};

/**
 * Suspension rates, derived rather than guessed.
 *
 * `BIKE.forkStiffness`/`shockStiffness` in WorldConstants are 32 kN/m and
 * 46 kN/m, which on a 92 kg bike is 19% static sag at the front and 26% at the
 * rear, and puts BOTH ends at 4.6 Hz. The scree run's terrain, detrended over a
 * 6 m window, is 0.215 m rms with 0.4 m peaks — at 19 m/s that is a 4.7 Hz
 * input. The suspension was sitting exactly on resonance with the ground it
 * spends the whole race on, with a fifth of its travel already used up before
 * the first bump.
 *
 * These rates give 30% static sag at both ends (so there is travel available in
 * BOTH directions), drop the front to 3.6 Hz, and set the damping explicitly as
 * a ratio rather than as a raw coefficient that has to be re-derived every time
 * a spring rate moves: 0.62 critical in compression (takes the hit), 1.15 in
 * rebound (does not give it back).
 *
 * They belong in WorldConstants next to the numbers they replace; they are here
 * because that file is shared with the AI and the terrain and is not this
 * subsystem's to edit.
 */
/** Static sag as a fraction of travel. Shared by the rates and the ground hug. */
const STATIC_SAG = 0.30;

const SUSPENSION = (() => {
  const g = BIKE.gravity;
  const w = BIKE.mass * g;              // 1877 N total
  const sagFraction = STATIC_SAG;
  // Static split follows the weight distribution the contact geometry produces.
  const frontShare = 0.42;
  const rearShare = 0.58;
  const kF = (w * frontShare) / (BIKE.forkTravel * sagFraction);
  const kR = (w * rearShare) / (BIKE.shockTravel * sagFraction);
  const mF = BIKE.mass * frontShare;
  const mR = BIKE.mass * rearShare;
  const critF = 2 * Math.sqrt(kF * mF);
  const critR = 2 * Math.sqrt(kR * mR);
  const zetaComp = 0.62;
  const reboundRatio = 1.15 / zetaComp;
  return {
    frontStiffness: kF,
    rearStiffness: kR,
    frontDamping: critF * zetaComp,
    rearDamping: critR * zetaComp,
    reboundRatio,
    /**
     * Force ceiling per wheel. 4.6 times the bike's whole weight is enough to
     * arrest an 8 m/s landing inside the travel; anything more than that is
     * a catapult, not a fork.
     */
    maxForce: w * 4.6,
    /** Contact envelope half-length: ~72% of the wheel radius. */
    envelope: BIKE.wheelRadius * 0.72,
  };
})();

// ─────────────────────────────────────────────────────────────────────────────
// Scratch
// ─────────────────────────────────────────────────────────────────────────────
const _f = new Vector3();
const _t = new Vector3();
const _r = new Vector3();
const _n = new Vector3();
const _up = new Vector3();
const _fwd = new Vector3();
const _left = new Vector3();
const _v = new Vector3();
const _v2 = new Vector3();
const _q = new Quaternion();
const _q2 = new Quaternion();
const _omega = new Vector3();
const _suspF = new Vector3();
const _att = new Vector3();
const _susp: SuspendResult = { force: 0, penetration: 0, clearance: 0 };
const _susp2: SuspendResult = { force: 0, penetration: 0, clearance: 0 };

const UP = new Vector3(0, 1, 0);
const FWD = new Vector3(0, 0, 1);

const ZERO_INPUT: BikeInput = {
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

/**
 * Per-step force/torque accounting, for the physics harness.
 *
 * "The speedo does something impossible" is not debuggable from the speedo. The
 * only way to attribute a 1.7 g acceleration on a bicycle is to see every term
 * that touched the velocity that step, including the DISCRETE ones — a landing
 * that projects the velocity into the contact plane and a ground-hold that
 * clips the normal component are not forces and never show up in a force sum.
 *
 * Off by default and write-only: nothing here is ever read back by the
 * simulation, so enabling it cannot change a result. Fixed fields, no
 * allocation, no branching that the physics depends on.
 */
export const BIKE_DIAG = {
  enabled: false,
  n: 0,
  /** Force by source, newtons, world space. */
  gx: 0, gy: 0, gz: 0,           // gravity
  dx: 0, dy: 0, dz: 0,           // aero + surface drag
  hx: 0, hy: 0, hz: 0,           // ground hug
  sx: 0, sy: 0, sz: 0,           // suspension normal force
  fx: 0, fy: 0, fz: 0,           // front tyre
  rx: 0, ry: 0, rz: 0,           // rear tyre
  cx: 0, cy: 0, cz: 0,           // crash / recovery drag
  /** Drive demand actually asked of the rear contact, newtons. */
  drive: 0,
  /** Speed at the top of the step, after integration, and at the very end. */
  speedPre: 0, speedInt: 0, speedFinal: 0,
  /** Discrete, non-force velocity edits, m/s of |v| change. */
  dvPen: 0, dvHold: 0, dvLand: 0, dvCrash: 0, dvImpulse: 0,
  /** Attitude. */
  targetLean: 0, lean: 0, pitch: 0,
  rollServo: 0, tipRoll: 0, tipCancelled: 0, yawDampT: 0, yawRate: 0,
  grounded: 0, airborne: 0, mode: 0,
};

/** Zero the per-step accumulators. Cheap enough to be unconditional. */
function diagReset(): void {
  const d = BIKE_DIAG;
  d.gx = d.gy = d.gz = 0;
  d.dx = d.dy = d.dz = 0;
  d.hx = d.hy = d.hz = 0;
  d.sx = d.sy = d.sz = 0;
  d.fx = d.fy = d.fz = 0;
  d.rx = d.ry = d.rz = 0;
  d.cx = d.cy = d.cz = 0;
  d.drive = 0;
  d.dvPen = d.dvHold = d.dvLand = d.dvCrash = d.dvImpulse = 0;
  d.rollServo = d.tipRoll = d.tipCancelled = d.yawDampT = 0;
}

/**
 * BikeState plus monotonic event counters.
 *
 * `landedThisStep` and `crashedThisStep` are latched for exactly ONE 120 Hz
 * physics step. Every consumer of them — the rider rig, the FX layer, the
 * camera — runs in the RENDER loop, after the accumulator has already eaten one
 * to three physics steps, so all three of them missed every event. Measured:
 * `crashedThisStep` was false on all 30 rendered frames of the `crash` capture
 * and `landedThisStep` false on all 45 frames of `landing`. The rig's crash
 * entry never ran, `crashSeverity` was read as 0, and since every dynamic term
 * in the crash pose is multiplied by severity the whole thing reached the
 * screen as a static blend. Three subsystems had each grown their own edge
 * detector to work around it.
 *
 * These counters are the fix. A consumer keeps its own last-seen value and
 * compares: that is correct for any number of physics steps per rendered frame,
 * it survives two events inside one frame, and there is no question about who
 * clears it, because nobody does. The one-step flags are kept working exactly
 * as they were so nothing that reads them breaks.
 *
 * The payload fields (`landingImpact`, `landingQuality`, `crashDirection`,
 * `crashSeverity`) are only ever written when the matching counter increments,
 * so they stay valid for as long as a late consumer needs them.
 *
 * These belong on BikeState in Contracts.ts. They are declared here because
 * that file is the shared spine and is not this subsystem's to edit — see the
 * note in this task's report.
 */
export interface BikeStateEx extends BikeState {
  /** Increments once per landing. Never resets except on `reset()`. */
  landCount: number;
  /** Increments once per crash entry. Never resets except on `reset()`. */
  crashCount: number;
}

export interface BikePhysicsOptions {
  terrain?: BikeTerrain;
  mass?: number;
  /** Extra grip and stability for the AI, so the pack does not fall over. */
  stabilityBias?: number;
}

export class BikePhysics {
  readonly front: Wheel;
  readonly rear: Wheel;
  readonly state: BikeStateEx;

  /** Where the rider rig, camera and FX read interpolated transforms from. */
  readonly object = new Object3D();

  /**
   * The shared per-step force accounting, reachable from an instance so the
   * physics harness can switch it on without a module import. See BIKE_DIAG.
   */
  readonly diag = BIKE_DIAG;

  terrain: BikeTerrain;
  mass: number;
  private stability: number;

  /** Previous physics transform, for the render-side interpolation. */
  readonly prevPosition = new Vector3();
  readonly prevOrientation = new Quaternion();
  private prevFrontSpin = 0;
  private prevRearSpin = 0;
  private prevFrontCompression = 0;
  private prevRearCompression = 0;

  /** Centre of mass in world space, recomputed every step. */
  readonly com = new Vector3();

  // ── Control state ─────────────────────────────────────────────────────────
  private steerDemand = 0;
  /** How far the castor has pushed the bars off the demand, radians. */
  private barGive = 0;
  private targetLean = 0;
  private crouchPrev = 0;
  /** Seconds since the crouch was released with charge in it; <0 = not armed. */
  private pumpFired = -1e3;
  private pumpFiredCharge = 0;
  /** Seconds since the wheels actually left the ground; <0 = still in contact. */
  private sinceTakeoff = -1;
  private hopPrev = false;
  private crashClock = 0;
  private groundedGrace = 0;
  private lastSpeed = 0;
  private wasGrounded = true;

  /**
   * Contact reference normal, low-pass filtered. Balance is measured against
   * this rather than against the raw blend of the two contact normals, because
   * the raw blend steps discontinuously every time a wheel picks up or puts
   * down — and a step in the REFERENCE of a PD controller with kP = 168 is a
   * torque spike that then throws the wheel it was measuring off the ground.
   */
  private readonly groundRef = new Vector3(0, 1, 0);

  /**
   * Roll moment the suspension normal forces put into the body this step, about
   * the bike's own forward axis. Accumulated in `applyNormalForce` and taken
   * back out in `cancelTipMoment` — see BODY_TUNE.tipCancel.
   */
  private tipRoll = 0;
  /** Same, about the LEFT axis. Cancelled only while the rider asks for pitch. */
  private tipPitch = 0;

  /** Velocity along the contact normal at the START of the step, m/s. */
  private normalVelPre = 0;
  /** Seconds left of the post-hop/post-pump window where ground hold is off. */
  private launchGrace = 0;
  /** Speed ceiling during a crash, m/s. Ratchets down, never up. */
  private crashSpeedCap = 0;

  /** Accumulators, cleared every step. */
  private force = new Vector3();
  private torque = new Vector3();

  constructor(opts: BikePhysicsOptions = {}) {
    this.terrain = opts.terrain ?? createFallbackTerrain();
    this.mass = opts.mass ?? BIKE.mass;
    this.stability = opts.stabilityBias ?? 0;

    this.front = new Wheel({
      mountLocal: FRONT_MOUNT.clone(),
      travel: BIKE.forkTravel,
      stiffness: SUSPENSION.frontStiffness,
      damping: SUSPENSION.frontDamping,
      radius: BIKE.wheelRadius,
      isFront: true,
      tyre: FRONT_TYRE,
      compressionDampScale: 1,
      reboundDampScale: SUSPENSION.reboundRatio,
      maxForce: SUSPENSION.maxForce,
      envelope: SUSPENSION.envelope,
    });

    this.rear = new Wheel({
      mountLocal: REAR_MOUNT.clone(),
      travel: BIKE.shockTravel,
      stiffness: SUSPENSION.rearStiffness,
      damping: SUSPENSION.rearDamping,
      radius: BIKE.wheelRadius,
      isFront: false,
      tyre: REAR_TYRE,
      compressionDampScale: 1,
      reboundDampScale: SUSPENSION.reboundRatio,
      maxForce: SUSPENSION.maxForce,
      envelope: SUSPENSION.envelope,
    });

    this.state = {
      position: new Vector3(),
      velocity: new Vector3(),
      orientation: new Quaternion(),
      angularVelocity: new Vector3(),
      forwardSpeed: 0,
      speed: 0,
      lean: 0,
      steerAngle: 0,
      pitch: 0,
      front: this.front,
      rear: this.rear,
      mode: BikeMode.Grounded,
      modeTime: 0,
      airHeight: 0,
      airTime: 0,
      peakAirHeight: 0,
      preload: 0,
      pumpCharge: 0,
      manualling: false,
      manualAmount: 0,
      boost: 0,
      boosting: false,
      landedThisStep: false,
      landingImpact: 0,
      landingQuality: 1,
      crashedThisStep: false,
      crashDirection: new Vector3(0, 0, 1),
      crashSeverity: 0,
      landCount: 0,
      crashCount: 0,
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // The step
  // ───────────────────────────────────────────────────────────────────────────

  step(inputRaw: BikeInput, dt: number): void {
    const s = this.state;
    const input = s.mode === BikeMode.Crashing || s.mode === BikeMode.Finished ? ZERO_INPUT : inputRaw;

    // Latched-for-one-step flags belong to the consumer of the PREVIOUS step,
    // so they are cleared at the top, not the bottom.
    s.landedThisStep = false;
    s.crashedThisStep = false;

    this.prevPosition.copy(s.position);
    this.prevOrientation.copy(s.orientation);
    this.prevFrontSpin = this.front.spinUnwrapped;
    this.prevRearSpin = this.rear.spinUnwrapped;
    this.prevFrontCompression = this.front.compression;
    this.prevRearCompression = this.rear.compression;

    this.force.set(0, 0, 0);
    this.torque.set(0, 0, 0);
    this.tipRoll = 0;
    this.tipPitch = 0;
    _suspF.set(0, 0, 0);
    this.launchGrace = Math.max(0, this.launchGrace - dt);

    if (BIKE_DIAG.enabled) {
      diagReset();
      BIKE_DIAG.speedPre = s.velocity.length();
    }

    // ── Frames ──────────────────────────────────────────────────────────────
    _up.copy(UP).applyQuaternion(s.orientation);
    _fwd.copy(FWD).applyQuaternion(s.orientation);
    _left.copy(_up).cross(_fwd).normalize();
    this.com.copy(s.position).addScaledVector(_up, BIKE.comHeight);

    s.speed = s.velocity.length();
    s.forwardSpeed = s.velocity.dot(_fwd);

    // ── Controls ────────────────────────────────────────────────────────────
    this.updateSteering(input, dt);
    this.updatePreload(input, dt);
    this.front.steer = s.steerAngle;
    this.rear.steer = 0;

    // ── Suspension ──────────────────────────────────────────────────────────
    this.front.suspend(s.position, s.orientation, this.com, s.velocity, s.angularVelocity, this.terrain, dt, _susp);
    this.rear.suspend(s.position, s.orientation, this.com, s.velocity, s.angularVelocity, this.terrain, dt, _susp2);

    this.applyNormalForce(this.front, _susp);
    this.applyNormalForce(this.rear, _susp2);

    const wasAirborne = s.mode === BikeMode.Airborne;
    const grounded = this.front.grounded || this.rear.grounded;

    // ── The ground reference frame ──────────────────────────────────────────
    // Everything about balance is measured against this, not against world up.
    _n.set(0, 0, 0);
    if (this.front.grounded) _n.addScaledVector(this.front.contactNormal, 0.42);
    if (this.rear.grounded) _n.addScaledVector(this.rear.contactNormal, 0.58);
    if (_n.lengthSq() < 1e-6) {
      // Airborne: aim at the ground we are actually going to land on.
      const h = this.terrain.heightAt(s.position.x, s.position.z);
      this.terrain.normalAt(s.position.x, s.position.z, _n);
      s.airHeight = Math.max(0, s.position.y - h);
    } else {
      s.airHeight = 0;
    }
    _n.normalize();

    // Filter it. In the air the reference is allowed to track the landing slope
    // quickly; on the ground it is deliberately slower than a wheel can pick up
    // and put down, so a single wheel crossing a stone does not move the datum
    // the whole balance loop is measured against.
    dampVec(this.groundRef, _n, grounded ? 0.055 : 0.12, dt).normalize();

    // Signed roll of the body about its own forward axis, relative to the
    // ground normal. Positive is leaning right.
    _v.copy(this.groundRef).cross(_up);
    s.lean = Math.atan2(_v.dot(_fwd), clamp(this.groundRef.dot(_up), -1, 1));

    // Signed pitch relative to the ground plane. POSITIVE IS NOSE DOWN: it is
    // asin of the amount by which the forward axis points INTO the ground.
    s.pitch = Math.asin(clamp(-_fwd.dot(this.groundRef), -1, 1));

    // Closing speed against the ground at the top of the step. The ground-hold
    // pass after integration compares against this to decide how much of an
    // impact the springs are allowed to hand back.
    this.normalVelPre = s.velocity.dot(_n);

    // ── Drive, brakes, tyres ────────────────────────────────────────────────
    this.solveDrive(input, dt);

    // ── Body forces ─────────────────────────────────────────────────────────
    this.force.y -= this.mass * BIKE.gravity;
    if (BIKE_DIAG.enabled) BIKE_DIAG.gy = -this.mass * BIKE.gravity;

    // Aerodynamic drag, plus the surface's own drag term.
    if (s.speed > 0.05) {
      const surfDrag = this.rear.grounded ? this.rear.surface.drag : 0;
      const k = BIKE.dragK + surfDrag * 0.5;
      this.force.addScaledVector(s.velocity, -k * s.speed);
      if (BIKE_DIAG.enabled) {
        BIKE_DIAG.dx = -k * s.speed * s.velocity.x;
        BIKE_DIAG.dy = -k * s.speed * s.velocity.y;
        BIKE_DIAG.dz = -k * s.speed * s.velocity.z;
      }
    }

    // Ground hug. A wheel running out of DROOP is a wheel about to leave the
    // ground: the ground has started falling away faster than the spring can
    // follow it. That is the moment a rider pushes the bars and the pedals
    // down, and this is that push. Gated on droop rather than on any measure of
    // curvature, because droop is the thing that is actually about to run out,
    // and it costs nothing over a flat road where the suspension is sagged.
    if (grounded && this.launchGrace <= 0 && s.mode !== BikeMode.Crashing) {
      // Measured from the STATIC RIDE HEIGHT, not from full compression. A bike
      // sitting on its sag has 70% of its droop left and always will, so gating
      // on raw droop meant a permanent 1.1 g of downforce at any speed — which
      // doubles the bike's weight, kills the manual (the nose would not come up
      // at all) and makes the whole thing feel welded to the floor. This is
      // zero at normal ride height and only arrives as the wheel genuinely runs
      // out of extension, which is the moment it is about to fly.
      const extension = 1 - Math.max(this.front.compression, this.rear.compression);
      const excess = clamp01((extension - (1 - STATIC_SAG)) / STATIC_SAG);
      const fast = clamp01(s.speed / BODY_TUNE.crestHoldSpeed);
      const hug = BODY_TUNE.crestHold * excess * excess * fast;
      if (hug > 0) {
        this.force.addScaledVector(_n, -this.mass * BIKE.gravity * hug);
        if (BIKE_DIAG.enabled) {
          const k = -this.mass * BIKE.gravity * hug;
          BIKE_DIAG.hx = _n.x * k; BIKE_DIAG.hy = _n.y * k; BIKE_DIAG.hz = _n.z * k;
        }
      }
    }

    // ── Attitude control ────────────────────────────────────────────────────
    if (s.mode === BikeMode.Crashing) {
      this.updateCrash(dt);
    } else if (s.mode === BikeMode.Recovering) {
      // A rider picking themselves up does not resume race pace on the frame
      // the tumble ends.
      //
      // `updateCrash` applies a strong horizontal ground friction; Recovering
      // applied NONE and ran the full grounded control laws instead, so the
      // instant the mode flipped the bike got full grip and gravity accelerated
      // it down the hill. Measured on the crash capture: 29.7 km/h bleeding
      // correctly to 0.7 while crashing, then JUMPING to 7.0 km/h one mode
      // change later and reading as a crash that speeds up. That is the
      // "+9 km/h while still lying on their side" the motion review caught.
      //
      // The drag ramps out across the recovery, so the bike is rolling normally
      // by the time control returns rather than being released like a catapult.
      const remain = 1 - clamp01(s.modeTime / Math.max(BODY_TUNE.recoverTime, 1e-3));
      if (this.front.grounded || this.rear.grounded) {
        _v.copy(s.velocity);
        _v.y = 0;
        this.force.addScaledVector(_v, -this.mass * 2.6 * remain);
        if (BIKE_DIAG.enabled) {
          const k = -this.mass * 2.6 * remain;
          BIKE_DIAG.cx = _v.x * k; BIKE_DIAG.cy = _v.y * k; BIKE_DIAG.cz = _v.z * k;
        }
      }
      this.controlGrounded(input, dt, this.groundRef);
    } else if (grounded) {
      this.controlGrounded(input, dt, this.groundRef);
    } else {
      this.controlAirborne(input, dt, this.groundRef);
    }

    // ── Integrate ───────────────────────────────────────────────────────────
    this.integrate(dt);
    if (BIKE_DIAG.enabled) BIKE_DIAG.speedInt = s.velocity.length();

    // ── Ground hold ─────────────────────────────────────────────────────────
    this.holdGround(grounded, _n, dt);
    this.clampCrashSpeed(dt);

    // ── Mode machine ────────────────────────────────────────────────────────
    this.updateMode(grounded, wasAirborne, dt, _n);

    s.speed = s.velocity.length();
    _fwd.copy(FWD).applyQuaternion(s.orientation);
    s.forwardSpeed = s.velocity.dot(_fwd);
    s.modeTime += dt;
    this.lastSpeed = s.speed;
    this.wasGrounded = grounded;

    if (BIKE_DIAG.enabled) {
      const d = BIKE_DIAG;
      d.speedFinal = s.speed;
      d.targetLean = this.targetLean;
      d.lean = s.lean;
      d.pitch = s.pitch;
      d.grounded = grounded ? 1 : 0;
      d.airborne = s.mode === BikeMode.Airborne ? 1 : 0;
      d.n++;
    }
  }

  /**
   * Stop the springs throwing the bike off the ground.
   *
   * A raycast suspension hands back whatever it absorbs. On terrain that
   * deviates further from straight than the fork has travel — which is most of
   * this mountain — that makes a 92 kg pogo stick: land, bottom out, get fired
   * half a metre into the air, fall, land harder. Instrumented over a 180-frame
   * scree run the rear wheel was in contact for 51 frames and the two wheels
   * alternated rather than both being loaded, which starved the tyre model, the
   * drive, the dust and the rider rig all at once.
   *
   * The rule: while the bike is in contact, the velocity along the contact
   * normal may not exceed `holdRelease`, plus a restitution share of whatever
   * it arrived with. That is a coefficient-of-restitution constraint and it is
   * the same thing a rider's arms and legs do.
   *
   * Three things are deliberately NOT affected:
   *   • a lip — the velocity does not change over a lip, the GROUND falls away
   *     from underneath it, and this only ever touches velocity;
   *   • a ramp — on a ramp the velocity stays tangent to the surface, so the
   *     component along the normal stays near zero however steep the kicker;
   *   • a hop or a pump — those set `launchGrace`, and inside that window this
   *     does nothing at all.
   */
  private holdGround(grounded: boolean, n: Vector3, dt: number): void {
    if (!grounded || this.launchGrace > 0) return;
    const s = this.state;
    if (s.mode === BikeMode.Crashing) return;
    const vn = s.velocity.dot(n);
    if (vn <= 0) return;
    // `normalVelPre` in the max is what makes this a limit on what the SPRINGS
    // may add rather than a speed limit on the bike. Anything the bike already
    // had at the top of the step passes through untouched: a pump impulse, a
    // hop, the race director's collision response, and the capture harness's
    // `launch` velocity. Without that term the hold ate all of them on the very
    // step they were applied — a 13 m/s launch came out as 0.62.
    // What the SUSPENSION added to the normal velocity this step. Subtracting
    // it recovers the velocity the bike would have had without the springs, and
    // that is the floor: the hold may take back the springs' contribution and
    // nothing else. Anything the bike already had passes through untouched — a
    // pump impulse, a hop, the race director's collision response, the capture
    // harness's `launch`. Without this the hold ate all of them on the very
    // step they were applied and a 13 m/s launch came out as 0.62.
    const dvSusp = Math.max(0, _suspF.dot(n) * (dt / this.mass));
    const allowed = Math.max(
      vn - dvSusp,
      BODY_TUNE.holdRelease,
      -this.normalVelPre * BODY_TUNE.holdRestitution,
    );
    if (vn > allowed) {
      const pre = BIKE_DIAG.enabled ? s.velocity.length() : 0;
      s.velocity.addScaledVector(n, allowed - vn);
      if (BIKE_DIAG.enabled) BIKE_DIAG.dvHold += s.velocity.length() - pre;
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Controls
  // ───────────────────────────────────────────────────────────────────────────

  private updateSteering(input: BikeInput, dt: number): void {
    const s = this.state;
    const speed = Math.abs(s.forwardSpeed);

    // Above `leanAuthoritySpeed` the turn is carried by lean, below it by the
    // bars. The crossover is what makes slow technical sections feel like
    // steering and fast sections feel like carving.
    const leanAuthority = clamp01(speed / BODY_TUNE.leanAuthoritySpeed);
    const grip = this.rear.grounded ? this.rear.surface.grip : 1;

    // The lean is the angle a rider HOLDS for a given cornering force, and the
    // only honest way to pick it is from the force: tan(lean) = a / g. Setting
    // it straight from the stick instead (`steer * maxLean`) put the bike at 50°
    // of lean while pulling 0.5 g — a rider at that angle and that force would
    // simply be falling over, and it reads as exactly that. Deriving it from
    // what the tyres can actually deliver also makes the SURFACES table legible
    // without any extra code: scree at grip 0.46 tops out at 24° of lean and a
    // much wider line, trail at 1.0 goes to 44° and turns twice as tightly.
    const aMax = BIKE.gravity * REAR_TYRE.muLatScale * grip;
    // Braking stands the bike up — you cannot hold full lean on the brakes.
    const braking = clamp01(input.brakeRear * 0.6 + input.brakeFront);
    const aDemand = input.steer * aMax * leanAuthority * (1 - braking * 0.34);
    this.targetLean = clamp(Math.atan(aDemand / BIKE.gravity), -BIKE.maxLean, BIKE.maxLean);

    // ── The bars ────────────────────────────────────────────────────────────
    // At speed the steer angle is not an input, it is a CONSEQUENCE of the
    // lean: a bike leaned to θ is going round a circle of radius v²/(g·tanθ),
    // and the bars have to be where that circle puts them, which for a 1.08 m
    // wheelbase is atan(wheelbase / r).
    //
    // Scaling `maxSteer` by a speed falloff instead gets this badly wrong, and
    // the error is not small. At 16 m/s the old falloff left 0.165 rad — 9.5°
    // — on the bars, which is Ackermann for a 6.5 m radius, which needs 39 m/s²
    // of lateral acceleration. The tyres can make 20. So half steer at 16 m/s
    // did not corner, it PLOUGHED: measured 9 m/s of lateral slip at both
    // wheels, a 4.8 m radius and 16 → 12.8 m/s of scrub, with the bike sliding
    // the whole way. The kinematic angle for the same lean is 2.3°.
    //
    // Below the crossover the bars go back to being bars, because at walking
    // pace through a switchback that is exactly what a rider uses.
    const v = Math.max(speed, 2.0);
    const kinematic = Math.atan(
      (BIKE.wheelbase * BIKE.gravity * Math.tan(clamp(this.targetLean, -1.4, 1.4))) / (v * v),
    );
    const direct = input.steer * BIKE.maxSteer;
    this.steerDemand = clamp(lerp(direct, kinematic, leanAuthority), -BIKE.maxSteer, BIKE.maxSteer);

    // ── Castor ──────────────────────────────────────────────────────────────
    // The bars are not a position servo. The front tyre's lateral force acts
    // behind the steering axis and pushes the wheel toward its own direction of
    // travel; the rider's arms are a spring against that. So the wheel ends up
    // where the two balance. See BODY_TUNE.barStiffness for the measurement
    // this exists for — a nose-first landing where the front wheel held 3° of
    // slip under 5.6 kN and spun the bike 160°, which no real front wheel does
    // because it would have castored straight in a fraction of the time.
    //
    // `alignTorque` is last step's, which at 120 Hz is 8 ms of lag. That is
    // deliberate: reading it inside the same step would need the tyre solved
    // before the steer it depends on.
    this.barGive = clamp(
      -this.front.alignTorque / BODY_TUNE.barStiffness,
      -BODY_TUNE.barGive,
      BODY_TUNE.barGive,
    );
    const target = clamp(this.steerDemand + this.barGive, -BIKE.maxSteer, BIKE.maxSteer);
    s.steerAngle = moveTowards(s.steerAngle, target, BODY_TUNE.steerRate * dt);
  }

  private updatePreload(input: BikeInput, dt: number): void {
    const s = this.state;
    // Asymmetric: compressing takes ~90 ms, releasing ~35 ms. The release has
    // to be near-instant or the pump timing window is unlearnable.
    const rate = input.crouch > s.preload ? 0.09 : 0.035;
    s.preload = dampHL(s.preload, input.crouch, rate, dt);

    const grounded = this.front.grounded || this.rear.grounded;
    if (input.crouch > 0.55 && grounded) {
      s.pumpCharge = Math.min(1, s.pumpCharge + dt / BODY_TUNE.pumpChargeTime);
    } else if (input.crouch < 0.35) {
      s.pumpCharge = Math.max(0, s.pumpCharge - dt / BODY_TUNE.pumpDecayTime);
    }

    // Release edge: spend the charge as an impulse along the contact normal.
    //
    // The window is armed here and CASHED IN `updateMode`, on the step the
    // wheels actually leave the ground. It used to be cashed on the step the
    // MODE flipped to Airborne, which is 85 ms later (the grounded grace), so a
    // rider releasing at the lip — the correct, natural timing — landed at
    // 85 ms into a 140 ms window and missed it as often as they hit it. The
    // window is now centred on the real event and works from either side of it,
    // which is what makes it learnable: release at the lip, get paid.
    const released = this.crouchPrev > 0.6 && input.crouch < 0.35;
    if (released && s.pumpCharge > 0.12) {
      this.pumpFired = 0;
      this.pumpFiredCharge = s.pumpCharge;
      if (grounded) {
        _n.copy(this.rear.grounded ? this.rear.contactNormal : this.front.contactNormal);
        const pre = BIKE_DIAG.enabled ? s.velocity.length() : 0;
        s.velocity.addScaledVector(_n, BODY_TUNE.pumpImpulse * s.pumpCharge);
        if (BIKE_DIAG.enabled) BIKE_DIAG.dvImpulse += s.velocity.length() - pre;
        this.launchGrace = BODY_TUNE.holdGrace;
      }
      s.pumpCharge = 0;
      // A release that lands within the window of a takeoff that ALREADY
      // happened still counts — the rider was a fraction late off the lip, not
      // wrong. Cash it immediately.
      if (this.sinceTakeoff >= 0 && this.sinceTakeoff <= BODY_TUNE.pumpWindow) {
        this.payPumpBonus();
      }
    } else if (this.pumpFired >= 0) {
      this.pumpFired += dt;
      if (this.pumpFired > BODY_TUNE.pumpWindow) this.pumpFired = -1e3;
    }
    this.crouchPrev = input.crouch;

    // Bunny hop, on the button edge, from a compressed stance.
    if (input.wantHop && !this.hopPrev && grounded) {
      _n.copy(this.rear.grounded ? this.rear.contactNormal : this.front.contactNormal);
      const scale = 0.86 + s.preload * 0.46;
      const pre = BIKE_DIAG.enabled ? s.velocity.length() : 0;
      s.velocity.addScaledVector(_n, BODY_TUNE.hopImpulse * scale);
      if (BIKE_DIAG.enabled) BIKE_DIAG.dvImpulse += s.velocity.length() - pre;
      // A hop is a rear-first lift: nose up slightly so it looks like a hop and
      // not a lift on a string. Negative about LEFT is nose-up.
      _t.copy(_left).multiplyScalar(-BODY_TUNE.hopNoseLift);
      this.torque.add(_t);
      this.launchGrace = BODY_TUNE.holdGrace;
    }
    this.hopPrev = input.wantHop;
  }

  /** Spend an armed pump charge into vertical velocity. Idempotent per charge. */
  private payPumpBonus(): void {
    if (this.pumpFired < 0 || this.pumpFiredCharge <= 0) return;
    const pre = BIKE_DIAG.enabled ? this.state.velocity.length() : 0;
    this.state.velocity.addScaledVector(
      this.groundRef,
      BODY_TUNE.pumpAirBonus * this.pumpFiredCharge,
    );
    if (BIKE_DIAG.enabled) BIKE_DIAG.dvImpulse += this.state.velocity.length() - pre;
    this.pumpFired = -1e3;
    this.pumpFiredCharge = 0;
    this.launchGrace = BODY_TUNE.holdGrace;
  }

  private solveDrive(input: BikeInput, dt: number): void {
    const s = this.state;

    // Pedalling. Force falls to zero at spin-out; you cannot pedal a BMX to
    // 20 m/s on the flat, and the descent is supposed to supply the speed.
    const spinOut = clamp01(1 - Math.abs(s.forwardSpeed) / BIKE.spinOutSpeed);
    let drive = input.pedal * BIKE.pedalForce * spinOut * spinOut;

    // Boost spends the trick meter.
    s.boosting = false;
    if (input.wantBoost && s.boost > 0.02) {
      s.boost = Math.max(0, s.boost - BIKE.boostDrainPerSecond * dt);
      s.boosting = true;
      drive += BIKE.boostForce;
    }

    // Rolling resistance, applied as a brake so the friction circle sees it.
    const rrFront = this.front.grounded
      ? this.front.surface.rollingResistance * BODY_TUNE.rollingResistance
      : 0;
    const rrRear = this.rear.grounded
      ? this.rear.surface.rollingResistance * BODY_TUNE.rollingResistance
      : 0;

    const brakeRear = input.brakeRear * BIKE.brakeForceRear + rrRear;
    const brakeFront = input.brakeFront * BIKE.brakeForceFront + rrFront;

    this.front.solveTyre(
      s.orientation, this.com, s.velocity, s.angularVelocity,
      0, brakeFront, s.lean, this.mass, dt,
    );
    this.rear.solveTyre(
      s.orientation, this.com, s.velocity, s.angularVelocity,
      drive, brakeRear, s.lean, this.mass, dt,
    );

    if (BIKE_DIAG.enabled) BIKE_DIAG.drive = drive;
    this.applyContactForce(this.front);
    this.applyContactForce(this.rear);
  }

  private applyNormalForce(w: Wheel, out: SuspendResult): void {
    if (out.force > 0) {
      _f.copy(w.contactNormal).multiplyScalar(out.force);
      this.force.add(_f);
      _r.copy(w.contactPoint).sub(this.com);
      _t.copy(_r).cross(_f);
      this.torque.add(_t);
      _suspF.add(_f);
      if (BIKE_DIAG.enabled) {
        BIKE_DIAG.sx += _f.x; BIKE_DIAG.sy += _f.y; BIKE_DIAG.sz += _f.z;
      }
      // Book the roll share for cancelTipMoment. Both contact points lie on the
      // bike's own centre plane, so the entire roll component of this moment is
      // load * lever * sin(lean) — pure destabilising gravity, nothing else.
      this.tipRoll += _t.dot(_fwd);
      this.tipPitch += _t.dot(_left);
    }

    // Penetration recovery. The wheel is through the bottom of its travel and
    // the frame is inside the ground. Push out gently — the old code moved the
    // body up to 0.12 m PER WHEEL PER STEP, which at 120 Hz is 14 m/s of
    // teleport — and kill the inward normal velocity, because a chassis hitting
    // the dirt is an inelastic event and must not bounce.
    if (out.penetration > 0.0015) {
      const s = this.state;
      const pre = BIKE_DIAG.enabled ? s.velocity.length() : 0;
      s.position.addScaledVector(w.contactNormal, Math.min(out.penetration * 0.45, 0.035));
      const vn = s.velocity.dot(w.contactNormal);
      if (vn < 0) s.velocity.addScaledVector(w.contactNormal, -vn);
      if (BIKE_DIAG.enabled) BIKE_DIAG.dvPen += s.velocity.length() - pre;
    }
  }

  /**
   * Take the gravitational tipping moment back off the bike.
   *
   * Torques are taken about the centre of mass, so gravity itself contributes
   * nothing — but the suspension's normal force does, because the contact
   * patches sit 1.29 m below a COM that a leaned bike has moved sideways off
   * them. That moment is exactly `load * lever * sin(lean)` about the forward
   * axis, and it grows at m·g·h = 2415 N·m/rad.
   *
   * The balance loop's own stiffness is inertiaRoll * leanKp. At the values
   * this file shipped with that was 2368 N·m/rad — within 2% of the tipping
   * moment it was supposed to be fighting. The NET roll stiffness was
   * approximately zero, so roll was a free integrator: it sat wherever the last
   * bump left it (measured: 0.466 rad with the stick centred) and in anything
   * with a berm or a rock in it, it went all the way over (measured: 3.13 rad,
   * i.e. upside down, in the switchbacks, the stream bed and the rock garden).
   *
   * Cancelling it is not a cheat, it is the model: decision 1 in this file's
   * header says the lean is SERVOED. A servo cannot work against an equal and
   * opposite plant. `tipCancel` is held just under 1 so a landing still has
   * some weight in it.
   *
   * The CORNERING force's roll moment is booked here too, and it has to be.
   * On a real bike those two moments are what balance each other — m·g·h·sinθ
   * against m·a·h·cosθ, which is where tanθ = a/g comes from. Cancelling the
   * first and leaving the second is worse than cancelling neither: the tyre's
   * lateral force, acting 1.29 m below the COM, then rolls the bike OUT of
   * every turn with nothing opposing it. Measured with only the normal force
   * cancelled: quarter steer at 16 m/s produced 0.88 rad/s of yaw to the RIGHT
   * with the bike leaning 0.26 rad to the LEFT, which is a bike falling over
   * mid-corner, not a bike cornering.
   *
   * With both booked, roll is a clean servo and the turn comes from the lean
   * through camber thrust, which is decision 2 in the header.
   */
  private cancelTipMoment(pitchIntent: number): void {
    if (BIKE_DIAG.enabled) {
      BIKE_DIAG.tipRoll = this.tipRoll;
      BIKE_DIAG.tipCancelled = -this.tipRoll * BODY_TUNE.tipCancel;
    }
    if (this.tipRoll !== 0) {
      this.torque.addScaledVector(_fwd, -this.tipRoll * BODY_TUNE.tipCancel);
    }
    // The pitch axis is only unloaded while the rider is ASKING for attitude.
    // Left alone, the contacts' own pitch moment is the fore/aft weight
    // transfer and the pitch spring between the two wheels, which is exactly
    // the thing that should stay: it is what squats the bike under power and
    // dives it under braking. But it is also 1013 N·m of nose-down at rest, and
    // a rider pulling a manual is lifting against precisely that. Cancelling it
    // in proportion to the demand is what turns the manual and the endo from a
    // torque that loses into an attitude the rider chooses.
    if (this.tipPitch !== 0 && pitchIntent > 0.01) {
      this.torque.addScaledVector(_left, -this.tipPitch * pitchIntent * BODY_TUNE.tipCancel);
    }
  }

  private applyContactForce(w: Wheel): void {
    if (!w.grounded || w.tyreForce.lengthSq() < 1e-8) return;
    if (BIKE_DIAG.enabled) {
      if (w === this.front) {
        BIKE_DIAG.fx = w.tyreForce.x; BIKE_DIAG.fy = w.tyreForce.y; BIKE_DIAG.fz = w.tyreForce.z;
      } else {
        BIKE_DIAG.rx = w.tyreForce.x; BIKE_DIAG.ry = w.tyreForce.y; BIKE_DIAG.rz = w.tyreForce.z;
      }
    }
    this.force.add(w.tyreForce);
    _r.copy(w.contactPoint).sub(this.com);
    _t.copy(_r).cross(w.tyreForce);
    this.torque.add(_t);
    // The cornering force's roll moment goes in the same book as the normal
    // force's. See cancelTipMoment: cancelling one without the other leaves the
    // bike leaning OUT of every corner.
    this.tipRoll += _t.dot(_fwd);

    // ── Trail ────────────────────────────────────────────────────────────────
    // The lateral force does not act AT the contact patch, it acts `trail`
    // behind it, and the moment that offset produces about the patch is a pure
    // couple along the contact normal: (-trail·forward) × (fy·left) = -trail·fy·n.
    //
    // This is what makes a bicycle a bicycle rather than a shopping trolley,
    // and it is the term that was missing when the tabletop landing spun the
    // bike 160° with the bars dead straight. On the FRONT wheel it opposes that
    // wheel's own yaw moment, shortening its effective lever from 0.54 m to
    // about 0.44 m — real directional stability, paid for out of turn-in. On
    // the REAR its sign is the same as the rear contact's own moment, so it
    // adds to the stability there instead of taking from it.
    //
    // The same number, read back by `updateSteering`, is what castors the bars.
    if (w.alignTorque !== 0) {
      this.torque.addScaledVector(w.contactNormal, w.alignTorque);
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Attitude
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * The part of the angular velocity that is actually changing the bike's
   * ATTITUDE relative to the ground, with the part that is merely going round
   * the corner removed.
   *
   * A bike leaned 0.34 rad and turning at 6 rad/s about the ground normal is
   * not pitching — it is holding a steady attitude and travelling in a circle.
   * But rotation about the world vertical, resolved onto a LEANED body's own
   * axes, appears as `omega * sin(lean)` about the body's left axis, which
   * looks exactly like a nose-down pitch rate. The pitch damper then fought it:
   * measured, a half-steer corner produced 980 N·m of nose-down torque out of
   * nothing, which drove the front suspension to 0.033 m, unloaded the rear
   * wheel COMPLETELY, and left the bike pirouetting on its front tyre at
   * 8 rad/s with no rear contact to stabilise the yaw. Half steer at 16 m/s
   * ended at 1.4 m/s. That is not a corner, it is a crash with extra steps.
   *
   * Subtracting the component along the contact normal removes the corner and
   * leaves the attitude. A real pitch or roll is perpendicular to the normal
   * and passes through untouched.
   */
  private attitudeRate(n: Vector3): Vector3 {
    const w = this.state.angularVelocity;
    return _att.copy(w).addScaledVector(n, -w.dot(n));
  }

  private controlGrounded(input: BikeInput, dt: number, n: Vector3): void {
    const s = this.state;

    // ── Roll: the balance loop ──────────────────────────────────────────────
    // The plant first: without this the PD below has no net authority at all.
    this.cancelTipMoment(clamp01(Math.abs(input.pitchLean)));
    const rollRate = this.attitudeRate(n).dot(_fwd);
    const leanErr = this.targetLean - s.lean;
    const kp = BODY_TUNE.leanKp * (1 + this.stability * 0.5);
    const kd = BODY_TUNE.leanKd * (1 + this.stability * 0.35);
    const rollTorque = BODY_TUNE.inertiaRoll * (leanErr * kp - rollRate * kd);
    this.torque.addScaledVector(_fwd, clamp(rollTorque, -9000, 9000));
    if (BIKE_DIAG.enabled) BIKE_DIAG.rollServo = clamp(rollTorque, -9000, 9000);

    // ── Pitch: manual, endo, and the stabiliser, as ONE angle servo ─────────
    //
    // These used to be raw torques bolted on next to a stabiliser that switched
    // itself off whenever the rider asked for attitude, and the numbers did not
    // work. Lifting the front wheel means overcoming the rear contact's own
    // nose-down moment, which at rest is 0.54 m × the whole weight = 1013 N·m.
    // `manualTorque` was 470. The front wheel never came off the ground: with
    // pitchLean held at 1 for a second and a half, the measured pitch was
    // -0.012 rad and `manualAmount` was 0.00. The manual, one of the five
    // things the brief names, did not exist. The endo had the opposite problem —
    // no limit at all, so a front brake plus forward lean put the bike 79° over
    // the bars and left it there.
    //
    // So the rider's pitch input is a TARGET ANGLE and the stabiliser is the
    // servo that reaches it. That is what a rider actually does: they pick an
    // attitude and hold it. It cannot loop out, it cannot fail to lift, the
    // stabiliser never switches off (so bumps are damped even mid-manual), and
    // the authority limits below are what keep it honest.
    const back = Math.max(0, input.pitchLean);
    const fwdLean = Math.max(0, -input.pitchLean);

    // A manual needs speed and a loaded rear wheel; you cannot manual a
    // stationary bike, and pretending you can is the tell of a fake one.
    const manualAuth = clamp01((Math.abs(s.forwardSpeed) - 1.6) / 4) * clamp01(this.rear.load / 400);
    const endoAuth = clamp01(this.front.load / 350);

    // pitch > 0 is NOSE DOWN, so a manual target is negative.
    const targetPitch =
      -back * BODY_TUNE.manualPitch * manualAuth + fwdLean * BODY_TUNE.endoPitch * endoAuth;

    const pitchRate = this.attitudeRate(n).dot(_left);
    const stab =
      BODY_TUNE.inertiaPitch *
      ((targetPitch - s.pitch) * BODY_TUNE.pitchStabiliserKp - pitchRate * BODY_TUNE.pitchStabiliserKd);
    // Asking for attitude buys authority; holding neutral is deliberately weak
    // so the ground still pitches the bike around underneath the rider.
    const ceiling = lerp(
      BODY_TUNE.pitchNeutralTorque,
      BODY_TUNE.pitchIntentTorque,
      clamp01(Math.abs(input.pitchLean)),
    );
    this.torque.addScaledVector(_left, clamp(stab, -ceiling, ceiling));

    // Manual readout for the rig and the trick system.
    const frontUp = !this.front.grounded && this.rear.grounded;
    s.manualAmount = dampHL(s.manualAmount, frontUp ? clamp01(0.35 + back * 0.65) : 0, 0.09, dt);
    s.manualling = frontUp && s.manualAmount > 0.35;

    // ── Yaw damping, referenced to the corner the bike is already leaning ───
    //
    // The coefficient is unchanged. What changed is what it is measured
    // AGAINST, and that was the bug: a damper referenced to zero damps the
    // corner itself. A bike leaned at θ and travelling at v is going round a
    // circle of radius v²/(g·tan θ), so its chassis MUST be yawing at
    // g·tan θ / v — that is the same balance equation `updateSteering` picks
    // the lean angle from, read the other way round. Yawing at that rate is not
    // a disturbance and damping it is a tax on every corner.
    //
    // Measured on the flat skidpad at 14 m/s: the damper was pulling 31.6 N·m
    // against a 1.10 rad/s corner, which the tyres had to pay for out of a
    // front/rear force imbalance, and the sideslip that developed to produce
    // that imbalance was NEGATIVE at both wheels — the chassis sitting nose-out
    // of its own path, with the slip-angle force subtracting from the camber
    // thrust instead of adding to it.
    //
    // Referenced this way the damper still does its real job — it kills the
    // residual spin a two-wheeled body accumulates, it catches a wheel that
    // steps out, it holds the bike straight with the stick centred (lean 0
    // gives a reference of 0, exactly the old behaviour) — at exactly the
    // authority it had before, so nothing about a deliberate slide changes.
    // Faded out below walking pace, where `tan(lean)/v` is not a corner radius
    // any more, and off entirely while the rider is picking the bike up.
    // The reference is the lean the RIDER IS ASKING FOR, not the lean the bike
    // happens to be at. Those agree in a corner — the balance loop's whole job
    // is to make them agree — and they must not agree anywhere else. Referenced
    // to the momentary lean, every rock that rolls the bike 15° also commands a
    // turn, and the yaw the bike then acquires rolls it further: measured on
    // `rockgarden-low` with the stick CENTRED, that loop took a clean 13 → 14.8
    // m/s run and put the bike on its roof (|lean| 2.92 rad) and down to
    // 1.2 m/s. A disturbance must never become a steering input.
    const yawRate = s.angularVelocity.dot(n);
    const vTurn = Math.max(Math.abs(s.forwardSpeed), 2.4);
    const turning =
      s.mode === BikeMode.Recovering ? 0 : clamp01((Math.abs(s.forwardSpeed) - 1.6) / 3.5);
    const yawWanted =
      (-turning * BIKE.gravity * Math.tan(clamp(this.targetLean, -1.2, 1.2))) / vTurn;
    const yawT = (yawWanted - yawRate) * BODY_TUNE.yawDamp * BODY_TUNE.inertiaYaw;
    this.torque.addScaledVector(n, yawT);
    if (BIKE_DIAG.enabled) {
      BIKE_DIAG.yawRate = yawRate;
      BIKE_DIAG.yawDampT = yawT;
    }

    // Low-side. Past the lean limit with load on the wheels, the bike is down.
    if (Math.abs(s.lean) > BODY_TUNE.lowSideLean && s.speed > 5.5) {
      this.beginCrash(clamp01((Math.abs(s.lean) - BODY_TUNE.lowSideLean) * 2 + 0.3), _left);
    }

    // Wall strike: a big unexplained deceleration in one step.
    const decel = this.lastSpeed - s.speed;
    if (decel > BODY_TUNE.wallImpactSpeed * dt * 60 && this.lastSpeed > 9) {
      _v.copy(s.velocity).normalize();
      this.beginCrash(clamp01(decel / (BODY_TUNE.wallImpactSpeed * dt * 120)), _v);
    }
  }

  private controlAirborne(input: BikeInput, dt: number, n: Vector3): void {
    const s = this.state;
    s.manualling = false;
    s.manualAmount = dampHL(s.manualAmount, 0, 0.14, dt);

    // ── The skim ────────────────────────────────────────────────────────────
    // At 19 m/s down a rough face the wheels are off the ground for a tenth of
    // a second at a time, constantly, and none of that is jumping. A rider does
    // not stop balancing because the front wheel skipped over a stone — but
    // this function did, and the roll rate the bike carried into each skim came
    // straight back out the other side uncorrected. Integrated over a descent
    // that is where 0.28 rad of standing lean with the stick centred came from.
    //
    // So the balance loop keeps running through a short flight, fading out over
    // `skimBalance` seconds. It is gone long before anything a player would
    // call a jump, and it is gone INSTANTLY if they ask for rotation, so it
    // never fights a deliberate trick.
    const asking = input.airPitch !== 0 || input.airRoll !== 0 || input.airYaw !== 0;
    const skim = asking ? 0 : 1 - clamp01(s.airTime / BODY_TUNE.skimBalance);
    if (skim > 0.001) {
      const rollRate = this.attitudeRate(n).dot(_fwd);
      const rollErr = this.targetLean - s.lean;
      const roll =
        BODY_TUNE.inertiaRoll *
        (rollErr * BODY_TUNE.leanKp - rollRate * BODY_TUNE.leanKd) *
        skim * skim * BODY_TUNE.skimAuthority;
      this.torque.addScaledVector(_fwd, clamp(roll, -4000, 4000));

      const pitchRate = this.attitudeRate(n).dot(_left);
      const pitch =
        BODY_TUNE.inertiaPitch *
        (-s.pitch * BODY_TUNE.pitchStabiliserKp - pitchRate * BODY_TUNE.pitchStabiliserKd) *
        skim * skim * BODY_TUNE.skimAuthority;
      this.torque.addScaledVector(_left, clamp(pitch, -3000, 3000));
    }

    // Authority, not attitude: input adds acceleration toward a target rate and
    // releasing input leaves the rotation alone (bar a whisper of damping), so
    // a flip you committed to keeps going.
    const targetPitch = input.airPitch * BIKE.airPitchRate;
    const targetYaw = input.airYaw * BIKE.airYawRate;
    const targetRoll = input.airRoll * BIKE.airRollRate;

    const curPitch = s.angularVelocity.dot(_left);
    const curYaw = s.angularVelocity.dot(_up);
    const curRoll = s.angularVelocity.dot(_fwd);

    const A = BODY_TUNE.airAuthority;
    const idle = BODY_TUNE.airIdleDamp;

    const dPitch = input.airPitch !== 0 ? (targetPitch - curPitch) * A : -curPitch * idle;
    const dYaw = input.airYaw !== 0 ? (targetYaw - curYaw) * A : -curYaw * idle;
    const dRoll = input.airRoll !== 0 ? (targetRoll - curRoll) * A : -curRoll * idle;

    _omega.copy(_left).multiplyScalar(dPitch * dt);
    _omega.addScaledVector(_up, dYaw * dt);
    _omega.addScaledVector(_fwd, dRoll * dt);
    s.angularVelocity.add(_omega);

    // Landing assist. Late in a fall, with no rotation input, the bike drifts
    // toward matching the slope it is about to hit. This is the difference
    // between a game where every jump ends in a wash-out and one where landing
    // well is a skill you can actually express. It is weak, and it turns off
    // completely the moment the player asks for rotation.
    const noInput = input.airPitch === 0 && input.airRoll === 0;
    const falling = s.velocity.y < -1.5;
    if (noInput && falling && s.airTime > BODY_TUNE.airAssistStart) {
      _v.copy(_up).cross(n);            // axis that rotates up toward n
      const err = Math.acos(clamp(_up.dot(n), -1, 1));
      if (_v.lengthSq() > 1e-8 && err > 0.02) {
        _v.normalize().multiplyScalar(err * BODY_TUNE.airAssist * dt * clamp01(s.airTime));
        s.angularVelocity.add(_v);
      }
    }
  }

  private updateCrash(dt: number): void {
    const s = this.state;
    this.crashClock += dt;

    // Tumble: bleed rotation slowly so it reads as a body with mass rolling to
    // a stop, not as a ragdoll being switched off.
    s.angularVelocity.multiplyScalar(Math.pow(0.62, dt));

    // Ground friction on whatever is touching. A tumbling bike and rider is not
    // aerodynamic either, so there is real drag in the air as well — otherwise
    // the only thing acting on a crash that pops the bike off the ground is
    // GRAVITY, and the speedo climbs all the way through it.
    if (this.front.grounded || this.rear.grounded) {
      _v.copy(s.velocity);
      _v.y = 0;
      this.force.addScaledVector(_v, -this.mass * 3.2);
      if (BIKE_DIAG.enabled) {
        BIKE_DIAG.cx = _v.x * -this.mass * 3.2;
        BIKE_DIAG.cy = _v.y * -this.mass * 3.2;
        BIKE_DIAG.cz = _v.z * -this.mass * 3.2;
      }
    } else {
      this.force.addScaledVector(s.velocity, -this.mass * 0.55);
      if (BIKE_DIAG.enabled) {
        BIKE_DIAG.cx = s.velocity.x * -this.mass * 0.55;
        BIKE_DIAG.cy = s.velocity.y * -this.mass * 0.55;
        BIKE_DIAG.cz = s.velocity.z * -this.mass * 0.55;
      }
    }

    // A crash that accelerates cannot read as an impact — and one that pops the
    // bike into the air WILL accelerate, because free fall adds 20.4 m/s of
    // speed per second and the speedo reads |velocity|. Reviewed footage had
    // the readout going 27 → 38 → 39 km/h THROUGH the crash.
    //
    // So the crash carries an explicit speed ceiling that ratchets down and
    // never up. The physics underneath is unchanged — the tumble is still a
    // real tumble with a real axis and real contacts — but the magnitude of the
    // velocity is not allowed to grow while the rider is on the floor. It is
    // applied in `clampCrashSpeed`, after integration.
  }

  /**
   * The crash speed ceiling. Runs AFTER integration, which matters: applied
   * before it, gravity and the contact forces of the same step are added on top
   * and the ceiling leaks. Ratchets to the current speed and then decays, so
   * |velocity| is monotonically non-increasing for the whole time the rider is
   * on the floor whatever the tumble does.
   */
  private clampCrashSpeed(dt: number): void {
    const s = this.state;
    // The ceiling covers the whole time the rider is DOWN, which is Crashing
    // AND Recovering. Ending it at the mode change left a residual: the tumble
    // decayed correctly to 0.5 km/h, then Recovering ran the full grounded
    // control laws on a 9° slope with only a fading drag against them and the
    // speedo climbed back to 3 km/h — 1 → 7 km/h in the review footage — while
    // the rider was still on the floor. Gravity was doing exactly what gravity
    // does; the problem is that a bike lying on its side is not a bike rolling.
    //
    // Recovering ratchets more gently than the tumble does, so the last thing
    // that happens before control returns is the bike being allowed to roll
    // again rather than being released from a standstill.
    const crashing = s.mode === BikeMode.Crashing;
    if (!crashing && s.mode !== BikeMode.Recovering) return;
    const sp = s.velocity.length();
    this.crashSpeedCap = Math.min(this.crashSpeedCap, sp) * Math.pow(crashing ? 0.55 : 0.92, dt);
    if (sp > this.crashSpeedCap && sp > 1e-4) {
      s.velocity.multiplyScalar(this.crashSpeedCap / sp);
      if (BIKE_DIAG.enabled) BIKE_DIAG.dvCrash += s.velocity.length() - sp;
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Integration
  // ───────────────────────────────────────────────────────────────────────────

  private integrate(dt: number): void {
    const s = this.state;

    // Linear.
    _v.copy(this.force).multiplyScalar(dt / this.mass);
    s.velocity.add(_v);
    s.position.addScaledVector(s.velocity, dt);

    // Angular. The inertia tensor is diagonal in BODY space, so the torque is
    // rotated in, divided, and rotated back. The gyroscopic w x Iw term is
    // dropped: at these rates it contributes less than the integrator's own
    // error and it is a reliable source of instability.
    _q2.copy(s.orientation).invert();
    _v.copy(this.torque).applyQuaternion(_q2);
    _v.x /= BODY_TUNE.inertiaPitch;
    _v.y /= BODY_TUNE.inertiaYaw;
    _v.z /= BODY_TUNE.inertiaRoll;
    _v.applyQuaternion(s.orientation);
    s.angularVelocity.addScaledVector(_v, dt);

    // Hard clamp. Nothing legitimate spins faster than this, and an unclamped
    // angular velocity after a bad contact turns one bad frame into a NaN.
    const w = s.angularVelocity.length();
    if (w > 26) s.angularVelocity.multiplyScalar(26 / w);

    if (w > 1e-6) {
      _v.copy(s.angularVelocity).multiplyScalar(1 / w);
      _q.setFromAxisAngle(_v, w * dt);
      s.orientation.premultiply(_q).normalize();
    }

    // Terminal velocity, so a fall down the ravine cannot outrun the collision.
    const speed = s.velocity.length();
    if (speed > 62) s.velocity.multiplyScalar(62 / speed);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Mode machine
  // ───────────────────────────────────────────────────────────────────────────

  private updateMode(grounded: boolean, wasAirborne: boolean, dt: number, n: Vector3): void {
    const s = this.state;

    // TAKEOFF — the physical event, not the state-machine event. The pump
    // window is measured against this, because this is the thing the rider is
    // actually timing against: the moment the wheels leave the lip.
    if (grounded) {
      this.sinceTakeoff = -1;
    } else {
      if (this.sinceTakeoff < 0 && this.wasGrounded) {
        this.sinceTakeoff = 0;
        if (this.pumpFired >= 0 && this.pumpFired <= BODY_TUNE.pumpWindow) this.payPumpBonus();
      } else if (this.sinceTakeoff >= 0) {
        this.sinceTakeoff += dt;
      }
    }

    // A one-wheel-off bump is not a jump. Both wheels have to be clear for a
    // short grace period before the bike is airborne, or the state flickers
    // through every rock garden and every FX system flickers with it.
    if (grounded) this.groundedGrace = 0.085;
    else this.groundedGrace = Math.max(0, this.groundedGrace - dt);

    const airborne = !grounded && this.groundedGrace <= 0;

    switch (s.mode) {
      case BikeMode.Grounded: {
        s.airTime = 0;
        s.peakAirHeight = 0;
        if (airborne) this.setMode(BikeMode.Airborne);
        break;
      }

      case BikeMode.Airborne: {
        s.airTime += dt;
        s.peakAirHeight = Math.max(s.peakAirHeight, s.airHeight);
        if (grounded) this.resolveLanding(n);
        break;
      }

      case BikeMode.Crashing: {
        const slow = s.speed < BODY_TUNE.crashSettleSpeed;
        if (this.crashClock > BODY_TUNE.crashMinTime && slow && grounded) {
          this.setMode(BikeMode.Recovering);
        }
        break;
      }

      case BikeMode.Recovering: {
        // Stand the bike back up over `recoverTime`, aligned to the slope and
        // pointing down the fall line it was travelling on.
        const k = clamp01(dt / Math.max(BODY_TUNE.recoverTime - s.modeTime, dt));
        _fwd.copy(FWD).applyQuaternion(s.orientation);
        _v.copy(_fwd).addScaledVector(n, -_fwd.dot(n));
        if (_v.lengthSq() < 1e-6) _v.set(0, 0, 1);
        _v.normalize();
        buildOrientation(_v, n, _q);
        s.orientation.slerp(_q, k).normalize();
        s.angularVelocity.multiplyScalar(Math.pow(0.05, dt));
        if (s.modeTime >= BODY_TUNE.recoverTime) this.setMode(BikeMode.Grounded);
        break;
      }

      case BikeMode.Finished:
      default:
        break;
    }
  }

  private resolveLanding(n: Vector3): void {
    const s = this.state;
    const preSpeed = BIKE_DIAG.enabled ? s.velocity.length() : 0;
    _up.copy(UP).applyQuaternion(s.orientation);

    // Quality is the angle between the bike's up and the slope's normal. Nail
    // the slope and it is 1; land flat on a steep landing and it collapses.
    const align = clamp(_up.dot(n), -1, 1);
    const mismatch = Math.acos(align);
    s.landingQuality = clamp01(1 - mismatch / BIKE.landingAngleTolerance);

    const closing = Math.max(0, -s.velocity.dot(n));
    s.landingImpact = clamp01(closing / BIKE.landingSpeedTolerance);
    s.landedThisStep = true;
    s.landCount++;

    // A bad landing scrubs speed; a good one keeps almost all of it. This is the
    // entire reward for learning to match the slope, and getting the shape of it
    // right is most of what "landing angle matching" means as a mechanic.
    //
    // Two gates before the mismatch penalty is charged at all:
    //
    //  BITE — how hard the touchdown actually was. A 0.2 m skim over a roller
    //  costs almost nothing however crooked it was, because nothing happened.
    //
    //  CONSEQUENCE — how big the flight was. On this mountain the wheels leave
    //  the ground constantly at 19 m/s; those are not jumps and must not be
    //  scored as jumps.
    //
    // And the curve itself is now flat near the top. It used to be
    // `lerp(0.42, 0.985, q²)`, which charges 17% of the bike's speed for a FIVE
    // DEGREE angle mismatch — a landing a rider would call clean. Combined with
    // one micro-landing every third of a second that is where the descent's
    // speed was going: measured 6 landings in 4 s on the scree run, each one
    // taking 1.9 m/s, on a slope that should have been adding speed.
    const bite = clamp01(s.landingImpact / 0.55) * clamp01(s.peakAirHeight / 0.50);
    const miss = 1 - s.landingQuality;
    const keep = lerp(1.0, 1 - Math.pow(miss, 1.7) * 0.70, bite);
    _v.copy(s.velocity).addScaledVector(n, -s.velocity.dot(n)); // in-plane part
    const along = _v.length();
    _v.multiplyScalar(along > 1e-5 ? (along * keep) / along : 0);
    s.velocity.copy(_v);
    if (BIKE_DIAG.enabled) BIKE_DIAG.dvLand += s.velocity.length() - preSpeed;

    // Kill the rotation the air gave us; the suspension takes the rest. Scaled
    // by the same consequence gate — a skim must not stop the balance loop dead.
    s.angularVelocity.multiplyScalar(lerp(0.86, 0.22, clamp01(s.peakAirHeight / 0.50)));

    // Crashing out of a landing has to be reserved for landings that are
    // genuinely wrong. `tooCrooked` in particular used to fire on a 30° mismatch
    // at any impact over 0.3, which on this course meant every single big air in
    // the review set resolved as a crash and there was no clean landing anywhere
    // to judge absorption against. A 30° miss off a real jump is ugly and should
    // cost most of the speed — it is not automatically a crash.
    // ...and a landing you can crash out of has to have been a real flight.
    // Otherwise a 40 mm skip across a steep bank — where the ground normal
    // swings 40° in a couple of metres and "quality" collapses through no fault
    // of the rider's — puts the bike on the floor. Measured in the stream bed:
    // a 0.04 m hop resolved as a crash and took the run from 11.6 m/s to a
    // dead stop. A genuine impact into a wall is a different mechanism, and it
    // is still caught by the deceleration check in `controlGrounded`.
    const real = s.peakAirHeight > 0.25 || s.landingImpact > 0.62;
    const tooHard = s.landingImpact > 0.94;
    const tooCrooked = s.landingQuality < 0.05 && s.landingImpact > 0.42;
    const inverted = _up.dot(n) < -0.1; // landed on the bars or the seat
    if (real && (tooHard || tooCrooked || inverted)) {
      _v.copy(s.velocity).normalize();
      this.beginCrash(clamp01(Math.max(s.landingImpact, 1 - s.landingQuality)), _v);
    } else {
      this.setMode(BikeMode.Grounded);
    }
    s.airTime = 0;
  }

  private beginCrash(severity: number, direction: Vector3): void {
    const s = this.state;
    if (s.mode === BikeMode.Crashing || s.mode === BikeMode.Finished) return;
    this.setMode(BikeMode.Crashing);
    this.crashClock = 0;
    s.crashedThisStep = true;
    s.crashCount++;
    s.crashSeverity = clamp01(0.25 + severity * 0.75);
    s.crashDirection.copy(direction).normalize();
    if (s.crashDirection.lengthSq() < 0.5) s.crashDirection.set(0, 0, 1);

    // Give the tumble a real axis: the crash direction crossed with up, scaled
    // by severity. Deterministic, so a replay and a ghost agree.
    _v.copy(s.crashDirection).cross(UP).normalize();
    if (_v.lengthSq() < 0.5) _v.set(1, 0, 0);
    s.angularVelocity.addScaledVector(_v, 4.2 + s.crashSeverity * 6.5);
    s.angularVelocity.addScaledVector(UP, (s.crashDirection.x - s.crashDirection.z) * 2.4);
    s.velocity.multiplyScalar(lerp(0.86, 0.44, s.crashSeverity));
    // A scuff off the ground, not a launch. The old pop (up to 3.6 m/s) put the
    // bike ballistic for the best part of a second, which is where the crash
    // found the room to gain speed.
    s.velocity.y += 0.7 + s.crashSeverity * 0.9;

    // The ceiling the tumble decays from. Set AFTER the impact scale, so the
    // impact itself is the last time the speed ever goes up.
    this.crashSpeedCap = s.velocity.length();

    s.pumpCharge = 0;
    s.preload = 0;
    s.manualling = false;
    this.launchGrace = 0;
  }

  private setMode(m: BikeMode): void {
    if (this.state.mode === m) return;
    this.state.mode = m;
    this.state.modeTime = 0;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // External control
  // ───────────────────────────────────────────────────────────────────────────

  reset(position: Vector3, forward: Vector3): void {
    const s = this.state;
    this.terrain.normalAt(position.x, position.z, _n);
    if (_n.lengthSq() < 1e-6) _n.set(0, 1, 0);
    _n.normalize();

    _v.copy(forward).addScaledVector(_n, -forward.dot(_n));
    if (_v.lengthSq() < 1e-6) _v.set(0, 0, 1);
    _v.normalize();
    buildOrientation(_v, _n, s.orientation);

    s.position.copy(position);
    s.velocity.set(0, 0, 0);
    s.angularVelocity.set(0, 0, 0);
    s.forwardSpeed = 0;
    s.speed = 0;
    s.lean = 0;
    s.steerAngle = 0;
    s.pitch = 0;
    s.airTime = 0;
    s.airHeight = 0;
    s.peakAirHeight = 0;
    s.preload = 0;
    s.pumpCharge = 0;
    s.manualling = false;
    s.manualAmount = 0;
    s.boosting = false;
    s.landedThisStep = false;
    s.landingImpact = 0;
    s.landingQuality = 1;
    s.crashedThisStep = false;
    s.crashSeverity = 0;
    this.setMode(BikeMode.Grounded);
    this.steerDemand = 0;
    this.barGive = 0;
    this.targetLean = 0;
    this.crouchPrev = 0;
    this.pumpFired = -1e3;
    this.pumpFiredCharge = 0;
    this.sinceTakeoff = -1;
    this.hopPrev = false;
    this.crashClock = 0;
    this.groundedGrace = 0.1;
    this.lastSpeed = 0;
    this.wasGrounded = true;
    this.groundRef.copy(_n);
    this.tipRoll = 0;
    this.normalVelPre = 0;
    this.launchGrace = 0;
    this.crashSpeedCap = 0;

    this.front.reset();
    this.rear.reset();
    this.prevPosition.copy(position);
    this.prevOrientation.copy(s.orientation);
    this.prevFrontSpin = 0;
    this.prevRearSpin = 0;
    this.prevFrontCompression = 0;
    this.prevRearCompression = 0;
    this.com.copy(position).addScaledVector(_n, BIKE.comHeight);
  }

  /** Add boost meter, 0..1. Called by the trick system on a banked trick. */
  addBoost(amount: number): void {
    this.state.boost = clamp01(this.state.boost + amount);
  }

  /** Force the finished state — no input, but the bike keeps rolling out. */
  finish(): void {
    this.setMode(BikeMode.Finished);
  }

  /**
   * Put the bike down deliberately. The capture harness needs a crash it can
   * shoot on a known frame, and waiting for one to happen naturally makes the
   * review set non-deterministic — which defeats the point of a fixed-dt
   * harness. Also used by the race director for scripted AI mistakes.
   */
  forceCrash(severity = 0.7, direction?: Vector3): void {
    if (direction) {
      _v2.copy(direction);
    } else {
      _v2.copy(this.state.velocity);
      if (_v2.lengthSq() < 1e-4) _v2.set(0, 0, 1);
    }
    this.beginCrash(severity, _v2);
  }

  // ── Interpolation accessors, for the render side ──────────────────────────

  interpolatedPosition(alpha: number, out: Vector3): Vector3 {
    return out.copy(this.prevPosition).lerp(this.state.position, alpha);
  }

  interpolatedOrientation(alpha: number, out: Quaternion): Quaternion {
    return out.copy(this.prevOrientation).slerp(this.state.orientation, alpha);
  }

  interpolatedFrontSpin(alpha: number): number {
    return lerp(this.prevFrontSpin, this.front.spinUnwrapped, alpha);
  }

  interpolatedRearSpin(alpha: number): number {
    return lerp(this.prevRearSpin, this.rear.spinUnwrapped, alpha);
  }

  interpolatedFrontCompression(alpha: number): number {
    return lerp(this.prevFrontCompression, this.front.compression, alpha);
  }

  interpolatedRearCompression(alpha: number): number {
    return lerp(this.prevRearCompression, this.rear.compression, alpha);
  }

  /** The surface currently under the bike, for FX and audio. */
  get surface(): SurfaceProperties {
    if (this.rear.grounded) return this.rear.surface;
    if (this.front.grounded) return this.front.surface;
    return DEFAULT_SURFACE;
  }
}

/**
 * Frame-rate-independent exponential filter on a direction. `halfLife` is the
 * time to close half the gap; the result is NOT renormalised here (callers do
 * it) so this stays allocation-free and usable on any Vector3.
 */
function dampVec(cur: Vector3, target: Vector3, halfLife: number, dt: number): Vector3 {
  const k = 1 - Math.pow(2, -dt / Math.max(halfLife, 1e-5));
  cur.x += (target.x - cur.x) * k;
  cur.y += (target.y - cur.y) * k;
  cur.z += (target.z - cur.z) * k;
  return cur;
}

/**
 * Build an orientation from a forward direction and an up direction, without
 * the Object3D.lookAt round trip (which allocates and flips handedness).
 * Bike space is +Z forward, +Y up, +X left.
 */
export function buildOrientation(forward: Vector3, up: Vector3, out: Quaternion): Quaternion {
  _v2.copy(forward).normalize();
  _v.copy(up).addScaledVector(_v2, -up.dot(_v2));
  if (_v.lengthSq() < 1e-8) _v.set(0, 1, 0).addScaledVector(_v2, -_v2.y);
  _v.normalize();
  // left = up x forward
  const lx = _v.y * _v2.z - _v.z * _v2.y;
  const ly = _v.z * _v2.x - _v.x * _v2.z;
  const lz = _v.x * _v2.y - _v.y * _v2.x;
  // Column-major 3x3 as [left, up, forward] -> quaternion.
  return quatFromBasis(lx, ly, lz, _v.x, _v.y, _v.z, _v2.x, _v2.y, _v2.z, out);
}

function quatFromBasis(
  m00: number, m10: number, m20: number,
  m01: number, m11: number, m21: number,
  m02: number, m12: number, m22: number,
  out: Quaternion,
): Quaternion {
  const trace = m00 + m11 + m22;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    out.set((m21 - m12) * s, (m02 - m20) * s, (m10 - m01) * s, 0.25 / s);
  } else if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    out.set(0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s);
  } else if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
    out.set((m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s);
  } else {
    const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
    out.set((m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s);
  }
  return out.normalize();
}

/** Re-export so the wheel geometry constants travel with the physics. */
export { BIKE_GEOM };
