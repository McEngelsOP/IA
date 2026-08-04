/**
 * FX — the facade.
 *
 * createEffects() wires the five subsystems into one object that implements
 * IEffects, and then does the thing that actually matters for integration:
 * it DERIVES almost everything from BikeState on its own.
 *
 * Hand it the player's BikeState once per frame and it will emit wheel dust at
 * the right rate for the surface and the slip, throw gravel out of a skid,
 * splash the stream, detect the landing from the mode transition (not just the
 * single-physics-step flag, which a 120Hz sim can raise and clear between two
 * rendered frames), fire the dust burst, decide whether the landing earned an
 * impact hold, drive the speed lines, and smear the rider. The Game never has
 * to know what a puff is.
 *
 * Manual control is still there — every IEffects method does exactly what it
 * says — but the automatic path is the intended one, because the alternative
 * is a hundred lines of emission policy living in Game.ts where nobody will
 * ever tune it.
 *
 * TIME SCALE. Two systems can slow or stop the clock: the camera's big-air
 * hold and the impact freeze. The facade publishes the minimum of the two as
 * `timeScale`, and beginFrame() exists so the Game can read it BEFORE it scales
 * this frame's dt rather than a frame late — which matters enormously for a
 * one-frame freeze and not at all for a 300ms slow-mo.
 */

import {
  Object3D,
  PerspectiveCamera,
  Scene,
  Vector3,
  type Camera,
} from 'three';

import {
  BikeMode,
  SurfaceKind,
  type BikeState,
  type IEffects,
  type ITerrain,
  type SurfaceProperties,
  type WheelState,
} from '../game/Contracts';

/**
 * BikeState plus the two monotonic event counters BikePhysics publishes.
 *
 * They live on BikePhysics.BikeStateEx rather than on Contracts.BikeState (that
 * file is the shared spine and is not this subsystem's to edit — see the
 * report), and this module cannot import from `../bike` without creating a
 * dependency the architecture does not want. So the shape is restated here as
 * an OPTIONAL widening: everything still works against a plain BikeState, and
 * where the counters exist they are used in preference to the latched flags.
 *
 * WHY THEY MATTER HERE. `landedThisStep` / `crashedThisStep` are true for
 * exactly one 120 Hz physics step. A rendered frame consumes two of those, so
 * a flag raised and cleared inside one frame is invisible; and the mode-edge
 * fallback below cannot see a crash that begins and resolves between two
 * frames at all. A counter compared against a remembered value is correct for
 * any number of steps per frame, survives two events in one frame, and needs
 * nobody to clear it.
 */
type EventCounters = { landCount?: number; crashCount?: number };
import { clamp01 } from '../core/MathX';
import { Rng } from '../core/RNG';
import { BIKE, SURFACES } from '../game/WorldConstants';
import { HUD_PALETTE } from '../npr/Palette';

import { CameraDirector, CAMERA_TUNING, type CameraDirectorOptions } from './CameraDirector';
import { DustSystem } from './DustSystem';
import { DebrisSystem } from './Debris';
import { SpeedFX, SpinSmear } from './SpeedFX';
import { ImpactFrames, IMPACT_TUNING } from './ImpactFrames';

export { CameraDirector, CAMERA_TUNING } from './CameraDirector';
export { DustSystem, dustTintFor, puffAtlas, QuadParticlePool } from './DustSystem';
export { DebrisSystem, chipAtlas } from './Debris';
export { SpeedFX, SpinSmear, SPEED_TUNING } from './SpeedFX';
export { ImpactFrames, IMPACT_TUNING } from './ImpactFrames';
export type { CameraDirectorOptions } from './CameraDirector';

const _fallbackPos = new Vector3();
const _fallbackNrm = new Vector3(0, 1, 0);
/** Scratch for the one-off smear-rig scene scan. */
const _scanPos = new Vector3();
/** Bike wheels spin about their pivot's local X. */
const _WHEEL_AXIS = new Vector3(1, 0, 0);

/**
 * Used when the physics has not filled in a contact yet (first frame, or a
 * crash in mid-air). Dirt is the least surprising default and the numbers come
 * straight from WorldConstants.
 */
const DEFAULT_SURFACE: SurfaceProperties = {
  kind: SurfaceKind.Dirt,
  ...SURFACES.dirt,
  audioTone: 'hardpack',
};

/** Boost ignition flash colour, resolved once. */
const BOOST_FLASH_HEX = HUD_PALETTE.boost.getHex();

export interface EffectsDeps {
  /** The FX object is added to this scene by createEffects. */
  scene: Scene;
  /** The camera the CameraDirector will drive — pass the Engine's. */
  camera: PerspectiveCamera;
  terrain?: ITerrain | null;
  seed?: number | string;
  dustCapacity?: number;
  debrisCapacity?: number;
  /** Bike local forward axis, only used as a heading fallback. Default +Z. */
  forwardAxis?: Vector3;
  /**
   * Derive dust, debris and impact frames from the subject BikeState.
   * Off means every emission is a manual call.
   */
  autoEmit?: boolean;
  /** Extra options forwarded to the CameraDirector. */
  cameraOptions?: Partial<Omit<CameraDirectorOptions, 'camera' | 'terrain'>>;
}

