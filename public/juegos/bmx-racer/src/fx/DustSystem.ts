/**
 * DustSystem — hard-edged cel dust.
 *
 * The single most common way a stylised game betrays itself is its particles.
 * Everything else can be banded, inked and flattened, and then a soft radial
 * alpha sprite drifts across the frame and the whole illusion collapses: soft
 * gradients are a *photographic* signal, and there is exactly one of them in
 * the picture.
 *
 * So none of this is a soft sprite. Every puff here is:
 *
 *  • a CLOSED DRAWN SHAPE with an ink contour (dustPuffSet() from
 *    GeneratedTextures — cartoon-cloud lobes with a black ring), never a blur;
 *  • LIT with the same banded ramp as everything else in the world, using a
 *    sphere-impostor normal reconstructed in the fragment shader, so a puff on
 *    the shadow side of the ridge goes violet exactly like the rock does;
 *  • ANIMATED ON A STEP GRID. Scale, rotation and opacity are all quantised to
 *    4–7 discrete holds across the puff's life, with a per-instance phase
 *    offset so they don't all cut on the same frame. An animator does not fade
 *    smoke smoothly — they hold a drawing, then cut to the next one. Continuous
 *    interpolation is the tell.
 *
 * The whole system is ONE draw call: an InstancedBufferGeometry quad with
 * per-instance origin / velocity / life / shape / tint, integrated analytically
 * in the vertex shader (closed-form linear drag), so a burst costs a handful of
 * float writes and zero per-frame CPU simulation.
 *
 * Note on the mesh type: this is an InstancedBufferGeometry on a plain Mesh
 * rather than an InstancedMesh. three renders both with drawElementsInstanced,
 * but InstancedMesh would force a 16-float instanceMatrix per particle that we
 * would never read — the billboard basis comes from the view matrix and the
 * transform is three floats. Same one draw call, a third of the bandwidth.
 */

import {
  CanvasTexture,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  Float32BufferAttribute,
  GLSL3,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  NormalBlending,
  Object3D,
  PerspectiveCamera,
  ShaderMaterial,
  Sphere,
  SRGBColorSpace,
  Texture,
  Vector2,
  Vector3,
  Vector4,
} from 'three';

import { SurfaceKind, type SurfaceProperties } from '../game/Contracts';
import { Rng } from '../core/RNG';
import { clamp, clamp01 } from '../core/MathX';
import { dustPuffSet } from '../npr/GeneratedTextures';
import { globalUniformBlock } from '../npr/NprGlobals';
import { INK, RAMPS, SUN_RIM_COLOR } from '../npr/Palette';
import { GLSL_COMMON, GLSL_FOG, GLSL_FRAG_OUT, GLSL_GLOBAL_UNIFORMS, GLSL_SHADOW } from '../npr/ShaderChunks';

// ─────────────────────────────────────────────────────────────────────────────
// Module-scope scratch. Nothing in an update path may allocate.
// ─────────────────────────────────────────────────────────────────────────────
const _n = new Vector3();
const _t = new Vector3();
const _b = new Vector3();
const _d = new Vector3();
const _v = new Vector3();
const _camPos = new Vector3();

/** Puff kinds. The kind selects step count, drag and buoyancy in the shader. */
export const DUST_SKID = 0;
export const DUST_SPRAY = 1;
export const DUST_PLUME = 2;

// ─────────────────────────────────────────────────────────────────────────────
// Shared GLSL: the billboard basis, pulled straight out of the view matrix.
// ─────────────────────────────────────────────────────────────────────────────
/**
 * viewMatrix is the world->view transform, so the ROWS of its upper 3x3 are the
 * camera's world-space axes. Reading them here means a camera-facing quad costs
 * no uniforms and no CPU work at all, and can never drift out of sync with the
 * camera the frame is actually being rendered from.
 *
 * camFwdWS points from the scene TOWARD the camera (+Z in view space), which is
 * exactly the direction a sphere-impostor normal should bulge.
 */
export const GLSL_BILLBOARD = /* glsl */ `
  vec3 camRightWS() { return vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]); }
  vec3 camUpWS()    { return vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]); }
  vec3 camFwdWS()   { return vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]); }
`;

/**
 * The same anti-aliased hard band edge the whole game uses, restated locally.
 *
 * It is deliberately a copy of bandStep() from GLSL_CEL_CORE rather than an
 * import of that chunk: GLSL_CEL_CORE also declares evalRamp/applyHatch, which
 * would drag in the entire GLSL_RAMP_UNIFORMS block (uBandColor[4], the hatch
 * atlas, the matcaps) that a two-band particle has no use for. The maths is
 * identical on purpose — dust must alias exactly the way terrain aliases, or it
 * reads as a different material system laid over the top.
 */
export const GLSL_BAND_STEP = /* glsl */ `
  float fxBandStep(float x, float threshold, float softness) {
    float w = max(fwidth(x) * 0.75, softness);
    return smoothstep(threshold - w, threshold + w, x);
  }
`;

// ─────────────────────────────────────────────────────────────────────────────
// Instance pool
// ─────────────────────────────────────────────────────────────────────────────

export interface AttribSpec {
  name: string;
  /** Components per instance: 1, 2, 3 or 4. */
  size: number;
}

/**
 * A fixed-capacity ring of instanced quads.
 *
 * Emission writes floats into pre-allocated Float32Arrays and records the
 * touched range; flush() uploads only that range. Zero allocation per emission,
 * and a 20-puff burst uploads ~1.4 kB rather than the whole 80 kB buffer.
 */
export class QuadParticlePool {
  readonly capacity: number;
  readonly geometry: InstancedBufferGeometry;
  private readonly arrays = new Map<string, Float32Array>();
  private readonly attribs = new Map<string, InstancedBufferAttribute>();

  private head = 0;
  /** High-water mark — instanceCount only ever needs to cover what we've used. */
  private used = 0;
  private lo = Number.POSITIVE_INFINITY;
  private hi = -1;

