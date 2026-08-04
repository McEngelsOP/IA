/**
 * IK — analytic two-bone IK with damped pole vectors, plus a FABRIK chain
 * solver used for the spine.
 *
 * Three things in here are the difference between "IK works" and "IK never
 * pops", and all three are the reason this file exists rather than a 20-line
 * law-of-cosines snippet inside the rig:
 *
 *  1. THE POLE IS DAMPED, NOT RECOMPUTED. A pole vector defines the plane the
 *     limb bends in. The naive implementation recomputes that plane from a
 *     world-space pole target every frame; the moment the pole direction passes
 *     near the root→target axis, its perpendicular component collapses and the
 *     bend plane flips 180° in a single frame. That is the elbow-snap you see
 *     in almost every procedural rig. Here each limb owns a persistent bend
 *     direction that is *smoothed* toward the freshly computed one and never
 *     replaced outright, and if the fresh one is degenerate the previous one is
 *     kept. The bend plane therefore cannot flip discontinuously — the worst
 *     case is that it rotates smoothly over a few frames.
 *
 *  2. THE CHAIN STRETCHES RATHER THAN DETACHING. When the target is beyond
 *     reach, the textbook solve clamps the distance and the end effector stops
 *     short — the hand leaves the bar. In this game the hand leaving the bar is
 *     a hard failure. So out of range we scale both segment lengths so the end
 *     lands exactly on the target, up to a cap, and we REPORT the stretch so
 *     the rig can pull the pelvis into range over the next few frames. A 3%
 *     long forearm is invisible; a floating hand is not.
 *
 *  3. ROTATIONS COME FROM FULL FRAMES, NOT MINIMAL ARCS. Rotating a bone by the
 *     shortest arc from its rest direction to its solved direction leaves the
 *     twist about that direction unconstrained, which lets a forearm spin
 *     freely and makes swept-tube geometry corkscrew. Every bone here is
 *     oriented by matching an orthonormal frame (direction + side reference),
 *     so twist is always explicit and always continuous.
 *
 * Nothing in this file allocates after module load.
 */

import { Matrix4, Quaternion, Vector3 } from 'three';
import { clamp, clamp01 } from '../core/MathX';

// ── Module-scope scratch ─────────────────────────────────────────────────────
const _toTarget = new Vector3();
const _axis = new Vector3();
const _bend = new Vector3();
const _tmp = new Vector3();
const _tmp2 = new Vector3();
const _restX = new Vector3();
const _restY = new Vector3();
const _restZ = new Vector3();
const _newX = new Vector3();
const _newY = new Vector3();
const _newZ = new Vector3();
const _mRest = new Matrix4();
const _mNew = new Matrix4();
const _mOut = new Matrix4();
const _qTmp = new Quaternion();

const EPS = 1e-6;

// ─────────────────────────────────────────────────────────────────────────────
// Two-bone IK
// ─────────────────────────────────────────────────────────────────────────────

/** Persistent per-limb solver state. One of these per arm and per leg. */
export interface LimbSolverState {
  /** The unit bend direction, perpendicular to the root→target axis. */
  bendDir: Vector3;
  /** True once bendDir has been seeded. */
  seeded: boolean;
  /** Stretch factor applied on the last solve. 1 = in range. */
  stretch: number;
  /** How far past reach the target was on the last solve, in metres. */
  overreach: number;
}

export function makeLimbState(): LimbSolverState {
  return { bendDir: new Vector3(0, 0, 1), seeded: false, stretch: 1, overreach: 0 };
}

export interface TwoBoneResult {
  /** Solved mid-joint position (elbow / knee). */
  mid: Vector3;
  /** Solved end position. Equals `target` unless the stretch cap was hit. */
  end: Vector3;
}

export function makeTwoBoneResult(): TwoBoneResult {
  return { mid: new Vector3(), end: new Vector3() };
}

export interface TwoBoneParams {
  /** Length of the upper segment (shoulder→elbow, hip→knee). */
  len1: number;
  /** Length of the lower segment (elbow→wrist, knee→ankle). */
  len2: number;
  /**
   * Maximum multiplier applied to both segments when the target is out of
   * reach. 1 = never stretch (the end effector will fall short). Limbs that
   * must not detach pass ~1.25.
   */
  maxStretch: number;
  /**
   * Half-life, seconds, for the bend-plane damping. Small (0.02–0.05) keeps the
   * elbow responsive; large smears it. 0 disables damping.
   */
  bendHalfLife: number;
  /**
   * Minimum interior angle at the mid joint, radians. Stops the elbow or knee
   * folding into itself and the two segments interpenetrating. ~0.20 rad.
   */
  minBend: number;
}

