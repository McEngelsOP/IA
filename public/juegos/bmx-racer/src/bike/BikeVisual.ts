/**
 * BikeVisual — the scene graph, the anchors, and everything that moves.
 *
 * BikeModel.ts builds the geometry. This file assembles it into a hierarchy and
 * drives it from the physics state. The split matters: geometry is built once
 * and shared by all four racers, while every racer gets its own hierarchy of
 * ~30 Object3Ds and one re-hued frame material.
 *
 * The hierarchy is built around the steering axis, not the bike origin:
 *
 *   root
 *    ├─ steer        rotation about the real steerer line
 *    │   ├─ barTwist rotation about the same line, bars only  (x-up)
 *    │   │   └─ bars, grips, [barLeft] [barRight]
 *    │   ├─ forkUpper
 *    │   └─ forkSlide   translation DOWN the steerer line     (fork travel)
 *    │       └─ forkLower, front wheel
 *    └─ whip         rotation about the same line, frame only (tailwhip)
 *        ├─ frame, seatpost, saddle, [seat]
 *        ├─ swing       rotation about the swingarm pivot     (shock travel)
 *        │   └─ swingarm, rear wheel
 *        ├─ shockBody / shockShaft   aimed at each other
 *        ├─ cranks      rotation about the bottom bracket
 *        │   └─ [pedalLeft] [pedalRight], each counter-rotated to stay level
 *        └─ chain
 *
 * A tailwhip therefore spins the frame, the swingarm, the rear wheel, the
 * cranks and the chain around the steerer while the bars, fork and front wheel
 * stay exactly where the rider's hands are. That is the whole reason for the
 * pivot structure — the rider rig IKs to `barLeft`/`barRight`, and if those
 * moved during a whip the hands would leave the bars.
 *
 * Bike space: +Y up, +Z forward, +X to the LEFT.
 */

import {
  Color,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  Object3D,
  Quaternion,
  Vector3,
} from 'three';

import {
  BIKE_GEOM as G,
  axisPivot,
  getBikeGeometries,
  makePart,
  reHueRamp,
  sharedMaterial,
  type BikeGeometries,
} from './BikeModel';
import { CelMaterial, createHullMaterial, registerNprMesh } from '../npr/CelMaterial';
import { RAMPS } from '../npr/Palette';
import type { BikeAnchors } from '../game/Contracts';
import { clamp, clamp01, dampHL } from '../core/MathX';

// ─────────────────────────────────────────────────────────────────────────────
// Scratch — module scope, never allocated per frame
// ─────────────────────────────────────────────────────────────────────────────
const _v = new Vector3();
const _v2 = new Vector3();
const _dir = new Vector3();
const _q = new Quaternion();
const _m = new Matrix4();
const _up = new Vector3(0, 1, 0);

/** Vertical rate of the rear axle per radian of swingarm rotation, metres. */
const SWING_RATE = -(G.rearAxle.z - G.swingPivot.z);

/** Grip centre — where a hand actually closes around the bar. */
const GRIP_CENTRE_HALF_WIDTH = 0.256;

/**
 * A three-node pivot: `outer` places and aligns the axis, `rot` is the only
 * node that ever changes (rotation.y = rotation about the axis), and `inner`
 * undoes the placement so children are still authored in plain bike space.
 */
function spinPivot(origin: Vector3, axis: Vector3, name: string) {
  const { outer, inner } = axisPivot(origin, axis, name);
  const rot = new Object3D();
  rot.name = `${name}:rot`;
  outer.add(rot);
  rot.add(inner);
  return { outer, rot, inner };
}

export interface BikeVisualOptions {
  /** Frame colour for this rider. The `frame` ramp is re-hued toward it. */
  frameColor: Color;
  /** Skip the chain and the spokes at distance. Cheap racers for the AI pack. */
  detail?: 'full' | 'reduced';
  name?: string;
}

/** Everything the visual needs to know from the simulation, once per frame. */
export interface BikeVisualState {
  steerAngle: number;
  /** 0 = topped out, 1 = bottomed. */
  frontCompression: number;
  rearCompression: number;
  frontSpin: number;
  rearSpin: number;
  crankAngle: number;
  /** Frame rotation about the steerer, radians. Tailwhip. */
  whipAngle: number;
  /** Bar twist about the steerer on top of the steer angle. X-up. */
  barTwist: number;
  /** Chain travel in metres, for the link phase. */
  chainOffset: number;
}

export class BikeVisual {
  readonly root = new Group();
  readonly anchors: BikeAnchors;

