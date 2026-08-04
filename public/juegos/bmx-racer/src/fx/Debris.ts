/**
 * Debris — scree spray, stream splash, and crash wreckage.
 *
 * Where DustSystem is a *drawn* effect (analytic motion, animator step timing,
 * no simulation), this is the opposite: every chip here runs a real ballistic
 * arc with linear drag and bounces off the actual heightfield. That difference
 * is deliberate and it is what makes the two read as different substances.
 * Smoke is a shape someone drew; a stone is an object that was thrown. If dust
 * and gravel share a motion model, gravel stops reading as weight.
 *
 * The rendering is still fully cel: hard-edged generated chip silhouettes with
 * an ink contour, a two-edge band ramp, quantised opacity, the same quantised
 * fog and the same sun-shadow lookup as the terrain they bounce off.
 *
 * One InstancedBufferGeometry, one draw call, one free-list. Nothing allocates
 * after construction.
 */

import {
  CanvasTexture,
  Color,
  DoubleSide,
  GLSL3,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  NormalBlending,
  Object3D,
  PerspectiveCamera,
  ShaderMaterial,
  SRGBColorSpace,
  Texture,
  Vector2,
  Vector3,
} from 'three';

import type { ITerrain, SurfaceProperties } from '../game/Contracts';
import { SurfaceKind } from '../game/Contracts';
import { Rng } from '../core/RNG';
import { clamp, clamp01 } from '../core/MathX';
import { BIKE } from '../game/WorldConstants';
import { globalUniformBlock } from '../npr/NprGlobals';
import { INK, RAMPS } from '../npr/Palette';
import { GLSL_COMMON, GLSL_FOG, GLSL_FRAG_OUT, GLSL_GLOBAL_UNIFORMS, GLSL_SHADOW } from '../npr/ShaderChunks';
import { dustTintFor, GLSL_BAND_STEP, GLSL_BILLBOARD, QuadParticlePool } from './DustSystem';

const _t = new Vector3();
const _b = new Vector3();
const _n = new Vector3();
const _d = new Vector3();
const _p = new Vector3();
const _camPos = new Vector3();
/** Wreckage sprays away from the impulse AND upward; this is the up component. */
const _UP_BIAS = new Vector3(0, 0.55, 0);

/** Debris kinds. Each has its own drag, restitution and lifetime character. */
export const DEBRIS_SCREE = 0;
export const DEBRIS_SPLASH = 1;
export const DEBRIS_CRASH = 2;

// ─────────────────────────────────────────────────────────────────────────────
// Chip atlas — four drawn silhouettes, generated once.
// ─────────────────────────────────────────────────────────────────────────────

let _chipAtlas: Texture | null = null;

/**
 * Four chip shapes in a 2x2 atlas: an angular flake, a long shard, a rounded
 * pebble, and a teardrop for water.
 *
 * Construction mirrors GeneratedTextures.dustPuff() exactly — an oversized
 * black silhouette, an inset white interior, one hard shadow lobe, then the
 * alpha binarised — so the debris fragment shader can use byte-identical
 * thresholds to the dust one and the two effects sit in the same ink system.
 */
