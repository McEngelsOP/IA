/**
 * Ghost — the player's best run, recorded, stored, and raced against.
 *
 * Three separable jobs live here:
 *
 *   1. RECORDING. 20Hz samples of pose plus distance-along-track. 20Hz is
 *      enough because the playback interpolates and a ghost is a reference, not
 *      a physics object; going to 60Hz would triple the storage for something
 *      nobody can see.
 *
 *   2. STORAGE. localStorage is a ~5MB string budget shared with everything
 *      else the page might want, so the encoding matters. Positions are stored
 *      as 8-bit DELTAS in 1/32 m units — at 20Hz a rider would have to be doing
 *      79 m/s to overflow one, and because the delta is taken between quantised
 *      absolutes the reconstruction has bounded error rather than drift.
 *      Orientation keeps 16 bits per component (8 would be ~1° of wobble, which
 *      you can see on a bike). That is 17 bytes a sample: a three-minute run is
 *      ~61KB raw, and ~25-35KB after the deflate pass.
 *
 *   3. PLAYBACK + DELTA. The ghost rides as a tinted, translucent rider, and the
 *      HUD gets a live delta. The delta is computed by inverting the ghost's
 *      distance→time curve at the player's current distance, NOT by comparing
 *      positions — a positional comparison reports nonsense the moment the two
 *      riders take different lines through a corner.
 */

import { Object3D, Quaternion, Vector3 } from 'three';

import {
  BikeMode,
  BikeState,
  IBike,
  IRiderRig,
  SurfaceKind,
  SurfaceProperties,
  TrickKind,
  TrickState,
} from '../game/Contracts';
import { SURFACES } from '../game/WorldConstants';
import { clamp, clamp01, lerp } from '../core/MathX';
import { RF_AIRBORNE, RF_BOOSTING, RF_CRASHING, RF_MANUAL } from './Replay';

export const GHOST_HZ = 20;
const GHOST_DT = 1 / GHOST_HZ;

const MAGIC = 0x44474831; // "DGH1"
const VERSION = 1;
const BYTES_PER_SAMPLE = 17;
const HEADER_BYTES = 48;

/** Position quantisation: 1/32 m. Delta range ±3.97 m per 50ms = 79 m/s. */
const POS_SCALE = 32;
/** Distance-along-track quantisation: 1/4 m into a u16 → 16.3 km of course. */
const DIST_SCALE = 4;

// ── Decoded ghost ────────────────────────────────────────────────────────────

export interface GhostData {
  hz: number;
  count: number;
  finishTime: number;
  trackLength: number;
  trickScore: number;
  crashCount: number;
  splits: Float32Array;
  /** count × 3 world positions. */
  pos: Float32Array;
  /** count × 4 quaternions. */
  quat: Float32Array;
  speed: Float32Array;
  lean: Float32Array;
  steer: Float32Array;
  /** Monotonic distance along the track, metres. */
  dist: Float32Array;
  flags: Uint8Array;
}

// ── Scratch ──────────────────────────────────────────────────────────────────
const _pos = new Vector3();
const _quat = new Quaternion();
const _qa = new Quaternion();
const _qb = new Quaternion();
const _prevPos = new Vector3();

function trailSurface(): SurfaceProperties {
  return {
    kind: SurfaceKind.Trail,
    grip: SURFACES.trail.grip,
    rollingResistance: SURFACES.trail.rollingResistance,
    drag: SURFACES.trail.drag,
    dustAmount: SURFACES.trail.dustAmount,
    harshness: SURFACES.trail.harshness,
    audioTone: 'hardpack',
  };
}

/**
 * A BikeState that is filled from a recording rather than simulated. The rider
 * rig is a pure consumer of BikeState, so giving it a synthetic one makes the
 * ghost animate with the full procedural rig for free — pedalling, lean, tuck,
 * the lot — instead of being a rigid mannequin sliding down the hill.
 */
