/**
 * ShaderChunks — the shared GLSL vocabulary of the NPR pipeline.
 *
 * Every surface in this game — terrain, rock, bark, canopy, skin, denim,
 * anodised aluminium, goggle glass, water — is lit by the same function,
 * `celShade()`, differing only in the ramp constants fed to it. That is what
 * makes the picture cohere. A cel shader bolted onto three meshes and left off
 * the rest reads instantly as a gimmick; a single unified response across every
 * pixel reads as an art direction.
 *
 * All chunks target GLSL ES 3.00 (`THREE.GLSL3`).
 *
 * The pipeline, in order:
 *   1. Depth/normal prepass  → MRT G-buffer (normal, depth, id, curvature)
 *   2. Inverted-hull outlines → BackSide pass, curvature- and distance-weighted
 *   3. Main cel pass          → celShade() + hatch + rim + banded spec + fog
 *   4. Sobel over the G-buffer → interior lines the hull cannot produce
 *   5. Threshold bloom, speed lines, LUT grade, vignette, paper grain
 */

// ─────────────────────────────────────────────────────────────────────────────
// Common constants and small helpers shared by every stage.
// ─────────────────────────────────────────────────────────────────────────────
export const GLSL_COMMON = /* glsl */ `
  #define PI  3.141592653589793
  #define TAU 6.283185307179586
  #define EPS 1e-6

  float saturate1(float x) { return clamp(x, 0.0, 1.0); }
  vec3  saturate3(vec3 x)  { return clamp(x, 0.0, 1.0); }

  float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

  // Cheap 2D hash — deterministic, no texture fetch. Used for stipple dither
  // and for breaking up banding artefacts below the quantisation threshold.
  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  vec2 hash22(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.xx + p3.yz) * p3.zy);
  }

  // Value noise — used sparingly, only for surface break-up inside a band.
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }

  float fbm2(vec2 p, int octaves) {
    float s = 0.0, a = 0.5, n = 0.0;
    for (int i = 0; i < 8; i++) {
      if (i >= octaves) break;
      s += a * vnoise(p);
      n += a;
      a *= 0.5;
      p *= 2.02;
    }
    return s / max(n, EPS);
  }

  // Octahedral normal encode/decode — 2 channels instead of 3 when we need
  // the room. Kept here because both the prepass and the Sobel pass use it.
  vec2 octEncode(vec3 n) {
    n /= (abs(n.x) + abs(n.y) + abs(n.z));
    vec2 e = n.xy;
    if (n.z < 0.0) e = (1.0 - abs(n.yx)) * vec2(n.x >= 0.0 ? 1.0 : -1.0, n.y >= 0.0 ? 1.0 : -1.0);
    return e * 0.5 + 0.5;
  }

  vec3 octDecode(vec2 e) {
    e = e * 2.0 - 1.0;
    vec3 n = vec3(e.xy, 1.0 - abs(e.x) - abs(e.y));
    float t = saturate1(-n.z);
    n.xy += vec2(n.x >= 0.0 ? -t : t, n.y >= 0.0 ? -t : t);
    return normalize(n);
  }

  // sRGB <-> linear. We author every colour in sRGB and convert once.
  vec3 srgbToLinear(vec3 c) {
    return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
  }
  vec3 linearToSrgb(vec3 c) {
    return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
  }
`;

/**
 * Fragment output declaration.
 *
 * Under `THREE.GLSL3` three emits no `out` declaration and no `gl_FragColor`
 * alias — the shader owns its outputs entirely. Every single-target fragment
 * shader in the project includes this; the MRT prepass declares its own pair.
 */
export const GLSL_FRAG_OUT = /* glsl */ `
  layout(location = 0) out vec4 fragColor;
`;