export class Effects implements IEffects {
  readonly object: Object3D;
  readonly dust: DustSystem;
  readonly debris: DebrisSystem;
  readonly speed: SpeedFX;
  readonly impact: ImpactFrames;
  readonly cameraDirector: CameraDirector;

  private rng: Rng;
  private subject: BikeState | null = null;
  private autoEmit: boolean;
  private terrain: ITerrain | null;

  // Independent edge detection. The CameraDirector runs its own copy for its
  // own shake; keeping them separate means neither depends on the other's
  // update order, and each fires its own effects exactly once.
  private prevAirborne = false;
  private prevCrashing = false;
  private prevBoosting = false;
  private landCooldown = 0;
  private crashCooldown = 0;
  /** Last seen values of the BikeStateEx event counters. -1 = not primed. */
  private seenLandCount = -1;
  private seenCrashCount = -1;

  // ── Crash ground strikes ──────────────────────────────────────────────────
  // A crash is not an instant, it is a process: the bike goes down, tumbles,
  // and hits the ground two or three more times on the way to a stop. The old
  // code punctuated only the ENTRY, so in the review capture — where the entry
  // happens during the harness's settle frames — the whole visible crash had
  // no dust and no accent anywhere in it. These track the slide so each strike
  // gets its own.
  private prevSpeed = 0;
  private prevContact = false;
  private crashStrikeCooldown = 0;

  private impactSteppedThisFrame = false;

  // ── Self-wiring smear ──────────────────────────────────────────────────────
  // The scene is kept solely so the facade can find the subject's own meshes.
  // See resolveSmearRig().
  private scene: Scene;
  private smearWired = false;
  private smearAttempts = 0;
  private frontSpin: SpinSmear | null = null;
  private rearSpin: SpinSmear | null = null;
  private smearTargets: Object3D[] = [];

  constructor(deps: EffectsDeps) {
    this.rng = new Rng(deps.seed ?? 'fx');
    this.autoEmit = deps.autoEmit ?? true;
    this.terrain = deps.terrain ?? null;
    this.scene = deps.scene;

    this.object = new Object3D();
    this.object.name = 'fx';
    this.object.matrixAutoUpdate = false;

    // 2600, not 1100. A scree plume plus a landing spray plus a skid can be
    // ~900 live puffs once the marks are small enough to have to overlap, and
    // the ring recycles its OLDEST live instance when it wraps — so a capacity
    // that merely "usually" fits shows up as puffs vanishing mid-life at exactly
    // the busiest moment, and the oldest puff is the far end of the trail, so
    // what wrapping deletes is precisely the tail the effect exists to draw.
    // Headroom here is a 180 kB float buffer and one draw call either way.
    this.dust = new DustSystem({
      capacity: deps.dustCapacity ?? 2600,
      rng: this.rng.fork('dust'),
    });
    this.debris = new DebrisSystem({
      capacity: deps.debrisCapacity ?? 640,
      rng: this.rng.fork('debris'),
      terrain: this.terrain,
    });
    this.speed = new SpeedFX();
    this.impact = new ImpactFrames();

    this.cameraDirector = new CameraDirector({
      camera: deps.camera,
      terrain: this.terrain,
      forwardAxis: deps.forwardAxis,
      rng: this.rng.fork('camera'),
      ...(deps.cameraOptions ?? {}),
    });

    this.object.add(this.dust.object);
    this.object.add(this.debris.object);
    this.object.add(this.speed.object);
    deps.scene.add(this.object);
  }

  // ── Wiring ────────────────────────────────────────────────────────────────

  /** The BikeState everything automatic is derived from. Null outside a race. */
  setSubject(state: BikeState | null): void {
    this.subject = state;
    // A new subject invalidates whatever rig we resolved for the old one.
    this.smearWired = false;
    this.smearAttempts = 0;
    this.primeCounters(state);
    if (state) {
      this.prevAirborne = state.mode === 'airborne';
      this.prevCrashing = state.mode === 'crashing';
      this.prevSpeed = state.speed;
    }
  }

  /**
   * Take the event counters' CURRENT values as the baseline.
   *
   * The timing here is the whole point and it is easy to get backwards. If the
   * baseline is adopted lazily, on the first update() that sees the subject,
   * then any event that happens between the reset and that first frame is
   * swallowed — and that is exactly the order Game.applySituation runs in: it
   * calls effects.reset(), then prerolls the physics, then forces the crash,
   * and only then does a frame render. Adopting late means the one pose in the
   * review set named `crash` is the one pose whose crash is never announced.
   * Adopting HERE, at the reset, makes the baseline mean "everything before
   * this moment is history" and everything after it an event.
   */
  private primeCounters(state: BikeState | null): void {
    const ev = state as (BikeState & EventCounters) | null;
    this.seenLandCount = typeof ev?.landCount === 'number' ? ev.landCount : -1;
    this.seenCrashCount = typeof ev?.crashCount === 'number' ? ev.crashCount : -1;
  }