/**
 * Solve a two-bone chain.
 *
 * `poleDir` is a DIRECTION from the root toward the desired bend side. Its
 * length is irrelevant — only the component perpendicular to root→target is
 * used. Passing a direction rather than a world-space pole *point* is
 * deliberate: a point at a fixed offset from the root behaves badly when the
 * limb is nearly straight along that offset, and every caller here naturally
 * has a direction to hand.
 */
export function solveTwoBone(
  root: Vector3,
  target: Vector3,
  poleDir: Vector3,
  p: TwoBoneParams,
  state: LimbSolverState,
  dt: number,
  out: TwoBoneResult,
): void {
  _toTarget.subVectors(target, root);
  const d = _toTarget.length();

  // Degenerate: target sitting on the root. Push it out along the previous
  // bend so the limb has somewhere to go rather than producing NaNs.
  if (d < EPS) {
    _axis.copy(state.seeded ? state.bendDir : _axis.set(0, 0, 1));
    out.end.copy(root).addScaledVector(_axis, p.len1 + p.len2);
    out.mid.copy(root).addScaledVector(_axis, p.len1);
    state.stretch = 1;
    state.overreach = 0;
    return;
  }

  _axis.copy(_toTarget).divideScalar(d);

  // ── Reach handling ────────────────────────────────────────────────────────
  // minBend caps how tightly the joint may fold, which also bounds how short
  // the chain can be. maxStretch bounds how long.
  //
  // `minBend` is the minimum INTERIOR angle at the mid joint, so it goes
  // straight into the law of cosines. (It was previously negated through
  // `PI - minBend`, which made the shortest permitted chain almost the fully
  // extended length — every limb was pinned straight and every end effector
  // overshot its target by the difference.)
  const cosMin = Math.cos(p.minBend);
  const minReach = Math.sqrt(
    Math.max(p.len1 * p.len1 + p.len2 * p.len2 - 2 * p.len1 * p.len2 * cosMin, 1e-8),
  );
  const naturalReach = (p.len1 + p.len2) * 0.9995;

  let l1 = p.len1;
  let l2 = p.len2;
  let dEff = d;
  state.overreach = Math.max(0, d - naturalReach);

  if (d > naturalReach) {
    const want = d / naturalReach;
    const s = Math.min(want, Math.max(1, p.maxStretch));
    l1 *= s;
    l2 *= s;
    state.stretch = s;
    dEff = Math.min(d, (l1 + l2) * 0.9995);
  } else {
    state.stretch = 1;
    dEff = Math.max(d, minReach);
  }

  // ── Bend plane ────────────────────────────────────────────────────────────
  // Strip the component of the pole direction along the limb axis. What is left
  // is where the mid joint wants to sit.
  _bend.copy(poleDir);
  _bend.addScaledVector(_axis, -_bend.dot(_axis));
  const bendLen = _bend.length();

  if (bendLen > 1e-3) {
    _bend.divideScalar(bendLen);
    if (!state.seeded) {
      state.bendDir.copy(_bend);
      state.seeded = true;
    } else if (p.bendHalfLife > 0 && dt > 0) {
      // Smooth toward the requested plane. Because we interpolate the VECTOR
      // and re-orthogonalise, a request that would flip the plane instead
      // rotates through the intermediate angles over a few frames.
      const k = 1 - Math.pow(2, -dt / p.bendHalfLife);
      state.bendDir.lerp(_bend, clamp01(k));
    } else {
      state.bendDir.copy(_bend);
    }
  } else if (!state.seeded) {
    // No usable pole and nothing remembered: pick any stable perpendicular.
    _tmp.set(0, 1, 0);
    if (Math.abs(_axis.y) > 0.94) _tmp.set(0, 0, 1);
    state.bendDir.crossVectors(_axis, _tmp).normalize();
    state.seeded = true;
  }

  // Re-orthogonalise the remembered bend against the current axis. This is what
  // keeps the plane valid as the limb swings; without it the stored vector
  // slowly drifts into the axis and the solve degenerates.
  _bend.copy(state.bendDir);
  _bend.addScaledVector(_axis, -_bend.dot(_axis));
  if (_bend.lengthSq() < 1e-8) {
    _tmp.set(0, 1, 0);
    if (Math.abs(_axis.y) > 0.94) _tmp.set(0, 0, 1);
    _bend.crossVectors(_axis, _tmp);
  }
  _bend.normalize();
  state.bendDir.copy(_bend);

  // ── Law of cosines ────────────────────────────────────────────────────────
  const cosRoot = clamp((l1 * l1 + dEff * dEff - l2 * l2) / (2 * l1 * dEff), -1, 1);
  const sinRoot = Math.sqrt(Math.max(0, 1 - cosRoot * cosRoot));

  out.mid.copy(root).addScaledVector(_axis, l1 * cosRoot).addScaledVector(_bend, l1 * sinRoot);
  out.end.copy(root).addScaledVector(_axis, dEff);
}