// ─────────────────────────────────────────────────────────────────────────────
// The uniform block every cel material shares. These uniform *objects* are
// literally shared between materials (same JS reference), so the frame update
// writes each value exactly once regardless of how many materials exist.
// ─────────────────────────────────────────────────────────────────────────────
export const GLSL_GLOBAL_UNIFORMS = /* glsl */ `
  uniform vec3  uSunDir;          // world-space, points TOWARD the sun
  uniform vec3  uSunColor;
  uniform vec3  uSkyBounce;       // cool fill from the sky dome
  uniform vec3  uGroundBounce;    // warm bounce into undersides
  uniform float uAmbient;         // scalar strength of the two bounce terms
  uniform float uTime;
  uniform vec2  uResolution;      // device pixels
  uniform vec3  uCameraPos;

  // Quantised atmospheric depth — 4 discrete haze plateaus.
  uniform vec3  uFogColors[4];
  uniform float uFogStrengths[4];
  uniform float uFogNear;
  uniform float uFogFar;
  uniform vec3  uFogSunTint;
  uniform float uFogSunTintStrength;

  // Generated screen-space hatch atlas (3 tiers packed in RGB).
  uniform sampler2D uHatchTex;
  uniform float uHatchGlobal;     // master dial, 0 kills all hatching

  // Generated matcaps: fake reflection without a single cubemap probe.
  uniform sampler2D uMatcapMetal;
  uniform sampler2D uMatcapSkin;

  // Sun shadow — our own 2-cascade map, not three's light system, so the
  // shadow can be hard-edged and violet-tinted rather than physically soft.
  uniform sampler2D uShadowMap0;
  uniform sampler2D uShadowMap1;
  uniform mat4  uShadowMat0;
  uniform mat4  uShadowMat1;
  uniform float uShadowSplit;     // view distance where cascade 0 hands over
  uniform vec2  uShadowTexel;     // 1/size for each cascade
  uniform vec2  uShadowTexelWorld;// world metres per shadow texel, per cascade
  uniform float uShadowStrength;
  uniform float uShadowBias;
`;

// ─────────────────────────────────────────────────────────────────────────────
// Per-material ramp uniforms.
// ─────────────────────────────────────────────────────────────────────────────
export const GLSL_RAMP_UNIFORMS = /* glsl */ `
  uniform vec3  uBandColor[4];
  uniform float uBandThreshold[3];
  uniform int   uBandCount;       // 3 or 4
  uniform float uEdgeSoftness;

  uniform float uSpecStrength;
  uniform float uSpecPower;
  uniform vec3  uSpecColor;

  uniform float uRimStrength;
  uniform float uRimPower;
  uniform vec3  uRimColor;

  uniform float uHatchStrength;
  uniform float uHatchScale;

  uniform vec3  uTint;            // per-instance / per-rider recolour
  uniform float uTintStrength;
  uniform float uMatcapMix;       // 0 = pure ramp, 1 = pure matcap
  uniform float uMaterialId;      // written to the G-buffer for ID edges
  uniform float uOpacity;
`;

