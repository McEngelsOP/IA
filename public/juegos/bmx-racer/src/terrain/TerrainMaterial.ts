/**
 * TerrainMaterial — the mountain's surface, and the three passes that draw it.
 *
 * Five decisions define this file. Each one exists because the obvious
 * alternative fails in a way that is visible in a screenshot.
 *
 * 1. HEIGHT LIVES IN A TEXTURE, NOT IN THE VERTEX BUFFER.
 *    The clipmap's rings are flat grids that slide over the world every frame.
 *    If height were baked into their vertices, every ring would have to have its
 *    positions rewritten and re-uploaded on every re-centre — megabytes per
 *    frame, and a guaranteed hitch. Fetching the height in the vertex shader
 *    from a single 2048² R32F texture makes a re-centre a change to one
 *    translation matrix.
 *
 * 2. NORMALS COME FROM A TEXTURE, NOT FROM THE GEOMETRY.
 *    This is the more important one. If shading normals came from the
 *    tessellation, the shading detail of the mountain would collapse as the LOD
 *    coarsened, and — because the cel ramp quantises — the band boundaries would
 *    visibly JUMP at every LOD transition. Sampling a full-resolution normal
 *    map instead means the terrain shades identically at 5m and at 2km, and the
 *    LOD becomes purely a silhouette question. Nothing else lets a hard-banded
 *    shader survive a geometry clipmap.
 *
 * 3. PER-ZONE RAMPS, SELECTED PER PIXEL, WITH NO BLEND.
 *    Seven complete cel ramps live in uniform arrays and one is chosen per
 *    fragment from the zone map. Choosing — not blending — is the whole point:
 *    a blend between two cel ramps produces intermediate colours that belong to
 *    neither palette, which is the single fastest way to make a stylised
 *    terrain look like a badly-lit realistic one.
 *
 * 4. THE SHADING ENTRY POINT IS REPLACED, NOT WRAPPED.
 *    `celShade()` in ShaderChunks reads ONE ramp from uniforms. Terrain needs
 *    seven. The material therefore defines `terrainShade()` and redirects the
 *    call site to it with a preprocessor macro (see TERRAIN_FRAGMENT below).
 *    The alternative — letting celShade run and then overwriting its result —
 *    would waste a full shadow-map lookup on every pixel of the largest surface
 *    in the frame, which at retina is tens of millions of texture fetches a
 *    frame thrown away.
 *
 * 5. THE PREPASS AND SHADOW MATERIALS ARE HAND-WRITTEN.
 *    `createPrepassMaterial` in CelMaterial.ts does not know about our vertex
 *    displacement, so the stock companions would rasterise a flat plane at y=0
 *    while the main pass draws a mountain. Both are rebuilt here from the same
 *    displacement chunk, which is the only way to guarantee they can never
 *    disagree.
 */

import {
  ClampToEdgeWrapping,
  Color,
  DataTexture,
  FloatType,
  FrontSide,
  GLSL3,
  IUniform,
  LinearFilter,
  LinearMipmapLinearFilter,
  NearestFilter,
  RGBAFormat,
  RedFormat,
  ShaderMaterial,
  Texture,
  UnsignedByteType,
  Vector4,
} from 'three';

import {
  GLSL_COMMON,
  GLSL_FRAG_OUT,
  GLSL_GLOBAL_UNIFORMS,
  GLSL_PREPASS_OUTPUTS,
  GLSL_VERTEX_TRANSFORM,
} from '../npr/ShaderChunks';
import { CelMaterial, materialIdFor } from '../npr/CelMaterial';
import { globalUniformBlock } from '../npr/NprGlobals';
import { RAMPS, RampPreset } from '../npr/Palette';
import { barkTexture, paperGrain, trailSurface } from '../npr/GeneratedTextures';
import { SurfaceKind } from '../game/Contracts';
import { TERRAIN_FEATURES, WORLD_HALF } from '../game/WorldConstants';
import { ZONE_KIND_COUNT, zoneMipLevels } from './Zones';

// ─────────────────────────────────────────────────────────────────────────────
// The direction the water runs
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The stream channel's own plan bearing, READ FROM THE FEATURE that carves it.
 *
 * The flow strokes have to run WITH the current, and the current runs down the
 * channel. The previous version built its phase from `w.x * 1.35 + w.y * 0.90`,
 * whose gradient points along (0.83, 0.55) — and the channel that
 * `carveFeatures` cuts runs along (sin 0.86, cos 0.86) = (0.758, 0.652). Those
 * are eleven degrees apart, so the bands the phase produced ran very nearly
 * ACROSS the stream: a set of rungs laid over the water like a ladder, which is
 * the one thing a painter would never draw on moving water. The measured frame
 * had no readable flow direction in it at all.
 *
 * Taken from the feature list rather than written as a number here, because a
 * constant copied out of an authoring table is a constant that will be wrong
 * the first time somebody rotates the stream.
 */
const STREAM_ANGLE =
  (TERRAIN_FEATURES.find((f) => f.kind === 'stream-channel')?.params.angle as number | undefined) ??
  0.86;
/** Unit vector ALONG the flow, in world XZ. */
const FLOW_X = Math.sin(STREAM_ANGLE);
const FLOW_Z = Math.cos(STREAM_ANGLE);

// ─────────────────────────────────────────────────────────────────────────────
// Data textures
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The height field as an R32F texture.
 *
 * NearestFilter is deliberate: WebGL2 only guarantees linear filtering of float
 * textures behind `OES_texture_float_linear`, so the vertex shader does its own
 * bilinear from four `texelFetch` taps. That is exact, extension-free, and it
 * matches `bilinearSample` on the CPU bit-for-bit in the cases that matter —
 * which is what keeps the wheels on the ground the render draws.
 */
export function createHeightTexture(height: Float32Array, size: number): DataTexture {
  const tex = new DataTexture(height, size, size, RedFormat, FloatType);
  tex.minFilter = NearestFilter;
  tex.magFilter = NearestFilter;
  tex.wrapS = ClampToEdgeWrapping;
  tex.wrapT = ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.name = 'terrain:height';
  tex.needsUpdate = true;
  return tex;
}

/**
 * RGB = world-space normal, A = erosion remapped to [0,1].
 *
 * Packing erosion into the spare channel is not a space saving — it is a
 * fetch saving. The fragment shader wants both at exactly the same texel on
 * every pixel of the mountain, and one RGBA fetch is half the bandwidth of two.
 */
export function buildNormalErosionData(
  height: Float32Array,
  erosion: Float32Array,
  size: number,
  cellSize: number,
): Uint8Array {
  const data = new Uint8Array(size * size * 4);
  writeNormalRegion(data, height, erosion, size, cellSize, 0, 0, size - 1, size - 1);
  return data;
}

