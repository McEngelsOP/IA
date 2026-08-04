/**
 * The mountain.
 *
 * `createTerrain()` runs the whole generation pipeline and hands back an object
 * that satisfies ITerrain exactly. Everything downstream — the track builder,
 * the bike physics, the AI, the camera, the FX — talks to it through that
 * interface and never touches anything in this directory directly.
 *
 * THE PIPELINE, AND WHY IT IS IN THIS ORDER.
 *
 *   1. NOISE STACK          Heightfield.ts. A domain-warped massif whose
 *                           large-scale profile is literally the course descent
 *                           profile, so the corridor prior barely has to move
 *                           the ground and therefore never reads as a bulldozed
 *                           ramp.
 *
 *   2. EROSION              Erosion.ts, at half resolution. Droplets first,
 *                           then thermal talus relaxation. Only the DELTA is
 *                           upsampled back to full resolution — it is the
 *                           output of a diffusive process and therefore
 *                           band-limited, whereas upsampling the height itself
 *                           would throw away every bit of fine noise detail the
 *                           full-resolution stack generated.
 *
 *   3. FEATURE CARVING      Heightfield.ts. The ravine, the tabletop, the
 *                           narrowed ridge, the stream, the rock garden. Last,
 *                           because erosion silts up a ravine and rounds off a
 *                           jump lip, and "the jump eroded away" is not a
 *                           debuggable failure.
 *
 *   4. ZONES                Zones.ts. Altitude, slope and drainage decide what
 *                           the ground is made of, with hard, noise-perturbed
 *                           boundaries.
 *
 *   5. TEXTURES + GEOMETRY  The height, normal and zone fields become GPU
 *                           textures; the clipmap, the scatter and the foliage
 *                           all read them.
 *
 * The track is built AFTER all of this, fits itself to the finished surface,
 * and then calls `applyTrackCarve` — which flattens the corridor, marks it as
 * trail, and deletes every rock and tree the ribbon now sits on.
 */

import { Group, Object3D, PerspectiveCamera, Vector3 } from 'three';

import {
  ITerrain,
  SurfaceKind,
  SurfaceProperties,
  TerrainSample,
  TrackCarve,
} from '../game/Contracts';
import { SURFACES, WORLD_HALF, WORLD_SIZE } from '../game/WorldConstants';
import { clamp, clamp01, lerp, smoothstep } from '../core/MathX';

import {
  CarvedBoulder,
  CorridorField,
  GRID_SIZE,
  RouteSamples,
  bilinearSample,
  buildBaseHeightfield,
  carveFeatures,
  fieldRange,
  neutraliseErosionInFeatures,
  yieldFrame,
} from './Heightfield';
import {
  downsampleField,
  erodeHydraulic,
  erodeThermal,
  normaliseErosionMap,
  upsampleField,
} from './Erosion';
import { ZoneField, classifyZones, computeSlopeField, describeZones, zoneAtGrid } from './Zones';
import {
  TerrainMaterialSet,
  buildNormalErosionData,
  createHeightTexture,
  createNormalTexture,
  createTerrainMaterials,
  writeNormalRegion,
} from './TerrainMaterial';
import { TerrainClipmap } from './TerrainClipmap';
import { Scatter, ScatterSource } from './Scatter';
import { Foliage } from './Foliage';

export * from './Zones';
export * from './TerrainMaterial';
export { TerrainClipmap, HeightPyramid } from './TerrainClipmap';
export * from './Scatter';
export { Foliage, CONIFER_SHAPES } from './Foliage';

// Module-scope scratch. Nothing on the query or update path allocates.
const _n = new Vector3();
const _camPos = new Vector3();
const _tan = new Vector3();

/**
 * Physical properties per surface, assembled from the shared constants.
 *
 * Deliberately built here rather than imported from the bike module: terrain
 * must not depend on physics, and physics must not depend on terrain. Both
 * derive the same table from WorldConstants, which is the single source.
 */