  private geo: BikeGeometries;
  private steerRot: Object3D;
  private barTwistRot: Object3D;
  private forkSlide: Object3D;
  private whipRot: Object3D;
  private swingRot: Object3D;
  private crankRot: Object3D;
  private frontWheel: Object3D;
  private rearWheel: Object3D;
  private shockBody: Object3D;
  private shockShaft: Object3D;
  private pedalRightPivot: Object3D;
  private pedalLeftPivot: Object3D;
  private chain: InstancedMesh | null = null;
  private chainMaterial: CelMaterial | null = null;

  /** Materials owned by this instance (the re-hued frame) and disposed with it. */
  private ownMaterials: CelMaterial[] = [];
  private ownHulls: Object3D[] = [];

  /** Swingarm-space arm mount, recomputed each frame for the shock aim. */
  private armMountWorldish = new Vector3();

  constructor(opts: BikeVisualOptions) {
    this.geo = getBikeGeometries();
    const detail = opts.detail ?? 'full';
    this.root.name = opts.name ?? 'bike';

    // ── Front end ───────────────────────────────────────────────────────────
    const steer = spinPivot(G.headBottom, G.steerAxis, 'steer');
    this.steerRot = steer.rot;
    this.root.add(steer.outer);

    const barTwist = spinPivot(G.headBottom, G.steerAxis, 'barTwist');
    this.barTwistRot = barTwist.rot;
    steer.inner.add(barTwist.outer);

    const metal = sharedMaterial('metal', { name: 'bike:metal', matcapMix: 0.44 });
    const rubber = sharedMaterial('rubber', { name: 'bike:rubber' });
    const tyreMat = sharedMaterial('tyre', { name: 'bike:tyre' });
    const saddleMat = sharedMaterial('cloth', { name: 'bike:saddle' });

    makePart(this.geo.bars, metal, 'metal', 'bars', barTwist.inner);
    makePart(this.geo.grips, rubber, 'rubber', 'grips', barTwist.inner);

    makePart(this.geo.forkUpper, metal, 'metal', 'forkUpper', steer.inner);

    // The fork lowers slide DOWN the steerer line as the fork compresses. That
    // is what makes a compressed fork visibly steepen the head angle.
    this.forkSlide = new Object3D();
    this.forkSlide.name = 'forkSlide';
    steer.inner.add(this.forkSlide);
    makePart(this.geo.forkLower, metal, 'metal', 'forkLower', this.forkSlide);

    this.frontWheel = new Object3D();
    this.frontWheel.name = 'frontWheel';
    this.frontWheel.position.copy(G.frontAxle);
    this.forkSlide.add(this.frontWheel);
    this.buildWheel(this.frontWheel, metal, tyreMat, detail, true);

    // ── Frame ───────────────────────────────────────────────────────────────
    const whip = spinPivot(G.headBottom, G.steerAxis, 'whip');
    this.whipRot = whip.rot;
    this.root.add(whip.outer);

    // The one material that is per-rider. Lightness comes from the committed
    // `frame` ramp; only the hue is the rider's.
    const frameMat = new CelMaterial(reHueRamp(RAMPS.frame, opts.frameColor), {
      name: `bike:frame:${opts.name ?? 'x'}`,
      matcapMix: 0.34,
    });
    this.ownMaterials.push(frameMat);

    makePart(this.geo.frameTubes, frameMat, null, 'frameTubes', whip.inner);
    this.attachOwnHull(this.geo.frameTubes, frameMat, 'frameTubes', whip.inner);
    makePart(this.geo.seatpost, metal, 'metal', 'seatpost', whip.inner);
    makePart(this.geo.saddle, saddleMat, 'cloth', 'saddle', whip.inner);

    // ── Rear suspension ─────────────────────────────────────────────────────
    const swing = spinPivot(G.swingPivot, new Vector3(1, 0, 0), 'swing');
    this.swingRot = swing.rot;
    whip.inner.add(swing.outer);
    makePart(this.geo.swingarm, frameMat, null, 'swingarm', swing.inner);
    this.attachOwnHull(this.geo.swingarm, frameMat, 'swingarm', swing.inner);

    this.rearWheel = new Object3D();
    this.rearWheel.name = 'rearWheel';
    this.rearWheel.position.copy(G.rearAxle);
    swing.inner.add(this.rearWheel);
    this.buildWheel(this.rearWheel, metal, tyreMat, detail, false);
    makePart(this.geo.cog, metal, 'metal', 'cog', this.rearWheel);

    // The shock body hangs from the frame mount; the shaft rises from the arm
    // mount. Both are aimed at each other every frame, so the shaft visibly
    // disappears into the body under load rather than telescoping in place.
    this.shockBody = new Object3D();
    this.shockBody.name = 'shockBody';
    this.shockBody.position.copy(G.shockFrameMount);
    whip.inner.add(this.shockBody);
    makePart(this.geo.shockBody, metal, 'metal', 'shockBodyMesh', this.shockBody);

    this.shockShaft = new Object3D();
    this.shockShaft.name = 'shockShaft';
    swing.inner.add(this.shockShaft);
    makePart(this.geo.shockShaft, metal, 'metal', 'shockShaftMesh', this.shockShaft);

    // ── Drivetrain ──────────────────────────────────────────────────────────
    const crank = spinPivot(G.bb, new Vector3(1, 0, 0), 'cranks');
    this.crankRot = crank.rot;
    whip.inner.add(crank.outer);
    makePart(this.geo.cranks, metal, 'metal', 'cranks', crank.inner);

    // Pedals hang off the crank arms and stay level: the pivot rides the arm,
    // and the pedal under it counter-rotates by the crank angle. A pedal that
    // rotates with the crank is the single most common tell of a fake bike.
    this.pedalRightPivot = new Object3D();
    this.pedalRightPivot.name = 'pedalRightPivot';
    crank.inner.add(this.pedalRightPivot);
    const pedalR = new Object3D();
    pedalR.name = 'pedalRight';
    this.pedalRightPivot.add(pedalR);
    makePart(this.geo.pedal, metal, 'metal', 'pedalRightMesh', pedalR);

    this.pedalLeftPivot = new Object3D();
    this.pedalLeftPivot.name = 'pedalLeftPivot';
    crank.inner.add(this.pedalLeftPivot);
    const pedalL = new Object3D();
    pedalL.name = 'pedalLeft';
    this.pedalLeftPivot.add(pedalL);
    makePart(this.geo.pedal, metal, 'metal', 'pedalLeftMesh', pedalL);

    if (detail === 'full') this.buildChain(whip.inner, metal);

    // ── Anchors ─────────────────────────────────────────────────────────────
    // These are the contract with the rider rig. Hands IK to the bar anchors,
    // feet to the pedal anchors, and they must be real nodes in the hierarchy
    // so they inherit steering, whips, bar twist and suspension for free.
    const barLeft = new Object3D();
    barLeft.name = 'anchor:barLeft';
    barLeft.position.set(
      GRIP_CENTRE_HALF_WIDTH,
      G.barClamp.y + G.barRise + 0.002,
      G.barClamp.z - GRIP_CENTRE_HALF_WIDTH * Math.sin(G.barBackSweep),
    );
    barTwist.inner.add(barLeft);

    const barRight = barLeft.clone();
    barRight.name = 'anchor:barRight';
    barRight.position.x = -GRIP_CENTRE_HALF_WIDTH;
    barTwist.inner.add(barRight);

    const seat = new Object3D();
    seat.name = 'anchor:seat';
    seat.position.copy(G.saddle);
    whip.inner.add(seat);

    const frame = new Object3D();
    frame.name = 'anchor:frame';
    frame.position.copy(G.bb);
    whip.inner.add(frame);

    // Contact anchors live on the ROOT, not on the wheels: they are written in
    // world space from the physics contact points, which are on the ground, not
    // at the axle.
    const frontContact = new Object3D();
    frontContact.name = 'anchor:frontContact';
    this.root.add(frontContact);
    const rearContact = new Object3D();
    rearContact.name = 'anchor:rearContact';
    this.root.add(rearContact);

    this.anchors = {
      barLeft,
      barRight,
      pedalLeft: pedalL,
      pedalRight: pedalR,
      seat,
      frame,
      frontContact,
      rearContact,
    };
  }

