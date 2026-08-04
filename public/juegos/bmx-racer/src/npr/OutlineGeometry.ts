/**
 * OutlineGeometry — the preprocessing that makes inverted-hull outlines work
 * on hard-surface geometry.
 *
 * The naive inverted hull pushes each vertex along its own normal. On a smooth
 * sphere that is fine. On anything with a hard edge — a box, a rock facet, a
 * bike frame lug, a helmet vent — the vertices at that edge are SPLIT: the same
 * position appears several times with different normals. Push each copy along
 * its own normal and the hull tears open at every corner, leaving the gaps you
 * see on almost every browser toon shader.
 *
 * The fix, applied to every outlined mesh in this game:
 *
 *   1. Weld positions on a spatial hash (quantised to a tolerance).
 *   2. Average the normals of every vertex sharing a welded position, weighted
 *      by triangle area so a fan of tiny triangles doesn't drag the average.
 *   3. Write that average back to EVERY split copy as `aSmoothNormal`.
 *
 * The shading normals are left completely untouched, so hard edges still shade
 * hard — only the hull expansion uses the smoothed set.
 *
 * We compute a curvature estimate in the same pass. Curvature at a vertex is
 * how much its neighbours' smoothed normals disagree with its own: near zero on
 * a flat panel, near one on a tight crease. The hull shader uses it to swell
 * the stroke on creases and taper it on flats, which is the single detail that
 * separates a drawn line from a uniform toon offset.
 */

import { BufferAttribute, BufferGeometry, Vector3 } from 'three';

const _a = new Vector3();
const _b = new Vector3();
const _c = new Vector3();
const _ab = new Vector3();
const _ac = new Vector3();
const _cross = new Vector3();

export interface OutlinePrepOptions {
  /** Weld tolerance in world units. Smaller = fewer accidental merges. */
  tolerance?: number;
  /**
   * Creases sharper than this angle (degrees) are NOT welded — the hull keeps
   * a genuine break there. Set high (180) to weld everything, which is what
   * you want for organic shapes; set around 75 for hard-surface props so an
   * intentional sharp silhouette corner stays sharp.
   */
  maxWeldAngle?: number;
  /** Multiplies the computed curvature. Tune per asset class. */
  curvatureGain?: number;
  /** Overwrite existing attributes if present. */
  force?: boolean;
}

/**
 * Add `aSmoothNormal` (vec3) and `aCurvature` (float) to a geometry, in place.
 * Idempotent unless `force` is set. Returns the same geometry for chaining.
 */
