/**
 * Foliage — conifers, grass and wildflowers.
 *
 * Everything here is instanced, streamed by the pools in Scatter.ts, and moved
 * by the shared wind in CelMaterial's vertex shader. What is worth explaining
 * is the shape of the LOD, because foliage LOD is where stylised renderers
 * usually come apart.
 *
 * ── WHY THE NEAR TREE IS SOLID GEOMETRY ─────────────────────────────────────
 * The cheap answer to trees is crossed alpha cards all the way in. It fails
 * here for a specific reason: this pipeline draws inverted-hull outlines and
 * screen-space interior lines, and both of them describe SHAPE. A crossed card
 * seen from thirty degrees off its plane has the silhouette of a folded piece
 * of paper, and the outline pass will faithfully ink that folded paper. Solid
 * cones have a real silhouette from every angle, so the ink lands on a tree.
 *
 * ── WHY THE FAR TREE IS A CARD ANYWAY ───────────────────────────────────────
 * Past about a hundred and fifty metres the fog bands have flattened everything
 * into a single value, the outline has tapered to its minimum width, and the
 * whole tree is nine pixels tall. At that point a card and a cone are the same
 * picture and the card is a twentieth of the vertices. The far tier also drops
 * out of the G-buffer and the shadow cascades entirely: interior lines on a
 * nine-pixel tree would be noise, and its shadow is well past the far cascade.
 *
 * ── WHY THE TRANSITION DISSOLVES ────────────────────────────────────────────
 * A hard LOD switch on a tree line is one of the most visible artefacts in any
 * open-world renderer, because the eye is extremely good at spotting a change
 * in a repeated pattern. The two tiers overlap by a wide band and cross-fade
 * through the ordered dither in Scatter.ts, so a tree becomes stipple, then
 * becomes a different tree, and there is never a frame where something changes
 * shape.
 *
 * ── WHY THE WIND IS IN OBJECT SPACE ─────────────────────────────────────────
 * The shared wind chunk displaces before the instance matrix is applied, and
 * weights by `aSway` squared. Two consequences: a whole forest leans coherently
 * instead of each tree sliding independently, and the trunk base is pinned at
 * exactly zero displacement, so no tree ever detaches from the ground. The sway
 * attribute here is written against the FULL tree height rather than each
 * part's own bounding box, which is the only way the trunk and the canopy that
 * sits on it move by the same amount at the same height.
 */

import {
  BufferAttribute,
  BufferGeometry,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  InstancedBufferAttribute,
  Object3D,
} from 'three';

import { clamp01 } from '../core/MathX';
import { canopyCard, grassCard } from '../npr/GeneratedTextures';
import { finalizeGeometry } from '../npr/OutlineGeometry';
import { CelMaterial } from '../npr/CelMaterial';
import { TrackCarve } from '../game/Contracts';
import {
  InstanceField,
  InstanceGroup,
  PoolTier,
  ScatterPool,
  ScatterSource,
  buildInstanced,
  generateInstances,
  makeRule,
} from './Scatter';

// ─────────────────────────────────────────────────────────────────────────────
// Geometry helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Concatenate a handful of primitive geometries into one buffer.
 *
 * Deliberately minimal — position, normal, uv and an index, which is exactly
 * what the primitives in use produce. Anything richer would be reimplementing
 * a merge utility for no benefit, and anything less would force one draw call
 * per cone.
 */
