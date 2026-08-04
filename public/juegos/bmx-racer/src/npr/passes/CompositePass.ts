/**
 * CompositePass — the last thing that happens to the frame.
 *
 * Order is the entire content of this file, and it is not negotiable:
 *
 *   1. lens        chromatic aberration + radial blur, on the captured image
 *   2. bloom       added in LINEAR light, where adding light belongs
 *   3. ink         the interior line field, painted OVER the bloom
 *   4. speed lines painted, not added — they are strokes, not exposure
 *   5. shoulder    the only highlight compression in the whole pipeline
 *   6. sRGB encode
 *   7. LUT         the grade, in display space, where its constants live
 *   8. ink flood   a wash toward the ink colour, for crashes
 *   9. impact flash an additive, keyed accent — never a repaint
 *  10. desaturate
 *  11. vignette
 *  12. grain
 *
 * Step 3 is the one that is easy to get wrong. If the ink is applied to the
 * HDR image before bloom, the bloom halo from a hot band next to a line spills
 * ACROSS the line and softens it — a glowing, out-of-focus outline, which is
 * the exact opposite of ink. Ink goes on top. An animator inks last.
 *
 * Step 7 is the second. The renderer does no tone mapping, and the grade
 * constants in Palette.GRADE (a 0.46 contrast pivot, a 0.012 lift) are
 * display-referred numbers. Applying them to linear radiance would put the
 * pivot at 71% sRGB and lift the black point by a third of a stop.
 */

import {
  Color,
  IUniform,
  RepeatWrapping,
  Texture,
  Vector2,
  WebGLRenderer,
  WebGLRenderTarget,
} from 'three';
import { GLSL_COMMON, GLSL_FRAG_OUT, GLSL_POST_HELPERS } from '../ShaderChunks';
import { GLSL_GRADE, gradeLutTexture } from '../LUT';
import { paperGrain } from '../GeneratedTextures';
import { GRADE, HUD_PALETTE, INK } from '../Palette';
import { POST_STATE } from '../NprGlobals';
import { FullscreenPass } from './Fullscreen';

export const COMPOSITE_DEBUG = {
  off: 0,
  ink: 1,
  bloom: 2,
  ungraded: 3,
} as const;