// ─────────────────────────────────────────────────────────────────────────────
// The core: banded lighting.
// ─────────────────────────────────────────────────────────────────────────────
export const GLSL_CEL_CORE = /* glsl */ `
  /**
   * Hard band select with a *pixel-width* anti-aliased edge.
   *
   * The naive version is step(threshold, x), which aliases into a crawling
   * jagged terminator the moment the camera moves — the single most common
   * failure of browser toon shaders. The fix is to soften the edge by exactly
   * the screen-space derivative of the shading term, so the transition is one
   * pixel wide no matter how oblique the surface. The band still reads as a
   * hard ink edge; it just stops shimmering.
   */
  float bandStep(float x, float threshold, float softness) {
    float w = max(fwidth(x) * 0.75, softness);
    return smoothstep(threshold - w, threshold + w, x);
  }

  /**
   * Evaluate the ramp. Returns the band colour for a given lighting term.
   * Bands are composited low-to-high so a 3-band ramp simply ignores the
   * fourth entry — one code path, no branching on band count in the hot loop.
   */
  vec3 evalRamp(float ndl) {
    vec3 col = uBandColor[0];
    col = mix(col, uBandColor[1], bandStep(ndl, uBandThreshold[0], uEdgeSoftness));
    col = mix(col, uBandColor[2], bandStep(ndl, uBandThreshold[1], uEdgeSoftness));
    if (uBandCount > 3) {
      col = mix(col, uBandColor[3], bandStep(ndl, uBandThreshold[2], uEdgeSoftness));
    }
    return col;
  }

  /** Which band index a shading term falls into — needed to mask the hatch. */
  float bandIndex(float ndl) {
    float b = 0.0;
    b += bandStep(ndl, uBandThreshold[0], uEdgeSoftness);
    b += bandStep(ndl, uBandThreshold[1], uEdgeSoftness);
    if (uBandCount > 3) b += bandStep(ndl, uBandThreshold[2], uEdgeSoftness);
    return b;
  }

  /**
   * Banded specular. Not a Blinn-Phong falloff — a *shape*. The highlight is
   * thresholded into one or two hard steps so it reads as a drawn glint on a
   * frame tube or a helmet shell, the way an animator would ink it.
   */
  float bandedSpecular(vec3 N, vec3 V, vec3 L, float power) {
    vec3 H = normalize(L + V);
    float ndh = saturate1(dot(N, H));
    float s = pow(ndh, power);
    // Two hard tiers: a core and a wider halo. The halo keeps the shape from
    // looking like a bare dot on curved surfaces.
    float core = bandStep(s, 0.62, 0.004);
    float halo = bandStep(s, 0.20, 0.010);
    return core * 0.75 + halo * 0.25;
  }

  /**
   * Fresnel rim. Deliberately banded too — a soft rim gradient would be the
   * only smooth thing in the frame and would give the whole trick away.
   */
  float celRim(vec3 N, vec3 V, float power) {
    float f = pow(1.0 - saturate1(dot(N, V)), power);
    return bandStep(f, 0.42, 0.05);
  }

  /**
   * Screen-space hatch inside shadow bands.
   *
   * A cel background painter does not fill a shadow with flat grey — they fill
   * it with texture: hatching, stipple, a halftone screen. We reproduce that by
   * sampling a generated hatch atlas in SCREEN space (so it reads as a drawn
   * overlay on the image, not as a texture stuck to the object) and blending
   * it only inside the darker bands.
   *
   * Three tiers live in the atlas's R, G, B channels — coarse, medium, fine —
   * and we pick between them by how dark the band is, exactly the way an
   * illustrator reaches for a denser screen tone in a deeper shadow.
   */
  vec3 applyHatch(vec3 col, float bandIdx, vec2 fragCoord, float lift) {
    float strength = uHatchStrength * uHatchGlobal;
    if (strength <= 0.001) return col;

    // Darkest band gets the densest tier; the band above it gets a light pass.
    float deep = 1.0 - saturate1(bandIdx);            // 1 inside band 0
    float mid  = saturate1(1.0 - abs(bandIdx - 1.0)); // 1 inside band 1
    float cover = deep + mid * 0.42;
    if (cover <= 0.001) return col;

    vec2 uv = fragCoord / (34.0 * uHatchScale);
    // Rotate the screen at a fixed angle so hatching never lines up with the
    // pixel grid or with the horizon — a horizontal hatch on a horizon line
    // reads as a rendering artefact rather than as a stroke.
    const float a = 0.5934; // ~34 degrees
    mat2 rot = mat2(cos(a), -sin(a), sin(a), cos(a));
    vec3 atlas = texture(uHatchTex, rot * uv).rgb;

    float tier = mix(atlas.g, atlas.r, deep);
    // Break the hatch with low-frequency noise so it doesn't read as a filter
    // laid uniformly over the frame.
    float breakup = fbm2(fragCoord * 0.004 + uTime * 0.01, 3);
    float h = tier * mix(0.72, 1.0, breakup);

    // Hatch DARKENS toward the shadow hue rather than toward black, and lifts
    // slightly where it doesn't cover — that lift is what makes it read as
    // paper tooth instead of dirt on the lens.
    vec3 hatchCol = col * 0.74;
    return mix(col * (1.0 + lift * 0.06), hatchCol, h * cover * strength);
  }
`;