  // ───────────────────────────────────────────────────────────────────────────

  private buildWheel(
    parent: Object3D,
    metal: CelMaterial,
    tyreMat: CelMaterial,
    detail: 'full' | 'reduced',
    _isFront: boolean,
  ): void {
    makePart(this.geo.rim, metal, 'metal', 'rim', parent);
    makePart(this.geo.tyre, tyreMat, 'tyre', 'tyre', parent);
    if (detail === 'full') {
      makePart(this.geo.hubSpokes, metal, 'metal', 'hubSpokes', parent);
      makePart(this.geo.rotor, metal, 'metal', 'rotor', parent);
    }
  }

  /**
   * The frame's hull cannot be shared, because the frame material is per-rider
   * and the hull carries the ramp's outline colour. One extra hull material per
   * racer is the cost of four differently coloured bikes.
   */
  private attachOwnHull(
    geo: BikeGeometries['frameTubes'],
    mat: CelMaterial,
    name: string,
    parent: Object3D,
  ): void {
    if (mat.preset.outlineWidth <= 0 || !geo.getAttribute('aSmoothNormal')) return;
    const hm = createHullMaterial(mat.preset, mat.celOptions);
    const hull = new Mesh(geo, hm);
    hull.name = `${name}:hull`;
    hull.renderOrder = -1;
    hull.userData.isHull = true;
    parent.add(hull);
    this.ownHulls.push(hull);
  }

