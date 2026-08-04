/**
 * LinesPass — the second line system.
 *
 * The inverted hull draws SILHOUETTES. It structurally cannot draw anything
 * else: it is the mesh's own backfaces poking out past its own front faces, so
 * by construction it only ever appears at the boundary between an object and
 * whatever is behind it. Everything an animator draws INSIDE a silhouette — the
 * crease where a forearm crosses a torso, the step from tyre to rim, the facet
 * boundaries on a boulder, the seam of a jersey panel — has to come from
 * somewhere else. This pass is that somewhere else.
 *
 * It is a screen-space edge detector over the G-buffer with four independent
 * detectors, each with its own threshold and knee:
 *
 *   NORMAL      a 3x3 Sobel over the view-space normal. Catches creases.
 *   DEPTH       the second difference of 1/depth. Catches steps and overlaps.
 *   MATERIAL ID a 4-neighbour compare. Catches the edges the other two miss
 *               entirely: two surfaces at the same depth and the same angle
 *               that are simply different things.
 *   CONTOUR     geometry against background. The ridge line against the sky.
 *
 * ── Why the depth detector is a second difference of 1/depth ────────────────
 *
 * The obvious depth detector — a Sobel over depth, thresholded — fails in a
 * specific and very visible way on this game: the ground is a mountain seen at
 * a raking angle, so the depth gradient across a single pixel near the horizon
 * is enormous even though the surface is perfectly flat. Threshold it low
 * enough to catch a 4cm step on a rock at 10m and the entire distance turns
 * into a solid black wall of edges. Threshold it high enough to keep the
 * distance clean and nothing up close draws at all.
 *
 * Under a perspective projection 1/depth is LINEAR in screen space across any
 * planar surface. Its second difference is therefore exactly zero on a plane at
 * any orientation, any distance, and non-zero only where the surface actually
 * breaks. Multiplying the result by the centre depth converts it into a
 * relative measure — "this step is 0.4% of the viewing distance" — which is
 * scale-free, so one threshold works at 3m and at 300m. That is the whole
 * requirement "the depth threshold MUST scale with view depth", solved
 * structurally instead of with a fudge factor.
 *
 * ── How the hull is suppressed ─────────────────────────────────────────────
 *
 * Two ink systems that stack produce a muddy, double-thick silhouette, and
 * nothing reads as amateur faster. The hull material cannot be changed, so this
 * has to be detected from the frame.
 *
 * Colour matching is out: hull ink is 0x1d1626, and the darkest band of the
 * tyre ramp is 0x1c1826 — they are the same value to within a rounding error.
 * Suppressing on "this pixel is nearly ink" would erase exactly the tyre/rim
 * interior line the pass exists to draw.
 *
 * What IS unambiguous is a structural fact about the pipeline: hulls write to
 * the main pass depth buffer and are excluded from the G-buffer. So at any
 * pixel the hull inked, the main depth buffer holds the hull's surface and the
 * G-buffer holds whatever is BEHIND it — background, or nothing at all. Every
 * other pixel in the frame has main depth and G-buffer depth agreeing to within
 * float precision, because they are the same triangles rendered twice.
 *
 *     hullInk(p)  ==  mainDepth(p) exists  AND  gbufferDepth(p) is much further
 *
 * That test is exact, costs one depth fetch, needs no tuning, and — critically —
 * returns FALSE for a terrain ridge against the sky, where there is no hull and
 * the Sobel contour is the only ink there will ever be. A cruder "suppress
 * wherever the depth step is large" heuristic would have deleted every ridge
 * line on the mountain.
 *
 * The test is then dilated across the 4-neighbourhood, because a 3x3 Sobel
 * reaches one pixel: the response that would double the hull's stroke sits one
 * pixel INSIDE the silhouette, on geometry the hull never covered.
 */

import { Color, GLSL3, IUniform, LinearFilter, PerspectiveCamera, RGBAFormat, UnsignedByteType, Vector2, WebGLRenderer, WebGLRenderTarget } from 'three';
import { GLSL_COMMON, GLSL_FRAG_OUT } from '../ShaderChunks';
import { NPR } from '../NprGlobals';
import { materialIdFor } from '../CelMaterial';
import { INK, LINES, RAMPS } from '../Palette';
import { FullscreenPass } from './Fullscreen';

/**
 * The tightest radius, in metres, a surface may curve through and still count
 * as SMOOTH. Belongs in Palette.LINES beside the other line constants; that
 * file is owned elsewhere this pass, so it lives here.
 */
const CREASE_RADIUS = LINES.creaseRadius;
/**
 * How many half-float ulps of depth the second-difference detector treats as
 * noise. One ulp is what a single sample can be off by; two adjacent samples
 * can differ by two, and the second difference weights the centre twice.
 * Measured floor on flat ground is 1.0 ulp for the max-form response, so 2.2
 * is a little over double the observed worst case.
 */
const DEPTH_QUANT_ULPS = LINES.depthQuantUlps;
/**
 * The furthest the contour's ink may be mixed toward the haze colour. The
 * interior lines still take the full fog strength (0.94 in the far band) and
 * still vanish; the silhouette stops here so a ridge at two kilometres is a
 * lighter stroke rather than no stroke.
 *
 * 0.12, not 0.30. The haze colour this mixes toward sits at 0.28 in linear
 * light against the ink's 0.009, so the mix is steep: at 0.30 the ink arrived
 * on the summit-wide skyline at sRGB luminance 85 — measured, not estimated —
 * against a sky of 161 and snow of 241. A stroke has to be darker than BOTH
 * sides of the edge it separates, and 85 against 241 is a grey smudge. At 0.12
 * the same ink lands near 55, which clears the sky by a hundred values and the
 * snow by nearly two hundred.
 *
 * The lightening-with-distance that the cap used to be responsible for has not
 * been given up; it has been moved to where it belongs. An animator draws the
 * far ridge with LESS PRESSURE of the same ink, not with a different, hazier
 * ink — and less pressure is exactly what contourFade already applies, down to
 * its 0.46 floor. Fading the alpha and holding the hue is the drawn behaviour;
 * fading the hue toward the background is the photographic one.
 */
