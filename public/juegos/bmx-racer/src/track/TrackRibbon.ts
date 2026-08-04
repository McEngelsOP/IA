/**
 * TrackRibbon — the dirt the race is actually run on.
 *
 * The ribbon is a swept surface, not a decal projected onto the terrain. It has
 * its own geometry, its own edges, and its own material, for three reasons:
 *
 *  1. THE EDGE. A projected trail texture has a soft, mathematically perfect
 *     boundary. A real trail edge is a break — worked ground stops, hillside
 *     starts, and the transition is a crease you could catch a pedal on. Here
 *     the edge is a genuine geometric fold with a buried skirt behind it, so
 *     the G-buffer sees a normal discontinuity and the Sobel pass inks it. The
 *     material ID changes across the same line, which inks it a second time.
 *     Both are irregular in plan, because a trail cut by feet and tyres wanders
 *     and a constant offset from a spline does not.
 *
 *  2. BERMS. The switchbacks ask for up to half a radian of bank. You cannot
 *     bank a decal. The outer edge of each bermed corner is built up into a
 *     real wall with a real outer flank, which is what the rider rails against
 *     and what the camera sees in silhouette on the exit.
 *
 *  3. THE LIPS. The tabletop and the ravine need a takeoff the rider can READ
 *     from thirty metres out. That means a hard silhouette (a genuine vertical
 *     end cap at the ravine, a kicker crest at the tabletop) and a distinct
 *     value (a bleached, packed strip driven by the spline's lip mask).
 *
 * The whole ribbon is one CelMaterial on RAMPS.trail, split into chunk meshes
 * purely so frustum culling has something to work with. There is no inverted
 * hull: a hull on a ground plane produces a black halo where the ribbon meets
 * the terrain, and the edge we want is already coming from the geometry break.
 */

import {
  BufferAttribute,
  BufferGeometry,
  Group,
  Mesh,
  Vector3,
} from 'three';

import { ITerrain, TrackSectionKind } from '../game/Contracts';
import { CelMaterial, disposeCelMaterial, registerNprMesh } from '../npr/CelMaterial';
import { finalizeGeometry } from '../npr/OutlineGeometry';
import { RAMPS } from '../npr/Palette';
import { trailSurface } from '../npr/GeneratedTextures';
import { TERRAIN_GROUND_SHAPES } from '../terrain/TerrainMaterial';
import { Noise2D } from '../core/Noise';
import { clamp, clamp01, lerp, smoothstep } from '../core/MathX';
import { SECTION_ORDER, TrackSpline } from './TrackSpline';

// ─────────────────────────────────────────────────────────────────────────────
// Cross-section
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Nominal columns across the ribbon, in half-width units. +u is LEFT.
 *
 * The pair at +-1.00 is the visible trail edge; the pair at +-1.09 is the skirt
 * that dives under the terrain to seal the seam. The 0.09 gap between them is
 * what makes the edge a near-vertical face rather than a ramp — about 50 degrees
 * on a 3m half-width, which is steep enough for the prepass normals to break
 * hard and the Sobel pass to draw a line.
 */
const COL_U = [-1.09, -1.0, -0.93, -0.66, -0.33, 0.0, 0.33, 0.66, 0.93, 1.0, 1.09];
const NC = COL_U.length;
const SKIRT_COLS = [0, NC - 1];

/** How far the skirt drops below whichever is lower: ribbon edge or terrain. */
const SKIRT_DROP = 0.42;
/**
 * The cap on how far below the TRAIL EDGE a skirt column may hang.
 *
 * Without it the skirt dives to `terrainHeight - SKIRT_DROP` no matter how far
 * the hillside has fallen away, so wherever the trail runs along an embankment
 * the sealing curtain becomes a visible fin metres deep and a quarter of a
 * metre wide — the orange spikes dripping below the lower trail edge into empty
 * air, and, at a switchback apex where a dozen rows pile up, a starburst of
 * them. Capped, the curtain stops at a plausible cut-bank depth: it still seals
 * everywhere the ground is close, and where the ground is not close the edge
 * reads as the finite bank the trail actually has.
 */
const SKIRT_MAX_DROP = 1.05;
/** Depth of the vertical end cap at a jump lip. Pure silhouette. */
const CAP_DEPTH = 1.25;
/** Metres of track per V unit of the trail texture. */
const UV_ALONG = 24;
/** Target chunk length. Small enough to cull, large enough not to thrash. */
const CHUNK_LENGTH = 150;

/**
 * Per-section albedo tint. Every value is within 16% of white — this is not
 * recolouring the trail, it is the difference between packed warm dirt and
 * broken cold stone, which is the amount a background painter would shift it.
 */
