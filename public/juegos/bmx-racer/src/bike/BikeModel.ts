/**
 * BikeModel — the bike, built entirely in code.
 *
 * Nothing here is loaded. Every tube is swept along a path computed in this
 * file, every rim is a revolved profile, every tyre knob is a box placed on a
 * torus, every chain link is an instance stepped along an arc-length
 * parameterisation of the actual chain line between the chainring and the cog.
 *
 * Three structural decisions:
 *
 *  1. GEOMETRY IS BUILT ONCE AND SHARED. Four racers use the same BufferGeometry
 *     objects. Only the frame MATERIAL differs per rider, and it differs by
 *     re-hueing the committed `frame` ramp toward that rider's committed colour
 *     rather than by inventing a new palette entry.
 *
 *  2. THE HIERARCHY IS BUILT AROUND THE STEERING AXIS, not around the bike's
 *     origin. The head tube, the fork and the bars all rotate about the same
 *     line, and a tailwhip spins the FRAME about that line while the bars stay
 *     put. Modelling the whip as "rotate the frame about Y" would visibly
 *     detach the frame from the head tube on the first whip, so every one of
 *     those pivots is a real node aligned to the real axis, with a matching
 *     inverse node underneath so the parts themselves are still authored in
 *     plain bike coordinates.
 *
 *  3. SUSPENSION MOVES ALONG ITS OWN AXIS. The fork lowers slide down the
 *     steerer line, which means a compressing fork moves the front axle back and
 *     up — the real behaviour, and the reason a compressed fork looks steeper.
 *     The rear is a single-pivot swingarm with a shock whose body and shaft are
 *     separate objects aimed at each other, so the shaft visibly disappears into
 *     the body under load.
 *
 * Bike space: +Y up, +Z forward, +X to the LEFT (right-handed). The origin is at
 * mid-wheelbase, on the axle line with the suspension topped out.
 */

import {
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  InstancedBufferAttribute,
  InstancedMesh,
  LatheGeometry,
  Matrix4,
  Mesh,
  Object3D,
  Quaternion,
  ShaderMaterial,
  SphereGeometry,
  Vector2,
  Vector3,
} from 'three';

import {
  CelMaterial,
  createHullMaterial,
  registerNprMesh,
  type CelOptions,
} from '../npr/CelMaterial';
import { finalizeGeometry } from '../npr/OutlineGeometry';
import { RAMPS, type RampPreset } from '../npr/Palette';
import type { BikeAnchors } from '../game/Contracts';
import { BIKE } from '../game/WorldConstants';
import { clamp, clamp01, lerp } from '../core/MathX';

// ─────────────────────────────────────────────────────────────────────────────
// Geometry constants — shared with the physics so the mesh and the simulation
// cannot disagree about where a wheel is.
// ─────────────────────────────────────────────────────────────────────────────

const HEAD_ANGLE = 1.2915; // 74° from horizontal — BMX/dirt-jump

export const BIKE_GEOM = {
  wheelRadius: BIKE.wheelRadius,
  halfWheelbase: BIKE.wheelbase * 0.5,

  /** Steering axis, unit, pointing UP the steerer. */
  steerAxis: new Vector3(0, Math.sin(HEAD_ANGLE), -Math.cos(HEAD_ANGLE)).normalize(),
  headBottom: new Vector3(0, 0.315, 0.418),
  headTop: new Vector3(0, 0.421, 0.387),

  bb: new Vector3(0, 0.020, -0.075),
  seatTubeTop: new Vector3(0, 0.400, -0.185),
  saddle: new Vector3(0, 0.472, -0.228),

  frontAxle: new Vector3(0, 0, 0.540),
  rearAxle: new Vector3(0, 0, -0.540),

  /** Rear swingarm pivot, and the vertical rate of the axle about it. */
  swingPivot: new Vector3(0, 0.075, -0.135),

  /** Shock mounts: frame end and swingarm end. */
  shockFrameMount: new Vector3(-0.030, 0.335, -0.212),
  shockArmMount: new Vector3(-0.030, 0.038, -0.300),

  /** Stem clamp and bar clamp, on the steerer above the head tube. */
  stemClamp: new Vector3(0, 0.470, 0.372),
  barClamp: new Vector3(0, 0.481, 0.418),
  barRise: 0.176,
  barHalfWidth: 0.336,
  barBackSweep: 0.16, // radians

  /** Drivetrain. */
  crankLength: 0.170,
  crankOffset: 0.0555,
  chainringRadius: 0.0890, // 44t at 1/2" pitch
  chainringX: -0.0755,
  cogRadius: 0.0222, // 11t
  cogX: -0.0480,
  chainPlaneX: -0.0620,
  chainLinkPitch: 0.0127,
  chainLinkCount: 98,

  /** Wheel build. */
  rimRadius: 0.1955,
  rimWidth: 0.0300,
  tyreCasing: 0.0362,
  hubRadius: 0.0255,
  hubHalfWidth: 0.0290,
  flangeRadius: 0.0315,
  spokeCount: 32,

  forkTravel: BIKE.forkTravel,
  shockWheelTravel: BIKE.shockTravel,
};

/** Vertical rate of the rear axle per radian of swingarm rotation. */
const SWING_ARM_RATE = (() => {
  const r = new Vector3().subVectors(BIKE_GEOM.rearAxle, BIKE_GEOM.swingPivot);
  // d(y)/d(theta) about +X at theta = 0 is -z.
  return -r.z;
})();

/**
 * The suspension mount points the physics raycasts from. Chosen so that with the
 * suspension topped out the wheel centre sits exactly on the axle line — the
 * physics travels straight down in body space while the mesh travels along the
 * real suspension path, and the two agree to within a few millimetres of
 * fore/aft drift that nobody has ever noticed on a bicycle.
 */
export const FRONT_MOUNT = new Vector3(0, BIKE_GEOM.forkTravel, BIKE_GEOM.frontAxle.z);
export const REAR_MOUNT = new Vector3(0, BIKE_GEOM.shockWheelTravel, BIKE_GEOM.rearAxle.z);

// ─────────────────────────────────────────────────────────────────────────────
// Geometry construction helpers
// ─────────────────────────────────────────────────────────────────────────────

const _t0 = new Vector3();
const _t1 = new Vector3();
const _nrm = new Vector3();
const _bin = new Vector3();
const _axis = new Vector3();
const _qh = new Quaternion();
const _m4 = new Matrix4();
const _v = new Vector3();