export function prepareOutlineGeometry(
  geo: BufferGeometry,
  options: OutlinePrepOptions = {},
): BufferGeometry {
  const { tolerance = 1e-4, maxWeldAngle = 180, curvatureGain = 1.0, force = false } = options;

  if (!force && geo.getAttribute('aSmoothNormal') && geo.getAttribute('aCurvature')) return geo;

  const posAttr = geo.getAttribute('position') as BufferAttribute;
  if (!posAttr) throw new Error('[OutlineGeometry] geometry has no position attribute');
  if (!geo.getAttribute('normal')) geo.computeVertexNormals();
  const nrmAttr = geo.getAttribute('normal') as BufferAttribute;

  const count = posAttr.count;
  const pos = posAttr.array as Float32Array;
  const nrm = nrmAttr.array as Float32Array;

  // ── 1. Weld map ───────────────────────────────────────────────────────────
  // Spatial hash on quantised position. Using a string key is fast enough here
  // (this runs once at load, over tens of thousands of verts at most) and is
  // far more robust than a float-tolerance grid with neighbour probing.
  const inv = 1 / tolerance;
  const weldKey = (i: number): string => {
    const x = Math.round(pos[i * 3] * inv);
    const y = Math.round(pos[i * 3 + 1] * inv);
    const z = Math.round(pos[i * 3 + 2] * inv);
    return `${x}|${y}|${z}`;
  };

  const groups = new Map<string, number[]>();
  for (let i = 0; i < count; i++) {
    const k = weldKey(i);
    const g = groups.get(k);
    if (g) g.push(i);
    else groups.set(k, [i]);
  }

  // ── 2. Area-weighted normal accumulation ──────────────────────────────────
  // Accumulate per-vertex triangle-area weights first, so the averaging step
  // reflects surface contribution rather than raw triangle count.
  const areaWeight = new Float32Array(count);
  const index = geo.getIndex();
  const triCount = index ? index.count / 3 : count / 3;
  const idxAt = index
    ? (t: number, k: number) => index.getX(t * 3 + k)
    : (t: number, k: number) => t * 3 + k;

  for (let t = 0; t < triCount; t++) {
    const i0 = idxAt(t, 0);
    const i1 = idxAt(t, 1);
    const i2 = idxAt(t, 2);
    _a.fromArray(pos, i0 * 3);
    _b.fromArray(pos, i1 * 3);
    _c.fromArray(pos, i2 * 3);
    _ab.subVectors(_b, _a);
    _ac.subVectors(_c, _a);
    const area = _cross.crossVectors(_ab, _ac).length() * 0.5;
    areaWeight[i0] += area;
    areaWeight[i1] += area;
    areaWeight[i2] += area;
  }

  // ── 2b. Which vertices sit on an OPEN edge ────────────────────────────────
  //
  // An edge used by one triangle is a boundary; an edge used by two is
  // interior. The test has to be made on WELDED indices, not raw ones: on a
  // non-indexed mesh every triangle owns its own copies, so raw pairs are all
  // unique and every edge would look open.
  //
  // This exists to tell two very different vertices apart, both of which come
  // out of the weld in a group of one:
  //
  //   • the corner of a foliage card or a cloth panel, which really is an open
  //     edge and really does want a full-weight stroke;
  //   • a vertex of a CLOSED, SMOOTH-SHADED solid, where "a group of one" only
  //     means the mesh has no split copies anywhere, because nothing about it
  //     is faceted.
  //
  // The second case is most of the character work in this game and it was being
  // handed the boundary default. Measured: `rider:ai0:skin` 1008 vertices in
  // 1008 weld groups, jersey 369/369, cloth 273/273, lens 92/92 — every one of
  // them, so aCurvature was the constant 0.5 across the entire rider and both
  // `LINES.curvatureWeight` (which drives the hull's stroke taper) and the
  // interior pen's width had exactly nothing to work with on the one subject
  // the camera spends the whole game pointed at.
  const rootOf = new Int32Array(count);
  for (const groupIndices of groups.values()) {
    const root = groupIndices[0];
    for (const i of groupIndices) rootOf[i] = root;
  }
  const edgeUse = new Map<number, number>();
  const edgeKey = (a: number, b: number): number => (a < b ? a * count + b : b * count + a);
  for (let t = 0; t < triCount; t++) {
    const r0 = rootOf[idxAt(t, 0)];
    const r1 = rootOf[idxAt(t, 1)];
    const r2 = rootOf[idxAt(t, 2)];
    for (const [a, b] of [[r0, r1], [r1, r2], [r2, r0]] as const) {
      if (a === b) continue;
      const k = edgeKey(a, b);
      edgeUse.set(k, (edgeUse.get(k) ?? 0) + 1);
    }
  }
  const onBoundary = new Uint8Array(count);
  for (let t = 0; t < triCount; t++) {
    const r0 = rootOf[idxAt(t, 0)];
    const r1 = rootOf[idxAt(t, 1)];
    const r2 = rootOf[idxAt(t, 2)];
    for (const [a, b] of [[r0, r1], [r1, r2], [r2, r0]] as const) {
      if (a === b || (edgeUse.get(edgeKey(a, b)) ?? 0) >= 2) continue;
      onBoundary[a] = 1;
      onBoundary[b] = 1;
    }
  }
  // Boundary is a property of the POSITION, so it has to reach every copy.
  for (let i = 0; i < count; i++) if (onBoundary[rootOf[i]]) onBoundary[i] = 1;

  const smooth = new Float32Array(count * 3);
  const curvature = new Float32Array(count);
  const cosLimit = Math.cos((maxWeldAngle * Math.PI) / 180);

  const acc = new Vector3();
  const n0 = new Vector3();
  const nk = new Vector3();

  // The shaping curve, shared by both curvature estimates so they land on one
  // scale. `1 - dot` maps [0,180] degrees to [0,2]; halve it and shape it so a
  // 30-degree crease already reads as substantially curved, saturating near 72.
  const shapeCurvature = (divergence: number): number =>
    Math.min(1, Math.pow(divergence * 0.5 * 3.2, 0.65) * curvatureGain);

  const singleton = new Uint8Array(count);

  for (const groupIndices of groups.values()) {
    if (groupIndices.length === 1) {
      const i = groupIndices[0];
      smooth[i * 3] = nrm[i * 3];
      smooth[i * 3 + 1] = nrm[i * 3 + 1];
      smooth[i * 3 + 2] = nrm[i * 3 + 2];
      singleton[i] = 1;
      // A group of one on an OPEN edge is a boundary vertex — treat it as a
      // crease so canopy cards and cloth panels get a full-weight stroke. A
      // group of one in the INTERIOR of a closed surface means something else
      // entirely and is measured below; this is only its starting value.
      curvature[i] = 0.5;
      continue;
    }

    // Average, honouring the crease limit relative to each member in turn.
    for (const i of groupIndices) {
      n0.fromArray(nrm, i * 3);
      acc.set(0, 0, 0);
      let wsum = 0;
      let maxDivergence = 0;

      for (const k of groupIndices) {
        nk.fromArray(nrm, k * 3);
        const d = n0.dot(nk);
        maxDivergence = Math.max(maxDivergence, 1 - d);
        if (maxWeldAngle < 180 && d < cosLimit) continue; // too sharp — don't weld
        const w = areaWeight[k] + 1e-8;
        acc.addScaledVector(nk, w);
        wsum += w;
      }

      if (wsum > 0) acc.divideScalar(wsum);
      if (acc.lengthSq() < 1e-12) acc.copy(n0);
      acc.normalize();

      smooth[i * 3] = acc.x;
      smooth[i * 3 + 1] = acc.y;
      smooth[i * 3 + 2] = acc.z;

      // Curvature: how far the shading normal diverges across this weld group.
      curvature[i] = shapeCurvature(maxDivergence);
    }
  }

  // ── 2c. Curvature for the vertices the weld cannot speak for ──────────────
  //
  // Weld divergence answers "how many different normals meet at this POSITION",
  // which is a question about faceting. On a smooth-shaded closed surface the
  // answer is always one, and the estimate is silent — not zero, not one,
  // silent. The equivalent question for that surface is asked one step out,
  // along the triangle graph: how far this vertex's normal diverges from those
  // of the vertices it shares an edge with. On a flat panel that is nothing; on
  // the hem of a jersey or the rim of a helmet vent it is most of a right
  // angle; on the long sweep of a thigh it is a few degrees.
  //
  // It is deliberately NOT normalised by edge length. A curvature per metre
  // would say "everything on a rider is tightly curved", which is true and
  // useless; what the pen wants to know is where THIS asset's form breaks are,
  // relative to the rest of THIS asset.
  //
  // Boundary vertices keep the crease default: an open edge is a drawn edge
  // whatever the surface does on the way to it.
  {
    const graphDiv = new Float32Array(count);
    const note = (a: number, b: number): void => {
      const d =
        smooth[a * 3] * smooth[b * 3] +
        smooth[a * 3 + 1] * smooth[b * 3 + 1] +
        smooth[a * 3 + 2] * smooth[b * 3 + 2];
      const div = 1 - d;
      if (div > graphDiv[a]) graphDiv[a] = div;
    };
    for (let t = 0; t < triCount; t++) {
      const i0 = idxAt(t, 0);
      const i1 = idxAt(t, 1);
      const i2 = idxAt(t, 2);
      note(i0, i1); note(i0, i2);
      note(i1, i0); note(i1, i2);
      note(i2, i0); note(i2, i1);
    }
    for (let i = 0; i < count; i++) {
      if (singleton[i] && !onBoundary[i]) curvature[i] = shapeCurvature(graphDiv[i]);
    }
  }

  // ── 3. Smooth the curvature field once across welded neighbours ───────────
  //
  // Raw per-vertex curvature is noisy on dense meshes and makes the stroke
  // stutter. One averaging pass over the triangle graph settles it.
  //
  // ── WHY THE AVERAGE IS BILATERAL ──────────────────────────────────────────
  //
  // The plain average was measured washing the signal out of exactly the
  // geometry the taper exists for. On a scatter boulder — a plane-cut solid of
  // twenty-odd faces — EVERY vertex is a facet corner, so a vertex's graph
  // neighbours are not other samples of the same piece of surface: they are the
  // corners of DIFFERENT facets, several of them across the rock. Averaging
  // over them is not denoising, it is blurring, and it pulls a 27-degree bevel
  // and a 55-degree corner toward one another until the line pass has nothing
  // left to taper between. `summit-rider`'s foreground boulder came out at
  // aCurvature 0.43-0.79 across dihedral angles that actually spanned 26-55
  // degrees — a range compressed to about half its true width.
  //
  // Noise, by contrast, only exists where several vertices sample ONE facet,
  // and those vertices necessarily share a smoothed normal. So the average is
  // taken only over neighbours whose smoothed normal agrees with this one to
  // within `SMOOTH_COS`. On a dense mesh that is nearly every neighbour and the
  // filter behaves exactly as before; across a crease it takes none of them and
  // the crease keeps its own value. It is a bilateral filter, and the edge it
  // is asked to stop at is the only edge in the data.
  const SMOOTH_COS = Math.cos((32 * Math.PI) / 180);
  const curvSmooth = new Float32Array(curvature);
  const neighbourSum = new Float32Array(count);
  const neighbourCount = new Float32Array(count);
  const addPair = (a: number, b: number): void => {
    const d =
      smooth[a * 3] * smooth[b * 3] +
      smooth[a * 3 + 1] * smooth[b * 3 + 1] +
      smooth[a * 3 + 2] * smooth[b * 3 + 2];
    if (d < SMOOTH_COS) return;
    neighbourSum[a] += curvature[b];
    neighbourCount[a] += 1;
  };
  for (let t = 0; t < triCount; t++) {
    const i0 = idxAt(t, 0);
    const i1 = idxAt(t, 1);
    const i2 = idxAt(t, 2);
    addPair(i0, i1); addPair(i0, i2);
    addPair(i1, i0); addPair(i1, i2);
    addPair(i2, i0); addPair(i2, i1);
  }
  for (let i = 0; i < count; i++) {
    if (neighbourCount[i] > 0) {
      const avg = neighbourSum[i] / neighbourCount[i];
      curvSmooth[i] = curvature[i] * 0.6 + avg * 0.4;
    }
  }

  geo.setAttribute('aSmoothNormal', new BufferAttribute(smooth, 3));
  geo.setAttribute('aCurvature', new BufferAttribute(curvSmooth, 1));

  // ── The weld's own report card ────────────────────────────────────────────
  //
  // "The weld is not running on those instances" is the standing hypothesis for
  // every exploded-hull and every full-weight-wireframe report in this project,
  // and until now it could only be argued about. A vertex whose weld group has
  // exactly ONE member got its own face normal as its smooth normal and a flat
  // 0.5 curvature — which is precisely the exploded-hull signature — so the
  // fraction of singleton groups IS the diagnosis, and it costs nothing to
  // write down. A probe can read it off any live geometry:
  //
  //   scene.traverse(o => console.log(o.name, o.geometry.userData.outlineWeld))
  //
  // Deliberately not a console warning. Open shells (foliage cards, grass
  // tufts, cloth panels) are legitimately full of boundary vertices, so a high
  // fraction is only damning on something that is meant to be a closed solid,
  // and that judgement belongs to the reader, not to this function.
  let singletons = 0;
  for (const groupIndices of groups.values()) if (groupIndices.length === 1) singletons++;
  geo.userData.outlineWeld = {
    tolerance,
    maxWeldAngle,
    vertices: count,
    weldGroups: groups.size,
    singletons,
    singletonFraction: count > 0 ? singletons / count : 0,
  };
  return geo;
}