const CONTOUR_FOG_CAP = LINES.contourFogCap;

/**
 * PAINT IDS — the material ids that describe a surface whose shading is
 * deliberately COARSER than its mesh.
 *
 * The terrain prepass writes its shading normal out of the normal MAP, at the
 * same blurred `formSample` level the main pass paints with, precisely so that
 * "the Sobel does not ink creases the shading does not have". Its DEPTH,
 * however, comes from the rasteriser, at the heightfield's full resolution.
 * The two channels therefore describe two different surfaces: a smooth painted
 * hillside, and a mesh with every gully lip and fold in it.
 *
 * Every stray stroke in this pass's defect list came out of that gap:
 *
 *  • `treeline-silhouette` — fifteen straight needles, several in parallel
 *    pairs, 200-600 px long, over ground the paint draws as one continuous
 *    slope. Probed at (606..609, 800): the depth channel steps 20.8 m → 17.2 m
 *    in ONE pixel while the normal turns 0.129 (7 degrees) and the colour does
 *    not change at all. Those are terrain SELF-OCCLUSION contours — the near
 *    lip of a fold hiding the ground behind it, which is why they come in
 *    pairs (the occluding edge and the re-emergence edge) and converge to a
 *    vanishing point. They are geometrically real and pictorially absent.
 *    (They are NOT LOD seams: the camera sat inside clipmap ring L0, whose
 *    nearest boundary was 48 m away, and these were at 10-21 m.)
 *
 *  • `ridge-exposure` — the closed quadrilaterals and pentagons on the flat
 *    trail are the id channel drawing the `terrain:dirt` / `terrain:trail`
 *    zone boundary, i.e. the corridor apron painted onto the terrain, one
 *    coarse zone-mip texel at a time.
 *
 *  • `valley-vista` — the 400-900 px aliased staircase is the same detector on
 *    the `terrain:rock` / `terrain:scree` boundary, stepping at the zone map's
 *    mip texel size, which `sampleZone` deliberately holds at about two screen
 *    pixels.
 *
 * The rule that follows is one rule, not three: ON A PAINTED SURFACE THE INK
 * FOLLOWS THE PAINT. A zone boundary is a colour step and never a stroke, and
 * a depth step is only inked to the extent that the paint's own normal turns
 * there too. Everything else in the frame — rock, rider, bike, ribbon,
 * furniture — shades from the same normals it is built from, so none of this
 * applies to it and none of it is gated.
 *
 * The list is built from the same convention `TerrainMaterial` uses when it
 * fills `uZoneIds` (`terrain:${ZONE_RAMPS[kind].name}`), through the same
 * memoised `materialIdFor`, so both sides land on the same integers whichever
 * module is evaluated first. It is NOT imported from `src/terrain` on purpose:
 * that would put the whole terrain module graph inside the post stack. If the
 * naming convention over there ever changes, `setPaintIds` is the seam — call
 * it with the authoritative array and this default goes away.
 */
const PAINT_RAMPS = [
  RAMPS.rock, RAMPS.dirt, RAMPS.grass, RAMPS.scree, RAMPS.snow, RAMPS.water, RAMPS.trail,
];

/**
 * Pack a set of material ids into the bitmask the shader tests against.
 *
 * Ids are handed out from 1 in registration order, and the terrain zones are
 * among the first things registered, so in practice this is 1..7 and the mask
 * is 254. The check is here anyway rather than as an assumption in a comment:
 * an id that will not fit is a silently disabled fix, which is the worst
 * failure this file can have.
 */
function paintMaskFor(ids: readonly number[]): number {
  let mask = 0;
  for (const id of ids) {
    if (!Number.isInteger(id) || id < 0 || id > 31) {
      console.warn(
        `[LinesPass] paint material id ${id} is outside the 0-31 the mask can hold; ` +
        'interior lines on that surface will follow its mesh rather than its paint.',
      );
      continue;
    }
    mask |= 1 << id;
  }
  return mask;
}

/**
 * PEN PRESSURE — the darkness of an interior stroke, from the SIZE of the fold
 * it is drawn on.
 *
 * The pass shipped with a pen-pressure model that could not press. Every
 * detector ends in a `smoothstep`, so on any edge that genuinely clears its
 * threshold the response is exactly 1.0 — and the model applied its weight as
 * `pow(interior, 1.0 / weight)`, which at interior == 1.0 is the identity for
 * every weight there is. The only surviving term was a `mix(0.82, 1.0, weight)`
 * spanning 18%, so a scatter rock's alpha was measured at 0.85, 0.89, 0.90,
 * 0.91 across four facet edges whose dihedral angles ran from 27 to 55 degrees.
 * That is what makes a boulder read as a wireframe: not that the edges are
 * wrong — every one of them is a real fold — but that a 27-degree bevel and a
 * 55-degree corner are inked at the same pressure as each other and nearly the
 * same pressure as the silhouette. `LINES.curvatureWeight` and `curvatureFloor`
 * were not "thinning nothing" because the weld was missing; the weld runs, and
 * `aCurvature` on that rock measured 0.43-0.79. They were thinning nothing
 * because the term they feed is raised to a power of a quantity pinned at one.
 *
 * So the width model keeps `pow` — it shapes the antialiased shoulder, which is
 * genuinely where width lives — and the DARKNESS is taken over by a second,
 * much higher knee on the same evidence the detector used. At the detection
 * threshold the pen is at `x`; by the time the fold is a hard corner it is at
 * `y`. The old constant 0.86 * 1.0 sits at the top of that range, so nothing
 * that used to be a full-strength line loses anything.
 *
 * Both belong in `LINES` in Palette.ts beside `curvatureWeight`; that file is
 * owned elsewhere this pass, so they live here and are reported.
 */