const FRAGMENT = /* glsl */ `
  precision highp float;
  ${GLSL_COMMON}
  ${GLSL_POST_HELPERS}
  ${GLSL_GRADE}
  ${GLSL_FRAG_OUT}

  uniform sampler2D uScene;
  uniform sampler2D uBloom;
  uniform sampler2D uInk;

  uniform vec2  uResolution;
  uniform float uTime;

  uniform float uBloomIntensity;
  uniform float uLineOpacity;

  uniform float uSpeedIntensity;
  uniform vec2  uSpeedFocus;
  uniform vec3  uSpeedColor;

  uniform float uChroma;
  uniform float uRadialBlur;

  uniform float uImpactFlash;
  uniform vec3  uImpactTint;
  uniform float uInkFlood;
  uniform vec3  uInkColor;
  uniform float uDesaturate;

  uniform float uTonePost;
  uniform float uToneSteps;

  uniform float uDebug;

  in vec2 vUv;

  void main() {
    vec2 uv = vUv;
    float aspect = uResolution.x / max(uResolution.y, 1.0);

    // ── 1. Lens ─────────────────────────────────────────────────────────────
    vec3 col;
    if (uChroma > 0.0005) {
      // Radial split, not a fixed XY offset: a lens disperses outward from the
      // optical centre, and a fixed offset reads as a broken screenshot.
      vec2 d = (uv - 0.5) * uChroma * 0.010;
      col.r = texture(uScene, uv + d).r;
      col.g = texture(uScene, uv).g;
      col.b = texture(uScene, uv - d).b;
    } else {
      col = texture(uScene, uv).rgb;
    }

    if (uRadialBlur > 0.0005) {
      // ── SMEAR FRAMES, NOT A BLUR ──────────────────────────────────────────
      //
      // This was six evenly spaced taps averaged with equal weight — a box
      // blur along the radius. It is worth being precise about what that does
      // to this particular picture, because it was the single most
      // wide-reaching cause of the stills critic's "zero steps above 4 across
      // 750 pixels", and it is invisible in a screenshot of the effect alone.
      //
      // A box blur does not add a gradient. It DELETES EVERY EDGE IT CROSSES.
      // Six equal taps spread over a 15-pixel radial span turn one hard cel
      // boundary — the whole point of the renderer — into six sub-two-unit
      // substeps three pixels apart, which is exactly a smooth ramp as far as
      // any measurement or any eye is concerned. On ravine-gap at y = 1000,
      // x 2400..3150, the terrain underneath genuinely carries steps of 9.9
      // luminance units; through this filter the largest step anywhere in that
      // 751-pixel run measured 1.07. The picture is quantised and then blurred
      // back into a photograph in the last pass.
      //
      // Animation does not blur a fast object, it draws it several times. So
      // this is now THREE DISCRETE GHOSTS at decreasing opacity, composited by
      // mix() rather than averaged: every ghost is a full hard-edged copy of
      // the frame, so a cel boundary that was one 40-unit step becomes three
      // steps of 12, 7 and 21 units instead of a six-tap staircase. Same
      // radial displacement, same read of speed, and the frame stays drawn.
      //
      // The offsets are unequal (0.42 / 1.0) so the ghosts do not stack into
      // an evenly-spaced comb, which reads as a repeat rather than as motion.
      vec2 toFocus = (uSpeedFocus - uv) * uRadialBlur * 0.22;
      vec3 g1 = texture(uScene, uv + toFocus * 0.42).rgb;
      vec3 g2 = texture(uScene, uv + toFocus).rgb;
      col = mix(col, g1, 0.30);
      col = mix(col, g2, 0.18);
    }

    // ── 2. Bloom, in linear light ───────────────────────────────────────────
    col += texture(uBloom, uv).rgb * uBloomIntensity;

    // ── 3. Interior ink, over the bloom ─────────────────────────────────────
    vec4 ink = texture(uInk, uv);
    col = mix(col, srgbToLinear(ink.rgb), saturate1(ink.a * uLineOpacity));

    // ── 4. Speed lines ──────────────────────────────────────────────────────
    if (uSpeedIntensity > 0.001) {
      float sl = speedLines(uv, uSpeedFocus, uSpeedIntensity, uTime, aspect);

      // ── QUANTISE THE SHAPE. SCALE THE STRENGTH. THEY ARE NOT THE SAME AXIS. ─
      //
      // The critic's "broad radial spokes from screen centre laid continuously
      // across the slopes, the only smooth ramps left and the widest thing in
      // frame" measures THIS, and not the sky shafts. That was verified rather
      // than assumed, and the verification is worth writing down because the
      // first attempt at it was wrong in a way that is easy to repeat:
      // PostPipeline.render() calls composite.syncState() immediately before it
      // draws, and syncState reloads EVERY uniform in this file out of
      // POST_STATE. An A/B that writes uSpeedIntensity = 0 and then renders
      // therefore measures nothing at all. tools/capture/_ab.mjs now installs
      // its override on syncState itself; with that in place, zeroing the speed
      // field moves 10.8% of treeline-silhouette at a mean delta of 33/255 and
      // takes every spoke in the frame with it, while the sky shaft fan is at
      // intensity 0.000 in that pose and contributes nothing.
      //
      // The helper's own radial profile (ShaderChunks.GLSL_POST_HELPERS, not
      // ours to edit) is two multiplied ramps:
      //
      //     along = smoothstep(inner, inner + 0.16, r) * ...
      //     taper = smoothstep(inner, outer, r)          // inner ~0.2, outer 0.95
      //
      // — a gradient running three quarters of the way across the frame, in a
      // picture where the terrain, the sky, the clouds and the bloom are all
      // quantised. We cannot change the helper, but it returns a SCALAR, and a
      // scalar can be posterised into three flat wedges with one-pixel cuts.
      //
      // NORMALISING THE SHAPE IS CORRECT. DIVIDING OUT THE STRENGTH IS NOT.
      // Dividing sl by the intensity to get a 0..1 shape is the right move —
      // the quantisation thresholds then mean the same thing at every speed.
      // But the intensity has to be MULTIPLIED BACK IN afterwards, and the
      // previous pass never did: stroke * clear * 0.50 is independent of
      // uSpeedIntensity, so a rider coasting at 47 km/h with intensity 0.073
      // got exactly the same 50% wash of paper white as one at full boost.
      // That is a twelvefold overdraw at the speeds these poses are captured
      // at, and it is the whole of what the critic is looking at: strokes that
      // should have been a whisper laid across the slopes at full strength.
      // ── QUANTISE THE WHOLE FIELD, INCLUDING THE CENTRE CLEAR ───────────────
      //
      // The previous pass quantised slq into three flat values and then
      // MULTIPLIED THE RESULT by a smoothstep. That smoothstep is the defect.
      //
      //     clear = smoothstep(0.38, 0.76, length((uv - focus) * (aspect, 1)))
      //
      // Read it in device pixels. The argument is a radius in x-units, so on a
      // 3200 x 1800 frame the ramp runs from 684 px to 1367 px from the focus:
      // a SIX-HUNDRED-AND-EIGHTY-THREE PIXEL CONTINUOUS RAMP multiplying the
      // brightest thing painted on the frame. Three flat values times a smooth
      // envelope is a smooth envelope.
      //
      // MEASURED. tools/capture/_ab.mjs and _skyab.mjs install their override
      // on syncState (writing a uniform and rendering measures nothing —
      // PostPipeline.render calls syncState immediately before it draws, and
      // syncState reloads every uniform out of POST_STATE). On ravine-gap the
      // stills critic's trace at y = 900, x 2100..3150 carried 68.7 luminance
      // units at a maximum single-pixel step of 3.93 and not one step above 4
      // in 1051 pixels. Forcing uSpeedIntensity to 0 took it to 27.8 units and
      // took every visible band with it. The sky shaft fan, which the critic
      // suspected, measured uIntensity = 0.0000 in that pose and in every other
      // still pose in the review set — it contributed nothing at all.
      //
      // The fix is one line of restructuring: the centre clear is folded into
      // the shape BEFORE the posterise, so there is exactly ONE scalar and it
      // is quantised exactly ONCE. The stroke can now only take the four values
      // 0, 0.34, 0.64 and 1.0, and the radial envelope decides where those
      // boundaries fall rather than scaling them. The strokes come out cut into
      // hard radial segments — the same language as the sun shafts in Sky.ts,
      // which is what they are supposed to rhyme with.
      float slq = saturate1(sl / max(uSpeedIntensity, 1e-3));

      // ── HOLD THEM OFF THE SUBJECT ───────────────────────────────────────────
      // The helper's own header promises strokes that are "absent in the centre
      // so the subject stays readable", and at low intensity it delivers that.
      // At high intensity it does not: its inner radius ramps down to 0.16,
      // which on a 16:9 frame is a fifth of the way to the side edge — the
      // strokes start on top of the riders. That is the pale wash lying across
      // both riders and the whole lower frame in scree-speed and ravine-gap.
      //
      // A speed line exists to make the frame move AROUND the subject. One
      // drawn over the subject deletes the thing it is supposed to be
      // accelerating, so the centre is cleared here unconditionally.
      vec2 fd = (uv - uSpeedFocus) * vec2(aspect, 1.0);
      float shape = slq * smoothstep(0.38, 0.76, length(fd));

      float qw = max(fwidth(shape) * 0.8, 0.005);
      float q1 = smoothstep(0.10 - qw, 0.10 + qw, shape);
      float q2 = smoothstep(0.34 - qw, 0.34 + qw, shape);
      float q3 = smoothstep(0.64 - qw, 0.64 + qw, shape);
      float stroke = 0.34 * q1 + 0.30 * q2 + 0.36 * q3;

      // A DRAWN EDGE on the outermost cut. Three flat values butted together
      // read as banding; the same three with a line down the join read as a
      // brush stroke that someone put an edge on. One pixel wide, taken on the
      // quantised field so it is a screen pixel wherever the boundary lands.
      float ew = max(fwidth(shape) * 0.8, 0.004);
      float rim =
          smoothstep(0.10 - ew, 0.10 + ew, shape)
        * (1.0 - smoothstep(0.10 + ew, 0.10 + ew * 3.0, shape));

      // ── AND NOTHING BELOW A SPEED WORTH DRAWING ────────────────────────────
      // A per-frame scalar, uniform over every pixel, so it cannot put a
      // gradient anywhere — it only decides whether the effect exists at all.
      // At bike-detail's 8 m/s the field was painting a 2% wash whose only
      // visible product was two dead-level dashed hairlines across clean blue
      // sky at native y 405 and y 530 (confirmed by A/B: they vanish with
      // uSpeedIntensity forced to 0, and they are strokes, not clouds). A
      // stroke too faint to read as a stroke is dirt on the lens.
      float live = smoothstep(0.035, 0.075, uSpeedIntensity);

      // Painted, not added. A speed line in animation is a stroke of paint at
      // a flat value; adding light instead gives a glow that blows out the sky
      // and leaves nothing over dark trees.
      //
      // The paint colour is HUD_PALETTE.paper, applied in LINEAR light and then
      // encoded, so the coefficient is close to "fraction of the way to a white
      // frame" and has to be read that way. 0.62 * intensity puts a coasting
      // 47 km/h at 4.5%, the 72 km/h finish sprint at 21%, and only a boost at
      // full chat anywhere near half. The strokes are still hard-edged at every
      // one of those values — what changes with speed is how many of them you
      // can see, which is the correct axis.
      float paint = stroke * uSpeedIntensity * live * 0.62;
      float edge  = rim * uSpeedIntensity * live * 0.85;
      col = mix(col, uSpeedColor, saturate1(paint + edge));
    }

    if (uDebug > 2.5 && uDebug < 3.5) { fragColor = vec4(linearToSrgb(col), 1.0); return; }
    if (uDebug > 0.5 && uDebug < 1.5) { fragColor = vec4(vec3(ink.a), 1.0); return; }
    if (uDebug > 1.5 && uDebug < 2.5) {
      fragColor = vec4(linearToSrgb(texture(uBloom, uv).rgb), 1.0);
      return;
    }

    // ── 5-6. Shoulder and encode ────────────────────────────────────────────
    vec3 disp = linearToSrgb(displayShoulder(max(col, vec3(0.0))));

    // ── 7. Grade ────────────────────────────────────────────────────────────
    disp = applyGradeLut(disp);

    // ── 8. Ink flood ────────────────────────────────────────────────────────
    if (uInkFlood > 0.001) {
      // Ink washing in from the frame edge — and ONLY from the frame edge.
      //
      // This used to start at 0.42 of full strength in the very centre of the
      // frame and rise from there, so at the peak of a crash it laid an even
      // 12% wash of near-black violet over the rider, the bike and the sky at
      // the same moment the flash was lifting them. That even component is
      // half of what the motion critic measured as a "full-screen desaturating
      // wash": nothing about it is local, so nothing about it reads as drawn.
      //
      // It is now zero out to a fifth of the frame and quantised into two hard
      // rings on the way out, which is a drawn border closing on the shot
      // rather than a photographic vignette darkening it. The subject is never
      // touched, on any frame, at any flood value.
      //
      // AND IT IS HALF THE WEIGHT IT WAS. tools/capture/_impactmax.mjs forces
      // each dial to the ceiling IMPACT_TUNING can publish and measures the
      // frame against itself with the dial at zero. At the previous weights the
      // ink flood ALONE took 18.3% of finish-sprint's chroma and 21.8% of the
      // sky's, at a mean luma of -14.7% — which is a photographic darkening of
      // the whole outer frame however hard its rings are. The peak is now 0.255
      // instead of 0.52: enough for a drawn border to close on the shot, not
      // enough to be the reason the picture lost its colour.
      vec2 d = (uv - 0.5) * vec2(aspect, 1.0);
      float r = saturate1(length(d) * 1.35);
      float rw = max(fwidth(r) * 0.8, 0.006);
      float ring1 = smoothstep(0.50 - rw, 0.50 + rw, r);
      float ring2 = smoothstep(0.76 - rw, 0.76 + rw, r);
      float flood = saturate1(uInkFlood * (0.30 * ring1 + 0.55 * ring2));
      float keep = smoothstep(0.70, 0.96, luma(disp)) * 0.80;
      disp = mix(disp, linearToSrgb(uInkColor), flood * (1.0 - keep));
    }

    // ── 9. Impact flash ─────────────────────────────────────────────────────
    if (uImpactFlash > 0.001) {
      // WHAT THIS USED TO DO, AND WHY IT WAS WRONG.
      //
      // It collapsed the frame to two values on a luma threshold and then
      // mix()ed toward that at the full flash amount. At f = 1 — which is
      // exactly what a landing produces — nothing of the original image
      // survived: the sky, which sits above the threshold, was repainted flat
      // white; the terrain, below it, was repainted flat ink; the riders were
      // reduced to whatever line work happened to straddle 0.36. Four
      // consecutive frames of the landing capture render as a posterised
      // NEGATIVE of the shot at 100% of frame area. An impact frame in
      // animation is a held DRAWING of the same composition — it is never the
      // deletion of the composition.
      //
      // WHAT IT DOES NOW. A purely ADDITIVE accent, keyed into the parts of the
      // frame that are already bright, plus a small contrast punch. Additive
      // cannot remove anything: the sky stays sky, the riders stay riders, the
      // silhouette reading of the shot is intact on every frame of the hit, and
      // what you feel is a hard bloom of light rather than a channel flip.
      // AND WHY IT WAS STILL WRONG. "Additive" was necessary and not
      // sufficient. tools/capture/_impactmax.mjs forces uImpactFlash to the
      // 0.34 ceiling IMPACT_TUNING publishes and measures the frame against
      // itself unflashed. The additive form measured, on finish-sprint:
      //
      //     mean chroma  -24.3%     sky chroma  -23.9%
      //     mean luma    +20.1%     luma spread +15.4%
      //
      // The spread going up is right. Losing a quarter of the frame's chroma,
      // and a quarter of the SKY's, is exactly the "the blue sky band, cloud
      // shapes, tree greens and jersey colours are all gone" the motion critic
      // measured, and it is a structural property of adding light rather than a
      // matter of amplitude: every channel moves toward the tint by the same
      // absolute amount, and every channel that is already near 1.0 — which in
      // this palette means the whole sky — clips against the ceiling instead.
      // Adding light to a bright picture IS desaturating it.
      //
      // WHAT IT DOES NOW: the punch comes from CONTRAST ABOUT THE FRAME'S OWN
      // PIVOT, which is the one operator here that moves chroma UP rather than
      // down. Pushing every channel away from 0.46 pulls the channels of a
      // pixel APART, so a blue sky gets bluer and a red jersey gets redder at
      // the same moment the frame snaps to a hard graphic read. The tint is
      // then added only as a small core in the top luminance band, where an
      // animator would put the hot spot, at a seventh of its previous weight.
      float f = saturate1(uImpactFlash);
      vec3 hi = linearToSrgb(uImpactTint);
      float l = luma(disp);

      // Keyed in HARD STEPS, for the tinted core below. Stepping the key rather
      // than ramping it keeps the accent inside the same quantised language as
      // everything else in the frame — a smooth key over a banded picture reads
      // as an exposure change rather than as a drawing.
      float kw = max(fwidth(l) * 0.8, 0.02);
      float k1 = smoothstep(0.30 - kw, 0.30 + kw, l);
      float k2 = smoothstep(0.62 - kw, 0.62 + kw, l);

      // 1. THE PUNCH. Gain scales with f, so at f = 0 this is the identity and
      //    there is no discontinuity when the accent fires or clears.
      vec3 hard = clamp((disp - 0.46) * (1.0 + f * 1.70) + 0.46, 0.0, 1.0);
      disp = mix(disp, hard, 0.88);

      // 2. THE HOT CORE. Small, and biased hard into the top band so it lands
      //    on the sunlit edges and the highlights rather than on the sky field.
      disp += hi * f * (0.06 + 0.16 * k1 + 0.30 * k2) * 0.42;
    }

    // ── 10-12. Tail ─────────────────────────────────────────────────────────
    if (uDesaturate > 0.001) {
      // TOWARD A TINTED MONOCHROME, AND NEVER OVER THE SUBJECT.
      //
      // mix(disp, vec3(luma(disp)), d) applied to the whole frame is a
      // photographic desaturation: at the crash peak it took 18% of the
      // picture's chroma out uniformly, sky and jersey and tree greens
      // together, which is the other half of what the critic measured as a
      // full-screen wash. Two changes, both of which keep the effect and lose
      // the wash.
      //
      // First, the target is the impact tint's own hue at the pixel's
      // luminance, not neutral grey — a warm monochrome cel, which is the
      // convention the effect was reaching for. Second, it is held off the
      // middle of the frame, so the rider and the bike keep their colour on
      // every single frame of a hit and the composition stays readable
      // throughout, which is the requirement.
      //
      // AND THIRD, IT IS NOW CONFINED TO THE SHADOWS. _impactmax measured this
      // term alone at -9.6% mean chroma and -9.9% SKY chroma at the 0.16
      // ceiling, and the sky number is the damning one: a wash that reaches the
      // sky is a wash, however gently it is applied. Pulling shadows toward a
      // warm monochrome is a cel convention; pulling a lit blue sky toward one
      // is a photographic desaturation. The cut is quantised on the same
      // one-pixel fwidth rule the rest of the frame uses, so the boundary is a
      // drawn edge rather than a ramp.
      vec3 tint = linearToSrgb(uImpactTint);
      float tl = max(luma(tint), 1e-3);
      float lm = luma(disp);
      vec3 mono = vec3(lm) * mix(vec3(1.0), tint / tl, 0.75);
      vec2 dd = (uv - 0.5) * vec2(aspect, 1.0);
      float hold = 1.0 - smoothstep(0.16, 0.50, length(dd));
      float dw = max(fwidth(lm) * 0.8, 0.02);
      float darks = 1.0 - smoothstep(0.44 - dw, 0.44 + dw, lm);
      disp = mix(disp, mono, saturate1(uDesaturate) * (1.0 - hold * 0.85) * darks);
    }
    disp = applyVignette(disp, uv, aspect);

    // ── 11.5 TONE QUANTISE — THE LAST THING THAT CAN MAKE THE FRAME DRAWN ────
    //
    // WHAT THE MEASUREMENT ACTUALLY SAID, AFTER THREE WRONG OWNERS.
    //
    // The stills critic has reported the same defect four times: the widest
    // thing in the picture is a smooth ramp. It was blamed on the sun shafts,
    // then on this file's speed field, then on the vignette. All three were
    // A/B tested through tools/capture/_ab.mjs (the override has to be
    // installed ON syncState — see the speed-line note above) and the answer on
    // the critic's own trace, ravine-gap y = 1000, x 2400..3150, is:
    //
    //     base            span 23.1 units, maxstep 4.22, ONE step above 4 / 749
    //     speed field 0   BYTE-IDENTICAL
    //     shaft fan hidden BYTE-IDENTICAL   (its uIntensity is 0.0000 there)
    //     bloom 0         BYTE-IDENTICAL
    //     ink 0           BYTE-IDENTICAL
    //     vignette 0      span 23.0, maxstep 4.22
    //
    // Nothing in the composite owns it. The ramp IS THE SCENE: a cliff face
    // whose cel bands are correct but whose lit plateau curves smoothly away
    // across a thousand pixels. A frame-wide sweep (longest run of pixels with
    // no single-pixel step above 4) finds the same thing everywhere the terrain
    // is large and smooth — ravine-gap y = 1180 carries 104 luminance units
    // across 1005 unbroken pixels, rockgarden-low y = 908 carries 109 across
    // 707. It is not one effect. It is every large surface in the game.
    //
    // WHICH IS WHY IT BELONGS HERE. The composite is the only place that sees
    // the finished picture, and a cel frame is defined by its TONE COMING FROM A
    // DISCRETE SET. Every upstream pass quantises its own field and then the
    // union of them is continuous again, because a curved surface slides
    // smoothly along a single plateau. One quantisation of the final luminance
    // fixes all of them at once, and it is the only fix that reaches a smooth
    // ramp whoever drew it.
    //
    // THREE PROPERTIES MAKE IT A DRAWING RATHER THAN POSTERISATION.
    //
    //  1. IT CANNOT TOUCH AN EDGE. rate = fwidth(t) is how many tone steps the
    //     picture crosses per pixel. An ink line, a cel terminator or a
    //     silhouette crosses several steps in one pixel; the ramp we are after
    //     crosses 0.0026. Above 0.34 steps/pixel the snap is faded out entirely,
    //     so line work, antialiasing and texture are returned untouched and only
    //     regions flat enough to hold a plateau are quantised.
    //  2. IT MOVES THE TRIPLET, NOT THE CHANNELS. The snapped luminance is
    //     applied as a SCALE. Uniform scaling preserves hue exactly and HSV
    //     saturation exactly — (max-min)/max is invariant — so a graded dawn
    //     cream stays that cream and only its value steps. Snapping channels
    //     independently would rotate every colour in the frame toward a corner
    //     of the RGB cube, which is the classic posterise look and the opposite
    //     of this palette.
    //  3. IT IS THE IDENTITY ON A FLAT FIELD, AT ANY VALUE. The map below is
    //     continuous and passes through the input exactly at the centre of each
    //     plateau AND at each plateau join, so a region that is already flat
    //     comes out flat and a region that is already stepped comes out
    //     unchanged. Nothing can mottle: there is no threshold for a dither to
    //     straddle, because the operator has no threshold — it has a riser, and
    //     the riser is where the picture is already moving.
    //
    //  4. THE RISER WANDERS, AND ONLY WHERE THERE IS A RAMP TO WANDER ON.
    //     A riser on a fixed threshold lies on an exact iso-luminance curve of
    //     the picture, and on this cliff that curve runs at FIVE DEGREES to the
    //     horizontal: the measured tone rate at ravine-gap (2700, 1000) is
    //     0.0028 steps per pixel across and 0.032 down, so the contour is very
    //     nearly level. Two consequences, and the second is the one that took a
    //     build to find. Visually a dead-level boundary a thousand pixels long
    //     is the same defect as the sky's letterbox bar. Numerically, a one-pixel
    //     cut crossed at five degrees is spread over eleven pixels by geometry
    //     alone, so the critic's horizontal trace can never see it as a step
    //     however hard the cut is — the first two builds measured maxstep 6.4
    //     for exactly this reason and nothing was wrong with the cut.
    //
    //     So the riser carries a low-frequency displacement of +/-0.32 of a step.
    //     On a ramp this shallow that moves the boundary by of the order of a
    //     hundred pixels, which tips it well off the horizontal and makes it an
    //     edge someone drew rather than a contour of a smooth field.
    //
    //     IT IS GATED ON THE PICTURE ALREADY RAMPING. Displacing a riser moves
    //     the staircase even where the picture does not move, so an ungated
    //     wander paints its own noise field into any flat plateau whose value
    //     happens to sit near a cut — a full ten-unit step, in blobs, across a
    //     clean sky. Both the wander and the snap itself are therefore faded in
    //     over the picture's own tone rate: below about 0.011 luminance units
    //     per pixel nothing happens at all, so every flat authored colour in the
    //     frame comes out of this block bit-identical.
    //
    // Grain is applied AFTER, on purpose: paper tooth belongs on top of the
    // drawing, and it also keeps the risers from being suspiciously clean.
    if (uTonePost > 0.001) {
      float l = luma(disp);
      float t = l * uToneSteps;
      float rate0 = fwidth(t);
      float snapAmt = uTonePost
        * smoothstep(0.0010, 0.0045, rate0)
        * (1.0 - smoothstep(0.55, 1.40, rate0));
      if (snapAmt > 0.003) {
        vec2 wp = uv * vec2(aspect, 1.0);
        float wob = clamp((fbm2(wp * 5.0 + 4.7, 3) - 0.5) * 2.0, -0.32, 0.32)
                  * smoothstep(0.0016, 0.0090, rate0);
        float u = t + wob;
        float rate = fwidth(u);
        float fl = floor(u);
        float fr = u - fl;
        // THE RISER IS ONE PIXEL WIDE, AND THAT IS THE WHOLE EFFECT.
        //
        // rate is how much of a step the picture crosses per pixel, so
        // rate * 0.9 is the standard one-pixel fwidth cut this project uses
        // everywhere. The first build of this block floored w at 0.030 out of
        // caution about dither, and on the shallow ramp it exists to fix — 0.0026
        // steps per pixel — that floor spread each riser over 0.06 / 0.0026 = 23
        // PIXELS. A 10.6-unit step delivered over 23 pixels is a 0.46-unit step,
        // i.e. exactly the smooth ramp again. Measured: maxstep 6.6 with the wide
        // floor against 4.2 with the block off, where the step is 10.6 by
        // construction. The floor is now only large enough to keep the smoothstep
        // non-degenerate, and the ceiling of 0.5 is what makes a steep region
        // resolve back to the identity instead of being posterised.
        float w = clamp(rate * 0.9, 0.0015, 0.50);
        float snapped = (fl + smoothstep(0.5 - w, 0.5 + w, fr)) / uToneSteps;
        float k = clamp(snapped / max(l, 0.004), 0.55, 1.75);
        disp = mix(disp, clamp(disp * k, 0.0, 1.0), snapAmt);
      }
      // 4 = how much of the frame the quantiser is allowed to touch,
      // 5 = rate, the tone steps crossed per pixel, on a log scale.
      // Both exist because the first two builds of this block were debugged by
      // reading traces off the finished frame, which cannot distinguish "the
      // snap did not fire" from "the snap fired and the contour is oblique".
      if (uDebug > 3.5 && uDebug < 4.5) { fragColor = vec4(vec3(snapAmt), 1.0); return; }
      if (uDebug > 4.5 && uDebug < 5.5) {
        fragColor = vec4(vec3(saturate1((log2(max(rate0, 1e-6)) + 12.0) / 13.0)), 1.0);
        return;
      }
    }

    disp = applyGrain(disp, gl_FragCoord.xy);

    fragColor = vec4(clamp(disp, 0.0, 1.0), 1.0);
  }
`;

