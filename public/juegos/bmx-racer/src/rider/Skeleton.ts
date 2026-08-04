/**
 * Skeleton — the rider's bone hierarchy, built in code, in the bike's own space.
 *
 * Three decisions here decide whether the rest of the rig is easy or impossible:
 *
 *  1. THE REST POSE IS THE RIDING POSE, NOT A T-POSE. Every bone is authored in
 *     a standing "attack" stance with the hands already on the grips and the
 *     feet already on the pedals. A T-pose bind would mean the very first frame
 *     asks the IK for a 90° correction on every limb, which is exactly where
 *     procedural rigs pop, and it would mean the skin weights are solved for a
 *     shape the character is never in. Authoring the bind pose ON the bike makes
 *     every runtime correction small, so the solver stays in its well-behaved
 *     region and the deltoids/knees deform through the range they were weighted
 *     for.
 *
 *  2. EVERY BONE'S REST LOCAL ROTATION IS IDENTITY. Bone k's local offset from
 *     its parent is therefore the same vector in rig space and in the parent's
 *     local frame. That single property removes an entire class of bugs: the rig
 *     can compute everything in rig space, then convert to local rotations with
 *     one quaternion multiply per bone, with no baked rest rotations to smear
 *     into the result and no Euler order to get wrong.
 *
 *  3. ELBOWS AND KNEES ARE SOLVED, NOT TYPED IN. The rest mid-joints come out of
 *     the same `solveTwoBone` the runtime uses, from the same segment lengths and
 *     pole directions. Hand-authored coordinates would be a few millimetres off
 *     the segment lengths, and the rig would snap by that amount on frame one.
 *     Solving them guarantees |shoulder→elbow| is exactly `upperArm` forever.
 *
 * Rig space is bike space: +Y up, +Z forward, +X to the LEFT, origin at
 * mid-wheelbase on the axle line. Ground sits at y = -wheelRadius.
 */

import { Bone, Skeleton, Vector3 } from 'three';

import { BIKE_GEOM } from '../bike/BikeModel';
import { makeLimbState, makeTwoBoneResult, solveTwoBone } from './IK';

// ─────────────────────────────────────────────────────────────────────────────
// Bone table
// ─────────────────────────────────────────────────────────────────────────────

export const BONE_NAMES = [
  'pelvis',
  'spine1',
  'spine2',
  'chest',
  'neck',
  'head',
  'headEnd',
  'clavL',
  'upperArmL',
  'forearmL',
  'handL',
  'handEndL',
  'clavR',
  'upperArmR',
  'forearmR',
  'handR',
  'handEndR',
  'thighL',
  'shinL',
  'footL',
  'toeL',
  'thighR',
  'shinR',
  'footR',
  'toeR',
  'hem',
  'shortsL',
  'shortsR',
] as const;

export type BoneName = (typeof BONE_NAMES)[number];

export const BONE_COUNT = BONE_NAMES.length;

export const BONE_INDEX: Record<BoneName, number> = (() => {
  const m = {} as Record<BoneName, number>;
  for (let i = 0; i < BONE_NAMES.length; i++) m[BONE_NAMES[i]] = i;
  return m;
})();

/** Parent of every bone. `null` only for the pelvis. */
const PARENT_NAME: Record<BoneName, BoneName | null> = {
  pelvis: null,
  spine1: 'pelvis',
  spine2: 'spine1',
  chest: 'spine2',
  neck: 'chest',
  head: 'neck',
  headEnd: 'head',
  clavL: 'chest',
  upperArmL: 'clavL',
  forearmL: 'upperArmL',
  handL: 'forearmL',
  handEndL: 'handL',
  clavR: 'chest',
  upperArmR: 'clavR',
  forearmR: 'upperArmR',
  handR: 'forearmR',
  handEndR: 'handR',
  thighL: 'pelvis',
  shinL: 'thighL',
  footL: 'shinL',
  toeL: 'footL',
  thighR: 'pelvis',
  shinR: 'thighR',
  footR: 'shinR',
  toeR: 'footR',
  hem: 'spine1',
  shortsL: 'thighL',
  shortsR: 'thighR',
};

/**
 * The child each bone points AT. A bone's rest direction is the unit vector
 * toward this child; leaves inherit their parent's direction.
 */