const PRESSURE_RANGE = new Vector2(LINES.pressureRange[0], LINES.pressureRange[1]);
/**
 * Where the pressure ramp starts and ends, as multiples of the crease
 * threshold. 0.95 puts the lightest pen just under the detector's own knee;
 * 2.66 puts the heaviest at a normal step of 0.85, which is a corner of about
 * 50 degrees. Measured on `summit-rider`'s foreground boulder: facet steps of
 * 0.46 / 0.69 / 0.75 / 0.93 now ink at 0.49 / 0.68 / 0.72 / 0.90 instead of
 * 0.85 / 0.90 / 0.88 / 0.89.
 */
const PRESSURE_FOLD = new Vector2(LINES.pressureFold[0], LINES.pressureFold[1]);
/**
 * How much the paint has to turn before a depth step on a PAINTED surface is
 * allowed to be inked, again as multiples of the crease threshold. Below the
 * low end the stroke is fully suppressed; above the high end it is untouched.
 * 0.34-1.00 is 0.109-0.32 of normal step in the near field, i.e. from about 6
 * to about 19 degrees across one pixel. The treeline needles sit at 0.129 and
 * are attenuated to 8% of their old alpha; a berm lip the paint actually shows
 * measures 0.6-0.9 and is untouched.
 */
const CORROBORATION = new Vector2(LINES.corroboration[0], LINES.corroboration[1]);

export const LINE_DEBUG = {
  off: 0,
  field: 1,
  normal: 2,
  depth: 3,
  id: 4,
  hull: 5,
  curvature: 6,
  /** Diagnostic packing: r contour, g hull, b coverage, a final alpha. */
  probeContour: 7,
  /** Diagnostic packing: r nMagX, g nMagY, b spanX/4m, a spanY/4m. */
  probeNormal: 8,
  /** Diagnostic packing: r dRel*200, g the raw max-axis response*200, b eDepth. */
  probeDepth: 9,
  /** Diagnostic packing: r pen pressure, g paint pair, b corroboration, a alpha. */
  probePaint: 10,
} as const;