export class CompositePass {
  private pass: FullscreenPass;
  readonly uniforms: Record<string, IUniform>;

  constructor(width: number, height: number) {
    const grain = paperGrain();
    grain.wrapS = grain.wrapT = RepeatWrapping;
    const lut = gradeLutTexture();

    this.uniforms = {
      uScene: { value: null },
      uBloom: { value: null },
      uInk: { value: null },
      uResolution: { value: new Vector2(width, height) },
      uTime: { value: 0 },
      uBloomIntensity: { value: GRADE.bloomIntensity },
      uLineOpacity: { value: 1 },
      uSpeedIntensity: { value: 0 },
      uSpeedFocus: { value: new Vector2(0.5, 0.52) },
      uSpeedColor: { value: new Color().copy(HUD_PALETTE.paper) },
      uChroma: { value: 0 },
      uRadialBlur: { value: 0 },
      uImpactFlash: { value: 0 },
      uImpactTint: { value: new Color(1, 1, 1) },
      uInkFlood: { value: 0 },
      uInkColor: { value: new Color().copy(INK) },
      uDesaturate: { value: 0 },
      /**
       * Tone quantise. NOT driven from POST_STATE — syncState() must never
       * touch it, because it is a property of the RENDERER's look and not a
       * per-frame dramatic dial. Left addressable so tools/capture/_ab.mjs and
       * _skyab.mjs can force it to 0 and measure the frame against itself.
       *
       * 20 steps is 12.75/255 per riser. Chosen by measurement rather than
       * taste: on the critic's own trace — ravine-gap y = 1000, x 2400..3150 —
       * 24 steps gave a maximum single-pixel step of 7.1 spread over 62
       * crossings, and 20 gives 12.9 over 22. Fewer, harder cuts is the correct
       * direction as well as the better number; many small crossings is a
       * texture, a few large ones is a cel band.
       *
       * It cannot merge two authored plateaus, and the reason is the low gate
       * below rather than the step size: a flat region has a tone rate of zero
       * and is returned bit-identical, so two flat bands 11 units apart both
       * come out untouched however coarse the staircase is. Only a region that
       * is genuinely ramping can be snapped, and a ramp has no plateaus to
       * merge.
       */
      uTonePost: { value: 1 },
      uToneSteps: { value: 20 },
      uDebug: { value: 0 },
      // Grade tail (declared by GLSL_GRADE).
      uLut: { value: lut },
      uLutSize: { value: (lut.image as { width: number }).width },
      uGrain: { value: grain },
      uGrainScale: { value: new Vector2(1 / 512, 1 / 512) },
      uGrainStrength: { value: 0.016 },
      uVignette: { value: GRADE.vignetteStrength },
      uVignetteSoftness: { value: GRADE.vignetteSoftness },
      uVignetteTint: { value: GRADE.shadowTint.clone() },
    };

    this.pass = new FullscreenPass('npr:composite', FRAGMENT, this.uniforms);
  }