export const TERRAIN_SURFACES: Record<SurfaceKind, SurfaceProperties> = {
  [SurfaceKind.Rock]: { kind: SurfaceKind.Rock, ...SURFACES.rock, audioTone: 'rock' },
  [SurfaceKind.Dirt]: { kind: SurfaceKind.Dirt, ...SURFACES.dirt, audioTone: 'hardpack' },
  [SurfaceKind.Grass]: { kind: SurfaceKind.Grass, ...SURFACES.grass, audioTone: 'grass' },
  [SurfaceKind.Scree]: { kind: SurfaceKind.Scree, ...SURFACES.scree, audioTone: 'gravel' },
  [SurfaceKind.Snow]: { kind: SurfaceKind.Snow, ...SURFACES.snow, audioTone: 'snow' },
  [SurfaceKind.Water]: { kind: SurfaceKind.Water, ...SURFACES.water, audioTone: 'water' },
  [SurfaceKind.Trail]: { kind: SurfaceKind.Trail, ...SURFACES.trail, audioTone: 'hardpack' },
};

export interface CreateTerrainOptions {
  /** Heightfield resolution. Defaults to HEIGHTMAP_SIZE (2048). */
  size?: number;
  seed?: string;
  onProgress?: (frac: number, label?: string) => void;
  /** Build the clipmap meshes. False gives a query-only terrain for tests. */
  geometry?: boolean;
  /** Scatter and foliage density multiplier. 0 disables both. */
  decorQuality?: number;
  /** Resolution the erosion simulation runs at. Half is plenty. */
  erosionSize?: number;
  /** Droplet count override. */
  droplets?: number;
  /** Console-log a summary when generation finishes. */
  verbose?: boolean;
}

interface TerrainData {
  height: Float32Array;
  erosion: Float32Array;
  size: number;
  cellSize: number;
  corridor: CorridorField;
  route: RouteSamples;
  zones: ZoneField;
  boulders: CarvedBoulder[];
  minHeight: number;
  maxHeight: number;
}

/**
 * The concrete mountain.
 *
 * Implements ITerrain, and additionally satisfies ScatterSource so the scatter
 * and foliage systems can interrogate it while they place themselves.
 */
export class Terrain implements ITerrain, ScatterSource {
  readonly object: Object3D = new Group();
  readonly worldSize = WORLD_SIZE;
  readonly maxHeight: number;
  readonly minHeight: number;

  /** The eroded, carved heightfield. Row-major, `size` squared. */
  readonly height: Float32Array;
  readonly erosion: Float32Array;
  readonly size: number;
  readonly cellSize: number;
  readonly corridor: CorridorField;
  readonly route: RouteSamples;
  readonly zones: ZoneField;
  readonly boulders: CarvedBoulder[];

  clipmap: TerrainClipmap | null = null;
  scatter: Scatter | null = null;
  foliage: Foliage | null = null;
  materials: TerrainMaterialSet | null = null;

  private normalData: Uint8Array;
  private heightTex = createHeightTexture(new Float32Array(1), 1);
  private normalTex = createNormalTexture(new Uint8Array(4), 1);
  private invCell: number;
  private carveApplied = false;

  private readonly scratchSample: TerrainSample = {
    height: 0,
    normal: new Vector3(0, 1, 0),
    slope: 0,
    kind: SurfaceKind.Dirt,
    surface: TERRAIN_SURFACES[SurfaceKind.Dirt],
  };

