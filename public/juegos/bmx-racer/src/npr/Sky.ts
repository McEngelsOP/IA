/**
 * Sky — banded gradient dome, three layers of INKED cel cloud, a drawn sun
 * disc, and a quantised fan of sun shafts.
 *
 * The dome is a single inverted sphere locked to the camera. Every value in it
 * is banded: the vertical gradient steps between SEVEN plateaus rather than
 * blending, every cloud is an alpha-cut shape with a drawn contour and a
 * three-value interior, and the sun glow is a set of concentric hard rings
 * rather than a falloff. A smooth sky behind a banded mountain is the fastest
 * way to break the illusion — the eye reads the gradient as "3D render"
 * instantly.
 *
 * ── THE THREE DEFECTS OF THE LATEST ROUND, AND WHERE EACH IS ANSWERED ───────
 *
 * A. THE HORIZON SLAB. "A 285-475 px orange slab floating above the terrain
 *    horizon, a colour-correction stripe, not a dawn sky." Measured before
 *    touching anything: on scree-speed the warm zone was 385 native rows, 21%
 *    of the frame, holding exactly TWO colours. It is now SEVEN plateaus at
 *    50-110 rows each, the lowest of which is mixed toward FOG_BANDS' furthest
 *    haze colour so the sky and the far ridges share a palette where they meet.
 *    See the uUpperPale / uGlow / uFoot uniforms and skyGradient().
 *
 * B. CLOUD CONFETTI. "Fourteen sub-20 px fragments in one crop, each carrying a
 *    full ink contour." A level set of fBm always sprays small components
 *    around its large ones. cloudSupport() reads the LOCAL AREA of the mask out
 *    of the mip chain and walks the layer's threshold closed under about 25
 *    screen pixels. See cloudSupport().
 *
 * C. THE TWO DASHED HAIRLINES ON CLEAN BLUE SKY. Not the speed field, not the
 *    ink pass, not the shafts — all three cleared by A/B. A layer whose
 *    envelope had already switched it off, drawn anyway, because a signed
 *    distance to an EMPTY level set is not a large distance. See cutMask().
 *
 * ── THE THREE DEFECTS THIS FILE WAS REBUILT AROUND ──────────────────────────
 *
 * 1. A DEAD-STRAIGHT FULL-WIDTH BAND ACROSS THE HORIZON. Measured at
 *    treeline-silhouette as #faebdc held flat for ~190 rows, a 6-row ramp, and
 *    #e0a277 flat below it, level across all 3200 px, slicing cloud blobs
 *    along its top edge. Three separate causes, all of them in this file, none
 *    of them SKY.horizonSharpness (which is declared in Palette.ts and read by
 *    nothing at all):
 *
 *      a. The four gradient plateaus were positioned in raw dir.y with a
 *         perturbation of +/-0.004 in elevation — 0.23 degrees, about 6 native
 *         pixels. A boundary that moves 6 px over 3200 px IS a straight rule.
 *      b. The uHorizon plateau spans dir.y 0.004..0.118, which is 6.6 degrees
 *         of elevation — 190 native rows at this field of view — and NOTHING
 *         was ever drawn inside it. A 190-row region of one flat colour
 *         spanning the full frame width is a letterbox bar by construction, no
 *         matter what the maths behind it was.
 *      c. Both cloud layers were multiplied by smoothstep(0.028, 0.24, dir.y).
 *         That is a smooth fade evaluated on a level dome coordinate, applied
 *         to a HARD binary mask — so every cloud that reached the bottom of the
 *         layer was sliced off along a horizontal line, and the flat bar
 *         appeared to composite over the cloud.
 *
 *    The fixes, in the same order: the wander is now +/-2 degrees of
 *    low-frequency world-locked noise on every boundary (below); a third cloud
 *    layer — the horizon bank — is drawn INSIDE the plateau, so the region has
 *    contours in it rather than being empty; and no cloud alpha is ever faded
 *    by a function of dir.y again. Where a cloud layer has to leave the frame,
 *    its THRESHOLD walks to 1.03 so the shape shrinks and closes with its hard
 *    edge intact. Shapes that shrink cannot be sliced.
 *
 * 2. THE SUN SHAFTS WERE THE LARGEST SMOOTH GRADIENT IN THE GAME. See
 *    buildShafts().
 *
 * 3. CLOUDS WERE UNLINED INK BLOTS. Flat fill, no contour, no lit/shadow
 *    break. Every cloud is now drawn by celCloud(): a one-pixel ink contour
 *    measured in true screen pixels, a sunlit cap, a flat body, and a shaded
 *    underside — the three colours SKY.cloudLit / cloudMid / cloudShadow, in
 *    the shapes an animator would put them in.
 */

import {
  AdditiveBlending,
  BackSide,
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  GLSL3,
  LinearFilter,
  LinearMipmapLinearFilter,
  Matrix4,
  Mesh,
  Object3D,
  PerspectiveCamera,
  RepeatWrapping,
  ShaderMaterial,
  SphereGeometry,
  Vector2,
  Vector3,
} from 'three';
import { GLSL_COMMON, GLSL_FRAG_OUT } from './ShaderChunks';
import { NPR } from './NprGlobals';
import { FOG_BANDS, INK, SKY, SUN_DIRECTION } from './Palette';
import { celCloudMask } from './GeneratedTextures';

/** Scratch for the per-frame sun projection. Module scope so update() never allocates. */
const _sunWorld = new Vector3();

/** Cloud mask edge length. The shader's LOD estimate must agree with this. */
const CLOUD_TEX = 1024;

/** A palette mix, evaluated once at construction. Never allocates per frame. */
function mixed(a: Color, b: Color, t: number): Color {
  return a.clone().lerp(b, t);
}

export class Sky {
  readonly group = new Object3D();
  private domeMat: ShaderMaterial;
  private shaftMat: ShaderMaterial | null = null;
  private shafts: Mesh | null = null;