function syntheticState(): BikeState {
  const wheel = () => ({
    contactPoint: new Vector3(),
    contactNormal: new Vector3(0, 1, 0),
    grounded: true,
    compression: 0.3,
    compressionVelocity: 0,
    spin: 0,
    spinRate: 0,
    slipRatio: 0,
    lateralSlip: 0,
    surface: trailSurface(),
    load: 450,
  });
  return {
    position: new Vector3(),
    velocity: new Vector3(),
    orientation: new Quaternion(),
    angularVelocity: new Vector3(),
    forwardSpeed: 0,
    speed: 0,
    lean: 0,
    steerAngle: 0,
    pitch: 0,
    front: wheel(),
    rear: wheel(),
    mode: BikeMode.Grounded,
    modeTime: 0,
    airHeight: 0,
    airTime: 0,
    peakAirHeight: 0,
    preload: 0,
    pumpCharge: 0,
    manualling: false,
    manualAmount: 0,
    boost: 0,
    boosting: false,
    landedThisStep: false,
    landingImpact: 0,
    landingQuality: 1,
    crashedThisStep: false,
    crashDirection: new Vector3(0, 0, 1),
    crashSeverity: 0,
  };
}

// ─────────────────────────────────────────────────────────────────────────────

export interface GhostVisual {
  object: Object3D;
  rig?: IRiderRig;
  bike?: IBike;
}

export interface GhostOptions {
  trackLength: number;
  /** Namespaced so a different mountain never loads the wrong ghost. */
  storageKey?: string;
  /** Tint colour applied to every cel material on the ghost. */
  tint?: number;
  opacity?: number;
}

export class Ghost {
  readonly object = new Object3D();

  /** The stored best, or null if this is the first run on this course. */
  data: GhostData | null = null;
  /** True once load() has resolved, successfully or not. */
  loaded = false;

  private trackLength: number;
  private storageKey: string;
  private tint: number;
  private opacity: number;

  private visual: GhostVisual | null = null;
  private state = syntheticState();
  private trick: TrickState = {
    kind: TrickKind.None,
    phase: 0,
    rotations: 0,
    pendingScore: 0,
    committed: true,
  };

  // ── Recording buffers. Grown in chunks; never per-sample allocation. ───────
  private recording = false;
  private recCount = 0;
  private recCap = 0;
  private recPos!: Float32Array;
  private recQuat!: Float32Array;
  private recSpeed!: Float32Array;
  private recLean!: Float32Array;
  private recSteer!: Float32Array;
  private recDist!: Float32Array;
  private recFlags!: Uint8Array;
  private recSplits: number[] = [];
  private nextSampleAt = 0;
  private maxDist = 0;

  /** Live delta, seconds. Positive = the player is BEHIND the ghost. */
  delta: number | null = null;
  /** Cursor into the ghost's distance curve; monotonic, so the search is O(1). */
  private deltaCursor = 0;
  private playCursor = 0;

  constructor(opts: GhostOptions) {
    this.trackLength = opts.trackLength;
    this.storageKey = opts.storageKey ?? 'descent.ghost.v1';
    this.tint = opts.tint ?? 0x7fd8e8;
    this.opacity = opts.opacity ?? 0.42;
    this.object.name = 'ghost';
    this.object.visible = false;
    this.growRecording(4096);
  }

  // ── Visual ────────────────────────────────────────────────────────────────
  /**
   * Adopt a bike+rig built by the orchestrator and make it read as a ghost:
   * translucent, tinted toward the palette's cool accent, out of the G-buffer
   * prepass and out of the shadow pass.
   *
   * Dropping it from the prepass is not an optimisation — the prepass feeds the
   * line pass, and a translucent ghost with hard ink outlines punched through
   * the world reads as a solid rider, which defeats the entire point.
   */
  attachVisual(v: GhostVisual): void {
    this.visual = v;
    if (!v.object.parent) this.object.add(v.object);
    v.object.traverse((o) => {
      const mesh = o as unknown as { material?: unknown; userData?: Record<string, unknown>; renderOrder?: number };
      if (mesh.userData) {
        delete mesh.userData.prepassMaterial;
        delete mesh.userData.shadowMaterial;
      }
      (o as { castShadow?: boolean }).castShadow = false;
      (o as { receiveShadow?: boolean }).receiveShadow = false;
      o.renderOrder = 12;
      const mats = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
      for (const m of mats) this.tintMaterial(m as GhostTintable);
    });
  }