// ─────────────────────────────────────────────────────────────────────────────
// Shadow lookup — our own cascades, tuned for hard cel edges.
// ─────────────────────────────────────────────────────────────────────────────
export const GLSL_SHADOW = /* glsl */ `
  /**
   * Interleaved gradient noise. A per-pixel angle that is well distributed over
   * any 3x3 neighbourhood rather than merely uncorrelated, so rotating a sample
   * disc by it produces a fine even tooth instead of white-noise clumping.
   */
  float shadowDither(vec2 fragCoord) {
    return fract(52.9829189 * fract(dot(fragCoord, vec2(0.06711056, 0.00583715))));
  }

  float sampleShadowMap(sampler2D map, vec4 coord, float texel, float bias, float radius, float rot) {
    vec3 p = coord.xyz / coord.w;
    p = p * 0.5 + 0.5;
    if (p.x < 0.002 || p.x > 0.998 || p.y < 0.002 || p.y > 0.998 || p.z > 1.0) return 1.0;

    // 4-tap disc PCF, ROTATED PER PIXEL.
    //
    // The disc used to be at a fixed orientation, which meant every fragment
    // inside one shadow texel asked the map the same four questions and got the
    // same four answers — so the boundary between "lit" and "shadowed" was the
    // boundary between texels, drawn at full contrast. That is the staircase:
    // a 45-degree shadow edge crossing an axis-aligned grid produces long runs
    // of constant answer, and the eye reads the runs as blocks.
    //
    // Rotating the disc by a per-pixel angle means adjacent fragments inside
    // one texel sample DIFFERENT neighbouring texels, so the transition is
    // resolved stochastically at pixel scale instead of at texel scale. It
    // works WITH the two-step penumbra quantisation rather than against it:
    // the quantiser still emits only three values, and the dither decides which
    // of them each pixel gets. The result is a tooth-edged stroke, which is
    // what a brush gives you anyway, rather than a machined step.
    float c = cos(rot);
    float s = sin(rot);
    mat2 R = mat2(c, s, -s, c);

    float sum = 0.0;
    const vec2 taps[4] = vec2[4](
      vec2(-0.326, -0.406), vec2( 0.520, -0.316),
      vec2(-0.840,  0.074), vec2( 0.286,  0.720)
    );
    for (int i = 0; i < 4; i++) {
      float d = texture(map, p.xy + (R * taps[i]) * texel * radius).r;
      sum += step(p.z - bias, d);
    }
    return sum * 0.25;
  }

  /**
   * Two cascades, hard-switched with a short blend so the seam never shows.
   * Returns 1.0 = fully lit, 0.0 = fully shadowed.
   */
  float sunShadow(vec3 worldPos, vec3 N, float viewDist, float ndl) {
    if (uShadowStrength <= 0.001) return 1.0;

    // ── Normal-offset bias ───────────────────────────────────────────────────
    // A depth bias alone cannot survive this sun. At 21.5° elevation the depth
    // gradient across one shadow texel on near-flat ground is enormous, so the
    // constant bias needed to stop self-shadowing is large enough to detach
    // every shadow from its caster.
    //
    // Offsetting the SAMPLE POSITION along the surface normal instead scales
    // automatically with the texel's world footprint, costs nothing, and does
    // not peter-pan: the lookup simply moves to where the texel's depth is
    // actually valid. It matters more here than in a realistic renderer,
    // because the two-step penumbra quantisation below turns what would be
    // soft dithered acne into crisp, deliberate-looking corduroy — the
    // artefact is amplified by the very thing that makes the shadow graphic.
    float grazing = 1.0 - saturate1(ndl);
    // CLAMPED. Cascade 1's texel is 0.62 m of world, so an unclamped
    // 1.1 + 2.6*grazing offset reached 2.29 m and walked the lookup clean off
    // the caster: tree shadows tore into radiating needles and rider shadows
    // detached from the wheels. The offset only has to cover one texel's depth
    // slope, and past a few centimetres it stops fixing acne and starts
    // deleting contact.
    float texelWorld = viewDist < uShadowSplit ? uShadowTexelWorld.x : uShadowTexelWorld.y;
    float offset = min(texelWorld * (1.1 + 2.6 * grazing), 0.42);
    vec3 p = worldPos + N * offset;

    // A much smaller depth bias on top, purely to cover the residual.
    float slopeBias = uShadowBias * (1.0 + 1.5 * grazing);

    // ── How wide to spread the disc ─────────────────────────────────────────
    // fwidth(worldPos) is the world-space footprint of ONE DEVICE PIXEL on this
    // surface — free, exact, and already accounts for slope and distance, which
    // is precisely the quantity that decides whether a shadow texel lands on
    // two pixels or on thirty. Sizing the disc so it spans roughly a couple of
    // device pixels keeps the dithered transition band at the width a drawn
    // edge would have, no matter where in the cascade the fragment sits: tight
    // where the texel is already small, opened up where one texel would
    // otherwise cover a visible block.
    float pxWorld = length(fwidth(worldPos));
    float rot = shadowDither(gl_FragCoord.xy) * 6.2831853;

    float s;
    if (viewDist < uShadowSplit) {
      float r0 = clamp(1.7 * pxWorld / max(uShadowTexelWorld.x, 1e-4), 0.6, 2.4);
      s = sampleShadowMap(uShadowMap0, uShadowMat0 * vec4(p, 1.0), uShadowTexel.x, slopeBias, r0, rot);
      // Cross-fade into cascade 1 over the last 15% of the near range.
      float t = smoothstep(uShadowSplit * 0.85, uShadowSplit, viewDist);
      if (t > 0.0) {
        vec3 p1 = worldPos + N * min(uShadowTexelWorld.y * (1.1 + 2.6 * grazing), 0.42);
        float r1 = clamp(1.7 * pxWorld / max(uShadowTexelWorld.y, 1e-4), 0.6, 2.4);
        float s1 = sampleShadowMap(uShadowMap1, uShadowMat1 * vec4(p1, 1.0), uShadowTexel.y, slopeBias * 2.0, r1, rot);
        s = mix(s, s1, t);
      }
    } else {
      float r1 = clamp(1.7 * pxWorld / max(uShadowTexelWorld.y, 1e-4), 0.6, 2.4);
      s = sampleShadowMap(uShadowMap1, uShadowMat1 * vec4(p, 1.0), uShadowTexel.y, slopeBias * 2.0, r1, rot);
    }

    // Quantise the penumbra to two steps. A continuous penumbra is the fastest
    // way to make a cel frame look like a PBR frame with the colour turned off.
    s = floor(s * 2.0 + 0.5) * 0.5;
    return mix(1.0, s, uShadowStrength);
  }
`;