/**
 * Attach a flat `aCurvature` of a fixed value without doing the weld pass.
 * For geometry that is already smooth-normalled (spheres, tubes, lathes) and
 * where we know the stroke weight we want.
 */
export function setFlatOutlineAttributes(geo: BufferGeometry, curvature = 0.5): BufferGeometry {
  if (!geo.getAttribute('normal')) geo.computeVertexNormals();
  const nrm = geo.getAttribute('normal') as BufferAttribute;
  const count = nrm.count;
  if (!geo.getAttribute('aSmoothNormal')) {
    geo.setAttribute('aSmoothNormal', new BufferAttribute((nrm.array as Float32Array).slice(), 3));
  }
  if (!geo.getAttribute('aCurvature')) {
    const c = new Float32Array(count);
    c.fill(curvature);
    geo.setAttribute('aCurvature', new BufferAttribute(c, 1));
  }
  return geo;
}

/**
 * Add a `aSway` attribute for wind, derived from height above the geometry's
 * lowest point. Foliage roots stay planted; tips move.
 */
export function addSwayAttribute(geo: BufferGeometry, power = 1.6, originY?: number): BufferGeometry {
  const pos = geo.getAttribute('position') as BufferAttribute;
  const count = pos.count;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < count; i++) {
    const y = pos.getY(i);
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const base = originY ?? minY;
  const span = Math.max(maxY - base, 1e-5);
  const sway = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    sway[i] = Math.pow(Math.max(0, (pos.getY(i) - base) / span), power);
  }
  geo.setAttribute('aSway', new BufferAttribute(sway, 1));
  return geo;
}