const AIM_NAME: Partial<Record<BoneName, BoneName>> = {
  pelvis: 'spine1',
  spine1: 'spine2',
  spine2: 'chest',
  chest: 'neck',
  neck: 'head',
  head: 'headEnd',
  clavL: 'upperArmL',
  upperArmL: 'forearmL',
  forearmL: 'handL',
  handL: 'handEndL',
  clavR: 'upperArmR',
  upperArmR: 'forearmR',
  forearmR: 'handR',
  handR: 'handEndR',
  thighL: 'shinL',
  shinL: 'footL',
  footL: 'toeL',
  thighR: 'shinR',
  shinR: 'footR',
  footR: 'toeR',
};

// ─────────────────────────────────────────────────────────────────────────────
// Proportions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Segment lengths, metres. A 1.79 m rider, BMX build: short-ish torso, long
 * limbs, wide shoulders. These are the numbers the IK is parameterised by, so
 * changing one here changes the whole rig consistently.
 */
/**
 * The foot, in its own rest frame: origin at the ankle joint, +Z toward the
 * toe, sole flat and horizontal.
 *
 * These numbers are shared by the three places that MUST agree or the foot
 * leaves the pedal: the rest skeleton (which positions the ankle above the
 * spindle), the shoe mesh (which is lofted from them), and the pedal contact
 * the rig solves onto. They live here rather than in RiderMesh so there is
 * exactly one definition of where the bottom of the shoe is.
 *
 * The rest foot is LEVEL. `poseLegs` writes the foot bone's rig rotation as the
 * PEDAL's own rotation times the ankle-flex channel, so with flex at zero the
 * shoe renders exactly as authored — which means "as authored" has to be the
 * sole flat on the platform, not a foot pointed 22° at the ground, which is
 * what it used to be.
 */
export const FOOT = {
  /** Underside of the sole below the ankle joint. */
  soleDrop: 0.090,
  /** Pedal platform top above the spindle. BikeModel: 12.5 mm body, 7.5 mm pins. */
  platform: 0.010,
  /** Back of the heel, behind the ankle. */
  heelBack: 0.078,
  /** Tip of the toe, ahead of the ankle. `heelBack + toeAhead` = shoe length. */
  toeAhead: 0.177,
  /** Ball of the foot — where the spindle sits — ahead of the ankle. */
  ballAhead: 0.078,
  /** The toe BONE (metatarsal joint) relative to the ankle. */
  toeJointAhead: 0.092,
  toeJointDrop: 0.052,
};

export const LIMB = {
  upperArm: 0.285,
  forearm: 0.265,
  thigh: 0.425,
  shin: 0.405,
  /**
   * How far the ankle JOINT sits above the pedal spindle.
   *
   * This is not a free parameter, and it was previously wrong by 28 mm in the
   * wrong direction. The sole of the shoe is `FOOT.soleDrop` below the ankle
   * and the pedal's platform surface is `FOOT.platform` above its spindle, so
   * for the sole to sit ON the platform the ankle must be exactly the sum of
   * the two above the spindle. At the old 0.072 the sole passed 30 mm THROUGH
   * the pedal and out the bottom of it — which, together with `ankleBack`
   * below, is the whole of "the shoe hangs clear of the crank, sole facing
   * nothing". The foot-to-anchor distance measured 0.0727 m and was reported as
   * correct, because the number being measured was the ankle JOINT, and nobody
   * checked where the rendered sole was relative to it.
   */
  ankleLift: FOOT.soleDrop + FOOT.platform,
  /**
   * How far the ankle sits BEHIND the spindle.
   *
   * A pedal spindle goes under the BALL of the foot, which on this rider is
   * 78 mm forward of the ankle. The old value was 10 mm — the spindle
   * effectively under the ankle bone — so the entire shoe hung out in front of
   * the crank with nothing under it.
   */
  ankleBack: FOOT.ballAhead,
};

/** Radii and shape parameters the mesh builder needs. Metres. */
export const RIDER_DIMS = {
  headRadius: 0.096,
  helmetRadius: 0.118,
  neckRadius: 0.050,

  chestHalfWidth: 0.183,
  chestDepth: 0.112,
  waistHalfWidth: 0.138,
  waistDepth: 0.098,
  hipHalfWidth: 0.156,
  hipDepth: 0.116,

  upperArmTop: 0.055,
  upperArmBottom: 0.044,
  forearmTop: 0.044,
  forearmBottom: 0.032,
  handRadius: 0.044,

  thighTop: 0.089,
  thighBottom: 0.064,
  shinTop: 0.060,
  shinBottom: 0.040,

  shoeLength: 0.255,
  shoeWidth: 0.052,
  shoeHeight: 0.078,

  /** Clothing is offset outward from the body by this much. */
  clothGap: 0.016,
};