  /**
   * Find the subject's own meshes and wire the smear systems to them.
   *
   * This exists because there is a genuine hole in the contracts: BikeState is
   * pure data — position, velocity, wheel states — and carries no Object3D at
   * all, while `setSmearTargets` and `addSpinSmear` need scene nodes. Nothing
   * in the codebase bridged that gap, so SpeedFX's two geometry-smear systems
   * were fully implemented, fully tested by their own shaders, and called by
   * absolutely nobody. Wheels were razor-crisp at 78 km/h with a 26" wheel
   * turning 40 degrees per rendered frame.
   *
   * Rather than require the Game to reach into two subsystems and hand us
   * their internals, we resolve it here from the scene the facade was already
   * given. Bikes name their wheel pivots `frontWheel` / `rearWheel` and their
   * roots `bike:<id>`; rigs name their roots `rider:<id>`. We take the bike
   * root NEAREST the subject's own position, which needs no id convention at
   * all and is correct even with five racers on the grid.
   *
   * Retried for a few frames and then given up on: the rig is built during
   * load and a missed frame is invisible, but an unbounded retry would walk
   * the whole scene graph every frame forever if a name ever changed.
   */
  private resolveSmearRig(state: BikeState): void {
    this.smearWired = true;
    this.smearAttempts++;

    let best: Object3D | null = null;
    let bestD = Infinity;
    this.scene.traverse((o) => {
      if (!o.name.startsWith('bike:') || o.name.endsWith(':hull')) return;
      o.getWorldPosition(_scanPos);
      const d = _scanPos.distanceToSquared(state.position);
      if (d < bestD) {
        bestD = d;
        best = o;
      }
    });

    const bikeRoot = best as Object3D | null;
    // Nothing found yet (still loading) — allow a handful of retries.
    if (!bikeRoot || bestD > 400) {
      if (this.smearAttempts < 240) this.smearWired = false;
      return;
    }

    const id = bikeRoot.name.slice('bike:'.length);
    const riderRoot = this.scene.getObjectByName(`rider:${id}`) ?? null;

    // Geometry smear: the rider first (limbs are what streak in a trick), the
    // bike second. SpeedFX clones at most `maxMeshesPerTarget` meshes each and
    // only draws them while the smear is actually active.
    const targets: Object3D[] = [];
    if (riderRoot) targets.push(riderRoot);
    targets.push(bikeRoot);
    // Drop any clones built for a previous subject before adopting the new
    // list — SpeedFX caps simultaneous targets, so stale entries would
    // eventually starve the real ones.
    for (const old of this.smearTargets) {
      if (!targets.includes(old)) this.speed.release(old);
    }
    this.smearTargets = targets;
    this.setSmearTargets(targets);

    // Wheel spin smear. The wheel pivots spin about their own local X — that
    // is the axis BikeVisual writes `rotation.x` on — and the radius is the
    // committed tyre radius, so the annulus lands exactly on the tyre.
    // Re-ANCHOR an existing handle rather than adding a second one. setSubject
    // can legitimately be called again (restart, or switching to a replay
    // rider) and a fresh addSpinSmear each time would leak a draw call per
    // call and leave the old annulus welded to the previous bike's wheel.
    const front = bikeRoot.getObjectByName('frontWheel');
    const rear = bikeRoot.getObjectByName('rearWheel');
    if (front) {
      if (this.frontSpin) this.frontSpin.setAnchor(front);
      else this.frontSpin = this.addSpinSmear(front, BIKE.wheelRadius, _WHEEL_AXIS);
    }
    if (rear) {
      if (this.rearSpin) this.rearSpin.setAnchor(rear);
      else this.rearSpin = this.addSpinSmear(rear, BIKE.wheelRadius, _WHEEL_AXIS);
    }
  }

  setTerrain(t: ITerrain | null): void {
    this.terrain = t;
    this.debris.setTerrain(t);
    this.cameraDirector.setTerrain(t);
  }

  /** Objects that automatically smear at speed / during trick rotation. */
  setSmearTargets(objects: Object3D[]): void {
    this.speed.setAutoSmearTargets(objects);
  }

  /** Register a wheel for radial spin smear. See SpeedFX.addSpinSmear. */
  addSpinSmear(anchor: Object3D, radius: number, axis: Vector3): SpinSmear {
    return this.speed.addSpinSmear(anchor, radius, axis);
  }

  // ── Time ──────────────────────────────────────────────────────────────────