  private tintMaterial(m: GhostTintable): void {
    if (!m) return;
    m.transparent = true;
    m.depthWrite = false;
    const u = m.uniforms;
    if (u) {
      if (u.uOpacity) u.uOpacity.value = this.opacity;
      if (u.uTint && isHexSettable(u.uTint.value)) u.uTint.value.setHex(this.tint);
      if (u.uTintStrength) u.uTintStrength.value = 0.72;
      // Kill the spec and pull the rim back: a ghost that catches highlights
      // reads as a second real rider rendered wrong rather than a reference.
      if (u.uSpecStrength) u.uSpecStrength.value = 0;
      if (u.uRimStrength) u.uRimStrength.value = 0.35;
    } else if (typeof m.opacity === 'number') {
      m.opacity = this.opacity;
    }
  }

  // ── Recording ─────────────────────────────────────────────────────────────
  private growRecording(cap: number): void {
    const p = new Float32Array(cap * 3);
    const q = new Float32Array(cap * 4);
    const s = new Float32Array(cap);
    const l = new Float32Array(cap);
    const st = new Float32Array(cap);
    const d = new Float32Array(cap);
    const f = new Uint8Array(cap);
    if (this.recCap > 0) {
      p.set(this.recPos);
      q.set(this.recQuat);
      s.set(this.recSpeed);
      l.set(this.recLean);
      st.set(this.recSteer);
      d.set(this.recDist);
      f.set(this.recFlags);
    }
    this.recPos = p;
    this.recQuat = q;
    this.recSpeed = s;
    this.recLean = l;
    this.recSteer = st;
    this.recDist = d;
    this.recFlags = f;
    this.recCap = cap;
  }

  beginRecording(): void {
    this.recording = true;
    this.recCount = 0;
    this.recSplits.length = 0;
    this.nextSampleAt = 0;
    this.maxDist = 0;
    this.delta = null;
    this.deltaCursor = 0;
    this.playCursor = 0;
  }

  recordSplit(time: number): void {
    this.recSplits.push(time);
  }

  /** Call every physics step with the player's state. Decimates internally. */
  record(t: number, state: BikeState, distance: number, trick: TrickKind): void {
    if (!this.recording) return;
    if (t < this.nextSampleAt) return;
    this.nextSampleAt += GHOST_DT;
    if (t > this.nextSampleAt + GHOST_DT) this.nextSampleAt = t + GHOST_DT;

    if (this.recCount >= this.recCap) this.growRecording(this.recCap * 2);
    const i = this.recCount++;

    this.recPos[i * 3] = state.position.x;
    this.recPos[i * 3 + 1] = state.position.y;
    this.recPos[i * 3 + 2] = state.position.z;
    this.recQuat[i * 4] = state.orientation.x;
    this.recQuat[i * 4 + 1] = state.orientation.y;
    this.recQuat[i * 4 + 2] = state.orientation.z;
    this.recQuat[i * 4 + 3] = state.orientation.w;
    this.recSpeed[i] = state.speed;
    this.recLean[i] = state.lean;
    this.recSteer[i] = state.steerAngle;
    // Force monotonic: the delta inversion below is a binary search and a single
    // backwards sample (a crash slide, a bad projection) would break it.
    this.maxDist = Math.max(this.maxDist, distance);
    this.recDist[i] = this.maxDist;

    let f = 0;
    if (state.mode === BikeMode.Airborne) f |= RF_AIRBORNE;
    if (state.mode === BikeMode.Crashing || state.mode === BikeMode.Recovering) f |= RF_CRASHING;
    if (state.boosting) f |= RF_BOOSTING;
    if (state.manualling) f |= RF_MANUAL;
    // Two bits of trick class in the top of the flag byte. The ghost's trick is
    // decorative — it selects a rig pose and nothing more — so collapsing the
    // ten tricks to four classes costs nothing and keeps the sample at 17 bytes.
    this.recFlags[i] = (f & 0x3f) | ((trickClassOf(trick) & 0x03) << 6);
  }

