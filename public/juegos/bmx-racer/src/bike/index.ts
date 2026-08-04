/**
 * Bike — physics plus visual, behind the IBike contract.
 *
 * BikePhysics owns the simulation and runs at a fixed 120 Hz. BikeVisual owns
 * the scene graph and runs once per rendered frame on INTERPOLATED state. This
 * file is the seam between them, and it is deliberately thin: the only logic
 * here is the translation from physical state to the things that move which the
 * physics does not itself simulate — the cranks, the chain, and the two trick
 * rotations about the steerer.
 *
 * Interpolation matters more than it looks. Physics at 120 Hz rendered at 60 Hz
 * without interpolation shows a 2:1 beat on the wheel spin that reads as a
 * strobe on a spoked wheel, which is exactly the artefact that makes browser
 * games look like browser games.
 */

import { Color, Object3D, Quaternion, Vector3 } from 'three';

import {
  BikeMode,
  TrickKind,
  type BikeAnchors,
  type BikeInput,
  type BikeState,
  type IBike,
  type TrickState,
} from '../game/Contracts';
import { BikePhysics, BODY_TUNE, buildOrientation, type BikePhysicsOptions, type BikeStateEx } from './BikePhysics';
import { BikeVisual, crankRate, type BikeVisualState } from './BikeVisual';
import { BIKE_GEOM as G } from './BikeModel';
import { BIKE } from '../game/WorldConstants';
import type { BikeTerrain } from './Wheel';
import { clamp01, dampHL, lerp } from '../core/MathX';
import { ease } from '../core/MathX';

export { BikePhysics, BODY_TUNE, buildOrientation } from './BikePhysics';
export type { BikeStateEx } from './BikePhysics';
export { BikeVisual, crankRate } from './BikeVisual';
export type { BikeVisualState, BikeVisualOptions } from './BikeVisual';
export { Wheel, SURFACE_TABLE, createFallbackTerrain, slipCurve } from './Wheel';
export type { BikeTerrain, WheelConfig, TyreConfig } from './Wheel';
export { BIKE_GEOM, getBikeGeometries } from './BikeModel';
export { TrickSystem, TRICK_TUNE } from './TrickSystem';

const _pos = new Vector3();
const _quat = new Quaternion();
const _camPos = new Vector3();
const _tmp = new Vector3();

export interface BikeOptions extends BikePhysicsOptions {
  frameColor: Color | number;
  name?: string;
  detail?: 'full' | 'reduced';
  /** Parent to attach to. If omitted the caller adopts `bike.object`. */
  parent?: Object3D;
}

export class Bike implements IBike {
  readonly physics: BikePhysics;
  readonly visual: BikeVisual;
  readonly object: Object3D;
  readonly anchors: BikeAnchors;

  /**
   * The trick state driving the whip and the bar twist. Linked by the race
   * layer to whichever system is authoritative for this racer; null until then,
   * in which case the bike simply never whips.
   */
  private trick: TrickState | null = null;

  /** Which way the last pose trick went, so a whip does not flip direction. */
  private trickSide = 1;

  private vis: BikeVisualState = {
    steerAngle: 0,
    frontCompression: 0,
    rearCompression: 0,
    frontSpin: 0,
    rearSpin: 0,
    crankAngle: 0,
    whipAngle: 0,
    barTwist: 0,
    chainOffset: 0,
  };

  private crankOmega = 0;
  /** Set by reset(); snaps the cranks to the geared rate on the next frame. */
  private crankNeedsSeed = false;
  private cameraRef: Object3D | null = null;

  constructor(opts: BikeOptions) {
    this.physics = new BikePhysics(opts);
    this.visual = new BikeVisual({
      frameColor: opts.frameColor instanceof Color ? opts.frameColor : new Color(opts.frameColor),
      detail: opts.detail,
      name: opts.name,
    });
    this.object = this.visual.root;
    this.anchors = this.visual.anchors;
    opts.parent?.add(this.object);
  }