const FRAGMENT = /* glsl */ `
  precision highp float;
  ${GLSL_COMMON}
  ${GLSL_FRAG_OUT}

  uniform sampler2D uGNormalDepth;   // rgb view normal, a linear view depth (m)
  uniform sampler2D uGAux;           // r id, g curvature, b style mask, a coverage
  uniform sampler2D uSceneDepth;     // main-pass depth, non-linear window space

  uniform vec2  uTexel;
  uniform vec2  uCamPlanes;          // near, far
  // World metres subtended by ONE device pixel at one metre of view depth:
  // 2*tan(fovY/2) / heightInPixels. Multiply by the fragment's view depth to
  // get the pixel's world footprint perpendicular to the view ray.
  uniform float uPixelScale;
  // Radius of the tightest surface that is still allowed to be "smooth".
  // Anything rounder than this cannot be a crease no matter how many degrees
  // of normal it turns across a pixel — see the scale-invariance note below.
  uniform float uCreaseRadius;
  /** Half-float ulps of depth noise the second difference is allowed to see. */
  uniform float uDepthQuant;
  uniform vec2  uNormalEdge;         // threshold, knee
  uniform vec2  uDepthEdge;          // threshold, knee
  uniform float uIdThreshold;
  uniform float uIdWeight;
  uniform float uStrength;
  uniform vec2  uFade;               // start, end (metres) — INTERIOR lines only
  uniform vec2  uContourFade;        // start, end (metres) — the contour's own
  uniform float uContourFloor;       // how much contour ink survives at uFade.y
  uniform float uHullSuppression;
  uniform vec2  uCurvature;          // weight, floor
  uniform float uContourStrength;
  /** Ceiling on how far the CONTOUR's ink may travel toward the haze colour. */
  uniform float uContourFogCap;
  uniform float uCharacterBoost;
  uniform vec3  uInkColor;
  uniform float uDebug;
  /**
   * Bit k set means material id k is a PAINTED surface. See PAINT_RAMPS.
   *
   * A bitmask rather than the obvious short array of ids, because this is
   * evaluated at FIVE taps per pixel over a full-resolution frame and the array
   * form has to be a loop. Interleaved A/B at 3200x1800, alternating the two
   * every frame so nothing can drift between them: the eight-iteration loop
   * cost 0.7 ms of a 10.3 ms frame. The mask is four instructions and measures
   * as nothing. Set membership is still exact and still arbitrary — the ids do
   * not have to be contiguous — the only new constraint is that they be under
   * 32, which the constructor checks rather than assumes.
   */
  uniform int uPaintMask;
  /** Lightest and heaviest pen, as multipliers on uStrength. */
  uniform vec2  uPressure;
  /** Pressure ramp bounds, in multiples of the lateral crease threshold. */
  uniform vec2  uPressureFold;
  /** Corroboration ramp bounds, same units. Painted surfaces only. */
  uniform vec2  uCorroborate;

  uniform vec3  uFogColors[4];
  uniform float uFogStrengths[4];
  uniform float uFogNear;
  uniform float uFogFar;

  in vec2 vUv;

  // 3x3 neighbourhood. Index 4 is the centre.
  const vec2 OFF[9] = vec2[9](
    vec2(-1.0, -1.0), vec2(0.0, -1.0), vec2(1.0, -1.0),
    vec2(-1.0,  0.0), vec2(0.0,  0.0), vec2(1.0,  0.0),
    vec2(-1.0,  1.0), vec2(0.0,  1.0), vec2(1.0,  1.0)
  );

  /**
   * Is this material id a PAINTED surface — one whose shading normal is a
   * deliberately blurred version of its own geometry?
   *
   * An exact compare against a short list, not a range: the ids are small
   * integers held exactly by a half float, but nothing guarantees the terrain
   * zones stay contiguous once another material registers between them.
   */
  float isPaintId(float id) {
    // The ids are small integers held exactly by a half float, so rounding is
    // the whole of the decode.
    int i = int(id + 0.5);
    if (i < 0 || i > 31) return 0.0;
    return float((uPaintMask >> i) & 1);
  }

  /** Window-space depth to view-space metres. */
  float viewDepth(float d) {
    float n = uCamPlanes.x;
    float f = uCamPlanes.y;
    float z = d * 2.0 - 1.0;
    return (2.0 * n * f) / (f + n - z * (f - n));
  }

  void main() {
    vec4 gC = texture(uGNormalDepth, vUv);
    float dC = gC.w;

    // Background: no geometry, therefore no interior line. The contour against
    // the sky is drawn on the GEOMETRY side of the boundary, one pixel in,
    // which is what makes the stroke hug the silhouette instead of haloing it.
    if (dC <= 0.0) {
      fragColor = vec4(0.0);
      return;
    }

    vec3 nC = gC.xyz;
    vec4 aC = texture(uGAux, vUv);

    vec3  nrm[9];
    float dep[9];
    float w[9];
    float contour = 0.0;

    for (int i = 0; i < 9; i++) {
      vec4 g = texture(uGNormalDepth, vUv + OFF[i] * uTexel);
      float d = g.w;
      float covered = step(0.0000001, d);
      contour = max(contour, 1.0 - covered);
      // Background taps are replaced by the CENTRE sample rather than by zero.
      // A zero normal against a real normal is a 90-degree crease and a zero
      // depth is an infinite step; leaving them in would make every detector
      // scream at the sky boundary, and the sky boundary is already handled by
      // its own term with its own strength.
      nrm[i] = mix(nC, g.xyz, covered);
      dep[i] = mix(dC, d, covered);
      w[i]   = 1.0 / max(dep[i], 0.02);
    }

    // ── The contour, widened ────────────────────────────────────────────────
    // A one-texel contour is a hairline at retina, and it disappears entirely
    // in the fifty-percent downsample every reviewer actually looks at. The
    // terrain carries NO inverted hull, so on a ridge against the sky this term
    // is the only ink that will ever exist — it has to hold a two-pixel core.
    // The second ring supplies that core; it is weighted below the inner ring
    // so the stroke tapers outward instead of ending in a hard wall of ink.
    float contourWide = 0.0;
    {
      const vec2 RING2[8] = vec2[8](
        vec2(-2.0,  0.0), vec2( 2.0,  0.0), vec2( 0.0, -2.0), vec2( 0.0,  2.0),
        vec2(-2.0, -2.0), vec2( 2.0, -2.0), vec2(-2.0,  2.0), vec2( 2.0,  2.0)
      );
      for (int i = 0; i < 8; i++) {
        float d = texture(uGNormalDepth, vUv + RING2[i] * uTexel).w;
        contourWide = max(contourWide, 1.0 - step(0.0000001, d));
      }
    }

    // ── Hull ink detection ───────────────────────────────────────────────────
    // Cross-shaped dilation. The inner cross catches the Sobel's one-pixel
    // reach; the outer cross at two texels exists because the contour above now
    // reaches two, and an undilated test would let the widened contour stack a
    // second stroke just outside the hull's own ink on every hulled silhouette.
    float farClip = uCamPlanes.y * 0.995;
    float hull = 0.0;
    {
      const vec2 HULL_TAPS[9] = vec2[9](
        vec2( 0.0,  0.0),
        vec2( 0.0, -1.0), vec2(-1.0,  0.0), vec2( 1.0,  0.0), vec2( 0.0,  1.0),
        vec2( 0.0, -2.0), vec2(-2.0,  0.0), vec2( 2.0,  0.0), vec2( 0.0,  2.0)
      );
      for (int k = 0; k < 9; k++) {
        vec2 uvT = vUv + HULL_TAPS[k] * uTexel;
        float dm = viewDepth(texture(uSceneDepth, uvT).r);
        if (dm >= farClip) continue;                 // nothing was drawn there
        float dg = texture(uGNormalDepth, uvT).w;
        // Either the G-buffer is empty (hull against the sky) or it holds
        // something well behind what the main pass drew (hull against terrain).
        float gap = (dg <= 0.0) ? 1.0e6 : (dg - dm);
        float need = max(0.04, dm * 0.010);
        hull = max(hull, step(need, gap));
      }
    }

    // ── Normal discontinuity ────────────────────────────────────────────────
    // Sobel weights sum to 4 on each axis, so dividing by 4 makes the response
    // equal to the magnitude of the normal step across an ideal edge — which is
    // what lets the threshold be expressed in normal units and stay meaningful.
    vec3 gx = (nrm[2] + 2.0 * nrm[5] + nrm[8]) - (nrm[0] + 2.0 * nrm[3] + nrm[6]);
    vec3 gy = (nrm[6] + 2.0 * nrm[7] + nrm[8]) - (nrm[0] + 2.0 * nrm[1] + nrm[2]);
    float mx = length(gx) * 0.25;   // normal step across the 2-px horizontal span
    float my = length(gy) * 0.25;   // ... and the vertical one

    // World distance the Sobel's 2-pixel span actually covers ON THE SURFACE.
    // The lateral part is the pixel footprint; the along-ray part is read
    // straight out of the depth channel, which is what makes this account for
    // slope as well as distance without needing to reconstruct a tangent frame.
    float pxW = dC * uPixelScale;
    float lat = 2.0 * pxW;
    float sx  = sqrt(lat * lat + (dep[5] - dep[3]) * (dep[5] - dep[3]));
    float sy  = sqrt(lat * lat + (dep[7] - dep[1]) * (dep[7] - dep[1]));

    // ── Scale invariance ────────────────────────────────────────────────────
    // The depth detector is scale-free by construction; this one was not. Its
    // threshold was a constant number of normal-units per PIXEL, and a pixel is
    // not a fixed amount of surface: at a raking angle one pixel spans metres
    // of ground, so it integrates metres of genuine, gentle undulation and
    // reports it as a crease. The same terrain seen from above reports nothing.
    // A detector whose answer depends on where you stand is not a detector.
    //
    // The fix is to ask a second question the constant threshold cannot: how
    // much normal would a SMOOTH surface have turned across this span? A span
    // of s metres on a surface of radius uCreaseRadius turns s/r of normal,
    // and that is the number the observed step has to beat.
    // Anything below that is roundness, not a crease, however many degrees per
    // pixel it accumulates. The two tests are ANDed via max(), so the constant
    // still governs the near field — without it a 7 cm limb or a 2 cm frame
    // tube would qualify as a crease along its entire length.
    float tx = max(uNormalEdge.x, sx / uCreaseRadius);
    float ty = max(uNormalEdge.x, sy / uCreaseRadius);
    float kx = uNormalEdge.y * (tx / uNormalEdge.x);
    float ky = uNormalEdge.y * (ty / uNormalEdge.x);
    float eNormal = max(smoothstep(tx, tx + kx, mx), smoothstep(ty, ty + ky, my));

    // ── The same threshold, asked of the PAINT instead of the surface ───────
    //
    // tx and ty fold the along-ray part of the span into the threshold, which
    // is exactly right for the crease test: a span that runs away from the
    // camera really does cover more surface, and more surface is allowed to
    // turn more normal. It is exactly wrong for the two questions below, which
    // are about the PICTURE rather than the mesh — because at a depth STEP the
    // along-ray term IS the step. Measured across the treeline needles, sx was
    // 3.58 m, which drives tx to 16.3; against a maximum possible normal step
    // of 2 the question "does the paint turn here" would be answered no for
    // every step in the frame, including the ones that are drawn.
    //
    // So this threshold uses the LATERAL footprint alone, which is the paint's
    // own resolution: how much a smooth surface could turn across the width of
    // one pixel, and nothing about how far that pixel reaches into the screen.
    float tLateral = max(uNormalEdge.x, lat / uCreaseRadius);
    float paintTurn = max(mx, my);

    // ── Depth discontinuity ─────────────────────────────────────────────────
    float wC = w[4];
    float lapH = abs(w[3] + w[5] - 2.0 * wC);
    float lapV = abs(w[1] + w[7] - 2.0 * wC);
    float lapD = abs(w[0] + w[8] - 2.0 * wC) * 0.5;
    float lapA = abs(w[2] + w[6] - 2.0 * wC) * 0.5;
    // MAX, not SUM.
    //
    // A real step is a step in ONE direction: the edge it belongs to has an
    // orientation, and the second difference across that orientation carries
    // the whole signal while the other three axes carry almost none. Summing
    // the four therefore adds one part signal to three parts nothing — and
    // three parts of the QUANTISATION NOISE described below. Taking the
    // strongest axis keeps the signal intact and divides the noise by three.
    // Measured on flat ground in ridge-exposure: sum 0.0027, max 0.0009.
    float lapMax = max(max(lapH, lapV), max(lapD, lapA));

    // ── The precision floor, subtracted rather than thresholded around ──────
    //
    // The G-buffer depth channel is a HALF FLOAT. Ten mantissa bits give it a
    // relative resolution of 2^-11..2^-10, so two adjacent samples on a
    // perfectly smooth surface can land in different buckets and disagree by
    // one ulp for no geometric reason at all. Run that through a second
    // difference and a flat hillside returns 0.0027 against a 0.0016 threshold
    // — which is why every wide shot carried nested iso-depth contour rings
    // over ground with nothing in it. They were not creases and they were not
    // dither: they were the depth channel's own mantissa, drawn.
    //
    // The floor is computed, not guessed. exp2(floor(log2(d)) - 10) is exactly
    // one ulp of a half float at this depth, so this subtracts the largest
    // response the surface could produce while still being smooth — the same
    // move as the 1/z second difference itself, one level further down.
    float dSafe = max(dC, 0.02);
    float ulpRel = exp2(floor(log2(dSafe)) - 10.0) / dSafe;
    float dRel = max(0.0, lapMax * dC - uDepthQuant * ulpRel);
    float eDepth = smoothstep(uDepthEdge.x, uDepthEdge.x + uDepthEdge.y, dRel);

    // ── Material id ─────────────────────────────────────────────────────────
    float eId = 0.0;
    // 1 only where this pixel AND all four of its cardinal neighbours sit on a
    // painted surface. Uncovered neighbours do not break the pair: the sky
    // boundary is the contour's business and it has its own term.
    float paintPair = isPaintId(aC.x);
    {
      int cardinal[4] = int[4](1, 3, 5, 7);
      for (int k = 0; k < 4; k++) {
        int i = cardinal[k];
        vec4 a = texture(uGAux, vUv + OFF[i] * uTexel);
        // Only compare ids across surfaces that are actually adjacent in depth.
        // An id change across a big depth gap is a silhouette, not a seam, and
        // the hull owns silhouettes.
        float adjacent = 1.0 - step(0.25, abs(dep[i] - dC) / dC);
        eId = max(eId, a.w * adjacent * step(uIdThreshold, abs(a.x - aC.x)));
        paintPair = min(paintPair, mix(1.0, isPaintId(a.x), a.w));
      }
    }

    // ── On a painted surface the ink follows the paint ──────────────────────
    //
    // Two suppressions, one rule. See the PAINT_RAMPS note above for what
    // "painted" means and for the measurements behind both numbers.
    //
    // The id detector goes to zero outright. Between two terrain zones there is
    // no object boundary to draw — there is a change of MATERIAL on one
    // continuous surface, and a change of material is a change of colour. The
    // zone map is also fetched at a mip level chosen to put one texel across
    // about two screen pixels, so what the detector was tracing was never even
    // the boundary's true shape: it was that boundary's staircase, at 4-8 px a
    // step, which is why valley-vista carried 900 px of aliased contour over
    // clean snow. Nothing else in the frame is affected: the ribbon lives at a
    // different id from the corridor painted under it, so the trail edge — the
    // one id line in that shot worth having — is untouched.
    //
    // The depth detector is not switched off, it is made answerable to the
    // picture. It keeps whatever share of itself the paint's own fold supports.
    eId *= 1.0 - paintPair;
    float corroborated =
      smoothstep(uCorroborate.x * tLateral, uCorroborate.y * tLateral, paintTurn);
    eDepth = mix(eDepth, eDepth * corroborated, paintPair);

    // ── Variable weight ─────────────────────────────────────────────────────
    // Same curvature response as the hull's vertex program, so an interior
    // stroke that runs into a silhouette stroke matches its weight where they
    // meet rather than stepping. This shapes the stroke's WIDTH — the power
    // below narrows or widens the antialiased shoulder — and nothing else.
    float curv = smoothstep(uCurvature.y, 1.0, aC.y);
    float weight = mix(1.0 - uCurvature.x * 0.55, 1.0 + uCurvature.x * 0.85, curv);
    weight = clamp(weight, 0.35, 1.95);

    // ── Pen pressure ────────────────────────────────────────────────────────
    //
    // How hard the pen is pressed, from HOW BIG the fold is rather than from
    // whether the detector fired on it. Every detector above ends in a
    // smoothstep and therefore saturates: past its knee a 27-degree bevel and
    // a 55-degree corner both report exactly 1.0, and every downstream shaping
    // term that consumed that number was consuming a constant. This is the
    // second knee, much higher up, on the same evidence.
    //
    // Each channel brings its own reading of the fold and only speaks where it
    // actually fired:
    //   NORMAL  how far the paint turns, against the lateral crease threshold
    //   DEPTH   how big the step is, as a multiple of the detection threshold
    //   ID      a fixed, firm pressure. A material change is not a fold at
    //           all, so it has no depth to read; it is a definite edge drawn
    //           at a definite weight, a little under a hard corner.
    float pressN = smoothstep(uPressureFold.x * tLateral, uPressureFold.y * tLateral, paintTurn);
    float pressD = smoothstep(1.0, 3.2, dRel / max(uDepthEdge.x, EPS));
    float press = max(max(pressN * eNormal, pressD * eDepth), 0.80 * eId * uIdWeight);
    float pressure = mix(uPressure.x, uPressure.y, press);

    // ── Two fades, not one ──────────────────────────────────────────────────
    // INTERIOR lines have to die with distance: past a few hundred metres a
    // crease detector over a mountain returns scribble, not draughtsmanship.
    //
    // The CONTOUR is the opposite case and used to share that fade, which is
    // why not one ridgeline in the game carried ink. Every ridge silhouette in
    // these frames sits beyond the interior fade end, the terrain carries no
    // inverted hull to fall back on, and so the largest drawn shape in the
    // picture terminated in a raw colour step. It gets its own, far longer
    // fade, and that fade lands on a FLOOR rather than on zero — a ridge at two
    // kilometres is still a drawn edge, just a lighter one.
    float fade = 1.0 - smoothstep(uFade.x, uFade.y, dC);
    float contourFade = mix(1.0, uContourFloor, smoothstep(uContourFade.x, uContourFade.y, dC));

    float interior = max(max(eNormal, eDepth), eId * uIdWeight) * fade;
    // 0.86, not 0.62. The inner band covers the pixels one texel from
    // background and the second ring covers those two texels in; at 0.62 the
    // second band survived pow() at roughly half the first's alpha, so the
    // stroke measured 1.4 px on a retina frame and read as a hairline. At 0.86
    // both bands land near full and the core is a genuine two pixels, which is
    // what the hull's own targetPixels asks for on everything that has a hull.
    float contourE = max(contour, contourWide * 0.86) * uContourStrength * contourFade;

    // ── Two inks, two opacity laws ──────────────────────────────────────────
    //
    // The INTERIOR field is a pen-pressure model: curvature drives the width
    // (via the power below 1) and the darkness (via uStrength and the weight
    // term), which is what makes a crease taper the way a drawn one does. But
    // every factor in that chain is a MULTIPLIER BELOW ONE and they compound —
    // uStrength 0.86, the weight term 0.95, and a power of 1/0.72 on a value
    // already under 1 — so a fully-detected edge lands at 0.79 alpha, not 1.
    //
    // On a crease that is right — except that the chain was not doing it. The
    // pen-pressure half now lives in the pressure term above, for the reason
    // given there; what stays here is the WIDTH half, which is what pow was
    // actually good for.
    //
    // On a SILHOUETTE none of it applies, and the difference
    // is measurable. Probed across the summit-wide skyline: the contour term
    // fired at 255 on every one of 29 columns and the hull mask read 0 on all
    // of them — the detector never dropped a single segment and nothing
    // suppressed it — yet the stroke still arrived at 0.79 alpha, which over a
    // snowfield reads as a 33-value dip. THAT is the intermittent hairline: not
    // a hole in the detection, but a silhouette drawn at three quarters
    // pressure and then, at the far end, mixed into the haze on top of that.
    //
    // The silhouette IS the drawing. It is laid down at the strength it was
    // detected with, and only distance — contourFade, floored at 0.46 — is
    // permitted to lighten it. The interior field keeps the pen-pressure model
    // untouched, and the two are combined by taking whichever is stronger.
    float interiorA = pow(saturate1(interior), 1.0 / weight) * uStrength * pressure;
    float alpha = max(interiorA, contourE);

    // How much of this pixel's ink is silhouette rather than interior. Drives
    // the fog treatment below, and nothing else.
    float contourShare = saturate1(contourE / max(alpha, EPS));

    // Characters carry heavier line work than backgrounds. The stylisation
    // mask is 1 on skinned geometry, which is exactly the rider.
    alpha *= mix(1.0, uCharacterBoost, saturate1(aC.z));
    alpha *= 1.0 - uHullSuppression * hull;

    // ── Ink colour ──────────────────────────────────────────────────────────
    // Identical fog treatment to the hull fragment shader, so a silhouette
    // stroke and an interior stroke on the same object are the same colour.
    vec3 ink = uInkColor;
    float t = saturate1((dC - uFogNear) / max(uFogFar - uFogNear, EPS));
    t = pow(t, 0.78);
    int fi = clamp(int(floor(saturate1(t) * 3.999)), 0, 3);
    float fogAmt = uFogStrengths[fi] * saturate1(t * 1.3);
    // ── The contour is not allowed to dissolve ──────────────────────────────
    //
    // An INTERIOR line should disappear into the haze — a crease at a kilometre
    // is not a thing an animator draws. A SILHOUETTE is the opposite: it is the
    // shape of the mountain, it is the largest drawn form in the frame, and it
    // is the only ink terrain will ever carry because terrain has no hull.
    //
    // Both used to share this one fog mix, and the far band's strength is 0.94,
    // so at ridge distances the ink was mixed 94% into the haze colour. Measured
    // in valley-vista at x=1400: the stroke was laid down at 80% alpha and
    // still came out at luminance 167 against a 169 sky — an invisible stroke,
    // fully drawn. THAT is the intermittent ridge line. It was never the
    // detector: the contour term fired at every column tested. It was the ink
    // arriving the same value as the thing it was supposed to separate.
    //
    // Capped, the contour keeps a fixed minimum contrast against whatever it
    // borders, and still lightens with distance up to that cap.
    fogAmt = mix(fogAmt, min(fogAmt, uContourFogCap), contourShare);
    ink = mix(ink, uFogColors[fi] * 0.55, fogAmt);

    if (uDebug > 0.5) {
      // Two PACKED diagnostic channels sit above the single-value views. They
      // exist so a probe can read four quantities out of one 8-bit readback
      // instead of re-rendering the frame once per quantity — which is the only
      // way to correlate "the contour fired" with "the hull mask ate it" at a
      // specific pixel.
      if (uDebug > 6.5 && uDebug < 7.5) {
        fragColor = vec4(contour, hull, 1.0, saturate1(alpha));
        return;
      }
      if (uDebug > 9.5) {
        fragColor = vec4(saturate1(press), paintPair, saturate1(corroborated),
                         saturate1(alpha));
        return;
      }
      if (uDebug > 8.5) {
        fragColor = vec4(saturate1(dRel * 200.0), saturate1(lapMax * dC * 200.0),
                         saturate1(eDepth), 1.0);
        return;
      }
      if (uDebug > 7.5) {
        fragColor = vec4(saturate1(mx), saturate1(my), saturate1(sx * 0.25), saturate1(sy * 0.25));
        return;
      }
      float v = 0.0;
      if (uDebug < 1.5)      v = alpha;
      else if (uDebug < 2.5) v = eNormal;
      else if (uDebug < 3.5) v = eDepth;
      else if (uDebug < 4.5) v = eId;
      else if (uDebug < 5.5) v = hull;
      else                   v = aC.y;
      // The value goes in ALPHA as well as RGB. CompositePass's ink debug view
      // displays vec3(ink.a) and nothing else, so writing 1.0 here made every
      // single-value view show a flat white silhouette of the geometry — which
      // is what made the previous investigation unable to tell a crease line
      // from an id line. Both channels carry the value; either reader works.
      fragColor = vec4(vec3(v), v);
      return;
    }

    fragColor = vec4(linearToSrgb(ink), saturate1(alpha));
  }
`;

