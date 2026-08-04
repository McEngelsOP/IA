/**
 * TerrainClipmap — concentric rings of decreasing resolution, snapped, morphed,
 * and culled.
 *
 * A 4km mountain at 1m resolution is 16 million quads. Nobody draws that. The
 * geometry clipmap draws a fixed, small amount of geometry — seven 96×96 grids,
 * about 100k triangles total — arranged as nested rings whose spacing doubles
 * outward, and slides the whole arrangement along with the camera. Detail is
 * spent where the camera is, and the cost never changes with view distance.
 *
 * Three failure modes define the implementation. Every one of them is a
 * *motion* artefact, which is why a static screenshot of a broken clipmap looks
 * perfect and the moment the camera moves it falls apart.
 *
 * ── 1. SWIMMING ─────────────────────────────────────────────────────────────
 * If a ring simply follows the camera, its vertices land on different points of
 * the heightfield every frame, so the surface between them changes shape
 * continuously and the terrain appears to crawl under itself. The fix is to
 * snap each ring's origin to a whole number of its own texels — then the ring
 * moves in discrete steps and the sampled surface is bit-identical between
 * steps. Each level snaps to TWICE its spacing, and that factor of two is not
 * arbitrary: it is what keeps every level's origin sitting on the next-coarser
 * level's grid, which is the precondition for the next two sections.
 *
 * ── 2. CRACKS AND POPS AT LEVEL BOUNDARIES ──────────────────────────────────
 * Where a 1m ring meets a 2m ring, half of the fine vertices have no
 * counterpart on the coarse side. Left alone, each one sits at whatever height
 * the fine sampling gives it while the coarse edge runs straight past — a
 * T-junction, and a visible tear of sky along the whole boundary. The morph in
 * TERRAIN_DISPLACE slides those vertices onto their coarse neighbour over the
 * outer fifth of each ring and resamples the height as it goes, so by the
 * boundary the fine ring's edge IS the coarse ring's edge, exactly, and the
 * transition between them is continuous rather than a switch.
 *
 * ── 3. THE ONE-TEXEL OFFSET ─────────────────────────────────────────────────
 * The awkward part of every clipmap. Level L snaps to 2·s(L) and level L-1
 * snaps to 2·s(L-1) = s(L), so the finer level's origin can land either exactly
 * on the coarser level's origin or one coarse texel away from it — and it flips
 * between the two as the camera moves. The hole cut in the coarse ring has to
 * follow, or the two levels overlap on one side and leave a gap on the other.
 *
 * The classic answer is an L-shaped trim strip rotated into one of four
 * orientations. This uses the same idea with less machinery: four index buffers
 * per ring, each with the hole shifted by a different combination of zero or one
 * texel, all sharing one vertex buffer. Choosing between them is a pointer
 * swap, the vertex data never changes, and the join is exact in all four cases
 * rather than approximately right in one.
 *
 * ── CULLING ─────────────────────────────────────────────────────────────────
 * Three's own frustum culling is useless here: the geometry is flat (all height
 * comes from the vertex shader), so every bounding sphere is a disc lying in the
 * y=0 plane and describes nothing about where the surface actually is. Instead
 * each quadrant is tested against a real AABB whose vertical extent comes from a
 * min/max pyramid built over the heightfield. Anything within shadow-casting
 * range of the camera is kept regardless of the frustum test — an off-screen
 * ridge at a 21-degree sun throws a shadow a long way into shot, and culling it
 * would delete that shadow.
 */

import {
  BufferAttribute,
  BufferGeometry,
  FrontSide,
  Frustum,
  Group,
  Matrix4,
  Mesh,
  Object3D,
  PerspectiveCamera,
  Vector3,
} from 'three';

import { finalizeGeometry } from '../npr/OutlineGeometry';
import { NPR } from '../npr/NprGlobals';
import { WORLD_HALF } from '../game/WorldConstants';
import { clamp } from '../core/MathX';
import type { TerrainMaterialSet } from './TerrainMaterial';

