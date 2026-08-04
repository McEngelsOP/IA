/**
 * ShadowCascades — two orthographic sun cascades, fitted and texel-snapped.
 *
 * The cel shader already knows how to READ these (see GLSL_SHADOW in
 * ShaderChunks): four rotated PCF taps, then the penumbra quantised to two
 * hard steps so a cast shadow lands on the same palette as a form shadow. This
 * file's whole job is to hand it a shadow map that does not shimmer.
 *
 * Three things make that work, and all three are load-bearing:
 *
 *  1. BOUNDING SPHERE, not bounding box. The cascade is fitted to the sphere
 *     that encloses the camera's sub-frustum. A sphere is rotation-invariant,
 *     so turning the camera cannot change the size of the fitted region — and a
 *     region that changes size cannot be texel-snapped, because the texel size
 *     itself would be moving. Box fitting is the single most common reason a
 *     hand-rolled CSM crawls when you turn.
 *
 *  2. CONSTANT RADIUS. The sphere radius is derived from a REFERENCE field of
 *     view captured at resize, not from the live camera. The camera director
 *     kicks the FOV on landings and boosts; if the radius tracked that, every
 *     boost would resize the shadow texel and set the whole mountain crawling
 *     for the duration of the kick.
 *
 *  3. TEXEL SNAPPING in light space. The ortho bounds are quantised to whole
 *     texels of the shadow map, so as the camera moves the shadow map's content
 *     translates in whole-texel steps. Without it, sub-texel motion re-rasterises
 *     every edge every frame and hard cel shadow edges — which have no penumbra
 *     to hide in — boil visibly.
 *
 * Depth is stored in a real DEPTH_COMPONENT24 texture rather than in a colour
 * channel. A half-float colour target has roughly 5e-4 resolution near 1.0,
 * which is an order of magnitude coarser than the bias we need; the hardware
 * depth buffer has ~6e-8. The colour attachment is a throwaway R8.
 */

import {
  Color,
  DepthFormat,
  DepthTexture,
  Matrix4,
  NearestFilter,
  OrthographicCamera,
  PerspectiveCamera,
  RedFormat,
  Scene,
  UnsignedByteType,
  UnsignedIntType,
  Vector3,
  WebGLRenderer,
  WebGLRenderTarget,
} from 'three';
import { NPR } from './NprGlobals';
import { SUN_DIRECTION } from './Palette';
import { LAYER_SHADOW, SceneRegistry } from './passes/RenderLists';

export interface ShadowCascadeOptions {
  /**
   * Texture resolution. One number applies to both cascades; a pair sizes them
   * independently, which is usually what you want — the two cascades cover
   * wildly different amounts of world for the same number of texels.
   */
  size?: number | [number, number];
  /** View distance covered by cascade 0, metres. Also the handover split. */
  nearRange?: number;
  /** View distance covered by cascade 1, metres. */
  farRange?: number;
  /**
   * How far up-sun to reach for casters, per cascade, metres. A ridge 400m
   * above the rider still throws shadow onto them at a 21.5-degree sun.
   */
  castExtend?: [number, number];
  /** Desired depth bias expressed in METRES at cascade 0. */
  worldBias?: number;
  /** Reference vertical FOV in degrees used to size the cascades. */
  referenceFovDeg?: number;
  enabled?: boolean;
}

// Module-scope scratch. Nothing in the per-frame path allocates.
const _fwd = new Vector3();
const _center = new Vector3();
const _centerLs = new Vector3();
const _lookTarget = new Vector3();
const _clearSave = new Color();

export class ShadowCascades {
  readonly targets: WebGLRenderTarget[] = [];
  readonly cameras: OrthographicCamera[] = [];

  private opts: Required<Omit<ShadowCascadeOptions, 'size'>>;
  /** Resolved per-cascade resolution. */
  private sizes: [number, number];
  private radii: [number, number] = [0, 0];
  private centerDist: [number, number] = [0, 0];
  private depthRange: [number, number] = [1, 1];
  private aspect = 16 / 9;
  private _enabled = true;