  /** Minimum of the camera's slow-mo and the impact freeze. */
  get timeScale(): number {
    return Math.min(this.cameraDirector.timeScale, this.impact.timeScale);
  }

  /**
   * Advance the impact-frame state machine and return the SCALED dt for THIS
   * frame — `realDt * timeScale`, in SECONDS. Call first, with the real
   * (unscaled) frame delta; feed the result to everything visual.
   *
   * IT RETURNS A DELTA, NOT A SCALE, and that distinction was the single most
   * destructive bug in the project. It used to return `timeScale` — a bare
   * multiplier, 1.0 in the overwhelmingly common case — while its only caller
   * (Game.render) took the result and used it as the frame delta for the rider
   * rigs, the camera, the terrain streamer, the HUD, the audio and every
   * particle system. So the entire visual half of the game advanced by ONE
   * SECOND per rendered frame.
   *
   * Dust was where it showed first and worst. A puff is emitted stamped with
   * the current FX clock; the same frame, DustSystem.update advanced that clock
   * by a full second; the vertex shader computed age = 1.0 / life >= 1 and
   * collapsed every instance to a degenerate clip position. Particles were
   * emitted, pooled and killed without ever surviving to a single draw — which
   * is exactly the measured signature: trail() called, pool filled, nothing on
   * screen, ever.
   *
   * Optional — if you never call it, update() advances the impact machine
   * itself and the freeze simply lands one frame later.
   */
  beginFrame(realDt: number): number {
    this.impact.update(realDt);
    this.impactSteppedThisFrame = true;
    return realDt * this.timeScale;
  }

  // ── Frame ─────────────────────────────────────────────────────────────────

  /**
   * `dt` is the SCALED delta. `realDt` defaults to it; pass the unscaled delta
   * (or use beginFrame) so a freeze can end.
   */
  update(dt: number, _time: number, camera: Camera, realDt?: number): void {
    const rd = realDt ?? dt;
    if (!this.impactSteppedThisFrame) this.impact.update(rd);
    this.impactSteppedThisFrame = false;

    const cam = (camera as PerspectiveCamera).isPerspectiveCamera
      ? (camera as PerspectiveCamera)
      : this.cameraDirector.camera;

    // BEFORE ANY EMISSION. Dust culls emissions against the camera position it
    // was last told about, and on the frame the subject teleports that
    // position is still hundreds of metres away — so every burst fired on a
    // respawn or a capture cut was silently thrown away. See
    // DustSystem.syncCamera.
    this.dust.syncCamera(cam);

    const s = this.subject;

    // Tell the dust what the shot is framed on, EVERY FRAME.
    //
    // DustSystem has a lens-corridor rule built for exactly one job: fade a
    // puff that comes between the camera and the rider and covers him. It keys
    // off `uSubject`, whose w component is the legible radius, and whose own
    // documentation says "radius 0 disables the rule entirely".
    //
    // `setShotSubject` WAS NEVER CALLED. Not from here, not from the camera,
    // not from the game — the whole corridor was dead code and the radius sat
    // at 0 for every frame this project has ever rendered. The result is the
    // defect a player reported three times and I misdiagnosed three times: at
    // speed the wheel plume is trail-coloured, opaque, and directly between the
    // lens and the bike, so it reads as GROUND. The bike looks half-buried in
    // the track. It is not: with the dust material silenced the wheels, cranks
    // and legs are all there, the physics contact patch never penetrated the
    // ground (max 0.000 m over a full run), and the drawn axle sits at 0.271 m
    // against a 0.267 m wheel radius.
    //
    // Two full sessions went into terrain, ribbon, carve and camera geometry
    // looking for a surface that was never there. The elimination that found it
    // was silencing one material at a time.
    //
    // The radius covers rider and bike as one object: the pivot is the chest,
    // roughly 0.95 m over the bike origin, and the bike extends about the same
    // again below and ahead of it.
    if (s) this.dust.setShotSubject(s.position.x, s.position.y + 0.55, s.position.z, 1.45);
    else this.dust.clearShotSubject();

    if (s && this.autoEmit) {
      if (!this.smearWired) this.resolveSmearRig(s);
      this.driveSpinSmear(s);
      this.detectEvents(s, rd);
      if (dt > 0) this.emitFromState(s, dt);
    }

    this.dust.update(dt, cam);
    this.debris.update(dt, cam);
    this.speed.update(dt, cam, s);
  }

  // ── Automatic emission ────────────────────────────────────────────────────

  /**
   * Push this frame's wheel speeds into the spin smears.
   *
   * BikeState already carries `spinRate` per wheel in rad/s, so nothing has to
   * be differenced or guessed — and it is the PHYSICAL rate, which is what the
   * effect must key off. At 78 km/h a 0.33 m wheel turns 65 rad/s: 62 degrees
   * per rendered frame, far past the point where a spoke pattern can be
   * sampled without strobing, which is exactly the regime the annulus is for.
   */
  private driveSpinSmear(s: BikeState): void {
    if (this.frontSpin) this.frontSpin.setSpin(s.front?.spinRate ?? 0);
    if (this.rearSpin) this.rearSpin.setSpin(s.rear?.spinRate ?? 0);
  }

