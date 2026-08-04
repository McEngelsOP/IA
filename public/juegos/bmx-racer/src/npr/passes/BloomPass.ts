/**
 * BloomPass — threshold bloom that stays GRAPHIC.
 *
 * The failure mode this is written against is the default one: a soft, wide,
 * photographic glow laid over everything bright. That single effect will undo
 * a cel palette faster than anything else in the stack, because a smooth halo
 * is by definition a gradient, and the entire art direction is "no gradients".
 *
 * Three decisions keep it drawn rather than photographed:
 *
 *  1. HARD THRESHOLD, applied per-tap in the prefilter rather than to the
 *     averaged result. A specular glint on a frame tube is one or two pixels;
 *     average first and it falls under the threshold and disappears, which is
 *     exactly the highlight we most want to bloom.
 *
 *  2. A SHORT MIP CHAIN with a geometrically decaying blend. Each successive
 *     mip contributes less, so the halo has a bright, tight core and a very
 *     quiet skirt instead of an even wash. Five mips of equal weight is a
 *     photograph; four with 0.62 decay is an ink glow.
 *
 *  3. Everything happens at HALF RESOLUTION and below. The first downsample is
 *     the only pass that reads the full-resolution frame, and it reads it with
 *     13 bilinear taps that each average four texels — so the whole chain costs
 *     roughly one and a quarter full-resolution reads, total.
 */

import {
  AdditiveBlending,
  ClampToEdgeWrapping,
  HalfFloatType,
  IUniform,
  LinearFilter,
  RGBAFormat,
  Texture,
  Vector2,
  WebGLRenderer,
  WebGLRenderTarget,
} from 'three';
import { GLSL_COMMON, GLSL_FRAG_OUT, GLSL_POST_HELPERS } from '../ShaderChunks';
import { GRADE } from '../Palette';
import { FullscreenPass } from './Fullscreen';

const DOWNSAMPLE_FRAGMENT = /* glsl */ `
  precision highp float;
  ${GLSL_COMMON}
  ${GLSL_POST_HELPERS}
  ${GLSL_FRAG_OUT}

  uniform sampler2D uSource;
  uniform vec2  uSourceTexel;
  uniform float uThreshold;
  uniform float uKnee;
  uniform float uPrefilter;   // 1 on the first level, 0 afterwards

  in vec2 vUv;

  vec3 fetch(vec2 uv) { return texture(uSource, uv).rgb; }

  vec3 filterGroup(vec3 c) {
    // The threshold is applied to each 2x2 GROUP rather than to the final
    // average. That keeps a single hot texel from being diluted below the
    // threshold by three dark neighbours, which is precisely what happens to
    // a specular glint and precisely the highlight we want to survive.
    return mix(c, bloomPrefilter(c, uThreshold, uKnee), uPrefilter);
  }

  void main() {
    vec2 t = uSourceTexel;

    // Call of Duty's 13-tap downsample: four corner 2x2 boxes plus a centre
    // box weighted double. It is the cheapest kernel that does not alias a
    // bright pixel into a crawling dot when the camera moves — and a crawling
    // bloom dot is unmissable at 60fps.
    vec3 a = fetch(vUv + t * vec2(-2.0,  2.0));
    vec3 b = fetch(vUv + t * vec2( 0.0,  2.0));
    vec3 c = fetch(vUv + t * vec2( 2.0,  2.0));
    vec3 d = fetch(vUv + t * vec2(-2.0,  0.0));
    vec3 e = fetch(vUv);
    vec3 f = fetch(vUv + t * vec2( 2.0,  0.0));
    vec3 g = fetch(vUv + t * vec2(-2.0, -2.0));
    vec3 h = fetch(vUv + t * vec2( 0.0, -2.0));
    vec3 i = fetch(vUv + t * vec2( 2.0, -2.0));
    vec3 j = fetch(vUv + t * vec2(-1.0,  1.0));
    vec3 k = fetch(vUv + t * vec2( 1.0,  1.0));
    vec3 l = fetch(vUv + t * vec2(-1.0, -1.0));
    vec3 m = fetch(vUv + t * vec2( 1.0, -1.0));

    vec3 g0 = filterGroup((j + k + l + m) * 0.25);
    vec3 g1 = filterGroup((a + b + d + e) * 0.25);
    vec3 g2 = filterGroup((b + c + e + f) * 0.25);
    vec3 g3 = filterGroup((d + e + g + h) * 0.25);
    vec3 g4 = filterGroup((e + f + h + i) * 0.25);

    vec3 col = g0 * 0.5 + (g1 + g2 + g3 + g4) * 0.125;
    fragColor = vec4(max(col, vec3(0.0)), 1.0);
  }
`;