  /**
   * Finish the run. Returns true if it became the new best and was stored.
   * Storage is fire-and-forget: a failed write (private browsing, quota) must
   * never take the results screen down with it.
   */
  finishRecording(
    finishTime: number,
    trickScore: number,
    crashCount: number,
  ): { isBest: boolean; previous: number | null } {
    this.recording = false;
    const previous = this.data ? this.data.finishTime : null;
    if (this.recCount < 8) return { isBest: false, previous };
    const isBest = previous === null || finishTime < previous;
    if (!isBest) return { isBest: false, previous };

    const next: GhostData = {
      hz: GHOST_HZ,
      count: this.recCount,
      finishTime,
      trackLength: this.trackLength,
      trickScore,
      crashCount,
      splits: Float32Array.from(this.recSplits),
      pos: this.recPos.slice(0, this.recCount * 3),
      quat: this.recQuat.slice(0, this.recCount * 4),
      speed: this.recSpeed.slice(0, this.recCount),
      lean: this.recLean.slice(0, this.recCount),
      steer: this.recSteer.slice(0, this.recCount),
      dist: this.recDist.slice(0, this.recCount),
      flags: this.recFlags.slice(0, this.recCount),
    };
    this.data = next;
    void this.save(next);
    return { isBest: true, previous };
  }

  // ── Playback ──────────────────────────────────────────────────────────────
  get hasGhost(): boolean {
    return this.data !== null && this.data.count > 1;
  }

  get bestTime(): number | null {
    return this.data ? this.data.finishTime : null;
  }

  /**
   * Advance the ghost to race time `t`. Safe to call with no ghost loaded — it
   * simply hides itself, which is the whole of the "no ghost yet" handling.
   */
  update(t: number, dt: number, time: number): void {
    const d = this.data;
    if (!d || d.count < 2 || !this.visual) {
      this.object.visible = false;
      return;
    }
    const last = (d.count - 1) / d.hz;
    if (t < 0 || t > last + 1.5) {
      this.object.visible = false;
      return;
    }
    this.object.visible = true;

    const x = clamp(t * d.hz, 0, d.count - 1);
    let i = Math.floor(x);
    // Monotonic cursor: playback time only moves forward, so this is O(1).
    if (i < this.playCursor - 2) this.playCursor = i;
    this.playCursor = i = Math.max(i, 0);
    const j = Math.min(i + 1, d.count - 1);
    const k = x - i;

    _pos.set(
      lerp(d.pos[i * 3], d.pos[j * 3], k),
      lerp(d.pos[i * 3 + 1], d.pos[j * 3 + 1], k),
      lerp(d.pos[i * 3 + 2], d.pos[j * 3 + 2], k),
    );
    _qa.set(d.quat[i * 4], d.quat[i * 4 + 1], d.quat[i * 4 + 2], d.quat[i * 4 + 3]);
    _qb.set(d.quat[j * 4], d.quat[j * 4 + 1], d.quat[j * 4 + 2], d.quat[j * 4 + 3]);
    _quat.copy(_qa).slerp(_qb, k);

    // Drive the synthetic state so the rig animates rather than freezing.
    const s = this.state;
    _prevPos.copy(s.position);
    s.position.copy(_pos);
    if (dt > 1e-5) s.velocity.subVectors(_pos, _prevPos).multiplyScalar(1 / dt);
    s.orientation.copy(_quat);
    s.speed = lerp(d.speed[i], d.speed[j], k);
    s.forwardSpeed = s.speed;
    s.lean = lerp(d.lean[i], d.lean[j], k);
    s.steerAngle = lerp(d.steer[i], d.steer[j], k);

    const f = d.flags[i];
    const air = (f & RF_AIRBORNE) !== 0;
    s.mode = (f & RF_CRASHING) !== 0 ? BikeMode.Crashing : air ? BikeMode.Airborne : BikeMode.Grounded;
    s.boosting = (f & RF_BOOSTING) !== 0;
    s.manualling = (f & RF_MANUAL) !== 0;
    s.manualAmount = s.manualling ? 0.7 : 0;
    s.front.grounded = s.rear.grounded = !air;
    s.airTime = air ? s.airTime + dt : 0;
    s.airHeight = air ? 1.5 : 0;
    // Wheel spin, so the ghost's wheels turn. The rig may drive this itself; if
    // it does, this is harmlessly overwritten.
    const spinRate = s.speed / 0.267;
    s.front.spinRate = s.rear.spinRate = spinRate;
    s.front.spin += spinRate * dt;
    s.rear.spin = s.front.spin;

    this.trick.kind = TRICK_CLASSES[(f >> 6) & 0x03];
    this.trick.phase = air ? 0.5 : 0;

    // Position the visual. If a real IBike was supplied we move its object; if
    // only a rig, we move the container.
    const target = this.visual.bike ? this.visual.bike.object : this.visual.object;
    target.position.copy(_pos);
    target.quaternion.copy(_quat);
    this.visual.rig?.update(s, this.trick, dt, time);
  }

