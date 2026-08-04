/**
 * CelMaterial — the one material factory the whole game builds surfaces from.
 *
 * Everything visible in DESCENT is a `CelMaterial` built from a `RampPreset`.
 * There is no MeshStandardMaterial anywhere in the project, and no code path
 * that could introduce one. That is the structural guarantee behind the "if any
 * surface reads as physically based, the art direction has failed" constraint —
 * there is no PBR to leak in.
 *
 * Each material also builds two silent companions:
 *   • a G-buffer prepass material (normal + depth + id + curvature)
 *   • a shadow-depth material
 * both sharing its defines, so instanced and skinned geometry can never fall
 * out of sync between passes. Outline hulls detaching from their mesh is
 * almost always a prepass/main mismatch; making them the same object removes
 * the failure mode.
 */

import {
  AddEquation,
  BackSide,
  Color,
  CustomBlending,
  DoubleSide,
  FrontSide,
  IUniform,
  Material,
  Mesh,
  OneFactor,
  ShaderMaterial,
  Side,
  Texture,
  Vector2,
  Vector3,
  ZeroFactor,
  GLSL3,
  Object3D,
  BufferGeometry,
  InstancedMesh,
  SkinnedMesh,
} from 'three';

import {
  GLSL_CEL_CORE,
  GLSL_CEL_SURFACE,
  GLSL_COMMON,
  GLSL_FOG,
  GLSL_FRAG_OUT,
  GLSL_GLOBAL_UNIFORMS,
  GLSL_HULL_VERTEX,
  GLSL_PREPASS_OUTPUTS,
  GLSL_RAMP_UNIFORMS,
  GLSL_SHADOW,
  GLSL_VERTEX_TRANSFORM,
} from './ShaderChunks';
import { globalUniformBlock, NPR } from './NprGlobals';
import { INK, LINES, RampPreset, RAMPS } from './Palette';

// ─────────────────────────────────────────────────────────────────────────────
// Material IDs. The Sobel pass draws an interior line wherever this value
// changes between neighbouring pixels, which catches the edges depth and
// normal both miss — an arm crossing a torso at the same depth and angle.
// ─────────────────────────────────────────────────────────────────────────────
let nextMaterialId = 1;
const idByName = new Map<string, number>();
export function materialIdFor(name: string): number {
  let id = idByName.get(name);
  if (id === undefined) {
    id = nextMaterialId++;
    idByName.set(name, id);
  }
  return id;
}

/**
 * Distance identity — the floors that keep a subject legible once it is small.
 *
 * The brief RIDER_COLORS states in Palette.ts is that four riders must be
 * "instantly distinguishable at 200 m in silhouette-plus-hue". Three separate
 * mechanisms conspire to break that, and all three get worse as the subject
 * shrinks rather than as it recedes:
 *
 *  1. THE INK EATS THE SHAPE. `LINES.targetPixels` holds the hull stroke at
 *     2.15 device px at every distance, and its only taper is by DISTANCE
 *     (42-340 m). A 20 px rider therefore gets a 2.15 px stroke on every
 *     silhouette edge — the outline is drawing a third of the character on
 *     each axis and the interior colour has nowhere left to live.
 *  2. THE RIM COLLAPSES. `celRim` is a Fresnel: pow(1 - N.V, rimPower)
 *     thresholded at 0.42. The band of surface steep enough to clear that is a
 *     fixed angular width, so its WIDTH IN PIXELS shrinks with the subject and
 *     goes sub-pixel around 40 px. That rim is the only thing separating a
 *     rider from a slope of similar value.
 *  3. HAZE AND GRADE PULL THE HUE. Quantised fog mixes toward the plateau
 *     colour and the LUT's split-tone warms everything, both of which move a
 *     jersey toward the terrain hue.
 *
 * These floors are OPT-IN and must stay that way. Applied globally they would
 * refuse to let far ridges flatten into haze plateaus, which is the single
 * composition device the whole game's depth read is built on. They belong to
 * things the audience has to be able to name: riders.
 *
 * Every constant here is a candidate for Palette.ts — see the report.
 */
export interface IdentityOptions {
  /** The committed identity hue. Comes from RIDER_COLORS. */
  color: Color;
  /** World metres the subject spans. A rider is ~1.7. */
  height?: number;
  /** Apparent height (device px) at which the floors are fully off. */
  fullPx?: number;
  /** Apparent height (device px) at which the floors are fully on. */
  floorPx?: number;
  /** How hard the chroma floor re-seats the fragment on the committed hue. */
  chroma?: number;
  /** Strength of the forced separating rim once small. */
  rim?: number;
  /** Outline width multiplier at `floorPx`. 1 disables the ink taper. */
  inkFloor?: number;
}

/**
 * Distance-identity defaults. The tuning lives in `LINES` in Palette.ts with
 * the rest of the art direction; only `height` is a geometric fact about the
 * subject rather than a choice, so it stays here.
 */
const IDENTITY_DEFAULTS = {
  height: 1.7,
  fullPx: LINES.identityFullPx,
  floorPx: LINES.identityFloorPx,
  chroma: LINES.identityChroma,
  rim: LINES.identityRim,
  inkFloor: LINES.identityInkFloor,
};