// ─────────────────────────────────────────────────────────────────────────────
// Quantised atmospheric perspective.
// ─────────────────────────────────────────────────────────────────────────────
export const GLSL_FOG = /* glsl */ `
  /**
   * Four discrete haze plateaus rather than an exponential curve.
   *
   * This is the composition trick that carries every wide shot in the game:
   * because the haze snaps between plateaus instead of blending, each distant
   * ridge sits on exactly one plateau and therefore reads as a single flat
   * silhouette — a paper cut-out — stacking behind the ridge in front of it.
   * Continuous fog would dissolve those same ridges into a grey gradient and
   * the depth would read as mush.
   *
   * A tiny dither on the band boundary stops the plateau edges from drawing
   * hard vertical seams across a slope that happens to sit right on a split.
   */
  vec3 applyQuantizedFog(vec3 color, float viewDist, vec3 viewDir, vec2 fragCoord) {
    float t = saturate1((viewDist - uFogNear) / max(uFogFar - uFogNear, EPS));
    // Slight curve so the near bands cover more world distance than the far ones.
    t = pow(t, 0.78);

    // hash21(fragCoord), NOT hash21(fragCoord * 0.5). Halving the coordinate
    // makes the hash lattice two device pixels wide, and a two-pixel lattice at
    // retina does not read as noise — it resolves into a stable checkerboard
    // laid over every band boundary in the frame. One device pixel per sample
    // is the only spacing that dithers.
    // A COHERENT carrier, gated to the band boundary.
    //
    // One device pixel per sample was chosen because a two-pixel hash lattice
    // resolved into a stable checkerboard. But per-pixel white noise on the
    // band INDEX is worse: it swaps whole fog plateaus between adjacent pixels,
    // and a plateau swap is a 28-to-55 level jump. Measured over a flat patch
    // it produced 43% single-pixel islands — the entire remaining "fine white
    // stipple" on the snowfields, and it survived flat-shading the terrain,
    // which is how it was isolated to here rather than to the material.
    //
    // Two changes. The carrier is smooth value noise on a ~2.6 px lattice, so
    // neighbouring pixels agree and the break wanders instead of fizzing. And
    // the amplitude is gated by distance to the nearest boundary: dither exists
    // to hide the step, so it has no business acting in the middle of a
    // plateau, which is where all the stipple was.
    float fRaw = saturate1(t) * 3.999;
    float edge = 1.0 - abs(fract(fRaw) - 0.5) * 2.0;
    float carrier = vnoise(fragCoord * 0.38) - 0.5;
    float dither = carrier * 0.055 * smoothstep(0.35, 1.0, edge);

    float f = saturate1(t + dither) * 3.999;
    int   i = int(floor(f));
    i = clamp(i, 0, 3);

    vec3  fogCol = uFogColors[i];
    float fogStr = uFogStrengths[i];

    // Warm the haze where you are looking toward the sun — the classic dawn
    // read where the far ridges go gold on one side and violet on the other.
    float sunAmount = saturate1(dot(normalize(viewDir), uSunDir));
    sunAmount = pow(sunAmount, 2.2);
    fogCol = mix(fogCol, uFogSunTint, sunAmount * uFogSunTintStrength);

    // The strength is the PLATEAU value and nothing else.
    //
    // This used to be multiplied by the continuous t, which quietly undid the
    // whole point: the four discrete strengths were re-swept into a smooth ramp
    // and every far ridge dissolved into the same grey wash instead of stacking
    // as a flat paper layer. Picking a plateau and then scaling it by the very
    // continuous variable it was quantised from is a gradient with extra steps.
    return mix(color, fogCol, fogStr);
  }
`;

