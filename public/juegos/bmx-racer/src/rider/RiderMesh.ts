/**
 * RiderMesh — the rider's body and clothing, every vertex generated here.
 *
 * There are no imported models in this project, so the rider is lathes, lofted
 * elliptical tubes and box forms, merged per material and skinned to the bones
 * built in Skeleton.ts.
 *
 * The three things that make this read as a character rather than as a set of
 * primitives stuck together:
 *
 *  1. CROSS-SECTIONS ARE ELLIPSES, NOT CIRCLES. A torso is wide and shallow, a
 *     forearm is oval, a shin is flat at the front. Every loft here carries a
 *     separate half-width and half-depth per ring, and the ring's X axis is
 *     locked to the rig's X axis rather than to a Frenet frame, so nothing
 *     corkscrews and the silhouette stays deliberate from every angle.
 *
 *  2. WEIGHTS COME FROM DISTANCE TO BONE SEGMENTS, WITH AN EXPLICIT CANDIDATE
 *     SET PER PART. A global "nearest bone" pass puts helmet vertices on the
 *     clavicle and shorts vertices on the forearm the moment two parts pass
 *     close to each other. Every part here declares which bones it is allowed to
 *     be influenced by, and the Gaussian falloff over segment distance does the
 *     blending inside that set. That is what keeps the elbow and knee creases
 *     smooth while the helmet stays perfectly rigid on the skull.
 *
 *  3. PARTS ARE NOT NORMAL-WELDED TO EACH OTHER. Each part computes its own
 *     normals before merging, so a sleeve cuff against a bare arm shades as a
 *     hard edge — which is what a cel ramp needs to make clothing read as
 *     clothing. `finalizeGeometry` still welds POSITIONS for the outline hull,
 *     so the ink never tears at those same seams.
 *
 * Everything is authored in bind space, which is rig space with the skeleton at
 * rest — see Skeleton.ts.
 */

import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  Matrix4,
  Mesh,
  Quaternion,
  SkinnedMesh,
  SphereGeometry,
  Vector2,
  Vector3,
} from 'three';

import { CelMaterial, attachOutline, registerNprMesh, type CelOptions } from '../npr/CelMaterial';
import { finalizeGeometry } from '../npr/OutlineGeometry';
import { RAMPS, type RampPreset } from '../npr/Palette';
import { clamp01, lerp, smoothstep } from '../core/MathX';
import {
  BONE_INDEX,
  FOOT as F,
  REST,
  RIDER_DIMS as D,
  RiderSkeleton,
  restPos,
  type BoneName,
} from './Skeleton';

// ─────────────────────────────────────────────────────────────────────────────
// Small geometry kit
// ─────────────────────────────────────────────────────────────────────────────

const _m4 = new Matrix4();
const _q = new Quaternion();
const _vA = new Vector3();
const _vB = new Vector3();
const _vC = new Vector3();

const X_AXIS = new Vector3(1, 0, 0);

/** One cross-section of a loft: an ellipse in the plane spanned by ax/ay. */
interface LoftRing {
  c: Vector3;
  ax: Vector3;
  ay: Vector3;
  rx: number;
  ry: number;
}

function makeRing(c: Vector3, ax: Vector3, ay: Vector3, rx: number, ry: number): LoftRing {
  return { c: c.clone(), ax: ax.clone(), ay: ay.clone(), rx, ry };
}

/**
 * Build rings along a polyline with the ring X axis locked to `xRef`.
 *
 * Locking the reference rather than parallel-transporting is the right choice
 * for a biped: every limb axis here is far from ±X, so the projection is always
 * well conditioned, and the result is perfectly reproducible — the seam on a
 * sleeve is in the same place on both arms.
 */
function ringsAlongPath(
  path: Vector3[],
  rx: number[],
  ry: number[],
  xRef: Vector3 = X_AXIS,
): LoftRing[] {
  const n = path.length;
  const rings: LoftRing[] = [];
  for (let i = 0; i < n; i++) {
    const a = path[Math.max(0, i - 1)];
    const b = path[Math.min(n - 1, i + 1)];
    _vA.subVectors(b, a);
    if (_vA.lengthSq() < 1e-12) _vA.set(0, 1, 0);
    _vA.normalize();

    _vB.copy(xRef).addScaledVector(_vA, -xRef.dot(_vA));
    if (_vB.lengthSq() < 1e-10) _vB.set(0, 0, 1).addScaledVector(_vA, -_vA.z);
    _vB.normalize();
    _vC.crossVectors(_vA, _vB).normalize();

    rings.push(makeRing(path[i], _vB, _vC, rx[i], ry[i]));
  }
  return rings;
}

/** Append rounded cap rings at one or both ends of a ring list, in place. */
function roundCaps(rings: LoftRing[], startRounds: number, endRounds: number): LoftRing[] {
  const out: LoftRing[] = [];
  if (startRounds > 0 && rings.length >= 2) {
    const r0 = rings[0];
    _vA.subVectors(rings[0].c, rings[1].c).normalize(); // outward at the start
    for (let k = startRounds; k >= 1; k--) {
      const t = k / (startRounds + 0.35);
      const th = t * Math.PI * 0.5;
      const s = Math.cos(th);
      const push = Math.sin(th) * Math.max(r0.rx, r0.ry) * 0.85;
      out.push(
        makeRing(_vB.copy(r0.c).addScaledVector(_vA, push), r0.ax, r0.ay, r0.rx * s, r0.ry * s),
      );
    }
  }
  for (const r of rings) out.push(r);
  if (endRounds > 0 && rings.length >= 2) {
    const rn = rings[rings.length - 1];
    _vA.subVectors(rings[rings.length - 1].c, rings[rings.length - 2].c).normalize();
    for (let k = 1; k <= endRounds; k++) {
      const t = k / (endRounds + 0.35);
      const th = t * Math.PI * 0.5;
      const s = Math.cos(th);
      const push = Math.sin(th) * Math.max(rn.rx, rn.ry) * 0.85;
      out.push(
        makeRing(_vB.copy(rn.c).addScaledVector(_vA, push), rn.ax, rn.ay, rn.rx * s, rn.ry * s),
      );
    }
  }
  return out;
}