const SECTION_TINT: Record<TrackSectionKind, [number, number, number]> = {
  [TrackSectionKind.TechnicalStart]: [0.95, 0.95, 1.01],
  [TrackSectionKind.ScreeRun]: [1.02, 1.01, 1.0],
  [TrackSectionKind.Switchbacks]: [1.01, 0.99, 0.95],
  [TrackSectionKind.RockGarden]: [0.9, 0.92, 1.0],
  [TrackSectionKind.Tabletop]: [1.04, 1.02, 0.96],
  [TrackSectionKind.RavineGap]: [1.02, 1.0, 0.96],
  [TrackSectionKind.RidgeSprint]: [0.97, 0.97, 1.01],
  [TrackSectionKind.StreamBed]: [0.84, 0.89, 0.99],
  [TrackSectionKind.FinalSprint]: [1.03, 1.0, 0.95],
};

interface Row {
  d: number;
  pos: Float32Array; // NC * 3
  nrm: Float32Array; // NC * 3
  uv: Float32Array; // NC * 2
  col: Float32Array; // NC * 3
  ao: Float32Array; // NC
  /** Cap rows take a fixed normal and are excluded from surface smoothing. */
  fixedNormal: boolean;
}

interface Link {
  a: Row;
  b: Row;
}

const _c = new Vector3();
const _sl = new Vector3();
const _up = new Vector3();
const _tan = new Vector3();
const _along = new Vector3();
const _across = new Vector3();
const _n = new Vector3();

export class TrackRibbon {
  readonly object = new Group();
  readonly material: CelMaterial;
  private meshes: Mesh[] = [];

  constructor(private spline: TrackSpline, terrain: ITerrain) {
    this.object.name = 'track-ribbon';

    const rows: Row[] = [];
    const links: Link[] = [];
    this.buildRows(terrain, rows, links);

    this.material = buildRibbonMaterial(spline);

    // The ribbon and the ground are now COPLANAR by construction — the terrain
    // carve targets the ribbon surface exactly, because the heightfield is what
    // the bike collides with and the ribbon is what the player sees, so any gap
    // between them is a gap between where the wheels are and where the trail
    // looks like it is. The ground used to be carved 12 cm low purely to break
    // the depth tie, which bought a clean raster at the price of burying every
    // wheel in the game 12 cm under the track.
    //
    // Coplanar surfaces are a DEPTH problem and they get a depth fix — but the
    // bias lives on the TERRAIN, pushing the ground away, not here pulling the
    // ribbon nearer. See the note in `TerrainMaterial`: a ribbon biased toward
    // the camera also wins the depth test against the tyre standing on it, and
    // draws over the bottom of the wheel. Pulling the near surface forward is
    // the intuitive fix and it puts the trail in front of the bike.

    this.emitChunks(links);
  }

  // ───────────────────────────────────────────────────────────────────────────

  private buildRows(terrain: ITerrain, rows: Row[], links: Link[]): void {
    const spline = this.spline;
    const edgeNoise = new Noise2D('trail-edge');
    const pinchNoise = new Noise2D('trail-pinch');

    // Walk the centreline collecting runs of contiguous ground. A run ends at
    // the ravine and a new one starts on the far side; the two get end caps,
    // which is what gives the gap a silhouette instead of a torn hole.
    const runs: Row[][] = [];
    let current: Row[] = [];
    let d = 0;
    for (;;) {
      const dd = Math.min(d, spline.length);
      if (spline.isGap(dd)) {
        if (current.length) {
          runs.push(current);
          current = [];
        }
        d += 1.5;
      } else {
        current.push(this.buildRow(dd, terrain, edgeNoise, pinchNoise));
        d += this.stepAt(dd);
      }
      if (dd >= spline.length) break;
    }
    if (current.length) runs.push(current);

    for (const run of runs) {
      computeRunNormals(run);
      rows.push(...run);
      for (let i = 0; i < run.length - 1; i++) links.push({ a: run[i], b: run[i + 1] });
    }

    // End caps. The takeoff cap faces forward across the gap so it is the
    // silhouette the rider sees on approach; the landing cap faces back so the
    // far lip reads as a wall to clear rather than as a slot to fall into.
    for (let r = 0; r < runs.length; r++) {
      const run = runs[r];
      if (r < runs.length - 1) {
        const top = duplicateRow(run[run.length - 1], true);
        const bot = dropRow(top, CAP_DEPTH);
        this.faceRow(top, run[run.length - 1].d, 1);
        this.faceRow(bot, run[run.length - 1].d, 1);
        rows.push(top, bot);
        links.push({ a: top, b: bot });
      }
      if (r > 0) {
        const top = duplicateRow(run[0], true);
        const bot = dropRow(top, CAP_DEPTH);
        this.faceRow(top, run[0].d, -1);
        this.faceRow(bot, run[0].d, -1);
        rows.push(top, bot);
        links.push({ a: bot, b: top });
      }
    }
  }

  /** Row spacing: dense where the shape matters, sparse where it does not. */
  private stepAt(d: number): number {
    const s = this.spline;
    const i = clamp(Math.round(d / s.spacing), 0, s.count - 1);
    let step = 1.7;
    const k = Math.abs(s.curvature[i]);
    if (k > 0.008) step = Math.min(step, lerp(1.25, 0.55, clamp01((k - 0.008) / 0.05)));
    if (s.bermStrength[i] > 0.05) step = Math.min(step, 0.85);
    if (s.lipMask[i] > 0.02) step = Math.min(step, 0.4);
    return step;
  }