// ─────────────────────────────────────────────────────────────────────────────
// The full surface shading entry point used by every cel fragment shader.
// ─────────────────────────────────────────────────────────────────────────────
export const GLSL_CEL_SURFACE = /* glsl */ `
  struct CelInput {
    vec3  worldPos;
    vec3  normal;       // world space, normalised
    vec3  viewDir;      // world space, surface -> camera, normalised
    vec2  fragCoord;    // device pixels
    float viewDist;
    vec3  albedoTint;   // multiplied over the band colours (vertex colour, etc.)
    float aoTerm;       // 1 = open, 0 = occluded. Baked/vertex AO.
  };

  vec3 celShade(CelInput s) {
    vec3 N = s.normal;
    vec3 V = s.viewDir;
    vec3 L = uSunDir;

    // Half-Lambert widens the lit region so the terminator lands where a
    // background painter would put it, rather than on the exact 90° silhouette
    // edge. Real toon films cheat this constantly.
    float ndlRaw = dot(N, L);
    float ndl = ndlRaw * 0.5 + 0.5;
    ndl = ndl * ndl;                       // pull the terminator downhill a touch

    float shadow = sunShadow(s.worldPos, N, s.viewDist, saturate1(ndlRaw));
    // Shadowing pushes the shading term down a whole band rather than scaling
    // brightness — that keeps cast shadows on the same palette as form shadows.
    float lit = ndl * mix(0.42, 1.0, shadow);

    float bIdx = bandIndex(lit);
    vec3  col  = evalRamp(lit);

    // Ambient: cool sky from above, warm ground bounce from below. Applied as
    // a tint on the band colour, never as an additive lift — additive ambient
    // is what greys out a cel palette.
    float upness = N.y * 0.5 + 0.5;
    vec3 bounce = mix(uGroundBounce, uSkyBounce, upness);
    col = mix(col, col * bounce * 1.55, uAmbient * (1.0 - 0.55 * saturate1(bIdx / 3.0)));

    col *= s.albedoTint;

    // Occlusion darkens toward the shadow band colour, not toward black.
    col = mix(uBandColor[0] * 0.85, col, mix(0.55, 1.0, s.aoTerm));

    // Fake reflection. A matcap, sampled by the view-space normal — no probe,
    // no cubemap, no environment capture anywhere in this project.
    if (uMatcapMix > 0.001) {
      vec3 vn = normalize((viewMatrix * vec4(N, 0.0)).xyz);
      vec2 muv = vn.xy * 0.48 + 0.5;
      vec3 mc = texture(uMatcapMetal, muv).rgb;
      // Band the matcap too, or it smuggles a smooth gradient into the frame.
      mc = floor(mc * 4.0 + 0.35) / 4.0;
      col = mix(col, col * 0.35 + mc * 1.25, uMatcapMix * mix(0.35, 1.0, shadow));
    }

    // Hatch the shadow bands.
    col = applyHatch(col, bIdx, s.fragCoord, 1.0 - saturate1(bIdx / 3.0));

    // Banded specular — only in light.
    if (uSpecStrength > 0.001) {
      float spec = bandedSpecular(N, V, L, uSpecPower);
      col += uSpecColor * spec * uSpecStrength * shadow * saturate1(ndlRaw * 2.0);
    }

    // Fresnel rim. This is what keeps a rider readable against a dark tree line
    // at every camera angle — without it the silhouette dies the moment the
    // background value matches the jersey value.
    if (uRimStrength > 0.001) {
      float rim = celRim(N, V, uRimPower);
      // Bias the rim toward the sun side so it reads as a light wrap rather
      // than as a uniform glow outline.
      float sunSide = saturate1(dot(normalize(N + L * 0.35), V) * 0.5 + 0.75);
      col += uRimColor * rim * uRimStrength * mix(0.35, 1.0, sunSide);
    }

    // Per-instance tint (rider jersey colours, foliage variation).
    col = mix(col, col * uTint * 1.4, uTintStrength);

    return col;
  }
`;

// ─────────────────────────────────────────────────────────────────────────────
// Vertex-stage helpers: instancing, skinning, and the hull expansion.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Shared vertex preamble. Handles the four ways a vertex can get to world
 * space in this game: plain, instanced, skinned, and instanced-with-per-
 * instance-tint. Declared once so the hull pass and the main pass can never
 * disagree about where a vertex is — if they did, outlines would detach.
 */