export interface CelOptions {
  /** Rendered as an InstancedMesh — enables the per-instance attribute block. */
  instanced?: boolean;
  /** Rendered as a SkinnedMesh — enables the bone-texture skinning path. */
  skinned?: boolean;
  /** Geometry carries a `color` attribute used as an albedo tint. */
  vertexColors?: boolean;
  /** Geometry carries an `aAo` float attribute (1 = open, 0 = occluded). */
  vertexAo?: boolean;
  /** Foliage wind: geometry carries an `aSway` float (0 at root, 1 at tip). */
  wind?: boolean;
  /** Alpha-tested cut-out — canopy cards, grass tufts. */
  alphaTest?: number;
  /** Generated albedo/mask texture. Multiplied over the ramp result. */
  map?: Texture | null;
  side?: Side;
  transparent?: boolean;
  depthWrite?: boolean;
  /** 0 = pure ramp, 1 = pure matcap. Metals sit around 0.45. */
  matcapMix?: number;
  /**
   * Override the preset's specular exponent.
   *
   * Exists because a cel highlight is a DRAWN SHAPE, not a microfacet
   * distribution, and the two want wildly different numbers. `bandedSpecular`
   * thresholds `pow(N.H, power)` at 0.62 and 0.20, so a power of 140 asks for
   * N.H > 0.99659 — the reflection vector within 4.7 degrees of the eye. With
   * the committed sun at 21.5 degrees elevation that condition is met on a
   * few square pixels of a helmet shell at best, so the declaration produced
   * essentially nothing and what the eye actually read on the crown was the
   * ramp and the matcap. The same mistake had already been found and fixed on
   * RAMPS.water (specPower 160 → 4); this is the hook that lets a material be
   * corrected without touching a shared palette constant.
   *
   * Measured on `rider-closeup`: at 140 the crown highlight is a 4 px bump
   * peaking at luma 182; at 9 it is a flat 8 px plateau at 212 with a
   * one-pixel step on both sides. That plateau is the drawn shape.
   */
  specPower?: number;
  /** Override the preset's specular strength. */
  specStrength?: number;
  /**
   * Posterise the shaded value into this many tiers. 0 (default) is off.
   *
   * There is exactly one continuous term left in `celShade`, and it is the
   * ambient bounce:
   *
   *     vec3 bounce = mix(uGroundBounce, uSkyBounce, N.y * 0.5 + 0.5);
   *     col = mix(col, col * bounce * 1.55, uAmbient * ...);
   *
   * `N.y` is smooth, so that is a smooth multiplier — and not a small one:
   * across a full hemisphere it swings the blue channel from 0.69x to 1.04x
   * and the red the other way, at uAmbient = 0.38. On terrain, which is
   * enormous and nearly flat, that is a subtle sky tint doing exactly what it
   * was written to do. On a 12 cm helmet shell at a 180 px crop it is a full
   * smooth gradient painted straight over the hard bands underneath, and it
   * is what a critic identified as "the one thing that reads as PBR in an
   * otherwise clean rider". Killing the specular, the matcap and the rim on
   * the helmet all left it untouched, which is how it was found.
   *
   * The term is in ShaderChunks and shared by every surface in the game, so
   * that is not the place to change it. A surface that must stay graphic
   * instead posterises the result: value is quantised (in a roughly
   * perceptual curve) while hue and saturation are preserved exactly, so the
   * ramp, the rim and the specular all survive as flat tiers.
   */
  valueSteps?: number;
  /**
   * Draw a CONTOUR around the specular highlight. 0 (default) is off.
   *
   * A cel highlight is a shape with an edge. `bandedSpecular` already gives it
   * flat tiers — but flat tiers alone are a posterised photograph, not a
   * drawing, and the difference is that an animator puts a LINE round the
   * glint. This is that line: the highlight's own outer boundary, inked at a
   * width taken from the term's screen derivative so it is one pixel wide at
   * every angle, in the material's own darkest band so a helmet contour stays
   * a helmet colour.
   *
   * Two things were tried before this and both are worth recording, because
   * each looked right on paper:
   *
   *  • `specPower` 140 → 9. A scanline across the crown at `rider-closeup`
   *    afterwards reads five genuinely FLAT plateaus (luma 75, 122, 90, 143,
   *    200), so the exponent fix worked exactly as intended. It did not change
   *    the read, and a term-by-term isolation on one frozen frame — spec off,
   *    matcap off, rim off, bloom off — proved why: the crown looked the same
   *    with all four dead. The tiers were never the problem.
   *
   *  • Posterising the whole shaded value (`valueSteps`) and inking every tier
   *    boundary. On a DOME the value varies radially, so the tiers are
   *    concentric and the lines came out as a set of nested rings — the helmet
   *    read as a contour map. A highlight is ONE shape, so only the highlight's
   *    own boundary may be drawn.
   */
  specInk?: number;
  /** Override the preset's rim strength / exponent. */
  rimStrength?: number;
  rimPower?: number;
  /**
   * DISTANCE IDENTITY. Opt-in, and deliberately so — see the note on
   * `identityUniforms` below. Enables a chroma floor, a rim floor and an
   * outline taper keyed to the subject's APPARENT SIZE in device pixels.
   */
  identity?: IdentityOptions;
  tint?: Color;
  tintStrength?: number;
  /** Override the preset's outline width. 0 disables the hull entirely. */
  outlineWidth?: number;
  /** Extra GLSL injected into the fragment shader before `celShade` is called. */
  fragmentPreamble?: string;
  /** Extra GLSL run inside main() after the base colour is computed.
   *  Has access to `celCol` (inout vec3), `vWorldPos`, `vNormal`, `vUv`. */
  fragmentBody?: string;
  /** Extra GLSL run in the vertex shader; may modify `localPos`/`localNrm`. */
  vertexBody?: string;
  /** Extra uniforms merged into the material. */
  uniforms?: Record<string, IUniform>;
  /** Extra #defines. */
  defines?: Record<string, string | number>;
  /** Extra varyings declared in both stages (e.g. `out float vFoo;`). */
  varyings?: string;
  /** Written into the G-buffer for ID-based interior edges. */
  idName?: string;
  /** Skip the G-buffer prepass (sky dome, fully transparent FX). */
  noPrepass?: boolean;
  /** Skip shadow casting. */
  noShadow?: boolean;
  /** Receives fog. Off for the sky dome and for HUD-space geometry. */
  fog?: boolean;
  name?: string;
}