  private buildRow(d: number, terrain: ITerrain, edgeNoise: Noise2D, pinchNoise: Noise2D): Row {
    const s = this.spline;
    const i = clamp(Math.round(d / s.spacing), 0, s.count - 1);
    const sample = s.sampleAtDistance(d);
    _c.copy(sample.position);
    _up.copy(sample.up);
    s.surfaceLeftAt(d, _sl);

    const hwRide = sample.halfWidth;
    const berm = s.bermStrength[i];
    const bermSide = s.bermSide[i];

    // ── THE MESH HAS TO COVER THE GROUND THE CARVE PAINTED AS TRAIL ─────────
    //
    // `applyTrackCarve` stamps SurfaceKind.Trail over everything within 0.86 of
    // the CARVE half-width, and its comment says that is "strictly INSIDE the
    // ribbon mesh, so the mesh always covers the zone patch and its 2 m texel
    // edge can never be the visible boundary". That was true of the carve's own
    // half-width and false of THIS one: TrackSpline.getCarve widens the ribbon
    // half-width to hw * (1.22 + berm * 0.45) + 1.1 before handing it over. So
    // 0.86 of a widened width is not inside the un-widened mesh at all.
    //
    // Measured off the built geometry: the ribbon's drawn edge sits at a median
    // 4.16 m from the centreline and its skirt at 5.49 m, while the trail zone
    // runs out to 6.11 m. That leaves a ring of TERRAIN, one to two metres
    // wide, painted with the trail ramp and covered by nothing — the trail is
    // already visibly twelve metres wide in every frame; only the middle eight
    // of it is the ribbon.
    //
    // On flat ground the ring is invisible, because it is the same paint on the
    // same plane. Where the trail crosses a convex break it is the whole of the
    // valley-vista defect: the ring hangs over the fall-away, is seen at one to
    // two degrees of grazing incidence, and its outer boundary — a plan-view
    // level set on a folding surface, cusping wherever the fold turns — comes
    // out as a row of sharp downward tan spikes thirty to seventy pixels long.
    // Proved by elimination: hiding the ribbon leaves the spikes untouched, the
    // skirt measures a 0.20-1.45 m hang with at most 0.63 m of row-to-row
    // change, and painting the zone index flat picks the spikes out exactly.
    //
    // So the ribbon is built to the radius the carve painted, not to the radius
    // the rider is allowed. That does NOT widen the trail as it reads: the
    // twelve metres were already tan. What changes is that the outer ring is
    // now MESH — it takes the ribbon's own shading, its own AO-inked edge, its
    // own plan-view irregularity and its own G-buffer normal break, and the
    // tan/hillside boundary becomes a swept edge instead of a level set.
    //
    // hwRide is untouched and is still what the physics and the AI read.
    const carveHw = hwRide * (1.22 + berm * 0.45) + 1.1;
    const zoneR = carveHw * 0.86;
    // Divided by the wander so that even at its inward extreme the drawn edge
    // still clears the zone patch. 0.30 m of margin covers the zone map's own
    // 2 m texel quantisation and the sub-texel jitter the shader adds to it.
    const hw = Math.max(hwRide, (zoneR + 0.3) / EDGE_MIN);
    // The berm is a RIDEABLE wall, so its height stays keyed to the rideable
    // width. Scaling it with the drawn width would build a bank the rider has
    // no reason to expect.
    const bermHeight = berm * hwRide * 0.34;

    // ── Plan-view edge irregularity ──────────────────────────────────────────
    // Two scales per side plus an occasional pinch. Biased outward so the
    // drawn ribbon is never NARROWER than the half-width the physics and the
    // AI believe in — the irregularity is allowed to give the rider more room,
    // never less.
    const eL = edgeIrregularity(edgeNoise, pinchNoise, d, 0);
    const eR = edgeIrregularity(edgeNoise, pinchNoise, d, 71.3);

    const secTint = SECTION_TINT[SECTION_ORDER[s.sectionId[i]]] ?? [1, 1, 1];
    const lip = s.lipMask[i];

    const pos = new Float32Array(NC * 3);
    const nrm = new Float32Array(NC * 3);
    const uv = new Float32Array(NC * 2);
    const col = new Float32Array(NC * 3);
    const ao = new Float32Array(NC);

    for (let c = 0; c < NC; c++) {
      const u = COL_U[c];
      const au = Math.abs(u);
      const side = Math.sign(u);
      const edge = u > 0 ? eL : eR;
      const isSkirt = c === SKIRT_COLS[0] || c === SKIRT_COLS[1];

      // Blend the edge wander in over the outer third so the centre of the
      // trail stays where the spline says it is.
      let uEff = u * lerp(1, edge, smoothstep(0.3, 0.93, au));
      // A berm needs its outer skirt pushed well clear so the flank is a slope
      // rather than a cliff.
      if (isSkirt && side === bermSide && berm > 0) uEff = side * (au + berm * 0.75);

      // Never let a column reach the centre of curvature. Beyond that radius
      // the swept surface folds through itself and the inside of the corner
      // renders as inverted, self-intersecting triangles.
      let lateral = uEff * hw;
      const kappa = s.curvature[i];
      if (kappa > 1e-5) lateral = Math.min(lateral, 0.62 / kappa);
      else if (kappa < -1e-5) lateral = Math.max(lateral, 0.62 / kappa);

      let x = _c.x + _sl.x * lateral;
      let y = _c.y + _sl.y * lateral;
      let z = _c.z + _sl.z * lateral;

      // Berm rise on the outer side only. Quartic-ish so the transition out of
      // the flat is smooth and the top of the wall is steep.
      if (berm > 0 && side === bermSide && !isSkirt) {
        y += bermHeight * Math.pow(clamp01((au - 0.35) / 0.68), 1.85);
      }
      // A whisper of crown on the flat sections. Not drainage realism — it
      // keeps the ribbon from reading as a perfect plane in a wide shot.
      if (!isSkirt) y -= 0.028 * hw * au * au * (1 - berm);
      // The lip crest is deliberately flat across its full width.
      if (lip > 0.01 && !isSkirt) y += 0;

      if (isSkirt) {
        const tY = terrain.heightAt(x, z);
        const ground = Number.isFinite(tY) ? Math.min(y, tY) : y;
        // See SKIRT_MAX_DROP. y here is still the trail-edge height at this
        // column, which is what the cap has to be measured from.
        y = Math.max(ground - SKIRT_DROP, y - SKIRT_MAX_DROP);
        // AND IT MUST STAY BELOW THE EDGE IT IS SEALING.
        //
        // The skirt sits at 1.09 half-widths and the trail edge at 1.00, so on
        // a banked section the skirt's own base height is already above the
        // edge's — by 0.09 of the bank across the half-width. That was worth
        // 0.1 m on the old width and is worth more on the width the mesh now
        // has to cover, which measured as a skirt hanging 0.84 m ABOVE the
        // trail edge on the high side of the bank: a sealing curtain turned
        // into a raised outer rail. Clamped, the curtain is a curtain again.
        const latEdge = side * edge * hw;
        y = Math.min(y, _c.y + _sl.y * latEdge - SKIRT_DROP);
      }

      pos[c * 3] = x;
      pos[c * 3 + 1] = y;
      pos[c * 3 + 2] = z;

      uv[c * 2] = (u + 1) * 0.5;
      uv[c * 2 + 1] = d / UV_ALONG;

      col[c * 3] = secTint[0];
      col[c * 3 + 1] = secTint[1];
      col[c * 3 + 2] = secTint[2];

      // Vertex AO is doing double duty as the ink: celShade drives occluded
      // vertices toward the darkest band colour rather than toward black, so a
      // dark crest reads as the shadowed cut edge of the trail, in palette.
      let a = 1 - 0.14 * smoothstep(0.35, 0.93, au);
      if (c === 2 || c === NC - 3) a = 0.52;
      if (c === 1 || c === NC - 2) a = 0.28;
      if (isSkirt) a = 0.08;
      // The built-up outer face of a berm catches light; it must not be inked
      // like a cut edge or the corner loses its shape.
      if (berm > 0 && side === bermSide) a = lerp(a, Math.min(1, a + 0.5), berm);
      ao[c] = a;
    }

    return { d, pos, nrm, uv, col, ao, fixedNormal: false };
  }