// Module-scope scratch. The update path allocates nothing.
const _camPos = new Vector3();
const _frustum = new Frustum();
const _projScreen = new Matrix4();
const _minMax = new Float32Array(2);
const _shadowRun = new Vector3();
/** Per-axis growth that sweeps a caster's box along the shadow it throws. */
const _sweepLo = new Vector3();
const _sweepHi = new Vector3();

export interface ClipmapOptions {
  materials: TerrainMaterialSet;
  /** The eroded heightfield, for the culling pyramid. */
  height: Float32Array;
  size: number;
  /** Metres per heightfield texel. */
  cellSize: number;
  /** Number of nested levels. 7 at 1m base covers ±3072m. */
  levels?: number;
  /** Quads per side of every level. Must be a multiple of 4. */
  gridSize?: number;
  /** Vertex spacing of the innermost level, metres. */
  baseSpacing?: number;
  /**
   * Meshes whose footprint comes within this distance of the camera are never
   * frustum-culled, because they may still be casting into the view.
   */
  shadowKeep?: number;
  /** Levels at or beyond this index stop casting shadows. */
  shadowLevels?: number;
}

interface ClipLevel {
  index: number;
  spacing: number;
  halfSpan: number;
  /** [variant][block] — variant 0 is the only one for the solid block. */
  variants: BufferGeometry[][];
  meshes: Mesh[];
  /** Blocks per axis: 2 for the solid centre, 4 for every ring. */
  split: number;
  originX: number;
  originZ: number;
  variant: number;
}

export class TerrainClipmap {
  readonly object: Object3D = new Group();
  readonly levels: ClipLevel[] = [];

  readonly stats = { drawn: 0, culled: 0, triangles: 0 };

  private readonly N: number;
  private readonly baseSpacing: number;
  private readonly shadowKeep: number;
  private readonly pyramid: HeightPyramid;