/**
 * Sweep a circular cross-section along a polyline using parallel transport.
 *
 * The naive Frenet frame flips its normal at every inflection point, which puts
 * a visible twist in a swept tube wherever the path is close to straight — the
 * usual reason a procedurally built bike frame has a seam crawling along the top
 * tube. Parallel transport carries the frame forward by the minimal rotation
 * between consecutive tangents and never flips.
 */
function sweepTube(
  points: readonly Vector3[],
  radius: number | readonly number[],
  radialSegs = 10,
  capStart = true,
  capEnd = true,
): BufferGeometry {
  const n = points.length;
  const radiusAt = (i: number): number =>
    typeof radius === 'number' ? radius : radius[Math.min(i, radius.length - 1)];

  // Tangents.
  const tangents: Vector3[] = [];
  for (let i = 0; i < n; i++) {
    const a = points[Math.max(0, i - 1)];
    const b = points[Math.min(n - 1, i + 1)];
    tangents.push(new Vector3().subVectors(b, a).normalize());
  }

  // Parallel-transported frames.
  const normals: Vector3[] = [];
  _t0.copy(tangents[0]);
  // Seed with whichever world axis is least parallel to the first tangent.
  const ax = Math.abs(_t0.x);
  const ay = Math.abs(_t0.y);
  const az = Math.abs(_t0.z);
  _nrm.set(0, 0, 0);
  if (ax <= ay && ax <= az) _nrm.set(1, 0, 0);
  else if (ay <= az) _nrm.set(0, 1, 0);
  else _nrm.set(0, 0, 1);
  _nrm.addScaledVector(_t0, -_nrm.dot(_t0)).normalize();
  normals.push(_nrm.clone());

  for (let i = 1; i < n; i++) {
    _t0.copy(tangents[i - 1]);
    _t1.copy(tangents[i]);
    _nrm.copy(normals[i - 1]);
    _axis.crossVectors(_t0, _t1);
    const s = _axis.length();
    if (s > 1e-7) {
      _axis.divideScalar(s);
      const angle = Math.atan2(s, clamp(_t0.dot(_t1), -1, 1));
      _qh.setFromAxisAngle(_axis, angle);
      _nrm.applyQuaternion(_qh);
    }
    // Re-orthogonalise against drift.
    _nrm.addScaledVector(_t1, -_nrm.dot(_t1)).normalize();
    normals.push(_nrm.clone());
  }

  const ringVerts = radialSegs;
  const vertCount = n * ringVerts + (capStart ? 1 : 0) + (capEnd ? 1 : 0);
  const pos = new Float32Array(vertCount * 3);
  const nor = new Float32Array(vertCount * 3);
  const uv = new Float32Array(vertCount * 2);
  const idx: number[] = [];

  let vi = 0;
  for (let i = 0; i < n; i++) {
    const p = points[i];
    const t = tangents[i];
    const nn = normals[i];
    _bin.crossVectors(t, nn).normalize();
    const r = radiusAt(i);
    for (let j = 0; j < ringVerts; j++) {
      const a = (j / ringVerts) * Math.PI * 2;
      const c = Math.cos(a);
      const s = Math.sin(a);
      const dx = nn.x * c + _bin.x * s;
      const dy = nn.y * c + _bin.y * s;
      const dz = nn.z * c + _bin.z * s;
      pos[vi * 3] = p.x + dx * r;
      pos[vi * 3 + 1] = p.y + dy * r;
      pos[vi * 3 + 2] = p.z + dz * r;
      nor[vi * 3] = dx;
      nor[vi * 3 + 1] = dy;
      nor[vi * 3 + 2] = dz;
      uv[vi * 2] = j / ringVerts;
      uv[vi * 2 + 1] = i / Math.max(1, n - 1);
      vi++;
    }
  }

  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < ringVerts; j++) {
      const j2 = (j + 1) % ringVerts;
      const a = i * ringVerts + j;
      const b = i * ringVerts + j2;
      const c = (i + 1) * ringVerts + j2;
      const d = (i + 1) * ringVerts + j;
      idx.push(a, b, c, a, c, d);
    }
  }

  if (capStart) {
    const centre = vi;
    const p = points[0];
    const t = tangents[0];
    pos[vi * 3] = p.x;
    pos[vi * 3 + 1] = p.y;
    pos[vi * 3 + 2] = p.z;
    nor[vi * 3] = -t.x;
    nor[vi * 3 + 1] = -t.y;
    nor[vi * 3 + 2] = -t.z;
    uv[vi * 2] = 0.5;
    uv[vi * 2 + 1] = 0;
    vi++;
    for (let j = 0; j < ringVerts; j++) {
      const j2 = (j + 1) % ringVerts;
      idx.push(centre, j2, j);
    }
  }
  if (capEnd) {
    const centre = vi;
    const p = points[n - 1];
    const t = tangents[n - 1];
    pos[vi * 3] = p.x;
    pos[vi * 3 + 1] = p.y;
    pos[vi * 3 + 2] = p.z;
    nor[vi * 3] = t.x;
    nor[vi * 3 + 1] = t.y;
    nor[vi * 3 + 2] = t.z;
    uv[vi * 2] = 0.5;
    uv[vi * 2 + 1] = 1;
    vi++;
    const base = (n - 1) * ringVerts;
    for (let j = 0; j < ringVerts; j++) {
      const j2 = (j + 1) % ringVerts;
      idx.push(centre, base + j, base + j2);
    }
  }

  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(pos, 3));
  geo.setAttribute('normal', new BufferAttribute(nor, 3));
  geo.setAttribute('uv', new BufferAttribute(uv, 2));
  geo.setIndex(idx);
  return geo;
}

/** Straight tube between two points. */
function tube(a: Vector3, b: Vector3, r0: number, r1 = r0, segs = 10): BufferGeometry {
  // Three points, not two, so the parallel-transport seed has a real tangent and
  // the taper is linear rather than stepped.
  const mid = new Vector3().lerpVectors(a, b, 0.5);
  return sweepTube([a, mid, b], [r0, (r0 + r1) * 0.5, r1], segs);
}

/**
 * Merge geometries that share position/normal/uv, preserving indices.
 * Written here rather than pulled from three's example utils so the bike has no
 * dependency outside the core library and so we control exactly which attributes
 * survive into `finalizeGeometry` (which must run on the MERGED result, or the
 * welded smooth normals would not span the seams between parts).
 */