  /** Force a whole row's normals to +-tangent — used for the jump end caps. */
  private faceRow(row: Row, d: number, sign: number): void {
    const s = this.spline;
    const i = clamp(Math.round(d / s.spacing), 0, s.count - 1);
    _tan.set(s.tx[i], 0, s.tz[i]).normalize().multiplyScalar(sign);
    for (let c = 0; c < NC; c++) {
      row.nrm[c * 3] = _tan.x;
      row.nrm[c * 3 + 1] = _tan.y;
      row.nrm[c * 3 + 2] = _tan.z;
      // The cap face is a cut bank: dark, and outside the rideable surface.
      row.ao[c] = 0.22;
    }
    row.fixedNormal = true;
  }

  // ───────────────────────────────────────────────────────────────────────────

  private emitChunks(links: Link[]): void {
    let start = 0;
    while (start < links.length) {
      let end = start;
      const d0 = links[start].a.d;
      while (end < links.length && Math.abs(links[end].b.d - d0) < CHUNK_LENGTH) end++;
      if (end === start) end = start + 1;
      this.emitChunk(links.slice(start, end), this.meshes.length);
      // Chunks share their boundary link's rows by simply not overlapping —
      // the boundary row is duplicated into both chunks with identical values,
      // so the seam is invisible and no triangle is emitted twice.
      start = end;
    }
  }