  constructor(radius = 4200) {
    this.group.name = 'sky';
    this.group.frustumCulled = false;

    const geo = new SphereGeometry(radius, 48, 32);

    // Trilinear plus anisotropic. The masks are minified hard toward the
    // horizon and with LinearFilter alone they had no mip chain at all, so the
    // pattern aliased against the pixel grid. The shader then re-thresholds the
    // filtered alpha so the contour goes back to being a hard cut.
    const cloudNear = celCloudMask(CLOUD_TEX, 'clouds-near', 0.33);
    const cloudFar = celCloudMask(CLOUD_TEX, 'clouds-far', 0.38);
    const cloudBank = celCloudMask(CLOUD_TEX, 'clouds-bank', 0.34);
    for (const t of [cloudNear, cloudFar, cloudBank]) {
      t.minFilter = LinearMipmapLinearFilter;
      t.magFilter = LinearFilter;
      t.generateMipmaps = true;
      t.anisotropy = 8;
      // ── PLAIN REPEAT, AND WHY THAT IS NOW THE RIGHT CHOICE ─────────────────
      // This was MirroredRepeatWrapping, chosen as insurance because
      // celCloudMask did not tile: TileableNoise.fbm01 wrapped every octave on
      // the GRID size while no octave's frequency divided it, so nothing closed
      // over [0,1] and the mask was guillotined at u = 1.
      //
      // TileableNoise has since been fixed to wrap each octave on its OWN
      // frequency, and the repair is measured, not assumed:
      // tools/capture/_masktile.mjs imports the real module through the dev
      // server and compares the wrap-edge difference to an ordinary interior
      // neighbour difference. It reports 1.4/255 across the seam against
      // 0.2-4.2/255 inside the tile — the seam is indistinguishable from
      // ordinary texture content, on a mask that is otherwise binary. It tiles.
      //
      // Mirrored repeat is now the WORSE option, because the projection below
      // deliberately reaches past the tile: a mirror fold is a plane of exact
      // reflective symmetry, and a symmetric sky is as obvious a rendering
      // artefact as a seam. Plain repeat gives an unbounded, symmetry-free
      // field, which is what lets the cloud scale go up by 2.5x — smaller,
      // denser, more drawn forms, which is what the sky needs.
      t.wrapS = RepeatWrapping;
      t.wrapT = RepeatWrapping;
      t.needsUpdate = true;
    }

    // The cloud ink. Rule 2 of Palette.ts: a shadow is a hue-rotated cousin of
    // its lit band, never a multiply toward black — so the contour is the
    // project ink warmed a third of the way toward the cloud's own shadow.
    const cloudInk = mixed(INK, SKY.cloudShadow, 0.20);

    this.domeMat = new ShaderMaterial({
      glslVersion: GLSL3,
      side: BackSide,
      depthWrite: false,
      // ── DEPTH-TESTED, AND DRAWN LAST AMONG THE OPAQUES ────────────────────
      // This was depthTest false at renderOrder -1000, i.e. a background fill:
      // the dome shaded every one of the 5.76 million pixels in a retina frame
      // and the terrain then painted over most of them. tools/capture/
      // _skycost.mjs renders the same frame with the sky group visible and
      // hidden and differences the wall time behind a readPixels flush; on
      // valley-vista, where the sky is about a sixth of the frame, the dome was
      // costing 12.3 ms of a 27.9 ms post.render. That is the most expensive
      // thing in the picture, spent almost entirely on pixels nobody sees.
      //
      // The vertex shader already emits p.xyww, so every dome fragment lands
      // exactly on the far plane at NDC z = 1. With the test on and the default
      // LESS_EQUAL, a cleared depth buffer (1.0) still admits it, and anything
      // with real geometry in front rejects it for free. depthWrite stays off,
      // so nothing downstream — the ink pass reads the depth texture — can tell
      // the difference.
      depthTest: true,
      fog: false,
      uniforms: {
        uTime: NPR.uTime,
        uSunDir: NPR.uSunDir,
        uResolution: NPR.uResolution,
        uZenith: { value: SKY.zenith.clone() },
        uUpper: { value: SKY.upper.clone() },
        uHorizon: { value: SKY.horizon.clone() },
        uBelow: { value: SKY.belowHorizon.clone() },
        // ── THE THREE BANDS THAT BREAK THE SLAB ───────────────────────────────
        //
        // The critic measured "a 285-475 px orange slab floating above the
        // terrain horizon, with a hard boundary against the cream above it — a
        // colour-correction stripe, not a dawn sky". Both halves of that are
        // structural rather than chromatic, and neither is fixed by moving a
        // colour.
        //
        // MEASURED, before touching anything. On scree-speed at x = 300 the warm
        // zone runs from native row 435 to row 820: 385 rows, 21% of the frame,
        // and it contains exactly TWO values — uHorizon down to row 660 and
        // uBelow from there to the skyline. Two plateaus of 200 rows each is a
        // stripe by construction; the eye has nothing to read in it, so it reads
        // the only thing there is, which is the join.
        //
        // So the warm zone is now FIVE bands rather than two, at 50-80 rows
        // apiece, which is the interval an animator paints a dawn sky at. Two of
        // them are new colours and one of them matters for a second reason:
        //
        //  - uUpperPale sits between the blue and the cream. The complaint about
        //    a "hard boundary against the cream" is a complaint about a single
        //    step from a cool blue to a warm cream, which is the largest hue
        //    jump anywhere in the picture, and a dawn sky answers it by PALING
        //    before it warms.
        //
        //    AND IT MUST NOT BE THE AVERAGE OF THE TWO. The first build made this
        //    band mix(upper, horizon, 0.52) — the obvious choice, and it produced
        //    the critic's fourth defect from scratch. Written in linear light,
        //    upper is (0.176, 0.383, 0.714) and horizon is (0.871, 0.616, 0.348):
        //    GREEN IS THE MIDDLE CHANNEL IN BOTH, so the average lands at
        //    (0.537, 0.504, 0.538) with green BELOW the other two, which is
        //    magenta by definition. It measured hsv(332, 10%) on finish-sprint —
        //    the exact "magenta near-white" signature the critic had reported
        //    against an earlier build and which the FOG_BANDS and gamut-roll work
        //    had already removed everywhere else. Any mix of a blue and an orange
        //    passes through magenta; the way between them is through a PALE BLUE,
        //    so this is the blue lifted toward the cloud highlight instead, which
        //    keeps green in the middle and the hue at 205.
        //  - uGlow is the hot band that sits ON the skyline, where the sun
        //    actually is.
        //  - uFoot is the lowest band, and it is mixed toward FOG_BANDS' most
        //    distant haze colour — the exact colour the furthest ridges are
        //    being flattened toward by applyQuantizedFog. THAT is why the slab
        //    read as "floating above the terrain": the sky met the land in a
        //    colour the land never gets to, so the join was a collision between
        //    two unrelated palettes instead of a horizon. A far ridge and the
        //    sky immediately behind it now belong to the same family, which is
        //    what aerial perspective is.
        uUpperPale: { value: mixed(SKY.upper, SKY.cloudLit, 0.30) },
        uGlow: { value: mixed(SKY.belowHorizon, SKY.sunGlow, 0.50) },
        uFoot: { value: mixed(SKY.belowHorizon, FOG_BANDS.colors[3], 0.55) },
        uSunDisc: { value: SKY.sunDisc.clone() },
        uSunGlow: { value: SKY.sunGlow.clone() },
        uCloudLit: { value: SKY.cloudLit.clone() },
        uCloudMid: { value: SKY.cloudMid.clone() },
        uCloudShadow: { value: SKY.cloudShadow.clone() },
        uCloudInk: { value: cloudInk },
        // The far layer is the same drawing seen through more air: every one of
        // its four values is pulled toward the upper sky. Aerial perspective on
        // a cel cloud is a palette shift, never an opacity.
        uFarLit: { value: mixed(SKY.cloudLit, SKY.upper, 0.30) },
        uFarMid: { value: mixed(SKY.cloudMid, SKY.upper, 0.44) },
        uFarShadow: { value: mixed(SKY.cloudShadow, SKY.upper, 0.46) },
        uFarInk: { value: mixed(cloudInk, SKY.upper, 0.38) },
        // The horizon bank sits in the warm light, so it carries the horizon's
        // own colours rather than the high sky's.
        uBankLit: { value: mixed(SKY.cloudLit, SKY.sunGlow, 0.46) },
        uBankMid: { value: mixed(SKY.cloudMid, SKY.horizon, 0.58) },
        uBankShadow: { value: mixed(SKY.cloudShadow, SKY.belowHorizon, 0.52) },
        uBankInk: { value: mixed(cloudInk, SKY.belowHorizon, 0.34) },
        uCloudNear: { value: cloudNear },
        uCloudFar: { value: cloudFar },
        uCloudBank: { value: cloudBank },
        /** Contour width in device pixels. A drawn line, not a derived one. */
        uInkPx: { value: 2.4 },
        uInvProjection: { value: new Matrix4() },
        uCamWorld: { value: new Matrix4() },
        /**
         * Sky debug view. 0 off, 1 near alpha, 2 far alpha, 3 bank alpha,
         * 4 the boundary wander field, 5 mask detail, 6 island support,
         * 7 the horizon bank's ENVELOPE, 8 the raw tile.
         *
         * 7 is the one that found the hairline. The layer's envelope read 0.004
         * at the pixel the hairline runs through — the layer was switched off and
         * still drawing — which is what pointed at cutMask rather than at the
         * envelope, after three other passes had been cleared by A/B.
         * Kept in the shipping shader on purpose: every sky defect this file
         * has had was a question about one scalar field, and answering it by
         * commenting out lines and reloading is how you end up shipping the
         * wrong hypothesis.
         */
        uSkyDebug: { value: 0 },
      },
      vertexShader: /* glsl */ `
        precision highp float;
        void main() {
          // Project at the far plane with w=z so the dome can never clip into
          // geometry regardless of the camera's far distance.
          //
          // NOTE THAT NOTHING IS INTERPOLATED OUT OF HERE. The view direction
          // used to be a varying (normalize(position) from the sphere's own
          // vertices) and that was the source of the hard vertical seams. See
          // the fragment shader.
          vec4 p = projectionMatrix * viewMatrix * vec4(position + cameraPosition, 1.0);
          gl_Position = p.xyww;
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        ${GLSL_COMMON}
        ${GLSL_FRAG_OUT}

        uniform float uTime;
        uniform vec3  uSunDir;
        uniform vec2  uResolution;
        uniform vec3  uZenith, uUpper, uHorizon, uBelow;
        uniform vec3  uUpperPale, uGlow, uFoot;
        uniform vec3  uSunDisc, uSunGlow;
        uniform vec3  uCloudLit, uCloudMid, uCloudShadow, uCloudInk;
        uniform vec3  uFarLit, uFarMid, uFarShadow, uFarInk;
        uniform vec3  uBankLit, uBankMid, uBankShadow, uBankInk;
        uniform sampler2D uCloudNear;
        uniform sampler2D uCloudFar;
        uniform sampler2D uCloudBank;
        uniform float uInkPx;
        uniform mat4  uInvProjection;
        uniform mat4  uCamWorld;
        uniform float uSkyDebug;

        const float CLOUD_TEX = ${CLOUD_TEX}.0;

        // Local band helper — the dome doesn't pull in the full cel core.
        float bandStepS(float x, float threshold, float softness) {
          float w = max(fwidth(x) * 0.8, softness);
          return smoothstep(threshold - w, threshold + w, x);
        }

        /**
         * THE VIEW RAY, AND THE REAL CAUSE OF THE HARD VERTICAL SEAMS.
         *
         * This used to be a varying: normalize(position) written per VERTEX of
         * the dome sphere and interpolated. Read that again — the direction the
         * whole sky is computed from was a linear interpolation across the
         * triangles of a 48 x 32 sphere.
         *
         * The direction itself is close enough after a re-normalise; the
         * problem is its DERIVATIVE. Linear interpolation is only piecewise
         * linear, so d(dir)/d(pixel) is CONSTANT within a triangle and JUMPS
         * across every triangle edge. Every fwidth() in this shader, and — far
         * more damaging — the mip level the GPU picks for the cloud masks, is
         * computed from exactly that derivative. So at every meridian of the
         * dome the sampled mip level stepped by a notch, the filtered cloud
         * alpha stepped with it, and the hard threshold turned that step into a
         * total flip: solid cloud sheet on one side, clear sky on the other.
         *
         * A meridian of a sphere centred on the camera is a plane through the
         * camera, and a plane through the camera projects to a perfectly
         * straight line. That is the "razor-straight vertical line at x = 1105
         * with warmer sky to its right".
         *
         * Reconstructing the ray from gl_FragCoord instead makes it an exact,
         * analytic function of the pixel — smooth to every order, identical
         * whatever the dome is tessellated at, and with no mesh edges anywhere
         * in it because the mesh no longer contributes to it at all.
         */
        vec3 viewRay() {
          vec2 ndc = (gl_FragCoord.xy / uResolution) * 2.0 - 1.0;
          vec4 v = uInvProjection * vec4(ndc, 1.0, 1.0);
          return normalize(mat3(uCamWorld) * (v.xyz / v.w));
        }

        /**
         * THE STEREOGRAPHIC PLANE. Every world-locked field in this shader —
         * both cloud projections, the horizon bank, and the boundary wander —
         * is a function of this and nothing else.
         *
         * dir.xz / (dir.y + 1) is the stereographic projection of the sky
         * sphere from its south pole. Three properties, all of which matter:
         *
         *  - Its magnitude is exactly 1.0 at the horizon and 0 at the zenith.
         *    Bounded over the entire upper hemisphere with no tuning, and — the
         *    part that matters most — SINGULARITY-FREE at the horizon, where
         *    the old dir.xz / dir.y form ran away and beat the mask against the
         *    pixel grid into a rectangular lattice.
         *  - It is CONFORMAL. Angles are preserved exactly, so cloud shapes are
         *    never sheared or smeared — only uniformly scaled.
         *  - Its scale factor is 1/(1 + dir.y): half at the zenith, one at the
         *    horizon, so shapes still get finer with distance.
         *
         * It is no longer BOUNDED INSIDE THE TILE, and that is deliberate. The
         * containment (scale 0.46, so the coordinate could never leave
         * [0.12, 0.88]) existed only because the mask did not tile; the agent
         * who wrote it said so and flagged the restriction as undesirable.
         * TileableNoise is fixed and the tiling is measured, so the scale is
         * now free and the clouds are 2.4x denser.
         */
        vec2 domeSp(vec3 dir) {
          return dir.xz / (dir.y + 1.0);
        }

        /**
         * THE BOUNDARY WANDER, AND THE FIRST HALF OF THE LEVEL-BAR FIX.
         *
         * Every plateau boundary in the gradient, and every envelope that
         * decides where a cloud layer stops, is displaced by this field. It is
         * a function of the stereographic plane, so it is locked to the WORLD:
         * the wander does not slide along the edge when the camera pans, which
         * is what separates "the edge of a wash" from "a shader effect".
         *
         * THE AMPLITUDE IS THE WHOLE POINT, AND IT HAS BEEN WRONG TWICE.
         *
         * The first build perturbed the horizon boundary by +/-0.004 in dir.y.
         * That is 0.23 degrees, six native pixels over a 3200-pixel frame, and
         * the critic correctly read the result as a letterbox bar.
         *
         * The second build raised the coefficient to 0.075 and its comment
         * claimed "+/-2 degrees, +/-60 native pixels". It was not measured, and
         * it was not true. fbm2 is a NORMALISED weighted sum of value noise:
         * its output is not spread over 0..1, it clusters hard about 0.5 with a
         * standard deviation near 0.13. So wanderField, which the comment
         * treated as +/-0.5, actually delivers about +/-0.10, and 0.075 of that
         * is +/-0.008 in dir.y. tools/capture/_bandtrace.mjs traces the
         * cream-to-orange boundary by COLOUR IDENTITY (so cloud and terrain
         * edges cannot capture the tracer) and measured exactly that on
         * finish-sprint: standard deviation 11.4 native rows, total range 46
         * rows across 3200 pixels. A boundary that moves 46 rows over the full
         * width of the frame is a rule with a slight bend in it.
         *
         * The coefficients below are calibrated against that measurement rather
         * than guessed. 1453 native rows per unit of dir.y at this field of
         * view (11.45 rows measured / 0.00788 dir.y applied), so a boundary
         * standard deviation of 45 rows needs a coefficient near 0.30.
         *
         * Every boundary rides the SAME swell so that no two of them can ever
         * cross, and each carries its own independent fine brush ripple on top,
         * so they are never parallel either — parallel edges read as a printing
         * error, and crossed edges read as a bug.
         */
        float wanderField(vec2 sp) {
          float swell  = fbm2(sp * 1.90 + 11.0, 3) - 0.5;
          float ripple = fbm2(sp * 5.40 + 41.0, 2) - 0.5;
          return swell * 0.74 + ripple * 0.26;
        }

        /**
         * The per-boundary brush ripple. Higher frequency than the swell and
         * uncorrelated between boundaries, so an edge reads as laid down with a
         * loaded brush rather than as a contour of one smooth field.
         */
        float brushField(vec2 sp, float seed) {
          return fbm2(sp * 12.5 + seed, 2) - 0.5;
        }

        /**
         * How well a cloud mask resolves at this pixel, 1 = crisply, 0 = the
         * sampler is returning the mask's mean and there is no contour left.
         *
         * A tileable mask compresses with distance until one texel covers many
         * pixels; the filtered alpha then converges on the mask's AVERAGE, and
         * re-thresholding an average at a fixed value gives either total
         * coverage or none over a whole region, decided by which side of the
         * threshold the average happens to fall.
         */
        float cloudDetail(vec2 uv) {
          vec2 d = fwidth(uv) * CLOUD_TEX;
          float lod = log2(max(max(d.x, d.y), 1e-4));
          return 1.0 - saturate1((lod - 4.1) / 3.0);
        }

        /**
         * ── THE MINIMUM ISLAND, AND WHY IT IS A MIP LOOKUP ────────────────────
         *
         * The critic counted FOURTEEN sub-20-pixel cloud fragments in one crop of
         * bike-detail, each one carrying a full ink contour, and read the result
         * as dust on the lens. It is exactly that: celCloudMask thresholds an fBm
         * field, and the level set of an fBm always has a spray of small
         * components around its large ones. The large components are the clouds
         * we want; the small ones are the same operator's litter.
         *
         * You cannot label connected components in a fragment shader. But you do
         * not need the component — you need its LOCAL AREA, and a mip level IS a
         * local area: textureLod at level L returns the mean coverage over about
         * 2^L texels, so choosing L so that 2^L texels is a fixed number of
         * SCREEN pixels gives the fraction of a disc of that radius which is
         * inside the shape, at any distance and any projection.
         *
         * That fraction separates the two populations cleanly. Reading it as a
         * disc of diameter 2 * px:
         *
         *     a 12 px scrap        about 0.11      a 40 px island   about 0.90
         *     a 20 px scrap        about 0.31      a large cloud    1.0 inside
         *     a 3 px hairline      about 0.09      a large cloud    0.5 at its edge
         *
         * So the gate opens between 0.22 and 0.42: everything under about 25 px
         * closes, everything over about 35 px is untouched, and — the part that
         * matters for the big clouds — the edge of a real cloud sits at 0.5 and
         * is never eroded at all.
         *
         * The result is fed to the layer's THRESHOLD rather than to its alpha.
         * A fragment that is merely multiplied out leaves its ink behind as a
         * ghost and cuts whatever it was overlapping along a straight line; a
         * threshold walking to 1.03 makes the shape SHRINK AND CLOSE with its
         * contour intact, which is what the layer envelopes already do and the
         * only way a cel shape is allowed to leave a frame.
         */
        float cloudSupport(sampler2D tex, vec2 uv, float px) {
          vec2 d = fwidth(uv) * CLOUD_TEX;              // texels per screen pixel
          float lod = log2(max(px * max(d.x, d.y), 1.0));
          return textureLod(tex, uv, lod).a;
        }

        /**
         * THE HORIZON BANK PROJECTION.
         *
         * The same stereographic plane, with its RADIAL coordinate compressed
         * about the horizon circle. Compressing radially stretches the sampled
         * pattern tangentially, so the mask's round blobs come out as long,
         * flat-bottomed strips lying along the horizon — the shape language of
         * low stratus, and pointedly NOT the shape language of the terrain,
         * which was the critic's complaint about the round clouds.
         *
         * It is seamless by construction. r is never 0 in the band this layer
         * occupies (r = 1 at the horizon, and the layer is gone by r = 0.85),
         * and the azimuthal path is a closed loop in tile space, so it is
         * automatically periodic in azimuth with no wrap anywhere in it.
         */
        vec2 bankUv(vec2 sp, float scale, float stretch, vec2 drift) {
          float r = max(length(sp), 1e-3);
          vec2 n = sp / r;
          // EXPANDING the radial coordinate about the horizon circle (stretch
          // greater than one) compresses the sampled pattern across the band
          // while leaving it untouched along it, so a round blob comes out as a
          // long flat strip. Getting this the wrong way round is a mistake
          // worth flagging: a stretch BELOW one elongates the features
          // radially instead and the layer draws as vertical curtains hanging
          // out of the sky, which is exactly what it did on the first pass.
          //
          // At scale 1.27 / stretch 4.0 a mask feature lands at roughly 260 x
          // 70 native pixels: a 3.7:1 strip, which is the aspect low stratus
          // actually has. The envelope in clouds() has the layer gone by 7.5
          // degrees of elevation, well before the radial term could reach zero
          // (which would need 19 degrees), so the map is single-valued and
          // finite everywhere the layer is visible.
          float rq = 1.0 + (r - 1.0) * stretch;
          return n * rq * scale + vec2(0.5) + drift;
        }

        /**
         * Banded vertical gradient. Four plateaus, hard boundaries, every one
         * of them displaced by the wander field.
         *
         * The bands are positioned directly in dir.y. A previous form ran dir.y
         * through pow(x, 0.72) of a shifted range, and that has an INFINITE
         * derivative at x = 0 — precisely where the sharpest boundary in the
         * whole sky sits. fwidth() blew up there, so the one transition that
         * most needed antialiasing was the one that could not get any.
         */
        vec3 skyGradient(vec3 dir, vec2 sp, float wander, vec2 fc) {
          float h = dir.y;

          // ── SIX BOUNDARIES, AND WHY NONE OF THEM CAN CROSS ANOTHER ───────────
          //
          // 1453 native rows per unit of dir.y at this field of view (measured
          // by tools/capture/_bandtrace.mjs, which traces a boundary by COLOUR
          // IDENTITY so cloud and terrain edges cannot capture the tracer). The
          // thresholds below are therefore, from the top down:
          //
          //     0.500  zenith          }  the high sky, unchanged
          //     0.145  upper           }
          //     0.070  upper-warm         109 rows
          //     0.016  horizon cream       78 rows
          //    -0.034  glow                73 rows
          //    -0.090  below               81 rows
          //     ...    foot                to the skyline
          //
          // The smallest gap is 0.050. Every boundary rides the SAME swell to
          // within 0.006 and carries its own independent brush ripple at 0.030,
          // so the absolute worst case — both ripples at their opposite extremes
          // of +/-0.5, which value noise cannot actually reach — closes a gap by
          // 0.030 + 0.003 = 0.033 against 0.050. Crossing is impossible, and
          // parallelism is broken by about 17 rows of independent wobble on each
          // edge, which is what stops a stack of six boundaries reading as ruled
          // lines on a page.
          float hBelow   = h + wander * 0.300 + brushField(sp, 11.0) * 0.030;
          float hGlow    = h + wander * 0.295 + brushField(sp, 63.0) * 0.030;
          float hHorizon = h + wander * 0.291 + brushField(sp, 91.0) * 0.030;
          float hWarm    = h + wander * 0.288 + brushField(sp, 127.0) * 0.030;
          float hUpper   = h + wander * 0.285 + brushField(sp, 157.0) * 0.030;
          // The zenith boundary gets less swell and more brush than the others.
          // It is the only one that can enter frame as an ISOLATED lobe rather
          // than as an edge crossing the whole width — a camera looking up sees
          // the middle of it — and a single rounded lobe of deep blue coming
          // down out of the top of frame reads as a blue cloud rather than as
          // the top of the sky.
          float hZenith  = h + wander * 0.240 + brushField(sp, 27.0) * 0.055;

          // ── THE SOFTNESS FLOORS ARE NOW BELOW THE PIXEL, NOT ABOVE IT ────────
          // These were 0.0018 to 0.0030 in dir.y. At 1453 native rows per unit of
          // dir.y that is a boundary 5 to 9 ROWS deep, against an fwidth-derived
          // one-pixel cut of 0.00055 — so the floor was winning everywhere and
          // every band edge in the sky was several pixels of ramp. It does not
          // show as a gradient going down the frame, because 6 rows is nothing;
          // it shows when a nearly-level boundary is traced ALONG its length,
          // which is how the stills critic measures, and it turns a hard cut into
          // 890 pixels of sub-4-unit steps. Rule 4 of Palette.ts says never a
          // smoothstep between bands wider than the antialiasing width, and these
          // were three to five times it. The floors are now under the fwidth term,
          // so every one of these is a genuine one-pixel cut.
          vec3 col = uFoot;
          col = mix(col, uBelow,     bandStepS(hBelow,   -0.090, 0.0007));
          col = mix(col, uGlow,      bandStepS(hGlow,    -0.034, 0.0007));
          col = mix(col, uHorizon,   bandStepS(hHorizon,  0.016, 0.0007));
          col = mix(col, uUpperPale, bandStepS(hWarm,     0.070, 0.0007));
          col = mix(col, uUpper,     bandStepS(hUpper,    0.145, 0.0008));
          col = mix(col, uZenith,    bandStepS(hZenith,   0.500, 0.0010));

          // Warm plateaus hugging the horizon on the sun side. Dawn light does
          // not wrap a sky evenly, and a gradient that is symmetric in azimuth
          // reads as a lit dome rather than as a sky.
          //
          // THE SOFTNESS HERE IS THE WHOLE POINT. This used to be a single
          // bandStepS(toward, 0.28, 0.16) — a softness two orders of magnitude
          // wider than the ones used by the vertical bands directly above. The
          // result was a sky whose HEIGHT was banded and whose AZIMUTH was a
          // smooth yellow-to-orange ramp spanning half the frame, which is the
          // exact photographic gradient the banding exists to avoid.
          //
          // The boundary is a line of constant azimuth, which projects to a
          // straight vertical rule on screen, so it gets its own wander for
          // the same reason the horizontal boundaries do.
          vec2 az    = normalize(dir.xz + vec2(1e-5, 0.0));
          vec2 sunAz = normalize(uSunDir.xz + vec2(1e-5, 0.0));
          float toward = saturate1(dot(az, sunAz));
          float wobA = fbm2(sp * 3.1 + 17.0, 3) - 0.5;
          float tw = toward + wobA * 0.055;
          float low = 1.0 - bandStepS(hWarm, 0.100, 0.0025);
          col = mix(col, mix(col, uSunGlow, 0.24), low * bandStepS(tw, 0.20, 0.0060) * 0.55);
          col = mix(col, mix(col, uSunGlow, 0.34), low * bandStepS(tw, 0.62, 0.0055) * 0.55);

          // ── THE ORDERED DITHER IS GONE, AND ITS REMOVAL IS PART OF A FIX ─────
          //
          // This line used to add (hash21(fc) - 0.5) * 0.0022 to every pixel of
          // the dome — a half-a-level whisper of white noise, there to break
          // 8-bit banding inside a plateau.
          //
          // CompositePass now quantises the finished frame's tone, and that
          // operator is faded in over the picture's own tone rate: a dead-flat
          // region is returned bit-identical, and a region carrying WHITE NOISE
          // is not flat — fwidth of half a level per pixel is 0.09 tone steps,
          // which is squarely inside the band where the quantiser works. The
          // dither would therefore have been read as a ramp and painted back out
          // as speckle, at a full step, over the largest clean areas in the game.
          //
          // It also had nothing left to do. Every plateau in this shader is a
          // constant, so there is no 8-bit banding inside one to break; the
          // dither was insurance against a smooth gradient that no longer exists
          // anywhere in the dome.
          //
          // fc is still taken as a parameter because the debug views use it.
          return col;
        }

        /**
         * Concentric hard rings around the sun. An animator draws a low sun as
         * a disc plus two or three discrete haloes; a radial falloff is a
         * photograph. This is the former — every ring softness sits inside the
         * same 0.002-0.01 window the sky bands use.
         */
        vec3 sunDisc(vec3 dir, vec3 col) {
          float d = dot(dir, uSunDir);
          float disc  = bandStepS(d, 0.99955, 0.00008);
          float ring1 = bandStepS(d, 0.9975, 0.0009);
          float ring2 = bandStepS(d, 0.988,  0.0040);
          float ring3 = bandStepS(d, 0.940,  0.0075);
          col = mix(col, uSunGlow * 0.72, ring3 * 0.34);
          col = mix(col, uSunGlow,        ring2 * 0.48);
          col = mix(col, mix(uSunGlow, uSunDisc, 0.6), ring1 * 0.72);
          col = mix(col, uSunDisc * 1.35, disc);
          return col;
        }

        // ── THE INKED CEL CLOUD ───────────────────────────────────────────────
        //
        // A drawn cloud is four things and the old one had exactly one of them:
        //
        //   1. A HARD CONTOUR whose width is constant in SCREEN pixels at any
        //      distance. Not a threshold on a filtered alpha, which is a soft
        //      edge dressed up as a hard one.
        //   2. AN INK LINE ON THAT CONTOUR. This is the single biggest reason
        //      the old clouds read as Rorschach blots: an unlined shape has no
        //      authorship. Ink is what says a hand drew it.
        //   3. A LIT CAP AND A SHADED UNDERSIDE, as flat regions with hard
        //      boundaries — not a gradient, and not a per-texel noise value.
        //   4. A LIGHT DIRECTION the break actually obeys.
        //
        // The contour is measured properly. s = alpha - threshold is a scalar
        // field whose zero set is the outline; dividing s by the length of its
        // screen-space gradient converts it to a SIGNED DISTANCE IN PIXELS,
        // exactly, at any minification. Everything else keys off that number:
        // the shape is the region where it is positive, the ink is the first
        // uInkPx pixels inside, and both stay razor-sharp from a cloud
        // overhead to one on the skyline. Where the mask has gone flat the
        // gradient goes to zero, the distance goes to infinity, and the layer
        // simply resolves to "inside" or "outside" with no shimmer.

        /**
         * THE SCALLOP, AND WHY IT HAS TO BE A DISPLACEMENT AND NOT A THRESHOLD.
         *
         * The critic's third note was that the clouds "use the same shape
         * language as the terrain so they do not separate as sky". That is
         * literally true of the source: celCloudMask thresholds an fBm field,
         * and so does the heightfield — a level set of fBm is a level set of
         * fBm whether you colour it rock or cloud, and the eye recognises the
         * family instantly. A cumulus edge is not a level set. It is a stack of
         * BULGES, each one roughly circular, at a scale finer than the cloud.
         *
         * The previous pass tried to buy that by perturbing the THRESHOLD:
         *
         *     thr = mix(1.03, 0.50, det * live) - (fbm2(uv * 9.5, 2) - 0.5) * 0.075
         *
         * That term cannot do anything, and the reason is worth writing down.
         * celCloudMask does not store a smooth field in the alpha channel — it
         * stores an ALREADY-THRESHOLDED one, clamp((d - k) / 0.045), so the
         * alpha is binary apart from a ramp one or two texels wide. Moving a
         * threshold through a binary field slides the contour by
         * offset / |grad alpha|, and |grad alpha| here is of order 0.5 PER
         * TEXEL. An offset of 0.010, which is what that expression actually
         * produced once fbm2's true spread is accounted for, moves the contour
         * by about a fiftieth of a texel. It was a no-op, which is why the
         * clouds still read as fBm level sets after it went in.
         *
         * A DISPLACEMENT OF THE SAMPLE POINT moves the contour by exactly the
         * displacement, in texels, with no dependence on the field's gradient
         * at all. So the scallop is now a domain warp, and its magnitude is a
         * BILLOW — fbm2 folded about its own midpoint, whose level sets are
         * rounded arcs rather than filigree. Folded noise pushing along a
         * slowly-turning direction field is the cheapest thing that produces
         * stacked lobes on a silhouette.
         *
         * Returned as a vector and applied ONCE to the layer's uv, so the
         * contour, the ink, the sunlit cap probe and the shaded belly probe all
         * see the same warped shape and the drawing stays self-consistent.
         *
         * Attenuated by the same detail term everything else uses — a scallop
         * finer than a pixel is just noise on the contour, and noise on a
         * contour is the one thing more obviously wrong than no contour.
         */
        vec2 cloudScallop(vec2 uv, float detail) {
          float billow = 1.0 - abs(fbm2(uv * 5.20 + 3.1, 2) * 2.0 - 1.0);
          vec2 dir = normalize(vec2(
            fbm2(uv * 3.10 + 17.0, 2) - 0.5,
            fbm2(uv * 3.10 + 53.0, 2) - 0.5
          ) + vec2(1e-5, 1e-5));
          // 0.018 of the tile is 18 texels at 1024, against cloud features of
          // 80-150 texels: a lobe you can see on the edge, not a new cloud.
          return dir * (billow - 0.45) * 0.018 * detail;
        }

        /**
         * x = coverage 0..1, y = ink 0..1, z = signed pixel distance.
         *
         * ── THE GRADIENT IS THE MASK'S, NOT THE MASK-MINUS-THRESHOLD'S ─────────
         *
         * This used to be written as one expression:
         *
         *     float s = texture(tex, uv).a - thr;
         *     float g = length(vec2(dFdx(s), dFdy(s)));
         *
         * which looks equivalent and is not, because thr IS NOT CONSTANT ACROSS
         * THE SCREEN. Every layer walks its threshold toward 1.03 through an
         * envelope in dir.y, so dFdy(s) picks up dFdy(thr) as well — and near the
         * end of a walk that term is the larger of the two.
         *
         * The consequence is precise and it was the two dashed hairlines the
         * critic found on clean blue sky in bike-detail. Once thr has walked past
         * 1.0 the layer should be gone: no value the mask can return is inside
         * it. But at the row where thr crosses the mask's solid value, s crosses
         * ZERO, and the old g there was not the mask's gradient (which is exactly
         * 0 in the middle of a solid region) but the THRESHOLD's, about 0.004 per
         * row. So dpx came out near zero rather than at minus infinity, and
         * smoothstep(-0.75, 0.75, 0) is 0.5: half-strength cloud, painted in a
         * two-pixel band along a level curve of dir.y, dashed wherever the mask
         * was not saturated. A horizontal dashed hairline across the whole frame,
         * produced by a layer whose envelope had already switched it off.
         *
         * Diagnosis, in order, because three innocent suspects were cleared
         * first: the speed field is gated off at bike-detail's 0.0084 intensity,
         * the ink pass emits nothing above y = 426, the shaft fan is at zero
         * intensity; forcing this layer's alpha to zero took the vertical step at
         * (1700, 322) from 20.2 luminance units to 1.0, and the debug view of the
         * layer's own envelope read 0.004 at that pixel — switched off, and still
         * drawing.
         *
         * Taking the gradient of the MASK ALONE restores the promise the walk was
         * written to keep: dpx is a true signed distance to the mask's level set,
         * the shape shrinks and closes as thr rises, and the instant thr passes
         * the mask's maximum there is nothing inside at all.
         */
        vec3 cutMask(sampler2D tex, vec2 uv, float thr) {
          float a = texture(tex, uv).a;
          float g = max(length(vec2(dFdx(a), dFdy(a))), 1e-7);
          float dpx = (a - thr) / g;

          // ── AND A DISTANCE TO NOTHING IS NOT A SMALL DISTANCE ─────────────────
          //
          // dpx is a linearisation: it says how many pixels away the level set
          // {a = thr} is, ASSUMING one exists. Every layer here walks thr up to
          // 1.03, above anything the mask can return, and at that point the level
          // set is empty — but the linearisation does not know that. Where the
          // mask is minified hard the alpha crosses its whole range inside one
          // pixel, so g is of order 0.5 per pixel, and a threshold overshoot of
          // 0.028 comes back as "0.06 pixels outside": smoothstep(-0.75, 0.75,
          // -0.06) is 0.47, half-strength cloud, from a layer that is switched
          // off. That is the second half of the hairline, and it survives taking
          // the gradient of the mask alone — the arithmetic is right and the
          // question is wrong.
          //
          // So the shape is closed explicitly over the last four percent of the
          // walk. This is a smooth multiply on a hard mask, which is the thing
          // that sliced the clouds along a horizontal line in an earlier build,
          // and it is safe here for one specific reason: at thr = 0.96 the shape
          // is already down to the handful of texels where the mask saturates, so
          // the fade has almost nothing left to act on. It closes a shape that
          // has already closed. Applied at thr = 0.5 it would be the old bug.
          float reach = 1.0 - smoothstep(0.960, 1.000, thr);
          float inside = smoothstep(-0.75, 0.75, dpx) * reach;
          float ink = inside * (1.0 - smoothstep(uInkPx, uInkPx + 1.3, dpx));
          return vec3(inside, ink, dpx);
        }

        /**
         * The three-value interior, WITH THE BREAK LINED.
         *
         * Marching the mask TOWARD the sun and asking "how far can I go before
         * I leave the shape" is a depth-from-the-lit-edge measurement, and the
         * band it produces is a lit CAP of controlled width on the sun side
         * only — which is how an animator paints a cloud. Deriving the break
         * from the mask's own interior value instead (which is what the first
         * version did) gives a break whose shape is whatever the noise gradient
         * happened to be, unrelated to the light, and speckled at the detail
         * frequency.
         *
         * The probes now go through cutMask rather than a bare step(), for one
         * reason: cutMask returns a SIGNED PIXEL DISTANCE, and a signed
         * distance is the only thing you can draw a line on. An animator inks
         * the boundary between the sunlit cap and the body — that line is what
         * separates a painted cloud from a two-tone silhouette, and it was the
         * missing half of the critic's "no lit/shadow break". It costs nothing
         * extra: the probe fetch was already being made.
         *
         * Hot cap on the sun side, cool cut on the far side, flat body between,
         * a line on the cap boundary, and ink all the way round the outside.
         */
        vec3 celCloud(
          sampler2D tex, vec2 uv, vec2 toSun, float thr,
          vec3 lit, vec3 mid, vec3 shd, vec3 ink, out float alpha
        ) {
          vec3 m = cutMask(tex, uv, thr);
          alpha = m.x;

          vec3 mCap   = cutMask(tex, uv + toSun * 2.0, thr);
          vec3 mBelly = cutMask(tex, uv - toSun * 1.3, thr);
          float capOut   = 1.0 - mCap.x;    // outside when probed toward the sun
          float bellyOut = 1.0 - mBelly.x;  // outside when probed away from it

          vec3 c = mid;
          c = mix(c, shd, bellyOut);   // within reach of the shaded edge
          c = mix(c, lit, capOut);     // the sunlit cap wins over it

          // THE CAP LINE. Where the sun-side probe is sitting exactly on the
          // contour, the cap boundary passes through this pixel. Drawn at
          // slightly under the outer contour's weight and toward the shadow
          // rather than to full ink, because it is a form line inside a lit
          // shape and not the edge of the shape.
          float capLine = 1.0 - smoothstep(uInkPx * 0.5, uInkPx * 0.5 + 1.2, abs(mCap.z));
          c = mix(c, mix(ink, shd, 0.35), capLine * alpha * 0.62);

          c = mix(c, ink, m.y);
          return c;
        }

        /**
         * Three cloud layers at different parallax depths.
         *
         * NOTHING IN HERE FADES ON dir.y. That is not a style choice, it is the
         * third cause of the horizontal bar: the old layers were multiplied by
         * smoothstep(0.028, 0.24, dir.y), a smooth ramp on a level dome
         * coordinate applied to a binary mask, which sliced every cloud that
         * reached the bottom of the layer along a horizontal line and left a
         * flat plateau underneath.
         *
         * Where a layer has to end, its THRESHOLD walks to 1.03 — above
         * anything the mask can return. The contour therefore SHRINKS AND
         * CLOSES with its hard edge intact, which is what distance does to a
         * cloud, instead of the coverage flipping across a line. And the
         * envelope that drives the walk carries the same world-locked wander
         * the gradient boundaries do, so even the density falloff is not level.
         *
         * The drift is a slow bounded oscillation rather than a linear
         * translation. Periods here are 12 and 16 minutes, so within any shot
         * the motion is an ordinary constant-velocity drift.
         */
        vec3 clouds(vec3 dir, vec2 sp, float wander, vec3 col, out float bankEnv) {
          float h = dir.y;
          float t = uTime;
          bankEnv = 0.0;

          // The sun's own position on the stereographic plane. "Toward the sun"
          // is then just the direction to that point, which is correct
          // everywhere on a conformal map and rotates with the sun for free.
          vec2 sunSp = uSunDir.xz / (uSunDir.y + 1.0);
          vec2 toSun = normalize(sunSp - sp + vec2(1e-5, 0.0));

          float alpha;

          // ── Far layer: finer, paler, slower. Depth cue only. ──
          vec2 driftFar = vec2(sin(t * 0.0052), sin(t * 0.0041 + 2.1)) * 0.030;
          vec2 uvFar = (dir.xz / (dir.y + 1.18)) * 2.60 + vec2(0.5) + driftFar;
          float liveFar = saturate1((h + wander * 0.09 + 0.010) / 0.150);
          float detFar = cloudDetail(uvFar);
          uvFar += cloudScallop(uvFar, detFar);
          float keepFar = smoothstep(0.22, 0.42, cloudSupport(uCloudFar, uvFar, 34.0));
          float thrFar = mix(1.03, 0.50, detFar * liveFar * keepFar);
          vec3 cFar = celCloud(
            uCloudFar, uvFar, toSun * 0.014, thrFar,
            uFarLit, uFarMid, uFarShadow, uFarInk, alpha
          );
          col = mix(col, cFar, alpha * 0.82);

          // ── Near layer: the drawing. ──
          vec2 driftNear = vec2(sin(t * 0.0087), sin(t * 0.0068 + 0.7)) * 0.034;
          vec2 uvNear = sp * 1.70 + vec2(0.5) + driftNear;
          float liveNear = saturate1((h + wander * 0.10 + 0.004) / 0.135);
          float detNear = cloudDetail(uvNear);
          uvNear += cloudScallop(uvNear, detNear);
          float keepNear = smoothstep(0.22, 0.42, cloudSupport(uCloudNear, uvNear, 34.0));
          float thrNear = mix(1.03, 0.50, detNear * liveNear * keepNear);
          vec3 cNear = celCloud(
            uCloudNear, uvNear, toSun * 0.020, thrNear,
            uCloudLit, uCloudMid, uCloudShadow, uCloudInk, alpha
          );
          col = mix(col, cNear, alpha);

          // ── Horizon bank: the drawing that lives INSIDE the old flat bar. ──
          //
          // This layer exists for one reason. dir.y 0.030..0.140 is 6.3 degrees
          // of elevation, 180 native rows at this field of view, and it used to
          // contain one flat colour across the entire frame width. A region
          // that large with nothing drawn in it IS a letterbox bar; there is no
          // amount of edge-wander that fixes an empty plateau. So the plateau
          // is where the low stratus goes.
          //
          // Its envelope peaks a degree or two above the skyline and is gone by
          // 8 degrees, and — like everything else here — the envelope drives a
          // THRESHOLD, so the strips thin out and close rather than being cut.
          vec2 driftBank = vec2(sin(t * 0.0031 + 1.4), sin(t * 0.0026 + 3.3)) * 0.016;
          vec2 uvBank = bankUv(sp, 1.06, 3.40, driftBank);
          // The stratus rides the SAME swell the horizon boundary does, at very
          // nearly the same coefficient. That is not decoration: the band this
          // layer exists to fill now undulates by about 45 native rows, and a
          // layer that stayed level inside a band that does not would sit
          // outside its own band over half the frame.
          float hb = h + wander * 0.293 + brushField(sp, 39.0) * 0.030;
          // ── THE BANK NOW REACHES DOWN THROUGH THE WHOLE WARM ZONE ────────────
          // It used to live in 0.055..0.130 of hb, which is the cream plateau and
          // nothing else, so the three bands BELOW the horizon line — the ones
          // the critic measured as a slab — had no drawing in them at all. From a
          // mountain you are looking DOWN on the low cloud over the valley, so
          // stratus below the eye line is not a licence, it is the view. The
          // envelope now spans -0.145..0.110, which covers the foot, below, glow
          // and cream bands, and it rides the horizon boundary's own swell so it
          // cannot slide out of the bands it is drawn to fill.
          //
          // ── AND THE TOP OF IT IS PINNED UNDER THE CREAM BOUNDARY ─────────────
          //
          // MEASURED. bike-detail carried two faint dashed hairlines across clean
          // blue sky at native y 275 and y 325 — the critic read them as dirt on
          // the lens, and three separate suspects were cleared by A/B before this
          // one was caught: the speed field is at intensity 0.0084 in that pose
          // and gated off entirely, the ink pass has no output above y = 426, and
          // the shaft fan is at zero. Forcing this layer's alpha to zero took the
          // vertical step at (1700, 322) from 20.2 luminance units to 1.0.
          //
          // The mechanism is the threshold walk, not the mask. cutMask measures
          // its contour as (alpha - thr) divided by the SCREEN GRADIENT OF THAT
          // WHOLE EXPRESSION, and near the end of the envelope thr is changing
          // far faster with height than the mask is changing with position — so
          // the gradient is dominated by the walk, the signed distance collapses,
          // and what should be a shape shrinking to nothing is drawn instead as a
          // two-pixel band along the level curve where thr crosses the mask. A
          // level curve of a function of dir.y is a horizontal line across the
          // frame. The island cull cannot see it: it measures the mean of the raw
          // mask, which is 0.99 there, because the mask genuinely is solid — it is
          // the THRESHOLD that has become a knife.
          //
          // Rather than fight the last few percent of the walk, the layer is now
          // gone by hb = 0.065, and since hb rides the same swell as the band
          // boundaries (0.293 against the cream boundary's 0.291) that is ALWAYS
          // just under the cream-to-warm cut at 0.070, whatever the wander is
          // doing. The residual streak therefore lands inside the cream band,
          // where a thin warm line is a cirrus and not a scratch, instead of 300
          // rows up in open blue.
          float bankIn  = saturate1((hb + 0.145) / 0.050);
          float bankOut = 1.0 - saturate1((hb - 0.020) / 0.045);
          float liveBank = bankIn * bankOut;
          float detBank = cloudDetail(uvBank);
          uvBank += cloudScallop(uvBank, detBank);
          float keepBank = smoothstep(0.22, 0.42, cloudSupport(uCloudBank, uvBank, 34.0));
          float thrBank = mix(1.03, 0.46, detBank * liveBank * keepBank);
          bankEnv = liveBank;
          vec3 cBank = celCloud(
            uCloudBank, uvBank, toSun * 0.016, thrBank,
            uBankLit, uBankMid, uBankShadow, uBankInk, alpha
          );
          col = mix(col, cBank, alpha * 0.95);

          return col;
        }

        void main() {
          vec3 dir = viewRay();
          vec2 fc = gl_FragCoord.xy;
          vec2 sp = domeSp(dir);
          float wander = wanderField(sp);

          vec3 col = skyGradient(dir, sp, wander, fc);
          col = sunDisc(dir, col);
          float bankEnv;
          col = clouds(dir, sp, wander, col, bankEnv);

          if (uSkyDebug > 0.5) {
            vec2 uvN = sp * 1.70 + vec2(0.5);
            vec2 uvF = (dir.xz / (dir.y + 1.18)) * 2.60 + vec2(0.5);
            vec2 uvB = bankUv(sp, 1.06, 4.00, vec2(0.0));
            vec3 d = vec3(0.0);
            if (uSkyDebug < 1.5)      d = vec3(texture(uCloudNear, uvN).a);
            else if (uSkyDebug < 2.5) d = vec3(texture(uCloudFar, uvF).a);
            else if (uSkyDebug < 3.5) d = vec3(texture(uCloudBank, uvB).a);
            else if (uSkyDebug < 4.5) d = vec3(wander + 0.5);
            else if (uSkyDebug < 5.5) d = vec3(cloudDetail(uvN));
            // 6 = the island-support field for the near layer, which is the one
            // thing that decides whether a fragment is a cloud or litter.
            else if (uSkyDebug < 6.5) d = vec3(cloudSupport(uCloudNear, uvN, 34.0));
            else if (uSkyDebug < 7.5) d = vec3(bankEnv);
            else d = vec3(texture(uCloudNear, fc / uResolution).a);
            col = d;
          }

          fragColor = vec4(col, 1.0);
        }
      `,
    });
    this.domeMat.name = 'sky:dome';

    const dome = new Mesh(geo, this.domeMat);
    dome.name = 'sky:dome';
    dome.frustumCulled = false;
    // AFTER the opaques, not before them. The material is opaque, so three
    // sorts it inside the opaque group and this only moves it to the end of
    // that group — transparents (dust, smear, the shaft fan at 4000) still
    // draw over it. Combined with the depth test above, every pixel the
    // terrain owns is rejected before the dome's fragment shader runs.
    dome.renderOrder = 900;
    dome.userData.skipPrepass = true;
    dome.userData.skipShadow = true;
    this.group.add(dome);
  }