  /**
   * Live delta at the player's current track distance. Inverts the ghost's
   * distance→time curve. Positive = the player is behind.
   */
  updateDelta(playerDistance: number, playerRaceTime: number): number | null {
    const d = this.data;
    if (!d || d.count < 2) {
      this.delta = null;
      return null;
    }
    if (playerDistance <= d.dist[0]) {
      this.delta = playerRaceTime;
      return this.delta;
    }
    const lastD = d.dist[d.count - 1];
    if (playerDistance >= lastD) {
      this.delta = playerRaceTime - d.finishTime;
      return this.delta;
    }
    // Walk the cursor. Distances are monotonic and the player's distance is very
    // nearly monotonic, so this is a couple of steps a frame.
    let i = clamp(this.deltaCursor, 0, d.count - 2);
    while (i > 0 && d.dist[i] > playerDistance) i--;
    while (i < d.count - 2 && d.dist[i + 1] <= playerDistance) i++;
    this.deltaCursor = i;

    const span = d.dist[i + 1] - d.dist[i];
    const k = span > 1e-4 ? clamp01((playerDistance - d.dist[i]) / span) : 0;
    const ghostTime = (i + k) / d.hz;
    this.delta = playerRaceTime - ghostTime;
    return this.delta;
  }

  /** Ghost's distance along the track at race time `t`, for the position board. */
  distanceAt(t: number): number {
    const d = this.data;
    if (!d || d.count === 0) return 0;
    const x = clamp(t * d.hz, 0, d.count - 1);
    const i = Math.floor(x);
    const j = Math.min(i + 1, d.count - 1);
    return lerp(d.dist[i], d.dist[j], x - i);
  }

  // ── Storage ───────────────────────────────────────────────────────────────

  /**
   * Load the stored ghost. Async because the compressed path needs a stream.
   * Kick this off at construction; it resolves long before the countdown ends,
   * and if it does not, `hasGhost` is simply false until it does.
   */
  async load(): Promise<boolean> {
    this.loaded = false;
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (!raw || raw.length < 8) {
        this.loaded = true;
        return false;
      }
      const compressed = raw[0] === 'z';
      let bytes = base64ToBytes(raw.slice(1));
      if (compressed) {
        const inflated = await inflate(bytes);
        if (!inflated) {
          this.loaded = true;
          return false;
        }
        bytes = inflated;
      }
      const decoded = decodeGhost(bytes);
      if (decoded && Math.abs(decoded.trackLength - this.trackLength) < 2.0) {
        this.data = decoded;
        this.loaded = true;
        return true;
      }
    } catch (e) {
      console.warn('[ghost] load failed', e);
    }
    this.loaded = true;
    return false;
  }

  private async save(d: GhostData): Promise<void> {
    try {
      const bytes = encodeGhost(d);
      const packed = await deflate(bytes);
      const payload = packed ? 'z' + bytesToBase64(packed) : 'r' + bytesToBase64(bytes);
      localStorage.setItem(this.storageKey, payload);
    } catch (e) {
      console.warn('[ghost] save failed', e);
    }
  }

  /** Wipe the stored best. Wired to the results screen's "clear ghost". */
  clearStored(): void {
    this.data = null;
    try {
      localStorage.removeItem(this.storageKey);
    } catch {
      /* private browsing — nothing to do */
    }
  }

  dispose(): void {
    this.object.removeFromParent();
    this.visual = null;
  }
}

/**
 * The shape of a material we can ghost-ify. Deliberately structural rather than
 * an import of CelMaterial: the ghost may be handed any material the rig agent
 * happens to be using, and a duck-typed check that degrades to plain `opacity`
 * is far more robust than an instanceof that throws when they refactor.
 */