export class CelMaterial extends ShaderMaterial {
  declare uniforms: Record<string, IUniform>;
  readonly preset: RampPreset;
  readonly celOptions: CelOptions;
  /** Companion materials — built lazily by `ensurePassMaterials`. */
  prepassMaterial: ShaderMaterial | null = null;
  shadowMaterial: ShaderMaterial | null = null;
  hullMaterial: ShaderMaterial | null = null;

  constructor(preset: RampPreset, opts: CelOptions = {}) {
    const defines = buildDefines(opts);
    const varyings = opts.varyings ?? '';

    super({
      glslVersion: GLSL3,
      defines,
      uniforms: {
        ...globalUniformBlock(),
        ...rampUniforms(preset, opts),
        ...(opts.uniforms ?? {}),
      },
      vertexShader: buildVertexShader(opts, varyings),
      fragmentShader: buildFragmentShader(opts, varyings),
      side: opts.side ?? FrontSide,
      transparent: opts.transparent ?? false,
      depthWrite: opts.depthWrite ?? true,
      alphaTest: opts.alphaTest ?? 0,
      lights: false,
      fog: false,
    });

    this.preset = preset;
    this.celOptions = opts;
    this.name = opts.name ?? `cel:${preset.name}`;
  }

  /** Live-tunable band colours — used by the palette debug overlay. */
  setBandColor(index: number, color: Color): void {
    (this.uniforms.uBandColor.value as Color[])[index].copy(color);
  }

  setTint(color: Color, strength = 1): void {
    (this.uniforms.uTint.value as Color).copy(color);
    this.uniforms.uTintStrength.value = strength;
  }
}

function buildDefines(opts: CelOptions): Record<string, string | number> {
  const d: Record<string, string | number> = { ...(opts.defines ?? {}) };
  // USE_INSTANCING and USE_SKINNING are injected by three itself based on the
  // object type; we only declare the *extra* channels we add on top.
  if (opts.instanced) d.NPR_INSTANCED = 1;
  if (opts.skinned) d.NPR_SKINNED = 1;
  if (opts.vertexColors) d.NPR_VERTEX_COLOR = 1;
  if (opts.vertexAo) d.NPR_VERTEX_AO = 1;
  if (opts.wind) d.NPR_WIND = 1;
  if (opts.map) d.NPR_MAP = 1;
  if (opts.fog !== false) d.NPR_FOG = 1;
  if ((opts.alphaTest ?? 0) > 0) d.NPR_ALPHATEST = 1;
  if (opts.identity) d.NPR_IDENTITY = 1;
  if ((opts.valueSteps ?? 0) > 0) d.NPR_QUANTIZE = 1;
  if ((opts.specInk ?? 0) > 0) d.NPR_SPEC_INK = 1;
  return d;
}

/**
 * Uniforms for the distance-identity block. Declared in the shader only under
 * NPR_IDENTITY, and supplied only when the option is set, so a material that
 * does not opt in carries neither the code nor the uniforms.
 */
function identityUniforms(opts: CelOptions): Record<string, IUniform> {
  const id = opts.identity;
  if (!id) return {};
  const height = id.height ?? IDENTITY_DEFAULTS.height;
  const fullPx = id.fullPx ?? IDENTITY_DEFAULTS.fullPx;
  const floorPx = id.floorPx ?? IDENTITY_DEFAULTS.floorPx;
  return {
    uIdentityColor: { value: id.color.clone() },
    uIdentityHeight: { value: height },
    // x = the size at which the floors are fully off, y = fully on.
    uIdentityPx: { value: new Vector2(fullPx, floorPx) },
    uIdentityChroma: { value: id.chroma ?? IDENTITY_DEFAULTS.chroma },
    uIdentityRim: { value: id.rim ?? IDENTITY_DEFAULTS.rim },
    uIdentityInkFloor: { value: id.inkFloor ?? IDENTITY_DEFAULTS.inkFloor },
  };
}

/**
 * Apparent height of the subject in device pixels, from a view distance.
 *
 * `projectionMatrix[1][1]` is 1/tan(fovY/2), so this is the exact inverse of
 * the conversion the outline hull already uses to hold a stroke at a constant
 * pixel width — the two therefore agree about what a pixel is, which is the
 * only reason the ink taper below can be trusted.
 *
 * Fragment shaders under three do NOT receive `projectionMatrix` (only
 * `viewMatrix` and `cameraPosition`), so this is always evaluated in the
 * vertex stage and carried across as a varying.
 */
const GLSL_IDENTITY_SIZE = /* glsl */ `
  float identityPixels(float viewDist) {
    return uIdentityHeight * uResolution.y * projectionMatrix[1][1] / max(2.0 * viewDist, EPS);
  }
`;

const GLSL_IDENTITY_UNIFORMS = /* glsl */ `
  uniform vec3  uIdentityColor;
  uniform float uIdentityHeight;
  uniform vec2  uIdentityPx;      // x = fully off above, y = fully on below
  uniform float uIdentityChroma;
  uniform float uIdentityRim;
  uniform float uIdentityInkFloor;
`;

