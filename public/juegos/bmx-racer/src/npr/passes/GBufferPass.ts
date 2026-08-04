/**
 * GBufferPass — the MRT prepass the interior-line system reads.
 *
 *   attachment 0 : rgb = view-space normal, a = linear view depth in METRES
 *   attachment 1 : r = material id, g = curvature, b = stylisation mask,
 *                  a = coverage (1 where geometry was written, 0 on the clear)
 *
 * The coverage channel is not decoration. Both attachments are cleared to zero,
 * and a fragment can never legitimately write a view depth of zero (the near
 * plane is 0.12m), so `depth == 0` already identifies background — but relying
 * on that couples the line pass to a clear-colour convention that a future
 * change could silently break. `gAux.a` is written explicitly by the prepass
 * material in CelMaterial.ts and is unambiguous.
 *
 * WHAT IS EXCLUDED, and why it matters:
 *
 *  • Inverted hulls. The G-buffer describes the geometry as if no ink existed.
 *    That is the precondition for the hull-suppression test in LinesPass: we
 *    detect hull ink by comparing the MAIN pass depth (which the hull writes)
 *    against the G-buffer depth (which it does not). Put hulls in the G-buffer
 *    and that signal vanishes.
 *
 *  • Anything flagged `userData.skipPrepass` — the sky dome, the god-ray
 *    wedges, transparent FX. Interior lines on a dust puff would be nonsense,
 *    and a sky dome in the depth channel would wipe out every ridge contour.
 */

import {
  Color,
  HalfFloatType,
  NearestFilter,
  PerspectiveCamera,
  RGBAFormat,
  Scene,
  WebGLRenderer,
  WebGLRenderTarget,
} from 'three';
import { LAYER_PREPASS, SceneRegistry } from './RenderLists';

const _clearSave = new Color();

export class GBufferPass {
  readonly target: WebGLRenderTarget;

  constructor(width: number, height: number) {
    this.target = new WebGLRenderTarget(width, height, {
      count: 2,
      format: RGBAFormat,
      type: HalfFloatType,
      // Nearest everywhere: every read in the line pass is a texel-aligned tap
      // and bilinear interpolation of a normal across a silhouette produces a
      // normal that belongs to neither surface.
      minFilter: NearestFilter,
      magFilter: NearestFilter,
      depthBuffer: true,
      stencilBuffer: false,
      generateMipmaps: false,
    });
    this.target.textures[0].name = 'gNormalDepth';
    this.target.textures[1].name = 'gAux';
  }

  get normalDepth() {
    return this.target.textures[0];
  }

  get aux() {
    return this.target.textures[1];
  }

  setSize(width: number, height: number): void {
    this.target.setSize(width, height);
  }

  render(
    renderer: WebGLRenderer,
    scene: Scene,
    camera: PerspectiveCamera,
    registry: SceneRegistry,
  ): void {
    if (registry.prepass.length === 0) {
      // Still clear, or the line pass reads last frame's G-buffer.
      renderer.setRenderTarget(this.target);
      renderer.clear(true, true, false);
      return;
    }

    const prevMask = camera.layers.mask;
    const prevAlpha = renderer.getClearAlpha();
    renderer.getClearColor(_clearSave);

    registry.swapToPrepass();
    try {
      camera.layers.set(LAYER_PREPASS);
      renderer.setRenderTarget(this.target);
      // Clear to zero on BOTH attachments — gl.clear writes the one clear
      // colour to every enabled draw buffer, which is exactly what we want:
      // zero normal, zero depth, zero coverage.
      renderer.setClearColor(0x000000, 0);
      renderer.clear(true, true, false);
      renderer.render(scene, camera);
    } finally {
      registry.restoreFromPrepass();
      camera.layers.mask = prevMask;
      renderer.setClearColor(_clearSave, prevAlpha);
    }
  }

  dispose(): void {
    this.target.dispose();
  }
}