// ─────────────────────────────────────────────────────────────────────────────
// Frame-matched bone orientation
// ─────────────────────────────────────────────────────────────────────────────

/** Build an orthonormal basis matrix whose X is `dir` and whose Y leans to `side`. */
function basis(dir: Vector3, side: Vector3, out: Matrix4): void {
  _newX.copy(dir);
  const dl = _newX.length();
  if (dl < EPS) _newX.set(1, 0, 0);
  else _newX.divideScalar(dl);

  _newY.copy(side);
  _newY.addScaledVector(_newX, -_newY.dot(_newX));
  if (_newY.lengthSq() < 1e-10) {
    // side was parallel to dir — take any perpendicular.
    _tmp2.set(0, 1, 0);
    if (Math.abs(_newX.y) > 0.94) _tmp2.set(0, 0, 1);
    _newY.crossVectors(_tmp2, _newX);
  }
  _newY.normalize();
  _newZ.crossVectors(_newX, _newY);
  out.makeBasis(_newX, _newY, _newZ);
}

/**
 * Rotation taking the rest frame (restDir, restSide) onto (newDir, newSide).
 *
 * Used for every bone in the rig. The rest frame is baked at build time and
 * never changes, so this is the one and only place a bone's orientation is
 * decided — there is no accumulated Euler state anywhere in the rig to drift.
 */
export function alignFrames(
  restDir: Vector3,
  restSide: Vector3,
  newDir: Vector3,
  newSide: Vector3,
  out: Quaternion,
): Quaternion {
  basis(restDir, restSide, _mRest);
  // Rotation matrices are orthonormal, so the transpose is the inverse and we
  // avoid a general 4x4 invert per bone per frame.
  _mRest.transpose();
  basis(newDir, newSide, _mNew);
  _mOut.multiplyMatrices(_mNew, _mRest);
  return out.setFromRotationMatrix(_mOut);
}

/**
 * Convert a rig-space rotation into a bone's LOCAL rotation, given its parent's
 * rig-space rotation. `out` may alias `rigSpaceRot`.
 */
export function toLocalRotation(
  rigSpaceRot: Quaternion,
  parentRigRot: Quaternion,
  out: Quaternion,
): Quaternion {
  _qTmp.copy(parentRigRot).invert();
  return out.multiplyQuaternions(_qTmp, rigSpaceRot);
}

// ─────────────────────────────────────────────────────────────────────────────
// Joint limits
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Clamp a rotation so its swing away from `restDir` does not exceed `maxAngle`.
 * Twist about restDir is left untouched — this is a cone limit, which is the
 * correct shape for a neck or a shoulder and much better behaved than clamping
 * Euler angles (which gimbal-lock and produce discontinuous corrections).
 */
export function clampSwing(q: Quaternion, restDir: Vector3, maxAngle: number, out: Quaternion): Quaternion {
  _tmp.copy(restDir).applyQuaternion(q);
  const cosA = clamp(_tmp.dot(restDir), -1, 1);
  const angle = Math.acos(cosA);
  if (angle <= maxAngle) {
    return out.copy(q);
  }
  // Decompose: swing takes restDir onto its rotated image; twist is what's left.
  _tmp2.crossVectors(restDir, _tmp);
  if (_tmp2.lengthSq() < 1e-12) return out.copy(q);
  _tmp2.normalize();
  const excess = angle - maxAngle;
  // Rotate back about the swing axis by the excess.
  _qTmp.setFromAxisAngle(_tmp2, -excess);
  return out.multiplyQuaternions(_qTmp, q);
}