interface GhostTintable {
  transparent?: boolean;
  depthWrite?: boolean;
  opacity?: number;
  uniforms?: Record<string, { value: unknown }>;
}

interface HexSettable {
  setHex(h: number): void;
}

function isHexSettable(v: unknown): v is HexSettable {
  return !!v && typeof (v as HexSettable).setHex === 'function';
}

/** The four trick classes a ghost can express. Index = the 2-bit stored value. */
const TRICK_CLASSES: TrickKind[] = [TrickKind.None, TrickKind.Manual, TrickKind.Tabletop, TrickKind.Spin360];

function trickClassOf(k: TrickKind): number {
  switch (k) {
    case TrickKind.None:
      return 0;
    case TrickKind.Manual:
      return 1;
    case TrickKind.Spin360:
    case TrickKind.Backflip:
    case TrickKind.Frontflip:
      return 3;
    default:
      return 2;
  }
}

// ── Binary codec ─────────────────────────────────────────────────────────────

export function encodeGhost(d: GhostData): Uint8Array {
  const splitCount = Math.min(d.splits.length, 32);
  const size = HEADER_BYTES + splitCount * 4 + d.count * BYTES_PER_SAMPLE;
  const buf = new ArrayBuffer(size);
  const dv = new DataView(buf);

  const qx0 = Math.round(d.pos[0] * POS_SCALE);
  const qy0 = Math.round(d.pos[1] * POS_SCALE);
  const qz0 = Math.round(d.pos[2] * POS_SCALE);

  dv.setUint32(0, MAGIC, true);
  dv.setUint8(4, VERSION);
  dv.setUint8(5, splitCount);
  dv.setUint16(6, 0, true);
  dv.setUint32(8, d.count, true);
  dv.setFloat32(12, d.hz, true);
  dv.setFloat32(16, d.finishTime, true);
  dv.setFloat32(20, d.trackLength, true);
  dv.setInt32(24, qx0, true);
  dv.setInt32(28, qy0, true);
  dv.setInt32(32, qz0, true);
  dv.setUint32(36, Math.max(0, Math.round(d.trickScore)), true);
  dv.setUint32(40, Math.max(0, Math.round(d.crashCount)), true);
  dv.setUint32(44, 0, true);

  let o = HEADER_BYTES;
  for (let i = 0; i < splitCount; i++) {
    dv.setFloat32(o, d.splits[i], true);
    o += 4;
  }

  let px = qx0;
  let py = qy0;
  let pz = qz0;
  for (let i = 0; i < d.count; i++) {
    const nx = Math.round(d.pos[i * 3] * POS_SCALE);
    const ny = Math.round(d.pos[i * 3 + 1] * POS_SCALE);
    const nz = Math.round(d.pos[i * 3 + 2] * POS_SCALE);
    dv.setInt8(o, clampI8(nx - px));
    dv.setInt8(o + 1, clampI8(ny - py));
    dv.setInt8(o + 2, clampI8(nz - pz));
    // Advance the predictor by the CLAMPED delta so encode and decode stay in
    // lockstep even in the pathological case where a sample overflows.
    px += clampI8(nx - px);
    py += clampI8(ny - py);
    pz += clampI8(nz - pz);
    o += 3;

    for (let c = 0; c < 4; c++) {
      dv.setInt16(o, clampI16(Math.round(d.quat[i * 4 + c] * 32767)), true);
      o += 2;
    }
    dv.setUint8(o, clamp(Math.round(d.speed[i] * 4), 0, 255));
    dv.setInt8(o + 1, clampI8(Math.round(d.lean[i] * 100)));
    dv.setInt8(o + 2, clampI8(Math.round(d.steer[i] * 100)));
    o += 3;
    dv.setUint16(o, clamp(Math.round(d.dist[i] * DIST_SCALE), 0, 65535), true);
    o += 2;
    dv.setUint8(o, d.flags[i]);
    o += 1;
  }
  return new Uint8Array(buf);
}