function mergeSimple(parts: BufferGeometry[]): BufferGeometry {
  let vcount = 0;
  let icount = 0;
  for (const g of parts) {
    const p = g.getAttribute('position') as BufferAttribute;
    vcount += p.count;
    const idx = g.getIndex();
    icount += idx ? idx.count : p.count;
  }

  const position = new Float32Array(vcount * 3);
  const normal = new Float32Array(vcount * 3);
  const uv = new Float32Array(vcount * 2);
  const index = new Uint16Array(icount);

  let vo = 0;
  let io = 0;
  for (const g of parts) {
    const p = g.getAttribute('position') as BufferAttribute;
    const n = g.getAttribute('normal') as BufferAttribute;
    const t = g.getAttribute('uv') as BufferAttribute | undefined;
    position.set(p.array as Float32Array, vo * 3);
    if (n) normal.set(n.array as Float32Array, vo * 3);
    if (t) uv.set(t.array as Float32Array, vo * 2);
    const idx = g.getIndex();
    if (idx) {
      for (let i = 0; i < idx.count; i++) index[io++] = idx.getX(i) + vo;
    } else {
      for (let i = 0; i < p.count; i++) index[io++] = i + vo;
    }
    vo += p.count;
    g.dispose();
  }

  const out = new BufferGeometry();
  out.setAttribute('position', new BufferAttribute(position, 3));
  out.setAttribute('normal', new BufferAttribute(normal, 3));
  out.setAttribute('uv', new BufferAttribute(uv, 2));
  out.setIndex(new BufferAttribute(index, 1));
  return out;
}

/**
 * Wind weight, normalised against the whole plant rather than against this
 * piece of it.
 *
 * `addSwayAttribute` in OutlineGeometry.ts normalises by the geometry's own
 * bounding box, which is right for a single mesh and wrong for a tree split
 * into a trunk mesh and a canopy mesh: the top of the trunk would sway a full
 * unit while the base of the canopy resting on it swayed a tenth of one, and
 * the tree would come apart in the wind.
 */
function applySway(geo: BufferGeometry, totalHeight: number, power = 1.7): void {
  const pos = geo.getAttribute('position') as BufferAttribute;
  const sway = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    sway[i] = Math.pow(clamp01(pos.getY(i) / totalHeight), power);
  }
  geo.setAttribute('aSway', new BufferAttribute(sway, 1));
}

/** A vertical quad centred on x, rising from y=0. Used for every card. */
function cardGeometry(halfWidth: number, height: number, yaw: number): BufferGeometry {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const position = new Float32Array([
    -halfWidth * c, 0, -halfWidth * s,
    halfWidth * c, 0, halfWidth * s,
    halfWidth * c, height, halfWidth * s,
    -halfWidth * c, height, -halfWidth * s,
  ]);
  // The card's normal faces along its own perpendicular. Both faces are drawn
  // (DoubleSide) and the cel fragment shader flips the normal on backfaces, so
  // a card lit from behind still shades as a lit surface rather than as a hole.
  const nx = -s;
  const nz = c;
  const normal = new Float32Array([nx, 0, nz, nx, 0, nz, nx, 0, nz, nx, 0, nz]);
  const uv = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
  const index = new Uint16Array([0, 1, 2, 0, 2, 3]);

  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(position, 3));
  geo.setAttribute('normal', new BufferAttribute(normal, 3));
  geo.setAttribute('uv', new BufferAttribute(uv, 2));
  geo.setIndex(new BufferAttribute(index, 1));
  return geo;
}

// ─────────────────────────────────────────────────────────────────────────────
// Conifers
// ─────────────────────────────────────────────────────────────────────────────

export interface ConiferShape {
  height: number;
  trunkRadius: number;
  /** Cone tiers: [baseY, radius, height] each. */
  tiers: [number, number, number][];
  radialSegments: number;
}

export const CONIFER_SHAPES: ConiferShape[] = [
  {
    height: 7.4,
    trunkRadius: 0.20,
    tiers: [
      [1.35, 1.62, 3.0],
      [3.05, 1.24, 2.7],
      [4.60, 0.82, 2.8],
    ],
    radialSegments: 8,
  },
  {
    // Narrower, taller, fewer tiers — the wind-shaped tree you get near the
    // top of a tree line. Mixed into the same forest so the canopy silhouette
    // is not one shape repeated.
    height: 8.8,
    trunkRadius: 0.17,
    tiers: [
      [1.8, 1.28, 3.6],
      [3.9, 0.94, 3.3],
      [5.9, 0.58, 2.9],
    ],
    radialSegments: 7,
  },
];