function rampUniforms(p: RampPreset, opts: CelOptions): Record<string, IUniform> {
  const colors = [...p.colors.map((c) => c.clone())];
  while (colors.length < 4) colors.push(colors[colors.length - 1].clone());
  const thresholds = [...p.thresholds];
  while (thresholds.length < 3) thresholds.push(1.5); // never reached

  return {
    uBandColor: { value: colors },
    uBandThreshold: { value: thresholds },
    uBandCount: { value: p.colors.length },
    uEdgeSoftness: { value: p.edgeSoftness },
    uSpecStrength: { value: opts.specStrength ?? p.specStrength },
    uSpecPower: { value: opts.specPower ?? p.specPower },
    uSpecColor: { value: p.specColor.clone() },
    uRimStrength: { value: opts.rimStrength ?? p.rimStrength },
    uRimPower: { value: opts.rimPower ?? p.rimPower },
    uRimColor: { value: p.rimColor.clone() },
    uHatchStrength: { value: p.hatchStrength },
    uHatchScale: { value: p.hatchScale },
    uTint: { value: (opts.tint ?? new Color(1, 1, 1)).clone() },
    uTintStrength: { value: opts.tintStrength ?? 0 },
    uMatcapMix: { value: opts.matcapMix ?? 0 },
    uMaterialId: { value: materialIdFor(opts.idName ?? p.name) },
    uOpacity: { value: 1 },
    uMap: { value: opts.map ?? null },
    uWindStrength: { value: opts.wind ? 1 : 0 },
    uValueSteps: { value: opts.valueSteps ?? 0 },
    uSpecInk: { value: opts.specInk ?? 0 },
    ...identityUniforms(opts),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Vertex shader
// ─────────────────────────────────────────────────────────────────────────────
function buildVertexShader(opts: CelOptions, varyings: string): string {
  return /* glsl */ `
    precision highp float;
    ${GLSL_COMMON}
    ${GLSL_GLOBAL_UNIFORMS}
    ${GLSL_VERTEX_TRANSFORM}

    uniform float uWindStrength;

    #ifdef NPR_IDENTITY
      ${GLSL_IDENTITY_UNIFORMS}
      ${GLSL_IDENTITY_SIZE}
      out float vScreenPx;
    #endif

    #ifdef NPR_VERTEX_AO
      in float aAo;
    #endif
    #ifdef NPR_WIND
      in float aSway;
    #endif

    out vec3  vWorldPos;
    out vec3  vNormal;
    out vec2  vUv;
    out float vViewDist;
    out vec3  vAlbedoTint;
    out float vAo;
    ${varyings}

    void main() {
      vec3 localPos = position;
      vec3 localNrm = normal;

      ${opts.vertexBody ?? ''}

      resolveLocal(localPos, localNrm);

      #ifdef NPR_WIND
        // Wind is applied in OBJECT space before instancing so an instanced
        // forest sways coherently rather than each tree sliding sideways.
        float phase = 0.0;
        #ifdef USE_INSTANCING
          phase = aInstancePhase;
        #endif
        float t = uTime * 1.35 + phase;
        // Two-band motion: a slow trunk lean plus a faster branch flutter.
        float slow = sin(t * 0.55) * 0.6 + sin(t * 0.31 + 1.7) * 0.4;
        float fast = sin(t * 3.1 + localPos.y * 2.3) * 0.35;
        float amt = aSway * aSway * uWindStrength;
        localPos.x += (slow * 0.34 + fast * 0.10) * amt;
        localPos.z += (slow * 0.20 - fast * 0.13) * amt;
      #endif

      vec3 wpos, wnrm;
      toWorld(localPos, localNrm, wpos, wnrm);

      vWorldPos = wpos;
      vNormal   = wnrm;
      vUv       = uv;
      vViewDist = length(wpos - uCameraPos);

      #ifdef NPR_IDENTITY
        vScreenPx = identityPixels(vViewDist);
      #endif

      vec3 tint = vec3(1.0);
      #ifdef NPR_VERTEX_COLOR
        tint *= color;
      #endif
      #ifdef USE_INSTANCING
        #ifdef NPR_INSTANCED
          tint *= aInstanceTint;
        #endif
      #endif
      vAlbedoTint = tint;

      #ifdef NPR_VERTEX_AO
        vAo = aAo;
      #else
        vAo = 1.0;
      #endif

      gl_Position = projectionMatrix * viewMatrix * vec4(wpos, 1.0);
    }
  `;
}

// ─────────────────────────────────────────────────────────────────────────────
// Fragment shader
// ─────────────────────────────────────────────────────────────────────────────
function buildFragmentShader(opts: CelOptions, varyings: string): string {
  const inVaryings = varyings.replace(/\bout\b/g, 'in');
  return /* glsl */ `
    precision highp float;
    ${GLSL_COMMON}
    ${GLSL_GLOBAL_UNIFORMS}
    ${GLSL_RAMP_UNIFORMS}
    ${GLSL_SHADOW}
    ${GLSL_CEL_CORE}
    ${GLSL_FOG}
    ${GLSL_CEL_SURFACE}
    ${GLSL_FRAG_OUT}

    uniform sampler2D uMap;
    uniform float uValueSteps;
    uniform float uSpecInk;

    in vec3  vWorldPos;
    in vec3  vNormal;
    in vec2  vUv;
    in float vViewDist;
    in vec3  vAlbedoTint;
    in float vAo;
    ${inVaryings}

    #ifdef NPR_IDENTITY
      ${GLSL_IDENTITY_UNIFORMS}
      in float vScreenPx;

      /**
       * Restate a shrinking subject at its committed colour.
       *
       * Two floors, both keyed to APPARENT SIZE rather than distance, because
       * what breaks the read is pixels and not metres — a rider 40 m away
       * through a long lens is perfectly legible and the same rider 40 m away
       * in a wide is not.
       *
       *  CHROMA FLOOR. The fragment's own luminance is quantised to three
       *  steps and used to re-light the committed hue, then blended in. That
       *  keeps the band structure — the figure still has a lit side and a
       *  shadow side, still reads as three flat values — while making it
       *  impossible for haze or the grade to walk the hue toward the terrain.
       *  It is deliberately NOT a saturation boost: boosting saturation on a
       *  fragment that has already been mixed 70% toward a teal haze plateau
       *  produces a saturated teal rider.
       *
       *  RIM FLOOR. The Fresnel exponent is opened up as the subject shrinks,
       *  which widens the band of surface that clears the rim threshold from a
       *  hairline to a couple of pixels. A background painter drawing a 15 px
       *  figure does exactly this: the light wrap stops being a hairline and
       *  becomes one of the three or four marks that make up the whole figure.
       *
       *  AND IT TAKES THE SUBJECT'S OWN HUE AS IT DOES SO. That is not a
       *  flourish, it is the difference between the two floors helping each
       *  other and fighting. Measured on the opponent's jersey alone — rendered
       *  twice per size and differenced against a render with only the jersey
       *  hidden, so the sample is exactly the jersey and nothing else — the
       *  first version of this rim was a NET LOSS below 25 px:
       *
       *      15 px jersey   floors off   mean chroma 67   on-hue 59%
       *      15 px jersey   floors on    mean chroma 44   on-hue 25%
       *
       *  The hue it re-seated was right (peak hue error fell from 5 deg to 2),
       *  but the jersey at 15 px is twenty-four pixels in total and the rim
       *  covered a third of them in cream, so the average of what a viewer
       *  actually sees moved AWAY from the committed colour. A separating line
       *  that erases the thing it is separating has separated nothing.
       *
       *  So the exponent opens to 1.15 rather than 0.85 — 16% of the radius
       *  instead of 23%, which is still ~1.5 px on a 15 px rider — and the wrap
       *  colour crossfades from the palette's rim toward the identity hue as k
       *  rises. A far rider's light wrap being tinted by his own jersey is what
       *  a painter would do anyway.
       */
      vec3 applyIdentityFloors(vec3 col, vec3 N, vec3 V) {
        float k = 1.0 - smoothstep(uIdentityPx.y, uIdentityPx.x, vScreenPx);
        if (k <= 0.001) return col;

        float lq = floor(saturate1(luma(col) * 2.1) * 2.999) / 2.0;   // 0, 0.5, 1
        vec3 idc = uIdentityColor * mix(0.50, 1.35, lq);
        col = mix(col, idc, k * uIdentityChroma);

        float rim = celRim(N, V, mix(uRimPower, 1.15, k));
        vec3 rimC = mix(uRimColor, uRimColor * 0.30 + uIdentityColor * 1.30, k * uIdentityChroma);
        col += rimC * rim * k * uIdentityRim;
        return col;
      }
    #endif

    ${opts.fragmentPreamble ?? ''}

    void main() {
      vec3 N = normalize(vNormal);
      // Two-sided surfaces (canopy cards, grass blades) must flip their normal
      // or the back face shades as though it were in permanent shadow.
      if (!gl_FrontFacing) N = -N;

      vec3 V = normalize(uCameraPos - vWorldPos);

      vec3 tint = vAlbedoTint;
      float alpha = uOpacity;

      #ifdef NPR_MAP
        vec4 texel = texture(uMap, vUv);
        tint *= texel.rgb;
        alpha *= texel.a;
      #endif

      #ifdef NPR_ALPHATEST
        if (alpha < ${(opts.alphaTest ?? 0.5).toFixed(3)}) discard;
      #endif

      CelInput s;
      s.worldPos   = vWorldPos;
      s.normal     = N;
      s.viewDir    = V;
      s.fragCoord  = gl_FragCoord.xy;
      s.viewDist   = vViewDist;
      s.albedoTint = tint;
      s.aoTerm     = vAo;

      vec3 celCol = celShade(s);

      #ifdef NPR_QUANTIZE
        // Value only. The channel ratios — hue and saturation — are carried
        // through untouched, so a posterised helmet is the same colour it was,
        // just drawn in flat tiers instead of a gradient. Quantising in a
        // sqrt curve rather than linearly puts the tiers where the eye can see
        // them: eight even LINEAR steps spend six of them above middle grey.
        {
          float peak = max(max(celCol.r, celCol.g), celCol.b);
          if (peak > 1e-4) {
            float q = floor(sqrt(peak) * uValueSteps + 0.5) / uValueSteps;
            celCol *= (q * q) / peak;

          }
        }
      #endif

      // ── The drawn contour on the highlight ────────────────────────────────
      // See CelOptions.specInk. Recomputed here rather than returned from
      // celShade because celShade is shared by every surface in the game and
      // most of them must not pay for this.
      #ifdef NPR_SPEC_INK
        {
          vec3 specH = normalize(uSunDir + V);
          float specTerm = pow(saturate1(dot(N, specH)), uSpecPower);
          // The same 0.20 threshold bandedSpecular uses for its outer tier, so
          // the line lands exactly on the edge of the shape it is drawing.
          float specW = max(fwidth(specTerm) * 0.75, 0.006);
          float specEdge = 1.0 - smoothstep(specW * 0.8, specW * 2.6, abs(specTerm - 0.20));
          // Only on the lit side. A contour around a highlight that is not
          // there is just a scribble.
          float specLit = saturate1(dot(N, uSunDir) * 3.0);
          celCol = mix(celCol, uBandColor[0] * 0.55, specEdge * uSpecInk * specLit);
        }
      #endif

      ${opts.fragmentBody ?? ''}

      #ifdef NPR_FOG
        celCol = applyQuantizedFog(celCol, vViewDist, -V, gl_FragCoord.xy);
      #endif

      // AFTER the fog, not before. The haze is exactly one of the three things
      // that was deleting the identity, so a floor applied upstream of it is
      // a floor the fog then walks straight back through.
      #ifdef NPR_IDENTITY
        celCol = applyIdentityFloors(celCol, N, V);
      #endif

      fragColor = vec4(celCol, alpha);
    }
  `;
}

// ─────────────────────────────────────────────────────────────────────────────
// G-buffer prepass material
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Writes the two RGBA16F attachments the Sobel pass reads:
 *   0: rgb = view-space normal   a = linear view depth (metres)
 *   1: r  = material id          g = curvature   b = stylisation mask
 *
 * Built from the same options as its parent so instancing, skinning, wind and
 * alpha-test all behave identically — a mismatch here shows up as interior
 * lines that swim off the geometry when a rider animates.
 */
export function createPrepassMaterial(preset: RampPreset, opts: CelOptions): ShaderMaterial {
  const defines = buildDefines(opts);
  const mat = new ShaderMaterial({
    glslVersion: GLSL3,
    defines,
    uniforms: {
      ...globalUniformBlock(),
      uMaterialId: { value: materialIdFor(opts.idName ?? preset.name) },
      uStyleMask: { value: opts.skinned ? 1.0 : 0.0 },
      uMap: { value: opts.map ?? null },
      uWindStrength: { value: opts.wind ? 1 : 0 },
    },
    side: opts.side ?? FrontSide,
    vertexShader: /* glsl */ `
      precision highp float;
      ${GLSL_COMMON}
      ${GLSL_GLOBAL_UNIFORMS}
      ${GLSL_VERTEX_TRANSFORM}

      uniform float uWindStrength;
      #ifdef NPR_WIND
        in float aSway;
      #endif
      // The prepass reads curvature so interior lines can taper with the hull.
      in float aCurvature;

      out vec3  vViewNormal;
      out float vViewDepth;
      out vec2  vUv;
      out float vCurv;

      void main() {
        vec3 localPos = position;
        vec3 localNrm = normal;
        resolveLocal(localPos, localNrm);

        #ifdef NPR_WIND
          float phase = 0.0;
          #ifdef USE_INSTANCING
            phase = aInstancePhase;
          #endif
          float t = uTime * 1.35 + phase;
          float slow = sin(t * 0.55) * 0.6 + sin(t * 0.31 + 1.7) * 0.4;
          float fast = sin(t * 3.1 + localPos.y * 2.3) * 0.35;
          float amt = aSway * aSway * uWindStrength;
          localPos.x += (slow * 0.34 + fast * 0.10) * amt;
          localPos.z += (slow * 0.20 - fast * 0.13) * amt;
        #endif

        vec3 wpos, wnrm;
        toWorld(localPos, localNrm, wpos, wnrm);

        vec4 vpos = viewMatrix * vec4(wpos, 1.0);
        vViewNormal = normalize((viewMatrix * vec4(wnrm, 0.0)).xyz);
        vViewDepth  = -vpos.z;
        vUv = uv;
        vCurv = aCurvature;

        gl_Position = projectionMatrix * vpos;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      ${GLSL_COMMON}
      ${GLSL_PREPASS_OUTPUTS}

      uniform float uMaterialId;
      uniform float uStyleMask;
      uniform sampler2D uMap;

      in vec3  vViewNormal;
      in float vViewDepth;
      in vec2  vUv;
      in float vCurv;

      void main() {
        #ifdef NPR_ALPHATEST
          if (texture(uMap, vUv).a < ${(opts.alphaTest ?? 0.5).toFixed(3)}) discard;
        #endif
        vec3 n = normalize(vViewNormal);
        if (!gl_FrontFacing) n = -n;
        fragColor = vec4(n, vViewDepth);
        gAux = vec4(uMaterialId, vCurv, uStyleMask, 1.0);
      }
    `,
  });
  mat.name = `prepass:${preset.name}`;
  return mat;
}

/** Depth-only material for the sun cascades. */
export function createShadowMaterial(preset: RampPreset, opts: CelOptions): ShaderMaterial {
  const defines = buildDefines(opts);
  const mat = new ShaderMaterial({
    glslVersion: GLSL3,
    defines,
    uniforms: {
      ...globalUniformBlock(),
      uMap: { value: opts.map ?? null },
      uWindStrength: { value: opts.wind ? 1 : 0 },
    },
    // Front-face culling in the shadow pass removes almost all acne without
    // needing a large bias, which keeps contact shadows tight under the tyres.
    side: BackSide,
    vertexShader: /* glsl */ `
      precision highp float;
      ${GLSL_COMMON}
      ${GLSL_GLOBAL_UNIFORMS}
      ${GLSL_VERTEX_TRANSFORM}
      uniform float uWindStrength;
      #ifdef NPR_WIND
        in float aSway;
      #endif
      out vec2 vUv;
      out float vDepth;
      void main() {
        vec3 localPos = position;
        vec3 localNrm = normal;
        resolveLocal(localPos, localNrm);
        #ifdef NPR_WIND
          float phase = 0.0;
          #ifdef USE_INSTANCING
            phase = aInstancePhase;
          #endif
          float t = uTime * 1.35 + phase;
          float slow = sin(t * 0.55) * 0.6 + sin(t * 0.31 + 1.7) * 0.4;
          float amt = aSway * aSway * uWindStrength;
          localPos.x += slow * 0.34 * amt;
          localPos.z += slow * 0.20 * amt;
        #endif
        vec3 wpos, wnrm;
        toWorld(localPos, localNrm, wpos, wnrm);
        vUv = uv;
        vec4 clip = projectionMatrix * viewMatrix * vec4(wpos, 1.0);
        vDepth = clip.z / clip.w * 0.5 + 0.5;
        gl_Position = clip;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      ${GLSL_FRAG_OUT}
      uniform sampler2D uMap;
      in vec2 vUv;
      in float vDepth;
      void main() {
        #ifdef NPR_ALPHATEST
          if (texture(uMap, vUv).a < ${(opts.alphaTest ?? 0.5).toFixed(3)}) discard;
        #endif
        fragColor = vec4(vDepth, vDepth, vDepth, 1.0);
      }
    `,
  });
  mat.name = `shadow:${preset.name}`;
  return mat;
}

// ─────────────────────────────────────────────────────────────────────────────
// Inverted-hull outline material
// ─────────────────────────────────────────────────────────────────────────────
export interface HullOptions extends CelOptions {
  widthMultiplier?: number;
  jitter?: number;
  color?: Color;
}

export function createHullMaterial(preset: RampPreset, opts: HullOptions = {}): ShaderMaterial {
  const defines = buildDefines(opts);
  const width = opts.outlineWidth ?? preset.outlineWidth;

  const mat = new ShaderMaterial({
    glslVersion: GLSL3,
    defines,
    uniforms: {
      ...globalUniformBlock(),
      uOutlineWidth: { value: width * 100 * (opts.widthMultiplier ?? 1) },
      uTargetPixels: { value: LINES.targetPixels },
      uFalloffStart: { value: LINES.distanceFalloffStart },
      uFalloffEnd: { value: LINES.distanceFalloffEnd },
      uMinWidthScale: { value: LINES.minWidthScale },
      uCurvatureWeight: { value: LINES.curvatureWeight },
      uCurvatureFloor: { value: LINES.curvatureFloor },
      uWidthJitter: { value: opts.jitter ?? 0.07 },
      uInkColor: { value: (opts.color ?? preset.outlineColor ?? INK).clone() },
      uMap: { value: opts.map ?? null },
      uWindStrength: { value: opts.wind ? 1 : 0 },
      ...identityUniforms(opts),
    },
    // BackSide + front-face culling: only the expanded backfaces survive, and
    // they poke out around the silhouette as a stroke.
    side: BackSide,
    transparent: false,
    depthWrite: true,
    vertexShader: /* glsl */ `
      precision highp float;
      ${GLSL_COMMON}
      ${GLSL_GLOBAL_UNIFORMS}
      ${GLSL_VERTEX_TRANSFORM}
      ${GLSL_HULL_VERTEX}

      uniform float uWindStrength;
      #ifdef NPR_WIND
        in float aSway;
      #endif

      #ifdef NPR_IDENTITY
        ${GLSL_IDENTITY_UNIFORMS}
        ${GLSL_IDENTITY_SIZE}
      #endif

      out vec2  vUvH;
      out float vDistH;

      void main() {
        vec3 localPos = position;
        vec3 localNrm = normal;
        vec3 smoothNrm = aSmoothNormal;

        #ifdef USE_SKINNING
          // Skin the smoothed normal with the same matrix as the position, or
          // the hull peels off the mesh the moment a joint rotates.
          mat4 boneMatX = getBoneMatrix(skinIndex.x);
          mat4 boneMatY = getBoneMatrix(skinIndex.y);
          mat4 boneMatZ = getBoneMatrix(skinIndex.z);
          mat4 boneMatW = getBoneMatrix(skinIndex.w);
          mat4 skinMatrix = skinWeight.x * boneMatX + skinWeight.y * boneMatY
                          + skinWeight.z * boneMatZ + skinWeight.w * boneMatW;
          skinMatrix = bindMatrixInverse * skinMatrix * bindMatrix;
          localPos  = (skinMatrix * vec4(localPos, 1.0)).xyz;
          localNrm  = normalize((skinMatrix * vec4(localNrm, 0.0)).xyz);
          smoothNrm = normalize((skinMatrix * vec4(smoothNrm, 0.0)).xyz);
        #endif

        #ifdef NPR_WIND
          float phase = 0.0;
          #ifdef USE_INSTANCING
            phase = aInstancePhase;
          #endif
          float t = uTime * 1.35 + phase;
          float slow = sin(t * 0.55) * 0.6 + sin(t * 0.31 + 1.7) * 0.4;
          float fast = sin(t * 3.1 + localPos.y * 2.3) * 0.35;
          float amt = aSway * aSway * uWindStrength;
          localPos.x += (slow * 0.34 + fast * 0.10) * amt;
          localPos.z += (slow * 0.20 - fast * 0.13) * amt;
        #endif

        vec3 wpos, wnrm;
        toWorld(localPos, localNrm, wpos, wnrm);

        // Transform the smoothed normal to world by the same route.
        vec3 wsmooth;
        #ifdef USE_INSTANCING
          wsmooth = normalize(mat3(modelMatrix * instanceMatrix) * smoothNrm);
        #else
          wsmooth = normalize(mat3(modelMatrix) * smoothNrm);
        #endif

        float viewDist = length(wpos - uCameraPos);

        // ── Ink taper by SUBJECT SIZE, not by distance ────────────────────────
        // The hull holds LINES.targetPixels (2.15) at every range, and its only
        // taper runs on view distance over 42-340 m. That is correct for
        // terrain and wrong for a character: a rider 20 px tall gets the same
        // 2.15 px stroke as one 300 px tall, so the ink is drawing a third of
        // the figure on every axis and there is no interior left to carry a
        // jersey colour. Measured at the ridge-exposure pose, an opponent
        // 22-34 px tall held its committed hue on 3-6% of its own footprint.
        //
        // The stroke has to shrink WITH the character. It never disappears —
        // a 15 px rider must still be inked, or the silhouette goes — it just
        // stops being most of him.
        float inkScale = 1.0;
        #ifdef NPR_IDENTITY
          inkScale = mix(
            uIdentityInkFloor, 1.0,
            smoothstep(uIdentityPx.y, uIdentityPx.x, identityPixels(viewDist))
          );
        #endif
        wpos += hullOffset(wpos, wsmooth, aCurvature, viewDist) * inkScale;

        vUvH = uv;
        vDistH = viewDist;
        gl_Position = projectionMatrix * viewMatrix * vec4(wpos, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      ${GLSL_COMMON}
      ${GLSL_GLOBAL_UNIFORMS}
      ${GLSL_FRAG_OUT}
      uniform vec3 uInkColor;
      uniform sampler2D uMap;
      in vec2  vUvH;
      in float vDistH;
      void main() {
        #ifdef NPR_ALPHATEST
          if (texture(uMap, vUvH).a < ${(opts.alphaTest ?? 0.5).toFixed(3)}) discard;
        #endif
        // The stroke picks up a little of the atmosphere at distance so a far
        // tree line doesn't read as a black scribble against pale haze.
        vec3 ink = uInkColor;
        float t = saturate1((vDistH - uFogNear) / max(uFogFar - uFogNear, EPS));
        t = pow(t, 0.78);
        float f = saturate1(t) * 3.999;
        int i = clamp(int(floor(f)), 0, 3);
        ink = mix(ink, uFogColors[i] * 0.55, uFogStrengths[i] * saturate1(t * 1.3));
        fragColor = vec4(ink, 1.0);
      }
    `,
  });
  mat.name = `hull:${preset.name}`;
  return mat;
}

// ─────────────────────────────────────────────────────────────────────────────
// Assembly helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Attach an inverted-hull outline to a mesh.
 *
 * The hull is a sibling mesh sharing the SAME geometry buffer (no duplication
 * in memory) and, for skinned meshes, the SAME skeleton — so it deforms in
 * lockstep. Rendered before the main pass so the depth buffer resolves the
 * stroke behind the surface.
 */
export function attachOutline(
  mesh: Mesh,
  preset: RampPreset,
  opts: HullOptions = {},
): Mesh | null {
  const width = opts.outlineWidth ?? preset.outlineWidth;
  if (width <= 0) return null;

  const geo = mesh.geometry as BufferGeometry;
  if (!geo.getAttribute('aSmoothNormal')) {
    console.warn(`[npr] ${mesh.name || preset.name} has no aSmoothNormal — outline skipped.`);
    return null;
  }

  const hullOpts: HullOptions = {
    ...opts,
    instanced: opts.instanced ?? (mesh as InstancedMesh).isInstancedMesh === true,
    skinned: opts.skinned ?? (mesh as SkinnedMesh).isSkinnedMesh === true,
  };
  const mat = createHullMaterial(preset, hullOpts);

  let hull: Mesh;
  if ((mesh as InstancedMesh).isInstancedMesh) {
    const src = mesh as InstancedMesh;
    const im = new InstancedMesh(geo, mat, src.count);
    im.instanceMatrix = src.instanceMatrix;
    im.count = src.count;
    hull = im;
  } else if ((mesh as SkinnedMesh).isSkinnedMesh) {
    const src = mesh as SkinnedMesh;
    const sm = new SkinnedMesh(geo, mat);
    sm.bind(src.skeleton, src.bindMatrix);
    hull = sm;
  } else {
    hull = new Mesh(geo, mat);
  }

  hull.name = `${mesh.name || preset.name}:hull`;
  hull.renderOrder = (mesh.renderOrder ?? 0) - 1;
  hull.frustumCulled = mesh.frustumCulled;
  hull.castShadow = false;
  hull.receiveShadow = false;
  hull.userData.isHull = true;
  hull.userData.hullOf = mesh;
  mesh.userData.hull = hull;
  return hull;
}

/**
 * Build a mesh's companion pass materials and stash them where the render
 * passes look for them. Call once per mesh after construction.
 */
export function registerNprMesh(mesh: Mesh, material: CelMaterial): void {
  const opts = material.celOptions;
  const isInstanced = (mesh as InstancedMesh).isInstancedMesh === true;
  const isSkinned = (mesh as SkinnedMesh).isSkinnedMesh === true;
  const passOpts: CelOptions = { ...opts, instanced: isInstanced, skinned: isSkinned };

  if (!opts.noPrepass) {
    material.prepassMaterial ??= createPrepassMaterial(material.preset, passOpts);
    mesh.userData.prepassMaterial = material.prepassMaterial;
  }
  if (!opts.noShadow) {
    material.shadowMaterial ??= createShadowMaterial(material.preset, passOpts);
    mesh.userData.shadowMaterial = material.shadowMaterial;
  }
}

/** Convenience: build material + register + attach outline in one call. */
export function makeCelMesh(
  geometry: BufferGeometry,
  presetName: keyof typeof RAMPS,
  opts: CelOptions = {},
): { mesh: Mesh; material: CelMaterial; hull: Mesh | null; group: Object3D } {
  const preset = RAMPS[presetName];
  const material = new CelMaterial(preset, opts);
  const mesh = new Mesh(geometry, material);
  mesh.name = opts.name ?? presetName;
  registerNprMesh(mesh, material);
  const hull = attachOutline(mesh, preset, opts);
  const group = new Object3D();
  group.name = `${mesh.name}:group`;
  if (hull) group.add(hull);
  group.add(mesh);
  return { mesh, material, hull, group };
}

/** Dispose everything a cel mesh owns. */
export function disposeCelMaterial(m: CelMaterial): void {
  m.prepassMaterial?.dispose();
  m.shadowMaterial?.dispose();
  m.hullMaterial?.dispose();
  m.dispose();
}