  constructor(private opts: ClipmapOptions) {
    this.object.name = 'terrain-clipmap';
    this.N = opts.gridSize ?? 96;
    this.baseSpacing = opts.baseSpacing ?? 1;
    this.shadowKeep = opts.shadowKeep ?? 470;
    const levelCount = opts.levels ?? 7;
    const shadowLevels = opts.shadowLevels ?? 5;

    this.pyramid = new HeightPyramid(opts.height, opts.size, opts.cellSize);

    for (let L = 0; L < levelCount; L++) {
      this.levels.push(this.buildLevel(L, levelCount, shadowLevels));
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Construction
  // ───────────────────────────────────────────────────────────────────────────

  private buildLevel(L: number, _levelCount: number, shadowLevels: number): ClipLevel {
    const N = this.N;
    const spacing = this.baseSpacing * Math.pow(2, L);
    const halfSpan = (N / 2) * spacing;
    const isBlock = L === 0;

    // ── Shared vertex data ────────────────────────────────────────────────
    const side = N + 1;
    const vcount = side * side;
    const position = new Float32Array(vcount * 3);
    const normal = new Float32Array(vcount * 3);
    const uv = new Float32Array(vcount * 2);

    for (let j = 0; j <= N; j++) {
      const z = (j - N / 2) * spacing;
      for (let i = 0; i <= N; i++) {
        const k = j * side + i;
        position[k * 3] = (i - N / 2) * spacing;
        position[k * 3 + 1] = 0;
        position[k * 3 + 2] = z;
        normal[k * 3 + 1] = 1;
        // The two per-ring constants the displacement chunk needs, carried in
        // the otherwise-unused uv slot so that all seven levels can share one
        // material and therefore one draw state.
        uv[k * 2] = spacing;
        uv[k * 2 + 1] = halfSpan;
      }
    }

    const posAttr = new BufferAttribute(position, 3);
    const nrmAttr = new BufferAttribute(normal, 3);
    const uvAttr = new BufferAttribute(uv, 2);
    // The terrain carries no inverted hull, but the prepass and the line pass
    // still expect the outline attribute pair to exist on every geometry in the
    // project. A flat grid has no creases, so they are constant.
    const smoothAttr = new BufferAttribute(normal.slice(), 3);
    const curvAttr = new BufferAttribute(new Float32Array(vcount).fill(0.15), 1);

    // ── Index variants ────────────────────────────────────────────────────
    //
    // A ring is cut into a 4x4 grid rather than into quadrants. The whole point
    // of the hand-rolled cull is to reject geometry the frustum cannot see, and
    // a quadrant of a camera-CENTRED ring always has a corner at the camera —
    // so the frustum always intersects it, and the test could never reject
    // anything. Measured before this change: 2 of 28 quadrants culled, and the
    // two were the level-0 halves directly behind the camera. Sixteen blocks
    // put the ring's mass into pieces that are wholly off to one side, which is
    // the only shape of piece a frustum test can throw away.
    //
    // The middle four land on the hole and come out empty, except when the hole
    // is shifted a texel to track the finer level's snap, which leaves a
    // one-cell strip. Empty geometry is kept rather than special-cased: the
    // block set has to be the same size in every variant, and a zero-index
    // draw is skipped by the visibility test in `update`.
    const split = isBlock ? 2 : 4;
    const blocks = split * split;
    const step = N / split;
    const variantCount = isBlock ? 1 : 4;
    const variants: BufferGeometry[][] = [];
    for (let v = 0; v < variantCount; v++) {
      const shiftX = isBlock ? 0 : v & 1;
      const shiftZ = isBlock ? 0 : (v >> 1) & 1;
      const list: BufferGeometry[] = [];
      for (let b = 0; b < blocks; b++) {
        const bx = b % split;
        const bz = (b / split) | 0;
        const geo = new BufferGeometry();
        geo.setAttribute('position', posAttr);
        geo.setAttribute('normal', nrmAttr);
        geo.setAttribute('uv', uvAttr);
        geo.setAttribute('aSmoothNormal', smoothAttr);
        geo.setAttribute('aCurvature', curvAttr);
        geo.setIndex(
          new BufferAttribute(
            buildIndices(
              N,
              isBlock ? 0 : N / 4,
              shiftX,
              shiftZ,
              bx * step,
              (bx + 1) * step,
              bz * step,
              (bz + 1) * step,
            ),
            1,
          ),
        );
        finalizeGeometry(geo, { tolerance: 1e-3 });
        geo.name = `clip${L}:v${v}:b${b}`;
        list.push(geo);
      }
      variants.push(list);
    }

    // ── Meshes ────────────────────────────────────────────────────────────
    const meshes: Mesh[] = [];
    for (let b = 0; b < blocks; b++) {
      const mesh = new Mesh(variants[0][b], this.opts.materials.main);
      mesh.name = `terrain:L${L}:b${b}`;
      // Culled by hand against a real AABB; see the file header.
      mesh.frustumCulled = false;
      mesh.receiveShadow = true;
      mesh.castShadow = L < shadowLevels;
      mesh.userData.prepassMaterial = this.opts.materials.prepass;
      if (L < shadowLevels) {
        mesh.userData.shadowMaterial = this.opts.materials.shadow;
        // An open sheet must not be front-face culled in the shadow pass.
        mesh.userData.shadowSide = FrontSide;
      } else {
        mesh.userData.skipShadow = true;
      }
      this.object.add(mesh);
      meshes.push(mesh);
    }

    return {
      index: L,
      spacing,
      halfSpan,
      variants,
      meshes,
      split,
      originX: NaN,
      originZ: NaN,
      variant: -1,
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Per-frame
  // ───────────────────────────────────────────────────────────────────────────

  update(camera: PerspectiveCamera): void {
    camera.getWorldPosition(_camPos);

    _projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    _frustum.setFromProjectionMatrix(_projScreen);

    // The shadow run for this frame, decomposed per axis. Read from the shared
    // uniform rather than from a constructor option so a sun that moves — or a
    // pose that rotates it — cannot leave the cull describing yesterday's light.
    _shadowRun.copy(NPR.uSunDir.value).normalize().multiplyScalar(-this.shadowKeep);
    _sweepLo.set(Math.min(0, _shadowRun.x), Math.min(0, _shadowRun.y), Math.min(0, _shadowRun.z));
    _sweepHi.set(Math.max(0, _shadowRun.x), Math.max(0, _shadowRun.y), Math.max(0, _shadowRun.z));

    // ── Snap every level ──────────────────────────────────────────────────
    for (const lv of this.levels) {
      const q = lv.spacing * 2;
      lv.originX = Math.floor(_camPos.x / q) * q;
      lv.originZ = Math.floor(_camPos.z / q) * q;
    }

    this.stats.drawn = 0;
    this.stats.culled = 0;
    this.stats.triangles = 0;

    for (let L = 0; L < this.levels.length; L++) {
      const lv = this.levels[L];

      // ── Pick the hole variant ───────────────────────────────────────────
      // The finer level's origin is either on top of this one's or exactly one
      // of this level's texels away, in each axis. That offset is the variant.
      let variant = 0;
      if (L > 0) {
        const fine = this.levels[L - 1];
        const dx = Math.round((fine.originX - lv.originX) / lv.spacing) & 1;
        const dz = Math.round((fine.originZ - lv.originZ) / lv.spacing) & 1;
        variant = dx + dz * 2;
      }
      if (variant !== lv.variant) {
        lv.variant = variant;
        for (let b = 0; b < lv.meshes.length; b++) lv.meshes[b].geometry = lv.variants[variant][b];
      }

      // ── Place and cull ──────────────────────────────────────────────────
      const split = lv.split;
      const blockSpan = (lv.halfSpan * 2) / split;
      for (let b = 0; b < lv.meshes.length; b++) {
        const mesh = lv.meshes[b];
        mesh.position.set(lv.originX, 0, lv.originZ);
        mesh.updateMatrix();

        const idx = mesh.geometry.getIndex();
        if (!idx || idx.count === 0) {
          // A middle block sitting entirely on the ring's hole. Nothing to
          // draw, and nothing to count as culled either — it is not geometry.
          mesh.visible = false;
          continue;
        }

        const bx = b % split;
        const bz = (b / split) | 0;
        const x0 = lv.originX - lv.halfSpan + bx * blockSpan;
        const x1 = x0 + blockSpan;
        const z0 = lv.originZ - lv.halfSpan + bz * blockSpan;
        const z1 = z0 + blockSpan;

        this.pyramid.range(x0, z0, x1, z1, _minMax);
        // A little vertical slack: the vertex shader's bilinear can overshoot
        // the texel min/max by a fraction of a metre inside a cell.
        const y0 = _minMax[0] - 2;
        const y1 = _minMax[1] + 2;

        // Shadow casters are tested against the volume their own shadow can
        // reach, not against a ball of slack around them.
        //
        // A ridge just off the left edge of the screen at a 21-degree sun
        // throws its shadow a long way into shot, and culling it to the visible
        // frustum deletes that shadow — which then pops back the moment the
        // camera turns. The previous guard against that pushed every frustum
        // plane out by the full cascade reach, which is the Minkowski sum with
        // a 470 m SPHERE: it keeps the ridge up-sun of the camera, and equally
        // keeps every block 470 m down-sun, below, and behind, none of which
        // can cast a single pixel into the frame.
        //
        // Sweeping the block's own box along the direction the light TRAVELS is
        // the same guarantee for a fraction of the volume. `uSunDir` points
        // toward the sun, so the shadow runs along its negation, and the swept
        // box is just the box grown by that vector's positive and negative
        // components on their own axes.
        const cast = mesh.castShadow;
        const visible = frustumIntersectsBox(
          x0 + (cast ? _sweepLo.x : 0),
          y0 + (cast ? _sweepLo.y : 0),
          z0 + (cast ? _sweepLo.z : 0),
          x1 + (cast ? _sweepHi.x : 0),
          y1 + (cast ? _sweepHi.y : 0),
          z1 + (cast ? _sweepHi.z : 0),
        );
        mesh.visible = visible;

        if (visible) {
          this.stats.drawn++;
          this.stats.triangles += idx.count / 3;
        } else {
          this.stats.culled++;
        }
      }
    }
  }

  /**
   * Re-read the heightfield after a track carve so the culling pyramid still
   * describes the ground the vertex shader will produce.
   */
  refreshHeights(): void {
    this.pyramid.rebuild();
  }

  dispose(): void {
    for (const lv of this.levels) {
      for (const variant of lv.variants) {
        for (const geo of variant) geo.dispose();
      }
      for (const m of lv.meshes) this.object.remove(m);
      lv.meshes.length = 0;
    }
    this.levels.length = 0;
    this.object.clear();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Index generation
// ─────────────────────────────────────────────────────────────────────────────
/**
 * One BLOCK of one hole-variant of one level.
 *
 * `holeHalf` is measured in quads from the centre; 0 means a solid block.
 * `shiftX`/`shiftZ` move the hole by 0 or 1 quad, which is exactly the range of
 * misalignment the snapping can produce between adjacent levels.
 *
 * The winding puts the face normal at +Y, and the diagonal runs from (i, j+1)
 * to (i+1, j). That diagonal choice is load-bearing rather than arbitrary: it
 * is the one that makes a fully-morphed fine patch collapse onto EXACTLY the
 * coarse level's own two triangles. The other diagonal collapses onto a
 * different pair, and the two surfaces then disagree by up to half a texel of
 * height along every level boundary.
 */
function buildIndices(
  N: number,
  holeHalf: number,
  shiftX: number,
  shiftZ: number,
  iStart: number,
  iEnd: number,
  jStart: number,
  jEnd: number,
): Uint16Array {
  const side = N + 1;
  const half = N / 2;

  const out: number[] = [];
  for (let j = jStart; j < jEnd; j++) {
    // Local index space is centred on the ring, so the hole test is symmetric.
    const jl = j - half;
    const insideZ = holeHalf > 0 && jl >= shiftZ - holeHalf && jl + 1 <= shiftZ + holeHalf;
    for (let i = iStart; i < iEnd; i++) {
      const il = i - half;
      if (insideZ && holeHalf > 0 && il >= shiftX - holeHalf && il + 1 <= shiftX + holeHalf) {
        continue;
      }
      const a = j * side + i;
      const b = a + 1;
      const c = a + side;
      const d = c + 1;
      out.push(a, c, b, b, c, d);
    }
  }
  return Uint16Array.from(out);
}

// ─────────────────────────────────────────────────────────────────────────────
// Height min/max pyramid
// ─────────────────────────────────────────────────────────────────────────────
/**
 * A mip chain of per-tile height extremes.
 *
 * The base tile is 32 texels (64m at the shipping resolution) which is small
 * enough that a level-0 quadrant gets a tight vertical bound, and each level up
 * halves the tile count. Querying an arbitrary rectangle picks the coarsest
 * level that still covers it in a handful of tiles, so the cost is bounded at
 * about nine lookups regardless of how large the query is.
 */
export class HeightPyramid {
  private mins: Float32Array[] = [];
  private maxs: Float32Array[] = [];
  private counts: number[] = [];
  private readonly baseTile = 32;

  constructor(
    private height: Float32Array,
    private size: number,
    private cellSize: number,
  ) {
    this.rebuild();
  }

  rebuild(): void {
    this.mins.length = 0;
    this.maxs.length = 0;
    this.counts.length = 0;

    const n0 = Math.max(1, Math.ceil(this.size / this.baseTile));
    const min0 = new Float32Array(n0 * n0).fill(Infinity);
    const max0 = new Float32Array(n0 * n0).fill(-Infinity);

    for (let iz = 0; iz < this.size; iz++) {
      const tz = (iz / this.baseTile) | 0;
      const row = iz * this.size;
      const trow = tz * n0;
      for (let ix = 0; ix < this.size; ix++) {
        const t = trow + ((ix / this.baseTile) | 0);
        const h = this.height[row + ix];
        if (h < min0[t]) min0[t] = h;
        if (h > max0[t]) max0[t] = h;
      }
    }
    this.mins.push(min0);
    this.maxs.push(max0);
    this.counts.push(n0);

    let n = n0;
    while (n > 1) {
      const nn = Math.ceil(n / 2);
      const mn = new Float32Array(nn * nn).fill(Infinity);
      const mx = new Float32Array(nn * nn).fill(-Infinity);
      const pmn = this.mins[this.mins.length - 1];
      const pmx = this.maxs[this.maxs.length - 1];
      for (let z = 0; z < n; z++) {
        const dz = (z >> 1) * nn;
        for (let x = 0; x < n; x++) {
          const d = dz + (x >> 1);
          const s = z * n + x;
          if (pmn[s] < mn[d]) mn[d] = pmn[s];
          if (pmx[s] > mx[d]) mx[d] = pmx[s];
        }
      }
      this.mins.push(mn);
      this.maxs.push(mx);
      this.counts.push(nn);
      n = nn;
    }
  }

  /** Write [min, max] height over a world-space XZ rectangle into `out`. */
  range(x0: number, z0: number, x1: number, z1: number, out: Float32Array): void {
    const size = this.size;
    const t0x = clamp(Math.floor((x0 + WORLD_HALF) / this.cellSize), 0, size - 1);
    const t1x = clamp(Math.ceil((x1 + WORLD_HALF) / this.cellSize), 0, size - 1);
    const t0z = clamp(Math.floor((z0 + WORLD_HALF) / this.cellSize), 0, size - 1);
    const t1z = clamp(Math.ceil((z1 + WORLD_HALF) / this.cellSize), 0, size - 1);

    // Walk up until the query is covered by at most 3x3 tiles.
    let level = 0;
    for (; level < this.counts.length - 1; level++) {
      const tile = this.baseTile * (1 << level);
      const nx = ((t1x / tile) | 0) - ((t0x / tile) | 0) + 1;
      const nz = ((t1z / tile) | 0) - ((t0z / tile) | 0) + 1;
      if (nx <= 3 && nz <= 3) break;
    }

    const tile = this.baseTile * (1 << level);
    const n = this.counts[level];
    const mn = this.mins[level];
    const mx = this.maxs[level];

    const a0 = clamp((t0x / tile) | 0, 0, n - 1);
    const a1 = clamp((t1x / tile) | 0, 0, n - 1);
    const b0 = clamp((t0z / tile) | 0, 0, n - 1);
    const b1 = clamp((t1z / tile) | 0, 0, n - 1);

    let lo = Infinity;
    let hi = -Infinity;
    for (let b = b0; b <= b1; b++) {
      const row = b * n;
      for (let a = a0; a <= a1; a++) {
        const v = mn[row + a];
        if (v < lo) lo = v;
        const w = mx[row + a];
        if (w > hi) hi = w;
      }
    }
    if (!isFinite(lo)) {
      lo = 0;
      hi = 0;
    }
    out[0] = lo;
    out[1] = hi;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Culling helpers — written out longhand so the update path never allocates a
// Box3 or a Vector3.
// ─────────────────────────────────────────────────────────────────────────────

function frustumIntersectsBox(
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
): boolean {
  const planes = _frustum.planes;
  for (let i = 0; i < 6; i++) {
    const p = planes[i];
    // The positive vertex: the AABB corner furthest along the plane normal. If
    // even that corner is behind the plane, the whole box is.
    const px = p.normal.x > 0 ? x1 : x0;
    const py = p.normal.y > 0 ? y1 : y0;
    const pz = p.normal.z > 0 ? z1 : z0;
    if (p.normal.x * px + p.normal.y * py + p.normal.z * pz + p.constant < 0) return false;
  }
  return true;
}