  /**
   * God rays as explicit geometry — a quantised fan, not a bloom.
   *
   * ── DEFECT: THE SHAFTS WERE THE LARGEST SMOOTH GRADIENT IN THE GAME ────────
   * Two independent faults, and the visual one is not the interesting one.
   *
   * 1. THE RADIAL PROFILE WAS A 74%-OF-LENGTH SMOOTH RAMP.
   *      radial = smoothstep(0.015, 0.16, t) * (1.0 - smoothstep(0.26, 1.0, t))
   *    Every other value in this game is quantised — four terrain bands, four
   *    sky plateaus, three cloud values, a hard-thresholded bloom. A continuous
   *    ramp 0.74 of a shaft long, on the widest object in the frame, was
   *    therefore the ONLY smooth gradient left in the picture, and the eye goes
   *    straight to it. It is now three hard radial steps and a hard terminal
   *    cut, crossed with three hard angular wedges: nine flat values per shaft,
   *    every boundary a drawn line.
   *
   * 2. THE APEX WAS NOT WHERE THE COMMENT SAID IT WAS, WHICH IS WHY THEY LAY
   *    ACROSS THE SLOPES. The previous build put the apex at
   *
   *        vec3 apex = uSunView * uShaftDist;    // uShaftDist = 850
   *
   *    and turned depth testing on, on the stated reasoning that a fan 850 m
   *    away is behind the mid-ground and would be occluded by it. But that
   *    expression does not put the apex 850 m away along the VIEW axis; it puts
   *    it 850 m along the SUN direction, so its view-space depth is
   *    850 * |sunView.z| — and sunView.z is only -1 when you are staring
   *    straight into the sun. The gate that enables the effect admits anything
   *    down to sunView.z = -0.08, so the fan was routinely drawn at a depth of
   *    68 metres. Every slope beyond 68 m failed to occlude it. The flag was
   *    right and the geometry was in the wrong place.
   *
   *    apex is now built so that apex.z is EXACTLY -uShaftDist whatever the sun
   *    is doing, by scaling along the sun direction until it reaches that
   *    plane. At 900 m the entire tree line, every rider, the trail and all
   *    mid-ground terrain sit in front of it and cut it exactly. The shafts can
   *    only ever paint sky, which is the brief's "shafts through the tree
   *    line": the trees cut them, they do not cut the trees. It is also what
   *    keeps them off the subject — a rider is never 900 m from the camera.
   *
   * The fan still shares ONE apex, because a ray through the sun is the one
   * straight line in a sky that reads unambiguously as light, and it is
   * impossible for two of them to meet at a right angle.
   */
  buildShafts(count = 5): void {
    const positions: number[] = [];
    const uvs: number[] = [];
    const seeds: number[] = [];
    const angles: number[] = [];
    const halves: number[] = [];
    const lens: number[] = [];

    // The fan sweeps a 118-degree arc centred on straight down, so a sun above
    // the frame rakes into the picture and a sun near the horizon still throws
    // its outermost shafts along the ridge line rather than into the ground.
    const FAN_CENTRE = -Math.PI * 0.5;
    const FAN_SPREAD = 1.03;

    for (let i = 0; i < count; i++) {
      const t = (i + 0.5) / count;
      // A deterministic, irrational-ish jitter so the fan is not a metronome.
      const j = Math.sin(i * 12.9898) * 43758.5453;
      const jitter = (j - Math.floor(j) - 0.5) * (FAN_SPREAD / count) * 0.65;
      const angle = FAN_CENTRE + (t - 0.5) * 2 * FAN_SPREAD + jitter;
      // Alternating thick/thin, which is how a background painter spaces them.
      // Narrower than before: these are strokes of light, not floodlights.
      const half = (i & 1) === 0 ? 0.022 + t * 0.016 : 0.036 + t * 0.024;
      const len = (i & 1) === 0 ? 1.05 - t * 0.24 : 0.74 - t * 0.16;

      // One triangle per shaft: the apex on the sun, two corners at the tip.
      // position.x is the angular parameter (-1..1), position.y the radial one.
      const verts = [
        [0, 0], [-1, 1], [1, 1],
      ];
      for (const v of verts) {
        positions.push(v[0], v[1], 0);
        uvs.push(v[0] * 0.5 + 0.5, v[1]);
        seeds.push(t);
        angles.push(angle);
        halves.push(half);
        lens.push(len);
      }
    }

    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
    geo.setAttribute('aSeed', new Float32BufferAttribute(seeds, 1));
    geo.setAttribute('aAngle', new Float32BufferAttribute(angles, 1));
    geo.setAttribute('aHalf', new Float32BufferAttribute(halves, 1));
    geo.setAttribute('aLen', new Float32BufferAttribute(lens, 1));

    this.shaftMat = new ShaderMaterial({
      glslVersion: GLSL3,
      transparent: true,
      depthWrite: false,
      // ON. Together with the corrected apex depth below, this is what stops
      // the shafts washing the foreground.
      depthTest: true,
      blending: AdditiveBlending,
      side: DoubleSide,
      fog: false,
      uniforms: {
        uTime: NPR.uTime,
        uResolution: NPR.uResolution,
        uColor: { value: SKY.sunGlow.clone() },
        uEdge: { value: SKY.sunDisc.clone() },
        uIntensity: { value: 0.0 },
        /** Sun direction in VIEW space. The apex sits along it. */
        uSunView: { value: new Vector3(0, 0, -1) },
        /** VIEW-SPACE DEPTH of the fan plane, metres. Not a distance along the
         *  sun ray — see the header. Everything nearer than this occludes it. */
        uShaftDist: { value: 900 },
      },
      vertexShader: /* glsl */ `
        precision highp float;
        in float aSeed;
        in float aAngle;
        in float aHalf;
        in float aLen;
        uniform vec3  uSunView;
        uniform float uShaftDist;
        uniform float uTime;
        out vec2  vUv;
        out float vSeed;
        void main() {
          vUv = uv;
          vSeed = aSeed;

          // The apex, in view space, ON the sun ray and ON the z = -uShaftDist
          // plane. Scaling the sun direction until it reaches that plane is
          // what makes the depth test mean what the header says it means; the
          // previous build multiplied the direction by the distance instead,
          // which put the plane anywhere from 72 m to 900 m depending on where
          // the camera happened to be looking.
          //
          // It still projects to exactly the sun's screen position, whatever
          // the lens, because the apex is still on the sun ray.
          float toward = min(uSunView.z, -0.08);
          vec3 apex = uSunView * (uShaftDist / -toward);

          // Half the screen height, in view units, at the apex's depth. Working
          // through this rather than through the aspect ratio means the fan
          // angles are true screen angles and the shafts are the same length
          // relative to the frame on any window shape. It is now constant,
          // since apex.z is.
          float halfH = uShaftDist / max(projectionMatrix[1][1], 1e-4);

          float drift = sin(uTime * 0.17 + aSeed * 7.0) * 0.018;
          float a = aAngle + drift + position.x * aHalf;
          vec2 d = vec2(cos(a), sin(a));

          vec3 p = apex + vec3(d * (position.y * aLen * halfH), 0.0);
          gl_Position = projectionMatrix * vec4(p, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        ${GLSL_COMMON}
        ${GLSL_FRAG_OUT}
        uniform vec3 uColor;
        uniform vec3 uEdge;
        uniform float uIntensity;
        uniform float uTime;
        in vec2  vUv;
        in float vSeed;

        // A hard step whose transition is exactly one pixel wide, and a line of
        // the same width centred on it. Everything in this shader is built from
        // these two: there is no smooth term anywhere in the effect.
        float hstep(float x, float e) {
          float w = max(fwidth(x) * 0.8, 0.0012);
          return smoothstep(e - w, e + w, x);
        }
        float hline(float x, float e, float halfWidth) {
          float w = max(fwidth(x) * 0.8, 0.0010);
          return smoothstep(e - halfWidth - w, e - halfWidth + w, x)
               * (1.0 - smoothstep(e + halfWidth - w, e + halfWidth + w, x));
        }

        void main() {
          // ── ACROSS: three nested wedges, three flat values, drawn edges. ──
          // The outermost cut sits at 0.86 of the triangle's angular half-width
          // so the polygon's own edge at 1.0 carries zero alpha and can never
          // be the edge you see.
          float across = abs(vUv.x - 0.5) * 2.0;
          float w1 = 1.0 - hstep(across, 0.30);
          float w2 = 1.0 - hstep(across, 0.60);
          float w3 = 1.0 - hstep(across, 0.86);
          float wedge = 0.34 * w3 + 0.30 * w2 + 0.36 * w1;

          // ── ALONG: three flat segments and a hard terminal cut. ──
          // This replaces a smoothstep ramp that ran 74% of the shaft's length
          // and was, after everything else in the game was quantised, the
          // largest smooth gradient in the frame.
          float t = vUv.y;
          float seg = 1.0 - 0.30 * hstep(t, 0.30) - 0.34 * hstep(t, 0.56);
          float live = hstep(t, 0.045) * (1.0 - hstep(t, 0.80));
          float radial = seg * live;

          // ── DRAWN EDGES. A hot line on each wedge boundary and on the tip. ──
          // A painted shaft has an inked side; without these the wedges are
          // just three flat values butted together and the effect reads as
          // banding rather than as drawing.
          float edges =
              hline(across, 0.86, 0.006)
            + hline(across, 0.60, 0.005) * 0.75
            + hline(across, 0.30, 0.004) * 0.55;
          edges *= live;
          float tip = hline(t, 0.80, 0.010) * w3 * 0.6;

          // Slow breathing so the shafts feel like light through moving canopy.
          float breathe = 0.78 + 0.22 * sin(uTime * 0.55 + vSeed * 9.1);

          float a = wedge * radial * breathe * uIntensity;
          float e = (edges + tip) * breathe * uIntensity * 0.9;
          if (a + e < 0.0025) discard;
          vec3 c = uColor * a + uEdge * e;
          fragColor = vec4(c, a + e);
        }
      `,
    });

    this.shafts = new Mesh(geo, this.shaftMat);
    this.shafts.name = 'sky:shafts';
    this.shafts.frustumCulled = false;
    this.shafts.renderOrder = 4000;
    this.shafts.userData.skipPrepass = true;
    this.shafts.userData.skipShadow = true;
    this.group.add(this.shafts);
  }