export const GLSL_VERTEX_TRANSFORM = /* glsl */ `
  #ifdef USE_INSTANCING
    // three provides instanceMatrix.  We add our own per-instance channels.
    in vec3  aInstanceTint;
    in float aInstanceFade;   // 0..1 LOD fade — no popping, ever
    in float aInstancePhase;  // per-instance wind phase
  #endif

  #ifdef USE_SKINNING
    // three binds these automatically for any SkinnedMesh, regardless of the
    // material type, so a custom ShaderMaterial can skin without using the
    // built-in lighting path.
    uniform mat4 bindMatrix;
    uniform mat4 bindMatrixInverse;
    uniform highp sampler2D boneTexture;

    mat4 getBoneMatrix(const in float i) {
      int size = textureSize(boneTexture, 0).x;
      int j = int(i) * 4;
      int x = j % size;
      int y = j / size;
      vec4 v1 = texelFetch(boneTexture, ivec2(x + 0, y), 0);
      vec4 v2 = texelFetch(boneTexture, ivec2(x + 1, y), 0);
      vec4 v3 = texelFetch(boneTexture, ivec2(x + 2, y), 0);
      vec4 v4 = texelFetch(boneTexture, ivec2(x + 3, y), 0);
      return mat4(v1, v2, v3, v4);
    }
  #endif

  /** Object-space position and normal after skinning, before instancing. */
  void resolveLocal(inout vec3 pos, inout vec3 nrm) {
    #ifdef USE_SKINNING
      mat4 boneMatX = getBoneMatrix(skinIndex.x);
      mat4 boneMatY = getBoneMatrix(skinIndex.y);
      mat4 boneMatZ = getBoneMatrix(skinIndex.z);
      mat4 boneMatW = getBoneMatrix(skinIndex.w);

      mat4 skinMatrix = mat4(0.0);
      skinMatrix += skinWeight.x * boneMatX;
      skinMatrix += skinWeight.y * boneMatY;
      skinMatrix += skinWeight.z * boneMatZ;
      skinMatrix += skinWeight.w * boneMatW;
      skinMatrix = bindMatrixInverse * skinMatrix * bindMatrix;

      pos = (skinMatrix * vec4(pos, 1.0)).xyz;
      nrm = normalize((skinMatrix * vec4(nrm, 0.0)).xyz);
    #endif
  }

  /** Local -> world, applying the instance matrix when present. */
  void toWorld(vec3 localPos, vec3 localNrm, out vec3 wpos, out vec3 wnrm) {
    #ifdef USE_INSTANCING
      mat4 m = modelMatrix * instanceMatrix;
      wpos = (m * vec4(localPos, 1.0)).xyz;
      // Instance matrices here are always uniform-scaled rotations, so the
      // 3x3 upper block transforms normals correctly without an inverse.
      wnrm = normalize(mat3(m) * localNrm);
    #else
      wpos = (modelMatrix * vec4(localPos, 1.0)).xyz;
      wnrm = normalize(mat3(modelMatrix) * localNrm);
    #endif
  }
`;

/**
 * Inverted-hull outline vertex program.
 *
 * Three things separate this from the usual "push along the normal" one-liner:
 *
 *  1. SMOOTHED normals. Hard-edged geometry (a box, a rock facet) has split
 *     normals at every edge, and pushing along those tears the hull open at
 *     every corner. Every outlined mesh in this game carries a second
 *     attribute, `aSmoothNormal`, computed by welding positions and averaging
 *     — see OutlineGeometry.ts. That is why the outlines here don't have the
 *     gaps you see on browser toon shaders.
 *
 *  2. CONSTANT SCREEN WIDTH. The push is scaled by view distance and by the
 *     projection so a 2.1-pixel stroke stays 2.1 pixels at 3m and at 300m.
 *
 *  3. VARIABLE WEIGHT. The stroke thickens where surface curvature is high and
 *     thins where the surface is flat, then thins again with distance. That
 *     taper is the whole difference between "toon shader" and "drawn". A
 *     uniform-width outline reads as a technical effect; a stroke that swells
 *     into a shoulder and tapers off a forearm reads as a pen.
 */