  private detectEvents(s: BikeState, dt: number): void {
    if (this.landCooldown > 0) this.landCooldown -= dt;
    if (this.crashCooldown > 0) this.crashCooldown -= dt;
    if (this.crashStrikeCooldown > 0) this.crashStrikeCooldown -= dt;

    const airborneNow = s.mode === BikeMode.Airborne;
    const crashingNow = s.mode === BikeMode.Crashing;

    // ── Counters first, flags as the fallback ─────────────────────────────────
    const ev = s as BikeState & EventCounters;
    let landed: boolean;
    let crashed: boolean;
    if (typeof ev.landCount === 'number' && typeof ev.crashCount === 'number') {
      if (this.seenLandCount < 0) {
        // Never primed (no reset, no setSubject). Adopt rather than replay: the
        // counters are monotonic across a whole race and a fresh consumer must
        // not fire an effect for every landing that already happened.
        this.seenLandCount = ev.landCount;
        this.seenCrashCount = ev.crashCount;
      }
      landed = ev.landCount > this.seenLandCount;
      crashed = ev.crashCount > this.seenCrashCount;
      this.seenLandCount = ev.landCount;
      this.seenCrashCount = ev.crashCount;
    } else {
      landed = s.landedThisStep || (this.prevAirborne && !airborneNow && !crashingNow);
      crashed = s.crashedThisStep || (!this.prevCrashing && crashingNow);
    }

    if (landed && !crashingNow && this.landCooldown <= 0) {
      this.landCooldown = 0.08;
      this.notifyLanding(s);
    }

    if (crashed && this.crashCooldown <= 0) {
      this.crashCooldown = 0.40;
      this.notifyCrash(s);
    }

    // ── The rest of the crash ─────────────────────────────────────────────────
    // Everything above fires once, on the frame the bike goes down. What the
    // audience actually watches is the second and a half AFTER that, and until
    // now none of it was drawn: the review capture of `crash` measured zero
    // live puffs across the entire window in which the speedo falls from 19 to
    // 9 km/h, and its only flash belonged to a rival colliding with the downed
    // player 900 ms later. A body sliding across a rock garden throws material
    // continuously and bangs down two or three times on the way to a stop.
    if (crashingNow) this.crashStrikes(s, dt);
    this.prevSpeed = s.speed;

    // Boost ignition gets a flash but never a freeze — it happens far too
    // often to spend a hold on, and a hold would fight the acceleration.
    if (s.boosting && !this.prevBoosting) this.impact.flashOnly(0.32, BOOST_FLASH_HEX);
    this.prevBoosting = s.boosting;

    this.prevAirborne = airborneNow;
    this.prevCrashing = crashingNow;
  }

  /**
   * Dust and punctuation for the body of a crash.
   *
   * Two signals, both derived from state that already exists:
   *
   *  • A STRIKE is a wheel or the frame arriving back on the ground — either a
   *    contact rising edge, or a single-frame loss of speed too large to be
   *    friction. Measured on `crash`, the hard one is at f0027-f0028 where the
   *    speedo drops 15.6 to 8.9 km/h in 16 ms; that is the frame the eye reads
   *    as the hit, and it is squarely inside the f0005-f0030 window the critic
   *    identified and the old code left empty.
   *
   *  • A SLIDE throws a continuous trail while the wreck is anywhere near the
   *    ground, whether or not the physics calls a wheel grounded — during a
   *    tumble it usually does not, and "no wheel is technically in contact" is
   *    not a reason for a bike scraping along at 20 km/h to be dustless.
   */
  private crashStrikes(s: BikeState, dt: number): void {
    const w = s.rear?.grounded ? s.rear : s.front;
    const surf = w?.surface ?? DEFAULT_SURFACE;
    const nrm = w?.contactNormal ?? _fallbackNrm;
    const pos = this.contactOrFallback(w, s);

    const contact = !!(s.rear?.grounded || s.front?.grounded);
    const drop = this.prevSpeed - s.speed;
    // 6 m/s² of friction over a 60 Hz frame is 0.1 m/s. Anything four times
    // that in one frame is the ground arriving, not the ground rubbing.
    const hardHit = drop > 0.42 && s.speed > 0.8;
    const struck = (contact && !this.prevContact) || hardHit;
    this.prevContact = contact;

    if (struck && this.crashStrikeCooldown <= 0) {
      this.crashStrikeCooldown = 0.12;
      const force = clamp01(0.30 + drop * 0.9 + s.speed * 0.035);
      // CRASH DUST IGNORES A STINGY SURFACE. `crash` is staged in the rock
      // garden, dustAmount 0.18, which turned a 16-puff impact into three.
      // 0.85 rather than 0.62: the hit is the one moment in the whole sequence
      // the audience is looking at, and at the new mark size 0.62 buys sixteen
      // puffs where the read needs about twenty-five.
      this.dust.burst(pos, nrm, s.velocity, 0.55 + force * 0.45, surf, 0.85);
      this.debris.screeSpray(pos, nrm, s.velocity, force * 0.7, surf);
      // Flash only — the freeze belongs to the crash's own entry, and stopping
      // the world three times inside one tumble is a stutter, not punctuation.
      // Two frames for a real bang, one for a scuff: the same 33 ms punch a
      // motion review measured as correct, landing on the frame the body
      // actually arrives rather than on the frame the solver changed mode.
      if (force > 0.34) this.impact.flashOnly(0.30 + force * 0.55, undefined, force > 0.55 ? 2 : 1);
    }

    // The slide. Gated on height above the ground rather than on `grounded`.
    if (s.airHeight < 1.4 && s.speed > 1.2) {
      this.dust.trail(pos, nrm, s.velocity, 40 + s.speed * 9, dt, surf, 0.70);
    }
  }