/**
 * Add a vertex-AO attribute by casting the normal against a crude ambient
 * estimate: how enclosed the vertex is relative to the geometry's bounding
 * volume, blended with downward-facing bias. Cheap, and enough to keep the
 * undersides of rocks and the insides of wheel wells from glowing.
 */
export function addVertexAo(geo: BufferGeometry, strength = 1, downBias = 0.5): BufferGeometry {
  const pos = geo.getAttribute('position') as BufferAttribute;
  if (!geo.getAttribute('normal')) geo.computeVertexNormals();
  const nrm = geo.getAttribute('normal') as BufferAttribute;
  geo.computeBoundingBox();
  const bb = geo.boundingBox!;
  const count = pos.count;
  const ao = new Float32Array(count);
  const centre = new Vector3();
  bb.getCenter(centre);
  const extent = new Vector3();
  bb.getSize(extent);
  const radius = Math.max(extent.length() * 0.5, 1e-5);

  const p = new Vector3();
  const n = new Vector3();
  const toCentre = new Vector3();
  for (let i = 0; i < count; i++) {
    p.fromBufferAttribute(pos, i);
    n.fromBufferAttribute(nrm, i);
    toCentre.subVectors(centre, p);
    const dist = toCentre.length() / radius;
    toCentre.normalize();
    // Facing outward from the centre and far from it = open. Facing inward or
    // near the centre = occluded.
    const openness = 0.5 - 0.5 * n.dot(toCentre);
    const down = 0.5 - 0.5 * n.y;
    const occ = 1 - (openness * 0.55 + dist * 0.45) * (1 - down * downBias);
    ao[i] = 1 - Math.min(1, Math.max(0, occ)) * strength;
  }
  geo.setAttribute('aAo', new BufferAttribute(ao, 1));
  return geo;
}

/**
 * One-call preparation for any mesh that will be cel-shaded and outlined.
 * Every geometry builder in the project ends with this.
 */
export function finalizeGeometry(
  geo: BufferGeometry,
  opts: OutlinePrepOptions & { sway?: boolean; swayPower?: number; ao?: boolean; aoStrength?: number } = {},
): BufferGeometry {
  prepareOutlineGeometry(geo, opts);
  if (opts.sway) addSwayAttribute(geo, opts.swayPower ?? 1.6);
  if (opts.ao) addVertexAo(geo, opts.aoStrength ?? 0.6);
  geo.computeBoundingSphere();
  return geo;
}