// ─────────────────────────────────────────────────────────────────────────────
// FABRIK chain — the spine
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Forward-and-backward reaching inverse kinematics over a point chain.
 *
 * Used for the spine, where a two-bone solve cannot express what we want: the
 * chest has to reach a target while the pelvis stays anchored to the bike and
 * the curve between them stays smooth. FABRIK gives exactly that, converges in
 * a handful of iterations, and — unlike CCD — distributes the correction along
 * the whole chain instead of dumping it into the last joint.
 *
 * `stiffness[i]` in 0..1 damps how far joint i is allowed to move per
 * iteration, which is how we make the lower back stiffer than the upper back.
 *
 * `points[0]` is the root; it is restored to `origin` on every backward pass.
 */
export function solveFabrik(
  points: Vector3[],
  lengths: number[],
  origin: Vector3,
  target: Vector3,
  stiffness: number[] | null,
  iterations = 4,
  tolerance = 2e-4,
): void {
  const n = points.length;
  if (n < 2) return;

  let total = 0;
  for (let i = 0; i < lengths.length; i++) total += lengths[i];

  _tmp.subVectors(target, origin);
  const dist = _tmp.length();

  // Out of reach: lay the chain straight at the target. No iteration needed and
  // no risk of the solver oscillating against an impossible constraint.
  if (dist > total) {
    if (dist < EPS) return;
    _tmp.divideScalar(dist);
    points[0].copy(origin);
    for (let i = 1; i < n; i++) {
      points[i].copy(points[i - 1]).addScaledVector(_tmp, lengths[i - 1]);
    }
    return;
  }

  for (let iter = 0; iter < iterations; iter++) {
    if (points[n - 1].distanceToSquared(target) < tolerance * tolerance) break;

    // Forward: pull the tip to the target, drag the rest along.
    points[n - 1].copy(target);
    for (let i = n - 2; i >= 0; i--) {
      _tmp.subVectors(points[i], points[i + 1]);
      const l = _tmp.length();
      if (l < EPS) continue;
      _tmp.multiplyScalar(lengths[i] / l);
      points[i].copy(points[i + 1]).add(_tmp);
    }

    // Backward: put the root back where it belongs and push outward.
    points[0].copy(origin);
    for (let i = 1; i < n; i++) {
      _tmp.subVectors(points[i], points[i - 1]);
      const l = _tmp.length();
      if (l < EPS) continue;
      _tmp.multiplyScalar(lengths[i - 1] / l);
      _tmp2.copy(points[i - 1]).add(_tmp);
      if (stiffness && stiffness[i - 1] > 0) {
        // Stiff joints move less toward the FABRIK solution each pass, which
        // biases the curvature toward the flexible end of the chain.
        points[i].lerp(_tmp2, 1 - clamp01(stiffness[i - 1]));
        // Re-project so segment lengths stay exact even after the damping.
        _tmp.subVectors(points[i], points[i - 1]);
        const l2 = _tmp.length();
        if (l2 > EPS) {
          _tmp.multiplyScalar(lengths[i - 1] / l2);
          points[i].copy(points[i - 1]).add(_tmp);
        }
      } else {
        points[i].copy(_tmp2);
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Small helpers used by the rig
// ─────────────────────────────────────────────────────────────────────────────

/** Project `v` onto the plane with unit normal `n`, in place. */
export function projectOnPlane(v: Vector3, n: Vector3): Vector3 {
  return v.addScaledVector(n, -v.dot(n));
}

/**
 * Frame-rate independent damping of a Vector3 toward a target, by half-life.
 * Mirrors MathX.dampHL so the whole project's smoothing behaves identically.
 */
export function dampVec3(current: Vector3, target: Vector3, halfLife: number, dt: number): Vector3 {
  if (halfLife <= 0) return current.copy(target);
  const k = Math.pow(2, -dt / halfLife);
  current.x = target.x + (current.x - target.x) * k;
  current.y = target.y + (current.y - target.y) * k;
  current.z = target.z + (current.z - target.z) * k;
  return current;
}

/** Frame-rate independent slerp toward a target rotation, by half-life. */
export function dampQuat(current: Quaternion, target: Quaternion, halfLife: number, dt: number): Quaternion {
  if (halfLife <= 0) return current.copy(target);
  return current.slerp(target, 1 - Math.pow(2, -dt / halfLife));
}