export function decodeGhost(bytes: Uint8Array): GhostData | null {
  if (bytes.byteLength < HEADER_BYTES) return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint32(0, true) !== MAGIC) return null;
  if (dv.getUint8(4) !== VERSION) return null;

  const splitCount = dv.getUint8(5);
  const count = dv.getUint32(8, true);
  const hz = dv.getFloat32(12, true);
  const finishTime = dv.getFloat32(16, true);
  const trackLength = dv.getFloat32(20, true);
  let px = dv.getInt32(24, true);
  let py = dv.getInt32(28, true);
  let pz = dv.getInt32(32, true);
  const trickScore = dv.getUint32(36, true);
  const crashCount = dv.getUint32(40, true);

  const expected = HEADER_BYTES + splitCount * 4 + count * BYTES_PER_SAMPLE;
  if (count <= 0 || count > 200000 || bytes.byteLength < expected) return null;

  const splits = new Float32Array(splitCount);
  let o = HEADER_BYTES;
  for (let i = 0; i < splitCount; i++) {
    splits[i] = dv.getFloat32(o, true);
    o += 4;
  }

  const pos = new Float32Array(count * 3);
  const quat = new Float32Array(count * 4);
  const speed = new Float32Array(count);
  const lean = new Float32Array(count);
  const steer = new Float32Array(count);
  const dist = new Float32Array(count);
  const flags = new Uint8Array(count);

  for (let i = 0; i < count; i++) {
    px += dv.getInt8(o);
    py += dv.getInt8(o + 1);
    pz += dv.getInt8(o + 2);
    o += 3;
    pos[i * 3] = px / POS_SCALE;
    pos[i * 3 + 1] = py / POS_SCALE;
    pos[i * 3 + 2] = pz / POS_SCALE;

    let qlen = 0;
    for (let c = 0; c < 4; c++) {
      const v = dv.getInt16(o, true) / 32767;
      quat[i * 4 + c] = v;
      qlen += v * v;
      o += 2;
    }
    // Renormalise: 16-bit rounding leaves the quaternion off the unit sphere by
    // enough to shear the rig over a long run.
    qlen = Math.sqrt(qlen) || 1;
    for (let c = 0; c < 4; c++) quat[i * 4 + c] /= qlen;

    speed[i] = dv.getUint8(o) / 4;
    lean[i] = dv.getInt8(o + 1) / 100;
    steer[i] = dv.getInt8(o + 2) / 100;
    o += 3;
    dist[i] = dv.getUint16(o, true) / DIST_SCALE;
    o += 2;
    flags[i] = dv.getUint8(o);
    o += 1;
  }

  return { hz, count, finishTime, trackLength, trickScore, crashCount, splits, pos, quat, speed, lean, steer, dist, flags };
}

function clampI8(v: number): number {
  return v < -128 ? -128 : v > 127 ? 127 : v | 0;
}
function clampI16(v: number): number {
  return v < -32768 ? -32768 : v > 32767 ? 32767 : v | 0;
}

// ── base64 + deflate ─────────────────────────────────────────────────────────

function bytesToBase64(b: Uint8Array): string {
  // Chunked, because String.fromCharCode.apply blows the argument limit on a
  // 60KB buffer and the failure mode is a silent RangeError mid-save.
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < b.length; i += CH) {
    s += String.fromCharCode.apply(null, Array.prototype.slice.call(b.subarray(i, i + CH)) as number[]);
  }
  return btoa(s);
}

function base64ToBytes(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

type StreamCtor = new (format: string) => { readable: ReadableStream; writable: WritableStream };

async function pipe(bytes: Uint8Array, ctor: StreamCtor | undefined): Promise<Uint8Array | null> {
  if (!ctor) return null;
  try {
    const stream = new ctor('deflate');
    const writer = stream.writable.getWriter();
    void writer.write(bytes);
    void writer.close();
    const buf = await new Response(stream.readable).arrayBuffer();
    return new Uint8Array(buf);
  } catch (e) {
    console.warn('[ghost] stream codec unavailable', e);
    return null;
  }
}

function deflate(bytes: Uint8Array): Promise<Uint8Array | null> {
  return pipe(bytes, (globalThis as { CompressionStream?: StreamCtor }).CompressionStream);
}

function inflate(bytes: Uint8Array): Promise<Uint8Array | null> {
  return pipe(bytes, (globalThis as { DecompressionStream?: StreamCtor }).DecompressionStream);
}