  private emitFromState(s: BikeState, dt: number): void {
    // The rear wheel does most of the visible work — it carries the drive, it
    // locks first under braking, and it is the one the camera is looking at.
    this.emitWheel(s.rear, s, dt, 1.0);
    this.emitWheel(s.front, s, dt, 0.58);

    // ── THE SKIM ──────────────────────────────────────────────────────────────
    //
    // `grounded` is a solver predicate, not a photograph. Down anything rough
    // the bike spends a large fraction of its frames with both wheels a few
    // centimetres clear — the DustSystem's own header already notes the trail
    // was being cut to a third for exactly this reason — and a tyre 60 mm off
    // scree at 20 m/s is still dragging a wake through loose material. Gating
    // the whole effect on a boolean that chatters at 120 Hz is what makes the
    // tail read as intermittent.
    //
    // It is also the entire reason `scree-speed` f0000 is a rider at 70 km/h
    // with ZERO dust anywhere in frame: the capture teleports the bike, the
    // suspension has not settled, neither wheel reports contact on the shutter
    // frame, and the first still of the sequence therefore has no effect in it
    // at all.
    //
    // So: below a wheel radius of clearance, at a speed worth drawing, emit a
    // reduced trail from the ground under the bike. Nothing new is remembered —
    // the height and the terrain are both already in hand — so there is no
    // state here for Game.applySituation's effects.reset() to have to wipe.
    const airborneSkim = !(s.rear?.grounded || s.front?.grounded);
    if (airborneSkim && s.airHeight < 0.30 && s.speed > 5 && s.mode !== BikeMode.Crashing) {
      const w = s.rear ?? s.front;
      const surf = w?.surface ?? DEFAULT_SURFACE;
      const nrm = w?.contactNormal ?? _fallbackNrm;
      const pos = this.contactOrFallback(undefined, s);
      const near = clamp01(1 - s.airHeight / 0.30);
      this.dust.trail(pos, nrm, s.velocity, clamp01((s.speed - 4) / 14) * 95 * near, dt, surf);
    }
  }