function buildTrunkGeometry(shape: ConiferShape): BufferGeometry {
  const h = shape.height * 0.78;
  const geo = new CylinderGeometry(shape.trunkRadius * 0.42, shape.trunkRadius, h, 6, 1, false);
  geo.translate(0, h * 0.5, 0);
  applySway(geo, shape.height, 2.1);
  return finalizeGeometry(geo, {
    tolerance: 1e-3,
    maxWeldAngle: 180,
    ao: true,
    aoStrength: 0.45,
  });
}

function buildCanopyGeometry(shape: ConiferShape): BufferGeometry {
  const parts: BufferGeometry[] = [];
  for (const [baseY, radius, height] of shape.tiers) {
    const cone = new ConeGeometry(radius, height, shape.radialSegments, 1, true);
    cone.translate(0, baseY + height * 0.5, 0);
    parts.push(cone);
  }
  const geo = mergeSimple(parts);
  geo.computeVertexNormals();
  applySway(geo, shape.height, 1.6);
  return finalizeGeometry(geo, {
    tolerance: 1e-3,
    maxWeldAngle: 180,
    curvatureGain: 0.9,
    ao: true,
    aoStrength: 0.5,
  });
}

/** Two crossed alpha cards carrying the generated conifer silhouette. */
function buildTreeCardGeometry(shape: ConiferShape): BufferGeometry {
  const halfWidth = shape.tiers[0][1] * 1.15;
  const geo = mergeSimple([
    cardGeometry(halfWidth, shape.height, 0),
    cardGeometry(halfWidth, shape.height, Math.PI / 2),
  ]);
  applySway(geo, shape.height, 1.5);
  return finalizeGeometry(geo, { tolerance: 1e-3 });
}

// ─────────────────────────────────────────────────────────────────────────────
// Ground cover
// ─────────────────────────────────────────────────────────────────────────────

function buildTuftGeometry(): BufferGeometry {
  const h = 0.62;
  const w = 0.30;
  const geo = mergeSimple([
    cardGeometry(w, h, 0),
    cardGeometry(w, h * 0.86, Math.PI / 3),
    cardGeometry(w * 0.9, h * 0.94, (2 * Math.PI) / 3),
  ]);
  applySway(geo, h, 1.25);
  return finalizeGeometry(geo, { tolerance: 1e-3 });
}

/**
 * A wildflower, built as geometry rather than as a card.
 *
 * At the scale these are drawn — a couple of hundred millimetres, in the near
 * field only — an alpha card costs a texture fetch and an alpha test to draw
 * five flat triangles' worth of shape. Building the five triangles is cheaper
 * and, more usefully, gives the flower a real silhouette for the outline pass,
 * so a bloom in the foreground gets an ink edge like everything else does.
 */
function buildFlowerGeometry(): BufferGeometry {
  const stemH = 0.26;
  const petalR = 0.075;
  const petals = 5;

  const vcount = 4 + petals * 3;
  const position = new Float32Array(vcount * 3);
  const normal = new Float32Array(vcount * 3);
  const uv = new Float32Array(vcount * 2);
  const idx: number[] = [];

  // Stem: a narrow upright quad.
  const sw = 0.012;
  position.set([-sw, 0, 0, sw, 0, 0, sw, stemH, 0, -sw, stemH, 0], 0);
  for (let i = 0; i < 4; i++) {
    normal[i * 3 + 2] = 1;
    uv[i * 2] = i === 1 || i === 2 ? 1 : 0;
    uv[i * 2 + 1] = i >= 2 ? 1 : 0;
  }
  idx.push(0, 1, 2, 0, 2, 3);

  // Head: a fan of petal triangles lying nearly flat, tipped up a little so it
  // catches the low sun rather than presenting an edge to it.
  const tilt = 0.34;
  for (let p = 0; p < petals; p++) {
    const base = 4 + p * 3;
    const a0 = (p / petals) * Math.PI * 2;
    const a1 = ((p + 0.62) / petals) * Math.PI * 2;
    const y = stemH;
    position.set([0, y, 0], base * 3);
    position.set(
      [Math.cos(a0) * petalR, y + Math.sin(a0) * petalR * tilt, Math.sin(a0) * petalR],
      (base + 1) * 3,
    );
    position.set(
      [Math.cos(a1) * petalR, y + Math.sin(a1) * petalR * tilt, Math.sin(a1) * petalR],
      (base + 2) * 3,
    );
    for (let k = 0; k < 3; k++) {
      normal[(base + k) * 3 + 1] = 1;
      uv[(base + k) * 2] = 0.5;
      uv[(base + k) * 2 + 1] = 0.5;
    }
    idx.push(base, base + 1, base + 2);
  }

  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(position, 3));
  geo.setAttribute('normal', new BufferAttribute(normal, 3));
  geo.setAttribute('uv', new BufferAttribute(uv, 2));
  geo.setIndex(idx);
  applySway(geo, stemH + petalR, 1.1);
  return finalizeGeometry(geo, { tolerance: 1e-4, maxWeldAngle: 180 });
}