  /**
   * BikeStateEx, not BikeState: the extra fields are the `landCount` /
   * `crashCount` event counters. Consumers running at RENDER rate must use
   * those and not `landedThisStep` / `crashedThisStep`, which are latched for
   * exactly one 120 Hz physics step and are therefore invisible to anything
   * downstream of the accumulator. See the BikeStateEx doc comment.
   */
  get state(): BikeStateEx {
    return this.physics.state;
  }

  set terrain(t: BikeTerrain) {
    this.physics.terrain = t;
  }

  /** The camera, used only to decide whether the chain is worth solving. */
  setCameraRef(cam: Object3D | null): void {
    this.cameraRef = cam;
  }

  /**
   * Hand the bike the TrickState that owns the whip and the bar twist. The
   * race layer calls this once with whichever system is authoritative.
   */
  linkTrick(t: TrickState): void {
    this.trick = t;
  }

  // ───────────────────────────────────────────────────────────────────────────

  step(input: BikeInput, dt: number): void {
    this.physics.step(input, dt);
  }

  updateVisual(alpha: number, dt: number): void {
    const s = this.physics.state;
    const v = this.vis;

    this.physics.interpolatedPosition(alpha, _pos);
    this.physics.interpolatedOrientation(alpha, _quat);
    this.object.position.copy(_pos);
    this.object.quaternion.copy(_quat);

    v.steerAngle = s.steerAngle;
    v.frontCompression = this.physics.interpolatedFrontCompression(alpha);
    v.rearCompression = this.physics.interpolatedRearCompression(alpha);
    v.frontSpin = this.physics.interpolatedFrontSpin(alpha);
    v.rearSpin = this.physics.interpolatedRearSpin(alpha);

    // ── Cranks ──────────────────────────────────────────────────────────────
    // Chain-driven: the cranks are geared to the rear wheel, so a pedalling
    // rider's cadence is a consequence of speed and gearing rather than an
    // animation speed that happens to look about right. Coasting freewheels.
    const gear = G.cogRadius / G.chainringRadius;

    // A bike placed at speed has its cranks already turning. Ramping them up
    // from a standstill on a 0.12 s half-life meant every capture opened with
    // about 250 ms of near-static cranks — measured on `launch`, the cranks
    // moved 0.78 rad over the first 15 frames while the rider held full pedal
    // and the knee moved 8 px, which reads as a rider not pedalling.
    if (this.crankNeedsSeed && Math.abs(s.forwardSpeed) > 0.5) {
      this.crankOmega = (s.forwardSpeed / BIKE.wheelRadius) * gear;
      this.crankNeedsSeed = false;
    }

    const pedalling = this.lastPedal > 0.06 && s.mode === BikeMode.Grounded;
    if (pedalling) {
      this.crankOmega = dampHL(this.crankOmega, this.physics.rear.spinRate * gear, 0.12, dt);
    } else {
      this.crankOmega = crankRate(s.forwardSpeed, false, dt, this.crankOmega);
    }
    v.crankAngle += this.crankOmega * dt;
    v.chainOffset += this.crankOmega * G.chainringRadius * dt;

    // ── Trick rotations ─────────────────────────────────────────────────────
    this.updateTrickVisual(dt);

    const camDist = this.cameraRef
      ? _camPos.setFromMatrixPosition(this.cameraRef.matrixWorld).distanceTo(_pos)
      : 6;
    this.visual.update(v, camDist);
    this.visual.setContacts(this.physics.front.contactPoint, this.physics.rear.contactPoint);
  }