  /** Debug view on the dome. See the uSkyDebug uniform for the modes. */
  setDebug(mode: number): void {
    this.domeMat.uniforms.uSkyDebug.value = mode;
  }

  /**
   * @param sunVisibility 0..1 — how much of the sun the tree line leaves open.
   *   The game feeds this from a cheap occlusion probe so the shafts only
   *   appear when the sun is actually raking through something.
   */
  update(camera: PerspectiveCamera, sunVisibility = 0): void {
    this.group.position.copy(camera.position);

    // The dome reconstructs its view ray per pixel from these two, so they are
    // not optional bookkeeping — they ARE the sky's geometry.
    (this.domeMat.uniforms.uInvProjection.value as Matrix4).copy(camera.projectionMatrixInverse);
    (this.domeMat.uniforms.uCamWorld.value as Matrix4).copy(camera.matrixWorld);

    // The ink contour is authored in device pixels, so it has to know how many
    // device pixels there are. Reads the same uResolution the pipeline sets.
    const res = NPR.uResolution.value as Vector2;
    this.domeMat.uniforms.uInkPx.value = res.y > 1400 ? 2.6 : 1.7;

    if (this.shaftMat) {
      // Sun direction in view space. Reused, never reallocated.
      const sv = this.shaftMat.uniforms.uSunView.value as Vector3;
      sv.copy(SUN_DIRECTION).transformDirection(camera.matrixWorldInverse);

      // The fan only exists when the sun itself is in frame. The old test
      // allowed |ndc| < 1.6, so shafts were routinely drawn from an apex a
      // long way off the top of the screen — which is how a shaft edge ended
      // up crossing the sky as a bare vertical rule with no visible source.
      _sunWorld.copy(SUN_DIRECTION).multiplyScalar(3000).add(camera.position);
      const p = _sunWorld.project(camera);
      const inFront = sv.z < -0.08 && p.z < 1;
      // A soft gate at the frame edge so the fan cannot pop on and off as the
      // camera pans; 0.92..1.18 is a little outside the frame, which is where
      // a real sun still throws shafts into it.
      const edge = Math.max(Math.abs(p.x), Math.abs(p.y));
      const gate = inFront ? 1 - Math.min(1, Math.max(0, (edge - 0.92) / 0.26)) : 0;

      // 0.24, and it is additive on top of an already-lit sky: these are an
      // accent, not an exposure event. At the original scale a single shaft
      // added more light to the frame than the sun disc itself.
      const target = gate * sunVisibility * 0.24;
      const cur = this.shaftMat.uniforms.uIntensity.value as number;
      this.shaftMat.uniforms.uIntensity.value = cur + (target - cur) * 0.06;
    }
  }

  dispose(): void {
    this.domeMat.dispose();
    this.shaftMat?.dispose();
  }
}