const UPSAMPLE_FRAGMENT = /* glsl */ `
  precision highp float;
  ${GLSL_COMMON}
  ${GLSL_FRAG_OUT}

  uniform sampler2D uSource;
  uniform vec2  uSourceTexel;
  uniform float uRadius;
  uniform float uBlend;

  in vec2 vUv;

  void main() {
    vec2 t = uSourceTexel * uRadius;
    // 3x3 tent. Cheaper than a gaussian and, because the mip chain applies it
    // repeatedly, converges to something close enough to one that the
    // difference is invisible and the cost is not.
    vec3 col = vec3(0.0);
    col += texture(uSource, vUv + vec2(-t.x,  t.y)).rgb * 1.0;
    col += texture(uSource, vUv + vec2( 0.0,  t.y)).rgb * 2.0;
    col += texture(uSource, vUv + vec2( t.x,  t.y)).rgb * 1.0;
    col += texture(uSource, vUv + vec2(-t.x,  0.0)).rgb * 2.0;
    col += texture(uSource, vUv).rgb                    * 4.0;
    col += texture(uSource, vUv + vec2( t.x,  0.0)).rgb * 2.0;
    col += texture(uSource, vUv + vec2(-t.x, -t.y)).rgb * 1.0;
    col += texture(uSource, vUv + vec2( 0.0, -t.y)).rgb * 2.0;
    col += texture(uSource, vUv + vec2( t.x, -t.y)).rgb * 1.0;
    fragColor = vec4(col * (1.0 / 16.0) * uBlend, 1.0);
  }
`;

export interface BloomPassOptions {
  /** Mip levels below half resolution. 4 keeps the halo tight; 6 makes it a wash. */
  levels?: number;
  /** Per-level contribution decay on the way back up. */
  decay?: number;
}

export class BloomPass {
  private mips: WebGLRenderTarget[] = [];
  private down: FullscreenPass;
  private up: FullscreenPass;
  private downUniforms: Record<string, IUniform>;
  private upUniforms: Record<string, IUniform>;
  private levels: number;
  private decay: number;

  constructor(width: number, height: number, options: BloomPassOptions = {}) {
    this.levels = Math.max(2, options.levels ?? 4);
    this.decay = options.decay ?? 0.62;

    for (let i = 0; i < this.levels; i++) {
      const rt = new WebGLRenderTarget(1, 1, {
        format: RGBAFormat,
        type: HalfFloatType,
        minFilter: LinearFilter,
        magFilter: LinearFilter,
        wrapS: ClampToEdgeWrapping,
        wrapT: ClampToEdgeWrapping,
        depthBuffer: false,
        stencilBuffer: false,
        generateMipmaps: false,
      });
      rt.texture.name = `bloomMip${i}`;
      this.mips.push(rt);
    }
    this.setSize(width, height);

    this.downUniforms = {
      uSource: { value: null },
      uSourceTexel: { value: new Vector2() },
      uThreshold: { value: GRADE.bloomThreshold },
      uKnee: { value: GRADE.bloomKnee },
      uPrefilter: { value: 1 },
    };
    this.upUniforms = {
      uSource: { value: null },
      uSourceTexel: { value: new Vector2() },
      uRadius: { value: GRADE.bloomRadius },
      uBlend: { value: 1 },
    };

    this.down = new FullscreenPass('npr:bloomDown', DOWNSAMPLE_FRAGMENT, this.downUniforms);
    this.up = new FullscreenPass('npr:bloomUp', UPSAMPLE_FRAGMENT, this.upUniforms);
    // Additive on the way up: each mip ADDS its blurred content to the level
    // below rather than replacing it, which is what accumulates the halo.
    this.up.material.blending = AdditiveBlending;
    this.up.material.depthTest = false;
    this.up.material.depthWrite = false;
  }

  /** Half-resolution accumulated bloom. Sample this in the composite. */
  get texture(): Texture {
    return this.mips[0].texture;
  }

  setSize(width: number, height: number): void {
    for (let i = 0; i < this.levels; i++) {
      const div = 1 << (i + 1);
      this.mips[i].setSize(Math.max(1, Math.floor(width / div)), Math.max(1, Math.floor(height / div)));
    }
  }

  setThreshold(threshold: number, knee: number): void {
    this.downUniforms.uThreshold.value = threshold;
    this.downUniforms.uKnee.value = Math.max(knee, 1e-4);
  }

  render(renderer: WebGLRenderer, source: Texture, sourceWidth: number, sourceHeight: number): void {
    const dt = this.downUniforms.uSourceTexel.value as Vector2;

    // ── Down ──
    this.downUniforms.uSource.value = source;
    this.downUniforms.uPrefilter.value = 1;
    dt.set(1 / sourceWidth, 1 / sourceHeight);
    this.down.render(renderer, this.mips[0]);

    this.downUniforms.uPrefilter.value = 0;
    for (let i = 1; i < this.levels; i++) {
      const src = this.mips[i - 1];
      this.downUniforms.uSource.value = src.texture;
      dt.set(1 / src.width, 1 / src.height);
      this.down.render(renderer, this.mips[i]);
    }

    // ── Up ──
    // The blend factor is CONSTANT, not cumulative. Because each level is
    // folded into the one below it in turn, a constant factor already produces
    // a geometric series at the bottom of the chain: mip0 contributes 1,
    // mip1 contributes d, mip2 d^2, mip3 d^3. Multiplying the factor down the
    // loop as well would square that decay and leave the wide mips doing
    // nothing at all, which is a bloom with no reach.
    const ut = this.upUniforms.uSourceTexel.value as Vector2;
    this.upUniforms.uBlend.value = this.decay;
    for (let i = this.levels - 1; i > 0; i--) {
      const src = this.mips[i];
      this.upUniforms.uSource.value = src.texture;
      ut.set(1 / src.width, 1 / src.height);
      this.up.render(renderer, this.mips[i - 1]);
    }
  }

  dispose(): void {
    for (const m of this.mips) m.dispose();
    this.mips.length = 0;
    this.down.dispose();
    this.up.dispose();
  }
}