export interface LinesPassOptions {
  /** 1 = full resolution. Below 1 softens the stroke; measure before dropping. */
  scale?: number;
}

export class LinesPass {
  readonly target: WebGLRenderTarget;
  private pass: FullscreenPass;
  private uniforms: Record<string, IUniform>;
  private scale: number;
  /** G-buffer height in device pixels — the Sobel's own sampling grid. */
  private pixelHeight: number;

  constructor(width: number, height: number, options: LinesPassOptions = {}) {
    this.scale = options.scale ?? 1;
    this.pixelHeight = height;

    const paintIds = PAINT_RAMPS.map((ramp) => materialIdFor(`terrain:${ramp.name}`));

    this.target = new WebGLRenderTarget(
      Math.max(1, Math.round(width * this.scale)),
      Math.max(1, Math.round(height * this.scale)),
      {
        format: RGBAFormat,
        type: UnsignedByteType,
        // Linear so a sub-resolution line field resolves smoothly; at scale 1
        // the sample is texel-centred and the filter never engages.
        minFilter: LinearFilter,
        magFilter: LinearFilter,
        depthBuffer: false,
        stencilBuffer: false,
        generateMipmaps: false,
      },
    );
    this.target.texture.name = 'inkField';

    this.uniforms = {
      uGNormalDepth: { value: null },
      uGAux: { value: null },
      uSceneDepth: { value: null },
      uTexel: { value: new Vector2(1 / width, 1 / height) },
      uCamPlanes: { value: new Vector2(0.12, 6000) },
      uPixelScale: { value: 2 * Math.tan((62 * Math.PI) / 360) / Math.max(height, 1) },
      uCreaseRadius: { value: CREASE_RADIUS },
      uDepthQuant: { value: DEPTH_QUANT_ULPS },
      uContourFogCap: { value: CONTOUR_FOG_CAP },
      uNormalEdge: { value: new Vector2(LINES.sobelNormalThreshold, LINES.sobelNormalKnee) },
      uDepthEdge: { value: new Vector2(LINES.sobelDepthThreshold, LINES.sobelDepthKnee) },
      uIdThreshold: { value: LINES.sobelIdThreshold },
      uIdWeight: { value: 0.9 },
      uStrength: { value: LINES.sobelStrength },
      uFade: { value: new Vector2(LINES.sobelFadeStart, LINES.sobelFadeEnd) },
      // The contour's own range. These belong in Palette.LINES next to
      // sobelFadeStart/End — they are art-direction constants, not plumbing —
      // but that file is owned elsewhere this pass, so they live here for now.
      uContourFade: { value: new Vector2(LINES.contourFadeStart, LINES.contourFadeEnd) },
      uContourFloor: { value: LINES.contourFloor },
      uHullSuppression: { value: LINES.hullSuppression },
      uCurvature: { value: new Vector2(LINES.curvatureWeight, LINES.curvatureFloor) },
      uContourStrength: { value: LINES.contourStrength },
      uCharacterBoost: { value: 1.22 },
      uInkColor: { value: new Color().copy(INK) },
      uDebug: { value: 0 },
      uPaintMask: { value: paintMaskFor(paintIds) },
      uPressure: { value: PRESSURE_RANGE.clone() },
      uPressureFold: { value: PRESSURE_FOLD.clone() },
      uCorroborate: { value: CORROBORATION.clone() },
      uFogColors: NPR.uFogColors,
      uFogStrengths: NPR.uFogStrengths,
      uFogNear: NPR.uFogNear,
      uFogFar: NPR.uFogFar,
    };

    this.pass = new FullscreenPass('npr:lines', FRAGMENT, this.uniforms);
  }