// ─────────────────────────────────────────────────────────────────────────────
// The foliage system
// ─────────────────────────────────────────────────────────────────────────────

export interface FoliageOptions {
  source: ScatterSource;
  /** Scale every population. 0 disables foliage entirely. */
  quality?: number;
  /** Wind amplitude multiplier, 0..1. */
  wind?: number;
}

export class Foliage {
  readonly object: Object3D = new Group();
  readonly fields: InstanceField[] = [];
  readonly pools: ScatterPool[] = [];

  private groups: InstanceGroup[] = [];
  private materials: CelMaterial[] = [];

  constructor(opts: FoliageOptions) {
    this.object.name = 'terrain-foliage';
    const quality = opts.quality ?? 1;
    if (quality <= 0) return;
    const wind = opts.wind ?? 0.85;

    this.buildTrees(opts.source, quality, wind);
    this.buildGroundCover(opts.source, quality, wind);
  }

  // ── Trees ─────────────────────────────────────────────────────────────────

  private buildTrees(src: ScatterSource, quality: number, wind: number): void {
    const rule = makeRule({
      spacing: 8.5,
      // Trees hold on grass and on packed dirt, cling on the edge of scree,
      // and never grow on bare rock, on snow, or in the stream.
      zoneWeight: [0.0, 0.40, 0.95, 0.06, 0.0, 0.0, 0.0],
      slopeMin: 0,
      slopeMax: 0.66,
      slopeFeather: 0.16,
      routeClear: 7.5,
      routeMax: Infinity,
      // Trees prefer soil that has stayed put. Freshly cut gully floors are
      // bare, and that contrast is a big part of reading drainage in a wide shot.
      erosionBias: 0.45,
      clumping: 0.82,
      clumpScale: 150,
      density: 0.72 * quality,
      scaleMin: 0.62,
      scaleMax: 1.45,
      alignToNormal: 0.16,
      sink: -0.22,
      variants: CONIFER_SHAPES.length,
      maxCount: Math.round(34000 * quality),
    });

    const field = generateInstances(src, rule, 'foliage:conifer');
    this.fields.push(field);

    const NEAR_MAX = Math.round(760 * quality);
    const FAR_MAX = Math.round(5200 * quality);
    const NEAR_RANGE = 195;
    const FAR_RANGE = 820;
    const NEAR_FADE = 38;
    const FAR_FADE = 90;

    const nearGroups: InstanceGroup[] = [];
    const farGroups: InstanceGroup[] = [];

    for (let v = 0; v < CONIFER_SHAPES.length; v++) {
      const shape = CONIFER_SHAPES[v];

      // ── LOD0: trunk + canopy, sharing one set of instances ───────────────
      const trunkGeo = buildTrunkGeometry(shape);
      const trunk = buildInstanced(trunkGeo, this.object, {
        preset: 'bark',
        idName: 'bark',
        max: NEAR_MAX,
        name: `conifer${v}:trunk`,
        vertexAo: true,
        wind: true,
        outline: true,
      });
      const shared = {
        tint: trunkGeo.getAttribute('aInstanceTint') as InstancedBufferAttribute,
        fade: trunkGeo.getAttribute('aInstanceFade') as InstancedBufferAttribute,
        phase: trunkGeo.getAttribute('aInstancePhase') as InstancedBufferAttribute,
      };

      const canopyGeo = buildCanopyGeometry(shape);
      const canopy = buildInstanced(
        canopyGeo,
        this.object,
        {
          preset: 'foliage',
          idName: 'foliage',
          max: NEAR_MAX,
          name: `conifer${v}:canopy`,
          vertexAo: true,
          wind: true,
          outline: true,
        },
        shared,
      );

      const g = new InstanceGroup(trunk.mesh, NEAR_MAX);
      if (trunk.hull) g.addSibling(trunk.hull);
      g.addSibling(canopy.mesh);
      if (canopy.hull) g.addSibling(canopy.hull);
      nearGroups.push(g);
      this.groups.push(g);
      this.setWind(trunk, wind);
      this.setWind(canopy, wind);

      // ── LOD1: crossed cards ──────────────────────────────────────────────
      const cardGeo = buildTreeCardGeometry(shape);
      const card = buildInstanced(cardGeo, this.object, {
        preset: 'foliage',
        idName: 'foliage',
        max: FAR_MAX,
        name: `conifer${v}:card`,
        map: canopyCard(256, `canopy${v}`),
        alphaTest: 0.45,
        side: DoubleSide,
        wind: true,
        outline: false,
      });
      // Far cards are excluded from the G-buffer and the cascades: interior
      // lines on a nine-pixel tree are noise, and its shadow is beyond the far
      // cascade's reach. Their inverted hulls are gone with them, which is why
      // the near tier keeps its outline all the way through the cross-fade.
      card.mesh.userData.skipPrepass = true;
      card.mesh.userData.skipShadow = true;
      card.mesh.castShadow = false;
      const gf = new InstanceGroup(card.mesh, FAR_MAX);
      farGroups.push(gf);
      this.groups.push(gf);
      this.setWind(card, wind);
    }

    const tiers: PoolTier[] = [
      { groups: nearGroups, near: 0, far: NEAR_RANGE, fade: NEAR_FADE },
      { groups: farGroups, near: NEAR_RANGE - NEAR_FADE, far: FAR_RANGE, fade: FAR_FADE },
    ];
    this.pools.push(new ScatterPool(field, tiers, 12));
  }