  setSize(width: number, height: number): void {
    (this.uniforms.uResolution.value as Vector2).set(width, height);
  }

  setDebug(mode: number): void {
    this.uniforms.uDebug.value = mode;
  }

  /** Pull the per-frame dials the game drives out of POST_STATE. */
  syncState(time: number): void {
    const u = this.uniforms;
    u.uTime.value = time;
    u.uBloomIntensity.value = POST_STATE.bloomIntensity;
    u.uSpeedIntensity.value = POST_STATE.speedLineIntensity;
    (u.uSpeedFocus.value as Vector2).copy(POST_STATE.speedLineFocus);
    u.uChroma.value = POST_STATE.chromaticAberration;
    u.uRadialBlur.value = POST_STATE.radialBlur;
    u.uImpactFlash.value = POST_STATE.impactFlash;
    (u.uImpactTint.value as Color).copy(POST_STATE.impactTint);
    u.uInkFlood.value = POST_STATE.inkFlood;
    u.uDesaturate.value = POST_STATE.desaturate;
    u.uVignette.value = POST_STATE.vignette;
    u.uLineOpacity.value = POST_STATE.lineOpacity;
    u.uGrainStrength.value = POST_STATE.grainStrength;
  }

  render(
    renderer: WebGLRenderer,
    scene: Texture,
    bloom: Texture,
    ink: Texture,
    target: WebGLRenderTarget | null,
  ): void {
    this.uniforms.uScene.value = scene;
    this.uniforms.uBloom.value = bloom;
    this.uniforms.uInk.value = ink;
    this.pass.render(renderer, target);
  }

  dispose(): void {
    this.pass.dispose();
  }
}