  constructor(options: ShadowCascadeOptions = {}) {
    this.opts = {
      // 55, not 70.
      //
      // The screen-space size of a shadow texel is texelWorld / (viewDist *
      // metresPerPixelPerMetre), so within ONE cascade the step size varies by
      // the full ratio of the range it covers. Cascade 0 is the one a chase
      // camera actually looks at — the rider is 6-9 m out — and shortening its
      // range shrinks its texel proportionally at no cost to cascade 1, whose
      // fitted sphere is centred on its own far plane and therefore does not
      // depend on where the split sits at all.
      nearRange: options.nearRange ?? 55,
      farRange: options.farRange ?? 420,
      castExtend: options.castExtend ?? [420, 1100],
      worldBias: options.worldBias ?? 0.045,
      referenceFovDeg: options.referenceFovDeg ?? 72,
      enabled: options.enabled ?? true,
    };
    // 4096, not 2048.
    //
    // At 2048 with the old 70 m near range, one cascade-0 texel was 0.103 m of
    // world and one cascade-1 texel was 0.62 m. A 0.62 m texel seen at 25 m is
    // 30 device pixels, which is exactly the block size the dune shadow in
    // treeline-silhouette was stepping in. Texel snapping cannot help with
    // that — snapping is what stops the blocks CRAWLING, and a stable block is
    // still a block. The only cure for the size of a block is more of them.
    const s = options.size ?? [4096, 4096];
    this.sizes = typeof s === 'number' ? [s, s] : [s[0], s[1]];
    this._enabled = this.opts.enabled;

    for (let i = 0; i < 2; i++) {
      const size = this.sizes[i];
      const depth = new DepthTexture(size, size, UnsignedIntType);
      depth.format = DepthFormat;
      depth.minFilter = NearestFilter;
      depth.magFilter = NearestFilter;
      depth.name = `shadowDepth${i}`;
      const rt = new WebGLRenderTarget(size, size, {
        // The colour attachment is never read. At 4096 square, R8 keeps it to
        // 16MB instead of the 64MB an RGBA8 would cost, twice over.
        format: RedFormat,
        type: UnsignedByteType,
        minFilter: NearestFilter,
        magFilter: NearestFilter,
        depthBuffer: true,
        stencilBuffer: false,
        depthTexture: depth,
        generateMipmaps: false,
      });
      rt.texture.name = `shadowColor${i}`;
      this.targets.push(rt);

      const cam = new OrthographicCamera(-1, 1, 1, -1, -1, 1);
      // A pure rotation at the origin. Keeping the light camera's POSITION
      // fixed is what lets the ortho bounds carry the snapped offset — if the
      // camera moved to follow the region, the region would always be at light
      // space (0,0) and the snap would quantise nothing.
      cam.position.set(0, 0, 0);
      _lookTarget.copy(SUN_DIRECTION).multiplyScalar(-1);
      cam.lookAt(_lookTarget);
      cam.layers.set(LAYER_SHADOW);
      cam.updateMatrixWorld(true);
      this.cameras.push(cam);
    }

    NPR.uShadowMap0.value = this.targets[0].depthTexture;
    NPR.uShadowMap1.value = this.targets[1].depthTexture;
    NPR.uShadowTexel.value.set(1 / this.sizes[0], 1 / this.sizes[1]);
    NPR.uShadowSplit.value = this.opts.nearRange;

    this.recomputeFit();
  }

  get enabled(): boolean {
    return this._enabled;
  }

  set enabled(v: boolean) {
    this._enabled = v;
    // The cel shader early-outs on uShadowStrength, so disabling the pass and
    // zeroing the strength keeps the two in step.
    NPR.uShadowStrength.value = v ? this.strength : 0;
  }

  /** Shadow darkness fed to the cel shader. Kept so `enabled` can restore it. */
  strength = NPR.uShadowStrength.value;

  setStrength(v: number): void {
    this.strength = v;
    if (this._enabled) NPR.uShadowStrength.value = v;
  }

  resize(width: number, height: number): void {
    this.aspect = Math.max(width, 1) / Math.max(height, 1);
    this.recomputeFit();
  }

  /**
   * Cascade geometry that depends only on the reference frustum, not on where
   * the camera happens to be pointing. Recomputed on resize and never per frame,
   * which is exactly what keeps the texel size constant.
   */
  private recomputeFit(): void {
    const tanV = Math.tan((this.opts.referenceFovDeg * Math.PI) / 360);
    const tanH = tanV * this.aspect;
    const k2 = tanH * tanH + tanV * tanV;

    const ranges: [number, number][] = [
      [0.1, this.opts.nearRange],
      [this.opts.nearRange, this.opts.farRange],
    ];

    for (let i = 0; i < 2; i++) {
      const [n, f] = ranges[i];
      // Standard sub-frustum bounding sphere. When the frustum is wide relative
      // to its depth the sphere is simply centred on the far plane; otherwise
      // it sits between the planes and is meaningfully tighter.
      let centerZ: number;
      let radius: number;
      if (k2 >= (f - n) / (f + n)) {
        centerZ = -f;
        radius = f * Math.sqrt(k2);
      } else {
        centerZ = -0.5 * (f + n) * (1 + k2);
        radius =
          0.5 *
          Math.sqrt(
            (f - n) * (f - n) + 2 * (f * f + n * n) * k2 + (f + n) * (f + n) * k2 * k2,
          );
      }
      // 2% slack so a rounding error at the frustum corner never clips a
      // shadow off the edge of the map.
      this.radii[i] = radius * 1.02;
      this.centerDist[i] = -centerZ;
    }
  }