function mergeGeos(geos: BufferGeometry[]): BufferGeometry {
  let vTotal = 0;
  let iTotal = 0;
  for (const g of geos) {
    vTotal += g.getAttribute('position').count;
    const ix = g.getIndex();
    iTotal += ix ? ix.count : g.getAttribute('position').count;
  }
  const pos = new Float32Array(vTotal * 3);
  const nor = new Float32Array(vTotal * 3);
  const uv = new Float32Array(vTotal * 2);
  const idx = vTotal > 65535 ? new Uint32Array(iTotal) : new Uint16Array(iTotal);

  let vo = 0;
  let io = 0;
  for (const g of geos) {
    const p = g.getAttribute('position');
    const nAttr = g.getAttribute('normal');
    const uAttr = g.getAttribute('uv');
    const count = p.count;
    for (let i = 0; i < count; i++) {
      pos[(vo + i) * 3] = p.getX(i);
      pos[(vo + i) * 3 + 1] = p.getY(i);
      pos[(vo + i) * 3 + 2] = p.getZ(i);
      if (nAttr) {
        nor[(vo + i) * 3] = nAttr.getX(i);
        nor[(vo + i) * 3 + 1] = nAttr.getY(i);
        nor[(vo + i) * 3 + 2] = nAttr.getZ(i);
      }
      if (uAttr) {
        uv[(vo + i) * 2] = uAttr.getX(i);
        uv[(vo + i) * 2 + 1] = uAttr.getY(i);
      }
    }
    const gi = g.getIndex();
    if (gi) {
      for (let i = 0; i < gi.count; i++) idx[io + i] = vo + gi.getX(i);
      io += gi.count;
    } else {
      for (let i = 0; i < count; i++) idx[io + i] = vo + i;
      io += count;
    }
    vo += count;
    g.dispose();
  }

  const out = new BufferGeometry();
  out.setAttribute('position', new BufferAttribute(pos, 3));
  out.setAttribute('normal', new BufferAttribute(nor, 3));
  out.setAttribute('uv', new BufferAttribute(uv, 2));
  out.setIndex(new BufferAttribute(idx, 1));
  return out;
}

/** Position + orient a geometry in place. */
function place(
  geo: BufferGeometry,
  position?: Vector3,
  rotation?: { axis: Vector3; angle: number },
  scale?: Vector3,
): BufferGeometry {
  _m4.identity();
  if (scale) _m4.makeScale(scale.x, scale.y, scale.z);
  if (rotation) {
    _qh.setFromAxisAngle(rotation.axis, rotation.angle);
    const r = new Matrix4().makeRotationFromQuaternion(_qh);
    _m4.premultiply(r);
  }
  if (position) {
    const t = new Matrix4().makeTranslation(position.x, position.y, position.z);
    _m4.premultiply(t);
  }
  geo.applyMatrix4(_m4);
  return geo;
}