  setSize(width: number, height: number): void {
    this.target.setSize(
      Math.max(1, Math.round(width * this.scale)),
      Math.max(1, Math.round(height * this.scale)),
    );
    // The Sobel steps by G-BUFFER texels, not by its own. When the line field
    // is rendered at reduced scale we still want a one-pixel kernel on the
    // source, or the stroke would widen with the downscale.
    (this.uniforms.uTexel.value as Vector2).set(1 / width, 1 / height);
    this.pixelHeight = height;
  }

  setDebug(mode: number): void {
    this.uniforms.uDebug.value = mode;
  }

  /**
   * Override which material ids count as PAINTED — surfaces whose shading
   * normal is deliberately coarser than their own mesh, and on which the ink
   * therefore follows the paint rather than the geometry. See PAINT_RAMPS.
   *
   * The default is derived from the terrain zone naming convention. This is the
   * seam for anything that wants to state it authoritatively instead.
   */
  setPaintIds(ids: readonly number[]): void {
    this.uniforms.uPaintMask.value = paintMaskFor(ids);
  }

  get strength(): number {
    return this.uniforms.uStrength.value as number;
  }

  set strength(v: number) {
    this.uniforms.uStrength.value = v;
  }

  render(
    renderer: WebGLRenderer,
    camera: PerspectiveCamera,
    gNormalDepth: unknown,
    gAux: unknown,
    sceneDepth: unknown,
  ): void {
    this.uniforms.uGNormalDepth.value = gNormalDepth;
    this.uniforms.uGAux.value = gAux;
    this.uniforms.uSceneDepth.value = sceneDepth;
    (this.uniforms.uCamPlanes.value as Vector2).set(camera.near, camera.far);
    // The camera director springs the FOV on boosts and landings, so the
    // pixel-to-world scale has to be read every frame rather than cached at
    // resize: a 62->78 degree kick changes the footprint by a third, and a
    // detector calibrated in world units would drift with it.
    this.uniforms.uPixelScale.value =
      (2 * Math.tan((camera.fov * Math.PI) / 360)) / Math.max(this.pixelHeight, 1);
    this.pass.render(renderer, this.target);
  }

  dispose(): void {
    this.pass.dispose();
    this.target.dispose();
  }
}