  /**
   * The chain, as one InstancedMesh of 98 links stepped along the arc-length
   * parameterisation of the real chain line. Rebuilding 98 matrices per frame
   * for four bikes is not free, so `update` only touches it inside `chainRange`
   * metres of the camera — past that the links are sub-pixel and the visible
   * motion is carried entirely by the chainring and the cog.
   */
  private buildChain(parent: Object3D, metal: CelMaterial): void {
    const path = this.geo.chainPath;
    const count = Math.max(8, Math.floor(path.length / G.chainLinkPitch));
    const mat = new CelMaterial(RAMPS.metal, {
      name: 'bike:chain',
      matcapMix: 0.5,
      instanced: true,
      outlineWidth: 0, // links are 12 mm; a hull on them is pure noise
    });
    this.chainMaterial = mat;
    const mesh = new InstancedMesh(this.geo.chainLink, mat, count);
    mesh.name = 'chain';
    mesh.frustumCulled = false;
    mesh.castShadow = true;

    // The instanced shader path expects these three attributes to exist. The
    // chain does not tint, fade or sway, so they are constant.
    const tint = new Float32Array(count * 3).fill(1);
    const fade = new Float32Array(count).fill(1);
    const phase = new Float32Array(count).fill(0);
    this.geo.chainLink.setAttribute('aInstanceTint', new InstancedBufferAttribute(tint, 3));
    this.geo.chainLink.setAttribute('aInstanceFade', new InstancedBufferAttribute(fade, 1));
    this.geo.chainLink.setAttribute('aInstancePhase', new InstancedBufferAttribute(phase, 1));

    registerNprMesh(mesh, mat);
    parent.add(mesh);
    this.chain = mesh;
    this.chainCount = count;
    this.placeChain(0);
  }

  private chainCount = 0;
  private chainDirty = true;