/** A box with slightly bevelled corners so the outline hull has something to grip. */
function bevelBox(w: number, h: number, d: number, bevel = 0.0015): BufferGeometry {
  // Six quads with the corner verts pulled in by `bevel` along each axis. A
  // true chamfer would need extra geometry; this keeps the silhouette square
  // while giving the welded hull normals a slight outward splay at the corners.
  const hw = w * 0.5;
  const hh = h * 0.5;
  const hd = d * 0.5;
  const b = Math.min(bevel, Math.min(hw, Math.min(hh, hd)) * 0.4);
  const faces: [Vector3, Vector3, Vector3][] = [
    [new Vector3(0, 0, hd), new Vector3(hw - b, 0, 0), new Vector3(0, hh - b, 0)],
    [new Vector3(0, 0, -hd), new Vector3(-(hw - b), 0, 0), new Vector3(0, hh - b, 0)],
    [new Vector3(hw, 0, 0), new Vector3(0, 0, -(hd - b)), new Vector3(0, hh - b, 0)],
    [new Vector3(-hw, 0, 0), new Vector3(0, 0, hd - b), new Vector3(0, hh - b, 0)],
    [new Vector3(0, hh, 0), new Vector3(hw - b, 0, 0), new Vector3(0, 0, -(hd - b))],
    [new Vector3(0, -hh, 0), new Vector3(hw - b, 0, 0), new Vector3(0, 0, hd - b)],
  ];
  const pos: number[] = [];
  const nor: number[] = [];
  const uvs: number[] = [];
  const idx: number[] = [];
  for (const [c, u, vv] of faces) {
    const n = new Vector3().crossVectors(u, vv).normalize();
    const base = pos.length / 3;
    const corners = [
      new Vector3().copy(c).sub(u).sub(vv),
      new Vector3().copy(c).add(u).sub(vv),
      new Vector3().copy(c).add(u).add(vv),
      new Vector3().copy(c).sub(u).add(vv),
    ];
    const cu = [0, 1, 1, 0];
    const cv = [0, 0, 1, 1];
    for (let i = 0; i < 4; i++) {
      pos.push(corners[i].x, corners[i].y, corners[i].z);
      nor.push(n.x, n.y, n.z);
      uvs.push(cu[i], cv[i]);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  geo.setAttribute('normal', new BufferAttribute(new Float32Array(nor), 3));
  geo.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
  geo.setIndex(idx);
  return geo;
}

/** Cylinder aligned to +Y, centred on the origin. */
function cyl(rTop: number, rBot: number, h: number, segs = 12, open = false): BufferGeometry {
  return new CylinderGeometry(rTop, rBot, h, segs, 1, open).toNonIndexed();
}

/** Revolve a 2D profile about +Y. */
function lathe(points: Vector2[], segs = 20): BufferGeometry {
  return new LatheGeometry(points, segs).toNonIndexed();
}

/** A box placed and oriented by an explicit orthonormal basis. */
function orientedBox(
  w: number,
  h: number,
  d: number,
  position: Vector3,
  xAxis: Vector3,
  yAxis: Vector3,
  zAxis: Vector3,
): BufferGeometry {
  const g = bevelBox(w, h, d);
  const m = new Matrix4().makeBasis(xAxis, yAxis, zAxis);
  m.setPosition(position);
  g.applyMatrix4(m);
  return g;
}

// ─────────────────────────────────────────────────────────────────────────────
// Part builders. Every one of these runs exactly once, at module scope, and the
// resulting BufferGeometry is shared by all four racers.
// ─────────────────────────────────────────────────────────────────────────────

const G = BIKE_GEOM;

/** Frame tubes: head, top, down, seat, chainstays, seatstays. */
function buildFrameTubes(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const axis = G.steerAxis;

  // Head tube — a stout sleeve around the steerer.
  const hbA = new Vector3().copy(G.headBottom).addScaledVector(axis, -0.012);
  const hbB = new Vector3().copy(G.headTop).addScaledVector(axis, 0.012);
  parts.push(tube(hbA, hbB, 0.0235, 0.0235, 12));

  // Top tube — slight downward taper to the seat cluster.
  parts.push(
    sweepTube(
      [
        new Vector3(0, 0.412, 0.372),
        new Vector3(0, 0.409, 0.180),
        new Vector3(0, 0.404, -0.020),
        new Vector3(0, 0.400, -0.180),
      ],
      [0.0155, 0.0150, 0.0148, 0.0142],
      10,
    ),
  );

  // Down tube — the big one, sweeping from the head tube to the BB.
  parts.push(
    sweepTube(
      [
        new Vector3(0, 0.308, 0.402),
        new Vector3(0, 0.230, 0.290),
        new Vector3(0, 0.120, 0.120),
        new Vector3(0, 0.046, -0.020),
        new Vector3(0, 0.026, -0.070),
      ],
      [0.0195, 0.0205, 0.0210, 0.0200, 0.0185],
      12,
    ),
  );

  // Seat tube.
  parts.push(tube(new Vector3(0, 0.030, -0.082), G.seatTubeTop, 0.0175, 0.0160, 10));

  // Bottom bracket shell.
  parts.push(
    place(cyl(0.0245, 0.0245, 0.075, 14), G.bb, { axis: new Vector3(0, 0, 1), angle: Math.PI / 2 }),
  );

  // Chainstays and seatstays — one pair each side, meeting at the dropouts.
  for (const side of [-1, 1]) {
    const drop = new Vector3(side * 0.052, 0.004, -0.512);
    parts.push(
      sweepTube(
        [
          new Vector3(side * 0.028, 0.020, -0.098),
          new Vector3(side * 0.052, 0.016, -0.230),
          new Vector3(side * 0.056, 0.010, -0.380),
          drop,
        ],
        [0.0140, 0.0125, 0.0112, 0.0100],
        8,
      ),
    );
    parts.push(
      sweepTube(
        [
          new Vector3(side * 0.020, 0.386, -0.192),
          new Vector3(side * 0.040, 0.270, -0.310),
          new Vector3(side * 0.050, 0.130, -0.435),
          drop,
        ],
        [0.0112, 0.0105, 0.0098, 0.0092],
        8,
      ),
    );
    // Dropout plate.
    parts.push(
      place(bevelBox(0.009, 0.062, 0.052), new Vector3(side * 0.055, 0.004, -0.528)),
    );
  }

  // Seat cluster gusset — small, but it is what stops the seat tube junction
  // reading as three tubes that happen to touch.
  parts.push(place(bevelBox(0.030, 0.030, 0.062), new Vector3(0, 0.392, -0.186)));

  const geo = mergeGeos(parts);
  return finalizeGeometry(geo, { tolerance: 2e-4, maxWeldAngle: 180, ao: true, aoStrength: 0.45 });
}

/** Seatpost + saddle rails. Metal. */
function buildSeatpost(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  parts.push(tube(new Vector3(0, 0.382, -0.180), new Vector3(0, 0.462, -0.212), 0.0135, 0.0135, 10));
  // Rails.
  for (const side of [-1, 1]) {
    parts.push(
      sweepTube(
        [
          new Vector3(side * 0.021, 0.462, -0.170),
          new Vector3(side * 0.024, 0.466, -0.212),
          new Vector3(side * 0.021, 0.462, -0.262),
        ],
        0.0035,
        6,
      ),
    );
  }
  return finalizeGeometry(mergeGeos(parts), { tolerance: 2e-4, maxWeldAngle: 180 });
}

/** Saddle shell. Rubber ramp — matte, so it reads as a separate material. */
function buildSaddle(): BufferGeometry {
  // A lofted wedge: narrow nose, wide tail, domed top.
  const rows: { z: number; halfW: number; y: number }[] = [
    { z: -0.145, halfW: 0.012, y: 0.470 },
    { z: -0.185, halfW: 0.030, y: 0.474 },
    { z: -0.230, halfW: 0.055, y: 0.476 },
    { z: -0.272, halfW: 0.070, y: 0.474 },
    { z: -0.305, halfW: 0.062, y: 0.468 },
  ];
  const pos: number[] = [];
  const nor: number[] = [];
  const uvs: number[] = [];
  const idx: number[] = [];
  const RING = 8;
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    for (let j = 0; j < RING; j++) {
      const a = (j / RING) * Math.PI * 2;
      const cx = Math.cos(a);
      const cy = Math.sin(a);
      const x = cx * row.halfW;
      const y = row.y + cy * 0.014 + (cy > 0 ? 0.006 : 0);
      pos.push(x, y, row.z);
      nor.push(cx, cy, 0);
      uvs.push(j / RING, r / (rows.length - 1));
    }
  }
  for (let r = 0; r < rows.length - 1; r++) {
    for (let j = 0; j < RING; j++) {
      const j2 = (j + 1) % RING;
      const a = r * RING + j;
      const b = r * RING + j2;
      const c = (r + 1) * RING + j2;
      const d = (r + 1) * RING + j;
      idx.push(a, b, c, a, c, d);
    }
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  geo.setAttribute('normal', new BufferAttribute(new Float32Array(nor), 3));
  geo.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return finalizeGeometry(geo, { tolerance: 2e-4, maxWeldAngle: 180 });
}

/** Steerer + stem + bars + brake levers. Authored in bike space. */
function buildBars(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const axis = G.steerAxis;

  // Steerer tube poking out of the head tube.
  parts.push(
    tube(
      new Vector3().copy(G.headTop).addScaledVector(axis, -0.02),
      new Vector3().copy(G.headTop).addScaledVector(axis, 0.070),
      0.0145,
      0.0145,
      10,
    ),
  );
  // Stem: a block clamping the steerer, reaching forward to the bar clamp.
  parts.push(place(bevelBox(0.042, 0.046, 0.030), G.stemClamp));
  parts.push(tube(G.stemClamp, G.barClamp, 0.017, 0.019, 8));
  parts.push(place(bevelBox(0.046, 0.040, 0.034), G.barClamp));

  // Bar: centre section, rise, then swept-back grips. Authored as a swept path
  // so the bend is a real bend rather than three cylinders meeting at a corner.
  const bc = G.barClamp;
  const rise = G.barRise;
  const hw = G.barHalfWidth;
  const sweep = Math.sin(G.barBackSweep);
  for (const side of [1, -1]) {
    parts.push(
      sweepTube(
        [
          new Vector3(side * 0.004, bc.y, bc.z),
          new Vector3(side * 0.040, bc.y + rise * 0.18, bc.z + 0.002),
          new Vector3(side * 0.086, bc.y + rise * 0.66, bc.z - 0.004),
          new Vector3(side * 0.128, bc.y + rise * 0.95, bc.z - 0.016),
          new Vector3(side * 0.196, bc.y + rise, bc.z - 0.196 * sweep * 0.6),
          new Vector3(side * hw, bc.y + rise + 0.004, bc.z - hw * sweep),
        ],
        [0.0142, 0.0140, 0.0138, 0.0136, 0.0130, 0.0128],
        9,
      ),
    );
    // Brake lever body + blade.
    const lever = new Vector3(side * 0.24, bc.y + rise + 0.002, bc.z - 0.24 * sweep - 0.004);
    parts.push(place(bevelBox(0.020, 0.030, 0.026), lever));
    parts.push(
      sweepTube(
        [
          new Vector3(side * 0.245, bc.y + rise - 0.006, bc.z - 0.24 * sweep + 0.012),
          new Vector3(side * 0.268, bc.y + rise - 0.014, bc.z - 0.24 * sweep + 0.036),
          new Vector3(side * 0.292, bc.y + rise - 0.018, bc.z - 0.24 * sweep + 0.052),
        ],
        [0.0056, 0.0050, 0.0042],
        6,
      ),
    );
  }
  return finalizeGeometry(mergeGeos(parts), { tolerance: 2e-4, maxWeldAngle: 180, ao: true, aoStrength: 0.35 });
}

/** Grips — fatter, matte rubber. Separate mesh so the material can differ. */
function buildGrips(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const bc = G.barClamp;
  const rise = G.barRise;
  const hw = G.barHalfWidth;
  const sweep = Math.sin(G.barBackSweep);
  for (const side of [1, -1]) {
    parts.push(
      sweepTube(
        [
          new Vector3(side * 0.204, bc.y + rise + 0.0005, bc.z - 0.204 * sweep),
          new Vector3(side * 0.238, bc.y + rise + 0.002, bc.z - 0.238 * sweep),
          new Vector3(side * 0.300, bc.y + rise + 0.003, bc.z - 0.300 * sweep),
          new Vector3(side * (hw + 0.006), bc.y + rise + 0.004, bc.z - (hw + 0.006) * sweep),
        ],
        [0.0170, 0.0176, 0.0176, 0.0168],
        10,
      ),
    );
  }
  return finalizeGeometry(mergeGeos(parts), { tolerance: 2e-4, maxWeldAngle: 180 });
}

/** Fork crown + stanchions. Static relative to the steerer. */
function buildForkUpper(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const axis = G.steerAxis;
  const crown = new Vector3().copy(G.headBottom).addScaledVector(axis, -0.030);
  parts.push(place(bevelBox(0.104, 0.028, 0.046), crown));
  for (const side of [-1, 1]) {
    const top = new Vector3(side * 0.046, crown.y, crown.z).addScaledVector(axis, -0.004);
    const bot = new Vector3().copy(top).addScaledVector(axis, -0.206);
    parts.push(tube(top, bot, 0.0163, 0.0163, 10));
  }
  return finalizeGeometry(mergeGeos(parts), { tolerance: 2e-4, maxWeldAngle: 180 });
}

/**
 * Fork lowers — the sliding part. Authored in bike space at FULL EXTENSION; the
 * node translates it up the steerer axis as the fork compresses, which is what
 * makes the exposed stanchion shorten. This is the single most-watched piece of
 * motion on the whole bike, so the stanchion is deliberately long enough that
 * 130 mm of travel is an obvious change in exposed length.
 */
function buildForkLower(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const axis = G.steerAxis;
  const crown = new Vector3().copy(G.headBottom).addScaledVector(axis, -0.030);
  const axle = G.frontAxle;
  for (const side of [-1, 1]) {
    const top = new Vector3(side * 0.046, crown.y, crown.z).addScaledVector(axis, -0.214);
    const dropout = new Vector3(side * 0.050, axle.y, axle.z);
    parts.push(
      sweepTube(
        [top, new Vector3().lerpVectors(top, dropout, 0.45), new Vector3().lerpVectors(top, dropout, 0.82), dropout],
        [0.0212, 0.0206, 0.0180, 0.0140],
        10,
      ),
    );
    // Dropout plate + axle stub.
    parts.push(place(bevelBox(0.012, 0.052, 0.040), new Vector3(side * 0.052, axle.y, axle.z)));
  }
  // Brake caliper on the left lower.
  parts.push(place(bevelBox(0.026, 0.070, 0.042), new Vector3(0.058, 0.086, 0.492)));
  // Arch bridging the lowers.
  parts.push(place(bevelBox(0.104, 0.024, 0.030), new Vector3(0, 0.150, 0.500)));
  return finalizeGeometry(mergeGeos(parts), { tolerance: 2e-4, maxWeldAngle: 180, ao: true, aoStrength: 0.4 });
}

/** Rear swingarm — authored about the pivot so the node just rotates. */
function buildSwingarm(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const piv = G.swingPivot;
  for (const side of [-1, 1]) {
    parts.push(
      sweepTube(
        [
          new Vector3(side * 0.032 - piv.x, 0 - piv.y, 0 - piv.z).add(piv),
          new Vector3(side * 0.058, 0.052, -0.290),
          new Vector3(side * 0.058, 0.018, -0.450),
          new Vector3(side * 0.056, 0.002, -0.520),
        ],
        [0.0165, 0.0150, 0.0128, 0.0110],
        8,
      ),
    );
    parts.push(place(bevelBox(0.011, 0.058, 0.048), new Vector3(side * 0.058, 0.002, -0.534)));
  }
  // Pivot boss + a bridge so the arm reads as one rigid piece.
  parts.push(place(cyl(0.021, 0.021, 0.098, 12), piv, { axis: new Vector3(0, 0, 1), angle: Math.PI / 2 }));
  parts.push(place(bevelBox(0.108, 0.020, 0.040), new Vector3(0, 0.048, -0.300)));
  return finalizeGeometry(mergeGeos(parts), { tolerance: 2e-4, maxWeldAngle: 180, ao: true, aoStrength: 0.4 });
}

/** Shock body (frame end) and shaft (swingarm end), both authored along +Y. */
function buildShockBody(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  parts.push(place(cyl(0.0215, 0.0215, 0.108, 12), new Vector3(0, -0.054, 0)));
  parts.push(place(cyl(0.0130, 0.0130, 0.028, 10), new Vector3(0, 0.014, 0)));
  parts.push(place(cyl(0.0165, 0.0165, 0.014, 10), new Vector3(0, -0.112, 0)));
  return finalizeGeometry(mergeGeos(parts), { tolerance: 2e-4, maxWeldAngle: 180 });
}

function buildShockShaft(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  // Long enough that it is still buried in the body at full extension (19 mm of
  // overlap) and deeply buried at bottom-out (53 mm). The 34 mm of shaft that
  // disappears under load is the rear equivalent of the fork stanchion.
  parts.push(place(cyl(0.0088, 0.0088, 0.210, 8), new Vector3(0, 0.105, 0)));
  parts.push(place(cyl(0.0150, 0.0150, 0.016, 10), new Vector3(0, 0.006, 0)));
  return finalizeGeometry(mergeGeos(parts), { tolerance: 2e-4, maxWeldAngle: 180 });
}

/** Cranks + chainring, authored about the bottom bracket at crank angle 0. */
function buildCranks(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const L = G.crankLength;
  const off = G.crankOffset;

  for (const side of [-1, 1]) {
    // Drive side (-X) arm points +Y at angle 0; the other is 180° opposite.
    const dir = side < 0 ? 1 : -1;
    parts.push(
      place(
        bevelBox(0.016, L, 0.030),
        new Vector3(side * off, (dir * L) / 2, 0),
      ),
    );
    parts.push(place(cyl(0.019, 0.019, 0.020, 10), new Vector3(side * off, dir * L, 0)));
  }
  // Spindle.
  parts.push(place(cyl(0.010, 0.010, 0.128, 10), new Vector3(0, 0, 0), { axis: new Vector3(0, 0, 1), angle: Math.PI / 2 }));

  // Chainring: a disc, five spider arms, and 44 real teeth.
  const cr = G.chainringRadius;
  const rx = G.chainringX;
  parts.push(place(cyl(cr - 0.010, cr - 0.010, 0.0038, 30), new Vector3(rx, 0, 0), { axis: new Vector3(0, 0, 1), angle: Math.PI / 2 }));
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    parts.push(
      place(
        bevelBox(0.0075, 0.052, 0.020),
        new Vector3(rx - 0.004, Math.cos(a) * (cr - 0.036), Math.sin(a) * (cr - 0.036)),
        { axis: new Vector3(1, 0, 0), angle: -a },
      ),
    );
  }
  for (let i = 0; i < 44; i++) {
    const a = (i / 44) * Math.PI * 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    parts.push(
      orientedBox(
        0.0038,
        0.0090,
        0.0062,
        new Vector3(rx, c * (cr + 0.0022), s * (cr + 0.0022)),
        new Vector3(1, 0, 0),
        new Vector3(0, c, s),
        new Vector3(0, -s, c),
      ),
    );
  }
  return finalizeGeometry(mergeGeos(parts), { tolerance: 2e-4, maxWeldAngle: 180, ao: true, aoStrength: 0.4 });
}

/** One platform pedal, authored about its spindle. */
function buildPedal(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  parts.push(place(cyl(0.0072, 0.0072, 0.050, 8), new Vector3(0, 0, 0), { axis: new Vector3(0, 0, 1), angle: Math.PI / 2 }));
  parts.push(place(bevelBox(0.098, 0.0125, 0.078), new Vector3(0, 0, 0)));
  // Pins — eight of them, and they matter: without them the pedal reads as a
  // flat chip and the foot has nothing to sit on.
  for (let i = 0; i < 8; i++) {
    const x = (i % 4) / 3 - 0.5;
    const z = i < 4 ? -1 : 1;
    parts.push(place(cyl(0.0022, 0.0022, 0.0075, 5), new Vector3(x * 0.076, 0.0092, z * 0.028)));
    parts.push(place(cyl(0.0022, 0.0022, 0.0075, 5), new Vector3(x * 0.076, -0.0092, z * 0.028)));
  }
  return finalizeGeometry(mergeGeos(parts), { tolerance: 2e-4, maxWeldAngle: 180 });
}

/** Rear cog, authored about the rear axle. */
function buildCog(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const r = G.cogRadius;
  const x = G.cogX;
  parts.push(place(cyl(r - 0.004, r - 0.004, 0.0042, 16), new Vector3(x, 0, 0), { axis: new Vector3(0, 0, 1), angle: Math.PI / 2 }));
  for (let i = 0; i < 11; i++) {
    const a = (i / 11) * Math.PI * 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    parts.push(
      orientedBox(
        0.0040,
        0.0080,
        0.0060,
        new Vector3(x, c * (r + 0.0018), s * (r + 0.0018)),
        new Vector3(1, 0, 0),
        new Vector3(0, c, s),
        new Vector3(0, -s, c),
      ),
    );
  }
  return finalizeGeometry(mergeGeos(parts), { tolerance: 2e-4, maxWeldAngle: 180 });
}

/** Rim: a real box-section profile revolved about the axle (+X). */
function buildRim(): BufferGeometry {
  const R = G.rimRadius;
  const hw = G.rimWidth * 0.5;
  const inner = R - 0.024;
  const profile = [
    new Vector2(inner, -hw + 0.004),
    new Vector2(inner + 0.004, -hw),
    new Vector2(R - 0.003, -hw),
    new Vector2(R, -hw + 0.005),
    new Vector2(R, hw - 0.005),
    new Vector2(R - 0.003, hw),
    new Vector2(inner + 0.004, hw),
    new Vector2(inner, hw - 0.004),
    new Vector2(inner + 0.006, 0),
    new Vector2(inner, -hw + 0.004),
  ];
  const geo = lathe(profile, 30);
  geo.rotateZ(-Math.PI / 2); // lathe axis +Y -> wheel axle +X
  return finalizeGeometry(geo, { tolerance: 2e-4, maxWeldAngle: 180 });
}

/** Hub shell + flanges + the 32 spokes, merged into one wheel-metal geometry. */
function buildHubAndSpokes(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const rot = { axis: new Vector3(0, 0, 1), angle: Math.PI / 2 };
  parts.push(place(cyl(G.hubRadius, G.hubRadius, G.hubHalfWidth * 2, 14), new Vector3(), rot));
  for (const side of [-1, 1]) {
    parts.push(
      place(cyl(G.flangeRadius, G.flangeRadius, 0.006, 14), new Vector3(side * G.hubHalfWidth, 0, 0), rot),
    );
  }
  // Three-cross lacing: alternate sides and alternate the tangential offset, or
  // the wheel reads as a radial-laced show wheel rather than something built to
  // take a landing.
  const N = G.spokeCount;
  const cross = (Math.PI * 2 * 3) / (N / 2);
  for (let i = 0; i < N; i++) {
    const side = i % 2 === 0 ? 1 : -1;
    const dir = Math.floor(i / 2) % 2 === 0 ? 1 : -1;
    const a = (i / N) * Math.PI * 2;
    const hubPt = new Vector3(
      side * (G.hubHalfWidth + 0.003),
      Math.cos(a) * G.flangeRadius,
      Math.sin(a) * G.flangeRadius,
    );
    const b = a + dir * cross;
    const rimPt = new Vector3(
      side * 0.0085,
      Math.cos(b) * (G.rimRadius - 0.020),
      Math.sin(b) * (G.rimRadius - 0.020),
    );
    parts.push(sweepTube([hubPt, new Vector3().lerpVectors(hubPt, rimPt, 0.5), rimPt], 0.00115, 4));
  }
  return finalizeGeometry(mergeGeos(parts), { tolerance: 2e-4, maxWeldAngle: 180 });
}

/** Tyre carcass plus three staggered rows of knobs. */
function buildTyre(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const casing = G.tyreCasing;
  const R = G.wheelRadius - casing;

  // Carcass: swept around the wheel plane (YZ), axle along +X.
  const CIRC = 30;
  const ring: Vector3[] = [];
  for (let i = 0; i <= CIRC; i++) {
    const a = (i / CIRC) * Math.PI * 2;
    ring.push(new Vector3(0, Math.cos(a) * R, Math.sin(a) * R));
  }
  parts.push(sweepTube(ring, casing, 12, false, false));

  // Knobs: centre row plus two shoulder rows, staggered so the tread never
  // reads as a striped band.
  const rows = [
    { phi: 0, count: 20, w: 0.0195, h: 0.0092, d: 0.0250, offset: 0 },
    { phi: 0.66, count: 18, w: 0.0180, h: 0.0100, d: 0.0225, offset: 0.5 },
    { phi: -0.66, count: 18, w: 0.0180, h: 0.0100, d: 0.0225, offset: 0.5 },
  ];
  for (const row of rows) {
    for (let i = 0; i < row.count; i++) {
      const th = ((i + row.offset) / row.count) * Math.PI * 2;
      const ct = Math.cos(th);
      const st = Math.sin(th);
      // Outward radial in the wheel plane, and the circumferential tangent.
      const radial = new Vector3(0, ct, st);
      const tangent = new Vector3(0, -st, ct);
      const up = new Vector3(Math.sin(row.phi), 0, 0).addScaledVector(radial, Math.cos(row.phi)).normalize();
      const side = new Vector3().crossVectors(up, tangent).normalize();
      const centre = new Vector3(0, ct * R, st * R).addScaledVector(up, casing + row.h * 0.36);
      parts.push(orientedBox(row.w, row.h, row.d, centre, side, up, tangent));
    }
  }
  return finalizeGeometry(mergeGeos(parts), { tolerance: 2e-4, maxWeldAngle: 180, ao: true, aoStrength: 0.35 });
}

/** Brake rotor — a disc with cutouts implied by a stepped profile. */
function buildRotor(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const rot = { axis: new Vector3(0, 0, 1), angle: Math.PI / 2 };
  parts.push(place(cyl(0.0925, 0.0925, 0.0021, 26), new Vector3(0.030, 0, 0), rot));
  parts.push(place(cyl(0.036, 0.036, 0.0032, 16), new Vector3(0.030, 0, 0), rot));
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    parts.push(
      place(bevelBox(0.0028, 0.052, 0.010), new Vector3(0.030, Math.cos(a) * 0.062, Math.sin(a) * 0.062), {
        axis: new Vector3(1, 0, 0),
        angle: -a,
      }),
    );
  }
  return finalizeGeometry(mergeGeos(parts), { tolerance: 2e-4, maxWeldAngle: 180 });
}