  private emitWheel(w: WheelState, s: BikeState, dt: number, weight: number): void {
    if (!w || !w.grounded) return;
    const surf = w.surface ?? DEFAULT_SURFACE;
    const pos = w.contactPoint ?? s.position;
    const nrm = w.contactNormal ?? _fallbackNrm;

    const slip = Math.abs(w.lateralSlip ?? 0);
    const ratio = w.slipRatio ?? 0;
    const lock = clamp01(-ratio);
    const spinUp = clamp01(ratio);
    // Load normalised against roughly a single wheel's share of static weight,
    // so a wheel that has gone light through a compression stops throwing dust.
    const load01 = clamp01((w.load ?? 0) / (BIKE.mass * BIKE.gravity * 0.75));

    // Rolling contribution.
    //
    // SIZING THIS PROPERLY IS THE WHOLE EFFECT, and the old numbers were out by
    // most of an order of magnitude. The formula topped out around 10 puffs a
    // second; the course is ridden on the groomed ribbon whose dustAmount is
    // 0.55, so ~6 reached the emitter; the bike is airborne roughly two frames
    // in three down anything rough, so ~2/s actually landed; at a ~0.9 s life
    // that is TWO live puffs behind the rider. No amount of shader work makes
    // two puffs into a dust tail.
    //
    // What a tail has to be, geometrically: at 19 m/s a 0.9 s puff is 17 m
    // behind the wheel by the time it dies, so a continuous ribbon of ~0.5 m
    // puffs needs 35-60 of them alive at once. That, not a feeling, is where
    // the base rate comes from — and it is why the cap below exists, because
    // the same formula under a full lock-up would otherwise ask for 400/s and
    // bury the rider in his own dust.
    // ── PUFFS PER METRE, NOT PER SECOND ───────────────────────────────────────
    //
    // The rolling term used to saturate: clamp01((speed - 3) / 13) is flat from
    // 16 m/s upward. Emission is then a constant number of marks per SECOND
    // while the wheel that lays them down covers ever more ground per second, so
    // the spacing between consecutive puffs grows in direct proportion to speed
    // and the trail gets THINNER the faster you go. Measured on scree-speed at
    // 83 km/h: 172 live puffs strung over 34 m, five per metre of marks 0.3 m
    // across — a dotted line. The same emitter at 17 km/h piles the same marks
    // 0.05 m apart and reads as a wall. One number cannot be right for both
    // because the wrong quantity is being held constant.
    //
    // Linear density is what the eye actually reads, so that is what is
    // authored: puffs per metre of travel, converted to a rate by multiplying
    // by speed. 9.0 is chosen against the ribbon the course is really ridden on
    // (dustAmount 0.55) and the two wheels' weights (1.0 + 0.58), and lands
    // about 7 marks per metre at every speed — spacing 0.14 m against puffs
    // 0.22-0.99 m across, which is the overlap that makes separate contours one
    // silhouette. The fade-in below 2.5 m/s keeps a bike at walking pace clean.
    //
    // AND THE NUMBER IS SET BY WHAT THE CHASE CAMERA CAN SEE, NOT BY THE LENGTH
    // OF THE TRAIL. The boom sits ~4.8 m behind the bike looking forward, so of
    // a plume streaming 33 m the frame contains only the first four metres of
    // it — everything older is behind the lens. countAlive() said 213 and the
    // still contained about a dozen marks, and both are right: 213 puffs over
    // 33 m is 6.4 per metre, and 6.4 per metre across the 4 m strip the camera
    // can actually see is nineteen. A density authored against the whole trail
    // is authored against a length nobody is looking down. 18 puts ~11 marks on
    // every metre of the visible strip, which at 0.09 m spacing and 0.33-0.51 m
    // marks is continuous rather than dotted.
    const perMetre = 18.0 * clamp01((s.speed - 2.5) / 6.5);
    const roll = perMetre * s.speed;
    const skid = clamp01(slip / 5.5) + lock * 0.75 + spinUp * 0.5;
    const isWater = surf.kind === SurfaceKind.Water;
    // Water carries its read in droplets, not in airborne particulate, so the
    // dust channel is cut right back there and the splash below does the work.
    // Left at full rate, water's 1.8 dustAmount made it the single dustiest
    // surface on the mountain, which is the opposite of true.
    //
    // The base was 88, and on the surface the course is actually ridden on —
    // the groomed ribbon, dustAmount 0.55 — that resolves to 68 puffs/s across
    // both wheels. At the ribbon's ~1.2 s skid life that is 62 live puffs,
    // which is what countAlive() measures on `scree-speed`, and 62 marks spread
    // over the 27 m a 1.2 s puff falls behind at 23 m/s is three per metre of a
    // trail that is supposed to read as continuous. 130 puts it at ~100, which
    // is where the overlapping contours start being one shape.
    //
    // The rolling term is now already a rate (see perMetre above); the skid term
    // is still authored per second, because a locked wheel throws material at a
    // rate set by how hard it is being dragged rather than by how far it has
    // travelled. The cap is what stops a full lock-up asking for 900/s and
    // burying the rider in his own dust.
    //
    // The water factor moves with the base. 0.20 was set against a base that
    // resolved to ~45 effective puffs/s through water's 1.8 dustAmount; the
    // per-metre rate resolves to ~99, and a wheel through the stream bed
    // throwing twice as much airborne particulate is the "dust cloud rising off
    // a river" this factor exists to prevent. 0.09 holds the absolute quantity
    // where it was measured to be right and leaves the read to DebrisSystem's
    // actual droplets.
    const rate = Math.min((roll + skid * 240) * weight * (0.35 + load01 * 0.9), 460 * weight)
      * (isWater ? 0.09 : 1);
    if (rate > 0.5) this.dust.trail(pos, nrm, s.velocity, rate, dt, surf);

    if (isWater) {
      if (s.speed > 2.5 && this.rng.next() < clamp01(dt * (4 + s.speed * 0.7))) {
        this.debris.splash(pos, nrm, s.velocity, clamp01(0.25 + s.speed / 22) * weight);
      }
    } else if (skid > 0.30 && surf.dustAmount > 0.45) {
      // Gravel is gated stochastically rather than accumulated, so it stays
      // correct in expectation without needing per-wheel carry state.
      if (this.rng.next() < clamp01(skid * dt * 7)) {
        this.debris.screeSpray(pos, nrm, s.velocity, clamp01(skid * 0.55) * weight, surf);
      }
    }
  }