  /** Place every link at chain-distance `offset` along the path. */
  private placeChain(offset: number): void {
    const chain = this.chain;
    if (!chain) return;
    const path = this.geo.chainPath;
    const L = path.length;
    // The path is a CLOSED loop: `points` and `tangents` have n entries while
    // `cumulative` has n+1 (it ends at the total length, wrapping back to
    // point 0). Every point lookup therefore has to wrap, or the last segment
    // indexes one past the end of the array.
    const n = path.points.length;
    if (n < 2 || !(L > 1e-6)) return;

    for (let i = 0; i < this.chainCount; i++) {
      let s = (offset + i * G.chainLinkPitch) % L;
      if (!Number.isFinite(s)) s = 0;
      if (s < 0) s += L;
      // Binary search would be tidier; the cumulative array is ~25 long and the
      // walk is cache-friendly, so a linear scan from a proportional guess is
      // faster in practice.
      let k = Math.min(n - 1, Math.max(0, Math.floor((s / L) * n)));
      while (k > 0 && path.cumulative[k] > s) k--;
      while (k < n - 1 && path.cumulative[k + 1] < s) k++;
      const span = Math.max(path.cumulative[k + 1] - path.cumulative[k], 1e-6);
      const f = clamp01((s - path.cumulative[k]) / span);
      const k1 = (k + 1) % n;

      _v.lerpVectors(path.points[k], path.points[k1], f);
      _dir.lerpVectors(path.tangents[k], path.tangents[k1], f);
      if (_dir.lengthSq() < 1e-9) _dir.set(0, 0, 1);
      _dir.normalize();

      // The link's long axis is +Z. Aim it down the chain.
      _q.setFromUnitVectors(_ZAXIS, _dir);
      _m.compose(_v, _q, _ONE);
      chain.setMatrixAt(i, _m);
    }
    chain.instanceMatrix.needsUpdate = true;
  }

  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Drive every moving part. Called once per rendered frame with the visually
   * interpolated state, never from the fixed physics step.
   */
  update(s: BikeVisualState, cameraDistance: number): void {
    // Steering and the two trick rotations. Positive steer is to the RIGHT, and
    // a positive rotation about the (upward) steerer axis goes LEFT.
    this.steerRot.rotation.y = -s.steerAngle;
    this.barTwistRot.rotation.y = -s.barTwist;
    this.whipRot.rotation.y = s.whipAngle;

    // Fork: slide the lowers down the steerer line.
    const forkDrop = clamp01(s.frontCompression) * G.forkTravel;
    this.forkSlide.position.copy(G.steerAxis).multiplyScalar(-forkDrop);

    // Rear: rotate the swingarm so the axle rises by the compressed travel.
    const rearRise = clamp01(s.rearCompression) * G.shockWheelTravel;
    const swingAngle = Math.asin(clamp(rearRise / SWING_RATE, -0.9, 0.9));
    this.swingRot.rotation.y = swingAngle;

    // Aim the shock halves at each other. The arm mount has moved with the
    // swingarm, so its position has to be re-derived, not read from the node.
    _v.copy(G.shockArmMount).sub(G.swingPivot);
    _v.applyAxisAngle(_XAXIS, swingAngle).add(G.swingPivot);
    this.armMountWorldish.copy(_v);

    _dir.copy(_v).sub(G.shockFrameMount);
    const shockLen = _dir.length();
    if (shockLen > 1e-5) {
      _dir.multiplyScalar(1 / shockLen);
      // Body: local -Y points at the arm.
      _v2.copy(_dir).negate();
      this.shockBody.quaternion.setFromUnitVectors(_up, _v2);
      // Shaft: local +Y points back at the frame mount, and it lives in the
      // swingarm's space, so undo the swing rotation from the aim.
      this.shockShaft.position.copy(G.shockArmMount);
      _v2.copy(_dir).applyAxisAngle(_XAXIS, -swingAngle);
      this.shockShaft.quaternion.setFromUnitVectors(_up, _v2);
    }

    // Wheels.
    this.frontWheel.rotation.x = s.frontSpin;
    this.rearWheel.rotation.x = s.rearSpin;

    // Cranks, and the pedals that must stay level under them.
    const a = s.crankAngle;
    this.crankRot.rotation.y = a;
    const L = G.crankLength;
    const off = G.crankOffset;
    // Drive side is -X (the rider's right); its arm points +Y at angle 0.
    this.pedalRightPivot.position.set(-off, L, 0);
    this.pedalLeftPivot.position.set(off, -L, 0);
    // Counter-rotate so the platform stays horizontal through the stroke.
    this.pedalRightPivot.rotation.x = -a;
    this.pedalLeftPivot.rotation.x = -a;

    // Chain — only worth the matrix churn up close.
    if (this.chain) {
      const near = cameraDistance < CHAIN_RANGE;
      this.chain.visible = near || cameraDistance < CHAIN_RANGE * 3;
      if (near) {
        this.placeChain(s.chainOffset);
        this.chainDirty = true;
      } else if (this.chainDirty) {
        // Leave it parked in a valid pose rather than wherever it stopped.
        this.placeChain(0);
        this.chainDirty = false;
      }
    }
  }

  /** Write the world-space contact anchors the FX systems emit dust from. */
  setContacts(front: Vector3, rear: Vector3): void {
    this.root.worldToLocal(_v.copy(front));
    this.anchors.frontContact.position.copy(_v);
    this.root.worldToLocal(_v.copy(rear));
    this.anchors.rearContact.position.copy(_v);
  }

  dispose(): void {
    for (const m of this.ownMaterials) m.dispose();
    for (const h of this.ownHulls) {
      const mesh = h as Mesh;
      (mesh.material as CelMaterial | undefined)?.dispose?.();
    }
    this.chainMaterial?.dispose();
    this.chain?.dispose();
    this.root.removeFromParent();
  }
}

/** Beyond this many metres the chain stops being re-solved every frame. */
const CHAIN_RANGE = 14;

const _ZAXIS = new Vector3(0, 0, 1);
const _XAXIS = new Vector3(1, 0, 0);
const _ONE = new Vector3(1, 1, 1);

/**
 * Crank cadence. A rider does not pedal at a speed-proportional rate — they
 * hold a cadence band and coast outside it, which is why a bike whose cranks
 * spin faster and faster with speed always looks wrong.
 */
export function crankRate(forwardSpeed: number, pedalling: boolean, dt: number, current: number): number {
  if (!pedalling || forwardSpeed < 0.4) {
    // Freewheel: the cranks coast to a stop over about a second.
    return dampHL(current, 0, 0.30, dt);
  }
  // 70–105 rpm across the usable speed range, then spun out.
  const rpm = 70 + clamp01((forwardSpeed - 3) / 12) * 35;
  const target = (rpm / 60) * Math.PI * 2;
  return dampHL(current, target, 0.22, dt);
}