  // ── Grass and flowers ─────────────────────────────────────────────────────

  private buildGroundCover(src: ScatterSource, quality: number, wind: number): void {
    // ── Tufts ───────────────────────────────────────────────────────────────
    const tuftRule = makeRule({
      spacing: 1.05,
      zoneWeight: [0.0, 0.42, 1.0, 0.05, 0.0, 0.0, 0.0],
      slopeMin: 0,
      slopeMax: 0.62,
      slopeFeather: 0.14,
      routeClear: 2.4,
      routeMax: 130,
      erosionBias: 0.25,
      clumping: 0.62,
      clumpScale: 26,
      density: 0.85 * quality,
      scaleMin: 0.7,
      scaleMax: 1.7,
      alignToNormal: 0.72,
      sink: -0.05,
      variants: 1,
      maxCount: Math.round(150000 * quality),
    });
    const tuftField = generateInstances(src, tuftRule, 'foliage:tuft');
    this.fields.push(tuftField);

    const TUFT_MAX = Math.round(5200 * quality);
    const tuftGeo = buildTuftGeometry();
    const tuft = buildInstanced(tuftGeo, this.object, {
      preset: 'tuft',
      idName: 'tuft',
      max: TUFT_MAX,
      name: 'grass-tuft',
      map: grassCard(128, 'tuft'),
      alphaTest: 0.40,
      side: DoubleSide,
      wind: true,
      outline: false,
    });
    // Thousands of overlapping alpha-tested cards in the G-buffer produce a
    // dense scribble of interior lines that reads as static, not as grass.
    tuft.mesh.userData.skipPrepass = true;
    const tuftGroup = new InstanceGroup(tuft.mesh, TUFT_MAX);
    this.groups.push(tuftGroup);
    this.setWind(tuft, wind);
    this.pools.push(
      new ScatterPool(tuftField, [{ groups: [tuftGroup], near: 0, far: 74, fade: 18 }], 6),
    );

    // ── Wildflowers ─────────────────────────────────────────────────────────
    const flowerRule = makeRule({
      spacing: 1.7,
      zoneWeight: [0.0, 0.10, 1.0, 0.0, 0.0, 0.0, 0.0],
      slopeMin: 0,
      slopeMax: 0.5,
      slopeFeather: 0.12,
      routeClear: 2.8,
      routeMax: 120,
      erosionBias: 0.3,
      // Flowers grow in drifts. High clumping at a small scale is what makes a
      // meadow read as somebody's watercolour rather than as a scatter pass.
      clumping: 0.94,
      clumpScale: 17,
      density: 1.25 * quality,
      scaleMin: 0.75,
      scaleMax: 1.6,
      alignToNormal: 0.55,
      sink: -0.02,
      variants: 1,
      maxCount: Math.round(46000 * quality),
    });
    const flowerField = generateInstances(src, flowerRule, 'foliage:flower');
    this.fields.push(flowerField);

    const FLOWER_MAX = Math.round(2600 * quality);
    const flowerGeo = buildFlowerGeometry();
    const flower = buildInstanced(flowerGeo, this.object, {
      preset: 'marker',
      idName: 'flower',
      max: FLOWER_MAX,
      name: 'wildflower',
      side: DoubleSide,
      wind: true,
      outline: true,
      outlineWidth: 0.006,
    });
    flower.mesh.castShadow = false;
    flower.mesh.userData.skipShadow = true;
    const flowerGroup = new InstanceGroup(flower.mesh, FLOWER_MAX);
    if (flower.hull) flowerGroup.addSibling(flower.hull);
    this.groups.push(flowerGroup);
    this.setWind(flower, wind);
    this.pools.push(
      new ScatterPool(flowerField, [{ groups: [flowerGroup], near: 0, far: 48, fade: 12 }], 5),
    );
  }