  constructor(data: TerrainData) {
    this.object.name = 'terrain';
    this.height = data.height;
    this.erosion = data.erosion;
    this.size = data.size;
    this.cellSize = data.cellSize;
    this.invCell = 1 / data.cellSize;
    this.corridor = data.corridor;
    this.route = data.route;
    this.zones = data.zones;
    this.boulders = data.boulders;
    this.minHeight = data.minHeight;
    this.maxHeight = data.maxHeight;

    this.normalData = buildNormalErosionData(this.height, this.erosion, this.size, this.cellSize);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Rendering setup (called by createTerrain, not by consumers)
  // ───────────────────────────────────────────────────────────────────────────

  buildRenderer(): void {
    this.heightTex.dispose();
    this.normalTex.dispose();
    this.heightTex = createHeightTexture(this.height, this.size);
    this.normalTex = createNormalTexture(this.normalData, this.size);

    this.materials = createTerrainMaterials({
      heightTexture: this.heightTex,
      normalTexture: this.normalTex,
      zoneTexture: this.zones.texture,
      size: this.size,
      cellSize: this.cellSize,
    });

    this.clipmap = new TerrainClipmap({
      materials: this.materials,
      height: this.height,
      size: this.size,
      cellSize: this.cellSize,
    });
    this.object.add(this.clipmap.object);
  }

  buildScatter(quality: number): void {
    if (quality <= 0) return;
    this.scatter = new Scatter({ source: this, boulders: this.boulders, quality });
    this.object.add(this.scatter.object);
  }

  buildFoliage(quality: number): void {
    if (quality <= 0) return;
    this.foliage = new Foliage({ source: this, quality });
    this.object.add(this.foliage.object);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // ITerrain — queries
  // ───────────────────────────────────────────────────────────────────────────

  /** World X or Z to fractional grid coordinate. */
  private g(v: number): number {
    return (v + WORLD_HALF) * this.invCell;
  }

  heightAt(x: number, z: number): number {
    return bilinearSample(this.height, this.size, this.g(x), this.g(z));
  }

  normalAt(x: number, z: number, out?: Vector3): Vector3 {
    const o = out ?? _n;
    // Central differences at exactly one texel, which is the same finite
    // difference the normal TEXTURE was built from. That matters: if the CPU
    // normal and the GPU normal disagreed, the bike would ride a surface with a
    // different orientation from the one being drawn.
    const e = this.cellSize;
    const hl = this.heightAt(x - e, z);
    const hr = this.heightAt(x + e, z);
    const hd = this.heightAt(x, z - e);
    const hu = this.heightAt(x, z + e);
    return o.set(-(hr - hl) / (2 * e), 1, -(hu - hd) / (2 * e)).normalize();
  }

  downhillAt(x: number, z: number, out?: Vector3): Vector3 {
    const o = out ?? _n;
    const e = this.cellSize;
    const dx = this.heightAt(x + e, z) - this.heightAt(x - e, z);
    const dz = this.heightAt(x, z + e) - this.heightAt(x, z - e);
    o.set(-dx, 0, -dz);
    const l = o.length();
    // On genuinely flat ground there is no downhill. Return the world's overall
    // fall line rather than a zero vector, so callers never divide by zero.
    if (l < 1e-6) return o.set(0, 0, 1);
    return o.divideScalar(l);
  }

  sampleAt(x: number, z: number, out?: TerrainSample): TerrainSample {
    const o = out ?? this.scratchSample;
    o.height = this.heightAt(x, z);
    this.normalAt(x, z, o.normal);
    o.slope = Math.acos(clamp(o.normal.y, -1, 1));
    o.kind = this.zoneAt(x, z);
    o.surface = TERRAIN_SURFACES[o.kind];
    return o;
  }

  raycastDown(x: number, _y: number, z: number): number | null {
    if (x < -WORLD_HALF || x > WORLD_HALF || z < -WORLD_HALF || z > WORLD_HALF) return null;
    return this.heightAt(x, z);
  }

  // ── Extras used by scatter, foliage, the HUD and the debug overlay ─────────

  zoneAt(x: number, z: number): SurfaceKind {
    return zoneAtGrid(this.zones, this.g(x), this.g(z));
  }

  surfaceAt(x: number, z: number): SurfaceProperties {
    return TERRAIN_SURFACES[this.zoneAt(x, z)];
  }

  erosionAt(x: number, z: number): number {
    return bilinearSample(this.erosion, this.size, this.g(x), this.g(z));
  }

  corridorDistAt(x: number, z: number): number {
    return bilinearSample(this.corridor.dist, this.size, this.g(x), this.g(z));
  }

  /** Kernel-smoothed route progress 0..1, or -1 well away from the course. */
  routeProgressAt(x: number, z: number): number {
    return bilinearSample(this.corridor.progress, this.size, this.g(x), this.g(z));
  }

  // ───────────────────────────────────────────────────────────────────────────
  // ITerrain — per frame
  // ───────────────────────────────────────────────────────────────────────────

  update(camera: PerspectiveCamera, _dt: number): void {
    camera.getWorldPosition(_camPos);
    this.clipmap?.update(camera);
    this.scatter?.update(_camPos.x, _camPos.z);
    this.foliage?.update(_camPos.x, _camPos.z);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // ITerrain — the track carve
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Flatten the ground under the trail ribbon.
   *
   * Three things happen, and all three are necessary:
   *
   *  1. THE HEIGHT is pulled toward the ribbon's own cross-section — including
   *     its bank — a little below the ribbon surface, so the mesh sits just
   *     proud of the ground instead of z-fighting with it.
   *
   *     THE TARGET IS A WEIGHTED AVERAGE OVER THE CARVE POINTS, NOT THE ONE
   *     POINT WITH THE HIGHEST WEIGHT, and that is the whole correctness
   *     argument of this function. The previous version kept `if (w > weight)`
   *     against a weight that SATURATES AT 1 anywhere within sixty percent of
   *     the reach — about five metres of track — while the carve points are
   *     three and a half metres apart. So five or six consecutive points all
   *     tied at exactly 1.0, the strict comparison kept whichever was visited
   *     first, and the loop runs uphill to downhill: every texel in the
   *     corridor took its height from a point up to five metres BACK UP THE
   *     COURSE. On a twenty percent grade that is a metre; over a jump lip it
   *     was eight. Measured, before the fix: scree +1.06..+2.15 m, tabletop
   *     -7.89..+4.33 m, mean error positive in every single section — the
   *     signature of a systematic uphill bias, not of noise.
   *
   *     The physics collides with this field and not with the ribbon, so the
   *     mesh was floating metres over the surface the wheels were on, riders
   *     spawned inside the mountain, and the trail carried a quantisation
   *     staircase 0.2 m rms that no suspension could follow.
   *
   *     A tent weight whose half-width is the carve-point SPACING makes the
   *     accumulated targets a partition of unity, so the result is an exact
   *     linear interpolation of the centreline between consecutive points —
   *     which is what the ribbon mesh is drawing.
   *
   *  2. THE ZONE under the ribbon becomes Trail, so a wheel that drops off the
   *     mesh edge onto the carved ground still reports trail grip rather than
   *     suddenly finding grass in the middle of a berm.
   *
   *  3. EVERY ROCK AND TREE inside the corridor is deleted. Scatter is placed
   *     before the track exists — it has to be, because the track fits itself
   *     to the finished terrain — so this is the only opportunity to remove the
   *     boulder now sitting in the middle of the racing line.
   */
  applyTrackCarve(carve: TrackCarve): void {
    if (this.carveApplied) return;
    this.carveApplied = true;

    const size = this.size;
    // Lateral coverage drives the BLEND STRENGTH and nothing else. It is a
    // question about how far this texel is from the centreline, and it must not
    // fall off between carve samples: thresholding a weight that dips once per
    // sample is what scalloped the trail edge into a sawtooth.
    const cover = new Float32Array(size * size);
    // The along-track tent, accumulated as a weighted mean of the targets.
    const sumW = new Float32Array(size * size);
    const sumWY = new Float32Array(size * size);
    const zoneMark = new Uint8Array(size * size);
    const baseFeather = Math.max(carve.featherWidth, 0.5);

    let bx0 = size;
    let bx1 = 0;
    let bz0 = size;
    let bz1 = 0;

    const n = carve.points.length;
    const alongSpan = carvePointSpacing(carve.points);

    for (let i = 0; i < n; i++) {
      const p = carve.points[i];
      const hw = carve.halfWidths[i];
      // Fall back to the old inflated-width behaviour if a track does not
      // supply the rideable width, so this cannot silently paint nothing.
      const rideHw = carve.rideWidths?.[i] ?? hw * 0.86;
      const bank = carve.banks[i];

      // The feather widens with how much material the carve is MOVING, so that
      // cuttings and embankments come out at the angle of repose instead of as
      // vertical walls.
      //
      // The course is now held to a descent (see `limitClimb` in TrackSpline),
      // which means that wherever the route used to climb a spur it now cuts
      // through it — the worst case takes about 11 m off a crest at 270 m. At a
      // fixed feather that is a slot with 11 m sides and a 6 m floor. Loose
      // alpine scree stands at roughly 34 deg, so a cut of depth d wants
      // d / tan(34 deg) = 1.48 d of lateral run to lie back naturally, and a
      // spoil bank on the low side wants the same. Capped, because the carve
      // cost is quadratic in reach and one deep cut should not stamp a 200 m
      // clearing across the mountain.
      //
      // The factor is 2.3, not 1/tan(34 deg) = 1.48, and the difference is the
      // shape of the blend rather than the angle. The lateral weight is a
      // SMOOTHSTEP, whose derivative peaks at 1.5x its own mean, so a transition
      // carrying height H across width W reaches a maximum gradient of
      // 1.5 H / W in the middle and not H / W. Sizing the width from the mean
      // builds a wall half again as steep as intended everywhere it matters:
      // measured across the deepest cut at 1.48, the side slopes came out at
      // 36, 38, 39 and 51 degrees against the 34 they were specified for.
      // 1.5 / tan(34 deg) = 2.22, rounded up for the centreline-vs-edge
      // difference in how deep the cut actually is.
      const ground = this.heightAt(p.x, p.z);
      const move = Math.abs(ground - p.y);
      const feather = Math.min(baseFeather + move * 2.3, baseFeather + 40);
      const reach = hw + feather;

      // Local left, from the centreline tangent. Left = up x forward.
      const a = carve.points[Math.max(0, i - 1)];
      const b = carve.points[Math.min(n - 1, i + 1)];
      _tan.set(b.x - a.x, 0, b.z - a.z);
      if (_tan.lengthSq() < 1e-9) _tan.set(0, 0, 1);
      _tan.normalize();
      const lx = _tan.z;
      const lz = -_tan.x;
      // Rise per metre of LEFT offset, taken from the carve rather than rebuilt
      // from the bank angle. `Math.tan(bank)` was the opposite sign to what the
      // ribbon mesh uses for the same trail, so the ground was cambered the
      // wrong way across every banked corner — the two surfaces diverged by
      // 1.285 m at 3.2 m off the centreline at 300 m, and since the bike rides
      // the heightfield and the player sees the ribbon, the drawn trail stood
      // above the rider and cut him off at the chest. See TrackCarve.crossSlopes.
      const tanBank = carve.crossSlopes?.[i] ?? -Math.tan(bank);

      const ix0 = clamp(Math.floor(this.g(p.x - reach)), 0, size - 1);
      const ix1 = clamp(Math.ceil(this.g(p.x + reach)), 0, size - 1);
      const iz0 = clamp(Math.floor(this.g(p.z - reach)), 0, size - 1);
      const iz1 = clamp(Math.ceil(this.g(p.z + reach)), 0, size - 1);
      if (ix0 < bx0) bx0 = ix0;
      if (ix1 > bx1) bx1 = ix1;
      if (iz0 < bz0) bz0 = iz0;
      if (iz1 > bz1) bz1 = iz1;

      for (let iz = iz0; iz <= iz1; iz++) {
        const wz = -WORLD_HALF + iz * this.cellSize - p.z;
        const row = iz * size;
        for (let ix = ix0; ix <= ix1; ix++) {
          const wx = -WORLD_HALF + ix * this.cellSize - p.x;
          const d2 = wx * wx + wz * wz;
          if (d2 > reach * reach) continue;

          const lateral = wx * lx + wz * lz;
          const along = Math.abs(wx * _tan.x + wz * _tan.z);
          const wLat = 1 - smoothstep(hw, hw + feather, Math.abs(lateral));
          if (wLat <= 0.001) continue;

          const k = row + ix;
          if (wLat > cover[k]) cover[k] = wLat;
          // Paint the Trail zone to the RIDEABLE width, not the flattening
          // reach. `hw` is inflated (1.22x plus a berm term plus 1.1 m), so
          // 0.86 of it painted a 1-2 m ring of trail-coloured terrain outside
          // the ribbon mesh for the entire length of the course. On ground
          // receding at 1-2 degrees of grazing incidence that ring projects to
          // 30-70 px, which is the row of triangular teeth hanging off the
          // trail edge in valley-vista. Measured off the built geometry: ribbon
          // drawn edge 4.16 m, skirt 5.49 m, zone collar 6.11 m.
          if (Math.abs(lateral) < rideHw && along < reach) zoneMark[k] = 1;

          // The tent. Zero at one point-spacing away, so exactly two points
          // contribute to any position on a straight run and their weights sum
          // to one — a linear interpolation of the centreline height.
          const wAlong = 1 - along / alongSpan;
          if (wAlong <= 0) continue;
          const w = wLat * wAlong;
          sumW[k] += w;
          // Carve to the ribbon surface EXACTLY. This used to be `p.y - 0.12`,
          // pushing the ground 12 cm below the trail mesh so the two could not
          // z-fight — but the heightfield is not decoration, it is the
          // COLLISION SURFACE. The bike contacts `terrain.heightAt`; the player
          // sees the ribbon. Separating them by 12 cm means the wheels ride 12
          // cm under the trail, for the entire length of the course, and a
          // player put it plainly: the bikes are "going inside the track ...
          // not just on the top of the path".
          //
          // Measured over the first 260 m: the ribbon floated 0.181 m above the
          // collision surface on average and on 131 of 131 samples — never once
          // agreeing. The extra beyond the authored 0.12 is the lattice: a
          // carve target sampled at grid corners and read back bilinearly
          // between them loses a little more depth wherever the trail runs
          // diagonally across cells.
          //
          // Z-fighting is a depth-buffer problem and it is fixed in the depth
          // buffer, with polygonOffset on the ribbon material. Moving physical
          // geometry to fix a rasteriser tie is paying for a rendering artefact
          // with gameplay.
          sumWY[k] += w * (p.y + lateral * tanBank);
        }
      }
    }

    for (let iz = bz0; iz <= bz1; iz++) {
      const row = iz * size;
      for (let ix = bx0; ix <= bx1; ix++) {
        const k = row + ix;
        const w = cover[k];
        if (w <= 0.001 || sumW[k] <= 1e-6) continue;
        this.height[k] = lerp(this.height[k], sumWY[k] / sumW[k], clamp01(w));
        // Water survives the trail stamp. The course drops INTO the stream bed
        // rather than bridging it, so painting hardpack trail over the channel
        // floor both erased the only water in the game and handed the rider
        // trail grip (1.0) on what the course design says is the slipperiest
        // ground on the mountain (0.52). The stream is meant to be a hazard.
        if (zoneMark[k] && this.zones.zone[k] !== SurfaceKind.Water) {
          this.zones.zone[k] = SurfaceKind.Trail;
        }
      }
    }

    // Rebuild the derived data over the touched region only, then push all
    // three textures. One 16MB re-upload at load time is not worth optimising.
    writeNormalRegion(
      this.normalData,
      this.height,
      this.erosion,
      size,
      this.cellSize,
      bx0 - 2,
      bz0 - 2,
      bx1 + 2,
      bz1 + 2,
    );
    this.heightTex.needsUpdate = true;
    this.normalTex.needsUpdate = true;
    this.zones.texture.needsUpdate = true;
    this.clipmap?.refreshHeights();

    this.scatter?.cullCarve(carve);
    this.foliage?.cullCarve(carve);
  }

  dispose(): void {
    this.clipmap?.dispose();
    this.scatter?.dispose();
    this.foliage?.dispose();
    this.materials?.dispose();
    this.heightTex.dispose();
    this.normalTex.dispose();
    this.zones.texture.dispose();
    this.object.clear();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Generation
// ─────────────────────────────────────────────────────────────────────────────

export async function createTerrain(opts: CreateTerrainOptions = {}): Promise<Terrain> {
  const size = opts.size ?? GRID_SIZE;
  const cellSize = WORLD_SIZE / size;
  const seed = opts.seed ?? 'descent-mountain';
  const report = opts.onProgress ?? ((): void => {});
  const t0 = now();

  // ── 1. Noise stack ────────────────────────────────────────────────────────
  report(0.02, 'Shaping the massif');
  const base = await buildBaseHeightfield({
    size,
    seed,
    onProgress: (f) => report(0.02 + f * 0.26, 'Shaping the massif'),
  });
  const height = base.height;

  // ── 2. Erosion ────────────────────────────────────────────────────────────
  report(0.30, 'Running water');
  const eroSize = Math.min(opts.erosionSize ?? Math.max(512, size >> 1), size);
  // Droplet budget scales with texel count: about four hundred thousand at the
  // half-resolution 1024² sim, which is enough for gullies to converge into
  // larger gullies rather than staying as isolated scratches.
  const droplets = opts.droplets ?? Math.round(eroSize * eroSize * 0.38);
  let erosion: Float32Array;

  if (eroSize === size) {
    erosion = new Float32Array(size * size);
    await erodeHydraulic(
      height,
      size,
      erosion,
      { droplets },
      (f) => report(0.30 + f * 0.30, 'Running water'),
      `${seed}:erosion`,
    );
    report(0.62, 'Settling talus');
    erodeThermal(height, size, erosion, cellSize);
  } else {
    // Erode a half-resolution copy and carry only the DELTA back up. The delta
    // is the output of a diffusive process, so bilinear upsampling loses
    // essentially nothing; upsampling the eroded height itself would discard
    // every bit of fine detail the full-resolution noise stack produced, and
    // erosion needs that detail to bite on in the first place.
    const low = downsampleField(height, size, eroSize);
    const delta = low.slice();
    const lowErosion = new Float32Array(eroSize * eroSize);
    const lowCell = WORLD_SIZE / eroSize;

    await erodeHydraulic(
      low,
      eroSize,
      lowErosion,
      { droplets },
      (f) => report(0.30 + f * 0.30, 'Running water'),
      `${seed}:erosion`,
    );
    report(0.62, 'Settling talus');
    erodeThermal(low, eroSize, lowErosion, lowCell);

    for (let i = 0; i < low.length; i++) delta[i] = low[i] - delta[i];
    const upDelta = upsampleField(delta, eroSize, size);
    for (let i = 0; i < height.length; i++) height[i] += upDelta[i];
    erosion = upsampleField(lowErosion, eroSize, size);
  }
  await yieldFrame();

  // ── 3. Feature carving ────────────────────────────────────────────────────
  report(0.68, 'Carving features');
  const carved = carveFeatures(height, size, base.corridor, `${seed}:features`);
  neutraliseErosionInFeatures(erosion, carved.touched);
  const erosionStats = normaliseErosionMap(erosion);
  await yieldFrame();

  // ── 4. Zones ──────────────────────────────────────────────────────────────
  report(0.76, 'Classifying ground');
  const slope = computeSlopeField(height, size, cellSize);
  const zones = classifyZones({
    height,
    slope,
    erosion,
    corridor: base.corridor,
    kindOverride: carved.kindOverride,
    size,
    seed: `${seed}:zones`,
  });
  await yieldFrame();

  const range = fieldRange(height);
  const terrain = new Terrain({
    height,
    erosion,
    size,
    cellSize,
    corridor: base.corridor,
    route: base.route,
    zones,
    boulders: carved.boulders,
    minHeight: range.min,
    maxHeight: range.max,
  });

  // ── 5. Geometry ───────────────────────────────────────────────────────────
  if (opts.geometry !== false) {
    report(0.84, 'Building the clipmap');
    terrain.buildRenderer();
    await yieldFrame();

    report(0.90, 'Scattering rock');
    terrain.buildScatter(opts.decorQuality ?? 1);
    await yieldFrame();

    report(0.95, 'Planting the tree line');
    terrain.buildFoliage(opts.decorQuality ?? 1);
    await yieldFrame();
  }

  report(1, 'Mountain ready');

  if (opts.verbose !== false) {
    const ms = Math.round(now() - t0);
    console.info(
      `[terrain] ${size}² in ${ms}ms — height ${range.min.toFixed(1)}..${range.max.toFixed(1)}m, ` +
        `erosion mean ${erosionStats.meanAbs.toFixed(3)}m, ${describeZones(zones)}`,
    );
    if (terrain.scatter) {
      const rocks = terrain.scatter.fields.reduce((s, f) => s + f.liveCount(), 0);
      const plants = terrain.foliage ? terrain.foliage.fields.reduce((s, f) => s + f.liveCount(), 0) : 0;
      console.info(`[terrain] ${rocks} rocks, ${plants} plants placed`);
    }
  }

  return terrain;
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/**
 * The typical along-track spacing of the carve points, as a MEDIAN.
 *
 * Median rather than mean, and rather than a per-point neighbour distance,
 * because the carve list is not contiguous: `getCarve` drops every sample
 * inside the ravine, so two consecutive entries there are twenty metres apart.
 * A per-point span would give those two an enormous tent and smear the lips of
 * the gap into the hillside; a mean would be dragged upward by the same
 * outliers. The list is otherwise uniform in arc length by construction, so one
 * median describes every point that matters.
 */
function carvePointSpacing(points: Vector3[]): number {
  if (points.length < 2) return 3.5;
  const d: number[] = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    d.push(Math.hypot(b.x - a.x, b.z - a.z));
  }
  d.sort((p, q) => p - q);
  return clamp(d[d.length >> 1], 0.75, 8);
}