/** Where the grip centre sits in bike space, derived from the bar sweep. */
const GRIP_INSET = 0.064;
const GRIP_X = BIKE_GEOM.barHalfWidth - GRIP_INSET;
export const GRIP_REST = {
  x: GRIP_X,
  y: BIKE_GEOM.barClamp.y + BIKE_GEOM.barRise + 0.002,
  z: BIKE_GEOM.barClamp.z - GRIP_X * Math.sin(BIKE_GEOM.barBackSweep),
};

/** Cranks horizontal at rest: left pedal back, right pedal forward. */
export const REST_CRANK_ANGLE = Math.PI * 0.5;

/**
 * Pedal spindle position in bike space.
 * `side` is +1 for the LEFT pedal (+X), -1 for the right. At angle 0 the left
 * crank points straight down, matching BikeModel's crank authoring.
 */
export function pedalPosition(side: number, angle: number, out: Vector3): Vector3 {
  const L = BIKE_GEOM.crankLength;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return out.set(
    BIKE_GEOM.bb.x + side * BIKE_GEOM.crankOffset,
    BIKE_GEOM.bb.y - side * L * c,
    BIKE_GEOM.bb.z - side * L * s,
  );
}

/** Grip centre in bike space for a side (+1 = left). */
export function gripPosition(side: number, out: Vector3): Vector3 {
  return out.set(side * GRIP_REST.x, GRIP_REST.y, GRIP_REST.z);
}

// ─────────────────────────────────────────────────────────────────────────────
// Rest pose
// ─────────────────────────────────────────────────────────────────────────────

/** Pole directions, rig space. Elbows out and back; knees forward and out. */
const ELBOW_POLE_L = new Vector3(0.42, -0.16, -0.89).normalize();
const KNEE_POLE_L = new Vector3(0.26, 0.10, 0.96).normalize();

const _restState = makeLimbState();
const _restRes = makeTwoBoneResult();
const _pole = new Vector3();

/** Rest mid-joint + rest bend direction for a two-bone limb. */
function solveRestLimb(
  root: Vector3,
  end: Vector3,
  pole: Vector3,
  len1: number,
  len2: number,
  outMid: Vector3,
  outBend: Vector3,
): void {
  _restState.seeded = false;
  _restState.stretch = 1;
  _restState.overreach = 0;
  _restState.bendDir.set(0, 0, 1);
  solveTwoBone(
    root,
    end,
    pole,
    { len1, len2, maxStretch: 1.0, bendHalfLife: 0, minBend: 0.20 },
    _restState,
    0,
    _restRes,
  );
  outMid.copy(_restRes.mid);
  outBend.copy(_restState.bendDir);
}

function v(x: number, y: number, z: number): Vector3 {
  return new Vector3(x, y, z);
}

/**
 * The rest table. Built once at module load; every RiderSkeleton instance and
 * the mesh builder read from it, and nothing ever mutates it.
 */
export interface RestTable {
  /** Parent index per bone, -1 for the root. */
  parents: Int16Array;
  /** Rig-space rest position per bone. */
  pos: Vector3[];
  /** Rest offset from the parent, in rig space (= in parent local space). */
  offset: Vector3[];
  /** Unit rest direction toward the aim child. */
  dir: Vector3[];
  /** Unit rest side reference, perpendicular-ish to `dir`. */
  side: Vector3[];
  /** Distance to the aim child. */
  length: Float32Array;
  /** Rest bend directions for the four IK limbs. */
  bend: { armL: Vector3; armR: Vector3; legL: Vector3; legR: Vector3 };
  /** Rest anchor positions the rig locks to. */
  anchors: { gripL: Vector3; gripR: Vector3; pedalL: Vector3; pedalR: Vector3 };
}

export const REST: RestTable = buildRest();