/** Recompute a sub-rectangle of the normal/erosion data. Used after a carve. */
export function writeNormalRegion(
  data: Uint8Array,
  height: Float32Array,
  erosion: Float32Array,
  size: number,
  cellSize: number,
  ix0: number,
  iz0: number,
  ix1: number,
  iz1: number,
): void {
  const inv2c = 1 / (2 * cellSize);
  const x0 = Math.max(0, ix0);
  const z0 = Math.max(0, iz0);
  const x1 = Math.min(size - 1, ix1);
  const z1 = Math.min(size - 1, iz1);

  for (let iz = z0; iz <= z1; iz++) {
    const row = iz * size;
    const rowUp = (iz > 0 ? iz - 1 : 0) * size;
    const rowDn = (iz < size - 1 ? iz + 1 : size - 1) * size;
    for (let ix = x0; ix <= x1; ix++) {
      const xl = ix > 0 ? ix - 1 : 0;
      const xr = ix < size - 1 ? ix + 1 : size - 1;
      const dhdx = (height[row + xr] - height[row + xl]) * inv2c;
      const dhdz = (height[rowDn + ix] - height[rowUp + ix]) * inv2c;
      // The surface normal of h(x,z) is (-dh/dx, 1, -dh/dz), normalised.
      let nx = -dhdx;
      const ny = 1;
      let nz = -dhdz;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
      nx /= len;
      nz /= len;
      const i4 = (row + ix) * 4;
      data[i4] = Math.round((nx * 0.5 + 0.5) * 255);
      data[i4 + 1] = Math.round((1 / len) * 0.5 * 255 + 127.5);
      data[i4 + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      data[i4 + 3] = Math.round((erosion[row + ix] * 0.5 + 0.5) * 255);
    }
  }
}

export function createNormalTexture(data: Uint8Array, size: number): DataTexture {
  const tex = new DataTexture(data, size, size, RGBAFormat, UnsignedByteType);
  // Linear + mipmaps: this is the ONLY thing standing between the mountain and
  // a shimmering mess at distance, because the cel ramp turns a half-texel of
  // normal aliasing into a full band flip.
  tex.minFilter = LinearMipmapLinearFilter;
  tex.magFilter = LinearFilter;
  tex.wrapS = ClampToEdgeWrapping;
  tex.wrapT = ClampToEdgeWrapping;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.name = 'terrain:normal';
  tex.needsUpdate = true;
  return tex;
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared GLSL
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Declarations smuggled into the vertex stage through `CelOptions.varyings`.
 *
 * CelMaterial has exactly one insertion point that lands above `main()` in the
 * VERTEX shader, and this is it. The same text is also spliced into the
 * fragment shader (with the token `out` rewritten to `in`), which is why this
 * block contains no varying declarations, no `out` parameters, and nothing
 * whose meaning changes between the two stages — a uniform is a uniform and a
 * function is a function in both. `uHeightParams` is genuinely wanted in both
 * stages, so the duplication is useful rather than merely harmless.
 *
 * uHeightParams = (worldHalf, 1 / metresPerTexel, texelCount, metresPerTexel)
 */
export const TERRAIN_SHARED_DECLS = /* glsl */ `
  uniform sampler2D uHeightTex;
  uniform vec4 uHeightParams;

  /** World XZ -> normalised [0,1] texture coordinate on any terrain field. */
  vec2 terrainUv(vec2 wxz) {
    return (wxz + uHeightParams.x) * uHeightParams.y / uHeightParams.z;
  }

  /**
   * Bilinear height fetch, done by hand from four integer taps.
   * See the note on createHeightTexture for why this is not a texture() call.
   */
  float terrainHeight(vec2 wxz) {
    float n = uHeightParams.z;
    vec2 g = clamp((wxz + uHeightParams.x) * uHeightParams.y, vec2(0.0), vec2(n - 1.001));
    vec2 gi = floor(g);
    vec2 f = g - gi;
    ivec2 i0 = ivec2(gi);
    ivec2 i1 = min(i0 + ivec2(1), ivec2(int(n) - 1));
    float h00 = texelFetch(uHeightTex, ivec2(i0.x, i0.y), 0).r;
    float h10 = texelFetch(uHeightTex, ivec2(i1.x, i0.y), 0).r;
    float h01 = texelFetch(uHeightTex, ivec2(i0.x, i1.y), 0).r;
    float h11 = texelFetch(uHeightTex, ivec2(i1.x, i1.y), 0).r;
    return mix(mix(h00, h10, f.x), mix(h01, h11, f.x), f.y);
  }
`;

/**
 * The clipmap displacement, identical in all three passes.
 *
 * The geometry arriving here is a FLAT grid centred on its own origin, and the
 * mesh's model matrix is a pure XZ translation to the ring's snapped position.
 * Two constants that differ per ring travel in the unused `uv` attribute:
 *   uv.x = this ring's vertex spacing in metres
 *   uv.y = this ring's half extent in metres
 *
 * THE MORPH. Every second vertex of a ring does not exist on the next-coarser
 * ring. Left alone, that produces a T-junction crack at every level boundary
 * and a visible pop whenever a level re-centres. The fix is to slide those
 * vertices onto their coarse neighbour as they approach the ring's outer edge,
 * and — critically — to resample the height AFTER sliding, so the vertex stays
 * exactly on the surface throughout the transition rather than shearing off it.
 * By the outermost two rows the slide is complete, the ring's boundary edge is
 * literally a coarse-grid edge, and the join is exact rather than approximate.
 */
export const TERRAIN_ZONE_LOOKUP = /* glsl */ `
  uniform sampler2D uZoneTex;
  uniform float uZoneJitter;   // wander in MIP texels
  uniform float uZoneLodMax;

  /**
   * A texture fetch whose footprint is forced back toward ISOTROPIC.
   *
   * Hardware anisotropic filtering takes at most N samples along the major axis
   * of the pixel footprint and picks its mip level from the MINOR axis. That is
   * correct while the ratio between them is under N and catastrophically wrong
   * once it is over: the level is chosen as if the surface were being viewed
   * head-on, and the sixteen or eighty or four-hundred texels the pixel
   * actually covers along the view direction are represented by eight taps.
   * A mountainside seen from a chase camera is routinely at fifty to one.
   *
   * That is the whole of the one-pixel scanline chatter on the trail and on the
   * slopes beside it: not a missing mip chain, but a mip chain being asked for
   * the wrong level. Growing the minor axis until the ratio is inside what the
   * sampler can actually resolve costs a little sharpness at a grazing angle
   * and buys a surface that holds still. It is also the right ARTISTIC answer
   * — ground seen almost edge-on should read as a flat plane of paper, not as a
   * field of resolved grit.
   */
  vec4 isoSample(sampler2D tex, vec2 uv) {
    vec2 dx = dFdx(uv);
    vec2 dy = dFdy(uv);
    float lx = max(length(dx), 1e-9);
    float ly = max(length(dy), 1e-9);
    // 1/6: the textures this is used on carry anisotropy 4 to 8.
    float need = max(lx, ly) * 0.1667;
    dx *= max(1.0, need / lx);
    dy *= max(1.0, need / ly);
    return textureGrad(tex, uv, dx, dy);
  }

  /**
   * A fetch off the terrain's own fields at a LOD chosen from the screen, so
   * that one texel is guaranteed to cover a stated number of PIXELS.
   *
   * isoSample answers "do not under-sample this texture". This answers a
   * different question: "how big is the smallest mark this surface is allowed
   * to carry". They are not the same, and conflating them is what put a field
   * of one-pixel white sparks over every distant rock face. The normal map is
   * 2 m per texel; at three hundred metres that is fifteen screen pixels, so
   * every wrinkle of the eroded surface is still fully resolved and is still
   * being fed to a specular whose band threshold needs N.H above 0.9668. The
   * term therefore flips on and off between neighbouring pixels — which is a
   * correct evaluation of a highlight nobody asked for.
   *
   * A background painter's highlight is a SHAPE, drawn on the large form. The
   * floor is what makes it one: even under the wheels the lighting reads a
   * normal averaged over several metres, so a highlight cannot be finer than
   * the landform it sits on.
   *
   *   extra    = how many octaves coarser than one-texel-per-pixel
   *   minLevel = the floor, in mip levels, i.e. in doublings of 2 m
   */
  vec4 formSample(sampler2D tex, vec2 uv, float extra, float minLevel) {
    float texels = uHeightParams.z;
    vec2 dtx = dFdx(uv) * texels;
    vec2 dty = dFdy(uv) * texels;
    float fp = max(max(length(dtx), length(dty)), 1e-5);
    return textureLod(tex, uv, max(log2(fp) + extra, minLevel));
  }

  /**
   * How much of a detail layer survives at this pixel, in THREE HARD STEPS.
   *
   * Mip-correct sampling stops a detail texture aliasing, but it does not stop
   * it turning into a flat grey wash the moment a pixel covers more than a few
   * texels — and a flat grey wash multiplied over the band colour is a value
   * shift with no drawing in it, which is worse than nothing. This retires each
   * layer while it can still be seen as a mark. Quantised, because every fade
   * in this shader has to be: a continuous one is a gradient laid over the
   * hard bands, which is the defect the bands exist to prevent.
   */
  float detailFade(vec2 uv, float texSize) {
    float fp = max(length(dFdx(uv)), length(dFdy(uv))) * texSize;
    return floor(clamp(1.85 - fp * 0.55, 0.0, 1.0) * 3.0 + 0.5) / 3.0;
  }

  /**
   * The zone lookup, shared by the MAIN and PREPASS fragment shaders.
   *
   * It is ONE function because the two passes must agree exactly, and they did
   * not: the main pass jittered and block-snapped the lookup while the prepass
   * read the raw texel. The Sobel ID edge was therefore inked on the 2 m grid
   * staircase while the paint sat on blocks up to 64 m wide — hard zigzag lines
   * drawn across uniformly-coloured terrain, marking a boundary that was not
   * there. Two copies of a lookup this fiddly will always drift apart.
   *
   * It lives in its own chunk rather than in TERRAIN_SHARED_DECLS because that
   * block is injected into the VERTEX stage as well, and the derivative
   * builtins are fragment-only.
   *
   * ── WHY THIS IS A MIP FETCH AND NOT A BLOCK SNAP ────────────────────────
   * A material index cannot be filtered by averaging, so this used to snap the
   * LOOKUP POSITION to a power-of-two texel block sized from the screen-space
   * derivative and read level 0. That is a sound idea with one fatal detail:
   * the block size was clamped at 32 texels. On any obliquely-viewed slope —
   * which is most of the mountain — one screen pixel spans hundreds of texels,
   * so the block stopped tracking the footprint, adjacent pixels landed in
   * blocks several apart, and the surface broke into hard alternating stripes
   * of two entirely different ramps: the orange-and-lavender static over every
   * scree face and the white stipple over every snowfield.
   *
   * The reduction a zone map actually wants is a MAJORITY, and Zones.ts builds
   * one as a real mip chain (see buildZoneMips). So the footprint now selects a
   * LEVEL instead of a block, one mip texel is guaranteed to cover more than a
   * screen pixel, and the fetch is nearest-in-level, nearest-between-levels —
   * still a hard index, never an average, and now stable.
   *
   * The jitter survives, at a different scale and for a different reason. It is
   * a SUB-TEXEL displacement of the sample position, so it does nothing at all
   * in the interior of a patch and frays only the boundary — which is exactly
   * where a hard-edged material change wants to look torn rather than
   * rasterised. Its wavelength is tied to the mip texel, so it stays a few
   * pixels across at every distance, and its amplitude is about one mip texel,
   * so the edge wanders by roughly a pixel: a drawn edge, not a stair.
   *
   * ── AND ITS AMPLITUDE IS BOUNDED IN PIXELS, NOT IN TEXELS ───────────────
   * "The edge wanders by roughly a pixel" is only true while the pixel
   * footprint is ISOTROPIC. It is not, on ground seen at a grazing angle:
   * a fine raycast down a valley-vista column found a hundred and forty
   * consecutive screen rows covering nine metres of range, so one screen pixel
   * spanned tens of texels along the view direction and two or three across it.
   * The mip level is picked from the LONG axis, so mtex — and with it the
   * jitter, which is measured in mip texels — grows with the long axis, while
   * the boundary being frayed runs along the SHORT one. A displacement that is
   * a pixel and a half across the footprint is thirty to seventy pixels along
   * it, and that is the whole of the "eleven downward triangular teeth, sharp
   * points, like a torn paper fringe" hanging off the trail into the snow in
   * valley-vista: not the ribbon, not its skirt (measured: the skirt hangs
   * 0.20-1.45 m and changes at most 0.63 m from row to row), but the trail
   * zone's own painted boundary, torn by tens of pixels.
   *
   * A displacement of d texels moves the sample by at most d / fpMin pixels,
   * where fpMin is the SHORTER footprint axis. Capping d at three times fpMin
   * therefore caps the tear at three pixels in every direction. On isotropic
   * ground fpMin and fp are equal and the cap is above the amplitude already in
   * use, so nothing there changes at all — this only bites where it must.
   */
  int sampleZone(vec2 worldXZ, vec2 uvT, int kindCount) {
    float texels = uHeightParams.z;
    vec2 tc = uvT * texels;

    // Footprint of one screen pixel, in level-0 zone texels. The longer of the
    // two screen axes, because the artefact this exists to kill lives on the
    // axis that is most stretched.
    vec2 dtx = dFdx(tc);
    vec2 dty = dFdy(tc);
    float fp = max(length(dtx), length(dty));
    float fpMin = max(min(length(dtx), length(dty)), 1e-4);
    // The +0.85 bias is not a fudge: it makes one mip texel cover roughly TWO
    // screen pixels rather than one. At parity a boundary can still fall
    // between every adjacent pixel pair, which is a one-pixel checkerboard by
    // another name; at 2:1 the coarse field is resolved and what is left is a
    // genuine drawn edge.
    float lvl = clamp(floor(log2(max(fp, 1.0)) + 0.85 + 0.5), 0.0, uZoneLodMax);
    float mtex = exp2(lvl);

    // Wavelength four mip texels — eight screen pixels — so the tear reads as a
    // wobble in the line rather than as fizz along it, and so it is quantised
    // to the same ladder as the mip and therefore cannot crawl within a level.
    float nf = 0.25 / mtex;
    vec2 jit = vec2(fbm2(tc * nf, 2), fbm2(tc * nf + 47.3, 2)) - 0.5;
    // See the note above: texels for the wander, PIXELS for the cap.
    vec2 tcj = tc + jit * min(mtex * uZoneJitter, fpMin * 3.0);

    return clamp(int(textureLod(uZoneTex, tcj / texels, lvl).r * 255.0 + 0.5), 0, kindCount - 1);
  }
`;

// ─────────────────────────────────────────────────────────────────────────────
// The ground's own tonal ladder
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Composite units of the tonal field between one tonal level and the next.
 *
 * SIZED AGAINST ONE OCTAVE, NOT AGAINST THE SUM, and that is the whole
 * difference between a ladder that holds on nine columns and one that holds on
 * seven. Each octave below has a standard deviation near 0.13, so over one of
 * its own wavelengths it sweeps roughly 0.36 peak to peak. At the 0.26 this
 * started at, a single octave therefore covered about 1.4 rungs per wavelength
 * — enough for about one crossing, which is enough only while nothing else has
 * gone wrong. On a column where exactly one octave was still resolving and
 * happened to sit near the middle of a level, it produced NONE: measured on
 * switchback-lean x=2350, 350 rows all at 127,79,76.
 *
 * At 0.20 the same octave covers 1.8 rungs and the two live neighbours cover
 * about 2.4 between them, so a crossing inside a wavelength stops being a
 * coin-flip. The cost is that the field saturates against the outer levels more
 * often — about seven per cent of the ground sits at each end — and that is not
 * a cost at all: a painter's block-in has large flat darks and large flat
 * lights in it, and only the mid-values do the wandering.
 */
const SHAPE_RUNG = 0.2;

/**
 * Value multiply per tonal level. MEASURED, not chosen.
 *
 * The previous round applied four INDEPENDENT ternary fields, one per octave,
 * each multiplying the colour by 1 +- its own amplitude. Four independent
 * three-level fields have eighty-one distinct products, so the surface came out
 * as a dense stack of small steps: a 351-row column across the rock garden
 * measured SIXTEEN plateaus with a largest jump of 8.7 luma levels and a 71%
 * delta sign-flip rate. That is not a ramp, it is a wobble, and it is why the
 * fix that worked on the one measured column did not generalise — the column it
 * was tuned on happened to be bright enough (luma 150-200) that a single 10%
 * step cleared the review's threshold, and every darker surface in the game
 * (luma 85-125) could not.
 *
 * Summing the octaves FIRST and quantising ONCE gives what the brief actually
 * asks for: four tonal levels, one rung between neighbours, and that rung big
 * enough to survive the grade everywhere. Measured through the whole pipeline,
 * a multiply of this size arrives as roughly 10 luma levels at a base of 95 and
 * 13 at a base of 180 — the grade's shoulder gives back a little under half of
 * whatever is asked for at the bright end and about two thirds at the dark end.
 * The total spread, 3 rungs, is 1.55:1 across a hillside; the previous scheme's
 * worst case was 1.96:1, delivered as illegible fizz.
 */
const SHAPE_STEP = 0.135;

/**
 * The third value system, and the only one that works on the surface that
 * defeats the other two. Shared verbatim by the terrain and the track ribbon.
 *
 * A plate map of the treeline frame settled why it has to exist. Below the
 * crest, 385 consecutive rows — a third of the picture — sat on ONE aerial
 * plate, because the far wall of a bowl is very nearly equidistant from the
 * camera across its whole visible face. The ramp is constant there too: a dune
 * face of uniform slope has a constant normal, so the lighting term cannot move
 * either. Every quantised system in this shader was correctly returning the
 * same answer for every pixel, and the correct answer was a flat wash covering
 * a third of the frame.
 *
 * A background painter never leaves that surface flat. They break it into a
 * handful of large tonal shapes — where the sand is coarser, where the wind has
 * scoured, where an old slip has left a paler fan — and they draw an edge round
 * each one. That is a fact about the GROUND, not about the light or the air, so
 * it comes from a spatial field, and this is the only term in the material that
 * does.
 *
 * SIX OCTAVES, AT A RATIO OF ABOUT THREE — 0.59, 1.7, 4.9, 14, 41 and 119 m.
 *
 * The ratio is the point of the rewrite. The first version of this ran four
 * octaves at a ratio of EIGHT, and justified it with "whatever distance the
 * ground is at, one of them is the size a painter would have blocked in and the
 * two either side are too big to see and too small to resolve". The second half
 * of that sentence is true at a ratio of eight and it is the problem: at eight,
 * the neighbours really are useless, so exactly ONE octave is doing the drawing
 * at any given distance, and one octave with the contrast this field is allowed
 * covers about one and a half rungs per wavelength. That is one crossing if it
 * is lucky and none if it is not, which is precisely what a 350-row column on
 * switchback-lean measured: sixteen plateaus, all of them at luma 93, and zero
 * boundaries. At a ratio of three, two or three octaves are live and varying
 * over any span the camera can see, at genuinely different sizes, and the
 * crossing stops depending on luck.
 *
 * The shortest is not optional: at the camera heights this game uses, the
 * bottom FORTY PER CENT of every frame is ground six to nine metres away
 * spanning about 1.7 m of world — four hundred and forty rows of pixels over
 * 1.7 m. Nothing keyed on distance can put a boundary in there, nothing keyed
 * on the normal can either because it is flat, and a 34 m octave is constant
 * across 1.7 m. The longest is not optional either: it is the only thing that
 * blocks in a mountainside seen whole from a kilometre.
 *
 * THEY ARE SUMMED AND THEN QUANTISED ONCE. See SHAPE_STEP for why that is the
 * whole difference between a ladder and a wobble. The sum is the right operator
 * for a second reason too: the long octaves act as a BIAS on the short ones, so
 * wherever a short octave is the only thing moving it still crosses rungs,
 * because the rungs are uniformly spaced and repeat rather than being fixed
 * thresholds the bias can sit between.
 *
 * Each octave retires once its own wavelength stops resolving on screen, or it
 * would become the far field's noise floor instead of its drawing. Because the
 * terms are summed and then quantised, a retiring octave removes its own
 * contribution from the sum without shifting the ladder — the field stays
 * centred on zero at every distance. The two longest never stop resolving
 * inside the draw distance and so carry no fade.
 */
export const TERRAIN_GROUND_SHAPES = /* glsl */ `
  /**
   * How much of a world-space marking survives at this pixel, in THREE HARD
   * STEPS. Quantised, because every fade in this project has to be: a
   * continuous one is a gradient laid over the hard bands, which is the defect
   * the bands exist to prevent.
   */
  float groundShapeFade(vec2 uv, float texSize) {
    float fp = max(length(dFdx(uv)), length(dFdy(uv))) * texSize;
    return floor(clamp(1.85 - fp * 0.55, 0.0, 1.0) * 3.0 + 0.5) / 3.0;
  }

  /**
   * The tonal level of the ground at this pixel: one of -1.5, -0.5, 0.5, 1.5,
   * with an antialiased rung between neighbours and nothing continuous in it.
   *
   * The quantiser is written out rather than expressed as a pair of bandSteps
   * because the rungs REPEAT. A pair of fixed thresholds can only ever cut a
   * field into three levels at two specific values, and a near-field octave
   * riding on a long-octave bias that happens to sit between them produces no
   * boundary at all — which is exactly how a 350-row column came out with zero
   * steps over ten levels. A uniform ladder has a rung within half a rung of
   * wherever the field currently is, everywhere, by construction.
   *
   * The antialiasing is the screen-space derivative of the ladder coordinate
   * with a floor of 0.0015 under it. The floor matters: at 0.02 the ramp is
   * wider than the field's own slope over most of the frame, the outer levels
   * are never reached and a 15% step arrives as two levels of 255; at 0.0015 it
   * is below the field's per-pixel change nearly everywhere, so the derivative
   * term takes over and the rung is one pixel wide and correctly antialiased —
   * a boundary, drawn.
   */
  float groundShapeLevel(vec2 w) {
    // ONE lattice tap per octave, not an fbm. Six rungs of a ratio-three ladder
    // already carry every size the picture needs, so a second sub-octave inside
    // each one would only be adding detail that the octave below it is drawing
    // properly. Six taps against the previous scheme's eight: this rewrite is
    // cheaper than the thing it replaces, on the largest surface in the frame.
    vec2 uvN = w * 1.70;
    vec2 uvM = w * 0.585;
    vec2 uvA = w * 0.203;
    vec2 uvB = w * 0.0700;

    float form =
        (vnoise(uvN + 61.7) - 0.5) * 0.74 * groundShapeFade(uvN, 50.0)
      + (vnoise(uvM +  8.3) - 0.5) * 0.72 * groundShapeFade(uvM, 50.0)
      + (vnoise(uvA +  5.1) - 0.5) * 0.70 * groundShapeFade(uvA, 50.0)
      + (vnoise(uvB + 91.3) - 0.5) * 0.67 * groundShapeFade(uvB, 50.0)
      + (vnoise(w * 0.0242 + 23.9) - 0.5) * 0.62
      + (vnoise(w * 0.00835 + 47.1) - 0.5) * 0.52;

    float t = form * ${(1 / SHAPE_RUNG).toFixed(5)};
    float aa = max(fwidth(t) * 0.75, 0.0015);
    // Shifting by aa centres the ramp ON the rung instead of starting it there.
    float ts = t + aa;
    float f = floor(ts);
    return clamp(f - 0.5 + smoothstep(0.0, 2.0 * aa, ts - f), -1.5, 1.5);
  }

  /** The multiply the level above applies to a surface colour. */
  float groundShapeGain(vec2 w) {
    return 1.0 + groundShapeLevel(w) * ${SHAPE_STEP.toFixed(4)};
  }
`;

export const TERRAIN_DISPLACE = /* glsl */ `
  float ringSpacing = uv.x;
  float ringHalf    = uv.y;

  // Chebyshev distance from the ring centre, normalised. The ring is snapped to
  // the camera every frame, so this is also (to within one snap quantum) the
  // distance from the camera — which is what the morph wants to key on.
  float ringR = max(abs(localPos.x), abs(localPos.z)) / ringHalf;
  float morphK = clamp((ringR - 0.76) / 0.20, 0.0, 1.0);

  // 1 on grid indices that the coarser level does not have, 0 on shared ones.
  vec2 parity = mod(floor(abs(localPos.xz) / ringSpacing + 0.5), 2.0);
  localPos.xz -= parity * ringSpacing * morphK;

  vec2 terrainXZ = localPos.xz + vec2(modelMatrix[3].x, modelMatrix[3].z);
  localPos.y = terrainHeight(terrainXZ);
  localNrm = vec3(0.0, 1.0, 0.0);
`;

/**
 * The fragment program. Everything below runs once per terrain pixel, so the
 * costs are called out where they are paid.
 */
const TERRAIN_FRAGMENT = /* glsl */ `
  uniform sampler2D uNormalTex;      // rgb = world normal, a = erosion
  // uZoneTex / uZoneJitter are declared in TERRAIN_ZONE_LOOKUP, which this
  uniform sampler2D uDetailRock;     // stretched worley borders — rock bedding
  uniform sampler2D uDetailGravel;   // trail-surface generator, g = gravel
  uniform sampler2D uDetailGrain;    // paper grain — the finest tier of tooth

  uniform vec3  uZoneColor[${ZONE_KIND_COUNT * 4}];
  uniform vec4  uZoneThresh[${ZONE_KIND_COUNT}];
  uniform vec4  uZoneMiscA[${ZONE_KIND_COUNT}];  // bandCount, edgeSoftness, spec, specPower
  uniform vec4  uZoneMiscB[${ZONE_KIND_COUNT}];  // hatch, hatchScale, rim, rimPower
  // preamble is concatenated after. Declaring them twice fails to link.
  uniform float uDetailScale;

  /** Band select with the same one-pixel edge as bandStep, per-zone softness. */
  float zoneBandStep(float x, float t, float soft) {
    float w = max(fwidth(x) * 0.75, soft);
    return smoothstep(t - w, t + w, x);
  }

  /**
   * Evaluate zone z's ramp. Composited low-to-high exactly like evalRamp, and
   * three-band ramps simply weight their fourth step to zero — no branch, so
   * the fwidth() inside zoneBandStep is never evaluated under divergent flow.
   */
  vec3 evalZoneRamp(int z, float ndl) {
    int b = z * 4;
    vec4 th = uZoneThresh[z];
    float soft = uZoneMiscA[z].y;
    float has4 = step(3.5, uZoneMiscA[z].x);
    vec3 c = uZoneColor[b];
    c = mix(c, uZoneColor[b + 1], zoneBandStep(ndl, th.x, soft));
    c = mix(c, uZoneColor[b + 2], zoneBandStep(ndl, th.y, soft));
    c = mix(c, uZoneColor[b + 3], zoneBandStep(ndl, th.z, soft) * has4);
    return c;
  }

  float zoneBandIndex(int z, float ndl) {
    vec4 th = uZoneThresh[z];
    float soft = uZoneMiscA[z].y;
    float has4 = step(3.5, uZoneMiscA[z].x);
    return zoneBandStep(ndl, th.x, soft)
         + zoneBandStep(ndl, th.y, soft)
         + zoneBandStep(ndl, th.z, soft) * has4;
  }

  /**
   * A stroke centred on one band boundary, about one and a half pixels wide.
   *
   * A terminator on terrain is invisible to every line system in the project.
   * The Sobel pass reads normal, depth and material id, and all three are
   * CONTINUOUS across a band boundary — the surface does not bend there, it
   * does not step there, and it is the same material on both sides. So the
   * largest shapes in the picture changed value without one stroke marking the
   * change, which is the single thing a painted background never does. The only
   * place in the pipeline that knows where the boundary is, is here.
   *
   * THE WIDTH IS PURELY THE SCREEN-SPACE DERIVATIVE, with no floor under it.
   * A floor expressed in shading units is a line of unbounded SCREEN width: on
   * near-flat ground fwidth(lit) goes to nothing and the shading term drifts
   * across a threshold over tens of metres, so a fixed 0.0016 of value became a
   * stroke metres wide and the valley floor filled with fat nested contour
   * arcs. Keyed to the derivative alone the stroke is one and a half pixels
   * wherever it exists, and on ground genuinely flat enough to have no
   * terminator at all it correctly draws nothing.
   */
  float terminatorInk(float x, float t) {
    float w = max(fwidth(x) * 1.5, 1e-7);
    return 1.0 - smoothstep(0.0, w, abs(x - t));
  }

  /** All three boundaries of zone z's ramp, drawn. */
  float zoneTerminatorInk(int z, float lit) {
    vec4 th = uZoneThresh[z];
    float has4 = step(3.5, uZoneMiscA[z].x);
    float ink = terminatorInk(lit, th.x);
    ink = max(ink, terminatorInk(lit, th.y));
    ink = max(ink, terminatorInk(lit, th.z) * has4);
    return ink;
  }

  /**
   * Screen-space hatch, parameterised per zone.
   *
   * A copy of applyHatch with the strength and scale passed in rather than read
   * from uniforms, because the whole reason this material exists is that its
   * seven surfaces need seven different sets of those constants. Scree gets a
   * dense tight screen; snow gets almost none. Everything else is identical to
   * the shared implementation, deliberately, so terrain hatching and rider
   * hatching are visibly the same pen.
   */
  vec3 terrainHatch(vec3 col, float bandIdx, vec2 fragCoord, float strength, float scale) {
    float amount = strength * uHatchGlobal;
    float deep = 1.0 - saturate1(bandIdx);
    float mid  = saturate1(1.0 - abs(bandIdx - 1.0));
    // The mid tier used to be weighted 0.42, which — multiplied by a palette
    // hatch strength of 0.18 and then again by saturate1(cover) — put the
    // maximum darkening on packed dirt at four percent. Four percent is not a
    // hatch, it is a rounding error, and the shadow band on the largest plane
    // in the frame was left as flat paint.
    float cover = deep + mid * 0.58;
    vec2 huv = fragCoord / (34.0 * scale);
    const float a = 0.5934;                       // ~34 degrees off the pixel grid
    mat2 rot = mat2(cos(a), -sin(a), sin(a), cos(a));
    vec3 atlas = texture(uHatchTex, rot * huv).rgb;
    // TERRAIN SKIPS THE COARSE TIER. The atlas packs coarse/medium/fine in
    // R/G/B and applyHatch reaches for R in the deepest band, which is right on
    // a rider: his shadow side is a couple of hundred pixels across and wants a
    // stroke you can see the direction of. The same band on terrain is half the
    // frame, and a screen whose cell is visible at that size stops reading as
    // tone and starts reading as a texture stuck to the mountain. One tier
    // finer throughout — the biggest shape on the page takes the finest screen.
    float tier = mix(atlas.b, atlas.g, deep);
    float breakup = fbm2(fragCoord * 0.004, 2);
    float h = tier * mix(0.72, 1.0, breakup);
    return mix(col, col * 0.70, h * cover * amount * saturate1(cover));
  }

  vec3 terrainShade(CelInput s) {
    vec3 wp = s.worldPos;
    vec2 w = wp.xz;
    vec2 uvT = terrainUv(w);

    // ── Surface data: one fetch for normal + erosion, one for the zone ──────
    // isoSample, not texture(): see the note on isoSample. The normal map is
    // the input to a HARD ramp, so half a texel of anisotropic under-sampling
    // is not a softness artefact, it is a whole band flipping between adjacent
    // pixels — the alternating scanlines that covered every oblique slope.
    // formSample, not isoSample. isoSample stops the fetch under-sampling; it
    // does not stop the RESULT carrying detail finer than a pixel, and a hard
    // ramp fed a per-pixel normal produces a per-pixel band flip. One texel per
    // two pixels is the coarsest this can be without visibly rounding a ridge.
    vec4 nx = formSample(uNormalTex, uvT, 1.0, 0.0);
    vec3 N = normalize(nx.xyz * 2.0 - 1.0);
    float erosion = nx.w * 2.0 - 1.0;

    // The LARGE FORM of the same surface, at eight pixels a texel and never
    // finer than 8 m of ground. Everything that draws a SHAPE rather than a
    // tone reads this: the highlight, the rim, and the terminator stroke. See
    // formSample for why the alternative is a field of sparks.
    vec3 Nform = normalize(formSample(uNormalTex, uvT, 3.0, 2.0).xyz * 2.0 - 1.0);

    // ── Zone lookup ────────────────────────────────────────────────────────
    // Two problems, opposite ends of the distance range, one lookup.
    //
    // NEAR: the zone map is 2m per texel and sampled NEAREST, so every material
    // boundary is a 2m staircase — unmistakable pixelation from a low camera.
    // Jittering the LOOKUP by a couple of texels of high-frequency noise turns
    // that staircase into a torn edge without softening it by a single pixel.
    // The boundary is still a hard step between two ramps; it just stops
    // running along the grid.
    //
    // FAR: a nearest-sampled map with no mip chain — and it cannot have one,
    // because the average of rock (0) and grass (2) is dirt (1) — turns into
    // salt-and-pepper the moment a screen pixel spans more than a texel.
    // Snapping the lookup to a power-of-two texel block sized from the
    // screen-space derivative collapses that noise into large flat patches:
    // stable under camera motion, and exactly the cut-paper read the far
    // distance is supposed to have.
    int zone = sampleZone(w, uvT, ${ZONE_KIND_COUNT});

    // Everything with a highlight in it has to calm down at range, or the
    // normal map's minification turns a banded specular into a field of
    // crawling white sparks against the flat fog plateaus.
    // QUANTISED. On flat ground the lit term is constant by construction, so
    // this and the detail fade below were the ONLY terms varying across the
    // surface — which
    // means the smooth ramp the reviewer saw on every foreground plane was
    // being drawn by the two distance fades, not by the lighting. A stepped
    // fade keeps the intent (calm the highlights down at range) without laying
    // a gradient over the top of the hard bands.
    float farFade = floor((1.0 - smoothstep(150.0, 780.0, s.viewDist)) * 3.0 + 0.5) / 3.0;

    float isRock  = float(zone == ${SurfaceKind.Rock});
    float isDirt  = float(zone == ${SurfaceKind.Dirt});
    float isGrass = float(zone == ${SurfaceKind.Grass});
    float isScree = float(zone == ${SurfaceKind.Scree});
    float isSnow  = float(zone == ${SurfaceKind.Snow});
    float isWater = float(zone == ${SurfaceKind.Water});

    // ── Water is the one terrain surface with motion in it ──────────────────
    //
    // And the one that is NOT shaded with the terrain's own normal. That is the
    // whole reason the stream bed rendered as a flat lavender puddle: the zone
    // marked Water sits on the CHANNEL FLOOR, and a channel floor is eroded
    // rock — tilted, rough, and carrying a normal that scatters the ramp lookup
    // across every band at once. Perturbing that normal with a ripple only
    // adds noise to noise.
    //
    // A water surface is level, by definition, everywhere. Forcing it level and
    // then tilting it by the wave field is what turns RAMPS.water from four
    // colours nobody ever sees into four colours laid out as bands ACROSS the
    // flow, which is how water is drawn. The amplitude is chosen so N.L sweeps
    // roughly 0.02 to 0.72 — the whole ramp, all three thresholds crossed,
    // several times across the visible width of the stream.
    float ripple = sin(w.x * 2.4 + uTime * 1.6) + sin(w.y * 3.1 - uTime * 2.2);
    float chop   = sin(w.x * 0.62 - w.y * 0.51 + uTime * 0.9);
    vec3 waterN = normalize(vec3(ripple * 0.20 + chop * 0.11, 1.0, ripple * 0.15 - chop * 0.08));
    N = normalize(mix(N, waterN, isWater));

    // ── Lighting. Identical in structure to celShade; only the ramp differs ─
    vec3 V = s.viewDir;
    vec3 L = uSunDir;
    float ndlRaw = dot(N, L);

    // The committed sun sits at 21.5 degrees, so ridable ground occupies only
    // N.L in roughly [-0.15, 0.7]. A plain half-Lambert maps that narrow window
    // into the middle of the ramp and squaring it compresses it further, so an
    // entire dune lands inside ONE band and the largest surface in the frame
    // reads as a smooth gradient. Expanding the range the terrain genuinely
    // occupies onto the full ramp is what makes a dune show three plateaus.
    float lit = saturate1(ndlRaw * 1.15 + 0.16);

    // The shadow steps the ramp DOWN rather than scaling the term that feeds
    // it. Multiplying before the lookup sweeps the ramp continuously wherever
    // the penumbra is partial, re-introducing a gradient at exactly the edges
    // that are supposed to be the sharpest thing in the frame.
    // WATER TAKES A THIRD OF THAT STEP, and the reason is geometric rather
    // than a preference. The stream sits on the floor of a channel cut five and
    // a half metres deep, so at a 21.5 degree sun the whole bed is inside the
    // bank's shadow, all of it, always. A full 0.42 step-down puts lit at 0.16
    // against RAMPS.water's first threshold of 0.20 — so the ramp was pinned on
    // band ZERO over the entire stream and its three lit colours could never be
    // reached by the paint at all. Measured: 44,76,135 repeated identically at
    // every sample across the visible width, which is band 0 and nothing else.
    // A shadowed water surface is not a dark surface: what it mirrors is the
    // SKY, and a five-metre bank does not occlude the sky. Water is also the
    // one zone whose ramp is built to be swept by its own wave field rather
    // than by the terrain normal, so leaving it a range to sweep is the whole
    // point of forcing it level in the first place.
    float shadow = sunShadow(wp, N, s.viewDist, saturate1(ndlRaw));
    lit = max(lit - (1.0 - shadow) * mix(0.42, 0.13, isWater), 0.0);

    vec3 col = evalZoneRamp(zone, lit);
    float bIdx = zoneBandIndex(zone, lit);

    // Ambient bounce, QUANTISED. N.y varies smoothly across every rounded
    // landform, so tinting by it continuously lays a soft gradient over the top
    // of the hard bands and undoes them.
    // Quantised, but REMAPPED so a horizontal face never reaches pure sky.
    //
    // floor(x*3+0.5)/3 sends N.y = 1 to exactly 1.0, which made the bounce term pure
    // SKY_BOUNCE on every flat surface — and flat surfaces are most of the
    // frame. GROUND_BOUNCE, the warm dirt bounce that carries half the
    // committed dawn-gold, could therefore never contribute to the one surface
    // the player looks at for the entire run. A real horizontal patch of dirt
    // is lit by the sky AND by the sunlit ground around it; the range below
    // keeps a quarter of the warm term alive at the top of the scale.
    float upness = mix(0.18, 0.82, floor((N.y * 0.5 + 0.5) * 3.0 + 0.5) / 3.0);
    vec3 bounce = mix(uGroundBounce, uSkyBounce, upness);
    col = mix(col, col * bounce * 1.55, uAmbient * (1.0 - 0.55 * saturate1(bIdx / 3.0)));
    col *= s.albedoTint;

    // ── The drawn terminator ───────────────────────────────────────────────
    // See zoneTerminatorInk. This is the stroke that turns a band boundary
    // into a drawn edge instead of a raw colour step, and it is the only line
    // system in the project that can see one.
    //
    // AND IT RETIRES AT RANGE. terminatorInk fires wherever lit crosses a ramp
    // threshold, with a width of a pixel and a half. That is a drawn stroke on
    // a foreground form; on a hillside four hundred metres away, whose average
    // lit happens to sit near a threshold, it is a contour map — a mesh of
    // hairlines wandering over what should be one flat plate of paper. A
    // painter puts a line on the terminator of the shape they are drawing, not
    // on every fold of the mountain behind it. Quantised, like every other fade
    // in this file.
    float inkFade = floor((1.0 - smoothstep(70.0, 260.0, s.viewDist)) * 3.0 + 0.5) / 3.0;
    col = mix(col, col * 0.58, zoneTerminatorInk(zone, lit) * 0.80 * inkFade);

    // ── Aerial plates ──────────────────────────────────────────────────────
    // The defect this exists to kill, stated exactly: on flat ground lit is
    // constant BY CONSTRUCTION. Once every distance fade in this shader is
    // quantised there is nothing left varying across a flat surface at all, so
    // the largest plane in the frame renders as one enormous flat wash with a
    // smooth fog ramp laid over the top — which is precisely the "smooth
    // continuous ramp, nothing else" the review kept finding.
    //
    // A background painter does not paint receding ground as one plane. They
    // paint it as a STACK of flat plates, each a step cooler and hazier than
    // the one in front, with a boundary between them you can point at. On
    // receding ground an iso-distance contour runs roughly horizontally across
    // the frame, which is exactly where those boundaries belong.
    //
    // ── WHERE THE BOUNDARIES ARE, AND HOW BIG THE STEP IS ──────────────────
    // Both had to change, and the second mattered more.
    //
    // The old ladder ran log2(d/4)/9 in seven steps: boundaries at 6, 15, 37,
    // 90, 220 and 538 m, then a hard cap at 0.72 that the fifth step already
    // reached. From 220 m out to the horizon — which is most of every wide
    // shot, and the entire visible surface of a dune seen from a chase camera —
    // the stack was CONSTANT, so the largest shapes in the game were carrying
    // no plates at all. That is why a 420-row column down the main dune
    // measured ninety distinct values and not one plateau boundary.
    //
    // And where they did land they were invisible: one seventh of a 0.26 haze
    // mix is 3.7% of a colour barely different from the ground colour, plus a
    // 3% value multiply. Three or four levels out of 255. A step has to be a
    // step you can point at.
    //
    // THE LADDER HAS TO START UNDER THE WHEELS, and that is the correction the
    // first attempt at this still got wrong. A plate map of the treeline frame
    // showed the entire bottom 290 rows — a third of the picture — sitting on
    // plate zero, because an orbit or chase camera puts the ground it is
    // looking over between two and seven metres away and the ladder did not
    // start until five. The nearest boundary has to be nearer than the nearest
    // ground.
    //
    // SEVEN STEPS, NOT NINE, and that is a size decision rather than a spacing
    // one. Nine steps over the same range is 4.2% of value each; measured
    // through the grade at the far end of the scale, where the tone curve is
    // compressing hardest, a plate boundary on the treeline dune came out at
    // 3.2 levels of 255 — a 1.7% change, which is under the threshold at which
    // anyone can point at it. Spreading the same total range over seven puts
    // 7.0% between plates and roughly doubles what survives the curve.
    //
    // Boundaries — the distances at which the rounding flips, not the plate
    // centres — land at 3.2, 6.8, 14.4, 30.4, 64.4, 136 and 289 m. Three inside
    // fifteen metres, which is where an orbit or chase camera puts the ground it
    // is looking over, four inside sixty-five, and the last two carry the middle
    // distance up to where the fog bands take over at 223 m.
    float aerialT = saturate1(log2(clamp(s.viewDist, 2.2, 420.0) / 2.2) / 7.577);
    float plate   = floor(aerialT * 7.0 + 0.5) / 7.0;

    float hazeSun = saturate1(dot(normalize(-V), uSunDir));
    hazeSun = hazeSun * hazeSun;
    vec3 hazeCol = mix(uSkyBounce * 1.30, uFogSunTint * 1.10, hazeSun * 0.72);

    // THE VALUE LADDER CARRIES THE STEP; THE HAZE ONLY TINTS IT.
    //
    // A haze mix strong enough to be visible on its own is a chroma drain: it
    // is a mix toward one flat colour, so eight steps of it end with the far
    // field painted in sky blue and the dawn-gold gone. The previous version
    // did exactly that and the trail measured 30% saturation against an
    // authored 56%, with the hue rotated as far as magenta.
    //
    // A MULTIPLY cannot do that. It scales all three channels together, so it
    // moves value while leaving hue and saturation where the palette put them,
    // and it is therefore free to be large. 3.6% per step compounding to +27%
    // across the whole ladder is a plate stack you can read at a glance and a
    // palette that arrives at the grade intact. The haze mix on top is kept
    // small — a quarter of what it was per step — and warms toward the sun
    // exactly as the fog does, because at a 21.5 degree sun the air between you
    // and a ridge you are looking INTO is gold, not blue.
    //
    // Measured, twice, on the trail in summit-rider at the 6.8 m boundary:
    // nine steps of 4.2% arrived as 3.2 levels out of 255 and seven steps of
    // 6.5% arrived as 6.1. The grade's shoulder is giving back a little under
    // half of whatever is asked for up at a value of 195, so the ask has to be
    // roughly twice the wanted step. 7.6% a step lands it at seven or eight
    // levels, which is what separates two adjacent greys on a painted
    // background plate. The total 1.67x sounds large and is not: plate 7 does
    // not start until 289 m, by which point the fog bands own the pixel.
    col = mix(col, hazeCol, plate * 0.18);
    col *= mix(0.85, 1.42, plate);

    // ── Ground shapes: the third value system, and the only one that works ──
    // ── on the surface that defeats the other two ──────────────────────────
    //
    // The whole argument for this term, and for the exact shape of the
    // quantiser it uses, is in the block comment on TERRAIN_GROUND_SHAPES.
    // What belongs HERE is only why it is applied as it is.
    //
    // ONE call, one ladder, one multiply. The previous version evaluated four
    // INDEPENDENT ternary fields and multiplied their four gains together,
    // which is where the "fixed the column that was measured" verdict came
    // from: eighty-one distinct products, so the surface came out as a dense
    // stack of small steps whose size depended on where in the product space a
    // given patch of ground happened to sit. On the one column that had been
    // named — treeline x=1100 — the answer landed at forty-one distinct values
    // with a 80-row flat run, and on rockgarden-low x=2400 and crash
    // x=2400 the same code produced ZERO steps over ten levels across 350 and
    // 250 rows. Both of those are correct evaluations of the same expression;
    // it simply has no property that guarantees a boundary anywhere.
    //
    // Summing the octaves and quantising ONCE against a REPEATING ladder does
    // have that property, by construction, and that is the entire fix. See
    // groundShapeLevel.
    //
    // Water is exempt for the same reason it is exempt from the erosion cut
    // mark: the tonal shapes are a statement about what the GROUND is made of,
    // and the ground is under the water rather than being it.
    col *= mix(groundShapeGain(w), 1.0, isWater);

    // ── Surface detail ─────────────────────────────────────────────────────
    // Two vertical projections plus a horizontal one, blended by how the face
    // is oriented. A pure top-down projection smears into vertical streaks on
    // any cliff, which is the single most obvious tell of a cheap terrain
    // shader; a full three-axis triplanar costs a third more fetches than this
    // for a difference nobody can see on a heightfield, which by construction
    // never has a face steeper than vertical.
    // Both blend weights are QUANTISED to three steps. A continuous blend
    // between two orthogonal projections is what produces the vertical
    // smearing and the faint concentric moire a cliff face shows in these
    // frames: the two samples slide past each other pixel by pixel. Three
    // steps keeps the projection change from reading as a seam while stopping
    // it from sweeping.
    float wallness = floor((1.0 - smoothstep(0.42, 0.82, abs(N.y))) * 3.0 + 0.5) / 3.0;
    float kx = floor((abs(N.x) / max(abs(N.x) + abs(N.z), 1e-4)) * 3.0 + 0.5) / 3.0;
    float ds = uDetailScale;

    float rockZ = isoSample(uDetailRock, vec2(wp.z, wp.y) * ds).r;
    float rockX = isoSample(uDetailRock, vec2(wp.x, wp.y) * ds).r;
    // THE TOP-DOWN PROJECTION USES A DIFFERENT TEXTURE, and that is the whole
    // point of writing it out rather than reusing rockZ. uDetailRock is the
    // bark generator and bark is CONCENTRIC. On a vertical face those rings
    // read correctly as bedding, which is why the two side projections keep
    // them; projected straight down onto open ground they lay literal tree
    // rings across the valley floor — the nested arcs visible on every flat
    // foreground plane in these frames, which no amount of domain warping
    // removes because a warp bends a ring, it does not open it. The paper
    // grain has no preferred centre and no preferred direction, which is
    // exactly what ground seen from above wants.
    float rockY = isoSample(uDetailGrain, w * ds * 0.85).r;
    float bedding = mix(rockY, mix(rockZ, rockX, kx), wallness);

    // ── THE TWO LAYERS THAT DREW THE SCANLINE MOIRE ─────────────────────────
    // gravel at ds*2.4 is a tile per 7.6 m and grain at ds*5.0 a tile per 3.6 m
    // — and both were fetched with a plain texture() call, so on the trail,
    // seen at a raking angle, one pixel spanned tens of texels along the view
    // direction while the sampler picked its mip from the two or three texels
    // it spanned across. That is an eight-to-one under-sample at best and it
    // alternated row by row for two hundred rows.
    //
    // isoSample fixes the fetch. detailFade then retires each layer at the
    // point where a screen pixel covers about two texels of it, in three hard
    // steps, because a marking that can no longer be resolved as a marking has
    // to LEAVE rather than average into a grey film over the band colour.
    vec2 gravelUv = w * ds * 2.4;
    vec2 grainUv  = w * ds * 5.0;
    float gravel = isoSample(uDetailGravel, gravelUv).g;
    float grain  = isoSample(uDetailGrain, grainUv).r;
    float gravelAA = detailFade(gravelUv, 512.0);
    float grainAA  = detailFade(grainUv, 512.0);

    // High-frequency detail is faded out with distance rather than left to the
    // mip chain alone: past a few hundred metres the ridges have to read as
    // flat paper shapes, and any residual texture in them fights the fog bands.
    float detail = floor((1.0 - smoothstep(80.0, 430.0, s.viewDist)) * 4.0 + 0.5) / 4.0;

    // Rock bedding is a LARGE-scale feature and gets its own, far longer fade.
    // A canyon wall is normally seen from three to eight hundred metres, so on
    // the short fade above the one surface feature that could have broken the
    // wall up had already gone to zero by the time the wall was in frame — and
    // what was left, on a face where N.y is near zero and lit is therefore
    // constant across the whole plane, was lit concrete.
    float detailBed = floor((1.0 - smoothstep(420.0, 1500.0, s.viewDist)) * 3.0 + 0.5) / 3.0;

    // Every one of these is a HARD step. Nothing in this block is allowed to
    // introduce a gradient across the largest surface in the frame.
    float bed = bandStep(bedding, 0.46, 0.025);
    col = mix(col, col * 0.87, bed * (isRock * 0.70 + isScree * 0.30 + isWater * 0.35) * detailBed);

    // ── Strata ─────────────────────────────────────────────────────────────
    // Two hard bedding planes, sampled almost purely on world height so they
    // run level across a face the way real strata do, with just enough plan
    // drift that two neighbouring walls do not line up. This is the value break
    // that gives a vertical face plateaus to read; without it a wall has no
    // shading variation available to it at all, because every other term in
    // this shader is either a function of N (constant on a plane) or of view
    // distance (nearly constant across a face seen side-on).
    float strata = fbm2(vec2((wp.x + wp.z) * 0.010, wp.y * 0.085), 2);
    float wallMask = wallness * detailBed
                   * (isRock * 1.0 + isScree * 0.8 + isSnow * 0.35 + isDirt * 0.55 + isGrass * 0.3);
    col = mix(col, col * 0.845, bandStep(strata, 0.46, 0.02) * wallMask * 0.85);
    col = mix(col, col * 1.11,  bandStep(strata, 0.61, 0.02) * wallMask * 0.60);

    float pebble = 1.0 - bandStep(gravel, 0.30, 0.02);
    col = mix(col, col * vec3(1.07, 1.05, 1.0), pebble * (isScree * 0.34 + isDirt * 0.16) * detail * gravelAA);

    float clump = bandStep(grain, 0.53, 0.02);
    col = mix(col, col * vec3(0.91, 1.04, 0.89), clump * isGrass * 0.32 * detail * grainAA);

    // ── SNOW GETS THE LONGEST WAVELENGTH IN THE SHADER, ON PURPOSE ─────────
    // A snowfield is the one surface with no internal drawing in it at all: it
    // is a flat white shape with a drawn edge, and everything a shader adds
    // inside that shape is a defect. The drift mark used to run on rockY —
    // the 4 m paper grain — which at native resolution is a fine white
    // splatter over the summit and at any distance is pepper. This is a
    // 25-metre wind form with a hard edge: ONE readable shoulder across a
    // whole bowl, which is what a background painter draws, and which the mip
    // chain can still resolve at a kilometre.
    float sculpt = fbm2(w * 0.040 + 17.9, 2);
    float drift = bandStep(sculpt, 0.52, 0.03);
    col = mix(col, col * 1.055, drift * isSnow * 0.55);
    col = mix(col, col * 0.965, bandStep(sculpt, 0.38, 0.03) * (1.0 - drift) * isSnow * 0.45);

    // ── Erosion read ───────────────────────────────────────────────────────
    // The shading agrees with the shape: cut ground goes cold and dark, the
    // fan below it goes pale and warm. Both quantised, both narrow.
    float cut  = bandStep(-erosion, 0.34, 0.03);
    float fill = bandStep(erosion, 0.30, 0.03);
    // Water is exempt from the cut mark, and that exemption is the single
    // biggest reason the stream had no colour in it. A carved channel is the
    // most deeply cut ground on the mountain, so the cut mark was pinned at 1 over the
    // whole stream and pushed half of a desaturating grey-blue multiply through
    // the one surface in the game that is supposed to be the most saturated.
    // The riverbed is under the water; the water is not the riverbed.
    col = mix(col, col * vec3(0.86, 0.88, 0.95), cut * 0.50 * (1.0 - isWater));
    col = mix(col, col * vec3(1.05, 1.02, 0.96), fill * 0.34 * (1.0 - isWater));

    // ── Hatch, specular, rim — all per zone ────────────────────────────────
    col = terrainHatch(col, bIdx, s.fragCoord, uZoneMiscB[zone].x, uZoneMiscB[zone].y);

    // Nform, NOT N. RAMPS.snow asks for specPower 90 and rock for 48, and
    // bandedSpecular's halo tier fires at pow(N.H, p) > 0.20 — which for 90 is
    // N.H > 0.9823, a window four hundredths of a radian wide. Handed a normal
    // that still resolves the 2 m heightfield at three hundred metres, that
    // window opens and closes between neighbouring pixels for as far as the
    // slope runs. The result measured as a dense one-pixel splatter of near
    // white over the far snowfields, and it is the whole of the "fine white
    // stipple" in the review. On the eight-pixel form normal the same term
    // draws what it was always meant to draw: a few solid glints on the parts
    // of the hillside actually turned to the sun.
    float spec = bandedSpecular(Nform, V, L, uZoneMiscA[zone].w);
    col += uSpecColor * spec * uZoneMiscA[zone].z * (1.0 - isWater) * shadow
         * saturate1(ndlRaw * 2.0) * mix(0.12, 1.0, farFade);

    float rim = celRim(Nform, V, uZoneMiscB[zone].w);
    float sunSide = saturate1(dot(normalize(Nform + L * 0.35), V) * 0.5 + 0.75);
    col += uRimColor * rim * uZoneMiscB[zone].z * (1.0 - isWater) * mix(0.35, 1.0, sunSide);

    // ── Water ──────────────────────────────────────────────────────────────
    // RAMPS.water asks for specPower 160 and rimPower 4, and on this course
    // NEITHER CAN EVER FIRE. The sun sits at 21.5 degrees and the camera looks
    // down a valley at maybe 25, so the half-vector on a level water surface
    // stands about 23 degrees off the horizontal and N.H tops out near 0.4 —
    // pow(0.4, 160) is zero to every float in the machine. The rim is the same
    // story from the other side: N.V on that surface is about 0.42, so the
    // Fresnel term reaches 0.11 against a 0.42 threshold. The stream bed
    // therefore rendered as a flat painted puddle no matter what the palette
    // asked for, and no amount of turning the strengths up would have changed
    // it. Both terms are rebuilt here at exponents the geometry can actually
    // reach, which is why they are not simply read from the ramp block.
    //
    // ── AND EVERY HIGHLIGHT IS PAINT, NOT ADDITIVE WHITE ───────────────────
    //
    // That is the second half of the same defect, and it was the larger half.
    // The block used to add uSpecColor * 1.20 for the glitter, * 0.55 for the
    // sheet and uRimColor * 0.40 for the Fresnel, all on a surface whose base
    // colour is the most saturated in the palette. Sampled across the stream
    // in streambed, the water body itself measured hue 219 at 67% saturation —
    // correct, that is band 0 — while the areas those three terms covered
    // measured 203,191,193 / 211,208,211 / 245,230,255: value 200 to 255 at
    // ONE TO ELEVEN PER CENT. Not highlights, but soft white blooms tens of
    // pixels across, and enough of the surface for the region as a whole to
    // average out at the 14-30% the review measured against an authored 48%.
    //
    // An additive term is the wrong operator for a cel highlight for a reason
    // that has nothing to do with its strength: adding a grey drives every
    // channel toward equality, so it CANNOT produce a colour from the palette
    // and it always drains chroma. RAMPS.water already contains the two colours
    // this surface wants where light hits it — 9fd0dd and e6fbff, the pale and
    // the foam — and a mix reaches them exactly and stops there.
    //
    // (Sampled across the stream: see the note above for the measured values.)
    //
    // The thresholds are also tighter than they were. N.H on this geometry runs
    // to about 0.7 once the wave field has tilted the normal, and the old ones
    // (0.478 and 0.573 after the pow) were crossed over most of the surface,
    // which is why the "shapes" came out as blooms. These are crossed on the
    // wave crests only, which is where a painter puts them.
    vec3  Hw   = normalize(L + V);
    float nh   = saturate1(dot(N, Hw));
    vec3  wPale = uZoneColor[${SurfaceKind.Water * 4 + 2}];
    vec3  wFoam = uZoneColor[${SurfaceKind.Water * 4 + 3}];

    // ── Flow contours ──────────────────────────────────────────────────────
    // The current, drawn. Water in a cel background is not simulated and it is
    // not a shader effect on a plane — it is a set of long, tapering, hard-
    // edged strokes running WITH the flow, and a painter draws maybe four of
    // them across a stream this wide.
    //
    // The phase therefore advances ACROSS the channel and the strokes run
    // ALONG it. See STREAM_ANGLE for why the previous version had that exactly
    // backwards. The stroke is bent by a long wave along the channel and by the
    // ripple field, so it meanders the way a real current line does instead of
    // ruling a straight edge, and it is advected downstream by uTime so the
    // water moves in the direction the channel goes.
    float acrossFlow = w.x * ${FLOW_Z.toFixed(5)} - w.y * ${FLOW_X.toFixed(5)};
    float alongFlow  = w.x * ${FLOW_X.toFixed(5)} + w.y * ${FLOW_Z.toFixed(5)};
    float flowPhase  = acrossFlow * 1.55
                     + sin(alongFlow * 0.23 - uTime * 0.9) * 1.15
                     + ripple * 0.45;
    float flowWide = bandStep(sin(flowPhase), 0.42, 0.03);
    float flowCore = bandStep(sin(flowPhase * 2.13 + 1.7), 0.80, 0.02) * flowWide;

    // The flat patch of sky the water mirrors back, as ONE hard shape cut by
    // the wave field so it breaks into the shards a painter would draw, and
    // the tighter tier of glitter on the crests inside it.
    float sheet = bandStep(nh + ripple * 0.045, 0.575, 0.006);
    float fleck = bandStep(nh + chop * 0.05, 0.665, 0.004);

    // The glancing-angle band. A Fresnel on a horizontal plane seen from a
    // chase camera is very nearly constant — N.V sits around 0.42 over the
    // whole surface — so as an ADDITIVE it was a flat wash over the entire
    // stream rather than a rim on anything. As a mix toward the ramp's own pale
    // band at a fifth strength it is what it should always have been: the far
    // water reading a shade lighter and cooler than the near water, in palette.
    float wrim = bandStep(pow(1.0 - saturate1(dot(N, V)), 1.6), 0.44, 0.03);

    vec3 wcol = col;
    wcol = mix(wcol, wPale, sheet * 0.66 * mix(0.55, 1.0, shadow));
    wcol = mix(wcol, wFoam, fleck * 0.52 * shadow);
    wcol = mix(wcol, wPale, wrim  * 0.20);
    wcol = mix(wcol, wPale, flowWide * 0.20);
    wcol = mix(wcol, wFoam, flowCore * 0.46);
    // ONE additive term survives, at a twelfth of what the block used to spend,
    // because the hot core of a current line is the single place on this course
    // where a stroke brighter than the palette is correct.
    wcol += uSpecColor * flowCore * 0.10 * shadow;
    col = mix(col, wcol, isWater);

    return col;
  }

  // Redirect celShade's single call site in CelMaterial's main() to the
  // seven-ramp version above. The macro is declared AFTER celShade's own
  // definition, so that definition is untouched and simply becomes dead code.
  #define celShade(inputSurface) terrainShade(inputSurface)
`;

// ─────────────────────────────────────────────────────────────────────────────
// Zone ramp packing
// ─────────────────────────────────────────────────────────────────────────────

/** Which ramp preset paints each SurfaceKind. */
export const ZONE_RAMPS: Record<SurfaceKind, RampPreset> = {
  [SurfaceKind.Rock]: RAMPS.rock,
  [SurfaceKind.Dirt]: RAMPS.dirt,
  [SurfaceKind.Grass]: RAMPS.grass,
  [SurfaceKind.Scree]: RAMPS.scree,
  [SurfaceKind.Snow]: RAMPS.snow,
  [SurfaceKind.Water]: RAMPS.water,
  [SurfaceKind.Trail]: RAMPS.trail,
};

/**
 * Terrain-only gain on the palette's hatch strengths.
 *
 * The ramp presets are shared with the rider, the bike and the vegetation,
 * where a hatch strength of 0.18 is a whisper laid over a shape the eye is
 * already reading from its silhouette. Terrain has no silhouette to lean on: it
 * is one plane covering half the frame, and at 0.18 — multiplied again by the
 * mid-tier cover weight — its shadow band came out four percent darker than its
 * lit band and read as flat paint. The hatch is the ONLY texture a shadowed
 * plane gets, so terrain takes the same pen pressed harder — but only about
 * two-thirds again. Past roughly 0.45 the screen cell becomes legible at the
 * size terrain occupies and the hatch reads as a texture stuck to the mountain
 * rather than as tone laid over the picture.
 *
 * This lives here rather than in Palette because it is a statement about how
 * big the surface is, not about what the surface is made of.
 */
const TERRAIN_HATCH_GAIN = 1.7;

function packZoneUniforms(): {
  colors: Color[];
  thresholds: Vector4[];
  miscA: Vector4[];
  miscB: Vector4[];
} {
  const colors: Color[] = [];
  const thresholds: Vector4[] = [];
  const miscA: Vector4[] = [];
  const miscB: Vector4[] = [];

  for (let k = 0; k < ZONE_KIND_COUNT; k++) {
    const p = ZONE_RAMPS[k as SurfaceKind];
    // Pad short ramps by repeating the last colour and pushing the unused
    // threshold out of reach, exactly the way rampUniforms does for CelMaterial.
    const c = p.colors.map((x) => x.clone());
    while (c.length < 4) c.push(c[c.length - 1].clone());
    colors.push(c[0], c[1], c[2], c[3]);

    const t = [...p.thresholds];
    while (t.length < 3) t.push(1.5);
    thresholds.push(new Vector4(t[0], t[1], t[2], 0));

    miscA.push(new Vector4(p.colors.length, p.edgeSoftness, p.specStrength, p.specPower));
    miscB.push(
      new Vector4(p.hatchStrength * TERRAIN_HATCH_GAIN, p.hatchScale, p.rimStrength, p.rimPower),
    );
  }

  return { colors, thresholds, miscA, miscB };
}

// ─────────────────────────────────────────────────────────────────────────────
// The material set
// ─────────────────────────────────────────────────────────────────────────────

export interface TerrainMaterialOptions {
  heightTexture: DataTexture;
  normalTexture: DataTexture;
  zoneTexture: DataTexture;
  size: number;
  /** Metres per height texel. */
  cellSize: number;
}

export interface TerrainMaterialSet {
  main: CelMaterial;
  prepass: ShaderMaterial;
  shadow: ShaderMaterial;
  /** Shared uniform objects — written once, seen by all three programs. */
  shared: Record<string, IUniform>;
  dispose(): void;
}

/**
 * Build the main / prepass / shadow trio.
 *
 * They share the height texture uniform OBJECT, not just its value, so a
 * re-upload after a track carve cannot leave one pass a frame behind another.
 */
export function createTerrainMaterials(o: TerrainMaterialOptions): TerrainMaterialSet {
  const heightParams = new Vector4(WORLD_HALF, 1 / o.cellSize, o.size, o.cellSize);

  // uZoneJitter and uZoneLodMax live HERE, not in the fragment-only block, and
  // that is a bug fix rather than tidiness. TERRAIN_ZONE_LOOKUP is compiled
  // into the prepass as well, but the prepass material was only ever handed
  // `shared` — so the jitter uniform it declared was never bound, defaulted to
  // zero, and the prepass sampled a zone boundary the main pass had moved by up
  // to two texels. The material-id Sobel was therefore inking a line beside the
  // paint edge rather than on it, which is the second half of the same defect
  // the shared sampleZone() function exists to close.
  const shared: Record<string, IUniform> = {
    uHeightTex: { value: o.heightTexture as Texture },
    uHeightParams: { value: heightParams },
    uNormalTex: { value: o.normalTexture as Texture },
    uZoneTex: { value: o.zoneTexture as Texture },
    // About one mip texel of wander — see sampleZone. This is a SUB-TEXEL
    // displacement now, not the 2.5 level-0 texels the block-snap version used.
    uZoneJitter: { value: 1.15 },
    // The zone chain runs to 1x1, but past 256 texels a block is half a
    // kilometre of mountain and the far ridges lose the shape of their
    // snowfields. 8 levels is 512 m, which is coarser than anything the eye
    // resolves at the distance the clamp is reached.
    uZoneLodMax: { value: Math.min(8, zoneMipLevels(o.size)) },
  };

  // Material ids, one per zone, so the Sobel pass inks every material boundary
  // on the mountain as an interior line. Depth and normal are both continuous
  // across a grass/scree boundary — the id channel is the only thing that can
  // see it, and seeing it is the difference between a painted edge and a
  // texture change.
  const zoneIds: number[] = [];
  for (let k = 0; k < ZONE_KIND_COUNT; k++) {
    zoneIds.push(materialIdFor(`terrain:${ZONE_RAMPS[k as SurfaceKind].name}`));
  }

  const packed = packZoneUniforms();
  const detailScale = 0.055;

  const fragUniforms: Record<string, IUniform> = {
    uDetailRock: { value: barkTexture() },
    uDetailGravel: { value: trailSurface() },
    uDetailGrain: { value: paperGrain() },
    uZoneColor: { value: packed.colors },
    uZoneThresh: { value: packed.thresholds },
    uZoneMiscA: { value: packed.miscA },
    uZoneMiscB: { value: packed.miscB },
    uDetailScale: { value: detailScale },
  };

  // The base preset is only used for the handful of uniforms terrainShade still
  // reads from the shared ramp block (uSpecColor, uRimColor) and for the
  // material's name. Every band colour comes from the per-zone arrays.
  const main = new CelMaterial(RAMPS.rock, {
    name: 'terrain',
    idName: 'terrain',
    outlineWidth: 0,
    fog: true,
    varyings: TERRAIN_SHARED_DECLS,
    vertexBody: TERRAIN_DISPLACE,
    fragmentPreamble: TERRAIN_ZONE_LOOKUP + TERRAIN_GROUND_SHAPES + TERRAIN_FRAGMENT,
    uniforms: { ...shared, ...fragUniforms },
  });
  main.side = FrontSide;

  // Lose the depth tie against the trail ribbon, which is coplanar with this
  // surface by construction (the carve targets the ribbon exactly, because the
  // heightfield is what the wheels collide with).
  //
  // The bias goes on the GROUND, pushing it away, rather than on the ribbon
  // pulling it nearer. Nearer is the obvious choice and it is wrong: a tyre
  // resting on the trail is tangent to it, so a ribbon biased toward the camera
  // wins the depth test against the bottom of the wheel and draws over it. That
  // is what buried the rear wheel in the trail — the physics contact patch
  // never penetrated (max 0.000 m over a full run) and the drawn axle sat at
  // 0.271 m against a 0.267 m wheel radius, so the tyre was four millimetres
  // clear of the ground and the ribbon was simply painted on top of it.
  //
  // Biasing the ground backwards resolves the same tie without ever moving a
  // surface in front of something standing on it.
  main.polygonOffset = true;
  main.polygonOffsetFactor = 2;
  main.polygonOffsetUnits = 4;

  const prepass = createTerrainPrepassMaterial(shared, zoneIds);
  const shadow = createTerrainShadowMaterial(shared);

  return {
    main,
    prepass,
    shadow,
    shared,
    dispose(): void {
      main.dispose();
      prepass.dispose();
      shadow.dispose();
    },
  };
}

/**
 * The G-buffer prepass.
 *
 * Note what it does NOT do: it does not read the geometry normal. The normal it
 * writes is the same full-resolution texture normal the main pass shades with,
 * so the interior-line pass sees the creases the eye sees rather than the
 * tessellation of whichever clipmap ring happened to cover that pixel. Without
 * that, every LOD boundary would draw itself as a line across the mountain.
 */
function createTerrainPrepassMaterial(
  shared: Record<string, IUniform>,
  zoneIds: number[],
): ShaderMaterial {
  const mat = new ShaderMaterial({
    glslVersion: GLSL3,
    side: FrontSide,
    uniforms: {
      ...globalUniformBlock(),
      ...shared,
      uZoneIds: { value: zoneIds },
    },
    vertexShader: /* glsl */ `
      precision highp float;
      ${GLSL_COMMON}
      ${GLSL_GLOBAL_UNIFORMS}
      ${GLSL_VERTEX_TRANSFORM}
      ${TERRAIN_SHARED_DECLS}

      out vec3  vWorld;
      out float vViewDepth;

      void main() {
        vec3 localPos = position;
        vec3 localNrm = normal;
        ${TERRAIN_DISPLACE}

        vec3 wpos, wnrm;
        toWorld(localPos, localNrm, wpos, wnrm);
        vec4 vpos = viewMatrix * vec4(wpos, 1.0);
        vWorld = wpos;
        vViewDepth = -vpos.z;
        gl_Position = projectionMatrix * vpos;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      ${GLSL_COMMON}
      ${GLSL_PREPASS_OUTPUTS}
      ${TERRAIN_SHARED_DECLS}
      ${TERRAIN_ZONE_LOOKUP}

      uniform sampler2D uNormalTex;
      uniform float uZoneIds[${ZONE_KIND_COUNT}];

      in vec3  vWorld;
      in float vViewDepth;

      void main() {
        vec2 uvT = terrainUv(vWorld.xz);
        // The SAME fetch the main pass uses, anisotropy cap and all. If the
        // prepass read a sharper normal than the paint, the Sobel would ink
        // creases the shading does not have — a mesh of hairline scratches over
        // a surface the main pass is drawing as one flat plane.
        vec3 n = normalize(formSample(uNormalTex, uvT, 1.0, 0.0).xyz * 2.0 - 1.0);
        vec3 vn = normalize((viewMatrix * vec4(n, 0.0)).xyz);

        int zone = sampleZone(vWorld.xz, uvT, ${ZONE_KIND_COUNT});

        // Curvature from the screen-space rate of change of the normal. On a
        // heightfield this is a better estimate than anything bakeable: it
        // already accounts for how obliquely the surface is being viewed, so a
        // ridge seen edge-on thickens its own stroke.
        float curv = clamp(length(fwidth(n)) * 5.5, 0.0, 1.0);

        fragColor = vec4(vn, vViewDepth);
        gAux = vec4(uZoneIds[zone], curv, 0.0, 1.0);
      }
    `,
  });
  mat.name = 'terrain:prepass';
  return mat;
}

/**
 * The sun-cascade depth material.
 *
 * FrontSide, not the usual BackSide. The stock shadow material culls front
 * faces to kill acne on closed solids; a heightfield is an open sheet with
 * every triangle facing up, so front-face culling would cull the entire
 * mountain and it would cast nothing at all.
 */
function createTerrainShadowMaterial(shared: Record<string, IUniform>): ShaderMaterial {
  const mat = new ShaderMaterial({
    glslVersion: GLSL3,
    side: FrontSide,
    uniforms: {
      ...globalUniformBlock(),
      ...shared,
    },
    vertexShader: /* glsl */ `
      precision highp float;
      ${GLSL_COMMON}
      ${GLSL_GLOBAL_UNIFORMS}
      ${GLSL_VERTEX_TRANSFORM}
      ${TERRAIN_SHARED_DECLS}

      out float vDepth;

      void main() {
        vec3 localPos = position;
        vec3 localNrm = normal;
        ${TERRAIN_DISPLACE}

        vec3 wpos, wnrm;
        toWorld(localPos, localNrm, wpos, wnrm);
        vec4 clip = projectionMatrix * viewMatrix * vec4(wpos, 1.0);
        vDepth = clip.z / clip.w * 0.5 + 0.5;
        gl_Position = clip;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      ${GLSL_FRAG_OUT}
      in float vDepth;
      void main() {
        fragColor = vec4(vDepth, vDepth, vDepth, 1.0);
      }
    `,
  });
  mat.name = 'terrain:shadow';
  return mat;
}