  private emitChunk(links: Link[], index: number): void {
    const rowIndex = new Map<Row, number>();
    const order: Row[] = [];
    for (const l of links) {
      if (!rowIndex.has(l.a)) {
        rowIndex.set(l.a, order.length);
        order.push(l.a);
      }
      if (!rowIndex.has(l.b)) {
        rowIndex.set(l.b, order.length);
        order.push(l.b);
      }
    }

    const vcount = order.length * NC;
    const position = new Float32Array(vcount * 3);
    const normal = new Float32Array(vcount * 3);
    const uv = new Float32Array(vcount * 2);
    const color = new Float32Array(vcount * 3);
    const aAo = new Float32Array(vcount);

    for (let r = 0; r < order.length; r++) {
      const row = order[r];
      position.set(row.pos, r * NC * 3);
      normal.set(row.nrm, r * NC * 3);
      uv.set(row.uv, r * NC * 2);
      color.set(row.col, r * NC * 3);
      aAo.set(row.ao, r * NC);
    }

    const indices: number[] = [];
    for (const l of links) {
      const ra = rowIndex.get(l.a)! * NC;
      const rb = rowIndex.get(l.b)! * NC;
      for (let c = 0; c < NC - 1; c++) {
        // Winding chosen so cross(b - a, across) is the face normal; see the
        // note in buildRows about which way each cap has to face.
        indices.push(ra + c, rb + c, ra + c + 1);
        indices.push(ra + c + 1, rb + c, rb + c + 1);
      }
    }

    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(position, 3));
    geo.setAttribute('normal', new BufferAttribute(normal, 3));
    geo.setAttribute('uv', new BufferAttribute(uv, 2));
    geo.setAttribute('color', new BufferAttribute(color, 3));
    geo.setAttribute('aAo', new BufferAttribute(aAo, 1));
    geo.setIndex(indices);
    // No hull on the ribbon, but the prepass still reads aCurvature to taper
    // interior lines, so the geometry goes through finalizeGeometry anyway.
    finalizeGeometry(geo, { tolerance: 1e-3, maxWeldAngle: 100, curvatureGain: 0.8 });