export function chipAtlas(): Texture {
  if (_chipAtlas) return _chipAtlas;

  const CELL = 128;
  const size = CELL * 2;
  const cv = document.createElement('canvas');
  cv.width = size;
  cv.height = size;
  const ctx = cv.getContext('2d')!;
  ctx.clearRect(0, 0, size, size);

  const rng = new Rng('fx:chips');
  const kinds: ('flake' | 'shard' | 'pebble' | 'drop')[] = ['flake', 'shard', 'pebble', 'drop'];

  for (let i = 0; i < 4; i++) {
    const cx = (i % 2) * CELL + CELL * 0.5;
    const cy = Math.floor(i / 2) * CELL + CELL * 0.5;
    const R = CELL * 0.40;
    const kind = kinds[i];

    // Build the outline as a closed polygon in unit space.
    const pts: [number, number][] = [];
    if (kind === 'flake') {
      const n = 5 + rng.int(0, 2);
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2 + rng.range(-0.28, 0.28);
        const r = rng.range(0.55, 1.0);
        pts.push([Math.cos(a) * r, Math.sin(a) * r * 0.86]);
      }
    } else if (kind === 'shard') {
      const n = 6;
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2 + rng.range(-0.2, 0.2);
        const r = rng.range(0.7, 1.0);
        // Squashed hard on one axis so it reads as a splinter, not a blob.
        pts.push([Math.cos(a) * r, Math.sin(a) * r * 0.34]);
      }
    } else if (kind === 'pebble') {
      const n = 9;
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2 + rng.range(-0.1, 0.1);
        const r = rng.range(0.84, 1.0);
        pts.push([Math.cos(a) * r, Math.sin(a) * r * 0.92]);
      }
    } else {
      // Teardrop: a circle with one vertex pulled into a tail.
      const n = 11;
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2;
        // Pull toward -x, tapering the sides as they approach the tail.
        const pull = Math.pow(Math.max(0, -Math.cos(a)), 2.0);
        const r = 0.62 + pull * 0.38;
        const squeeze = 1 - pull * 0.72;
        pts.push([Math.cos(a) * r * (1 + pull * 0.5), Math.sin(a) * r * squeeze]);
      }
    }

    const poly = (scale: number, style: string): void => {
      ctx.beginPath();
      for (let k = 0; k < pts.length; k++) {
        const x = cx + pts[k][0] * R * scale;
        const y = cy + pts[k][1] * R * scale;
        if (k === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fillStyle = style;
      ctx.fill();
    };

    // Ink silhouette, then the interior inset by the stroke weight.
    poly(1.0, '#000000');
    poly(0.76, '#ffffff');

    // One hard shadow lobe, clipped to the interior. Chips need a light side
    // and a dark side or a field of them reads as confetti.
    ctx.save();
    ctx.beginPath();
    for (let k = 0; k < pts.length; k++) {
      const x = cx + pts[k][0] * R * 0.76;
      const y = cy + pts[k][1] * R * 0.76;
      if (k === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.clip();
    ctx.fillStyle = '#6a6a6a';
    ctx.beginPath();
    ctx.arc(cx + R * 0.42, cy + R * 0.46, R * 0.95, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Binarise the alpha — a chip is a cut shape, not a feathered sprite.
  const img = ctx.getImageData(0, 0, size, size);
  for (let i = 0; i < size * size; i++) {
    img.data[i * 4 + 3] = img.data[i * 4 + 3] > 8 ? 255 : 0;
  }
  ctx.putImageData(img, 0, 0);

  const tex = new CanvasTexture(cv);
  tex.name = 'fx:chip-atlas';
  tex.colorSpace = SRGBColorSpace;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.magFilter = LinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  _chipAtlas = tex;
  return tex;
}

// ─────────────────────────────────────────────────────────────────────────────
// Shaders
// ─────────────────────────────────────────────────────────────────────────────

const DEBRIS_VERT = /* glsl */ `
  precision highp float;
  ${GLSL_COMMON}
  ${GLSL_GLOBAL_UNIFORMS}
  ${GLSL_BILLBOARD}

  in vec3 aPos;
  in vec3 aVel;
  in vec4 aData;   // x size, y spin, z alpha, w tile
  in vec4 aTint;   // rgb tint, a velocity-stretch amount

  out vec2  vUv;
  out vec2  vQuad;
  out vec3  vTint;
  out float vAlpha;
  out vec3  vWorldPos;
  out float vViewDist;

  void main() {
    vUv = vec2(0.0);
    vQuad = vec2(0.0);
    vTint = aTint.rgb;
    vAlpha = 0.0;
    vWorldPos = aPos;
    vViewDist = 1.0;

    if (aData.z <= 0.001 || aData.x <= 0.0) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      return;
    }

    vec3 R = camRightWS();
    vec3 U = camUpWS();

    // Velocity-aligned stretch. A stone thrown at 18 m/s does not present as a
    // circle for the 16ms it is on screen — it presents as a streak along its
    // path. We project the world velocity into the billboard plane and both
    // orient and elongate the quad along it. Kinds with stretch 0 (crash
    // wreckage, which tumbles rather than flies) fall back to spin instead.
    vec2 sv = vec2(dot(aVel, R), dot(aVel, U));
    float svl = length(sv);
    float stretch = aTint.a;
    float aligned = step(0.01, stretch) * step(0.35, svl);

    vec2 axis = svl > 1e-4 ? sv / svl : vec2(1.0, 0.0);
    float ca = mix(cos(aData.y), axis.x, aligned);
    float sa = mix(sin(aData.y), axis.y, aligned);

    float sx = 1.0 + stretch * min(svl * 0.085, 2.4) * aligned;
    vec2 local = vec2(position.x * sx, position.y);
    vec2 rq = vec2(local.x * ca - local.y * sa, local.x * sa + local.y * ca);

    vec3 wpos = aPos + (R * rq.x + U * rq.y) * aData.x;

    vQuad = clamp(vec2(local.x / max(sx, 1e-3), local.y), -1.0, 1.0);

    float tile = floor(aData.w + 0.5);
    vec2 tileOff = vec2(mod(tile, 2.0), floor(tile * 0.5)) * 0.5;
    vUv = tileOff + uv * 0.5;

    vTint = aTint.rgb;
    vAlpha = aData.z;
    vWorldPos = wpos;
    vViewDist = length(wpos - uCameraPos);

    gl_Position = projectionMatrix * viewMatrix * vec4(wpos, 1.0);
  }
`;

const DEBRIS_FRAG = /* glsl */ `
  precision highp float;
  ${GLSL_COMMON}
  ${GLSL_GLOBAL_UNIFORMS}
  ${GLSL_SHADOW}
  ${GLSL_FOG}
  ${GLSL_BILLBOARD}
  ${GLSL_BAND_STEP}
  ${GLSL_FRAG_OUT}

  uniform sampler2D uAtlas;
  uniform vec3  uBand0;
  uniform vec3  uBand1;
  uniform vec3  uBand2;
  uniform vec2  uBandT;
  uniform vec3  uInk;
  uniform float uOpacity;

  in vec2  vUv;
  in vec2  vQuad;
  in vec3  vTint;
  in float vAlpha;
  in vec3  vWorldPos;
  in float vViewDist;

  void main() {
    vec4 tex = texture(uAtlas, vUv);
    if (tex.a < 0.5) discard;

    float texLum = luma(tex.rgb);
    float isInk = 1.0 - step(0.035, texLum);
    float drawnShade = (1.0 - isInk) * (1.0 - smoothstep(0.10, 0.60, texLum));

    // Chips are close to flat facets, so the impostor normal is much less
    // bulged than the dust one: mostly facing the camera with a slight tilt
    // from the quad footprint. That keeps a spray of gravel reading as a
    // scattering of hard flakes rather than a cloud of little spheres.
    vec3 R = camRightWS();
    vec3 U = camUpWS();
    vec3 F = camFwdWS();
    vec3 N = normalize(R * vQuad.x * 0.55 + U * vQuad.y * 0.55 + F * 1.0);

    float ndlRaw = dot(N, uSunDir);
    float ndl = ndlRaw * 0.5 + 0.5;
    ndl -= drawnShade * 0.34;

    float shadow = sunShadow(vWorldPos, N, vViewDist, saturate1(ndlRaw));
    ndl *= mix(0.55, 1.0, shadow);

    vec3 col = uBand0;
    col = mix(col, uBand1, fxBandStep(ndl, uBandT.x, 0.012));
    col = mix(col, uBand2, fxBandStep(ndl, uBandT.y, 0.012));
    col *= vTint;
    col = mix(col, uInk, isInk);

    vec3 viewDir = normalize(vWorldPos - uCameraPos);
    col = applyQuantizedFog(col, vViewDist, viewDir, gl_FragCoord.xy);

    fragColor = vec4(col, vAlpha * uOpacity);
  }
`;

// ─────────────────────────────────────────────────────────────────────────────
// Per-kind physical character
// ─────────────────────────────────────────────────────────────────────────────

interface KindProfile {
  drag: number;
  restitution: number;
  /** Tangential velocity retained through a bounce. */
  friction: number;
  maxBounces: number;
  /** Whether the chip dies on first ground contact (water does). */
  dieOnContact: boolean;
  stretch: number;
  tiles: number[];
}

const PROFILES: KindProfile[] = [
  // Scree: light flakes, they skip and skitter, then settle in the trail.
  { drag: 0.55, restitution: 0.34, friction: 0.66, maxBounces: 3, dieOnContact: false, stretch: 0.85, tiles: [0, 1, 2] },
  // Splash: heavy drag, no bounce — water breaks up when it lands.
  { drag: 2.10, restitution: 0.0, friction: 0.0, maxBounces: 0, dieOnContact: true, stretch: 0.7, tiles: [3, 3, 0] },
  // Crash wreckage: heavier, bouncier, tumbling rather than streaking.
  { drag: 0.22, restitution: 0.44, friction: 0.72, maxBounces: 4, dieOnContact: false, stretch: 0.0, tiles: [1, 2, 2] },
];

// ─────────────────────────────────────────────────────────────────────────────
// DebrisSystem
// ─────────────────────────────────────────────────────────────────────────────

export interface DebrisOptions {
  capacity?: number;
  rng?: Rng;
  terrain?: ITerrain | null;
  cullDistance?: number;
}

export class DebrisSystem {
  readonly object: Object3D;
  readonly mesh: Mesh;
  readonly material: ShaderMaterial;

  private pool: QuadParticlePool;
  private rng: Rng;
  private terrain: ITerrain | null;
  private cullDistanceSq: number;
  private haveCamera = false;
  private frame = 0;

  // Instance buffers (uploaded each frame — this system genuinely simulates).
  private iPos: Float32Array;
  private iVel: Float32Array;
  private iData: Float32Array;
  private iTint: Float32Array;

  // CPU-side simulation state, parallel arrays, never reallocated.
  private capacity: number;
  private life: Float32Array;
  private lifeMax: Float32Array;
  private baseSize: Float32Array;
  private spinRate: Float32Array;
  private kind: Uint8Array;
  private bounces: Uint8Array;
  private settled: Uint8Array;
  private groundY: Float32Array;
  private alive: Uint8Array;

  private freeList: Int32Array;
  private freeCount: number;
  private liveCount = 0;

  constructor(opts: DebrisOptions = {}) {
    const capacity = opts.capacity ?? 640;
    this.capacity = capacity;
    this.rng = opts.rng ?? new Rng('fx:debris');
    this.terrain = opts.terrain ?? null;
    const cull = opts.cullDistance ?? 180;
    this.cullDistanceSq = cull * cull;

    this.pool = new QuadParticlePool(capacity, [
      { name: 'aPos', size: 3 },
      { name: 'aVel', size: 3 },
      { name: 'aData', size: 4 },
      { name: 'aTint', size: 4 },
    ]);

    this.iPos = this.pool.array('aPos');
    this.iVel = this.pool.array('aVel');
    this.iData = this.pool.array('aData');
    this.iTint = this.pool.array('aTint');

    this.life = new Float32Array(capacity);
    this.lifeMax = new Float32Array(capacity);
    this.baseSize = new Float32Array(capacity);
    this.spinRate = new Float32Array(capacity);
    this.kind = new Uint8Array(capacity);
    this.bounces = new Uint8Array(capacity);
    this.settled = new Uint8Array(capacity);
    this.groundY = new Float32Array(capacity);
    this.alive = new Uint8Array(capacity);

    this.freeList = new Int32Array(capacity);
    for (let i = 0; i < capacity; i++) this.freeList[i] = capacity - 1 - i;
    this.freeCount = capacity;

    // Rock ramp for the bands: debris is stone by default and the per-instance
    // tint moves it to whatever the surface actually is.
    const b0 = RAMPS.rock.colors[0];
    const b1 = RAMPS.rock.colors[2];
    const b2 = RAMPS.rock.colors[3];

    this.material = new ShaderMaterial({
      glslVersion: GLSL3,
      uniforms: {
        ...globalUniformBlock(),
        uAtlas: { value: chipAtlas() },
        uBand0: { value: b0.clone() },
        uBand1: { value: b1.clone() },
        uBand2: { value: b2.clone() },
        uBandT: { value: new Vector2(0.34, 0.70) },
        uInk: { value: INK.clone() },
        uOpacity: { value: 1.0 },
      },
      vertexShader: DEBRIS_VERT,
      fragmentShader: DEBRIS_FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: NormalBlending,
      side: DoubleSide,
    });
    this.material.name = 'fx:debris';

    this.mesh = new Mesh(this.pool.geometry, this.material);
    this.mesh.name = 'fx:debris';
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.renderOrder = 19;
    this.mesh.userData.fxTransparent = true;
    this.mesh.userData.nprSkipPrepass = true;

    this.object = new Object3D();
    this.object.name = 'fx:debris:group';
    this.object.add(this.mesh);

    // This system owns its own free list rather than a ring, so it publishes
    // the full instance count once. Dead slots cost four early-out vertices
    // each and never reach the rasteriser.
    this.pool.setUsed(capacity);
  }

  setTerrain(t: ITerrain | null): void {
    this.terrain = t;
  }

  get activeCount(): number {
    return this.liveCount;
  }

  // ── Simulation ────────────────────────────────────────────────────────────

  /** `dt` must be the SCALED dt: a frozen frame must freeze the gravel too. */
  update(dt: number, camera: PerspectiveCamera): void {
    camera.getWorldPosition(_camPos);
    this.haveCamera = true;
    this.frame++;

    if (dt > 0 && this.liveCount > 0) this.step(dt);
    this.pool.markAll();
    this.pool.flush();
  }

  private step(dt: number): void {
    const g = BIKE.gravity;
    const terrain = this.terrain;
    let live = 0;

    for (let i = 0; i < this.capacity; i++) {
      if (!this.alive[i]) continue;
      live++;

      const i3 = i * 3;
      const i4 = i * 4;
      const k = this.kind[i];
      const prof = PROFILES[k];

      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.free(i);
        live--;
        continue;
      }

      if (!this.settled[i]) {
        // Linear drag as an exponential decay, applied exactly rather than
        // Euler-stepped so a 30fps hitch cannot fling a chip across the map.
        const decay = Math.exp(-prof.drag * dt);
        this.iVel[i3] *= decay;
        this.iVel[i3 + 1] = (this.iVel[i3 + 1] - g * dt) * decay;
        this.iVel[i3 + 2] *= decay;

        this.iPos[i3] += this.iVel[i3] * dt;
        this.iPos[i3 + 1] += this.iVel[i3 + 1] * dt;
        this.iPos[i3 + 2] += this.iVel[i3 + 2] * dt;

        this.iData[i4 + 1] += this.spinRate[i] * dt;

        if (terrain) {
          // Ground height is re-queried every frame while the chip is close to
          // it, and only every fourth frame while it is well clear. Gravel in
          // mid-arc does not need a 120Hz-accurate floor, and this quarters the
          // heightfield sampling cost for a full 640-chip spray.
          const near = this.iPos[i3 + 1] - this.groundY[i] < 3.0;
          if (near || (i + this.frame) % 4 === 0) {
            this.groundY[i] = terrain.heightAt(this.iPos[i3], this.iPos[i3 + 2]);
          }

          const rest = this.groundY[i] + this.baseSize[i] * 0.45;
          if (this.iPos[i3 + 1] <= rest && this.iVel[i3 + 1] <= 0) {
            if (prof.dieOnContact) {
              // Water does not bounce — it breaks up. Collapse it fast.
              this.iPos[i3 + 1] = rest;
              this.life[i] = Math.min(this.life[i], 0.12);
              this.settled[i] = 1;
              this.iVel[i3] = this.iVel[i3 + 1] = this.iVel[i3 + 2] = 0;
            } else {
              this.iPos[i3 + 1] = rest;
              this.bounces[i]++;
              const vy = -this.iVel[i3 + 1] * prof.restitution;
              this.iVel[i3] *= prof.friction;
              this.iVel[i3 + 2] *= prof.friction;
              this.iVel[i3 + 1] = vy;
              this.spinRate[i] *= 0.55;

              const speedSq =
                this.iVel[i3] * this.iVel[i3] +
                this.iVel[i3 + 1] * this.iVel[i3 + 1] +
                this.iVel[i3 + 2] * this.iVel[i3 + 2];
              if (speedSq < 0.55 || this.bounces[i] > prof.maxBounces) {
                // Settled. Leave it lying on the ground for a beat — a scatter
                // of stones left in the trail after a spray is most of what
                // makes the spray look like it moved real material.
                this.settled[i] = 1;
                this.iVel[i3] = this.iVel[i3 + 1] = this.iVel[i3 + 2] = 0;
                this.life[i] = Math.min(this.life[i], 0.75);
              }
            }
          }
        } else if (this.iPos[i3 + 1] < -400) {
          this.free(i);
          live--;
          continue;
        }
      }

      // Opacity: hold at full for most of the life, then three hard steps out.
      // Same animator convention as the dust, on a coarser grid because a chip
      // is a smaller shape and needs fewer holds to read.
      const u = 1 - this.life[i] / Math.max(this.lifeMax[i], 1e-3);
      const fade = clamp01((1 - u) * 2.6);
      this.iData[i4 + 2] = Math.ceil(fade * 3) / 3;
    }

    this.liveCount = live;
  }

  private free(i: number): void {
    this.alive[i] = 0;
    this.settled[i] = 0;
    this.bounces[i] = 0;
    this.iData[i * 4 + 2] = 0;
    this.iData[i * 4] = 0;
    if (this.freeCount < this.capacity) this.freeList[this.freeCount++] = i;
  }

  private alloc(): number {
    if (this.freeCount <= 0) return -1;
    const i = this.freeList[--this.freeCount];
    this.alive[i] = 1;
    this.settled[i] = 0;
    this.bounces[i] = 0;
    this.liveCount++;
    return i;
  }

  private tooFar(x: number, y: number, z: number): boolean {
    if (!this.haveCamera) return false;
    const dx = x - _camPos.x;
    const dy = y - _camPos.y;
    const dz = z - _camPos.z;
    return dx * dx + dy * dy + dz * dz > this.cullDistanceSq;
  }

  private basis(normal: Vector3): void {
    _n.copy(normal);
    if (_n.lengthSq() < 1e-8) _n.set(0, 1, 0);
    else _n.normalize();
    if (Math.abs(_n.y) < 0.9) _t.set(0, 1, 0);
    else _t.set(1, 0, 0);
    _b.crossVectors(_n, _t).normalize();
    _t.crossVectors(_b, _n).normalize();
  }

  private spawn(
    px: number, py: number, pz: number,
    vx: number, vy: number, vz: number,
    kind: number, size: number, life: number, spin: number,
    tint: Color,
  ): void {
    const i = this.alloc();
    if (i < 0) return;
    const prof = PROFILES[kind];
    const i3 = i * 3;
    const i4 = i * 4;

    this.iPos[i3] = px;
    this.iPos[i3 + 1] = py;
    this.iPos[i3 + 2] = pz;
    this.iVel[i3] = vx;
    this.iVel[i3 + 1] = vy;
    this.iVel[i3 + 2] = vz;

    this.iData[i4] = size;
    this.iData[i4 + 1] = this.rng.range(0, Math.PI * 2);
    this.iData[i4 + 2] = 1;
    this.iData[i4 + 3] = this.rng.pick(prof.tiles);

    this.iTint[i4] = tint.r;
    this.iTint[i4 + 1] = tint.g;
    this.iTint[i4 + 2] = tint.b;
    this.iTint[i4 + 3] = prof.stretch;

    this.kind[i] = kind;
    this.baseSize[i] = size;
    this.life[i] = life;
    this.lifeMax[i] = life;
    this.spinRate[i] = spin;
    // Seed the cached ground below the chip so the first frame always queries.
    this.groundY[i] = py - 100;
  }

  // ── Public emission ───────────────────────────────────────────────────────

  /**
   * Gravel kicked out of a contact patch. `amount` 0..1 is the slip/impact
   * severity; the count and the launch speed both scale off it.
   */
  screeSpray(
    position: Vector3,
    normal: Vector3,
    velocity: Vector3,
    amount: number,
    surface: SurfaceProperties,
  ): void {
    const a = clamp01(amount);
    if (a <= 0.02) return;
    if (this.tooFar(position.x, position.y, position.z)) return;

    const tint = dustTintFor(surface.kind);
    const water = surface.kind === SurfaceKind.Water;
    const kind = water ? DEBRIS_SPLASH : DEBRIS_SCREE;
    const count = clamp(Math.round((2 + a * 14) * clamp(surface.dustAmount, 0.35, 1.8)), 1, 22);

    this.basis(normal);

    for (let i = 0; i < count; i++) {
      const ang = this.rng.range(0, Math.PI * 2);
      const radial = this.rng.range(0.4, 1.0);
      const up = this.rng.range(0.35, 1.05);
      const speed = (2.5 + a * 11) * this.rng.range(0.55, 1.4);

      _d.copy(_t).multiplyScalar(Math.cos(ang) * radial)
        .addScaledVector(_b, Math.sin(ang) * radial)
        .addScaledVector(_n, up)
        .multiplyScalar(speed);
      // Thrown backward out from under the wheel.
      _d.addScaledVector(velocity, -0.30);

      const jr = this.rng.range(0, 0.22);
      const ja = this.rng.range(0, Math.PI * 2);
      _p.copy(position)
        .addScaledVector(_t, Math.cos(ja) * jr)
        .addScaledVector(_b, Math.sin(ja) * jr)
        .addScaledVector(_n, 0.05);

      const size = water ? this.rng.range(0.055, 0.15) : this.rng.range(0.038, 0.115);
      const life = water ? this.rng.range(0.35, 0.75) : this.rng.range(1.1, 2.3);
      this.spawn(_p.x, _p.y, _p.z, _d.x, _d.y, _d.z, kind, size, life, this.rng.signed() * 9, tint);
    }
  }

  /**
   * Water thrown out of the stream bed. Sheets rather than droplets: a wide
   * low-angle fan on the outside of the wheel, plus a few high arcs.
   */
  splash(position: Vector3, normal: Vector3, velocity: Vector3, amount: number): void {
    const a = clamp01(amount);
    if (a <= 0.02) return;
    if (this.tooFar(position.x, position.y, position.z)) return;

    const tint = dustTintFor(SurfaceKind.Water);
    const count = clamp(Math.round(4 + a * 20), 2, 26);
    this.basis(normal);

    for (let i = 0; i < count; i++) {
      const high = i % 5 === 0;
      const ang = this.rng.range(0, Math.PI * 2);
      const radial = high ? this.rng.range(0.3, 0.7) : this.rng.range(0.85, 1.25);
      const up = high ? this.rng.range(1.1, 1.9) : this.rng.range(0.25, 0.7);
      const speed = (2.0 + a * 8.5) * this.rng.range(0.7, 1.35);

      _d.copy(_t).multiplyScalar(Math.cos(ang) * radial)
        .addScaledVector(_b, Math.sin(ang) * radial)
        .addScaledVector(_n, up)
        .multiplyScalar(speed);
      _d.addScaledVector(velocity, 0.22);

      _p.copy(position).addScaledVector(_n, this.rng.range(0.02, 0.12));
      const size = this.rng.range(0.07, 0.2) * (high ? 0.7 : 1.0);
      const life = this.rng.range(0.4, 0.85);
      this.spawn(_p.x, _p.y, _p.z, _d.x, _d.y, _d.z, DEBRIS_SPLASH, size, life, this.rng.signed() * 5, tint);
    }
  }

  /**
   * Crash wreckage. Bigger, slower, longer-lived, tumbling — and thrown along
   * the crash impulse so the debris pattern reads the direction of the hit.
   */
  crashDebris(
    position: Vector3,
    velocity: Vector3,
    direction: Vector3,
    severity: number,
    surface: SurfaceProperties,
  ): void {
    const s = clamp01(severity);
    if (this.tooFar(position.x, position.y, position.z)) return;

    const tint = dustTintFor(surface.kind);
    const count = clamp(Math.round(8 + s * 22), 4, 34);

    _n.copy(direction);
    if (_n.lengthSq() < 1e-6) _n.set(0, 1, 0);
    else _n.normalize();
    this.basis(_n);

    for (let i = 0; i < count; i++) {
      const [ox, oy, oz] = this.rng.onSphere();
      _d.set(ox, oy, oz);
      // Bias the cone into the impulse direction and upward — wreckage sprays
      // away from the hit, it does not explode symmetrically.
      _d.addScaledVector(_n, 0.9).add(_UP_BIAS);
      _d.normalize().multiplyScalar((2.5 + s * 9) * this.rng.range(0.5, 1.5));
      _d.addScaledVector(velocity, 0.34);

      const jr = this.rng.range(0, 0.5);
      const ja = this.rng.range(0, Math.PI * 2);
      _p.copy(position)
        .addScaledVector(_t, Math.cos(ja) * jr)
        .addScaledVector(_b, Math.sin(ja) * jr);
      _p.y += this.rng.range(0.05, 0.65);

      const size = this.rng.range(0.09, 0.26);
      const life = this.rng.range(1.6, 3.2);
      this.spawn(_p.x, _p.y, _p.z, _d.x, _d.y, _d.z, DEBRIS_CRASH, size, life, this.rng.signed() * 13, tint);
    }
  }

  clear(): void {
    for (let i = 0; i < this.capacity; i++) {
      if (this.alive[i]) this.free(i);
    }
    this.liveCount = 0;
    this.pool.markAll();
  }

  dispose(): void {
    this.pool.dispose();
    this.material.dispose();
    this.object.removeFromParent();
  }
}