  /**
   * Map the abstract trick state onto the two rotations the bike itself can
   * make. Everything else a trick does is the rider's body, and belongs to the
   * rig, not here.
   */
  private updateTrickVisual(dt: number): void {
    const v = this.vis;
    const t = this.trick;

    let whipTarget = 0;
    let twistTarget = 0;

    if (t && t.kind !== TrickKind.None) {
      if (t.kind === TrickKind.Tailwhip) {
        // A whip is a full 360 of the frame around the steerer, and it goes
        // round the way it started — latched on the first frame of the trick.
        if (v.whipAngle === 0) this.trickSide = this.state.steerAngle >= 0 ? 1 : -1;
        // Ease the rotation: a whip accelerates off the foot and decelerates
        // into the catch. A linear whip looks like a spinning part.
        whipTarget = this.trickSide * ease.inOutCubic(clamp01(t.phase)) * Math.PI * 2;
      } else if (t.kind === TrickKind.XUp) {
        // Bars cross, then come back. Phase runs 0..1 out and back.
        twistTarget = ease.inOutCubic(clamp01(t.phase)) * 2.5;
      }
    }

    // Both come home fast. A whip that eases out over half a second leaves the
    // frame visibly crooked on the landing, which reads as a bug.
    v.whipAngle = dampHL(v.whipAngle, whipTarget, 0.045, dt);
    v.barTwist = dampHL(v.barTwist, twistTarget, 0.05, dt);
    if (Math.abs(v.whipAngle) < 1e-3 && whipTarget === 0) v.whipAngle = 0;
  }

  /** Remembered so the crank logic knows whether the rider is driving. */
  private lastPedal = 0;

  /** Called by the race layer with the input it just handed to `step`. */
  noteInput(input: BikeInput): void {
    this.lastPedal = input.pedal;
  }

  reset(position: Vector3, forward: Vector3): void {
    this.physics.reset(position, forward);
    this.vis.crankAngle = 0;
    this.vis.chainOffset = 0;
    this.vis.whipAngle = 0;

    // Seed the cranks from the speed the bike is being placed at.
    //
    // `reset` used to zero `crankOmega`, and `lastPedal` is only written by
    // `noteInput` — which the race layer calls AFTER the first physics step —
    // so the visual opened every capture believing the rider was coasting and
    // spent a 0.12 s half-life ramping from a standstill. Measured on `launch`:
    // the cranks moved 0.78 rad total over the first 15 frames while the rider
    // held full pedal, and the knee moved 8 px. A bike teleported to 19 m/s has
    // its cranks already turning; starting them from zero is a claim about the
    // world that is not true.
    // Cannot seed from the wheel here: `physics.reset()` has just zeroed the
    // wheel spin, and the caller sets the velocity AFTER this returns. Flag it
    // instead and snap on the first moving visual frame.
    this.crankOmega = 0;
    this.lastPedal = 0.5;
    this.crankNeedsSeed = true;
    this.vis.barTwist = 0;
    this.crankOmega = 0;
    this.lastPedal = 0;
    this.updateVisual(1, 1 / 60);
  }

  dispose(): void {
    this.visual.dispose();
  }
}

/**
 * Factory matching `BikeFactory = (spec: RacerSpec) => IBike` in the race layer.
 * The spec's colour index selects the committed rider colour; nothing here
 * invents one.
 */
export function createBike(opts: BikeOptions): Bike {
  return new Bike(opts);
}

/**
 * Place a bike on the terrain at a point, facing a direction, sitting on its
 * wheels rather than dropping onto them. Used for the start grid and for every
 * checkpoint reset, where a visible settle would look like a bug.
 */
export function seatBikeOnTerrain(
  bike: Bike,
  terrain: BikeTerrain,
  x: number,
  z: number,
  forward: Vector3,
): void {
  const h = terrain.heightAt(x, z);
  terrain.normalAt(x, z, _tmp);
  if (_tmp.lengthSq() < 1e-8) _tmp.set(0, 1, 0);
  else _tmp.normalize();

  // The body origin sits one wheel radius above the contact along the surface
  // normal, less the static sag the springs will take under the rider's weight.
  // Placing it at wheel-radius above the HEIGHT instead would bury the uphill
  // wheel on any slope steeper than about 15°, and the first physics step would
  // fire the bike into the air — a visible pop on every checkpoint reset.
  const sag = lerp(0.010, 0.030, clamp01(_tmp.y));
  _pos.set(x, h, z).addScaledVector(_tmp, G.wheelRadius - sag);
  bike.reset(_pos, forward);
}
