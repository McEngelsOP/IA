/**
 * Furniture — everything on the course that is not the ground.
 *
 * The job of this file is legibility. A rider coming into a blind switchback at
 * 18 m/s cannot read terrain; they read objects. So every piece here exists to
 * answer one question the rider has at that moment:
 *
 *   markers on the outside of a corner  → how far does this go round?
 *   timber on the ravine lip            → the ground stops HERE
 *   log revetment at a berm base        → this wall is built, you can lean on it
 *   pennants down the ridge             → there is nothing either side of you
 *   stepping rocks in the stream        → this is water, the grip just changed
 *   the arch at the bottom              → you are nearly done
 *
 * Everything is generated in code, welded through finalizeGeometry so the
 * inverted hulls do not tear at the corners, and instanced wherever the same
 * object appears more than a handful of times. Nothing here is loaded.
 */

import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CatmullRomCurve3,
  CylinderGeometry,
  DoubleSide,
  Group,
  IcosahedronGeometry,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  TubeGeometry,
  Vector3,
} from 'three';

import { ITerrain, TrackSectionKind, TrackSampleResult } from '../game/Contracts';
import type { CelOptions } from '../npr/CelMaterial';
import { CelMaterial, attachOutline, disposeCelMaterial, makeCelMesh, registerNprMesh } from '../npr/CelMaterial';
import { finalizeGeometry } from '../npr/OutlineGeometry';
import { RAMPS } from '../npr/Palette';
import { Rng } from '../core/RNG';
import { clamp, clamp01, lerp } from '../core/MathX';
import { SECTION_ORDER, TrackSpline, createTrackSample } from './TrackSpline';
import { buildStoneGeometry } from '../terrain/Scatter';

// ─────────────────────────────────────────────────────────────────────────────
// Scratch
// ─────────────────────────────────────────────────────────────────────────────
const _p = new Vector3();
const _sl = new Vector3();
const _fwd = new Vector3();
const _up = new Vector3();
const _right = new Vector3();
const _m = new Matrix4();
const _scaleV = new Vector3();
const WORLD_UP = new Vector3(0, 1, 0);

type RampName = keyof typeof RAMPS;

/** Defaults every piece of furniture shares. */
const FURNITURE_OPTS: CelOptions = { vertexAo: true };

export class Furniture {
  readonly object = new Group();
  private materials: CelMaterial[] = [];
  private geometries: BufferGeometry[] = [];
  private rng = new Rng('course-furniture');
  /**
   * Two dedicated sample slots. `sampleAtDistance` without an out-parameter
   * returns a ring slot, and a builder that holds a frame across a dozen
   * further sampling calls would silently get somebody else's frame back.
   */
  private smp: TrackSampleResult = createTrackSample();
  private smpB: TrackSampleResult = createTrackSample();