/** Triangulate a ring list into a closed (or capped) tube. */
function buildLoft(rings: LoftRing[], segs: number, capStart: boolean, capEnd: boolean): BufferGeometry {
  const rowCount = rings.length;
  const vertCount = rowCount * segs + (capStart ? 1 : 0) + (capEnd ? 1 : 0);
  const pos = new Float32Array(vertCount * 3);
  const uv = new Float32Array(vertCount * 2);
  const idx: number[] = [];

  let p = 0;
  let t = 0;
  for (let r = 0; r < rowCount; r++) {
    const ring = rings[r];
    const vCoord = r / Math.max(1, rowCount - 1);
    for (let s = 0; s < segs; s++) {
      const a = (s / segs) * Math.PI * 2;
      const cs = Math.cos(a);
      const sn = Math.sin(a);
      pos[p++] = ring.c.x + ring.ax.x * cs * ring.rx + ring.ay.x * sn * ring.ry;
      pos[p++] = ring.c.y + ring.ax.y * cs * ring.rx + ring.ay.y * sn * ring.ry;
      pos[p++] = ring.c.z + ring.ax.z * cs * ring.rx + ring.ay.z * sn * ring.ry;
      uv[t++] = s / segs;
      uv[t++] = vCoord;
    }
  }

  for (let r = 0; r < rowCount - 1; r++) {
    for (let s = 0; s < segs; s++) {
      const s2 = (s + 1) % segs;
      const a = r * segs + s;
      const b = r * segs + s2;
      const c = (r + 1) * segs + s2;
      const d = (r + 1) * segs + s;
      idx.push(a, b, c, a, c, d);
    }
  }

  let cursor = rowCount * segs;
  if (capStart) {
    const ring = rings[0];
    pos[p++] = ring.c.x;
    pos[p++] = ring.c.y;
    pos[p++] = ring.c.z;
    uv[t++] = 0.5;
    uv[t++] = 0;
    const centre = cursor++;
    for (let s = 0; s < segs; s++) {
      const s2 = (s + 1) % segs;
      idx.push(centre, s2, s);
    }
  }
  if (capEnd) {
    const ring = rings[rowCount - 1];
    pos[p++] = ring.c.x;
    pos[p++] = ring.c.y;
    pos[p++] = ring.c.z;
    uv[t++] = 0.5;
    uv[t++] = 1;
    const centre = cursor++;
    const base = (rowCount - 1) * segs;
    for (let s = 0; s < segs; s++) {
      const s2 = (s + 1) % segs;
      idx.push(centre, base + s, base + s2);
    }
  }

  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(pos, 3));
  geo.setAttribute('uv', new BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/** A lofted limb: path + radius profile, with optional rounded ends. */
function loftLimb(
  path: Vector3[],
  rx: number[],
  ry: number[],
  segs: number,
  startRounds = 0,
  endRounds = 0,
  xRef: Vector3 = X_AXIS,
): BufferGeometry {
  const rings = roundCaps(ringsAlongPath(path, rx, ry, xRef), startRounds, endRounds);
  return buildLoft(rings, segs, startRounds === 0, endRounds === 0);
}

/** An ellipsoid (or a dome, with `thetaLength` < π), placed and oriented. */
function sphereForm(
  centre: Vector3,
  rx: number,
  ry: number,
  rz: number,
  wSeg: number,
  hSeg: number,
  thetaLength = Math.PI,
  basis?: Matrix4,
): BufferGeometry {
  const g = new SphereGeometry(1, wSeg, hSeg, 0, Math.PI * 2, 0, thetaLength);
  _m4.makeScale(rx, ry, rz);
  g.applyMatrix4(_m4);
  if (basis) g.applyMatrix4(basis);
  _m4.makeTranslation(centre.x, centre.y, centre.z);
  g.applyMatrix4(_m4);
  return g;
}

/**
 * A revolved profile (x = radius, y = height), placed by `basis` then `origin`.
 * Built by hand rather than with LatheGeometry so the caller controls the ring
 * count independently of the profile resolution and gets UVs that run along the
 * profile — which is what the cel hatch expects.
 */
function latheForm(profile: Vector2[], segs: number, origin: Vector3, basis?: Matrix4): BufferGeometry {
  const rows = profile.length;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let r = 0; r < rows; r++) {
    for (let s = 0; s < segs; s++) {
      const a = (s / segs) * Math.PI * 2;
      pos.push(Math.cos(a) * profile[r].x, profile[r].y, Math.sin(a) * profile[r].x);
      uv.push(s / segs, r / Math.max(1, rows - 1));
    }
  }
  for (let r = 0; r < rows - 1; r++) {
    for (let s = 0; s < segs; s++) {
      const s2 = (s + 1) % segs;
      const a = r * segs + s;
      const b = r * segs + s2;
      const c = (r + 1) * segs + s2;
      const d = (r + 1) * segs + s;
      idx.push(a, b, c, a, c, d);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  if (basis) g.applyMatrix4(basis);
  _m4.makeTranslation(origin.x, origin.y, origin.z);
  g.applyMatrix4(_m4);
  return g;
}

/** A rounded box. Used for shoe soles, helmet vents, glove knuckles. */
function boxForm(
  w: number,
  h: number,
  d: number,
  centre: Vector3,
  rot?: Quaternion,
  bevel = 0.25,
): BufferGeometry {
  // Two stacked lofts give a chamfered box with far fewer verts than a real
  // bevel and a much better cel silhouette than a hard-edged cube.
  const hx = w * 0.5;
  const hy = h * 0.5;
  const hz = d * 0.5;
  const b = clamp01(bevel);
  const path = [
    new Vector3(0, -hy, 0),
    new Vector3(0, -hy * (1 - b * 0.5), 0),
    new Vector3(0, hy * (1 - b * 0.5), 0),
    new Vector3(0, hy, 0),
  ];
  const rxs = [hx * (1 - b), hx, hx, hx * (1 - b)];
  const rys = [hz * (1 - b), hz, hz, hz * (1 - b)];
  const rings = ringsAlongPath(path, rxs, rys, new Vector3(1, 0, 0));
  // Square the ellipse off: 8 segments with a superellipse push.
  const geo = buildLoft(rings, 8, true, true);
  const pos = geo.getAttribute('position') as BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    // Push each ring vertex out toward the box corner — a cheap superellipse.
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const m = Math.max(Math.abs(x) / (hx || 1), Math.abs(z) / (hz || 1));
    if (m > 1e-5) {
      const k = lerp(1, 1 / m, 0.55);
      pos.setX(i, x * k);
      pos.setZ(i, z * k);
    }
  }
  geo.computeVertexNormals();
  if (rot) {
    _m4.makeRotationFromQuaternion(rot);
    geo.applyMatrix4(_m4);
  }
  _m4.makeTranslation(centre.x, centre.y, centre.z);
  geo.applyMatrix4(_m4);
  return geo;
}

/** Orthonormal basis with +Y along `up` and +Z on the `zHint` side of it. */
function basisMatrix(up: Vector3, zHint: Vector3, out: Matrix4): Matrix4 {
  _vA.copy(up).normalize();
  _vC.copy(zHint).addScaledVector(_vA, -zHint.dot(_vA));
  if (_vC.lengthSq() < 1e-10) _vC.set(0, 0, 1);
  _vC.normalize();
  _vB.crossVectors(_vA, _vC).normalize(); // x
  return out.makeBasis(_vB, _vA, _vC);
}

/** Points on an ellipse around an axis frame — goggle straps, chin bars. */
function arcPath(
  centre: Vector3,
  basis: Matrix4,
  rx: number,
  rz: number,
  a0: number,
  a1: number,
  steps: number,
  yOffsetAt?: (t: number) => number,
): Vector3[] {
  const pts: Vector3[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const a = lerp(a0, a1, t);
    const p = new Vector3(Math.sin(a) * rx, yOffsetAt ? yOffsetAt(t) : 0, Math.cos(a) * rz);
    p.applyMatrix4(basis);
    p.add(centre);
    pts.push(p);
  }
  return pts;
}

// ─────────────────────────────────────────────────────────────────────────────
// Merge
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Merge parts that already carry position/normal/uv/skinIndex/skinWeight.
 * Written here rather than pulled from an addon so the project keeps its "no
 * dependency beyond three core" property.
 */
function mergeParts(list: BufferGeometry[]): BufferGeometry {
  let vtx = 0;
  let ind = 0;
  for (const g of list) {
    const p = g.getAttribute('position');
    vtx += p.count;
    const i = g.getIndex();
    ind += i ? i.count : p.count;
  }

  const pos = new Float32Array(vtx * 3);
  const nor = new Float32Array(vtx * 3);
  const uv = new Float32Array(vtx * 2);
  const si = new Uint16Array(vtx * 4);
  const sw = new Float32Array(vtx * 4);
  const index = new Uint32Array(ind);

  let vo = 0;
  let io = 0;
  for (const g of list) {
    const p = g.getAttribute('position') as BufferAttribute;
    const n = g.getAttribute('normal') as BufferAttribute;
    const t = g.getAttribute('uv') as BufferAttribute;
    const a = g.getAttribute('skinIndex') as BufferAttribute;
    const w = g.getAttribute('skinWeight') as BufferAttribute;
    const count = p.count;

    pos.set(p.array as Float32Array, vo * 3);
    nor.set(n.array as Float32Array, vo * 3);
    uv.set(t.array as Float32Array, vo * 2);
    si.set(a.array as Uint16Array, vo * 4);
    sw.set(w.array as Float32Array, vo * 4);

    const gi = g.getIndex();
    if (gi) {
      for (let k = 0; k < gi.count; k++) index[io + k] = gi.getX(k) + vo;
      io += gi.count;
    } else {
      for (let k = 0; k < count; k++) index[io + k] = k + vo;
      io += count;
    }
    vo += count;
  }

  const out = new BufferGeometry();
  out.setAttribute('position', new BufferAttribute(pos, 3));
  out.setAttribute('normal', new BufferAttribute(nor, 3));
  out.setAttribute('uv', new BufferAttribute(uv, 2));
  out.setAttribute('skinIndex', new BufferAttribute(si, 4));
  out.setAttribute('skinWeight', new BufferAttribute(sw, 4));
  out.setIndex(new BufferAttribute(index, 1));
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Skinning
// ─────────────────────────────────────────────────────────────────────────────

interface Binding {
  bone: BoneName;
  /** Segment the vertex distance is measured to. Defaults to the rest bone. */
  head?: Vector3;
  tail?: Vector3;
  /** Gaussian falloff radius, metres. Roughly the local limb radius. */
  falloff: number;
  /** Multiplier before normalisation. Lower = this bone yields to its neighbours. */
  bias?: number;
}

const _seg = new Vector3();
const _pv = new Vector3();

/** Squared distance from p to the segment [a,b]. */
function distToSegment(p: Vector3, a: Vector3, b: Vector3): number {
  _seg.subVectors(b, a);
  const len2 = _seg.lengthSq();
  if (len2 < 1e-12) return p.distanceTo(a);
  _pv.subVectors(p, a);
  const t = clamp01(_pv.dot(_seg) / len2);
  _pv.copy(a).addScaledVector(_seg, t);
  return p.distanceTo(_pv);
}

/** Resolve a binding's segment from the rest table when not given explicitly. */
function bindingSegment(b: Binding, outA: Vector3, outB: Vector3): void {
  const i = BONE_INDEX[b.bone];
  if (b.head) outA.copy(b.head);
  else outA.copy(REST.pos[i]);
  if (b.tail) outB.copy(b.tail);
  else outB.copy(REST.pos[i]).addScaledVector(REST.dir[i], Math.max(REST.length[i], 0.04));
}

const _segA = new Vector3();
const _segB = new Vector3();
const _vp = new Vector3();

/**
 * Compute four-bone skin weights for one part.
 *
 * The falloff is Gaussian in distance-to-segment, which gives a C¹ blend across
 * a joint: the weight of the parent decays exactly as fast as the child's grows,
 * so an elbow at 90° keeps its volume instead of pinching. Only the four
 * strongest bones survive, which is the hardware limit anyway.
 */
function skinPart(geo: BufferGeometry, bindings: Binding[]): BufferGeometry {
  const pos = geo.getAttribute('position') as BufferAttribute;
  const count = pos.count;
  const si = new Uint16Array(count * 4);
  const sw = new Float32Array(count * 4);

  const nb = bindings.length;
  const heads: Vector3[] = [];
  const tails: Vector3[] = [];
  for (const b of bindings) {
    const a = new Vector3();
    const t = new Vector3();
    bindingSegment(b, a, t);
    heads.push(a);
    tails.push(t);
  }

  const w = new Float64Array(nb);
  for (let v = 0; v < count; v++) {
    _vp.set(pos.getX(v), pos.getY(v), pos.getZ(v));

    let best = -1;
    let bestD = Infinity;
    for (let b = 0; b < nb; b++) {
      _segA.copy(heads[b]);
      _segB.copy(tails[b]);
      const d = distToSegment(_vp, _segA, _segB);
      if (d < bestD) {
        bestD = d;
        best = b;
      }
      const f = bindings[b].falloff;
      const x = d / f;
      w[b] = (bindings[b].bias ?? 1) * Math.exp(-x * x * 1.35);
    }

    // Top four.
    let i0 = -1;
    let i1 = -1;
    let i2 = -1;
    let i3 = -1;
    let w0 = 0;
    let w1 = 0;
    let w2 = 0;
    let w3 = 0;
    for (let b = 0; b < nb; b++) {
      const x = w[b];
      if (x > w0) {
        i3 = i2; w3 = w2; i2 = i1; w2 = w1; i1 = i0; w1 = w0; i0 = b; w0 = x;
      } else if (x > w1) {
        i3 = i2; w3 = w2; i2 = i1; w2 = w1; i1 = b; w1 = x;
      } else if (x > w2) {
        i3 = i2; w3 = w2; i2 = b; w2 = x;
      } else if (x > w3) {
        i3 = b; w3 = x;
      }
    }

    let sum = w0 + w1 + w2 + w3;
    if (sum < 1e-9) {
      // Everything underflowed — the vertex is far outside every falloff. Fall
      // back to hard-binding the nearest bone so it can never be left at the
      // origin, which is the classic "one stray vertex spike" artefact.
      i0 = best;
      w0 = 1;
      i1 = i2 = i3 = -1;
      w1 = w2 = w3 = 0;
      sum = 1;
    }
    const inv = 1 / sum;
    const o = v * 4;
    si[o] = i0 >= 0 ? BONE_INDEX[bindings[i0].bone] : 0;
    si[o + 1] = i1 >= 0 ? BONE_INDEX[bindings[i1].bone] : 0;
    si[o + 2] = i2 >= 0 ? BONE_INDEX[bindings[i2].bone] : 0;
    si[o + 3] = i3 >= 0 ? BONE_INDEX[bindings[i3].bone] : 0;
    sw[o] = w0 * inv;
    sw[o + 1] = w1 * inv;
    sw[o + 2] = w2 * inv;
    sw[o + 3] = w3 * inv;
  }

  geo.setAttribute('skinIndex', new BufferAttribute(si, 4));
  geo.setAttribute('skinWeight', new BufferAttribute(sw, 4));
  return geo;
}

/** Hard-bind a whole part to one bone. Helmets, lenses, shoes. */
function rigidPart(geo: BufferGeometry, bone: BoneName): BufferGeometry {
  const count = (geo.getAttribute('position') as BufferAttribute).count;
  const si = new Uint16Array(count * 4);
  const sw = new Float32Array(count * 4);
  const b = BONE_INDEX[bone];
  for (let v = 0; v < count; v++) {
    si[v * 4] = b;
    sw[v * 4] = 1;
  }
  geo.setAttribute('skinIndex', new BufferAttribute(si, 4));
  geo.setAttribute('skinWeight', new BufferAttribute(sw, 4));
  return geo;
}

// ─────────────────────────────────────────────────────────────────────────────
// The rider's parts
// ─────────────────────────────────────────────────────────────────────────────

/** Rest positions, pulled once so the builders read cleanly. */
const P = {
  pelvis: restPos('pelvis'),
  spine1: restPos('spine1'),
  spine2: restPos('spine2'),
  chest: restPos('chest'),
  neck: restPos('neck'),
  head: restPos('head'),
  headEnd: restPos('headEnd'),
  clavL: restPos('clavL'),
  clavR: restPos('clavR'),
  shoulderL: restPos('upperArmL'),
  shoulderR: restPos('upperArmR'),
  elbowL: restPos('forearmL'),
  elbowR: restPos('forearmR'),
  handL: restPos('handL'),
  handR: restPos('handR'),
  handEndL: restPos('handEndL'),
  handEndR: restPos('handEndR'),
  hipL: restPos('thighL'),
  hipR: restPos('thighR'),
  kneeL: restPos('shinL'),
  kneeR: restPos('shinR'),
  ankleL: restPos('footL'),
  ankleR: restPos('footR'),
  toeL: restPos('toeL'),
  toeR: restPos('toeR'),
  hem: restPos('hem'),
  shortsL: restPos('shortsL'),
  shortsR: restPos('shortsR'),
};

function mix(a: Vector3, b: Vector3, t: number): Vector3 {
  return new Vector3().lerpVectors(a, b, t);
}

function offset(a: Vector3, x: number, y: number, z: number): Vector3 {
  return new Vector3(a.x + x, a.y + y, a.z + z);
}

/** The head's own frame: +Y up the skull, +Z out of the face. */
const HEAD_BASIS = (() => {
  const up = new Vector3().subVectors(P.headEnd, P.head).normalize();
  return basisMatrix(up, new Vector3(0, 0, 1), new Matrix4());
})();
const HEAD_CENTRE = new Vector3().lerpVectors(P.head, P.headEnd, 0.40);

/** Head-local → rig space, as one matrix, for geometry deformed before placing. */
const _headPlace = new Matrix4()
  .makeTranslation(HEAD_CENTRE.x, HEAD_CENTRE.y, HEAD_CENTRE.z)
  .multiply(HEAD_BASIS);
const _ZERO3 = new Vector3();

// ── Skin ─────────────────────────────────────────────────────────────────────

/** Place a point given in HEAD-LOCAL coordinates into rig space. */
function head(x: number, y: number, z: number): Vector3 {
  return new Vector3(x, y, z).applyMatrix4(HEAD_BASIS).add(HEAD_CENTRE);
}

/**
 * The face.
 *
 * At a close crop the head is the only part of this rider a viewer looks at,
 * and a review called everything else in that frame publishable and the face
 * the one thing letting it down. Two rebuilds later, this is what the frames
 * actually taught:
 *
 *  1. ADDITIVE BLOBS EACH EARN THEIR OWN SILHOUETTE. A skull sphere plus a jaw
 *     sphere plus two cheeks plus a chin is six closed solids, and the inverted
 *     hull inks a stroke around every one of them. At 180 px that read as a
 *     bunch of grapes. So the skull, cheek, jaw and chin are ONE loft with a
 *     varying cross-section — one solid, one silhouette, one stroke.
 *
 *  2. BUT A LOFT ALONE IS A SNOUT. The first single-loft attempt tapered the
 *     half-width and the forward offset monotonically from the cheekbone to
 *     the chin, and a monotonic taper is a cone: measured off the mesh, the
 *     front profile ran 0.097 → 0.087 → 0.071 → 0.052 → 0.028 with no
 *     inflection anywhere. A face has TWO inflections in that profile and they
 *     are the entire read — the front surface must step BACK under the lip and
 *     then FORWARD again at the chin. Without them there is no mouth and no
 *     chin, only a muzzle, which is exactly what the captures showed.
 *
 *  3. WHAT IS VISIBLE IS ONLY THE LOWER FACE. The goggle lens occupies
 *     head-local y = -0.062 to +0.016 and stands proud at z = 0.137, so the
 *     brow, the orbits and the upper nose are all BEHIND it. Every millimetre
 *     of detail spent above y = -0.062 is spent on geometry no camera in this
 *     game can see. The face is therefore authored entirely in the 71 mm from
 *     the goggle's lower edge to the point of the jaw.
 *
 *  4. EVERY LINE HAS TO BE GEOMETRY. There are no textures in this project, so
 *     a mouth is not a drawn line — it is a step in the surface steep enough
 *     for the Sobel normal pass to ink (LINES.sobelNormalThreshold is 0.32,
 *     about 19 degrees). The mouth crease below swings the surface slope from
 *     6 degrees to 45 degrees across one row, and the chin swings it back the
 *     other way; both are far past the threshold, so both are inked.
 *
 *  5. IT MUST COST NOTHING SMALL. All of it is rigid-bound to the head bone
 *     and merged into the existing skin geometry, so it adds triangles and not
 *     a single draw call, material or bone. At 40 px the whole face is six
 *     pixels tall, every crease is sub-pixel, the Sobel has no gradient to find
 *     and the ramp has one band to give it — the detail costs nothing because
 *     at that size it stops existing.
 */
function buildFaceParts(): BufferGeometry[] {
  const parts: BufferGeometry[] = [];
  const add = (g: BufferGeometry): void => { parts.push(rigidPart(g, 'head')); };

  // Head-local axes in rig space, so the lofts below can be authored in the
  // head's own frame and still get a stable, non-corkscrewing ring basis.
  const localX = new Vector3(1, 0, 0).transformDirection(HEAD_BASIS);
  const localY = new Vector3(0, 1, 0).transformDirection(HEAD_BASIS);

  // ── The head: one loft, from crown to jaw ─────────────────────────────────
  //
  // rows: [y, halfWidth, halfDepth, forward offset]
  //
  // The column that matters is `offset + halfDepth` — the FRONT profile, which
  // is the drawing a viewer reads in three-quarter and in profile:
  //
  //     brow  -0.020  0.098
  //     cheek -0.054  0.092    widest half-width: the cheekbone terminator
  //     lip   -0.090  0.080    the muzzle holds forward
  //     mouth -0.099  0.071    ← steps BACK 9 mm in 9 mm of height
  //     chin  -0.107  0.075    ← steps FORWARD 4 mm again: this IS the chin
  //     jaw   -0.125  0.051
  //
  // The offsets themselves move at most 3 mm per row on purpose. `ringsAlongPath`
  // derives each ring's plane from the path tangent, so a large jump in the
  // offset tilts the ring hard enough to fold the surface; the profile shape is
  // carried by the half-depth instead, where it is free.
  const skull: [number, number, number, number][] = [
    [ 0.098, 0.028, 0.030, -0.010],
    [ 0.070, 0.060, 0.066, -0.008],
    [ 0.040, 0.079, 0.086, -0.004],
    [ 0.010, 0.088, 0.095, -0.001],
    [-0.020, 0.090, 0.097,  0.001],   // brow — behind the lens, sets its seat
    [-0.038, 0.088, 0.094,  0.002],   // eye line
    [-0.054, 0.084, 0.089,  0.003],   // cheekbone: the widest ring on the head
    [-0.070, 0.078, 0.081,  0.004],   // cheek falling toward the jaw
    [-0.081, 0.071, 0.074,  0.007],   // above the lip
    [-0.090, 0.065, 0.070,  0.010],   // upper lip level
    [-0.099, 0.060, 0.061,  0.010],   // mouth line — the concave crease
    [-0.107, 0.056, 0.062,  0.013],   // chin — convex again
    [-0.116, 0.048, 0.055,  0.013],
    [-0.125, 0.035, 0.041,  0.010],   // under the jaw
    [-0.133, 0.020, 0.024,  0.004],
  ];
  add(
    buildLoft(
      ringsAlongPath(
        skull.map((r) => head(0, r[0], r[3])),
        skull.map((r) => r[1]),
        skull.map((r) => r[2]),
        localX,
      ),
      22,
      true,
      true,
    ),
  );

  // Everything below is a SEPARATE solid and therefore earns its own stroke.
  // That is correct for a nose and for a pair of lips — an animator inks those
  // — and catastrophic for anything larger, which is why the cheeks, the jaw
  // and the chin are in the loft above and not here.

  // ── Nose ──────────────────────────────────────────────────────────────────
  // Starts tucked under the goggle's lower edge (y = -0.062) and runs to the
  // lip. Four rings: bridge, ball, and a flared base. Projects 24 mm past the
  // face at the tip, which is a stylised nose on a 230 mm head and reads at
  // a 60 px crop; a literal 15 mm one does not.
  add(
    buildLoft(
      ringsAlongPath(
        [head(0, -0.050, 0.084), head(0, -0.062, 0.091), head(0, -0.073, 0.093), head(0, -0.083, 0.086)],
        [0.007, 0.011, 0.015, 0.017],
        [0.009, 0.012, 0.014, 0.010],
        localX,
      ),
      10,
      true,
      true,
    ),
  );

  // ── Mouth ─────────────────────────────────────────────────────────────────
  // The loft already carries the mouth LINE as a 9 mm concave step. These two
  // give it width and a shape: a wide upper lip and a fuller lower one, with
  // the corners curling back into the cheek so the mark tapers instead of
  // ending square.
  //
  // THEY TOUCH, and that is the whole point. The first pass made them 12-17 mm
  // tall standing 7 mm proud with a gap between, and each one is a separate
  // closed solid, so the hull inked FOUR horizontal lines across the face and
  // the mouth read as a grille. Sunk to 9-11 mm tall standing 4 mm proud, with
  // their surfaces in contact, the two hulls merge into a single mark: one
  // stroke around the mouth and one line through it, which is how a mouth is
  // drawn. In profile they now sit on the muzzle instead of hanging off it.
  //
  // Ring X is head-local UP here, so the first radius is the lip's HEIGHT and
  // the second is how far it stands out from the face.
  const lipArc = (y: number, z: number, halfWidth: number, backCurl: number): Vector3[] => [
    head(-halfWidth, y - 0.004, z - backCurl),
    head(-halfWidth * 0.55, y - 0.001, z - backCurl * 0.28),
    head(0, y, z),
    head(halfWidth * 0.55, y - 0.001, z - backCurl * 0.28),
    head(halfWidth, y - 0.004, z - backCurl),
  ];
  add(
    loftLimb(
      lipArc(-0.0945, 0.0765, 0.026, 0.017),
      [0.0042, 0.0050, 0.0054, 0.0050, 0.0042],
      [0.0026, 0.0034, 0.0038, 0.0034, 0.0026],
      8, 1, 1, localY,
    ),
  );
  add(
    loftLimb(
      lipArc(-0.1045, 0.0745, 0.022, 0.014),
      [0.0046, 0.0056, 0.0060, 0.0056, 0.0046],
      [0.0030, 0.0038, 0.0044, 0.0038, 0.0030],
      8, 1, 1, localY,
    ),
  );

  return parts;
}

function buildSkinParts(): BufferGeometry[] {
  const parts: BufferGeometry[] = [];

  for (const p of buildFaceParts()) parts.push(p);

  // Neck.
  const neckPath = [offset(P.neck, 0, -0.030, -0.010), P.neck, mix(P.neck, P.head, 0.75)];
  parts.push(
    skinPart(
      loftLimb(neckPath, [D.neckRadius * 1.12, D.neckRadius, D.neckRadius * 0.94], [D.neckRadius * 1.18, D.neckRadius * 1.02, D.neckRadius * 0.96], 12),
      [
        { bone: 'chest', falloff: 0.075, bias: 0.7 },
        { bone: 'neck', falloff: 0.085 },
        { bone: 'head', falloff: 0.070, bias: 0.9 },
      ],
    ),
  );

  // Arms: bare from mid-upper-arm to the wrist.
  for (const side of [1, -1]) {
    const sh = side > 0 ? P.shoulderL : P.shoulderR;
    const el = side > 0 ? P.elbowL : P.elbowR;
    const wr = side > 0 ? P.handL : P.handR;
    const upper: BoneName = side > 0 ? 'upperArmL' : 'upperArmR';
    const fore: BoneName = side > 0 ? 'forearmL' : 'forearmR';
    const hand: BoneName = side > 0 ? 'handL' : 'handR';

    const path = [
      mix(sh, el, 0.46),
      mix(sh, el, 0.78),
      el,
      mix(el, wr, 0.30),
      mix(el, wr, 0.68),
      mix(el, wr, 0.95),
    ];
    const rx = [D.upperArmTop * 0.96, D.upperArmBottom * 1.04, D.upperArmBottom, D.forearmTop * 1.02, D.forearmTop * 0.82, D.forearmBottom];
    const ry = [D.upperArmTop * 0.90, D.upperArmBottom * 0.98, D.upperArmBottom * 0.96, D.forearmTop * 0.94, D.forearmTop * 0.78, D.forearmBottom * 0.94];
    parts.push(
      skinPart(loftLimb(path, rx, ry, 12, 1, 1), [
        { bone: upper, falloff: 0.095 },
        { bone: fore, falloff: 0.095 },
        { bone: hand, falloff: 0.045, bias: 0.8 },
      ]),
    );
  }

  // Thighs: hip to knee.
  //
  // These did not exist. The rider had a torso, two arms and two CALVES, and
  // between the shorts hem and the knee there was nothing at all — which is
  // most of why one leg read as "absent entirely" against the background and
  // the other as a floating shin. The shorts hide the top two thirds, but the
  // shorts are a separate material with its own outline, so without a thigh
  // inside them the leg reads as a detached block above a detached tube.
  //
  // Radii sit comfortably inside the shorts loft (0.121 → 0.108 half-width) so
  // nothing pokes through a baggy short at any knee angle.
  for (const side of [1, -1]) {
    const hp = side > 0 ? P.hipL : P.hipR;
    const kn = side > 0 ? P.kneeL : P.kneeR;
    const thigh: BoneName = side > 0 ? 'thighL' : 'thighR';
    const shin: BoneName = side > 0 ? 'shinL' : 'shinR';
    const path = [mix(hp, kn, 0.04), mix(hp, kn, 0.30), mix(hp, kn, 0.58), mix(hp, kn, 0.80), mix(hp, kn, 0.96)];
    const rx = [D.thighTop, D.thighTop * 0.96, D.thighBottom * 1.16, D.thighBottom * 1.02, D.thighBottom * 0.94];
    const ry = [D.thighTop * 1.04, D.thighTop * 1.00, D.thighBottom * 1.22, D.thighBottom * 1.08, D.thighBottom * 0.96];
    parts.push(
      skinPart(loftLimb(path, rx, ry, 12, 1, 0), [
        { bone: 'pelvis', falloff: 0.080, bias: 0.5 },
        { bone: thigh, falloff: 0.145 },
        { bone: shin, falloff: 0.075, bias: 0.7 },
      ]),
    );
  }

  // Calves: knee to the ankle.
  //
  // The old path stopped at 0.88 of the knee→ankle line with a ROUNDED CAP,
  // leaving a 5 cm gap between the end of the shin and the top of the shoe with
  // nothing but a thin collar spanning it. From behind, at speed, that is a leg
  // ending in a blunt rounded stub above the crank — which is exactly what the
  // review saw. It now runs to 0.99 and is cap-less, so the shin, the collar
  // and the shoe are one continuous limb.
  for (const side of [1, -1]) {
    const kn = side > 0 ? P.kneeL : P.kneeR;
    const an = side > 0 ? P.ankleL : P.ankleR;
    const shin: BoneName = side > 0 ? 'shinL' : 'shinR';
    const thigh: BoneName = side > 0 ? 'thighL' : 'thighR';
    const foot: BoneName = side > 0 ? 'footL' : 'footR';
    const path = [mix(kn, an, 0.04), mix(kn, an, 0.30), mix(kn, an, 0.60), mix(kn, an, 0.84), mix(kn, an, 0.99)];
    const rx = [D.shinTop * 1.04, D.shinTop * 0.94, D.shinBottom * 1.24, D.shinBottom * 1.02, D.shinBottom * 0.90];
    const ry = [D.shinTop * 1.10, D.shinTop * 0.98, D.shinBottom * 1.30, D.shinBottom * 1.06, D.shinBottom * 0.92];
    parts.push(
      skinPart(loftLimb(path, rx, ry, 12, 1, 0), [
        { bone: thigh, falloff: 0.070, bias: 0.6 },
        { bone: shin, falloff: 0.115 },
        { bone: foot, falloff: 0.055, bias: 0.7 },
      ]),
    );
  }

  return parts;
}

// ── Jersey ───────────────────────────────────────────────────────────────────

function buildJerseyParts(): BufferGeometry[] {
  const parts: BufferGeometry[] = [];
  const g = D.clothGap;

  // Torso. Rings follow the spine; the shoulder ring is the widest thing on the
  // rider and is what makes the silhouette read as "athlete on a bike" rather
  // than "cylinder".
  const shoulderMid = mix(P.clavL, P.clavR, 0.5);
  const path = [
    offset(P.hem, 0, -0.010, 0.010),
    mix(P.pelvis, P.spine1, 0.25),
    P.spine1,
    P.spine2,
    P.chest,
    mix(shoulderMid, P.neck, 0.55),
  ];
  const rx = [
    D.hipHalfWidth * 0.94 + g,
    D.hipHalfWidth + g,
    D.waistHalfWidth + g,
    D.waistHalfWidth * 1.12 + g,
    D.chestHalfWidth + g,
    D.chestHalfWidth * 0.68 + g,
  ];
  const ry = [
    D.hipDepth * 0.94 + g,
    D.hipDepth + g,
    D.waistDepth + g,
    D.waistDepth * 1.05 + g,
    D.chestDepth + g,
    D.chestDepth * 0.72 + g,
  ];
  parts.push(
    skinPart(loftLimb(path, rx, ry, 20, 0, 1), [
      { bone: 'hem', falloff: 0.085, bias: 0.85 },
      { bone: 'pelvis', falloff: 0.125 },
      { bone: 'spine1', falloff: 0.115 },
      { bone: 'spine2', falloff: 0.115 },
      { bone: 'chest', falloff: 0.135 },
      { bone: 'neck', falloff: 0.070, bias: 0.7 },
      { bone: 'clavL', falloff: 0.090, bias: 0.8 },
      { bone: 'clavR', falloff: 0.090, bias: 0.8 },
    ]),
  );

  // Deltoid + sleeve, as ONE loft.
  //
  // This used to be a 78 mm sphere sitting on top of a 74 mm tube. Two closed
  // surfaces overlapping at a step, each computing its own normals and each
  // getting its own inverted hull, which is why the shoulder read as an armour
  // ball with a hard sleeve seam cut across it — the ink was drawing a silhouette
  // edge where two separate solids intersected, not where the character has an
  // edge.
  //
  // One continuous loft cannot have that seam. It starts inboard and above the
  // shoulder joint (rounded into the torso), swells through the deltoid, and
  // tapers down the upper arm to a cuff — which is the actual shape of a jersey
  // sleeve over a deltoid, and it reads as one form under a hard cel ramp.
  for (const side of [1, -1]) {
    const sh = side > 0 ? P.shoulderL : P.shoulderR;
    const el = side > 0 ? P.elbowL : P.elbowR;
    const clav: BoneName = side > 0 ? 'clavL' : 'clavR';
    const upper: BoneName = side > 0 ? 'upperArmL' : 'upperArmR';

    const sleeve = [
      offset(sh, -side * 0.026, 0.034, -0.004),
      offset(sh, side * 0.002, 0.010, 0),
      mix(sh, el, 0.20),
      mix(sh, el, 0.38),
      mix(sh, el, 0.54),
    ];
    const srx = [
      D.upperArmTop * 1.16,
      D.upperArmTop * 1.46,
      D.upperArmTop * 1.31,
      D.upperArmTop * 1.20,
      D.upperArmTop * 1.13,
    ];
    const sry = [
      D.upperArmTop * 1.18,
      D.upperArmTop * 1.44,
      D.upperArmTop * 1.27,
      D.upperArmTop * 1.16,
      D.upperArmTop * 1.09,
    ];
    parts.push(
      skinPart(loftLimb(sleeve, srx, sry, 14, 2, 0), [
        { bone: clav, falloff: 0.090, bias: 0.55 },
        { bone: upper, falloff: 0.135 },
        { bone: 'chest', falloff: 0.085, bias: 0.45 },
      ]),
    );
  }

  // Collar.
  const collarPath = [mix(P.chest, P.neck, 0.72), mix(P.chest, P.neck, 1.02)];
  parts.push(
    skinPart(
      loftLimb(collarPath, [D.neckRadius * 1.50, D.neckRadius * 1.36], [D.neckRadius * 1.56, D.neckRadius * 1.40], 14),
      [
        { bone: 'chest', falloff: 0.085 },
        { bone: 'neck', falloff: 0.075 },
      ],
    ),
  );

  return parts;
}

// ── Shorts ───────────────────────────────────────────────────────────────────

function buildClothParts(): BufferGeometry[] {
  const parts: BufferGeometry[] = [];
  const g = D.clothGap;

  // Seat / waistband.
  //
  // The old version was three rings all at full hip size over a 13 cm run: a
  // 37 cm wide, 29 cm deep barrel with parallel sides. Side-on that is a
  // rectangular block hanging off the rider, which is precisely why a stills
  // review called it "a detached rectangular slab that reads as a pannier".
  //
  // Real shorts are narrow at the waist, widest across the seat, and then tuck
  // UNDER toward the saddle — five rings with a proper taper at both ends, and
  // 20% less depth so the profile is a hip rather than a box.
  const seatPath = [
    offset(P.pelvis, 0, 0.098, 0.016),
    offset(P.pelvis, 0, 0.052, 0.010),
    P.pelvis,
    offset(P.pelvis, 0, -0.046, -0.014),
    offset(P.pelvis, 0, -0.082, -0.030),
  ];
  parts.push(
    skinPart(
      loftLimb(
        seatPath,
        [
          D.waistHalfWidth * 1.02 + g,
          D.hipHalfWidth * 0.94 + g * 1.4,
          D.hipHalfWidth + g * 1.6,
          D.hipHalfWidth * 0.93 + g * 1.4,
          D.hipHalfWidth * 0.74 + g,
        ],
        [
          D.waistDepth * 1.00 + g,
          D.hipDepth * 0.90 + g * 1.2,
          D.hipDepth * 0.94 + g * 1.3,
          D.hipDepth * 0.84 + g * 1.1,
          D.hipDepth * 0.62 + g,
        ],
        18,
        0,
        1,
      ),
      [
        { bone: 'pelvis', falloff: 0.150 },
        { bone: 'spine1', falloff: 0.100, bias: 0.6 },
        { bone: 'thighL', falloff: 0.110, bias: 0.7 },
        { bone: 'thighR', falloff: 0.110, bias: 0.7 },
      ],
    ),
  );

  // Legs of the shorts — baggy, ending just above the knee, with the hem bone
  // owning the last two rings so it can flap. The waistband end now starts
  // INSIDE the seat form and tapers, so the two read as one garment instead of
  // a tube socketed into a block; and the widest point has moved down the thigh
  // to where a short actually flares.
  for (const side of [1, -1]) {
    const hip = side > 0 ? P.hipL : P.hipR;
    const knee = side > 0 ? P.kneeL : P.kneeR;
    const thigh: BoneName = side > 0 ? 'thighL' : 'thighR';
    const hem: BoneName = side > 0 ? 'shortsL' : 'shortsR';
    const path = [
      mix(hip, knee, -0.02),
      mix(hip, knee, 0.24),
      mix(hip, knee, 0.50),
      mix(hip, knee, 0.68),
      mix(hip, knee, 0.755),
    ];
    const rx = [
      D.thighTop * 1.04 + g,
      D.thighTop * 1.12 + g,
      D.thighBottom * 1.44 + g,
      D.thighBottom * 1.56 + g,
      D.thighBottom * 1.38 + g,
    ];
    const ry = [
      D.thighTop * 1.00 + g,
      D.thighTop * 1.10 + g,
      D.thighBottom * 1.42 + g,
      D.thighBottom * 1.60 + g,
      D.thighBottom * 1.40 + g,
    ];
    parts.push(
      skinPart(loftLimb(path, rx, ry, 16, 0, 0), [
        { bone: 'pelvis', falloff: 0.100, bias: 0.7 },
        { bone: thigh, falloff: 0.150 },
        { bone: hem, falloff: 0.105, bias: 1.25 },
      ]),
    );
  }

  return parts;
}

// ── Rubber: gloves, shoes, straps, pads ──────────────────────────────────────

function buildRubberParts(): BufferGeometry[] {
  const parts: BufferGeometry[] = [];

  for (const side of [1, -1]) {
    const wrist = side > 0 ? P.handL : P.handR;
    const tip = side > 0 ? P.handEndL : P.handEndR;
    const elbow = side > 0 ? P.elbowL : P.elbowR;
    const hand: BoneName = side > 0 ? 'handL' : 'handR';
    const fore: BoneName = side > 0 ? 'forearmL' : 'forearmR';

    // The glove is a closed fist around the bar: a fat ellipsoid straddling the
    // grip axis, four knuckle blocks on top, and a cuff that blends onto the
    // forearm so the wrist does not shear when the bars turn.
    const barDir = new Vector3().subVectors(tip, wrist).normalize();
    const gripUp = new Vector3(0, 1, 0).addScaledVector(barDir, -barDir.y).normalize();
    const gripFwd = new Vector3().crossVectors(barDir, gripUp).normalize();

    const palm = new Vector3().copy(wrist).addScaledVector(barDir, side * 0.004);
    const gloveBasis = new Matrix4().makeBasis(barDir, gripUp, gripFwd);
    parts.push(rigidPart(sphereForm(palm, 0.062, 0.055, 0.050, 12, 10, Math.PI, gloveBasis), hand));

    for (let k = 0; k < 3; k++) {
      const along = (k - 1) * 0.030;
      const knuckle = new Vector3()
        .copy(palm)
        .addScaledVector(barDir, along)
        .addScaledVector(gripUp, 0.030)
        .addScaledVector(gripFwd, 0.014);
      _q.setFromRotationMatrix(gloveBasis);
      parts.push(rigidPart(boxForm(0.026, 0.020, 0.044, knuckle, _q.clone(), 0.4), hand));
    }

    // Fingers.
    //
    // The glove was an ellipsoid with three knuckle blocks on top and nothing
    // below — a fist, with no indication that anything was wrapped around the
    // bar. Four tapered digits curling from the knuckle line down the FRONT of
    // the grip and back underneath give the hand a grip read at close range,
    // and in silhouette they break the ball into something with structure.
    //
    // Each finger is a three-point arc: knuckle → front of the bar → tucked
    // under it. The curl angle increases from the index finger to the little
    // finger, which is what a hand on a bar actually does and what stops the
    // four reading as a comb.
    for (let k = 0; k < 4; k++) {
      const along = (k - 1.5) * 0.026;
      const curl = 1 + k * 0.10;
      const root = new Vector3()
        .copy(palm)
        .addScaledVector(barDir, along)
        .addScaledVector(gripUp, 0.024)
        .addScaledVector(gripFwd, 0.030);
      const mid = new Vector3()
        .copy(palm)
        .addScaledVector(barDir, along)
        .addScaledVector(gripUp, -0.008 * curl)
        .addScaledVector(gripFwd, 0.052 * curl);
      const tip = new Vector3()
        .copy(palm)
        .addScaledVector(barDir, along * 0.94)
        .addScaledVector(gripUp, -0.044 * curl)
        .addScaledVector(gripFwd, 0.028 * curl);
      const r0 = 0.0115 - k * 0.0008;
      parts.push(
        rigidPart(
          loftLimb(
            [root, mid, tip],
            [r0, r0 * 0.94, r0 * 0.80],
            [r0 * 1.05, r0 * 0.96, r0 * 0.82],
            6,
            0,
            1,
            barDir,
          ),
          hand,
        ),
      );
    }
    // Thumb, over the top of the bar and inboard.
    const thumbRoot = new Vector3()
      .copy(palm)
      .addScaledVector(barDir, -side * 0.038)
      .addScaledVector(gripUp, 0.016)
      .addScaledVector(gripFwd, 0.020);
    const thumbTip = new Vector3()
      .copy(palm)
      .addScaledVector(barDir, -side * 0.052)
      .addScaledVector(gripUp, -0.020)
      .addScaledVector(gripFwd, 0.044);
    parts.push(
      rigidPart(loftLimb([thumbRoot, thumbTip], [0.014, 0.011], [0.015, 0.011], 6, 0, 1, gripUp), hand),
    );

    const cuffA = new Vector3().copy(wrist).addScaledVector(new Vector3().subVectors(elbow, wrist).normalize(), 0.060);
    const cuffB = new Vector3().copy(wrist).addScaledVector(new Vector3().subVectors(elbow, wrist).normalize(), 0.014);
    parts.push(
      skinPart(loftLimb([cuffA, cuffB], [D.forearmBottom * 1.30, D.forearmBottom * 1.42], [D.forearmBottom * 1.26, D.forearmBottom * 1.38], 12), [
        { bone: fore, falloff: 0.070 },
        { bone: hand, falloff: 0.070 },
      ]),
    );
  }

  // ── Shoes ────────────────────────────────────────────────────────────────
  //
  // Authored in the foot's own REST frame — origin at the ankle, +Z at the toe,
  // sole flat and horizontal — rather than along the ankle→toe bone vector.
  //
  // That distinction is the whole fix. The old shoe was lofted along the bone
  // direction, which at rest ran 22° into the ground, so the sole was a tilted
  // rocker whose lowest point sat 102 mm below the ankle and 46 mm in front of
  // it. The ankle was 72 mm above the pedal spindle. The sole therefore passed
  // 30 mm THROUGH the pedal, in front of it, at an angle — a shoe pointed at
  // the dirt with nothing under it, on every frame of every sequence, while the
  // ankle JOINT measured a perfect 72 mm from its anchor.
  //
  // Now the sole is a flat plane at exactly `FOOT.soleDrop` below the ankle and
  // `LIMB.ankleLift` puts the ankle exactly `FOOT.platform` above that plane's
  // spindle, so the shoe stands ON the pedal by construction and there is no
  // number left to get wrong.
  for (const side of [1, -1]) {
    const ankle = side > 0 ? P.ankleL : P.ankleR;
    const foot: BoneName = side > 0 ? 'footL' : 'footR';
    const toeB: BoneName = side > 0 ? 'toeL' : 'toeR';
    const shinB: BoneName = side > 0 ? 'shinL' : 'shinR';
    /** Point in the foot's rest frame. */
    const f = (y: number, z: number): Vector3 => offset(ankle, 0, y, z);

    const W = D.shoeWidth; // half-width at the widest point
    const SOLE_Y = -F.soleDrop; // underside of the sole
    const UPPER_Y = SOLE_Y + 0.014; // where the sole slab meets the upper

    // Upper: one loft from the heel counter to the toe box. The half-heights
    // are chosen so the bottom of every ring lands on UPPER_Y, which is what
    // gives the shoe a straight bottom edge in profile instead of a belly.
    const upper: [number, number, number, number][] = [
      // z,      centre y,            halfWidth,  halfHeight
      [-F.heelBack + 0.008, UPPER_Y + 0.044, W * 0.80, 0.044],
      [-0.030, UPPER_Y + 0.048, W * 0.90, 0.048],
      [0.022, UPPER_Y + 0.040, W * 0.99, 0.040],
      [F.ballAhead, UPPER_Y + 0.030, W * 1.00, 0.030],
      [0.126, UPPER_Y + 0.024, W * 0.92, 0.024],
      [F.toeAhead - 0.012, UPPER_Y + 0.017, W * 0.66, 0.017],
    ];
    parts.push(
      skinPart(
        loftLimb(
          upper.map((r) => f(r[1], r[0])),
          upper.map((r) => r[2]),
          upper.map((r) => r[3]),
          12,
          1,
          1,
        ),
        [
          { bone: foot, falloff: 0.130 },
          { bone: toeB, falloff: 0.110 },
          { bone: shinB, falloff: 0.055, bias: 0.5 },
        ],
      ),
    );

    // Sole slab — the flat that sits on the pedal and catches the key light.
    // Dead level from heel to ball, with a small toe kick so the front does not
    // read as a plank; the flat section is what the pedal platform meets.
    const soleY = SOLE_Y + 0.007;
    const sole: [number, number, number][] = [
      [-F.heelBack, soleY, W * 0.82],
      [-0.024, soleY, W * 0.94],
      [0.040, soleY, W * 1.02],
      [F.ballAhead + 0.020, soleY, W * 0.99],
      [F.toeAhead, soleY + 0.006, W * 0.68],
    ];
    parts.push(
      skinPart(
        loftLimb(
          sole.map((r) => f(r[1], r[0])),
          sole.map((r) => r[2]),
          sole.map(() => 0.007),
          10,
          1,
          1,
        ),
        [
          { bone: foot, falloff: 0.130 },
          { bone: toeB, falloff: 0.110 },
        ],
      ),
    );

    // Instep strap. Three millimetres proud of the upper, across the ball —
    // this is the detail that says "flat pedal shoe" and it also gives the
    // Sobel a crease exactly where the foot flexes.
    parts.push(
      skinPart(
        loftLimb(
          [
            offset(ankle, side * -W * 0.86, UPPER_Y + 0.026, 0.048),
            offset(ankle, 0, UPPER_Y + 0.050, 0.052),
            offset(ankle, side * W * 0.86, UPPER_Y + 0.026, 0.048),
          ],
          [0.013, 0.014, 0.013],
          [0.006, 0.006, 0.006],
          6,
          0,
          0,
          new Vector3(0, 0, 1),
        ),
        [{ bone: foot, falloff: 0.120 }],
      ),
    );

    // Ankle collar, padded, sitting on top of the heel counter.
    parts.push(
      skinPart(
        loftLimb(
          [f(0.004, -0.014), f(0.050, -0.020)],
          [D.shinBottom * 1.32, D.shinBottom * 1.24],
          [D.shinBottom * 1.36, D.shinBottom * 1.26],
          10,
        ),
        [
          { bone: foot, falloff: 0.080 },
          { bone: shinB, falloff: 0.080 },
        ],
      ),
    );
  }

  // Knee pads.
  for (const side of [1, -1]) {
    const knee = side > 0 ? P.kneeL : P.kneeR;
    const hip = side > 0 ? P.hipL : P.hipR;
    const ankle = side > 0 ? P.ankleL : P.ankleR;
    const up = new Vector3().subVectors(hip, knee).normalize();
    const fwd = new Vector3().subVectors(knee, mix(hip, ankle, 0.5)).normalize();
    const b = basisMatrix(up, fwd, new Matrix4());
    parts.push(
      skinPart(sphereForm(new Vector3().copy(knee).addScaledVector(fwd, 0.018), 0.070, 0.088, 0.072, 12, 10, Math.PI, b), [
        { bone: side > 0 ? 'thighL' : 'thighR', falloff: 0.110 },
        { bone: side > 0 ? 'shinL' : 'shinR', falloff: 0.110 },
      ]),
    );
  }

  // ── Goggle strap ──────────────────────────────────────────────────────────
  //
  // TWO SHORT SIDE RUNS, NOT A BAND AROUND THE OCCIPUT.
  //
  // This was one 290° arc at helmet radius, 40 mm tall and 18 mm proud, so from
  // behind the rider wore a horizontal black bar straight across the back of
  // his skull. Under the inverted hull that bar inks as a long crescent, and a
  // crescent under the ring the occipital scoop was also drawing is a MOUTH
  // under an EYE: at anything past ~120 px the back of the helmet read as a
  // face looking at the camera. A 6x crop of `switchback` f0070 was
  // unmistakable — concentric ring, crescent, two side clips.
  //
  // A real strap disappears under the shell. So it runs from the outer edge of
  // the goggle back to the ear cup on each side and stops: nothing crosses the
  // occiput, and the back of the lid is one uninterrupted surface with one
  // silhouette, which is the only thing that cannot be read as a face.
  const strapCentre = new Vector3(0, -0.030, 0).applyMatrix4(HEAD_BASIS).add(HEAD_CENTRE);
  for (const side of [1, -1]) {
    const a0 = side * 1.02;
    const a1 = side * 2.05;
    const run = arcPath(
      strapCentre,
      HEAD_BASIS,
      D.helmetRadius * 0.995,
      D.helmetRadius * 1.01,
      a0,
      a1,
      8,
      (t) => -0.004 * t,
    );
    parts.push(
      rigidPart(
        loftLimb(run, run.map(() => 0.016), run.map(() => 0.0055), 6, 1, 1, new Vector3(0, 1, 0)),
        'head',
      ),
    );
  }

  return parts;
}

// ── Helmet ───────────────────────────────────────────────────────────────────

function buildHelmetParts(): BufferGeometry[] {
  const parts: BufferGeometry[] = [];
  const R = D.helmetRadius;

  // Shell: a revolved profile rather than a squashed sphere, because the shape
  // that reads as a helmet is the tuck under the brow line and the flat over the
  // crown — neither of which a sphere has. Scaled slightly long in Z inside the
  // head's own frame so the lid is egg-shaped, not round.
  const shellProfile: Vector2[] = [
    new Vector2(0.0, R * 1.03),
    new Vector2(R * 0.30, R * 1.00),
    new Vector2(R * 0.58, R * 0.90),
    new Vector2(R * 0.80, R * 0.72),
    new Vector2(R * 0.94, R * 0.46),
    new Vector2(R * 1.00, R * 0.14),
    new Vector2(R * 0.99, R * -0.20),
    new Vector2(R * 0.93, R * -0.46),
    new Vector2(R * 0.86, R * -0.60),
  ];

  // ── The occiput is part of the shell, not a second solid ──────────────────
  //
  // There used to be a separate hemisphere sitting on the back of the head to
  // make the occipital bulge. Every closed solid earns its own stroke from the
  // inverted hull, and that one protruded 24 mm past the shell, so what it drew
  // was a hard CONCENTRIC RING on the back of the helmet — which, with the
  // shading band inside it, is an eye. Six-times crops of `switchback` f0070
  // showed a rider apparently looking backwards at the camera for 667 ms.
  //
  // The bulge is now a deformation of the shell's own vertices: the rear of the
  // lathe is pushed back and its skirt dropped over the occiput, so the lid is
  // ONE solid with ONE silhouette and there is no interior edge to ink. The
  // deformation is applied in the head's local frame before the basis, because
  // "back" and "down" only mean anything there.
  // ── ...and the occiput carries HARDWARE, because a dome cannot ────────────
  //
  // Removing the second solid killed the concentric ring, and the back of the
  // helmet still read as a face — because what was left was a smooth dome, and
  // a smooth dome is the one surface on which every shading iso-contour closes
  // into a CIRCLE. The helmet material draws a contour around its highlight
  // (`specInk`) and `bandedSpecular` steps at the same place; on a sphere both
  // trace a circle of constant N·H, so the lid wore a hard-edged bright oval
  // with a stroke round it. Isolated on `rider-closeup` from az 180: the oval
  // survives `lineOpacity = 0`, survives hiding every inverted hull, and
  // disappears the moment the helmet mesh itself is hidden. It is not ink. It
  // is the shading of a blank sphere, and no exponent makes a circle not a
  // circle.
  //
  // So the occiput gets what a real lid has: a raised centre spine with an
  // exhaust channel either side of it. Three things follow. The iso-contours
  // are cut, so nothing closes into an oval. The centre spine puts a vertical
  // mark down the midline, and a midline mark is the most anti-facial shape
  // there is — a face is bilateral about exactly that axis. And the back of the
  // helmet finally looks like equipment rather than a painted scalp.
  //
  // All of it is a DEFORMATION OF THE SHELL'S OWN VERTICES. Modelling vents as
  // separate solids would earn each one its own inverted-hull stroke, and two
  // symmetric outlined blobs on the back of a head is a worse face than the one
  // being fixed. 44 segments rather than 20 because the spine is 7.5 degrees
  // wide and 18-degree segments cannot resolve it.
  const shell = latheForm(shellProfile, 44, _ZERO3);
  {
    const pos = shell.getAttribute('position') as BufferAttribute;
    /** Centre of the shell mass — the direction to push a surface feature. */
    const cy = R * 0.15;
    for (let i = 0; i < pos.count; i++) {
      const x0 = pos.getX(i);
      const y0 = pos.getY(i);
      const z0 = pos.getZ(i);

      // Occipital bulge: the rear of the lathe pushed back and its skirt
      // dropped over the occiput. `smoothstep` on both masks rather than the
      // raw `clamp01` they used to be — a clamp is C0, and its slope step at
      // y = 0.70R was itself a crease running round the back of the lid.
      const back = smoothstep(0, 1, clamp01(-z0 / R));
      const low = smoothstep(0, 1, clamp01(1 - y0 / (R * 0.70)));
      let x = x0 * 0.965;
      let z = z0 * 1.10 - back * 0.010;
      let y = y0 - back * back * low * 0.034;

      // Spine and channels. `u` is the lateral position across the shell in
      // radii; the ridge sits on the midline and the two channels flank it.
      const u = x / R;
      const ridge = Math.exp(-((u / 0.135) ** 2));
      const groove = Math.exp(-(((Math.abs(u) - 0.30) / 0.135) ** 2));
      // Only on the back, and not into the crown pole or down onto the skirt,
      // where the feature would break the silhouette instead of marking the
      // surface.
      const h = y / R;
      const vmask = smoothstep(-0.54, -0.20, h) * (1 - smoothstep(0.44, 0.86, h));
      const amount = (ridge * 0.0095 - groove * 0.0078) * back * back * vmask;
      if (amount !== 0) {
        _vA.set(x, y - cy, z);
        const len = _vA.length();
        if (len > 1e-6) {
          _vA.multiplyScalar(amount / len);
          x += _vA.x;
          y += _vA.y;
          z += _vA.z;
        }
      }

      pos.setX(i, x);
      pos.setY(i, y);
      pos.setZ(i, z);
    }
    shell.computeVertexNormals();
    shell.applyMatrix4(_headPlace);
  }
  parts.push(rigidPart(shell, 'head'));

  // ── Ear cup + retention strap ─────────────────────────────────────────────
  //
  // This was two spheres. A sphere sitting on the side of a head is a closed
  // solid whose silhouette the inverted hull inks in full, so at a close crop
  // the rider wore two outlined brown BALLS over his ears — the single loudest
  // defect in the head, and the same "additive blobs each earn their own
  // stroke" failure the face itself was rebuilt to escape.
  //
  // A helmet does not have a ball over the ear. It has a cup that follows the
  // skull and a strap that runs from that cup down under the jaw, and that
  // strap is the detail that makes a lid read as a HELMET rather than as a
  // painted scalp. So the pad and the strap are ONE loft per side, running from
  // under the shell edge, around the ear, down to the chin — one solid, one
  // silhouette, and a genuinely helmet-shaped one.
  //
  // The ring's X axis is head-local X, so the FIRST radius is how far the form
  // stands out sideways from the skull (thin — this is a pad, not a ball) and
  // the second is its fore-and-aft extent (wide, so it covers an ear).
  for (const side of [1, -1]) {
    const localX = new Vector3(1, 0, 0).transformDirection(HEAD_BASIS);
    const s = side;
    const cup = [
      head(s * 0.082, -0.036, -0.028),
      head(s * 0.086, -0.064, -0.024),
      head(s * 0.081, -0.092, -0.014),
      head(s * 0.068, -0.118,  0.008),
      head(s * 0.046, -0.138,  0.030),
      head(s * 0.014, -0.147,  0.048),
    ];
    parts.push(
      rigidPart(
        loftLimb(
          cup,
          [0.013, 0.016, 0.012, 0.0080, 0.0060, 0.0045],
          [0.036, 0.040, 0.028, 0.0150, 0.0110, 0.0085],
          10,
          1,
          1,
          localX,
        ),
        'head',
      ),
    );
  }

  // Buckle. Two straps that stop 28 mm apart under the chin read as two loose
  // ends dangling; one small block joining them reads as a fastened helmet, and
  // it is the mark that tells the eye the straps are a SYSTEM rather than two
  // decorations. 18 mm across — one pixel at race distance, a deliberate
  // punctuation mark at a close crop.
  parts.push(
    rigidPart(
      boxForm(0.018, 0.011, 0.013, head(0, -0.148, 0.049), _q.setFromRotationMatrix(HEAD_BASIS), 0.35),
      'head',
    ),
  );

  // Peak / visor: a swept plate tilted down over the goggles.
  const peakCentre = new Vector3(0, 0.044, 0.014).applyMatrix4(HEAD_BASIS).add(HEAD_CENTRE);
  const peak = arcPath(peakCentre, HEAD_BASIS, R * 0.86, R * 1.42, -1.22, 1.22, 14, (t) => -Math.sin(t * Math.PI) * 0.036);
  parts.push(
    rigidPart(
      loftLimb(
        peak,
        // Ring X is world-up here, so the first radius is the visor's THICKNESS
        // and the second is how far it reaches fore-and-aft. A peak that is
        // thick and narrow reads as a rod stuck to the lid; this reads as a plate.
        peak.map(() => 0.0055),
        peak.map((_, i, arr) => lerp(0.020, 0.042, Math.sin((i / (arr.length - 1)) * Math.PI))),
        6,
        0,
        0,
        new Vector3(0, 1, 0),
      ),
      'head',
    ),
  );

  // Two vent ridges over the crown — they catch a band edge and stop the shell
  // reading as one undifferentiated blob under a hard ramp.
  for (const side of [1, -1]) {
    const v0 = new Vector3(side * 0.038, 0.082, -0.036).applyMatrix4(HEAD_BASIS).add(HEAD_CENTRE);
    const v1 = new Vector3(side * 0.048, 0.058, 0.048).applyMatrix4(HEAD_BASIS).add(HEAD_CENTRE);
    parts.push(rigidPart(loftLimb([v0, v1], [0.011, 0.010], [0.006, 0.005], 6, 1, 1), 'head'));
  }

  return parts;
}

// ── Goggle lens ──────────────────────────────────────────────────────────────

function buildLensParts(): BufferGeometry[] {
  const parts: BufferGeometry[] = [];
  const R = D.helmetRadius;
  const centre = new Vector3(0, -0.028, -0.004).applyMatrix4(HEAD_BASIS).add(HEAD_CENTRE);
  const arc = arcPath(centre, HEAD_BASIS, R * 0.88, R * 1.06, -1.16, 1.16, 14, (t) => Math.sin(t * Math.PI) * 0.010);
  parts.push(
    rigidPart(
      loftLimb(
        arc,
        arc.map((_, i, a2) => lerp(0.024, 0.034, Math.sin((i / (a2.length - 1)) * Math.PI))),
        arc.map(() => 0.012),
        6,
        0,
        0,
        new Vector3(0, 1, 0),
      ),
      'head',
    ),
  );
  return parts;
}

// ─────────────────────────────────────────────────────────────────────────────
// Geometry cache — one build for every rider on the mountain
// ─────────────────────────────────────────────────────────────────────────────

export type RiderPart = 'skin' | 'jersey' | 'cloth' | 'rubber' | 'helmet' | 'lens';

const PART_RAMP: Record<RiderPart, keyof typeof RAMPS> = {
  skin: 'skin',
  jersey: 'jerseyPlayer',
  cloth: 'cloth',
  rubber: 'rubber',
  helmet: 'helmet',
  lens: 'lens',
};

let geoCache: Record<RiderPart, BufferGeometry> | null = null;

/** Build (once) the six merged, skinned, outline-ready geometries. */
export function getRiderGeometries(): Record<RiderPart, BufferGeometry> {
  if (geoCache) return geoCache;
  const build = (parts: BufferGeometry[], ao: boolean): BufferGeometry =>
    finalizeGeometry(mergeParts(parts), {
      tolerance: 3e-4,
      maxWeldAngle: 180,
      curvatureGain: 0.9,
      ao,
      aoStrength: 0.45,
    });

  geoCache = {
    skin: build(buildSkinParts(), false),
    jersey: build(buildJerseyParts(), true),
    cloth: build(buildClothParts(), true),
    rubber: build(buildRubberParts(), false),
    helmet: build(buildHelmetParts(), false),
    lens: build(buildLensParts(), false),
  };
  return geoCache;
}

// ─────────────────────────────────────────────────────────────────────────────
// Materials
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Re-hue a ramp toward a rider's committed colour, preserving each band's
 * lightness. Same rule the bike frame uses: we never invent a colour, we move
 * the committed ramp onto the committed hue.
 */
function reHueRamp(base: RampPreset, target: Color, amount = 0.7): RampPreset {
  const th = { h: 0, s: 0, l: 0 };
  target.getHSL(th);
  const colors = base.colors.map((c) => {
    const o = { h: 0, s: 0, l: 0 };
    c.getHSL(o);
    return new Color().setHSL(th.h, lerp(o.s, th.s, amount), o.l);
  });
  return { ...base, colors };
}

/** Re-hue an existing material's bands in place. Used by setJerseyColor. */
export function reHueMaterial(mat: CelMaterial, base: RampPreset, target: Color, amount = 0.7): void {
  const th = { h: 0, s: 0, l: 0 };
  target.getHSL(th);
  const bands = mat.uniforms.uBandColor.value as Color[];
  for (let i = 0; i < bands.length; i++) {
    const src = base.colors[Math.min(i, base.colors.length - 1)];
    const o = { h: 0, s: 0, l: 0 };
    src.getHSL(o);
    bands[i].setHSL(th.h, lerp(o.s, th.s, amount), o.l);
  }
}

/** Materials with no per-rider variation are built once and shared. */
const sharedMaterials = new Map<RiderPart, CelMaterial>();

/**
 * How hard each part is held to its identity once the rider gets small.
 *
 * `chroma` is how strongly the fragment is re-seated on the committed hue and
 * `rim` how strong the forced separating line is. The jersey carries almost
 * all of the recognition load — RIDER_COLORS is a jersey palette — so it is
 * held hardest; skin and rubber get a rim so the figure keeps its edges but
 * almost no chroma, because a skin tone pushed to full saturation at 20 px
 * reads as a costume rather than as an arm.
 *
 * Every part opts in, including the ones with no chroma to hold, because the
 * INK TAPER travels on the same flag and it has to be uniform: thinning the
 * jersey's outline while leaving the shorts at full width breaks the figure
 * into parts drawn at two different weights.
 */
const IDENTITY_WEIGHT: Record<RiderPart, { chroma: number; rim: number }> = {
  skin: { chroma: 0.20, rim: 0.55 },
  jersey: { chroma: 0.80, rim: 1.00 },
  cloth: { chroma: 0.40, rim: 0.60 },
  rubber: { chroma: 0.10, rim: 0.45 },
  helmet: { chroma: 0.60, rim: 0.85 },
  lens: { chroma: 0.15, rim: 0.55 },
};

function celOptionsFor(part: RiderPart, identityColor: Color): CelOptions {
  const w = IDENTITY_WEIGHT[part];
  const o: CelOptions = {
    skinned: true,
    idName: `rider-${part}`,
    name: `rider:${part}`,
    identity: { color: identityColor.clone(), height: 1.7, chroma: w.chroma, rim: w.rim },
  };
  if (part === 'lens') {
    o.matcapMix = 0.55;
  } else if (part === 'helmet') {
    // A REACHABLE exponent, exactly as RAMPS.water was corrected from 160 to 4.
    //
    // RAMPS.helmet declares specPower 140. `bandedSpecular` thresholds
    // pow(N.H, power) through `bandStep`, whose anti-aliasing width is
    // max(fwidth(x) * 0.75, softness) — and that is the trap. At an exponent
    // of 140 the term goes from 0 to 1 across a couple of pixels, so fwidth
    // is order 1, the "one pixel wide" AA edge becomes the ENTIRE range, and
    // the declaration that asked for the hardest highlight on the rider
    // produces the softest gradient in the frame. That is the term a critic
    // read as "the one thing that reads as PBR in an otherwise clean rider".
    //
    // At 9 the exponent is reachable at this sun angle and the derivative is
    // small, so bandStep falls back to the preset's 0.006 softness and draws
    // what it was always meant to draw. Measured across the crown at
    // rider-closeup: 140 gives a 4 px bump peaking at luma 182; a reachable
    // exponent gives a flat plateau with a single-pixel step on each side.
    //
    // 16, not 9, and 0.26 rather than the preset's 0.95: once the highlight
    // is actually reachable the declared strength is enormous, and there is a
    // hard ceiling on it that has nothing to do with taste. GRADE.bloomThreshold
    // is 0.82; the helmet's lit band sits near 0.55 and bandedSpecular's core
    // tier contributes 0.75 of whatever strength is declared, so anything above
    // ~0.33 pushes the core over the threshold and the bloom pass turns the
    // drawn shape back into the soft glow it was built to replace. Measured on
    // the crown at 0.42 the core is a blown white blob with a smooth interior;
    // at 0.26 it is a flat plateau. The shape has to be a MARK on the shell,
    // not a second light source.
    o.specPower = 16;
    o.specStrength = 0.26;
    // ...and DRAW the highlight, which is the half of the job a reachable
    // exponent alone does not do. A scanline across the crown proved the shell
    // was already resolving to flat plateaus and still reading as gloss,
    // because nothing put a line round the glint. See CelOptions.specInk.
    //
    // 0.45, not 0.90. A contour drawn round a highlight is a mark when the
    // highlight is a glint and an OUTLINE when the highlight is a third of the
    // shell — and on the back of the head an outlined bright oval is an eye.
    // The occiput now has a spine and two channels cutting the iso-contours so
    // the shape cannot close (see buildHelmetParts), and at half the weight the
    // remaining line reads as the edge of a glint instead of as a drawn
    // feature. Both halves are needed: the geometry stops it being a circle,
    // this stops it being emphatic.
    o.specInk = 0.45;
    // ...and less matcap, because with a real highlight present the matcap is
    // no longer carrying the gloss and its own soft content is just haze. The
    // matcap is sampled by the VIEW-space normal, so its features are pinned to
    // the screen and slide across the shell as the head turns — the one term
    // here that cannot be made to read as a drawn mark on the object.
    o.matcapMix = 0.0;
    // The preset asks for 0.85 of rim on a helmet. At a close crop that is a
    // 10 px cream halo all the way round the lid — the single most bloom-like
    // thing left on the rider once the specular was fixed. The rim exists to
    // separate a rider from the terrain, and at a 180 px crop separation is not
    // in question; the identity rim floor puts it back automatically once the
    // rider is small enough to need it.
    o.rimStrength = 0.42;
  }
  return o;
}

/** Identity colours for the parts every rider shares. Ramp-derived, not per-rider. */
const SHARED_IDENTITY: Record<string, Color> = {
  skin: RAMPS.skin.colors[1],
  cloth: RAMPS.cloth.colors[2],
  rubber: RAMPS.rubber.colors[2],
  lens: RAMPS.lens.colors[1],
};

function sharedMaterial(part: RiderPart): CelMaterial {
  let m = sharedMaterials.get(part);
  if (!m) {
    const id = SHARED_IDENTITY[part] ?? RAMPS[PART_RAMP[part]].colors[1];
    m = new CelMaterial(RAMPS[PART_RAMP[part]], celOptionsFor(part, id));
    sharedMaterials.set(part, m);
  }
  return m;
}

// ─────────────────────────────────────────────────────────────────────────────
// Assembly
// ─────────────────────────────────────────────────────────────────────────────

export interface RiderMeshOptions {
  /** Jersey colour, sRGB hex. */
  jersey?: number;
  /** Accent colour, sRGB hex — helmet and shorts trim. */
  accent?: number;
  name?: string;
}

export interface RiderMeshSet {
  group: Group;
  meshes: SkinnedMesh[];
  hulls: Mesh[];
  /** Per-rider materials. Shared ones are not in this list and never disposed. */
  owned: CelMaterial[];
  jerseyMaterial: CelMaterial;
  helmetMaterial: CelMaterial;
}

/**
 * Build one rider's six skinned meshes, each with an inverted-hull sibling bound
 * to the SAME skeleton — which is the only way the ink can follow a deforming
 * character without peeling off at speed.
 */
export function buildRiderMeshes(skel: RiderSkeleton, opts: RiderMeshOptions = {}): RiderMeshSet {
  const geos = getRiderGeometries();
  const group = new Group();
  group.name = opts.name ? `${opts.name}:body` : 'rider:body';

  const meshes: SkinnedMesh[] = [];
  const hulls: Mesh[] = [];
  const owned: CelMaterial[] = [];

  const jerseyColor = new Color().setHex(opts.jersey ?? 0xe0574c);
  const accentColor = new Color().setHex(opts.accent ?? 0xff9a5c);

  const jerseyMaterial = new CelMaterial(
    reHueRamp(RAMPS.jerseyPlayer, jerseyColor),
    celOptionsFor('jersey', jerseyColor),
  );
  const helmetMaterial = new CelMaterial(
    reHueRamp(RAMPS.helmet, accentColor, 0.40),
    celOptionsFor('helmet', accentColor),
  );
  owned.push(jerseyMaterial, helmetMaterial);

  const order: RiderPart[] = ['skin', 'jersey', 'cloth', 'rubber', 'helmet', 'lens'];
  for (const part of order) {
    const mat =
      part === 'jersey' ? jerseyMaterial : part === 'helmet' ? helmetMaterial : sharedMaterial(part);

    const mesh = new SkinnedMesh(geos[part], mat);
    mesh.name = `${opts.name ?? 'rider'}:${part}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    // A rider's pose leaves the bind-pose bounds constantly (superman, crashes).
    // Four characters is nothing to draw; a character that vanishes mid-trick
    // because a stale bounding sphere left the frustum is unforgivable.
    mesh.frustumCulled = false;
    group.add(mesh);
    mesh.bind(skel.skeleton, new Matrix4());

    registerNprMesh(mesh, mat);
    const hull = attachOutline(mesh, mat.preset, { ...mat.celOptions, skinned: true });
    if (hull) {
      hull.frustumCulled = false;
      group.add(hull);
      hulls.push(hull);
    }
    meshes.push(mesh);
  }

  return { group, meshes, hulls, owned, jerseyMaterial, helmetMaterial };
}

const _idColor = new Color();

/** Apply a rider's identity colours to an already-built set. */
export function applyRiderColors(set: RiderMeshSet, jersey: number, accent: number): void {
  _idColor.setHex(jersey);
  reHueMaterial(set.jerseyMaterial, RAMPS.jerseyPlayer, _idColor, 0.7);
  setIdentityColor(set.jerseyMaterial, _idColor);
  _idColor.setHex(accent);
  reHueMaterial(set.helmetMaterial, RAMPS.helmet, _idColor, 0.40);
  setIdentityColor(set.helmetMaterial, _idColor);
}

/**
 * Move a material's distance chroma floor onto a new hue.
 *
 * Riders are recoloured after construction (RiderRig calls setJerseyColor on
 * every racer), so the floor has to follow — otherwise every opponent would be
 * held to whatever colour the material happened to be built with, and at range
 * the whole grid would converge on one hue. Which is the exact failure the
 * floor exists to prevent.
 */
function setIdentityColor(mat: CelMaterial, color: Color): void {
  const u = mat.uniforms.uIdentityColor;
  if (u) (u.value as Color).copy(color);
  const hull = mat.hullMaterial;
  if (hull?.uniforms?.uIdentityColor) (hull.uniforms.uIdentityColor.value as Color).copy(color);
}