  constructor(capacity: number, specs: AttribSpec[]) {
    this.capacity = capacity;

    const geo = new InstancedBufferGeometry();
    // Unit quad in XY, centred. Corners are +/-1 so the vertex shader can treat
    // position.xy directly as the billboard offset.
    geo.setAttribute('position', new Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    geo.setAttribute('uv', new Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    geo.setIndex([0, 1, 2, 0, 2, 3]);

    for (const s of specs) {
      const arr = new Float32Array(capacity * s.size);
      const attr = new InstancedBufferAttribute(arr, s.size);
      attr.setUsage(DynamicDrawUsage);
      geo.setAttribute(s.name, attr);
      this.arrays.set(s.name, arr);
      this.attribs.set(s.name, attr);
    }

    geo.instanceCount = 0;
    // Particles live wherever the action is; a static bounding sphere would be
    // a lie. We cull them by emission distance on the CPU instead.
    geo.boundingSphere = new Sphere(new Vector3(), 1e6);
    this.geometry = geo;
  }

  array(name: string): Float32Array {
    const a = this.arrays.get(name);
    if (!a) throw new Error(`[fx] no particle attribute "${name}"`);
    return a;
  }

  /** Claim the next ring slot. Oldest live particle is silently recycled. */
  allocRing(): number {
    const i = this.head;
    this.head = (this.head + 1) % this.capacity;
    if (i >= this.used) this.used = i + 1;
    this.touch(i);
    return i;
  }

  touch(i: number): void {
    if (i < this.lo) this.lo = i;
    if (i > this.hi) this.hi = i;
  }

  markAll(): void {
    this.lo = 0;
    this.hi = this.capacity - 1;
  }

  /**
   * Publish a live instance count directly. Ring-allocated systems get this
   * for free from allocRing(); systems that own their own free list (Debris)
   * set the high-water mark themselves.
   */
  setUsed(n: number): void {
    this.used = Math.min(Math.max(n, this.used), this.capacity);
  }

  /** Upload the dirty range and publish the live instance count. */
  flush(): void {
    this.geometry.instanceCount = this.used;
    if (this.hi < this.lo) return;
    const count = this.hi - this.lo + 1;
    for (const attr of this.attribs.values()) {
      attr.clearUpdateRanges();
      attr.addUpdateRange(this.lo * attr.itemSize, count * attr.itemSize);
      attr.needsUpdate = true;
    }
    this.lo = Number.POSITIVE_INFINITY;
    this.hi = -1;
  }

  dispose(): void {
    this.geometry.dispose();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Puff atlas
// ─────────────────────────────────────────────────────────────────────────────

let _puffAtlas: Texture | null = null;

/**
 * Pack the four generated puff variants into one 2x2 atlas so the whole dust
 * system stays a single draw call.
 *
 * Each 128px puff is blitted at NATIVE SIZE into the centre of a 256px cell.
 * That padding matters twice over: it stops mip generation bleeding one puff's
 * ink ring into its neighbour, and it means no resampling happens — the puff's
 * alpha is a hard binary cut and any scaling here would soften the contour,
 * which is the one thing this system exists to avoid.
 */
export function puffAtlas(): Texture {
  if (_puffAtlas) return _puffAtlas;

  const CELL = 256;
  const SRC = 128;
  const cv = document.createElement('canvas');
  cv.width = CELL * 2;
  cv.height = CELL * 2;
  const ctx = cv.getContext('2d')!;
  ctx.clearRect(0, 0, cv.width, cv.height);

  const puffs = dustPuffSet();
  for (let i = 0; i < 4; i++) {
    const src = puffs[i].image as HTMLCanvasElement;
    const cx = (i % 2) * CELL + (CELL - SRC) * 0.5;
    const cy = Math.floor(i / 2) * CELL + (CELL - SRC) * 0.5;
    ctx.drawImage(src, cx, cy);
  }

  const tex = new CanvasTexture(cv);
  tex.name = 'fx:puff-atlas';
  tex.colorSpace = SRGBColorSpace;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.magFilter = LinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  _puffAtlas = tex;
  return tex;
}

// ─────────────────────────────────────────────────────────────────────────────
// Surface tinting
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Dust colour per surface, taken from the committed ramps — nothing invented.
 *
 * The tint is HUE-NORMALISED (divided by its own luminance) before it reaches
 * the shader, because it multiplies over a ramp that already carries the value
 * structure. Multiplying a mid-value band by a mid-value colour twice is how
 * you get mud; normalising means the surface decides the hue and the ramp keeps
 * deciding the light.
 */
const _tintCache = new Map<SurfaceKind, Color>();
function normalisedTint(src: Color): Color {
  const c = src.clone();
  const l = Math.max(0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b, 1e-3);
  c.multiplyScalar(1 / l);
  c.r = Math.min(c.r, 1.7);
  c.g = Math.min(c.g, 1.7);
  c.b = Math.min(c.b, 1.7);
  return c;
}

export function dustTintFor(kind: SurfaceKind): Color {
  let c = _tintCache.get(kind);
  if (c) return c;
  switch (kind) {
    case SurfaceKind.Rock: c = normalisedTint(RAMPS.rock.colors[2]); break;
    case SurfaceKind.Dirt: c = normalisedTint(RAMPS.dirt.colors[2]); break;
    case SurfaceKind.Grass: c = normalisedTint(RAMPS.grass.colors[2]); break;
    case SurfaceKind.Scree: c = normalisedTint(RAMPS.scree.colors[2]); break;
    case SurfaceKind.Snow: c = normalisedTint(RAMPS.snow.colors[1]); break;
    case SurfaceKind.Water: c = normalisedTint(RAMPS.water.colors[2]); break;
    case SurfaceKind.Trail: c = normalisedTint(RAMPS.trail.colors[2]); break;
    default: c = normalisedTint(RAMPS.dirt.colors[2]); break;
  }
  _tintCache.set(kind, c);
  return c;
}

// ─────────────────────────────────────────────────────────────────────────────
// Shaders
// ─────────────────────────────────────────────────────────────────────────────

const DUST_VERT = /* glsl */ `
  precision highp float;
  ${GLSL_COMMON}
  ${GLSL_GLOBAL_UNIFORMS}
  ${GLSL_BILLBOARD}

  // The FX clock is NOT uTime. uTime is engine-elapsed and keeps running during
  // an impact-frame freeze; ages driven by it would let dust drift through a
  // hold that is supposed to stop the world dead. uFxTime advances by the
  // SCALED dt, so a freeze freezes the smoke too.
  uniform float uFxTime;
  uniform float uSizeScale;

  // The shot, published by the CameraDirector every frame.
  //
  //   uSubject.xyz  the point the shot is framed on, world space
  //   uSubject.w    the radius that must stay legible around it; 0 disables
  //   uLensBand     the fraction of the lens-to-subject span over which a puff
  //                 stops being "in the way" and starts being "part of the shot"
  //   uNearAng      angular radius (size / distance) at which a puff begins to
  //                 dither out, and the one at which it is gone
  uniform vec4  uSubject;
  uniform vec2  uLensBand;
  uniform vec2  uNearAng;

  in vec3 aOrigin;
  in vec3 aVel;
  in vec4 aParams;   // x birthTime, y 1/life, z seed01, w kind
  in vec4 aShape;    // x startScale, y growth, z spinTotal, w spin0
  in vec3 aTint;

  out vec2  vUv;
  out vec2  vQuad;
  out vec3  vTint;
  out float vAlpha;
  out float vInk;
  out vec3  vWorldPos;
  out float vViewDist;
  out float vNear;

  void main() {
    // Defaults so a culled particle never leaves a varying undefined.
    vUv = vec2(0.0);
    vQuad = vec2(0.0);
    vTint = aTint;
    vAlpha = 0.0;
    vInk = 0.0;
    vWorldPos = aOrigin;
    vViewDist = 1.0;
    vNear = 0.0;

    float t = uFxTime - aParams.x;
    float age = t * aParams.y;
    if (age < 0.0 || age >= 1.0) {
      // Collapse dead instances outside the clip volume. Cheaper than any
      // CPU-side compaction and completely branch-free downstream.
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      return;
    }

    float kind = aParams.w;
    float isPlume = step(1.5, kind);
    float isSpray = step(0.5, kind) * (1.0 - isPlume);

    // ── The step grid ────────────────────────────────────────────────────────
    // Scale, rotation and opacity all read from the SAME quantised age, so each
    // puff visibly holds a drawing and then cuts to the next one. The per-
    // instance phase offset is what stops a whole burst cutting in unison,
    // which would read as a strobe rather than as animation.
    float steps = mix(mix(5.0, 4.0, isSpray), 7.0, isPlume);
    float phase = fract(aParams.z * 17.13);
    float q = clamp(floor(age * steps + phase * 0.7) / steps, 0.0, 1.0);

    // ── Motion ───────────────────────────────────────────────────────────────
    // Closed-form linear drag: p = p0 + v0 * (1 - e^-kt) / k. Analytic rather
    // than integrated so there is no per-frame CPU cost and no drift between
    // a 60Hz and a 120Hz machine.
    float drag = mix(2.9, 1.6, isPlume);
    vec3 p = aOrigin + aVel * ((1.0 - exp(-drag * t)) / drag);

    // ── LIFT, THEN SETTLE ────────────────────────────────────────────────────
    //
    // This term used to be rise * t * (1 - 0.55 * age) — MONOTONIC. It only
    // ever went up, and with the seed velocity's own vertical component behind
    // it the measured result was a puff centroid 2.7 m above the rear contact
    // patch on the scree run and individual puffs 5.5 m up: dust level with the
    // rider's head, then above the HUD. A wheel does not make a bonfire. The
    // whole silhouette of the effect is a plume that hangs LOW and is left
    // BEHIND, and the far end of it is the part that has to be on the floor —
    // it is also the oldest part, so a monotonic rise puts the tail of the
    // trail in the sky and the trail reads as ending wherever it lifts out of
    // the ground plane. Measured: the scree trail "died" at ~8 m for exactly
    // this reason while its puffs were still alive at 20 m.
    //
    // So: a small saturating lift on the puff's own turbulence, and a
    // quadratic settle that takes it back. The lift asymptotes at ~0.4 m within
    // a third of a second; the settle is negligible early and eats all of it by
    // the end of life. Net height over life is a low arc that ends on the
    // ground, which is what a dispersing dust cloud actually does.
    // The correction above was made and MEASURED, and then measured again with
    // the right ruler. tools/capture/_dustgeo.mjs replays this arithmetic on the
    // live instance buffer and reports height above the terrain UNDER EACH PUFF
    // — which is the quantity the screen-space complaint was a proxy for, and
    // not the same thing as height above the rider's CURRENT contact patch: on
    // a descent that drops 8 m in two seconds, dust pinned perfectly to the
    // floor still reads as "3.5 m above the wheel" against the wheel's new
    // position. On the scree-speed run the numbers came back 0.24-0.29 m AGL, max
    // 0.53, with not one puff in 136 above 1.5 m.
    //
    // Which was the fix, and slightly too much of it. A plume whose every
    // member sits at a quarter of a metre for its whole life has no BODY: the
    // measured trail was 33 m long, 0.3 m tall and 0.6 m wide — a rope of
    // beads lying on the ground behind the wheel, which is exactly what the
    // capture shows. Dust that has been in the air for two seconds has climbed;
    // what it must not do is climb AT BIRTH, or start high, or keep climbing
    // forever. So the arc is unchanged in shape and roughly doubled in size,
    // and the settle still eats it: peak is around 0.5 m at mid-life and the
    // tail comes back to the deck. Knee height on the oldest puffs, nothing
    // near a hub, let alone a helmet.
    float rise = mix(0.30, 0.62, aParams.z) * mix(0.55, 1.0, isPlume);
    float lift = rise * (1.0 - exp(-2.4 * t));
    float settle = mix(0.20, 0.38, fract(aParams.z * 5.77)) * age * age;
    p.y += lift - settle;

    // ── LATERAL SPREAD ───────────────────────────────────────────────────────
    // A trail that keeps its birth width for its whole life is a tube, and a
    // tube reads as a pipe rather than as smoke. Each puff wanders off a
    // per-instance world-space bearing so the spread is invisible at the contact
    // patch and obvious at the tail. World space, not camera space, or the whole
    // plume swims when the camera moves.
    //
    // MEASURED, AND IT WAS A PIPE. mix(0.30, 0.95) * age^2 gives a mean offset
    // of 0.43 m at the very end of life, of which only ~0.64 is across the
    // direction of travel; _dustgeo reported a mean lateral of 0.09 m at birth
    // rising to 0.29 m at the tail, with a single worst case of 0.88. Set that
    // against puffs ~0.4 m across and a trail 33 m long and the plume is one
    // puff wide down its whole length — the "single-file column of round puffs"
    // the review measured, and the reason it reads as beads on a string rather
    // than as a cloud.
    //
    // Three times the amplitude, and age^1.5 rather than age^2 so the fan opens
    // early enough to be a cone instead of a rope with a flare on the end. The
    // tail now spreads 0.7-2.5 m off the centreline, which against a 0.53 m
    // wheel is a plume two to five wheels wide where it is oldest and still
    // pinned to the tyre where it is born.
    float bear = fract(aParams.z * 31.73) * TAU;
    float ageSpread = age * sqrt(age);
    float spread = mix(0.40, 1.30, fract(aParams.z * 12.41)) * ageSpread * mix(0.85, 1.35, isPlume);
    p.x += cos(bear) * spread;
    p.z += sin(bear) * spread;

    float sz = aShape.x * (1.0 + aShape.y * q) * uSizeScale;
    float ang = aShape.w + aShape.z * q;

    // ── Opacity ──────────────────────────────────────────────────────────────
    // Three hard levels and a cut: 1, 2/3, 1/3, gone. An animator holds the
    // drawing opaque and then takes it out in two beats; they do not fade it.
    //
    // This used to square the fade before quantising, which sounds like the
    // same idea and is not: squaring drove the *middle* of the puff's life to
    // 0.04-0.16, and ceil()x4 floored all of that at 0.25. A puff therefore
    // spent most of its visible existence at a quarter opacity, in a hue taken
    // from the very surface it was kicked off — dust the same colour as the
    // ground, at 25%, over a fogged mid-value scree field, is below the
    // threshold at which anything is a picture element. Measured against a
    // dust-free frame the peak channel delta was single digits out of 255.
    // Linear fade, quantised to quarters, holds the puff opaque through the
    // first half of its life, which is when it is meant to be read.
    //
    // AND IT REACHES ZERO. ceil(fade * 3) / 3 never did: the smallest value
    // it can return for any live puff is 1/3, so every puff in the game was
    // cut out of the frame at a third of full opacity with a full-strength ink
    // ring still round it (see vInk below). Measured on the scree trail, that
    // is "a column of identically-opaque round puffs with no fade" — because
    // there genuinely was no fade, only a cut. ROUNDING to quarters gives four
    // hard holds that end at nothing, which is an animator taking a cloud out
    // in four beats rather than deleting it.
    float fade = 1.0 - q;
    vAlpha = floor(clamp(fade, 0.0, 1.0) * 4.0 + 0.5) / 4.0;

    // ── The contour's own staircase ──────────────────────────────────────────
    // THE LINE OUTLIVES THE FILL — but it does not outlive the puff. Holding
    // the ink at a flat 0.78 for the whole life (what the fragment stage used
    // to do unconditionally) means the last thing you see of every puff is a
    // hard black ring at full strength popping out of existence, which is the
    // single loudest artefact a particle system can have. It holds through the
    // first 55% of life and then steps out over three holds of its own, always
    // above the fill, so the shape stays drawn while it dissolves.
    float inkFade = 1.0 - smoothstep(0.55, 1.0, q);
    vInk = floor(clamp(inkFade, 0.0, 1.0) * 3.0 + 0.5) / 3.0 * 0.78;

    // ── Billboard ────────────────────────────────────────────────────────────
    vec3 R = camRightWS();
    vec3 U = camUpWS();
    float ca = cos(ang), sa = sin(ang);
    vec2 rq = vec2(position.x * ca - position.y * sa, position.x * sa + position.y * ca);
    vec3 wpos = p + (R * rq.x + U * rq.y) * sz;

    // vQuad is the ROTATED offset: the impostor normal must follow the puff's
    // actual screen footprint, while vUv stays unrotated so the drawn shape
    // spins with the sprite.
    vQuad = rq;

    float tile = floor(fract(aParams.z * 4.0 + 0.13) * 3.999);
    vec2 tileOff = vec2(mod(tile, 2.0), floor(tile * 0.5)) * 0.5;
    vUv = tileOff + uv * 0.5;

    vTint = aTint;
    vWorldPos = wpos;
    vViewDist = length(wpos - uCameraPos);

    // ── Proximity: how much of the frame is this puff about to own? ──────────
    //
    // Measured on the CENTRE of the puff, not on this vertex, so all four
    // corners agree and the quad fades as one drawing rather than developing a
    // gradient across itself.
    //
    // The old test was a fixed distance ramp, 0.85 m to 2.6 m. That is the
    // wrong quantity: what fills the frame is not how near a puff is, it is how
    // near it is RELATIVE TO ITS OWN SIZE. A 0.3 m skid puff at 1.2 m is a
    // detail; a 1.9 m plume at 2.6 m subtends 72 degrees and covers most of a
    // 62-degree lens while passing the distance test cleanly. Fading on the
    // angular radius (size / distance) is scale-invariant and catches both.
    float centreDist = max(length(p - uCameraPos), 1e-4);
    float angRadius = sz / centreDist;
    float nearFade = clamp((uNearAng.y - angRadius) / max(uNearAng.y - uNearAng.x, 1e-3), 0.0, 1.0);

    // ── The lens corridor ────────────────────────────────────────────────────
    //
    // The near fade above only knows about ONE puff at a time, and the failure
    // it cannot see is the one that actually broke the bike portrait: the
    // camera is not inside a puff, it is inside the EMITTER VOLUME, with four
    // to six ordinary-sized puffs strung out between the lens and the rider.
    // Each of them passes the angular test on its own and together they are an
    // opaque wall, and the frame named for the subject does not contain it.
    //
    // So this asks the only question that matters: is this puff between the
    // lens and the subject, and does its disc cover the subject's silhouette?
    // The subject's radius is projected down the corridor (reff) so the test is
    // the honest screen-space overlap rather than a fixed tube, and the whole
    // thing releases as the puff approaches the subject — dust AT the rear
    // wheel is the effect working, dust halfway up the lens is the effect
    // eating the shot. That release is what keeps the trail: it hangs behind
    // and below the wheel, where uLensBand.y has already let go of it.
    float lensFade = 1.0;
    if (uSubject.w > 0.0) {
      vec3 toSub = uSubject.xyz - uCameraPos;
      float subDist = length(toSub);
      if (subDist > 0.35) {
        vec3 toPuff = p - uCameraPos;
        float along = dot(toPuff, toSub) / subDist;
        if (along > 0.0) {
          float perp = sqrt(max(dot(toPuff, toPuff) - along * along, 0.0));
          float s = along / subDist;
          float reff = uSubject.w * clamp(s, 0.0, 1.0);
          float cover = 1.0 - smoothstep(0.0, sz + reff, perp);
          float ahead = 1.0 - smoothstep(uLensBand.x, uLensBand.y, s);
          lensFade = 1.0 - cover * ahead;
        }
      }
    }

    // Quantised to thirds like every other opacity here, so a puff the camera
    // closes on steps out over three holds instead of dissolving — a smooth
    // proximity ramp would be the one continuous alpha in the picture. ROUNDED
    // rather than ceil()'d, because ceil leaves a fully-blocking puff at a
    // third of full opacity, and a third of a screen-filling puff is still a
    // screen-filling puff.
    //
    // It is carried separately from vAlpha rather than folded into it because
    // the ink contour deliberately refuses to follow vAlpha down (see the
    // fragment stage) — folding it in would leave a puff the camera is inside
    // of drawn as a hard black ring across the whole frame, which is worse
    // than the grey disc it replaced.
    vNear = floor(clamp(min(nearFade, lensFade), 0.0, 1.0) * 3.0 + 0.5) / 3.0;
    if (vNear <= 0.0) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      return;
    }

    gl_Position = projectionMatrix * viewMatrix * vec4(wpos, 1.0);
  }
`;

const DUST_FRAG = /* glsl */ `
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
  in float vInk;
  in vec3  vWorldPos;
  in float vViewDist;
  in float vNear;

  void main() {
    vec4 tex = texture(uAtlas, vUv);
    // The puff's alpha is a hard binary cut by construction. Discarding rather
    // than blending the edge is what keeps the contour a drawn line.
    if (tex.a < 0.5) discard;

    float texLum = luma(tex.rgb);
    // The generated puff carries its own ink ring (near-black) and a single
    // hard shadow lobe (#6a6a6a, linear ~0.152). We keep the ring as ink and
    // use the lobe as a BIAS on the lighting term rather than as a second
    // multiply, so the drawn shading and the world lighting agree instead of
    // stacking.
    //
    // The ink test is a BAND STEP at the midpoint between the ring and the
    // lobe, not a step() near zero. That distinction is the difference between
    // an outline that survives and one that evaporates: the atlas is mipped
    // (it has to be — an unmipped binary alpha crawls horribly at distance),
    // and a ~3px ink ring is averaged toward the white fill by mip 1. A
    // step() at 0.035 only catches pixels that are still nearly pure black,
    // so beyond a couple of metres the contour simply stopped existing and
    // the puffs went from drawn shapes to flat blobs. fxBandStep places a
    // crisp, fwidth-antialiased edge on the blurred ramp's half-height
    // contour instead, which is stable at every mip level.
    float isInk = 1.0 - fxBandStep(texLum, 0.048, 0.008);
    float drawnShade = (1.0 - isInk) * (1.0 - smoothstep(0.10, 0.60, texLum));

    // Sphere impostor: reconstruct a bulging normal from the quad footprint so
    // the puff has a real terminator instead of reading as a flat decal.
    vec2 qd = vQuad;
    float r2 = min(dot(qd, qd), 1.0);
    float nz = sqrt(max(0.0, 1.0 - r2));
    vec3 R = camRightWS();
    vec3 U = camUpWS();
    vec3 F = camFwdWS();
    // The 0.35 flattens the bulge. A full unit sphere puts the terminator right
    // on the silhouette and the puff reads as a ball bearing; drawn smoke is
    // much flatter than that.
    vec3 N = normalize(R * qd.x + U * qd.y + F * (nz * 0.9 + 0.35));

    float ndlRaw = dot(N, uSunDir);
    float ndl = ndlRaw * 0.5 + 0.5;
    ndl -= drawnShade * 0.30;

    float shadow = sunShadow(vWorldPos, N, vViewDist, saturate1(ndlRaw));
    ndl *= mix(0.62, 1.0, shadow);

    vec3 col = uBand0;
    col = mix(col, uBand1, fxBandStep(ndl, uBandT.x, 0.014));
    col = mix(col, uBand2, fxBandStep(ndl, uBandT.y, 0.014));
    col *= vTint;
    col = mix(col, uInk, isInk);

    vec3 viewDir = normalize(vWorldPos - uCameraPos);
    col = applyQuantizedFog(col, vViewDist, viewDir, gl_FragCoord.xy);

    // THE LINE OUTLIVES THE FILL. On the last steps of a puff's life the fill
    // drops away, and if the contour drops with it the puff stops being a
    // drawing and becomes precisely the soft translucent smudge this entire
    // system exists to avoid. An animator inking a dispersing cloud keeps the
    // line up and lets the interior go; the shape stays legible right up to
    // the frame it is gone. vInk is that line's own staircase — always at or
    // above the fill, and it reaches zero on the same beat the puff does, so
    // nothing pops out at full strength. See the vertex stage.
    float alpha = mix(vAlpha, max(vAlpha, vInk), isInk) * vNear * uOpacity;

    fragColor = vec4(col, alpha);
  }
`;

// ─────────────────────────────────────────────────────────────────────────────
// DustSystem
// ─────────────────────────────────────────────────────────────────────────────

export interface DustOptions {
  capacity?: number;
  rng?: Rng;
  /** Emission beyond this distance from the camera is skipped entirely. */
  cullDistance?: number;
}

export class DustSystem {
  readonly object: Object3D;
  readonly mesh: Mesh;
  readonly material: ShaderMaterial;

  private pool: QuadParticlePool;
  private rng: Rng;
  private fxTime = 0;
  private cullDistanceSq: number;
  /** Emission culling is disabled until update() has told us where the camera is. */
  private haveCamera = false;

  // Direct handles on the instance arrays, so emission is float writes only.
  private aOrigin: Float32Array;
  private aVel: Float32Array;
  private aParams: Float32Array;
  private aShape: Float32Array;
  private aTint: Float32Array;

  /** Live-ish count for the perf overlay. Approximate: ring slots issued. */
  emittedThisFrame = 0;

  constructor(opts: DustOptions = {}) {
    const capacity = opts.capacity ?? 1100;
    this.rng = opts.rng ?? new Rng('fx:dust');
    const cull = opts.cullDistance ?? 170;
    this.cullDistanceSq = cull * cull;

    this.pool = new QuadParticlePool(capacity, [
      { name: 'aOrigin', size: 3 },
      { name: 'aVel', size: 3 },
      { name: 'aParams', size: 4 },
      { name: 'aShape', size: 4 },
      { name: 'aTint', size: 3 },
    ]);

    this.aOrigin = this.pool.array('aOrigin');
    this.aVel = this.pool.array('aVel');
    this.aParams = this.pool.array('aParams');
    this.aShape = this.pool.array('aShape');
    this.aTint = this.pool.array('aTint');

    // Every slot starts dead. The birth stamp must be far in the PAST in
    // absolute terms, not merely zero: the shader's liveness test is
    // `age = (uFxTime - birth) / life`, so birth 0 with life 1 leaves every
    // untouched slot reporting age < 1 — i.e. ALIVE — for the entire first
    // second of the FX clock. Those phantom instances sit at the world origin
    // with scale 0, so they cost a degenerate quad each rather than showing,
    // but they made instanceCount and every liveness measurement useless for
    // exactly the window in which the system is most often inspected.
    for (let i = 0; i < capacity; i++) {
      this.aParams[i * 4] = -1e9;
      this.aParams[i * 4 + 1] = 1;
    }

    // Bands come from the scree ramp: the most neutral, least chromatic of the
    // terrain ramps, so a per-surface hue tint can push it anywhere without
    // fighting a colour that was already committed.
    //
    // They are taken one band UP the ramp from the terrain's own, and the
    // brightest is lifted toward the sun rim. Airborne dust is not the ground
    // — it is a thin, loosely-packed cloud lit from every direction at once,
    // and it is lighter in value than the surface it came off. Starting the
    // shadow band at the terrain's darkest violet made a puff in shadow
    // literally the same colour as the rock behind it, which is invisible no
    // matter what the alpha is.
    const b0 = RAMPS.scree.colors[1];
    const b1 = RAMPS.scree.colors[3];
    const b2 = RAMPS.scree.colors[3].clone().lerp(SUN_RIM_COLOR, 0.45);

    this.material = new ShaderMaterial({
      glslVersion: GLSL3,
      uniforms: {
        ...globalUniformBlock(),
        uFxTime: { value: 0 },
        // The atlas cell is twice the puff's footprint (the padding that keeps
        // mips from bleeding), so every quad is scaled x2 to compensate.
        uSizeScale: { value: 2.0 },
        // Disabled until a camera publishes a shot. A DustSystem with no
        // director attached behaves exactly as it always did.
        uSubject: { value: new Vector4(0, 0, 0, 0) },
        // A puff is fully suppressed up to a third of the way from the lens to
        // the subject and completely free from 88% of the way on, which is
        // where the rear wheel's own trail lives.
        uLensBand: { value: new Vector2(0.34, 0.88) },
        // Begins to go at ~19 degrees of angular radius, gone by ~33. A puff
        // that owns two thirds of the frame height is not a picture element.
        uNearAng: { value: new Vector2(0.34, 0.66) },
        uAtlas: { value: puffAtlas() },
        uBand0: { value: b0.clone() },
        uBand1: { value: b1.clone() },
        uBand2: { value: b2.clone() },
        // Band thresholds on the half-Lambert term. Only two edges: dust is a
        // three-tone shape in every animated film that has ever drawn it.
        uBandT: { value: new Vector2(0.30, 0.66) },
        uInk: { value: INK.clone() },
        uOpacity: { value: 0.94 },
      },
      vertexShader: DUST_VERT,
      fragmentShader: DUST_FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: NormalBlending,
      side: DoubleSide,
    });
    this.material.name = 'fx:dust';

    this.mesh = new Mesh(this.pool.geometry, this.material);
    this.mesh.name = 'fx:dust';
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    // Drawn after all opaque geometry and after the outline hulls.
    this.mesh.renderOrder = 20;
    // Signals to the post pipeline that this must not enter the G-buffer
    // prepass: dust has no meaningful normal or material id, and letting it
    // write there would make the Sobel pass draw interior lines around smoke.
    this.mesh.userData.fxTransparent = true;
    this.mesh.userData.nprSkipPrepass = true;

    this.object = new Object3D();
    this.object.name = 'fx:dust:group';
    this.object.add(this.mesh);

    _liveSystems.push(this);
  }

  /**
   * Tell the system where the camera is, BEFORE anything emits this frame.
   *
   * THIS IS NOT A CONVENIENCE. Emission is distance-culled against `_camPos`,
   * and `_camPos` used to be sampled only at the END of the frame in update().
   * On the frame the subject teleports — a respawn, a checkpoint reset, and
   * every single capture pose and sequence — the camera has already been moved
   * hundreds of metres but the dust system is still holding the PREVIOUS
   * position, so every emission on that frame is culled as "too far".
   *
   * That is the entire reason the `crash` capture contained no dust at all.
   * Measured: crashCount reaches 1 and the impact flash fires on the very
   * first frame after setSequence, so notifyCrash() ran and dust.burst() was
   * called — and countAlive() reports 0 puffs for the whole 120-frame
   * sequence, because the burst was culled against a camera position 700 m up
   * the mountain. The first dust that survived was emitted 1.3 s later, once
   * update() had finally caught the camera up.
   */
  syncCamera(camera: PerspectiveCamera): void {
    camera.getWorldPosition(_camPos);
    this.haveCamera = true;
  }

  /** Advance the FX clock. `dt` must be the SCALED dt so freezes freeze dust. */
  update(dt: number, camera: PerspectiveCamera): void {
    this.fxTime += dt;
    this.material.uniforms.uFxTime.value = this.fxTime;
    this.syncCamera(camera);
    this.pool.flush();
    this.emittedThisFrame = 0;
  }

  /** Current FX clock, for callers that stamp their own births. */
  get time(): number {
    return this.fxTime;
  }

  /**
   * Exact number of live puffs. O(capacity) — this is a DIAGNOSTIC, for the
   * perf overlay and the capture probes, and must not be called per frame from
   * an emission path. `emittedThisFrame` is the cheap signal.
   */
  countAlive(): number {
    let n = 0;
    for (let i = 0; i < this.pool.capacity; i++) {
      const age = (this.fxTime - this.aParams[i * 4]) * this.aParams[i * 4 + 1];
      if (age >= 0 && age < 1) n++;
    }
    return n;
  }

  private tooFar(x: number, y: number, z: number): boolean {
    if (!this.haveCamera) return false;
    const dx = x - _camPos.x;
    const dy = y - _camPos.y;
    const dz = z - _camPos.z;
    return dx * dx + dy * dy + dz * dz > this.cullDistanceSq;
  }

  /**
   * Write one puff. All parameters are already resolved — this is the only
   * place that touches the instance arrays.
   */
  private write(
    px: number, py: number, pz: number,
    vx: number, vy: number, vz: number,
    life: number, kind: number,
    scale: number, growth: number, spinTotal: number,
    tint: Color,
  ): void {
    const i = this.pool.allocRing();
    const i3 = i * 3;
    const i4 = i * 4;

    this.aOrigin[i3] = px;
    this.aOrigin[i3 + 1] = py;
    this.aOrigin[i3 + 2] = pz;

    this.aVel[i3] = vx;
    this.aVel[i3 + 1] = vy;
    this.aVel[i3 + 2] = vz;

    this.aParams[i4] = this.fxTime;
    this.aParams[i4 + 1] = 1 / Math.max(life, 0.05);
    this.aParams[i4 + 2] = this.rng.next();
    this.aParams[i4 + 3] = kind;

    this.aShape[i4] = scale;
    this.aShape[i4 + 1] = growth;
    this.aShape[i4 + 2] = spinTotal;
    this.aShape[i4 + 3] = this.rng.range(0, Math.PI * 2);

    this.aTint[i3] = tint.r;
    this.aTint[i3 + 1] = tint.g;
    this.aTint[i3 + 2] = tint.b;

    this.emittedThisFrame++;
  }

  /** Build an orthonormal basis around `n` into the module scratch _t / _b. */
  private basis(n: Vector3): void {
    _n.copy(n);
    if (_n.lengthSq() < 1e-8) _n.set(0, 1, 0);
    else _n.normalize();
    // Pick the least-aligned cardinal axis so the cross product never degenerates.
    if (Math.abs(_n.y) < 0.9) _t.set(0, 1, 0);
    else _t.set(1, 0, 0);
    _b.crossVectors(_n, _t).normalize();
    _t.crossVectors(_b, _n).normalize();
  }

  // ── Public emission ────────────────────────────────────────────────────────

  /**
   * A discrete burst — the pop of dust off a skid, or the radial spray of a
   * landing. `amount` 0..1 selects between the two: anything above 0.55 becomes
   * a landing spray (faster, denser, flatter, shorter-lived), below it a skid
   * puff (slower, fewer, larger, lingering).
   */
  burst(
    position: Vector3,
    normal: Vector3,
    velocity: Vector3,
    amount: number,
    surface: SurfaceProperties,
    /**
     * Floor under the surface's own dustAmount.
     *
     * A rolling wheel on rock genuinely throws almost nothing — 0.18 is the
     * right number for a trail. A CRASH on rock does not: a body and a bike
     * grinding across a rock garden tears up everything that is loose on top
     * of it, and the review capture named `crash` is set at t=0.559, in the
     * rock garden, where the honest surface multiplier turned a 16-puff impact
     * burst into three. An impact passes a floor here so the hit is legible on
     * every surface in the game.
     */
    minDust = 0,
  ): void {
    const a = clamp01(amount);
    if (a <= 0.01) return;
    if (this.tooFar(position.x, position.y, position.z)) return;

    const dustScale = Math.max(surface.dustAmount, minDust);
    if (dustScale <= 0.02) return;

    const spray = a > 0.55;
    const kind = spray ? DUST_SPRAY : DUST_SKID;
    const tint = dustTintFor(surface.kind);

    // Count scales with both the hit strength and how dusty the ground is.
    //
    // Raised with the size cut below, and for the same reason: the previous
    // pass bought its plume out of a handful of very large drawings, and a
    // handful of very large drawings is what a captured impact looked like —
    // seven or eight fully-opaque discs the size of the wreck, sitting apart
    // from each other with clean ground between them. A cloud is MANY marks
    // whose contours overlap. Same total ink, three times the shapes.
    const count = clamp(Math.round((3 + a * 24) * dustScale), 1, 36);

    this.basis(normal);
    const vy = velocity.y;
    const vLen = velocity.length();

    for (let i = 0; i < count; i++) {
      const ang = this.rng.range(0, Math.PI * 2);
      // IN-PLANE, NOT UP.
      //
      // `up` used to run to 0.95 and multiply a speed that reached 13 m/s,
      // which with the old linear drag put a landing puff SEVEN METRES in the
      // air before it had faded. Dust off a contact patch is thrown SIDEWAYS —
      // the wheel is displacing material along the ground, not launching it —
      // and everything vertical about the read should come from the shader's
      // small saturating lift, which is bounded by construction. The radial
      // term is correspondingly stronger: that is the lateral spread the
      // effect was missing.
      const radial = spray ? this.rng.range(0.95, 1.45) : this.rng.range(0.55, 1.15);
      const up = spray ? this.rng.range(0.10, 0.30) : this.rng.range(0.12, 0.34);
      const speed = (spray ? 2.2 + a * 6.0 : 1.0 + a * 2.8) * this.rng.range(0.62, 1.35);

      // Radial component in the surface plane, plus a small lift along the normal.
      _d.copy(_t).multiplyScalar(Math.cos(ang) * radial)
        .addScaledVector(_b, Math.sin(ang) * radial)
        .addScaledVector(_n, up);
      _d.multiplyScalar(speed);

      // A landing throws its dust forward with the bike; a skid drags it back.
      _d.addScaledVector(velocity, spray ? 0.13 : -0.10);
      // Never let the seed velocity drive a puff into the ground.
      if (_d.y < 0 && vy < 0) _d.y *= 0.25;

      // Emission point jittered across the contact patch, not from a point.
      const jr = this.rng.range(0, spray ? 0.42 : 0.24);
      const ja = this.rng.range(0, Math.PI * 2);
      _v.copy(position)
        .addScaledVector(_t, Math.cos(ja) * jr)
        .addScaledVector(_b, Math.sin(ja) * jr)
        .addScaledVector(_n, this.rng.range(0.02, 0.16));

      // SIZED AGAINST THE WHEEL, which is the only ruler in the frame.
      //
      // WORK OUT THE VISIBLE DIAMETER PROPERLY, BECAUSE TWO FACTORS OF TWO
      // CANCEL AND IT IS EASY TO LOSE ONE. `sz` is the quad's HALF-extent, so
      // the quad spans 2*sz; the atlas cell is twice the puff's own footprint
      // (128 px of art centred in a 256 px cell, the padding that stops mips
      // bleeding between variants), so the drawn puff covers exactly half the
      // quad in each axis. Visible diameter is therefore 2 * sz * 0.5 = sz =
      // scale * (1 + growth * q) * uSizeScale, with uSizeScale = 2.
      //
      // Run the old numbers through that and a trail plume on scree finished
      // its life at 2 * 0.315 * 4.6 = 2.9 m across — five and a half wheels.
      // Measured on the live buffer, the oldest quarter of the population
      // averaged 1.9-2.0 m. That is the "individual puffs LARGER THAN THE
      // WHEELS, occluding both contact patches" of `tabletop-air`, and it is
      // also why the crash reads as balloons: at that size a dozen puffs cannot
      // overlap into a cloud, they can only sit next to each other.
      //
      // The target is a puff BORN smaller than a wheel (0.53 m) and DYING at
      // about two wheels. Birth 0.25-0.40 m, tail 0.8-1.5 m.
      const life = spray ? this.rng.range(0.80, 1.30) : this.rng.range(1.05, 1.70);
      const scale = (spray ? this.rng.range(0.115, 0.185) : this.rng.range(0.125, 0.200)) * (0.88 + dustScale * 0.18);
      const growth = spray ? this.rng.range(1.9, 2.7) : this.rng.range(1.6, 2.3);
      const spin = this.rng.signed() * (spray ? 1.6 : 0.9);

      this.write(_v.x, _v.y, _v.z, _d.x, _d.y, _d.z, life, kind, scale, growth, spin, tint);
    }

    // A fast landing on loose ground also throws a slower, much larger plume
    // behind the contact — the tail that sells the impact after the spray has
    // already gone.
    if (spray && dustScale > 0.9 && vLen > 6) {
      const n2 = clamp(Math.round(a * 9 * dustScale), 1, 14);
      for (let i = 0; i < n2; i++) {
        _d.copy(velocity).multiplyScalar(-0.14);
        _d.addScaledVector(_n, this.rng.range(0.18, 0.50));
        _d.addScaledVector(_t, this.rng.signed() * 1.1);
        this.write(
          position.x + this.rng.signed() * 0.45, position.y + 0.10, position.z + this.rng.signed() * 0.45,
          _d.x, _d.y, _d.z,
          this.rng.range(1.8, 2.7), DUST_PLUME,
          this.rng.range(0.15, 0.24) * (0.88 + dustScale * 0.18), this.rng.range(1.8, 2.5),
          this.rng.signed() * 0.55, tint,
        );
      }
    }
  }

  /**
   * Continuous emission from a rolling or sliding contact.
   *
   * `rate` is puffs per second before the surface multiplier. The fractional
   * remainder is resolved stochastically against the seeded FX stream rather
   * than carried in per-call-site state: the contract has no call-site id, and
   * a shared accumulator would silently mis-rate the moment a second wheel
   * started calling in. Stochastic is correct in expectation, exactly
   * reproducible for a given call sequence, and needs no state at all.
   */
  trail(
    position: Vector3,
    normal: Vector3,
    velocity: Vector3,
    rate: number,
    dt: number,
    surface: SurfaceProperties,
    /** Floor under the surface's own dustAmount. See burst(). */
    minDust = 0,
  ): void {
    if (rate <= 0 || dt <= 0) return;
    if (this.tooFar(position.x, position.y, position.z)) return;

    const dustScale = Math.max(surface.dustAmount, minDust);
    if (dustScale <= 0.02) return;

    const expected = rate * dustScale * dt;
    let count = Math.floor(expected);
    if (this.rng.next() < expected - count) count++;
    if (count <= 0) return;
    if (count > 18) count = 18;

    // Loose DRY ground (scree, snow) throws a genuine plume: bigger, slower to
    // disperse, and persistent enough to hang behind the rider as a trail
    // rather than popping and vanishing.
    //
    // Water is explicitly not that, despite having the highest dustAmount in
    // the table. 1.8 is a spray multiplier — it means water throws the MOST
    // material, not that it hangs in the air, and the classification here was
    // reading the magnitude and ignoring the substance. A wheel through the
    // stream bed was producing a two-metre, two-second grey plume: a dust
    // cloud rising off a river. Water gets short, small, fast puffs and the
    // real read comes from DebrisSystem.splash, which throws actual droplets.
    const plume = dustScale >= 1.15 && surface.kind !== SurfaceKind.Water;
    const kind = plume ? DUST_PLUME : DUST_SKID;
    const tint = dustTintFor(surface.kind);

    this.basis(normal);

    for (let i = 0; i < count; i++) {
      const ang = this.rng.range(0, Math.PI * 2);
      // The normal component was 0.5-1.2 and it was multiplied by a speed of
      // up to 2.1 and again by 1.5 for a plume: 3.8 m/s straight up, which
      // under the old drag is 3.3 m of climb. That is the whole of "the dust
      // rises and never settles". A rolling contact throws material SIDEWAYS
      // and the shader owns what little of it goes up.
      const radial = this.rng.range(0.55, 1.35);
      const jitter = this.rng.range(0.85, 1.6) * (plume ? 1.25 : 1.0);

      // ── THE FLING SCALES WITH THE RIM SPEED ──────────────────────────────────
      //
      // The in-plane throw used to be a fixed ~1.2 m/s at every speed, and the
      // widening of the plume was left entirely to the shader's age-driven
      // spread. Which is correct physics for smoke and wrong for THIS SHOT: the
      // chase boom sits 4.8 m behind the bike, so the only dust the frame
      // contains is the four metres between the wheel and the bottom edge —
      // 0.17 s of trail at 83 km/h. Every part of the effect authored "over the
      // puff's life" happens off-camera. Measured: a plume 33 m long and 1.8 m
      // wide at its widest still renders as a rope one wheel across, because
      // the frame only ever sees age < 0.2 and age^1.5 at 0.13 is nothing.
      //
      // A tyre displacing loose material at 23 m/s does not gently diffuse it,
      // it THROWS it, and the throw is what opens the wedge inside the first
      // couple of metres. Scaling the in-plane component with the contact speed
      // gives ~5.5 m/s of lateral fling at race pace (a 1.9 m asymptote under
      // the shader's drag, 0.66 m of it inside the first 0.15 s) and ~1.8 m/s
      // at walking pace, where a wide fan would be nonsense.
      //
      // The NORMAL component is deliberately left out of that scaling. It is the
      // one direction that must not grow with speed — the entire first defect
      // was dust climbing to head height, and a fling term multiplying the up
      // vector is exactly how that comes back.
      const fling = radial * jitter * (0.9 + 0.17 * Math.min(velocity.length(), 24));
      _d.copy(_t).multiplyScalar(Math.cos(ang) * fling)
        .addScaledVector(_b, Math.sin(ang) * fling)
        .addScaledVector(_n, this.rng.range(0.10, 0.34) * jitter);
      // Dragged backward out of the contact patch.
      _d.addScaledVector(velocity, -0.16);

      const jr = this.rng.range(0, 0.22);
      const ja = this.rng.range(0, Math.PI * 2);
      _v.copy(position)
        .addScaledVector(_t, Math.cos(ja) * jr)
        .addScaledVector(_b, Math.sin(ja) * jr)
        .addScaledVector(_n, this.rng.range(0.03, 0.14));

      // Plumes were 0.45-0.85 base, which after the surface factor and the x2
      // atlas compensation put a single puff at over two metres across. Three
      // of those is a fog bank with no internal structure; the plume has to be
      // built out of MANY smaller drawings whose overlapping contours are what
      // give it a readable silhouette, exactly as it is drawn on paper.
      //
      // The birth size is now BELOW a wheel diameter and the growth ramp is
      // what carries it: a fresh puff at the contact patch is a small mark and
      // the tail of the trail is a big soft-edged one, which is the size ramp
      // over life the critic could not find. Longer-lived too — at 23 m/s a
      // 1.45 s puff is 33 m behind the wheel when it dies, which is what
      // "hangs and streams 20 m or more" costs.
      //
      // AND THE SECOND CUT. The paragraph above was written against a scale
      // that still finished at 2.9 m — see the arithmetic in burst(), where the
      // two factors of two are worked out. Measured on `scree-speed` the oldest
      // quarter of the live population averaged 2.0 m across, five wheels wide,
      // which is why the trail read as a chain of separate balloons rather than
      // as one shape with a silhouette. Birth 0.25-0.41 m, tail 0.8-1.4 m, and
      // the count raised to match so the ink lands as overlap.
      const life = plume ? this.rng.range(1.9, 2.9) : this.rng.range(1.05, 1.60);
      const scale = (plume ? this.rng.range(0.180, 0.270) : this.rng.range(0.170, 0.260)) * (0.88 + dustScale * 0.18);
      const growth = plume ? this.rng.range(1.4, 2.1) : this.rng.range(1.2, 1.9);
      const spin = this.rng.signed() * (plume ? 0.5 : 1.1);

      this.write(_v.x, _v.y, _v.z, _d.x, _d.y, _d.z, life, kind, scale, growth, spin, tint);
    }
  }

  setOpacity(v: number): void {
    this.material.uniforms.uOpacity.value = clamp01(v);
  }

  /**
   * Publish the shot: the point the camera is framing and the radius around it
   * that has to stay legible. Puffs that come between the lens and that point
   * and cover it are faded out — see the lens corridor in the vertex shader.
   *
   * Radius 0 disables the rule entirely, which is the state a DustSystem with
   * no camera attached stays in.
   */
  setShotSubject(x: number, y: number, z: number, radius: number): void {
    const v = this.material.uniforms.uSubject.value as Vector4;
    v.set(x, y, z, Math.max(radius, 0));
  }

  clearShotSubject(): void {
    (this.material.uniforms.uSubject.value as Vector4).w = 0;
  }

  /**
   * Kill every live puff.
   *
   * This is what a TELEPORT needs, and its absence is the whole of the
   * `bike-detail` failure. The capture harness runs three poses in a row at the
   * same point on the course (rider-closeup, rider-threequarter, bike-detail);
   * each one respawns the bike and steps 12 frames, and the dust from the
   * previous two is still well inside its 0.7-2.3 s life when the shutter
   * opens. The bike-detail camera then sits 2.3 m from the bike inside three
   * poses' worth of accumulated cloud. The same thing happens in play on any
   * respawn: the rider reappears 400 m down the mountain wearing the dust he
   * kicked up before he was moved.
   *
   * Stamping the birth time far in the past is enough — the shader's liveness
   * test is age = (uFxTime - birth) / life, and nothing else reads these slots.
   */
  clear(): void {
    for (let i = 0; i < this.pool.capacity; i++) {
      this.aParams[i * 4] = -1e9;
      this.aParams[i * 4 + 1] = 1;
    }
    this.pool.markAll();
    this.emittedThisFrame = 0;
  }

  dispose(): void {
    const i = _liveSystems.indexOf(this);
    if (i >= 0) _liveSystems.splice(i, 1);
    this.pool.dispose();
    this.material.dispose();
    this.object.removeFromParent();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// The camera channel
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Every live DustSystem, so the camera can reach the dust without the Game
 * having to hand one to the other.
 *
 * The alternative was a setter on the FX facade wired through Game.render, and
 * that is a worse trade than it looks: the two facts the dust needs — where the
 * shot is pointed and when the subject teleported — are both owned by the
 * CameraDirector and by nothing else, and routing them through two more objects
 * only creates two more places for them to arrive a frame late. There is one
 * DustSystem in a running game; the list exists so a second one (a test, a
 * second viewport) is not silently ignored.
 */
const _liveSystems: DustSystem[] = [];

/** Tell every dust system what the camera is framing. See setShotSubject. */
export function publishDustShot(x: number, y: number, z: number, radius: number): void {
  for (let i = 0; i < _liveSystems.length; i++) _liveSystems[i].setShotSubject(x, y, z, radius);
}

/** Drop every live puff everywhere. Call on a teleport, a respawn, a pose cut. */
export function clearAllDust(): void {
  for (let i = 0; i < _liveSystems.length; i++) _liveSystems[i].clear();
}