export const GLSL_HULL_VERTEX = /* glsl */ `
  uniform float uOutlineWidth;     // world units at the reference distance
  uniform float uTargetPixels;
  uniform float uFalloffStart;
  uniform float uFalloffEnd;
  uniform float uMinWidthScale;
  uniform float uCurvatureWeight;
  uniform float uCurvatureFloor;
  uniform float uWidthJitter;      // hand-drawn wobble along the stroke

  in vec3  aSmoothNormal;
  in float aCurvature;             // 0 = flat, 1 = tight crease

  out float vHullFade;

  vec3 hullOffset(vec3 wpos, vec3 wnrmSmooth, float curvature, float viewDist) {
    // Base width so the stroke covers uTargetPixels at this distance.
    // projectionMatrix[1][1] = 1/tan(fovY/2); the ratio converts a screen
    // fraction into a world-space length at viewDist.
    float pxToWorld = (2.0 * viewDist) / (uResolution.y * projectionMatrix[1][1]);
    float w = uTargetPixels * pxToWorld * uOutlineWidth;

    // Distance taper: far strokes thin out so a distant tree line doesn't
    // clog into a solid black mass.
    float dt = smoothstep(uFalloffStart, uFalloffEnd, viewDist);
    w *= mix(1.0, uMinWidthScale, dt);

    // Curvature weight: swell on creases, taper on flats.
    float curv = smoothstep(uCurvatureFloor, 1.0, curvature);
    w *= mix(1.0 - uCurvatureWeight * 0.55, 1.0 + uCurvatureWeight * 0.85, curv);

    // Hand-drawn wobble — a slow, low-amplitude variation along the stroke so
    // the line has the slight breathing of a brush rather than the perfect
    // consistency of a machine. Kept under ~8% or it reads as a bug.
    if (uWidthJitter > 0.001) {
      float n = fbm2(wpos.xz * 2.3 + wpos.y * 1.7, 2);
      w *= 1.0 + (n - 0.5) * uWidthJitter;
    }

    return wnrmSmooth * w;
  }
`;

// ─────────────────────────────────────────────────────────────────────────────
// G-buffer prepass outputs. Two RGBA16F attachments.
// ─────────────────────────────────────────────────────────────────────────────
export const GLSL_PREPASS_OUTPUTS = /* glsl */ `
  // Under GLSL3 three declares no fragment outputs at all, so both MRT
  // attachments are ours to name.
  layout(location = 0) out vec4 fragColor;
  layout(location = 1) out vec4 gAux;

  // 0: rgb = view-space normal, a = linear view depth in metres
  // 1: r = material id, g = curvature, b = stylisation mask, a = unused
`;

/** Speed-line, radial-blur and impact-flash helpers used by the post stack. */
export const GLSL_POST_HELPERS = /* glsl */ `
  /**
   * Radial anime speed lines, drawn in polar space around a focus point.
   *
   * These are not motion blur. They are the drawn convention: hard-edged
   * tapered wedges radiating from the vanishing point, dense at the frame edge
   * and absent in the centre so the subject stays readable. Line count, taper
   * and inner radius all ramp with speed, and the whole field rotates very
   * slowly so it never looks like a static overlay.
   */
  float speedLines(vec2 uv, vec2 focus, float intensity, float time, float aspect) {
    if (intensity <= 0.001) return 0.0;

    vec2 d = (uv - focus) * vec2(aspect, 1.0);
    float r = length(d);
    float a = atan(d.y, d.x);

    // More lines as you go faster, but quantised so they don't crawl.
    float count = mix(46.0, 116.0, intensity);
    count = floor(count / 6.0) * 6.0;

    float slot = a / TAU * count;
    float id = floor(slot);
    float f = fract(slot);

    // Per-line randomised width, length and phase.
    vec2 rnd = hash22(vec2(id, 3.7));
    float width = mix(0.10, 0.34, rnd.x) * mix(1.35, 0.75, intensity);
    float inner = mix(0.30, 0.16, intensity) * mix(0.8, 1.35, rnd.y);
    float outer = 0.95;

    // Slow rotation so the field breathes.
    float wobble = sin(time * 0.7 + id * 2.1) * 0.012;

    // Tapered wedge: hard edges, soft only at the very tip.
    float across = 1.0 - smoothstep(width * 0.5 - 0.06, width * 0.5, abs(f - 0.5 + wobble));
    float along  = smoothstep(inner, inner + 0.16, r) * (1.0 - smoothstep(outer, outer + 0.35, r));

    // Taper the stroke toward the centre — this is what makes them read as
    // brush strokes rather than as a starburst gradient.
    float taper = smoothstep(inner, outer, r);

    return across * along * mix(0.35, 1.0, taper) * intensity;
  }

  /** Hard-threshold bloom prefilter. Graphic, not photographic. */
  vec3 bloomPrefilter(vec3 c, float threshold, float knee) {
    float br = max(max(c.r, c.g), c.b);
    float soft = clamp(br - threshold + knee, 0.0, 2.0 * knee);
    soft = soft * soft / (4.0 * knee + EPS);
    float contrib = max(soft, br - threshold) / max(br, EPS);
    return c * contrib;
  }
`;
