/**
 * Fullscreen — the substrate every screen-space pass is built on.
 *
 * Two deliberate choices here, both of which matter more than they look:
 *
 *  1. A single oversized TRIANGLE, not a quad. A quad rasterises its diagonal
 *     twice, and the 2x2 derivative blocks that straddle that diagonal produce
 *     garbage `fwidth()` values along it. Our Sobel and our band-step helpers
 *     both use derivatives, so a quad would draw a faint diagonal artefact
 *     across every frame. A triangle has no interior edge.
 *
 *  2. Every pass owns its own one-node Scene. `renderer.render()` is the only
 *     stable public entry point into three's state management, and calling it
 *     on a one-mesh scene costs a few microseconds — far less than the bugs you
 *     buy by reaching into `renderBufferDirect`.
 */

import {
  BufferGeometry,
  Float32BufferAttribute,
  GLSL3,
  IUniform,
  Mesh,
  OrthographicCamera,
  Scene,
  ShaderMaterial,
  WebGLRenderer,
  WebGLRenderTarget,
} from 'three';

/** Clip-space triangle that covers [-1,1]^2 with uv in [0,1]^2. */
let _triangle: BufferGeometry | null = null;
function fullscreenTriangle(): BufferGeometry {
  if (_triangle) return _triangle;
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  g.setAttribute('uv', new Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
  g.boundingSphere = null;
  _triangle = g;
  return g;
}

/** The camera is irrelevant — the vertex shader writes clip space directly. */
const _camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);

export const FULLSCREEN_VERTEX = /* glsl */ `
  precision highp float;
  out vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

export class FullscreenPass {
  readonly material: ShaderMaterial;
  readonly uniforms: Record<string, IUniform>;
  private readonly scene = new Scene();
  private readonly mesh: Mesh;

  constructor(name: string, fragmentShader: string, uniforms: Record<string, IUniform>) {
    this.uniforms = uniforms;
    this.material = new ShaderMaterial({
      name,
      glslVersion: GLSL3,
      uniforms,
      vertexShader: FULLSCREEN_VERTEX,
      fragmentShader,
      depthTest: false,
      depthWrite: false,
      transparent: false,
      fog: false,
      lights: false,
    });
    this.mesh = new Mesh(fullscreenTriangle(), this.material);
    this.mesh.name = name;
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.scene.add(this.mesh);
    this.scene.matrixAutoUpdate = false;
  }

  /** `target === null` renders to the canvas. */
  render(renderer: WebGLRenderer, target: WebGLRenderTarget | null): void {
    renderer.setRenderTarget(target);
    renderer.render(this.scene, _camera);
  }

  setDefine(key: string, value: string | number | boolean): void {
    this.material.defines ??= {};
    if (this.material.defines[key] === value) return;
    this.material.defines[key] = value as never;
    this.material.needsUpdate = true;
  }

  dispose(): void {
    this.material.dispose();
    this.scene.clear();
  }
}

/** Free the shared triangle. Only the pipeline's dispose() should call this. */
export function disposeFullscreenGeometry(): void {
  _triangle?.dispose();
  _triangle = null;
}