  constructor(private spline: TrackSpline, private terrain: ITerrain) {
    this.object.name = 'track-furniture';

    this.buildStartGate();
    this.buildFinishGate();
    this.buildCornerMarkers();
    this.buildBermRevetment();
    this.buildJumpTimber();
    this.buildRidgeMarkers();
    this.buildStreamRocks();
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Placement helpers
  // ───────────────────────────────────────────────────────────────────────────

  /** A point on the ribbon surface: `lateral` metres left of centre, `h` above. */
  private point(d: number, lateral: number, h: number, out: Vector3): Vector3 {
    const s = this.spline.sampleAtDistance(d, this.smpB);
    this.spline.surfaceLeftAt(d, _sl);
    out.copy(s.position).addScaledVector(_sl, lateral).addScaledVector(s.up, h);
    return out;
  }

  /**
   * Ground height for a post standing beside the trail. Uses the terrain but
   * refuses to follow it more than 1.6m below the ribbon: if a marker ends up
   * on the wrong side of a berm or a ravine edge we want it visibly planted in
   * the ribbon's shoulder rather than dangling in space halfway down a gully.
   */
  private groundY(x: number, z: number, surfaceY: number): number {
    const t = this.terrain.heightAt(x, z);
    if (!Number.isFinite(t)) return surfaceY - 0.1;
    return clamp(t, surfaceY - 1.6, surfaceY + 0.6) - 0.08;
  }

  /** Basis matrix with +Y along `up` and +Z along `forward`. */
  private basis(out: Matrix4, pos: Vector3, up: Vector3, forward: Vector3, scale = 1): Matrix4 {
    _up.copy(up).normalize();
    _fwd.copy(forward);
    _fwd.addScaledVector(_up, -_fwd.dot(_up));
    if (_fwd.lengthSq() < 1e-8) _fwd.set(0, 0, 1).addScaledVector(_up, -_up.z);
    _fwd.normalize();
    _right.crossVectors(_up, _fwd).normalize();
    out.makeBasis(_right, _up, _fwd);
    out.scale(_scaleV.set(scale, scale, scale));
    out.setPosition(pos);
    return out;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Mesh construction
  // ───────────────────────────────────────────────────────────────────────────

  private addStatic(geo: BufferGeometry, preset: RampName, name: string, opts: CelOptions = {}): Mesh {
    finalizeGeometry(geo, { tolerance: 5e-4, maxWeldAngle: 78, ao: true, aoStrength: 0.5 });
    const built = makeCelMesh(geo, preset, { ...FURNITURE_OPTS, ...opts, name });
    built.mesh.castShadow = true;
    built.mesh.receiveShadow = true;
    this.materials.push(built.material);
    this.geometries.push(geo);
    this.object.add(built.group);
    return built.mesh;
  }

  private addInstanced(
    geo: BufferGeometry,
    preset: RampName,
    name: string,
    transforms: Matrix4[],
    opts: CelOptions = {},
  ): InstancedMesh | null {
    if (transforms.length === 0) return null;
    finalizeGeometry(geo, { tolerance: 5e-4, maxWeldAngle: 78, ao: true, aoStrength: 0.5 });

    const n = transforms.length;
    // The cel vertex shader reads all three per-instance channels whenever
    // three defines USE_INSTANCING. Leaving any of them unbound makes the
    // attribute read as (0,0,0,1), which would tint every instance to black.
    const tint = new Float32Array(n * 3);
    const fade = new Float32Array(n);
    const phase = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      // A few percent of value variation between instances so a row of stakes
      // does not read as a repeated stamp.
      const v = 0.94 + this.rng.next() * 0.12;
      tint[i * 3] = v;
      tint[i * 3 + 1] = v;
      tint[i * 3 + 2] = v;
      fade[i] = 1;
      phase[i] = this.rng.next() * Math.PI * 2;
    }
    geo.setAttribute('aInstanceTint', new InstancedBufferAttribute(tint, 3));
    geo.setAttribute('aInstanceFade', new InstancedBufferAttribute(fade, 1));
    geo.setAttribute('aInstancePhase', new InstancedBufferAttribute(phase, 1));

    const instOpts: CelOptions = { ...FURNITURE_OPTS, ...opts, name, instanced: true };
    const material = new CelMaterial(RAMPS[preset], instOpts);
    const mesh = new InstancedMesh(geo, material, n);
    for (let i = 0; i < n; i++) mesh.setMatrixAt(i, transforms[i]);
    mesh.instanceMatrix.needsUpdate = true;
    mesh.name = name;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    registerNprMesh(mesh, material);

    const group = new Group();
    group.name = `${name}:group`;
    const hull = attachOutline(mesh, RAMPS[preset], instOpts);
    if (hull) {
      hull.frustumCulled = true;
      group.add(hull);
    }
    group.add(mesh);
    this.object.add(group);
    this.materials.push(material);
    this.geometries.push(geo);
    return mesh;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // The gates
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * The start gate. Timber, hand-built, slightly agricultural — this is the top
   * of a mountain, not a stadium. Two rough posts, a header, a sagging banner,
   * and a string of bunting that gives the first frame of the race something
   * with a silhouette in it.
   */
  private buildStartGate(): void {
    const d = 2.0;
    const s = this.spline.sampleAtDistance(d, this.smp);
    const span = s.halfWidth + 1.5;
    const postH = 3.5;

    const wood: BufferGeometry[] = [];
    const metal: BufferGeometry[] = [];

    for (const side of [-1, 1]) {
      this.point(d, side * span, 0, _p);
      const baseY = this.groundY(_p.x, _p.z, _p.y);
      const post = postGeometry(0.17, 0.13, postH + (_p.y - baseY));
      this.basis(_m, _p.set(_p.x, baseY, _p.z), WORLD_UP, s.tangent);
      post.applyMatrix4(_m);
      wood.push(post);

      // A knee brace back down the hill. Structurally honest and it reads as
      // built rather than placed.
      const brace = new BoxGeometry(0.09, 0.09, 1.5);
      brace.translate(0, 0, 0.75);
      this.point(d, side * span, postH * 0.62, _p);
      this.basis(_m, _p, WORLD_UP, _fwd.copy(s.tangent).multiplyScalar(-1).addScaledVector(WORLD_UP, -0.85));
      brace.applyMatrix4(_m);
      metal.push(brace);
    }

    // Header beam.
    this.point(d, 0, postH, _p);
    const header = new BoxGeometry(span * 2 + 0.4, 0.26, 0.2);
    this.basis(_m, _p, WORLD_UP, s.tangent);
    header.applyMatrix4(_m);
    wood.push(header);

    this.addStatic(mergeGeos(wood), 'wood', 'start-gate-timber');
    this.addStatic(mergeGeos(metal), 'metal', 'start-gate-braces', { matcapMix: 0.4 });

    // Banner. Sags, and the lower edge is cut with a slow wave so it reads as
    // cloth in silhouette rather than as a rectangle.
    this.point(d, 0, postH - 0.22, _p);
    const banner = bannerGeometry(span * 1.72, 0.92, 0.16, 24, this.rng);
    this.basis(_m, _p, WORLD_UP, s.tangent);
    banner.applyMatrix4(_m);
    this.addStatic(banner, 'marker', 'start-banner', { side: DoubleSide, outlineWidth: 0.009 });

    // Bunting, strung between the posts and drooping.
    const flags: Matrix4[] = [];
    const count = 11;
    for (let i = 1; i < count; i++) {
      const u = i / count;
      const lat = lerp(span * 0.94, -span * 0.94, u);
      const droop = Math.sin(u * Math.PI) * 0.34;
      this.point(d - 0.28, lat, postH - 0.06 - droop, _p);
      this.basis(_m, _p, WORLD_UP, s.tangent, 0.9 + this.rng.next() * 0.25);
      flags.push(_m.clone());
    }
    this.addInstanced(pennantGeometry(0.3, 0.24), 'marker', 'start-bunting', flags, {
      side: DoubleSide,
      outlineWidth: 0.008,
    });
  }

  /**
   * The finish arch. A real swept tube, not two posts and a lintel, because the
   * finish is the one piece of furniture that has to be identifiable from a
   * kilometre up the hill — an arch is the only silhouette on this mountain
   * that could not be a rock.
   */
  private buildFinishGate(): void {
    const d = Math.max(0, this.spline.length - 3.5);
    const s = this.spline.sampleAtDistance(d, this.smp);
    const span = s.halfWidth + 2.4;
    const rise = 5.0;

    const left = this.spline.surfaceLeftAt(d, new Vector3());
    const base = s.position.clone();
    const tangent = s.tangent.clone();
    const groundL = this.groundY(
      base.x + left.x * span,
      base.z + left.z * span,
      base.y,
    );
    const groundR = this.groundY(
      base.x - left.x * span,
      base.z - left.z * span,
      base.y,
    );

    const pts: Vector3[] = [];
    const N = 20;
    for (let i = 0; i <= N; i++) {
      const u = i / N;
      const lat = lerp(span, -span, u);
      // A catenary-ish arch: flat-topped rather than semicircular, which is
      // what a scaffold arch actually looks like and reads far better in
      // silhouette than a half circle.
      const h = rise * Math.pow(Math.sin(u * Math.PI), 0.55);
      const gy = lerp(groundL, groundR, u);
      pts.push(
        new Vector3(
          base.x + left.x * lat,
          gy + h,
          base.z + left.z * lat,
        ),
      );
    }
    const path = new CatmullRomCurve3(pts, false, 'centripetal', 0.5);
    const tube = new TubeGeometry(path, 60, 0.17, 8, false);
    this.addStatic(tube, 'metal', 'finish-arch', { matcapMix: 0.45 });

    // Chequered banner across the apex, built as alternating geometry in two
    // ramps. No texture, no alpha — two solid values, which is exactly how a
    // chequer would be inked.
    const cols = 10;
    const rows = 2;
    const bw = span * 1.5;
    const bh = 1.15;
    const light: BufferGeometry[] = [];
    const dark: BufferGeometry[] = [];
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        const cw = bw / cols;
        const ch = bh / rows;
        const lat = bw * 0.5 - (c + 0.5) * cw;
        const yy = rise - 0.35 - (r + 0.5) * ch;
        const q = new BoxGeometry(cw * 0.995, ch * 0.995, 0.04);
        _p.set(base.x + left.x * lat, lerp(groundL, groundR, 0.5) + yy, base.z + left.z * lat);
        this.basis(_m, _p, WORLD_UP, tangent);
        q.applyMatrix4(_m);
        ((c + r) % 2 === 0 ? light : dark).push(q);
      }
    }
    this.addStatic(mergeGeos(light), 'marker', 'finish-banner-a', { side: DoubleSide });
    this.addStatic(mergeGeos(dark), 'wood', 'finish-banner-b', { side: DoubleSide });

    // Two flag poles, one each side, tall enough to break the horizon.
    const poles: BufferGeometry[] = [];
    const pennants: Matrix4[] = [];
    for (const side of [-1, 1]) {
      this.point(d - 1.2, side * (span + 1.1), 0, _p);
      const gy = this.groundY(_p.x, _p.z, _p.y);
      const h = 5.6;
      const pole = new CylinderGeometry(0.055, 0.075, h, 6);
      pole.translate(0, h * 0.5, 0);
      this.basis(_m, _p.set(_p.x, gy, _p.z), WORLD_UP, tangent);
      pole.applyMatrix4(_m);
      poles.push(pole);

      for (let k = 0; k < 3; k++) {
        _p.set(_p.x, gy + h - 0.35 - k * 0.52, _p.z);
        this.basis(_m, _p, WORLD_UP, tangent, 1.5);
        pennants.push(_m.clone());
      }
    }
    this.addStatic(mergeGeos(poles), 'metal', 'finish-poles', { matcapMix: 0.45 });
    this.addInstanced(pennantGeometry(0.46, 0.3), 'marker', 'finish-pennants', pennants, {
      side: DoubleSide,
      outlineWidth: 0.008,
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Repeated furniture
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Course markers on the OUTSIDE of every corner.
   *
   * Outside, not inside, because the outside of a corner is where the rider is
   * looking as they set up, and a line of markers curving away is the only
   * cheap way to communicate how far a blind corner goes round. They are
   * batched per section so frustum culling can drop the ones behind you.
   */
  private buildCornerMarkers(): void {
    const s = this.spline;
    const stakesBySection = new Map<number, Matrix4[]>();
    const flagsBySection = new Map<number, Matrix4[]>();

    let d = 6;
    while (d < s.length - 8) {
      const i = clamp(Math.round(d / s.spacing), 0, s.count - 1);
      const k = s.curvature[i];
      const mag = Math.abs(k);
      if (mag < 0.010 || s.isGap(d)) {
        d += 4;
        continue;
      }
      // Outside of a left turn (positive curvature) is the rider's right,
      // which is negative lateral in the +left convention.
      const side = -Math.sign(k);
      const sample = s.sampleAtDistance(d, this.smp);
      const lat = side * (sample.halfWidth * 1.16 + 0.85);
      this.point(d, lat, 0, _p);
      const gy = this.groundY(_p.x, _p.z, _p.y);
      _p.y = gy;

      const sec = s.sectionId[i];
      if (!stakesBySection.has(sec)) {
        stakesBySection.set(sec, []);
        flagsBySection.set(sec, []);
      }
      // Lean the stake slightly outward — every marker on a real course has
      // been clipped at some point, and a perfectly plumb row looks placed.
      const lean = _fwd.copy(sample.tangent).addScaledVector(WORLD_UP, 0.0);
      const tiltUp = _up.copy(WORLD_UP).addScaledVector(
        this.spline.surfaceLeftAt(d, _sl),
        side * (0.05 + this.rng.next() * 0.09),
      );
      this.basis(_m, _p, tiltUp, lean, 0.92 + this.rng.next() * 0.2);
      stakesBySection.get(sec)!.push(_m.clone());

      _p.y = gy + 1.02;
      this.basis(_m, _p, tiltUp, lean, 1);
      flagsBySection.get(sec)!.push(_m.clone());

      // Denser through the tightest part of the corner: the marker spacing
      // itself becomes a read on how hard the corner is.
      d += lerp(6.5, 3.0, clamp01((mag - 0.010) / 0.05));
    }

    const stake = () => {
      const g = postGeometry(0.055, 0.04, 1.22);
      return g;
    };
    for (const [sec, list] of stakesBySection) {
      const name = SECTION_ORDER[sec];
      this.addInstanced(stake(), 'wood', `marker-stake:${name}`, list);
      this.addInstanced(markerFlagGeometry(), 'marker', `marker-flag:${name}`, flagsBySection.get(sec)!, {
        side: DoubleSide,
      });
    }
  }

  /**
   * Log revetment along the outer base of every berm.
   *
   * This is the detail that makes a berm read as BUILT. Without it the outer
   * wall is just a raised lump of ground and the rider has no reason to trust
   * it; with a line of half-buried logs along its foot it becomes a structure
   * you can commit to at full lean.
   */
  private buildBermRevetment(): void {
    const s = this.spline;
    const logs: Matrix4[] = [];
    const stakes: Matrix4[] = [];

    let d = 0;
    while (d < s.length) {
      const i = clamp(Math.round(d / s.spacing), 0, s.count - 1);
      const berm = s.bermStrength[i];
      if (berm < 0.3) {
        d += 2.0;
        continue;
      }
      const sample = s.sampleAtDistance(d, this.smp);
      const side = s.bermSide[i];
      const lat = side * (sample.halfWidth * (1.05 + berm * 0.62) + 0.2);
      this.point(d, lat, 0, _p);
      const gy = this.groundY(_p.x, _p.z, _p.y);
      _p.y = gy + 0.12;
      // Cylinder axis is +Y, so the log lies along the track by putting the
      // basis up along the tangent.
      this.basis(_m, _p, sample.tangent, sample.up, 1);
      logs.push(_m.clone());

      if (this.rng.chance(0.45)) {
        this.point(d + 0.6, lat + side * 0.16, 0, _p);
        _p.y = this.groundY(_p.x, _p.z, _p.y);
        this.basis(_m, _p, WORLD_UP, sample.tangent, 0.85 + this.rng.next() * 0.3);
        stakes.push(_m.clone());
      }
      d += 2.5;
    }

    const log = new CylinderGeometry(0.15, 0.17, 2.6, 7);
    this.addInstanced(log, 'wood', 'berm-log', logs);
    this.addInstanced(postGeometry(0.06, 0.05, 0.75), 'wood', 'berm-stake', stakes);
  }

  /**
   * Timber on the jump lips.
   *
   * A squared beam laid across the takeoff with stakes driven in front of it —
   * exactly what a trail crew does to stop a lip eroding backwards under
   * braking. It also happens to be the single most useful visual on the course:
   * a dark horizontal bar of wood across a bright packed lip, seen against sky
   * or against the far side of a ravine, tells the rider precisely where the
   * ground ends.
   */
  private buildJumpTimber(): void {
    const s = this.spline;
    const beams: BufferGeometry[] = [];
    const stakes: Matrix4[] = [];
    const warnFlags: Matrix4[] = [];

    const edges: { d: number; facing: number; warn: boolean }[] = [];
    for (const g of s.gaps) {
      edges.push({ d: g.start, facing: 1, warn: true });
      edges.push({ d: g.end, facing: -1, warn: true });
    }
    if (s.tabletopTakeoff >= 0) edges.push({ d: s.tabletopTakeoff, facing: 1, warn: false });
    if (s.tabletopLanding >= 0) edges.push({ d: s.tabletopLanding, facing: -1, warn: false });

    for (const e of edges) {
      const sample = s.sampleAtDistance(e.d, this.smp);
      const width = sample.halfWidth * 2.25;

      // The beam sits flush with the lip crest: top level with the ribbon,
      // body buried. Only the top face and the outer edge should be visible.
      this.point(e.d - e.facing * 0.16, 0, -0.12, _p);
      const beam = new BoxGeometry(width, 0.3, 0.26);
      this.basis(_m, _p, sample.up, sample.tangent);
      beam.applyMatrix4(_m);
      beams.push(beam);

      const n = Math.max(3, Math.round(width / 1.1));
      for (let k = 0; k <= n; k++) {
        const lat = lerp(width * 0.5, -width * 0.5, k / n);
        this.point(e.d - e.facing * 0.34, lat, -0.22, _p);
        this.basis(_m, _p, sample.up, sample.tangent, 0.9 + this.rng.next() * 0.2);
        stakes.push(_m.clone());
      }

      if (e.warn) {
        for (const side of [-1, 1]) {
          this.point(e.d - e.facing * 0.9, side * (sample.halfWidth + 1.0), 1.15, _p);
          this.basis(_m, _p, WORLD_UP, sample.tangent, 1.35);
          warnFlags.push(_m.clone());
        }
      }
    }

    if (beams.length) this.addStatic(mergeGeos(beams), 'wood', 'lip-timber');
    this.addInstanced(postGeometry(0.05, 0.045, 0.62), 'wood', 'lip-stake', stakes);
    this.addInstanced(markerFlagGeometry(), 'marker', 'lip-warning', warnFlags, { side: DoubleSide });
  }

  /**
   * Warning markers down the exposed ridge. Thin metal poles with a pennant,
   * alternating sides, deliberately taller than anything else on the course so
   * that when the ground falls away either side of you there is still a line of
   * verticals telling you where the crest is.
   */
  private buildRidgeMarkers(): void {
    const s = this.spline;
    const poles: Matrix4[] = [];
    const flags: Matrix4[] = [];
    const range = s.sectionRanges.find((r) => r.kind === TrackSectionKind.RidgeSprint);
    if (!range) return;

    let side = 1;
    for (let d = range.start + 6; d < range.end - 4; d += 14) {
      const sample = s.sampleAtDistance(d, this.smp);
      this.point(d, side * (sample.halfWidth + 0.55), 0, _p);
      const gy = this.groundY(_p.x, _p.z, _p.y);
      _p.y = gy;
      this.basis(_m, _p, WORLD_UP, sample.tangent, 0.95 + this.rng.next() * 0.15);
      poles.push(_m.clone());
      _p.y = gy + 1.9;
      this.basis(_m, _p, WORLD_UP, sample.tangent, 1.25);
      flags.push(_m.clone());
      side = -side;
    }

    const pole = new CylinderGeometry(0.032, 0.045, 2.1, 6);
    pole.translate(0, 1.05, 0);
    this.addInstanced(pole, 'metal', 'ridge-pole', poles, { matcapMix: 0.4 });
    this.addInstanced(markerFlagGeometry(), 'marker', 'ridge-flag', flags, { side: DoubleSide });
  }

  /**
   * Stepping rocks through the stream. Wet rock is the one ramp in the palette
   * with a real specular, so a scatter of these across the crossing reads as
   * water before the rider is anywhere near it — the grip change never arrives
   * as a surprise.
   */
  private buildStreamRocks(): void {
    const s = this.spline;
    const variants: Matrix4[][] = [[], [], []];
    const range = s.sectionRanges.find((r) => r.kind === TrackSectionKind.StreamBed);
    if (!range) return;

    for (let d = range.start; d < range.end; d += 1.4) {
      const i = clamp(Math.round(d / s.spacing), 0, s.count - 1);
      const wet = s.wetness[i];
      if (wet < 0.35) continue;
      const density = 0.22 + wet * 0.5;
      if (!this.rng.chance(density)) continue;

      const sample = s.sampleAtDistance(d, this.smp);
      // Biased to the sides. A couple land on the line on purpose — the stream
      // crossing is supposed to be a decision, not a corridor.
      const bias = this.rng.chance(0.22) ? this.rng.range(-0.35, 0.35) : this.rng.range(0.5, 1.15) * (this.rng.chance(0.5) ? 1 : -1);
      const lat = bias * sample.halfWidth;
      this.point(d, lat, 0, _p);
      const gy = this.groundY(_p.x, _p.z, _p.y);
      _p.y = gy + this.rng.range(-0.06, 0.14);
      _up.copy(WORLD_UP).addScaledVector(sample.tangent, this.rng.signed() * 0.18);
      this.basis(_m, _p, _up, _fwd.copy(sample.tangent).applyAxisAngle(WORLD_UP, this.rng.range(0, Math.PI)), this.rng.range(0.62, 1.35));
      variants[this.rng.int(0, 2)].push(_m.clone());
    }

    for (let v = 0; v < 3; v++) {
      if (!variants[v].length) continue;
      this.addInstanced(buildStoneGeometry(`stream-rock-${v}`, 0.55), 'wetRock', `stream-rock:${v}`, variants[v], {
        outlineWidth: 0.011,
      });
    }
  }

  dispose(): void {
    for (const m of this.materials) disposeCelMaterial(m);
    for (const g of this.geometries) g.dispose();
    this.materials.length = 0;
    this.geometries.length = 0;
    this.object.clear();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Geometry builders — every vertex below is written here, nothing is loaded.
// ─────────────────────────────────────────────────────────────────────────────

/** A tapered octagonal post with its base at the origin. */
function postGeometry(rBottom: number, rTop: number, height: number): BufferGeometry {
  const g = new CylinderGeometry(rTop, rBottom, height, 8, 1, false);
  g.translate(0, height * 0.5, 0);
  return g;
}

/**
 * A course marker flag: a stiff panel canted toward the rider, on a short arm.
 * Canted rather than flat because a flat panel disappears entirely when you
 * approach it edge-on, which is exactly when you need to see it.
 */
function markerFlagGeometry(): BufferGeometry {
  const panel = new BoxGeometry(0.38, 0.28, 0.02);
  panel.rotateY(0.42);
  panel.translate(0, 0.02, 0.04);
  const arm = new BoxGeometry(0.03, 0.03, 0.1);
  arm.translate(0, -0.05, 0);
  return mergeGeos([panel, arm]);
}

/** A tapered pennant, hanging with a slight curl. */
function pennantGeometry(len: number, height: number): BufferGeometry {
  const segs = 4;
  const pos: number[] = [];
  const idx: number[] = [];
  const uv: number[] = [];
  for (let i = 0; i <= segs; i++) {
    const u = i / segs;
    // Taper to a point, and curl the tip away so it is not a flat triangle.
    const h = height * (1 - u * 0.86);
    const curl = Math.sin(u * 2.1) * 0.06;
    pos.push(0, 0, u * len * 0.15 + curl, 0, -h, u * len * 0.15 + curl);
    uv.push(u, 1, u, 0);
    if (i < segs) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
    }
  }
  // Give it width by sweeping in X as well as Z.
  for (let i = 0; i <= segs; i++) {
    pos[i * 6] = (i / segs) * len * -0.98;
    pos[i * 6 + 3] = (i / segs) * len * -0.98;
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * A hanging banner: a plane with a catenary sag along its top edge, a deeper
 * sag along the bottom, and a slow wave cut into the lower edge so the
 * silhouette reads as cloth. Deterministic — the wave comes from the passed Rng.
 */
function bannerGeometry(width: number, height: number, sag: number, segs: number, rng: Rng): BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const phase = rng.range(0, Math.PI * 2);
  const phase2 = rng.range(0, Math.PI * 2);
  for (let i = 0; i <= segs; i++) {
    const u = i / segs;
    const x = (u - 0.5) * width;
    // Catenary: cosh, normalised so the ends sit at 0 and the middle at -sag.
    const c = (Math.cosh((u - 0.5) * 3.2) - Math.cosh(1.6)) / (1 - Math.cosh(1.6));
    const top = -sag * (1 - c);
    const wave = Math.sin(u * 7.3 + phase) * 0.045 + Math.sin(u * 13.1 + phase2) * 0.022;
    const bottom = top - height + wave;
    // A little depth ripple so the banner is not a perfectly flat card.
    const z = Math.sin(u * 5.1 + phase) * 0.035;
    pos.push(x, top, z, x, bottom, z * 1.4);
    uv.push(u, 1, u, 0);
    if (i < segs) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * Stream boulders.
 *
 * This used to be a local `rockGeometry` that displaced an IcosahedronGeometry
 * per vertex. `IcosahedronGeometry` is ALREADY NON-INDEXED — it emits one
 * vertex per triangle corner — so each corner of the solid existed five or six
 * times and every copy took a DIFFERENT random scale. The mesh separated into
 * eighty loose triangles. The inverted hull is a BackSide draw sharing that
 * same buffer, so every loose triangle facing away from the camera was filled
 * as a solid ink wedge with nothing in front of it: the 112 px dark violet
 * shards a stills critic ranked the worst defect in the build. `finalizeGeometry`
 * ran and could not help, because after the displacement nothing was at a
 * shared position left to weld.
 *
 * The build had been announcing it on every boot — three
 * "toNonIndexed(): BufferGeometry is already non-indexed" warnings, one per
 * stream-rock variant — for as long as the warning has been in the log.
 *
 * `buildStoneGeometry` is the welded plane-cut stone the scatter system uses,
 * which is closed (zero open edges) and carries an edge-length-weighted
 * curvature rather than a saturated one.
 */

/**
 * Merge geometries sharing position/normal/uv. Written here rather than pulled
 * from three's addons so the track subsystem has no dependency outside the core
 * three module.
 */
function mergeGeos(parts: BufferGeometry[]): BufferGeometry {
  let vcount = 0;
  let icount = 0;
  for (const p of parts) {
    if (!p.getAttribute('normal')) p.computeVertexNormals();
    if (!p.getAttribute('uv')) {
      p.setAttribute('uv', new BufferAttribute(new Float32Array(p.getAttribute('position').count * 2), 2));
    }
    vcount += p.getAttribute('position').count;
    icount += p.getIndex() ? p.getIndex()!.count : p.getAttribute('position').count;
  }

  const position = new Float32Array(vcount * 3);
  const normal = new Float32Array(vcount * 3);
  const uv = new Float32Array(vcount * 2);
  const index = vcount > 65535 ? new Uint32Array(icount) : new Uint16Array(icount);

  let vo = 0;
  let io = 0;
  for (const p of parts) {
    const pp = p.getAttribute('position') as BufferAttribute;
    const pn = p.getAttribute('normal') as BufferAttribute;
    const pu = p.getAttribute('uv') as BufferAttribute;
    position.set(pp.array as Float32Array, vo * 3);
    normal.set(pn.array as Float32Array, vo * 3);
    uv.set(pu.array as Float32Array, vo * 2);
    const pi = p.getIndex();
    if (pi) {
      for (let i = 0; i < pi.count; i++) index[io + i] = pi.getX(i) + vo;
      io += pi.count;
    } else {
      for (let i = 0; i < pp.count; i++) index[io + i] = i + vo;
      io += pp.count;
    }
    vo += pp.count;
    p.dispose();
  }

  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(position, 3));
  g.setAttribute('normal', new BufferAttribute(normal, 3));
  g.setAttribute('uv', new BufferAttribute(uv, 2));
  g.setIndex(new BufferAttribute(index, 1));
  return g;
}