function buildRest(): RestTable {
  const pos = new Array<Vector3>(BONE_COUNT);
  const set = (name: BoneName, p: Vector3): void => {
    pos[BONE_INDEX[name]] = p;
  };

  // ── Spine: pelvis up through a forward-leaning torso ──────────────────────
  set('pelvis', v(0, 0.780, -0.130));
  set('spine1', v(0, 0.886, -0.041));
  set('spine2', v(0, 0.993, 0.049));
  set('chest', v(0, 1.113, 0.151));
  set('neck', v(0, 1.214, 0.188));
  set('head', v(0, 1.330, 0.216));
  set('headEnd', v(0, 1.472, 0.249));

  // ── Arms: shoulders to the grips ──────────────────────────────────────────
  const gripL = new Vector3();
  const gripR = new Vector3();
  gripPosition(1, gripL);
  gripPosition(-1, gripR);

  set('clavL', v(0.050, 1.128, 0.142));
  set('clavR', v(-0.050, 1.128, 0.142));
  set('upperArmL', v(0.186, 1.099, 0.166));
  set('upperArmR', v(-0.186, 1.099, 0.166));
  set('handL', gripL.clone());
  set('handR', gripR.clone());
  // The hand tip runs outboard along the bar, so the glove has a direction to
  // be swept along and the wrist has a twist reference.
  const barOut = new Vector3(1, 0.010, -Math.sin(BIKE_GEOM.barBackSweep)).normalize();
  set('handEndL', gripL.clone().addScaledVector(barOut, 0.058));
  set(
    'handEndR',
    gripR.clone().addScaledVector(barOut.clone().set(-barOut.x, barOut.y, barOut.z), 0.058),
  );

  const bendArmL = new Vector3();
  const bendArmR = new Vector3();
  const elbowL = new Vector3();
  const elbowR = new Vector3();
  solveRestLimb(pos[BONE_INDEX.upperArmL], gripL, ELBOW_POLE_L, LIMB.upperArm, LIMB.forearm, elbowL, bendArmL);
  _pole.set(-ELBOW_POLE_L.x, ELBOW_POLE_L.y, ELBOW_POLE_L.z);
  solveRestLimb(pos[BONE_INDEX.upperArmR], gripR, _pole, LIMB.upperArm, LIMB.forearm, elbowR, bendArmR);
  set('forearmL', elbowL.clone());
  set('forearmR', elbowR.clone());

  // ── Legs: hips to the pedals ──────────────────────────────────────────────
  const pedalL = new Vector3();
  const pedalR = new Vector3();
  pedalPosition(1, REST_CRANK_ANGLE, pedalL);
  pedalPosition(-1, REST_CRANK_ANGLE, pedalR);

  const ankleL = pedalL.clone().add(v(0, LIMB.ankleLift, -LIMB.ankleBack));
  const ankleR = pedalR.clone().add(v(0, LIMB.ankleLift, -LIMB.ankleBack));

  set('thighL', v(0.098, 0.775, -0.128));
  set('thighR', v(-0.098, 0.775, -0.128));
  set('footL', ankleL.clone());
  set('footR', ankleR.clone());
  // The toe bone is the metatarsal joint, not the tip of the shoe: it is the
  // hinge the front of the foot flexes about, so it belongs over the ball —
  // which is to say directly over the spindle.
  set('toeL', ankleL.clone().add(v(0, -FOOT.toeJointDrop, FOOT.toeJointAhead)));
  set('toeR', ankleR.clone().add(v(0, -FOOT.toeJointDrop, FOOT.toeJointAhead)));

  const bendLegL = new Vector3();
  const bendLegR = new Vector3();
  const kneeL = new Vector3();
  const kneeR = new Vector3();
  solveRestLimb(pos[BONE_INDEX.thighL], ankleL, KNEE_POLE_L, LIMB.thigh, LIMB.shin, kneeL, bendLegL);
  _pole.set(-KNEE_POLE_L.x, KNEE_POLE_L.y, KNEE_POLE_L.z);
  solveRestLimb(pos[BONE_INDEX.thighR], ankleR, _pole, LIMB.thigh, LIMB.shin, kneeR, bendLegR);
  set('shinL', kneeL.clone());
  set('shinR', kneeR.clone());

  // ── Cloth ─────────────────────────────────────────────────────────────────
  // One hem bone at the small of the back, one per short leg. These carry the
  // follow-through; without them cloth is welded to the body and the rider
  // reads as a plastic figurine.
  set('hem', v(0, 0.858, -0.098));
  set('shortsL', pos[BONE_INDEX.thighL].clone().lerp(kneeL, 0.62));
  set('shortsR', pos[BONE_INDEX.thighR].clone().lerp(kneeR, 0.62));

  // ── Derived tables ────────────────────────────────────────────────────────
  const parents = new Int16Array(BONE_COUNT);
  const offset = new Array<Vector3>(BONE_COUNT);
  const dir = new Array<Vector3>(BONE_COUNT);
  const side = new Array<Vector3>(BONE_COUNT);
  const length = new Float32Array(BONE_COUNT);

  for (let i = 0; i < BONE_COUNT; i++) {
    const name = BONE_NAMES[i];
    const parentName = PARENT_NAME[name];
    parents[i] = parentName === null ? -1 : BONE_INDEX[parentName];
    // The root bone's "offset from its parent" is its rig-space position: its
    // parent is the rig node itself. Leaving it at the origin would bind the
    // skeleton half a metre below the mesh, and the whole rider would then
    // float above the bike by exactly the pelvis height the moment the rig
    // posed itself — which is precisely what it did the first time this ran.
    offset[i] =
      parentName === null ? pos[i].clone() : pos[i].clone().sub(pos[BONE_INDEX[parentName]]);
  }

  for (let i = 0; i < BONE_COUNT; i++) {
    const name = BONE_NAMES[i];
    const aim = AIM_NAME[name];
    if (aim) {
      const d = pos[BONE_INDEX[aim]].clone().sub(pos[i]);
      length[i] = d.length();
      dir[i] = length[i] > 1e-6 ? d.divideScalar(length[i]) : new Vector3(0, 1, 0);
    } else {
      length[i] = 0;
      dir[i] = new Vector3(0, 1, 0); // patched below from the parent
    }
  }
  // Leaves inherit their parent's direction so a rotation applied to them is
  // still meaningful (the toe, the hand tip, the hem).
  for (let i = 0; i < BONE_COUNT; i++) {
    if (!AIM_NAME[BONE_NAMES[i]] && parents[i] >= 0) dir[i].copy(dir[parents[i]]);
  }
  // The hem hangs down and back regardless of the spine's aim.
  dir[BONE_INDEX.hem].set(0, -0.92, -0.39).normalize();
  dir[BONE_INDEX.shortsL].copy(dir[BONE_INDEX.thighL]);
  dir[BONE_INDEX.shortsR].copy(dir[BONE_INDEX.thighR]);

  // Side references. The arms and legs use their own rest bend plane so the
  // runtime solve, which orients bones against the live bend direction, agrees
  // with the bind pose exactly. Everything else uses rig +X.
  for (let i = 0; i < BONE_COUNT; i++) side[i] = new Vector3(1, 0, 0);
  side[BONE_INDEX.upperArmL].copy(bendArmL);
  side[BONE_INDEX.forearmL].copy(bendArmL);
  side[BONE_INDEX.upperArmR].copy(bendArmR);
  side[BONE_INDEX.forearmR].copy(bendArmR);
  side[BONE_INDEX.thighL].copy(bendLegL);
  side[BONE_INDEX.shinL].copy(bendLegL);
  side[BONE_INDEX.thighR].copy(bendLegR);
  side[BONE_INDEX.shinR].copy(bendLegR);
  side[BONE_INDEX.handL].set(0, 0, 1);
  side[BONE_INDEX.handR].set(0, 0, 1);
  side[BONE_INDEX.footL].set(1, 0, 0);
  side[BONE_INDEX.footR].set(1, 0, 0);

  return {
    parents,
    pos,
    offset,
    dir,
    side,
    length,
    bend: { armL: bendArmL, armR: bendArmR, legL: bendLegL, legR: bendLegR },
    anchors: { gripL: gripL.clone(), gripR: gripR.clone(), pedalL, pedalR },
  };
}