/** One chain link, long axis +Z, plates in X. */
function buildChainLink(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  parts.push(place(bevelBox(0.0022, 0.0068, 0.0125), new Vector3(0.0030, 0, 0)));
  parts.push(place(bevelBox(0.0022, 0.0068, 0.0125), new Vector3(-0.0030, 0, 0)));
  parts.push(place(cyl(0.0018, 0.0018, 0.0082, 6), new Vector3(0, 0, 0.0048), { axis: new Vector3(0, 0, 1), angle: Math.PI / 2 }));
  return finalizeGeometry(mergeGeos(parts), { tolerance: 1e-4, maxWeldAngle: 180 });
}

// ─────────────────────────────────────────────────────────────────────────────
// The chain line
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The real chain line: two external tangents between the chainring and the cog,
 * plus the wrap arcs on each. Sampled into a closed polyline with cumulative arc
 * length, so a link at chain-distance `s` can be placed exactly and the whole
 * chain moves by advancing `s` at the chainring's rim speed.
 *
 * Doing this properly rather than looping links around a rounded rectangle is
 * what makes the chain sit ON the teeth instead of floating near them, which is
 * the difference between a bike and a bike-shaped object at close range.
 */
export interface ChainPath {
  points: Vector3[];
  tangents: Vector3[];
  cumulative: number[];
  length: number;
}