  /** Fit one cascade to the camera and write its matrices. Allocation-free. */
  private fit(index: number, camera: PerspectiveCamera): void {
    const cam = this.cameras[index];
    const r = this.radii[index];

    camera.getWorldDirection(_fwd);
    _center.copy(camera.position).addScaledVector(_fwd, this.centerDist[index]);

    // Into light space. The camera sits at the origin with a fixed rotation, so
    // matrixWorldInverse is a pure rotation and this is exact.
    _centerLs.copy(_center).applyMatrix4(cam.matrixWorldInverse);

    // Snap the fitted window to whole texels. Everything else in this file
    // exists to make this line meaningful.
    const texel = (2 * r) / this.sizes[index];
    const cx = Math.round(_centerLs.x / texel) * texel;
    const cy = Math.round(_centerLs.y / texel) * texel;

    // Light-space depth of a point is -z. Reach backwards toward the sun far
    // enough to catch off-screen casters; forwards only a little.
    const depthAtCenter = -_centerLs.z;
    const near = depthAtCenter - r - this.opts.castExtend[index];
    const far = depthAtCenter + r + 16;

    cam.left = cx - r;
    cam.right = cx + r;
    cam.bottom = cy - r;
    cam.top = cy + r;
    cam.near = near;
    cam.far = far;
    cam.updateProjectionMatrix();

    this.depthRange[index] = Math.max(far - near, 1);

    const mat = index === 0 ? NPR.uShadowMat0.value : NPR.uShadowMat1.value;
    (mat as Matrix4).multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
  }

  /**
   * Render both cascades. `registry` supplies the cached caster list; the
   * material swap is done here so the two cascades share one swap.
   */
  render(renderer: WebGLRenderer, scene: Scene, camera: PerspectiveCamera, registry: SceneRegistry): void {
    if (!this._enabled || registry.casters.length === 0) {
      NPR.uShadowStrength.value = this._enabled ? this.strength : 0;
      return;
    }

    const prevTarget = renderer.getRenderTarget();
    const prevClearAlpha = renderer.getClearAlpha();
    renderer.getClearColor(_clearSave);

    registry.swapToShadow();
    try {
      // White = far. The colour buffer is unused, but clearing it is what
      // gives the driver permission to discard the previous contents rather
      // than load them, which on a tiler is the difference between free and
      // a full 16MB read per cascade.
      renderer.setClearColor(0xffffff, 1);
      for (let i = 0; i < 2; i++) {
        this.fit(i, camera);
        renderer.setRenderTarget(this.targets[i]);
        renderer.clear(true, true, false);
        renderer.render(scene, this.cameras[i]);
      }
    } finally {
      registry.restoreFromShadow();
      renderer.setClearColor(_clearSave, prevClearAlpha);
      renderer.setRenderTarget(prevTarget);
    }

    // The shader's bias is in normalised depth. Converting from a world-space
    // intent here means the bias stays physically constant as the cascade
    // depth range breathes with the terrain — otherwise a bias tuned on the
    // summit acnes in the valley.
    NPR.uShadowBias.value = this.opts.worldBias / this.depthRange[0];
    // Normal-offset bias needs the texel footprint in world units, not in uv.
    NPR.uShadowTexelWorld.value.set(
      (2 * this.radii[0]) / this.sizes[0],
      (2 * this.radii[1]) / this.sizes[1],
    );
    NPR.uShadowSplit.value = this.opts.nearRange;
    NPR.uShadowStrength.value = this.strength;
  }

  /** World size of one shadow texel in each cascade — useful for debug HUDs. */
  texelWorldSize(): [number, number] {
    return [(2 * this.radii[0]) / this.sizes[0], (2 * this.radii[1]) / this.sizes[1]];
  }

  dispose(): void {
    for (const t of this.targets) {
      t.depthTexture?.dispose();
      t.dispose();
    }
    this.targets.length = 0;
    NPR.uShadowMap0.value = null;
    NPR.uShadowMap1.value = null;
  }
}