    const mesh = new Mesh(geo, this.material);
    mesh.name = `ribbon:${index}`;
    mesh.receiveShadow = true;
    // Berms and lips are the two places the ribbon casts a shadow that means
    // something. The shadow material culls front faces, which keeps the huge
    // flat expanse from acneing onto itself.
    mesh.castShadow = true;
    mesh.frustumCulled = true;
    registerNprMesh(mesh, this.material);
    this.meshes.push(mesh);
    this.object.add(mesh);
  }

  dispose(): void {
    for (const m of this.meshes) m.geometry.dispose();
    this.meshes.length = 0;
    disposeCelMaterial(this.material);
    this.object.clear();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Edge scale for one side of the ribbon at a distance. Returns a multiplier
 * >= 1: two octaves of wander plus a rare outward scallop where the trail has
 * been widened by a braid around a rock.
 */
function edgeIrregularity(n: Noise2D, pinch: Noise2D, d: number, phase: number): number {
  // EVERY OCTAVE HERE IS BAND-LIMITED TO THE ROW SPACING.
  //
  // The fastest octave used to run at 0.24 cycles per metre — a 4.2 m period —
  // and `stepAt` places rows 1.7 m apart on open trail. Two and a half samples
  // per cycle is Nyquist to within a rounding error, so the reconstructed edge
  // alternated in and out row by row and the lower trail edge came out as a
  // row of two dozen large triangular teeth: a textbook aliasing sawtooth
  // dressed up as irregularity.
  //
  // The floor is now six rows per cycle on the fastest term (0.098 cycles/m at
  // 1.7 m spacing), which is enough to reconstruct the wander as a curve. The
  // amplitude moves to the slower octaves to keep the same total wander.
  const slow = n.noise(d * 0.032 + phase, 11.3);
  const mid = n.noise(d * 0.082 + phase, 4.7);
  const scallop = Math.max(0, pinch.noise(d * 0.017 + phase, 21.1) - 0.42) * 0.62;
  return EDGE_BASE + slow * EDGE_SLOW + mid * EDGE_MID + scallop;
}

const EDGE_BASE = 1.07;
const EDGE_SLOW = 0.075;
const EDGE_MID = 0.026;
/**
 * The inward extreme of `edgeIrregularity`. Noise2D returns [-1, 1] and the
 * scallop is one-sided outward, so this is the whole of it.
 *
 * Named because buildRow has to divide by it: the ribbon must clear the trail
 * zone patch at every row, and the row where it comes closest to failing is the
 * row where the wander happens to be at its most inward.
 */
const EDGE_MIN = EDGE_BASE - EDGE_SLOW - EDGE_MID;

function duplicateRow(src: Row, fixedNormal: boolean): Row {
  return {
    d: src.d,
    pos: src.pos.slice(),
    nrm: src.nrm.slice(),
    uv: src.uv.slice(),
    col: src.col.slice(),
    ao: src.ao.slice(),
    fixedNormal,
  };
}

function dropRow(src: Row, depth: number): Row {
  const r = duplicateRow(src, src.fixedNormal);
  for (let c = 0; c < NC; c++) r.pos[c * 3 + 1] -= depth;
  return r;
}

/**
 * How many rows the along-track difference spans, each side.
 *
 * A one-row central difference is what made the ribbon render as a run of
 * separately-valued paving slabs. Rows are at most 1.7 m apart, the terrain
 * they follow is not smooth at that scale, and so every row ended up with its
 * own slightly different pitch. Feed a wobble of a couple of degrees into a
 * HARD cel ramp at a grazing angle and consecutive rows fall on opposite sides
 * of a band threshold — the quads become visible as flat plates with a seam
 * between each pair, which is the one thing a swept surface must never do.
 *
 * Three rows each side, plus the smoothing below, leaves the ribbon one
 * continuous banded surface whose band edges run ACROSS the trail, following
 * the real change of gradient rather than the tessellation.
 */
const NORMAL_SPAN = 3;
/** Passes of a [1,2,1] filter along the track after the difference. */
const NORMAL_SMOOTH_PASSES = 2;

function computeRunNormals(run: Row[]): void {
  for (let r = 0; r < run.length; r++) {
    const row = run[r];
    if (row.fixedNormal) continue;
    const prev = run[Math.max(0, r - NORMAL_SPAN)];
    const next = run[Math.min(run.length - 1, r + NORMAL_SPAN)];
    for (let c = 0; c < NC; c++) {
      const c0 = Math.max(0, c - 1);
      const c1 = Math.min(NC - 1, c + 1);
      _along.set(
        next.pos[c * 3] - prev.pos[c * 3],
        next.pos[c * 3 + 1] - prev.pos[c * 3 + 1],
        next.pos[c * 3 + 2] - prev.pos[c * 3 + 2],
      );
      _across.set(
        row.pos[c1 * 3] - row.pos[c0 * 3],
        row.pos[c1 * 3 + 1] - row.pos[c0 * 3 + 1],
        row.pos[c1 * 3 + 2] - row.pos[c0 * 3 + 2],
      );
      _n.crossVectors(_along, _across);
      if (_n.lengthSq() < 1e-12) _n.set(0, 1, 0);
      else _n.normalize();
      if (_n.y < 0) _n.negate();
      row.nrm[c * 3] = _n.x;
      row.nrm[c * 3 + 1] = _n.y;
      row.nrm[c * 3 + 2] = _n.z;
    }
  }
  smoothRunNormals(run);
}

/**
 * Low-pass the row normals ALONG the track only.
 *
 * Along the track, because that is the axis the aliasing is on. Across the
 * track there is a deliberate crease at every edge column and a berm wall to
 * hold, and smoothing that direction would round off exactly the breaks the
 * Sobel pass is supposed to ink.
 */
function smoothRunNormals(run: Row[]): void {
  if (run.length < 3) return;
  const stride = NC * 3;
  const tmp = new Float32Array(run.length * stride);

  for (let p = 0; p < NORMAL_SMOOTH_PASSES; p++) {
    for (let r = 0; r < run.length; r++) {
      const a = run[Math.max(0, r - 1)].nrm;
      const b = run[r].nrm;
      const c = run[Math.min(run.length - 1, r + 1)].nrm;
      const base = r * stride;
      for (let k = 0; k < stride; k++) tmp[base + k] = (a[k] + 2 * b[k] + c[k]) * 0.25;
    }
    for (let r = 0; r < run.length; r++) {
      const row = run[r];
      if (row.fixedNormal) continue;
      const base = r * stride;
      for (let c = 0; c < NC; c++) {
        const x = tmp[base + c * 3];
        const y = tmp[base + c * 3 + 1];
        const z = tmp[base + c * 3 + 2];
        const l = Math.hypot(x, y, z) || 1;
        row.nrm[c * 3] = x / l;
        row.nrm[c * 3 + 1] = y / l;
        row.nrm[c * 3 + 2] = z / l;
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Material
// ─────────────────────────────────────────────────────────────────────────────

function buildRibbonMaterial(spline: TrackSpline): CelMaterial {
  const mat = new CelMaterial(RAMPS.trail, {
    name: 'track-ribbon',
    idName: 'trail',
    vertexColors: true,
    vertexAo: true,
    outlineWidth: 0,
    uniforms: {
      uTrailTex: { value: trailSurface() },
      uTrackProfile: { value: spline.profileTexture() },
      uTrackLength: { value: spline.length },
      uUvAlong: { value: UV_ALONG },
    },
    fragmentPreamble: /* glsl */ `
      uniform sampler2D uTrailTex;
      uniform sampler2D uTrackProfile;
      uniform float uTrackLength;
      uniform float uUvAlong;

      /**
       * A texture fetch whose footprint is forced back toward ISOTROPIC.
       *
       * The trail is a near-flat plane running from under the wheels to the
       * horizon, so most of its visible area is seen at a raking angle where
       * one pixel covers tens of texels along the view direction and two or
       * three across it. Hardware anisotropic filtering picks its mip level
       * from the SHORT axis and then takes at most eight taps along the long
       * one, so past an eight-to-one ratio it is sampling a sharp mip far too
       * sparsely — which is exactly the one-pixel alternating scanline the
       * review measured for two hundred consecutive rows on this surface.
       *
       * Growing the short axis until the ratio is inside what the sampler can
       * resolve costs a little sharpness at a grazing angle and buys a surface
       * that holds still. The same helper, for the same reason, is in
       * TerrainMaterial; the two must agree or the trail and the ground beside
       * it would go soft at different distances.
       */
      vec4 isoSample(sampler2D tex, vec2 uv) {
        vec2 dx = dFdx(uv);
        vec2 dy = dFdy(uv);
        float lx = max(length(dx), 1e-9);
        float ly = max(length(dy), 1e-9);
        float need = max(lx, ly) * 0.1667;
        dx *= max(1.0, need / lx);
        dy *= max(1.0, need / ly);
        return textureGrad(tex, uv, dx, dy);
      }

      /**
       * The ground's tonal ladder, IMPORTED VERBATIM from TerrainMaterial.
       *
       * Not re-typed, not adapted — the same exported string. The near-field
       * tonal shapes cross the trail edge, so a shape that ended at a
       * different value on one side of that line would draw the trail edge a
       * second time, in the wrong place, with no stroke on it. Two copies of a
       * quantiser this fiddly will always drift apart; this is the same
       * lesson, and the same remedy, as the single shared sampleZone().
       */
      ${TERRAIN_GROUND_SHAPES}
    `,
    fragmentBody: /* glsl */ `
      // ── Trail surface detail ─────────────────────────────────────────────
      // Everything below is quantised. Nothing here is allowed to introduce a
      // smooth gradient: this is the largest surface in the frame, and one
      // continuous ramp across it would give the whole cel treatment away.
      float dAlong = vUv.y * uUvAlong;
      float across = vUv.x * 2.0 - 1.0;

      // The track profile lookup. One texel per 0.9m of course, carrying what
      // KIND of ground this is: curvature, wetness, rockiness, lip.
      vec4 prof = texture(uTrackProfile, vec2(clamp(dAlong / uTrackLength, 0.0, 1.0), 0.5));
      float curv = (prof.r - 0.5) * 2.0;
      float wet  = prof.g;
      float rock = prof.b;
      float lipM = prof.a;

      // The lookup is DOMAIN-WARPED. uTrailTex is a generated surface with
      // concentric structure in it, and the ribbon's uv is a rectangle — one
      // tile per 24 m of course by the full width — so straight sampling lays
      // visible nested rings down the middle of the trail, which read as wood
      // grain on a dirt road. Two cheap noise octaves tear the rings into
      // patches without touching the texture's statistics.
      vec2 trailWarp = vec2(
        vnoise(vec2(dAlong * 0.075, across * 2.1)),
        vnoise(vec2(dAlong * 0.075 + 13.1, across * 2.1))
      ) - 0.5;
      vec4 tr = isoSample(uTrailTex, vUv + trailWarp * vec2(0.26, 0.075));
      float wear = tr.r;
      float gravel = tr.g;
      float moisture = tr.b;

      // Two braided tyre lines. They polish where the corner is, because
      // everyone brakes and rails in the same place; a uniform pair of lines
      // down the whole mountain reads as wallpaper.
      float polish = mix(0.30, 1.0, min(abs(curv) * 1.7, 1.0));
      float line = bandStep(wear * polish, 0.26, 0.015);
      celCol = mix(celCol, celCol * 1.15 + vec3(0.022, 0.016, 0.010), line * 0.55);

      // Loose stone. The rock garden is not a texture swap: it is the same
      // ground with the speckle turned up until it stops reading as dirt.
      float speck = 1.0 - bandStep(gravel, 0.21 + rock * 0.10, 0.02);
      celCol = mix(celCol, celCol * vec3(0.84, 0.855, 0.93), speck * (0.16 + rock * 0.52));

      // Wet rock in the stream bed. Darker, bluer, and the only ground on the
      // course with a real highlight — which is the entire warning.
      if (wet > 0.002) {
        vec3 wetCol = celCol * vec3(0.60, 0.68, 0.88);
        // POWER 4, NOT 110. With the committed sun at 21.5 degrees and a chase
        // camera looking down about 25, N.H on level ground tops out near 0.4 —
        // and pow(0.4, 110) is zero to every float in the machine. The one
        // stretch of course that is supposed to be visibly WET carried a
        // highlight declaration that could never produce a lit pixel. A cel
        // highlight is a drawn shape, not a microfacet distribution: it only
        // has to land where a painter would put it, and this exponent is the
        // one the geometry can actually reach.
        float sheen = bandedSpecular(N, V, uSunDir, 4.0);
        wetCol += vec3(0.42, 0.52, 0.60) * sheen * saturate1(dot(N, uSunDir) * 2.0);
        celCol = mix(celCol, wetCol, wet * mix(0.65, 1.0, moisture));
      }

      // The takeoff lip. Deliberately not subtle: a bleached, packed strip a
      // full band brighter than the trail either side of it, so the rider can
      // see exactly where to leave the ground from the top of the approach.
      if (lipM > 0.004) {
        celCol = mix(celCol, uBandColor[3] * 1.04, bandStep(lipM, 0.30, 0.05) * 0.72);
      }

      // ── The trail edge: a SHOULDER first, then the line on top of it ──────
      //
      // The review logged this as a "hard horizontal terrain LOD seam, full
      // frame width, where the near clipmap ring meets the next". It is not the
      // clipmap. Hiding the ribbon in rider-closeup removes the line and hiding
      // the terrain does not, and neither the id nor the depth channel of the
      // outline pass has anything at that pixel — so it is this block, drawn on
      // the geometry, and nothing else.
      //
      // What made it read as a seam rather than as a trail edge is that there
      // was nothing on either side of it. The ribbon and the ground it is cut
      // into are both painted from RAMPS.trail and now carry the same plate
      // ladder and the same world-space tonal shapes, so the two surfaces meet
      // at the same value; and the inked band is a fixed FRACTION of the
      // half-width, which on a trail seen almost edge-on from a chase camera is
      // one device pixel. A one-pixel dark line running the width of the frame
      // through a field of one flat colour is a scratch on the cel, whatever
      // drew it.
      //
      // A background painter draws a trail edge as a BAND: the outer third of
      // the tread is looser, scuffed and a shade darker, and the line sits at
      // the outside of that band. The shoulder is a third of the half-width —
      // about a metre — so it survives any viewing angle, and it is quantised
      // because everything on this surface is.
      float wob = fbm2(vec2(dAlong * 0.85, 3.1), 3);
      float shoulder = bandStep(abs(across), 0.70 + (wob - 0.5) * 0.10, 0.012);
      celCol *= mix(1.0, 0.945, shoulder);

      // The line itself. The plan-view irregularity lives in the geometry; this
      // is the value break that turns a boundary into a drawn stroke, with a
      // little wander in the threshold so it never runs perfectly parallel to
      // the spline.
      float edgeT = bandStep(abs(across), 0.895 + (wob - 0.5) * 0.055, 0.008);
      celCol = mix(celCol, mix(celCol, uBandColor[0], 0.62), edgeT);

      // ── Aerial plates ────────────────────────────────────────────────────
      // Same construction, and for exactly the same reason, as the block of
      // the same name in TerrainMaterial: the trail is a near-flat plane
      // running from under the wheels to the horizon, so its shading term is
      // very nearly constant over its whole visible length. Everything above
      // is quantised, which means that without this the ribbon has NOTHING
      // varying along it and renders as one continuous wash — the largest
      // single shape in most frames in this game, painted as a gradient.
      //
      // THE SAME SEVEN-STEP LADDER THE TERRAIN USES, and it has to be the same
      // one: the ribbon and the ground it is cut into meet along a line that
      // runs the whole height of the frame, and two plate stacks with different
      // boundaries would draw a value step on one side of that line and not the
      // other. Boundaries at 4.7, 10.0, 21.3, 45.3, 96.5 and 205 m. Every
      // constant below is copied from TerrainMaterial and has to stay copied.
      //
      // What is NOT shared is the old strength. This block used to cap at 0.43
      // and then mix 62% of THAT — 26.6% of a pure cool SKY_BOUNCE — into every
      // pixel of the trail past sixty metres. On the surface the player looks at
      // for the entire run, that is a quarter of the frame painted in sky blue:
      // the trail measured 30% saturation against an authored 56%, and its hue
      // had rotated as far as magenta. A value MULTIPLY carries the step
      // instead, because it moves lightness without touching hue or chroma, and
      // the haze mix left on top is a sixth of what it was.
      float aerialT = saturate1(log2(clamp(vViewDist, 2.2, 420.0) / 2.2) / 7.577);
      float plate = floor(aerialT * 7.0 + 0.5) / 7.0;
      float hazeSun = saturate1(dot(normalize(-V), uSunDir));
      hazeSun = hazeSun * hazeSun;
      celCol = mix(celCol, mix(uSkyBounce * 1.30, uFogSunTint * 1.10, hazeSun * 0.72), plate * 0.18);
      celCol *= mix(0.85, 1.42, plate);

      // ── Ground shapes ────────────────────────────────────────────────────
      // The plate ladder cannot help the near field and never will. A distance
      // trace down a chase frame puts the bottom forty per cent of the picture
      // on ground six to nine metres away spanning about 1.7 m of world: one
      // plate, one lit value, one of everything. The measured column was 259
      // rows without a step of even three levels.
      //
      // Sampled in WORLD space rather than in ribbon uv, so a shape running
      // off the side of the trail continues across the ground beside it. A
      // shape that stopped dead at the trail edge would draw that edge twice.
      celCol *= groundShapeGain(vWorldPos.xz);
    `,
  });
  // CelMaterial sets the NPR_VERTEX_COLOR define but three only declares the
  // `color` attribute when the Material flag itself is set.
  mat.vertexColors = true;
  return mat;
}