function buildChainPath(): ChainPath {
  const c1z = G.bb.z;
  const c1y = G.bb.y;
  const r1 = G.chainringRadius;
  const c2z = G.rearAxle.z;
  const c2y = G.rearAxle.y;
  const r2 = G.cogRadius;

  const dz = c2z - c1z;
  const dy = c2y - c1y;
  const d = Math.hypot(dz, dy);
  const alpha = Math.atan2(dy, dz);
  const beta = Math.asin(clamp((r1 - r2) / d, -1, 1));

  const thUpper = alpha + Math.PI / 2 + beta;
  const thLower = alpha - Math.PI / 2 - beta;

  const pt = (cz: number, cy: number, r: number, th: number): Vector3 =>
    new Vector3(G.chainPlaneX, cy + r * Math.sin(th), cz + r * Math.cos(th));

  const points: Vector3[] = [];

  // Upper straight run: ring tangent -> cog tangent.
  points.push(pt(c1z, c1y, r1, thUpper));
  points.push(pt(c2z, c2y, r2, thUpper));

  // Wrap the cog, decreasing angle, through the far side.
  const cogSpan = Math.PI + 2 * beta;
  const cogSteps = 8;
  for (let i = 1; i < cogSteps; i++) {
    points.push(pt(c2z, c2y, r2, thUpper - (cogSpan * i) / cogSteps));
  }
  points.push(pt(c2z, c2y, r2, thLower));

  // Lower straight run back to the ring.
  points.push(pt(c1z, c1y, r1, thLower));

  // Wrap the ring, decreasing angle, through the front.
  const ringSpan = Math.PI - 2 * beta;
  const ringSteps = 14;
  for (let i = 1; i < ringSteps; i++) {
    points.push(pt(c1z, c1y, r1, thLower - (ringSpan * i) / ringSteps));
  }

  // Cumulative arc length around the closed loop.
  const n = points.length;
  const cumulative = new Array<number>(n + 1);
  const tangents: Vector3[] = [];
  cumulative[0] = 0;
  for (let i = 0; i < n; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    const seg = a.distanceTo(b);
    cumulative[i + 1] = cumulative[i] + seg;
    tangents.push(new Vector3().subVectors(b, a).normalize());
  }
  return { points, tangents, cumulative, length: cumulative[n] };
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared geometry + material caches
// ─────────────────────────────────────────────────────────────────────────────

export interface BikeGeometries {
  frameTubes: BufferGeometry;
  seatpost: BufferGeometry;
  saddle: BufferGeometry;
  bars: BufferGeometry;
  grips: BufferGeometry;
  forkUpper: BufferGeometry;
  forkLower: BufferGeometry;
  swingarm: BufferGeometry;
  shockBody: BufferGeometry;
  shockShaft: BufferGeometry;
  cranks: BufferGeometry;
  pedal: BufferGeometry;
  cog: BufferGeometry;
  rim: BufferGeometry;
  hubSpokes: BufferGeometry;
  tyre: BufferGeometry;
  rotor: BufferGeometry;
  chainLink: BufferGeometry;
  chainPath: ChainPath;
}

let geoCache: BikeGeometries | null = null;

/** Build (once) every geometry the bike needs. Idempotent. */
export function getBikeGeometries(): BikeGeometries {
  if (geoCache) return geoCache;
  geoCache = {
    frameTubes: buildFrameTubes(),
    seatpost: buildSeatpost(),
    saddle: buildSaddle(),
    bars: buildBars(),
    grips: buildGrips(),
    forkUpper: buildForkUpper(),
    forkLower: buildForkLower(),
    swingarm: buildSwingarm(),
    shockBody: buildShockBody(),
    shockShaft: buildShockShaft(),
    cranks: buildCranks(),
    pedal: buildPedal(),
    cog: buildCog(),
    rim: buildRim(),
    hubSpokes: buildHubAndSpokes(),
    tyre: buildTyre(),
    rotor: buildRotor(),
    chainLink: buildChainLink(),
    chainPath: buildChainPath(),
  };
  return geoCache;
}

/** Metal, rubber and tyre materials are identical for every rider — share them. */
const sharedMaterials = new Map<string, CelMaterial>();
const sharedHulls = new Map<string, ShaderMaterial>();

export function sharedMaterial(preset: keyof typeof RAMPS, opts: CelOptions): CelMaterial {
  const key = `${preset}|${opts.matcapMix ?? 0}|${opts.name ?? ''}`;
  let m = sharedMaterials.get(key);
  if (!m) {
    m = new CelMaterial(RAMPS[preset], opts);
    sharedMaterials.set(key, m);
  }
  return m;
}

export function sharedHull(preset: RampPreset, key: string, opts: CelOptions): ShaderMaterial {
  let m = sharedHulls.get(key);
  if (!m) {
    m = createHullMaterial(preset, opts);
    sharedHulls.set(key, m);
  }
  return m;
}

/**
 * Re-hue a ramp toward a rider's committed frame colour.
 *
 * We do NOT invent colours. Each band keeps the ramp's own lightness — which is
 * what carries the cel read — and takes the rider's hue with its saturation
 * blended most of the way across. The result is the same anodised-aluminium
 * response in four identifiable colours, rather than four different materials.
 */
export function reHueRamp(base: RampPreset, target: Color): RampPreset {
  const th = { h: 0, s: 0, l: 0 };
  target.getHSL(th);
  const colors = base.colors.map((c) => {
    const o = { h: 0, s: 0, l: 0 };
    c.getHSL(o);
    return new Color().setHSL(th.h, lerp(o.s, th.s, 0.72), o.l);
  });
  return { ...base, colors };
}

// ─────────────────────────────────────────────────────────────────────────────
// Assembly helpers
// ─────────────────────────────────────────────────────────────────────────────

export interface Part {
  mesh: Mesh;
  hull: Mesh | null;
}

export function makePart(
  geo: BufferGeometry,
  mat: CelMaterial,
  hullKey: string | null,
  name: string,
  parent: Object3D,
): Part {
  const mesh = new Mesh(geo, mat);
  mesh.name = name;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  registerNprMesh(mesh, mat);
  let hull: Mesh | null = null;
  if (hullKey && mat.preset.outlineWidth > 0 && geo.getAttribute('aSmoothNormal')) {
    const hm = sharedHull(mat.preset, hullKey, mat.celOptions);
    hull = new Mesh(geo, hm);
    hull.name = `${name}:hull`;
    hull.renderOrder = -1;
    hull.castShadow = false;
    hull.receiveShadow = false;
    hull.userData.isHull = true;
    hull.userData.hullOf = mesh;
    mesh.userData.hull = hull;
    parent.add(hull);
  }
  parent.add(mesh);
  return { mesh, hull };
}

/**
 * A pivot pair: an outer node placed on an axis (so a child's local Y rotation
 * is a rotation about that axis), and an inner node that undoes the placement so
 * the geometry underneath is still authored in plain bike coordinates.
 */
export function axisPivot(origin: Vector3, axis: Vector3, name: string): { outer: Object3D; inner: Object3D } {
  const outer = new Object3D();
  outer.name = name;
  outer.position.copy(origin);
  const q = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), axis);
  outer.quaternion.copy(q);

  const inner = new Object3D();
  inner.name = `${name}:space`;
  const qInv = q.clone().invert();
  inner.quaternion.copy(qInv);
  inner.position.copy(origin).negate().applyQuaternion(qInv);
  return { outer, inner };
}