  /** Public so a caller with exact physics-step timing can drive it instead. */
  notifyLanding(s: BikeState): void {
    const impact = clamp01(s.landingImpact);
    const w = s.rear?.grounded ? s.rear : s.front;
    const surf = w?.surface ?? DEFAULT_SURFACE;
    const pos = this.contactOrFallback(w, s);
    const nrm = w?.contactNormal ?? _fallbackNrm;

    // Landings always throw dust, even a soft one — the dust is the read that
    // the wheels touched. Only the SIZE tracks the impact. The 0.45 floor
    // means a landing on rock still throws something: the surface decides how
    // MUCH material is loose, not whether a 90 kg impact disturbs any.
    this.dust.burst(pos, nrm, s.velocity, Math.max(impact, 0.58), surf, 0.45);
    if (impact > 0.12) this.debris.screeSpray(pos, nrm, s.velocity, impact * 0.85, surf);
    if (surf.kind === SurfaceKind.Water) {
      this.debris.splash(pos, nrm, s.velocity, 0.45 + impact * 0.55);
    }
    this.impact.trigger(impact);
  }

  notifyCrash(s: BikeState): void {
    const sev = clamp01(s.crashSeverity || 0.6);
    const w = s.rear?.grounded ? s.rear : s.front;
    const surf = w?.surface ?? DEFAULT_SURFACE;
    const pos = this.contactOrFallback(w, s);
    const nrm = w?.contactNormal ?? _fallbackNrm;

    this.dust.burst(pos, nrm, s.velocity, 0.85 + sev * 0.15, surf, 0.70);
    this.debris.crashDebris(pos, s.velocity, s.crashDirection, sev, surf);
    this.impact.trigger(0.45 + sev * 0.55, undefined, true);
    // Arm the strike tracker so the first frame of the tumble does not read as
    // a fresh contact and fire a second burst on top of this one.
    this.prevContact = !!(s.rear?.grounded || s.front?.grounded);
    this.prevSpeed = s.speed;
    this.crashStrikeCooldown = 0.16;
  }

  private contactOrFallback(w: WheelState | undefined, s: BikeState): Vector3 {
    const p = w?.contactPoint;
    if (p && Number.isFinite(p.x) && (p.lengthSq() > 1e-6 || s.position.lengthSq() < 1e-6)) return p;
    _fallbackPos.copy(s.position);
    if (this.terrain) _fallbackPos.y = this.terrain.heightAt(s.position.x, s.position.z);
    return _fallbackPos;
  }

  // ── IEffects ──────────────────────────────────────────────────────────────

  dustBurst(
    position: Vector3,
    normal: Vector3,
    velocity: Vector3,
    amount: number,
    surface: SurfaceProperties,
  ): void {
    this.dust.burst(position, normal, velocity, amount, surface ?? DEFAULT_SURFACE);
  }

  /**
   * Continuous dust. `rate` is puffs per second before the surface multiplier.
   *
   * The contract has no dt, so this uses a fixed nominal step of one 60Hz
   * frame. If you are calling it from the 120Hz physics step, halve the rate
   * or use `dust.trail(..., dt, ...)` directly — that overload takes a real dt.
   */
  dustTrail(
    position: Vector3,
    normal: Vector3,
    velocity: Vector3,
    rate: number,
    surface: SurfaceProperties,
  ): void {
    this.dust.trail(position, normal, velocity, rate, 1 / 60, surface ?? DEFAULT_SURFACE);
  }

  impactFrame(intensity: number, tint?: number): void {
    this.impact.trigger(intensity, tint);
  }

  smear(target: Object3D, amount: number): void {
    this.speed.smear(target, amount);
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  /**
   * Clear every live particle and post dial. Use on race restart, and on every
   * capture pose — `Game.applySituation` calls this before each of the sixteen.
   *
   * DUST IS NOW IN HERE. It was not, and the only thing covering it was
   * CameraDirector.resetTo() calling clearAllDust() on the side. That works
   * today and it is the wrong place for it to live: a caller that resets the
   * effects without resetting the camera got a rider wearing the dust he kicked
   * up before he was teleported.
   */
  reset(): void {
    this.dust.clear();
    this.debris.clear();
    this.speed.reset();
    this.impact.reset();
    this.landCooldown = 0;
    this.crashCooldown = 0;
    this.crashStrikeCooldown = 0;
    this.prevAirborne = false;
    this.prevCrashing = false;
    this.prevBoosting = false;
    this.prevContact = false;
    this.prevSpeed = this.subject?.speed ?? 0;
    this.primeCounters(this.subject);
  }

  dispose(): void {
    this.dust.dispose();
    this.debris.dispose();
    this.speed.dispose();
    this.cameraDirector.dispose();
    this.object.removeFromParent();
  }
}

export function createEffects(deps: EffectsDeps): Effects {
  return new Effects(deps);
}

/** Build only the camera, for a Game that does not want the particle systems. */
export function createCameraDirector(opts: CameraDirectorOptions): CameraDirector {
  return new CameraDirector(opts);
}