/** Convenience for the mesh builder: rest position of a named bone. */
export function restPos(name: BoneName): Vector3 {
  return REST.pos[BONE_INDEX[name]];
}

// ─────────────────────────────────────────────────────────────────────────────
// The instance
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One rider's bones. Geometry and the rest table are shared across every rider;
 * only the Bone objects and the Skeleton are per-instance, because those are
 * what animate.
 */
export class RiderSkeleton {
  readonly bones: Bone[] = [];
  readonly skeleton: Skeleton;
  readonly root: Bone;

  constructor() {
    for (let i = 0; i < BONE_COUNT; i++) {
      const b = new Bone();
      b.name = BONE_NAMES[i];
      b.position.copy(REST.offset[i]);
      // Rest local rotation is identity by construction. See the header.
      this.bones.push(b);
    }
    for (let i = 0; i < BONE_COUNT; i++) {
      const p = REST.parents[i];
      if (p >= 0) this.bones[p].add(this.bones[i]);
    }
    this.root = this.bones[BONE_INDEX.pelvis];
    this.root.updateMatrixWorld(true);
    // Skeleton captures the inverse bind matrices from the bones' current world
    // matrices, which is why the root must be at the origin right now.
    this.skeleton = new Skeleton(this.bones);
  }

  bone(name: BoneName): Bone {
    return this.bones[BONE_INDEX[name]];
  }

  dispose(): void {
    this.skeleton.dispose();
  }
}