  // ── Plumbing ──────────────────────────────────────────────────────────────

  /**
   * Set the wind amplitude on EVERY program that displaces this plant.
   *
   * The main pass, the G-buffer prepass, the shadow pass and the outline hull
   * each own a separate copy of `uWindStrength`. Setting it on only the main
   * material is a subtle and very confusing bug: the tree bends by one amount,
   * while its outline, its interior lines and its cast shadow bend by another,
   * and the result is ink and shadow that visibly slide off the geometry every
   * time the wind gusts.
   */
  private setWind(built: { mesh: { material: unknown; userData: Record<string, unknown> }; hull: { material: unknown } | null }, wind: number): void {
    const apply = (m: unknown): void => {
      const mat = m as { uniforms?: Record<string, { value: unknown }> } | null;
      if (mat && mat.uniforms && mat.uniforms.uWindStrength) {
        mat.uniforms.uWindStrength.value = wind;
      }
      if (m instanceof CelMaterial) this.materials.push(m);
    };
    apply(built.mesh.material);
    apply(built.mesh.userData.prepassMaterial);
    apply(built.mesh.userData.shadowMaterial);
    if (built.hull) apply(built.hull.material);
  }

  /** Remove everything the trail ribbon now occupies. */
  cullCarve(carve: TrackCarve, margin = 1.4): void {
    for (const field of this.fields) {
      for (let i = 0; i < carve.points.length; i++) {
        const p = carve.points[i];
        field.cullDisc(p.x, p.z, carve.halfWidths[i] + margin);
      }
    }
    for (const pool of this.pools) pool.invalidate();
  }

  update(camX: number, camZ: number): void {
    for (const pool of this.pools) pool.update(camX, camZ);
  }

  dispose(): void {
    for (const g of this.groups) g.dispose();
    this.groups.length = 0;
    this.materials.length = 0;
    this.pools.length = 0;
    this.fields.length = 0;
    this.object.clear();
  }
}
