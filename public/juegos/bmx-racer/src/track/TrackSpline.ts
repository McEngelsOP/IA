/**
 * TrackSpline — the racing line, and the only authority on "where am I".
 *
 * Everything downstream of this file (the ribbon mesh, the AI's target line,
 * the checkpoints, the HUD's route profile, the camera's look-ahead) asks the
 * same two questions: "give me the track at distance d" and "project this world
 * point onto the track". Both have to be exact and both have to be free, because
 * four racers ask the second one every physics step.
 *
 * How the centreline is built, in order:
 *
 *   1. A centripetal Catmull-Rom through the ROUTE control points, XZ only.
 *      Centripetal parameterisation matters here: the uniform variant overshoots
 *      badly on the switchbacks, where control points are 30m apart on a 25m
 *      radius corner, and the overshoot puts the racing line off the mountain.
 *
 *   2. Resample to uniform XZ spacing, then read the FINAL eroded terrain height
 *      under every sample.
 *
 *   3. Smooth the height profile — but with a variable kernel. A flat 9m kernel
 *      everywhere would take the top off the tabletop and silt up the stream
 *      drop-in, which are exactly the two places the course needs its shape. So
 *      the kernel collapses to ~1.5m inside a TERRAIN_FEATURES footprint and
 *      opens back up over the ordinary hillside where erosion detail is just
 *      chatter the rider should never feel.
 *
 *   4. Explicit lip surgery: the ravine gets a real gap (the centreline bridges
 *      it in a straight line so distance stays monotonic and the AI keeps a
 *      target through the air) with a kicker before it and a receiving ramp
 *      after; the tabletop gets a kicker onto its deck. If the terrain does not
 *      contain those features yet, the profile synthesises them, so the course
 *      is rideable and readable standing alone.
 *
 *   5. Resample AGAIN, this time to uniform 3D arc length. Step 2's samples are
 *      uniform in plan, which on a 35 degree scree face understates distance by
 *      a fifth. Splits, gaps and the HUD's progress bar are all in real metres.
 *
 *   6. Frames, curvature, bank, half-width, berm masks, and a 1D profile texture
 *      the ribbon shader reads so it knows what kind of ground it is drawing.
 */

import {
  CatmullRomCurve3,
  ClampToEdgeWrapping,
  DataTexture,
  LinearFilter,
  RGBAFormat,
  UnsignedByteType,
  Vector3,
} from 'three';

import {
  ITerrain,
  TrackCarve,
  TrackSampleResult,
  TrackSectionKind,
} from '../game/Contracts';
import {
  ROUTE,
  RouteControl,
  TERRAIN_FEATURES,
  TabletopGeometry,
  TerrainFeature,
  corridorHeightAt,
  tabletopGeometry,
  tabletopProfile,
} from '../game/WorldConstants';
import { clamp, clamp01, lerp, smoothstep } from '../core/MathX';

// ─────────────────────────────────────────────────────────────────────────────
// Module-scope scratch. Nothing in the hot path allocates.
// ─────────────────────────────────────────────────────────────────────────────
const _v0 = new Vector3();
const _v1 = new Vector3();
const _v2 = new Vector3();
const _seg = new Vector3();
const _rel = new Vector3();

/** Section order, so a section can live in a Uint8Array. */
/**
 * How much the course is allowed to go UP. See `limitClimb`.
 *
 * 4.5 deg and 1.6 m are chosen from what a rider can carry speed over rather
 * than from what looks tidy on a graph: coasting onto a 1.6 m rise costs
 * sqrt(2 g h) = 5.6 m/s of stored speed, which a bike already doing 40 km/h
 * gives up without the player feeling cheated. Rollers, dips and the back side
 * of a compression all still read; hills do not.
 */
const MAX_UPHILL_GRADE = (4.5 * Math.PI) / 180;
const MAX_UPHILL_RISE = 1.6;

export const SECTION_ORDER: readonly TrackSectionKind[] = [
  TrackSectionKind.TechnicalStart,
  TrackSectionKind.ScreeRun,
  TrackSectionKind.Switchbacks,
  TrackSectionKind.RockGarden,
  TrackSectionKind.Tabletop,
  TrackSectionKind.RavineGap,
  TrackSectionKind.RidgeSprint,
  TrackSectionKind.StreamBed,
  TrackSectionKind.FinalSprint,
];

const SECTION_INDEX = new Map<TrackSectionKind, number>(
  SECTION_ORDER.map((s, i) => [s, i]),
);

export interface SectionRange {
  kind: TrackSectionKind;
  index: number;
  start: number;
  end: number;
}

/** A stretch of track with no ground under it. The rider is expected to jump. */
export interface TrackGap {
  /** Distance where the ribbon ends and the takeoff lip is. */
  start: number;
  /** Distance where the ribbon resumes. */
  end: number;
  /** Height of the takeoff lip crest. */
  takeoffY: number;
  landingY: number;
}

/** Result of `project`. Reused from a small ring — consume it immediately. */
export interface TrackProjection {
  distance: number;
  lateral: number;
  vertical: number;
  sample: TrackSampleResult;
}

export interface TrackSplineOptions {
  /** Sample spacing in metres along the finished centreline. */
  spacing?: number;
  /** Height smoothing kernel radius over ordinary hillside, metres. */
  smoothRadius?: number;
  /** Height smoothing kernel radius inside a designed feature, metres. */
  featureRadius?: number;
  /** Kernel radius across a takeoff lip, metres. A lip is a corner. */
  lipRadius?: number;
  /** How far the ribbon surface floats above the conformed terrain. */
  lift?: number;
  /** Local search half-window used by `project` when a hint is supplied. */
  hintWindow?: number;
  /**
   * Truncate the finished course to this many metres of arc length.
   *
   * The MOUNTAIN is built from the full route — the massif's descent profile,
   * the corridor prior and the terrain features all key off it — so shortening
   * the route itself would shrink the whole world with it and flatten the
   * skyline. Truncating the TRACK instead keeps the mountain exactly as it is
   * and simply ends the ribbon, and with it the race, early: `length` is the
   * single number the finish line, the checkpoints, the HUD profile and the
   * AI's planner all measure against, so every one of them follows without
   * knowing this happened.
   */
  maxLength?: number;
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Allocate a TrackSampleResult you own.
 *
 * `sampleAtDistance` without an `out` argument hands back a slot from a small
 * ring, which is right for read-it-now call sites and wrong for anything that
 * holds a sample across other sampling calls. Build-time code that needs a
 * stable sample takes one of these instead.
 */
export function createTrackSample(): TrackSampleResult {
  return makeSample();
}

function makeSample(): TrackSampleResult {
  return {
    position: new Vector3(),
    tangent: new Vector3(0, 0, 1),
    left: new Vector3(1, 0, 0),
    up: new Vector3(0, 1, 0),
    halfWidth: 4,
    bank: 0,
    curvature: 0,
    distance: 0,
    t: 0,
    section: TrackSectionKind.TechnicalStart,
  };
}

/**
 * A terrain feature's long axis in the XZ plane, using the same
 * (sin, cos) azimuth convention as SUN_DIRECTION in Palette.ts. Under this
 * convention the ravine (angle 1.44) runs almost due east-west and therefore
 * genuinely crosses the route, and the ridge (angle 0.24) runs almost due
 * north-south and therefore runs along it — which is what both are for.
 */
function featureAxis(angle: number, out: { ax: number; az: number; nx: number; nz: number }): void {
  out.ax = Math.sin(angle);
  out.az = Math.cos(angle);
  // Left-hand perpendicular in the plan view.
  out.nx = out.az;
  out.nz = -out.ax;
}

const _axis = { ax: 0, az: 0, nx: 0, nz: 0 };

/** Signed perpendicular distance from (x,z) to a feature's centre axis. */
function axisOffset(f: TerrainFeature, x: number, z: number): number {
  featureAxis(f.params.angle ?? 0, _axis);
  return (x - (f.x ?? 0)) * _axis.nx + (z - (f.z ?? 0)) * _axis.nz;
}

// ─────────────────────────────────────────────────────────────────────────────

export class TrackSpline {
  readonly spacing: number;
  readonly count: number;
  readonly length: number;
  readonly lift: number;

  // Centreline. Separate typed arrays rather than an array of objects: every
  // one of these is read in a tight loop by `project`, and an array of small
  // objects costs a pointer chase per sample.
  readonly px: Float32Array;
  readonly py: Float32Array;
  readonly pz: Float32Array;
  /** Forward tangent, 3D, normalised. */
  readonly tx: Float32Array;
  readonly ty: Float32Array;
  readonly tz: Float32Array;
  /** Horizontal left (the contract's `left`). */
  readonly lx: Float32Array;
  readonly lz: Float32Array;
  /** Banked surface up. */
  readonly ux: Float32Array;
  readonly uy: Float32Array;
  readonly uz: Float32Array;
  /** Banked surface left — orthogonal to `up`. Used for all lateral maths. */
  readonly slx: Float32Array;
  readonly sly: Float32Array;
  readonly slz: Float32Array;

  readonly halfWidth: Float32Array;
  readonly bank: Float32Array;
  readonly curvature: Float32Array;
  readonly sectionId: Uint8Array;
  /** 0 normal ground, 1 inside a jump gap (no ribbon here). */
  readonly gapMask: Float32Array;
  /** 0..1 how much this sample is a takeoff lip. Drives the ribbon's value. */
  readonly lipMask: Float32Array;
  /** 0..1 berm strength; sign of `bermSide` is the outer side in +left units. */
  readonly bermStrength: Float32Array;
  readonly bermSide: Float32Array;
  /** 0..1 how wet the surface reads. */
  readonly wetness: Float32Array;
  /** 0..1 how rocky/broken the surface reads. */
  readonly rockiness: Float32Array;

  readonly sectionRanges: SectionRange[] = [];
  readonly gaps: TrackGap[] = [];
  /** Distance of the tabletop takeoff crest, or -1 if the feature is absent. */
  readonly tabletopTakeoff: number = -1;
  readonly tabletopLanding: number = -1;

  private readonly hintWindow: number;
  private readonly sampleRing: TrackSampleResult[] = [];
  private readonly projRing: TrackProjection[] = [];
  private ringIdx = 0;
  private projIdx = 0;

  private profileTex: DataTexture | null = null;
  private carve: TrackCarve | null = null;

  constructor(terrain: ITerrain, opts: TrackSplineOptions = {}) {
    const spacing = opts.spacing ?? 0.5;
    const smoothRadius = opts.smoothRadius ?? 9;
    const featureRadius = opts.featureRadius ?? 1.6;
    const lipRadius = opts.lipRadius ?? 0.5;
    this.lift = opts.lift ?? 0.06;
    this.hintWindow = opts.hintWindow ?? 22;

    // ── 1. Plan curve ────────────────────────────────────────────────────────
    const ctrl = ROUTE.map((r) => new Vector3(r.x, 0, r.z));
    const curve = new CatmullRomCurve3(ctrl, false, 'centripetal', 0.5);

    // Dense parametric sampling, then a uniform-in-plan resample. Doing it in
    // two steps rather than trusting getSpacedPoints keeps the control-point
    // fraction (which carries half-width, bank and section) attached to every
    // sample, which getSpacedPoints throws away.
    const DENSE = 12000;
    const dx = new Float64Array(DENSE + 1);
    const dz = new Float64Array(DENSE + 1);
    const dcum = new Float64Array(DENSE + 1);
    for (let i = 0; i <= DENSE; i++) {
      curve.getPoint(i / DENSE, _v0);
      dx[i] = _v0.x;
      dz[i] = _v0.z;
      if (i > 0) {
        dcum[i] = dcum[i - 1] + Math.hypot(dx[i] - dx[i - 1], dz[i] - dz[i - 1]);
      }
    }
    const planLength = dcum[DENSE];

    const planCount = Math.max(2, Math.round(planLength / spacing) + 1);
    const planStep = planLength / (planCount - 1);
    const ax = new Float64Array(planCount);
    const az = new Float64Array(planCount);
    const actrl = new Float64Array(planCount); // control-point fraction
    {
      let j = 0;
      for (let i = 0; i < planCount; i++) {
        const target = i * planStep;
        while (j < DENSE && dcum[j + 1] < target) j++;
        const seg = dcum[j + 1] - dcum[j];
        const f = seg > 1e-9 ? (target - dcum[j]) / seg : 0;
        ax[i] = lerp(dx[j], dx[j + 1], f);
        az[i] = lerp(dz[j], dz[j + 1], f);
        // Catmull-Rom parameter -> control index. The curve is open, so t
        // spans [0,1] over (n-1) segments.
        const tParam = (j + f) / DENSE;
        actrl[i] = tParam * (ctrl.length - 1);
      }
    }

    // ── 2. Terrain heights ───────────────────────────────────────────────────
    const raw = new Float64Array(planCount);
    for (let i = 0; i < planCount; i++) {
      raw[i] = safeHeight(terrain, ax[i], az[i], i / (planCount - 1));
    }

    // ── 3. Feature-aware smoothing ───────────────────────────────────────────
    // The tabletop's footprint is asymmetric about its anchor (the anchor is the
    // LIP: 9 m of face behind it, 38 m of deck and landing ahead), so it cannot
    // be described by a radius the way the ravine and the stream can. It is
    // stamped by plan index instead, off the same geometry the heightfield used.
    const tabletop = TERRAIN_FEATURES.find((f) => f.kind === 'tabletop');
    const tabGeom = tabletop ? tabletopGeometry(tabletop) : null;
    const tabLip = tabletop
      ? nearestPlanIndex(ax, az, tabletop.x ?? 0, tabletop.z ?? 0)
      : -1;

    const preserve = new Float32Array(planCount);
    for (let i = 0; i < planCount; i++) {
      preserve[i] = featurePreservation(ax[i], az[i]);
    }
    const sharp = new Float32Array(planCount);
    if (tabGeom && tabLip >= 0) {
      const edge = 6;
      for (let i = 0; i < planCount; i++) {
        const s = (i - tabLip) * planStep;
        if (s < tabGeom.sMin - edge || s > tabGeom.sMax + edge) continue;
        const w =
          smoothstep(tabGeom.sMin - edge, tabGeom.sMin, s) *
          (1 - smoothstep(tabGeom.sMax, tabGeom.sMax + edge, s));
        if (w > preserve[i]) preserve[i] = w;
        // The lip itself: no smoothing at all for 2.5 m either side of it.
        sharp[i] = 1 - smoothstep(2.5, 6.0, Math.abs(s));
      }
    }
    const smoothed = variableSmooth(
      raw, preserve, sharp, planStep, smoothRadius, featureRadius, lipRadius,
    );
    limitSlope(smoothed, planStep, 1.05);

    // The course descends. See `limitClimb` — `limitSlope` above bounds the
    // MAGNITUDE of the gradient and is entirely indifferent to its sign, which
    // is how a point-to-point downhill race ended up with 74.8 m of climbing in
    // it. Runs here, before the lip surgery, so authored takeoffs are added to
    // an already-descending profile and are never themselves cut down.
    limitClimb(smoothed, planStep, MAX_UPHILL_GRADE, MAX_UPHILL_RISE, preserve);

    // ── 4. Lip surgery ───────────────────────────────────────────────────────
    const gapFlagPlan = new Float32Array(planCount);
    const lipFlagPlan = new Float32Array(planCount);
    const gapsPlan: { start: number; end: number }[] = [];

    const ravine = TERRAIN_FEATURES.find((f) => f.kind === 'ravine');
    if (ravine) {
      this.carveRavine(ravine, ax, az, smoothed, gapFlagPlan, lipFlagPlan, planStep, gapsPlan);
    }
    let tabTakeoffPlan = -1;
    let tabLandingPlan = -1;
    if (tabGeom && tabLip >= 0) {
      const r = this.carveTabletop(tabGeom, tabLip, smoothed, lipFlagPlan, planStep);
      tabTakeoffPlan = r.takeoff;
      tabLandingPlan = r.landing;
    }

    // The surgery above writes into an already slope-limited profile, so run the
    // limit again over the result.
    //
    // This is the invariant that was actually violated, and it is worth naming.
    // `ax`/`az` are uniform in PLAN, so bounding |dy| per plan sample is exactly
    // the statement "the centreline is a single-valued function of XZ with a
    // gradient a bike can ride". The old tabletop surgery added its full mound
    // height twice at one index — once as the last step of the run-up ramp and
    // again as the first step of the deck — putting 4.2 m of rise into a 0.5 m
    // plan step. Step 5 then resampled that segment to uniform 3D arc length and
    // spread the spike over 8 m of track, producing a centreline that climbed
    // 4 m and fell 4.45 m across 1 m of ground: not a function of XZ, so no
    // heightfield could ever agree with it and the bike fell through the
    // mountain. Enforcing the invariant HERE means no future edit to the surgery
    // can reintroduce the same class of bug silently.
    limitSlope(smoothed, planStep, 1.05);

    // Per-control lift, if the route ever asks for one.
    for (let i = 0; i < planCount; i++) {
      const cf = actrl[i];
      const c0 = ROUTE[clamp(Math.floor(cf), 0, ROUTE.length - 1)];
      const c1 = ROUTE[clamp(Math.floor(cf) + 1, 0, ROUTE.length - 1)];
      const f = cf - Math.floor(cf);
      const extra = lerp(c0.lift ?? 0, c1.lift ?? 0, f);
      smoothed[i] += this.lift + extra;
    }

    // ── 5. Resample to uniform 3D arc length ─────────────────────────────────
    const cum3 = new Float64Array(planCount);
    for (let i = 1; i < planCount; i++) {
      const dy = smoothed[i] - smoothed[i - 1];
      cum3[i] = cum3[i - 1] + Math.hypot(planStep, dy);
    }
    const total3 = Math.min(cum3[planCount - 1], opts.maxLength ?? Infinity);
    const count = Math.max(2, Math.round(total3 / spacing) + 1);
    const step3 = total3 / (count - 1);

    this.count = count;
    this.spacing = step3;
    this.length = total3;

    this.px = new Float32Array(count);
    this.py = new Float32Array(count);
    this.pz = new Float32Array(count);
    this.tx = new Float32Array(count);
    this.ty = new Float32Array(count);
    this.tz = new Float32Array(count);
    this.lx = new Float32Array(count);
    this.lz = new Float32Array(count);
    this.ux = new Float32Array(count);
    this.uy = new Float32Array(count);
    this.uz = new Float32Array(count);
    this.slx = new Float32Array(count);
    this.sly = new Float32Array(count);
    this.slz = new Float32Array(count);
    this.halfWidth = new Float32Array(count);
    this.bank = new Float32Array(count);
    this.curvature = new Float32Array(count);
    this.sectionId = new Uint8Array(count);
    this.gapMask = new Float32Array(count);
    this.lipMask = new Float32Array(count);
    this.bermStrength = new Float32Array(count);
    this.bermSide = new Float32Array(count);
    this.wetness = new Float32Array(count);
    this.rockiness = new Float32Array(count);

    const ctrlF = new Float32Array(count);
    {
      let j = 0;
      for (let i = 0; i < count; i++) {
        const target = i * step3;
        while (j < planCount - 2 && cum3[j + 1] < target) j++;
        const seg = cum3[j + 1] - cum3[j];
        const f = seg > 1e-9 ? clamp01((target - cum3[j]) / seg) : 0;
        this.px[i] = lerp(ax[j], ax[j + 1], f);
        this.py[i] = lerp(smoothed[j], smoothed[j + 1], f);
        this.pz[i] = lerp(az[j], az[j + 1], f);
        ctrlF[i] = lerp(actrl[j], actrl[j + 1], f);
        // Masks are step functions; taking the nearer neighbour keeps the gap
        // boundary exactly on a sample so the ribbon's end cap lands on the lip.
        const n = f < 0.5 ? j : j + 1;
        this.gapMask[i] = gapFlagPlan[n];
        this.lipMask[i] = Math.max(lipFlagPlan[j], lipFlagPlan[j + 1]);
      }
    }

    // ── 6. Frames, curvature, bank, width ────────────────────────────────────
    this.buildFrames(ctrlF);
    this.buildSectionRanges();
    this.buildSurfaceMasks();

    // Gap ranges, converted from plan distance to 3D distance.
    for (const g of gapsPlan) {
      const s = planToArc(g.start, planStep, cum3);
      const e = planToArc(g.end, planStep, cum3);
      this.gaps.push({
        start: s,
        end: e,
        takeoffY: this.py[clamp(Math.round(s / step3), 0, count - 1)],
        landingY: this.py[clamp(Math.round(e / step3), 0, count - 1)],
      });
    }
    if (tabTakeoffPlan >= 0) {
      (this as { tabletopTakeoff: number }).tabletopTakeoff = planToArc(tabTakeoffPlan, planStep, cum3);
      (this as { tabletopLanding: number }).tabletopLanding = planToArc(tabLandingPlan, planStep, cum3);
    }

    for (let i = 0; i < 12; i++) this.sampleRing.push(makeSample());
    for (let i = 0; i < 8; i++) {
      this.projRing.push({ distance: 0, lateral: 0, vertical: 0, sample: makeSample() });
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Construction helpers
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * The ravine. The centreline does NOT drop into it: it bridges the hole in a
   * straight line so distance stays monotonic and the AI keeps a target through
   * the air. The takeoff gets a genuine kicker in the last 7m — without it a
   * flat approach to a hole reads as a bug rather than as a jump — and the far
   * side gets a receiving ramp that falls away from the lip so a long landing
   * is absorbed rather than punished.
   */
  private carveRavine(
    f: TerrainFeature,
    ax: Float64Array,
    az: Float64Array,
    h: Float64Array,
    gapFlag: Float32Array,
    lipFlag: Float32Array,
    step: number,
    out: { start: number; end: number }[],
  ): void {
    const halfGap = (f.params.width ?? 11.5) * 0.5;
    let lo = -1;
    let hi = -1;
    for (let i = 0; i < ax.length; i++) {
      if (Math.abs(axisOffset(f, ax[i], az[i])) < halfGap) {
        if (lo < 0) lo = i;
        hi = i;
      } else if (lo >= 0 && hi >= 0 && i - hi > 40) {
        break; // first crossing only
      }
    }
    if (lo < 0 || hi <= lo) return;

    // Pull the lips in by one sample so the ribbon's end cap sits ON solid
    // ground rather than hanging over the void.
    const takeoff = Math.max(0, lo - 1);
    const landing = Math.min(ax.length - 1, hi + 1);

    const takeoffBase = h[takeoff];
    const landingBase = h[landing];

    // Kicker: a quadratic ramp so the rate of rise increases into the lip,
    // which is what makes a takeoff feel like it throws you rather than like
    // you rolled off a kerb.
    const runUp = 7.0;
    const rise = 1.15;
    const runSamples = Math.round(runUp / step);
    for (let k = 0; k <= runSamples; k++) {
      const i = takeoff - runSamples + k;
      if (i < 0) continue;
      const u = k / runSamples;
      h[i] += rise * Math.pow(u, 2.1);
      lipFlag[i] = Math.max(lipFlag[i], smoothstep(0.45, 1.0, u));
    }

    // Bridge the hole. Straight line between the two lip crests.
    const lipTop = takeoffBase + rise;
    for (let i = takeoff; i <= landing; i++) {
      const u = (i - takeoff) / Math.max(1, landing - takeoff);
      h[i] = lerp(lipTop, landingBase + 0.42, u);
      if (i > takeoff && i < landing) gapFlag[i] = 1;
    }

    // Receiving ramp: +0.42 at the lip, falling to -0.95 by 11m, blended out
    // by 22m. Keyframed rather than a single curve because the landing needs a
    // brief flat at the lip for the wheels to catch before it falls away.
    const keys: [number, number][] = [
      [0, 0.42],
      [2.5, 0.30],
      [11, -0.95],
      [22, 0],
    ];
    const span = Math.round(22 / step);
    for (let k = 1; k <= span; k++) {
      const i = landing + k;
      if (i >= ax.length) break;
      h[i] += sampleKeyframes(keys, k * step);
    }
    lipFlag[landing] = Math.max(lipFlag[landing], 0.8);

    out.push({ start: takeoff * step, end: landing * step });
  }

  /**
   * The tabletop.
   *
   * The heightfield carve normally builds the whole mound, and when it has, this
   * does nothing to the profile at all — the centreline simply conforms, which
   * is the arrangement the rest of the course already uses and the only one in
   * which the collision surface and the racing line cannot drift apart.
   *
   * The synthesis path exists for the case the docstring at the top of the file
   * promises: a heightfield that does not contain the feature (a reduced-
   * resolution build, a terrain bug) must still produce a rideable, readable
   * jump. It adds only the DEFICIT, and it adds it as `tabletopProfile` — the
   * same shape function the heightfield carve used — so whatever mix of real and
   * synthetic ground results, the sum is still that one curve. `tabletopProfile`
   * is zero and zero-sloped at both ends, so no amount of it can introduce a
   * step at the boundary.
   *
   * What this used to do, and must never do again: run a ramp loop up to and
   * INCLUDING `iTake`, then a deck loop starting AT `iTake`, so the crest height
   * landed on that one sample twice.
   */
  private carveTabletop(
    g: TabletopGeometry,
    iLip: number,
    h: Float64Array,
    lipFlag: Float32Array,
    step: number,
  ): { takeoff: number; landing: number } {
    const n = h.length;
    const idx = (s: number): number => iLip + Math.round(s / step);
    const iFace = idx(-g.face);
    const iDeckEnd = idx(g.deck);
    const iBefore = idx(g.sMin);
    const iAfter = idx(g.sMax);
    if (iBefore < 0 || iAfter >= n || iDeckEnd <= iFace) return { takeoff: -1, landing: -1 };

    // Is the mound already in the ground? Measure the deck against the CHORD of
    // the untouched profile either side of the whole footprint.
    //
    // The old test extrapolated the approach gradient across the deck. On a jump
    // the approach gradient is the kicker face — steeply uphill by definition —
    // so it predicted a deck several metres higher than any real deck, decided
    // the mound was missing, and synthesised a second 4.2 m one on top of the
    // first. A chord across ground the feature does not touch has no such
    // circularity.
    const span = Math.max(1, iAfter - iBefore);
    let crest = -Infinity;
    for (let i = iLip; i <= iDeckEnd; i++) {
      const chord = lerp(h[iBefore], h[iAfter], (i - iBefore) / span);
      if (h[i] - chord > crest) crest = h[i] - chord;
    }

    const deficit = clamp(g.height - crest, 0, g.height);
    if (deficit > 0.2) {
      const invH = 1 / Math.max(g.height, 1e-3);
      for (let i = iBefore; i <= iAfter; i++) {
        h[i] += deficit * tabletopProfile(g, (i - iLip) * step) * invH;
      }
    }

    // The lip mask. The ribbon shader lightens the takeoff so it reads at
    // distance, and the bank is flattened where this is high — a banked lip is
    // unlaunchable.
    const faceSpan = Math.max(1, iLip - iFace);
    for (let i = Math.max(0, iFace); i <= iLip; i++) {
      lipFlag[i] = Math.max(lipFlag[i], smoothstep(0.4, 1.0, (i - iFace) / faceSpan));
    }
    lipFlag[iDeckEnd] = Math.max(lipFlag[iDeckEnd], 0.55);

    return { takeoff: iLip * step, landing: iDeckEnd * step };
  }

  private buildFrames(ctrlF: Float32Array): void {
    const n = this.count;
    const s = this.spacing;

    // Horizontal tangents first — turning is a plan-view question, and letting
    // the vertical component into the curvature estimate makes the ravine lip
    // read as a corner to the HUD.
    const hx = new Float32Array(n);
    const hz = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - 1);
      const b = Math.min(n - 1, i + 1);
      let dxv = this.px[b] - this.px[a];
      let dzv = this.pz[b] - this.pz[a];
      const l = Math.hypot(dxv, dzv) || 1;
      hx[i] = dxv / l;
      hz[i] = dzv / l;
    }

    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - 1);
      const b = Math.min(n - 1, i + 1);
      let dxv = this.px[b] - this.px[a];
      let dyv = this.py[b] - this.py[a];
      let dzv = this.pz[b] - this.pz[a];
      const l = Math.hypot(dxv, dyv, dzv) || 1;
      this.tx[i] = dxv / l;
      this.ty[i] = dyv / l;
      this.tz[i] = dzv / l;
      // left = up x tangent, projected to the plane.
      this.lx[i] = hz[i];
      this.lz[i] = -hx[i];
    }

    // Curvature: rate of change of the horizontal tangent, measured along the
    // horizontal left. Positive = turning left, per the contract.
    const rawCurv = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - 1);
      const b = Math.min(n - 1, i + 1);
      const ds = (b - a) * s;
      if (ds < 1e-6) continue;
      const dtx = (hx[b] - hx[a]) / ds;
      const dtz = (hz[b] - hz[a]) / ds;
      rawCurv[i] = dtx * this.lx[i] + dtz * this.lz[i];
    }
    boxSmooth(rawCurv, this.curvature, Math.max(1, Math.round(3.0 / s)));

    // Half-width and requested bank, interpolated between control points and
    // then smoothed. The raw interpolation has corners at every control point,
    // and a corner in the width is a visible kink in the ribbon's edge.
    const rawHw = new Float32Array(n);
    const rawBank = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const cf = clamp(ctrlF[i], 0, ROUTE.length - 1);
      const i0 = Math.min(ROUTE.length - 1, Math.floor(cf));
      const i1 = Math.min(ROUTE.length - 1, i0 + 1);
      const f = smoothstep(0, 1, cf - i0);
      const c0: RouteControl = ROUTE[i0];
      const c1: RouteControl = ROUTE[i1];
      rawHw[i] = lerp(c0.halfWidth, c1.halfWidth, f);
      rawBank[i] = lerp(c0.bank ?? 0, c1.bank ?? 0, f);
      this.sectionId[i] = SECTION_INDEX.get(ROUTE[Math.round(cf)].section) ?? 0;
    }
    boxSmooth(rawHw, this.halfWidth, Math.max(1, Math.round(6.0 / s)));

    const smoothBank = new Float32Array(n);
    boxSmooth(rawBank, smoothBank, Math.max(1, Math.round(9.0 / s)));

    for (let i = 0; i < n; i++) {
      let b = smoothBank[i];
      // Where the route asked for nothing, let the corner bank itself a little.
      // Capped hard: a full curvature-derived bank on a fast open sweeper would
      // put the ribbon on edge and the section is supposed to read as flat-out,
      // not as a wall of death.
      if (Math.abs(b) < 0.05) {
        const auto = clamp(this.curvature[i] * 6.0, -0.14, 0.14);
        b = lerp(auto, b, clamp01(Math.abs(b) / 0.05));
      }
      // The takeoff lips are flat. A banked lip is unlaunchable.
      b *= 1 - clamp01(this.lipMask[i]) * 0.85;
      this.bank[i] = b;

      const cb = Math.cos(b);
      const sb = Math.sin(b);
      const lxh = this.lx[i];
      const lzh = this.lz[i];
      // up  = cos(b) * Y + sin(b) * leftH   (positive bank raises the right)
      this.ux[i] = sb * lxh;
      this.uy[i] = cb;
      this.uz[i] = sb * lzh;
      // surface left = cos(b) * leftH - sin(b) * Y  (orthogonal to up)
      this.slx[i] = cb * lxh;
      this.sly[i] = -sb;
      this.slz[i] = cb * lzh;
    }
  }

  private buildSectionRanges(): void {
    let start = 0;
    for (let i = 1; i <= this.count; i++) {
      if (i === this.count || this.sectionId[i] !== this.sectionId[start]) {
        const idx = this.sectionId[start];
        this.sectionRanges.push({
          kind: SECTION_ORDER[idx],
          index: idx,
          start: start * this.spacing,
          end: (i - 1) * this.spacing,
        });
        start = i;
      }
    }
  }

  /**
   * Per-sample surface character. This is what makes a section READ: the ribbon
   * shader reads wetness and rockiness out of the profile texture and changes
   * the ground under the rider without anybody being told.
   */
  private buildSurfaceMasks(): void {
    const n = this.count;
    const rawWet = new Float32Array(n);
    const rawRock = new Float32Array(n);

    const stream = TERRAIN_FEATURES.find((f) => f.kind === 'stream-channel');
    const rockGarden = TERRAIN_FEATURES.find((f) => f.kind === 'rock-garden');

    for (let i = 0; i < n; i++) {
      const sec = SECTION_ORDER[this.sectionId[i]];
      let wet = 0;
      let rock = 0;

      if (sec === TrackSectionKind.StreamBed) wet = 0.55;
      if (sec === TrackSectionKind.RockGarden) rock = 0.85;
      if (sec === TrackSectionKind.ScreeRun) rock = 0.42;
      if (sec === TrackSectionKind.TechnicalStart) rock = 0.55;
      if (sec === TrackSectionKind.RidgeSprint) rock = 0.30;

      // The channel itself is far wetter than the section average — the trail
      // is only actually in the water for the twenty metres it crosses.
      if (stream) {
        const off = Math.abs(axisOffset(stream, this.px[i], this.pz[i]));
        const w = (stream.params.width ?? 14) * 0.5;
        wet = Math.max(wet, 1 - smoothstep(w * 0.7, w * 1.9, off));
      }
      if (rockGarden) {
        const r = Math.hypot(this.px[i] - (rockGarden.x ?? 0), this.pz[i] - (rockGarden.z ?? 0));
        rock = Math.max(rock, 1 - smoothstep((rockGarden.params.radius ?? 70) * 0.45, (rockGarden.params.radius ?? 70) * 1.05, r));
      }

      rawWet[i] = wet;
      rawRock[i] = rock;

      // Berms. Only the switchbacks asked for real bank, and only a real bank
      // gets a raised outer edge — an auto-banked sweeper stays a sweeper.
      const b = this.bank[i];
      const strength = clamp01((Math.abs(b) - 0.20) / 0.30);
      this.bermStrength[i] = strength;
      this.bermSide[i] = strength > 0 ? -Math.sign(b) : 0;
    }

    const k = Math.max(1, Math.round(6 / this.spacing));
    boxSmooth(rawWet, this.wetness, k);
    boxSmooth(rawRock, this.rockiness, k);
    const bs = new Float32Array(this.bermStrength);
    boxSmooth(bs, this.bermStrength, Math.max(1, Math.round(4 / this.spacing)));
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Sampling
  // ───────────────────────────────────────────────────────────────────────────

  /** Exact, O(1). The sample table is uniform in arc length by construction. */
  sampleAtDistance(d: number, out?: TrackSampleResult): TrackSampleResult {
    const r = out ?? this.sampleRing[this.ringIdx++ & 11];
    const dc = clamp(d, 0, this.length);
    const fi = dc / this.spacing;
    const i0 = clamp(Math.floor(fi), 0, this.count - 1);
    const i1 = Math.min(this.count - 1, i0 + 1);
    const f = fi - i0;

    r.position.set(
      lerp(this.px[i0], this.px[i1], f),
      lerp(this.py[i0], this.py[i1], f),
      lerp(this.pz[i0], this.pz[i1], f),
    );
    r.tangent
      .set(lerp(this.tx[i0], this.tx[i1], f), lerp(this.ty[i0], this.ty[i1], f), lerp(this.tz[i0], this.tz[i1], f))
      .normalize();
    r.left.set(lerp(this.lx[i0], this.lx[i1], f), 0, lerp(this.lz[i0], this.lz[i1], f)).normalize();
    r.up
      .set(lerp(this.ux[i0], this.ux[i1], f), lerp(this.uy[i0], this.uy[i1], f), lerp(this.uz[i0], this.uz[i1], f))
      .normalize();
    r.halfWidth = lerp(this.halfWidth[i0], this.halfWidth[i1], f);
    r.bank = lerp(this.bank[i0], this.bank[i1], f);
    r.curvature = lerp(this.curvature[i0], this.curvature[i1], f);
    r.distance = dc;
    r.t = this.length > 0 ? dc / this.length : 0;
    r.section = SECTION_ORDER[this.sectionId[f < 0.5 ? i0 : i1]];
    return r;
  }

  sampleAtT(t: number, out?: TrackSampleResult): TrackSampleResult {
    return this.sampleAtDistance(clamp01(t) * this.length, out);
  }

  /** The banked surface-left at a distance. Orthogonal to the surface up. */
  surfaceLeftAt(d: number, out: Vector3): Vector3 {
    const fi = clamp(d, 0, this.length) / this.spacing;
    const i0 = clamp(Math.floor(fi), 0, this.count - 1);
    const i1 = Math.min(this.count - 1, i0 + 1);
    const f = fi - i0;
    return out
      .set(lerp(this.slx[i0], this.slx[i1], f), lerp(this.sly[i0], this.sly[i1], f), lerp(this.slz[i0], this.slz[i1], f))
      .normalize();
  }

  heightAtDistance(d: number): number {
    const fi = clamp(d, 0, this.length) / this.spacing;
    const i0 = clamp(Math.floor(fi), 0, this.count - 1);
    const i1 = Math.min(this.count - 1, i0 + 1);
    return lerp(this.py[i0], this.py[i1], fi - i0);
  }

  curvatureAt(d: number): number {
    const fi = clamp(d, 0, this.length) / this.spacing;
    const i0 = clamp(Math.floor(fi), 0, this.count - 1);
    const i1 = Math.min(this.count - 1, i0 + 1);
    return lerp(this.curvature[i0], this.curvature[i1], fi - i0);
  }

  /** True where there is no ribbon under the centreline (the ravine). */
  isGap(d: number): boolean {
    for (let i = 0; i < this.gaps.length; i++) {
      if (d > this.gaps[i].start && d < this.gaps[i].end) return true;
    }
    return false;
  }

  sectionAt(d: number): TrackSectionKind {
    const i = clamp(Math.round(d / this.spacing), 0, this.count - 1);
    return SECTION_ORDER[this.sectionId[i]];
  }

  /**
   * Project a world position onto the centreline.
   *
   * Allocation-free and hint-driven: every racer holds its own distance from
   * last step, so the common case is a 90-sample scan of a contiguous typed
   * array. The hint is validated rather than trusted — if the best sample in
   * the window is ON the window edge, the hint is stale (the racer got
   * teleported, respawned, or launched off a lip) and we fall back to a coarse
   * global sweep and a local refine.
   */
  project(position: Vector3, hintDistance?: number): TrackProjection {
    const n = this.count;
    let best = -1;
    let bestD2 = Infinity;

    if (hintDistance !== undefined && Number.isFinite(hintDistance)) {
      const c = clamp(Math.round(hintDistance / this.spacing), 0, n - 1);
      const w = Math.max(2, Math.round(this.hintWindow / this.spacing));
      const lo = Math.max(0, c - w);
      const hi = Math.min(n - 1, c + w);
      for (let i = lo; i <= hi; i++) {
        const d2 = this.dist2(i, position);
        if (d2 < bestD2) {
          bestD2 = d2;
          best = i;
        }
      }
      // Edge hit with the point still far away = stale hint.
      const onEdge = best === lo && lo > 0;
      const onEdge2 = best === hi && hi < n - 1;
      if ((onEdge || onEdge2) && bestD2 > 36) best = -1;
    }

    if (best < 0) {
      bestD2 = Infinity;
      // 3m stride. The tightest place two passes of the course come near each
      // other is the switchbacks at ~45m apart, so a 3m sweep cannot alias onto
      // the wrong leg.
      const stride = Math.max(1, Math.round(3 / this.spacing));
      for (let i = 0; i < n; i += stride) {
        const d2 = this.dist2(i, position);
        if (d2 < bestD2) {
          bestD2 = d2;
          best = i;
        }
      }
      const lo = Math.max(0, best - stride);
      const hi = Math.min(n - 1, best + stride);
      for (let i = lo; i <= hi; i++) {
        const d2 = this.dist2(i, position);
        if (d2 < bestD2) {
          bestD2 = d2;
          best = i;
        }
      }
    }

    // Refine onto the two adjoining segments so the answer is continuous rather
    // than quantised to the sample spacing.
    let distance = best * this.spacing;
    let bestSegD2 = Infinity;
    for (let k = -1; k <= 0; k++) {
      const a = best + k;
      const b = a + 1;
      if (a < 0 || b > this.count - 1) continue;
      _v0.set(this.px[a], this.py[a], this.pz[a]);
      _seg.set(this.px[b] - this.px[a], this.py[b] - this.py[a], this.pz[b] - this.pz[a]);
      const segLen2 = _seg.lengthSq();
      if (segLen2 < 1e-9) continue;
      _rel.copy(position).sub(_v0);
      const t = clamp01(_rel.dot(_seg) / segLen2);
      _v1.copy(_seg).multiplyScalar(t).add(_v0);
      const d2 = _v1.distanceToSquared(position);
      if (d2 < bestSegD2) {
        bestSegD2 = d2;
        distance = (a + t) * this.spacing;
      }
    }

    const out = this.projRing[this.projIdx++ & 7];
    const s = this.sampleAtDistance(distance, out.sample);
    _rel.copy(position).sub(s.position);
    // Decompose in the ORTHONORMAL banked frame. Using the contract's
    // horizontal `left` here would double-count the bank, because `left` and
    // `up` are not perpendicular once the surface rolls.
    this.surfaceLeftAt(distance, _v2);
    out.distance = distance;
    out.lateral = _rel.dot(_v2);
    out.vertical = _rel.dot(s.up);
    return out;
  }

  private dist2(i: number, p: Vector3): number {
    const dx = this.px[i] - p.x;
    const dy = this.py[i] - p.y;
    const dz = this.pz[i] - p.z;
    return dx * dx + dy * dy + dz * dz;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Outputs
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * The corridor the terrain must flatten. Wider than the ribbon so the
   * ribbon's buried skirt has ground to hide in, and skipping the ravine so the
   * carve does not fill the hole back in.
   */
  getCarve(): TrackCarve {
    if (this.carve) return this.carve;
    // 1.5 m, not 3.5 m.
    //
    // `applyTrackCarve` reconstructs the collision surface by tenting between
    // consecutive carve points, so the point spacing IS the resolution of the
    // ground the bike rides. At 3.5 m the tabletop's 28.6 degree face arrived as
    // a 22.4 degree straight line and its lip — a corner — was linearised over
    // 4 m. That is the difference between a kicker that launches the rider and a
    // roll-over that does not, and none of it was visible in the ribbon mesh,
    // which is drawn from the spline directly and looked correct throughout.
    //
    // 1.5 m is where this stops mattering: the heightfield's own texels are 2 m,
    // so a finer tent cannot describe anything the field can hold. The extra
    // points cost one linear pass over the corridor at load time.
    const step = Math.max(1, Math.round(1.5 / this.spacing));
    const points: Vector3[] = [];
    const halfWidths: number[] = [];
    const rideWidths: number[] = [];
    const banks: number[] = [];
    const crossSlopes: number[] = [];
    for (let i = 0; i < this.count; i += step) {
      if (this.gapMask[i] > 0.5) continue;
      // Carve to the centreline height ITSELF, `lift` included.
      //
      // This used to emit `py - this.lift`, undoing at carve time the 0.06 that
      // step 5 adds to the profile — so the ground finished 6 cm below the
      // ribbon that is drawn from `py`. Together with a separate 0.12 drop
      // inside the carve itself (removed; see the note there) that put the
      // collision surface a persistent 18 cm under the visible trail, which is
      // why a player saw the bikes riding INSIDE the track rather than on it.
      //
      // The residual after fixing only the 0.12 was mean 0.061 m with the 5th
      // and 95th percentiles at 0.041 and 0.079 — far too tight a distribution
      // to be lattice error, and within a millimetre of `lift`. That is what a
      // systematic offset looks like as opposed to sampling noise, and it is
      // worth trusting: 6 cm of bias with 4 cm of spread is one cause, not many.
      //
      // `lift` still does its job. It raises the trail proud of the surrounding
      // hillside; it was never meant to sink the ground beneath it.
      points.push(new Vector3(this.px[i], this.py[i], this.pz[i]));
      // Berms sit outside the nominal width, and the corridor has to be flat
      // enough underneath them that the berm is a built feature rather than a
      // ridge of terrain poking through it.
      halfWidths.push(this.halfWidth[i] * (1.22 + this.bermStrength[i] * 0.45) + 1.1);
      rideWidths.push(this.halfWidth[i]);
      banks.push(this.bank[i]);
      // The gradient the RIBBON uses, not the angle it was built from. See the
      // note on TrackCarve.crossSlopes: rebuilding it as tan(bank) in the carve
      // produced the opposite sign, and cambered the ground against the trail.
      crossSlopes.push(this.sly[i]);
    }
    this.carve = { points, halfWidths, rideWidths, banks, crossSlopes, featherWidth: 4.2 };
    return this.carve;
  }

  /**
   * A 1D lookup the ribbon shader samples by normalised distance:
   *   R = signed curvature, 0.5 = straight
   *   G = wetness
   *   B = rockiness
   *   A = takeoff-lip intensity
   *
   * Doing it this way rather than with per-vertex attributes keeps the ribbon
   * on the stock CelMaterial vertex layout, which means its prepass and shadow
   * materials come for free and can never drift out of sync with the main pass.
   */
  profileTexture(width = 2048): DataTexture {
    if (this.profileTex) return this.profileTex;
    const data = new Uint8Array(width * 4);
    const kMax = 0.075; // 1/m at which the curvature channel saturates
    for (let i = 0; i < width; i++) {
      const d = (i / (width - 1)) * this.length;
      const si = clamp(Math.round(d / this.spacing), 0, this.count - 1);
      const c = clamp(this.curvature[si] / kMax, -1, 1);
      data[i * 4 + 0] = Math.round((c * 0.5 + 0.5) * 255);
      data[i * 4 + 1] = Math.round(clamp01(this.wetness[si]) * 255);
      data[i * 4 + 2] = Math.round(clamp01(this.rockiness[si]) * 255);
      data[i * 4 + 3] = Math.round(clamp01(this.lipMask[si]) * 255);
    }
    const tex = new DataTexture(data, width, 1, RGBAFormat, UnsignedByteType);
    tex.minFilter = LinearFilter;
    tex.magFilter = LinearFilter;
    tex.wrapS = ClampToEdgeWrapping;
    tex.wrapT = ClampToEdgeWrapping;
    tex.needsUpdate = true;
    tex.name = 'track-profile';
    this.profileTex = tex;
    return tex;
  }

  /** An elevation profile for the HUD's route bar. Values are world metres. */
  elevationProfile(samples = 256): Float32Array {
    const out = new Float32Array(samples);
    for (let i = 0; i < samples; i++) {
      out[i] = this.heightAtDistance((i / (samples - 1)) * this.length);
    }
    return out;
  }

  dispose(): void {
    this.profileTex?.dispose();
    this.profileTex = null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Free helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Terrain height with a fallback. If the heightfield is not up yet (or returns
 * a degenerate value) we fall back to the corridor descent profile from
 * WorldConstants, so the course still builds and still descends. This is not a
 * placeholder for missing terrain — it is a guarantee that a terrain bug can
 * never produce a NaN centreline, which would silently poison every projection
 * in the game.
 */
function safeHeight(terrain: ITerrain, x: number, z: number, t: number): number {
  const h = terrain.heightAt(x, z);
  if (!Number.isFinite(h) || h === 0) return corridorHeightAt(t);
  return h;
}

/**
 * 1 where the height profile must be preserved verbatim, 0 where it may be
 * smoothed.
 *
 * The features that CROSS the route (the ravine, the stream) are described by
 * distance from their own axis, which is what this handles. The tabletop RUNS
 * ALONG the route and its footprint is asymmetric about its anchor, so it is
 * stamped by plan index in the constructor instead — a radius centred on the
 * lip would either miss the landing ramp or preserve 40 m of ordinary hillside
 * behind the run-in.
 */
function featurePreservation(x: number, z: number): number {
  let w = 0;
  for (const f of TERRAIN_FEATURES) {
    if (f.kind === 'ravine' || f.kind === 'stream-channel') {
      const off = Math.abs(axisOffset(f, x, z));
      const half = (f.params.width ?? 12) * 0.5;
      w = Math.max(w, 1 - smoothstep(half, half * 2.6, off));
    }
  }
  return clamp01(w);
}

/**
 * Gaussian smoothing whose kernel radius varies per output sample. The naive
 * fixed kernel is what eats the tabletop; letting the radius collapse inside a
 * designed feature keeps that shape while still ironing the erosion chatter out
 * of the 1600 metres of ordinary hillside between features.
 *
 * There are three bands, not two, and the third one is the takeoff lip.
 *
 * A lip is a CORNER — the face runs straight at the takeoff angle and then
 * stops. Even the "tight" 1.6 m kernel has a 0.8 m sigma, which spreads that
 * corner over about 4 m of track, and a corner spread over 4 m is not a corner:
 * measured on the tabletop, the ground's vertical rate fell from 10 m/s to zero
 * over 0.19 s, which is gentle enough that the suspension simply followed it and
 * the rider rolled off the lip with a third of the launch the ramp had built.
 * Over the couple of metres either side of a lip the kernel therefore collapses
 * to nothing and the profile is taken as the heightfield gives it — which is
 * still 2 m texels, so this cannot produce anything the terrain does not have.
 */
function variableSmooth(
  src: Float64Array,
  preserve: Float32Array,
  sharp: Float32Array,
  step: number,
  wideRadius: number,
  tightRadius: number,
  sharpRadius: number,
): Float64Array {
  const n = src.length;
  const out = new Float64Array(n);
  const maxTaps = Math.ceil((wideRadius * 2) / step);
  for (let i = 0; i < n; i++) {
    const radius = lerp(lerp(wideRadius, tightRadius, preserve[i]), sharpRadius, sharp[i]);
    const taps = Math.min(maxTaps, Math.max(1, Math.ceil((radius * 2) / step)));
    const sigma = Math.max(radius * 0.5, step);
    let sum = 0;
    let wsum = 0;
    for (let k = -taps; k <= taps; k++) {
      const j = clamp(i + k, 0, n - 1);
      const dz = k * step;
      const w = Math.exp((-dz * dz) / (2 * sigma * sigma));
      sum += src[j] * w;
      wsum += w;
    }
    out[i] = sum / (wsum || 1);
  }
  return out;
}

/**
 * A safety clamp on the descent gradient, applied forward and backward and
 * averaged. Generous by design — 1.05 is 46 degrees, which passes the stream
 * drop-in untouched and only ever engages if the terrain hands us a cliff.
 */
function limitSlope(h: Float64Array, step: number, maxSlope: number): void {
  const n = h.length;
  const maxDelta = maxSlope * step;
  const fwd = new Float64Array(h);
  for (let i = 1; i < n; i++) {
    const d = fwd[i] - fwd[i - 1];
    if (d > maxDelta) fwd[i] = fwd[i - 1] + maxDelta;
    else if (d < -maxDelta) fwd[i] = fwd[i - 1] - maxDelta;
  }
  const bwd = new Float64Array(h);
  for (let i = n - 2; i >= 0; i--) {
    const d = bwd[i] - bwd[i + 1];
    if (d > maxDelta) bwd[i] = bwd[i + 1] + maxDelta;
    else if (d < -maxDelta) bwd[i] = bwd[i + 1] - maxDelta;
  }
  for (let i = 0; i < n; i++) h[i] = (fwd[i] + bwd[i]) * 0.5;
}

/**
 * Enforce the one property that makes this course a DOWNHILL course: it may
 * flatten, it may roll, it must never climb a hill.
 *
 * `limitSlope` bounds |dy| symmetrically, which says "rideable gradient" and
 * says nothing at all about direction. The elevation profile is sampled from
 * the mountain, so wherever the route crosses a spur it simply climbed it.
 * Measured on the shipping course before this existed: 74.8 m of total ascent
 * spread over SIXTEEN separate climbs, the worst of them +12.6 m over 38 m at
 * a peak of 29.2 deg, at 246 m — about fifteen seconds in. A rider arriving at
 * a 29 deg wall on a bike with no drivetrain to speak of stops dead, which is
 * exactly what a player reported: "the first bump is so high we can't even go
 * past it".
 *
 * Two bounds, both needed:
 *
 *   - a gradient cap, so nothing kicks up sharply, and
 *   - a cap on height above the RUNNING MINIMUM, so a long shallow climb
 *     cannot accumulate into a hill one grade-limited step at a time.
 *
 * The second is the one that matters. A pure gradient cap of 6 deg still
 * permits +4 m over the same 38 m, and permits it indefinitely.
 *
 * `protect` (0..1) exempts authored features — a tabletop deck and the far lip
 * of the ravine gap are climbs on purpose, and this runs BEFORE that surgery
 * anyway, so the mask is belt and braces for anything the route asks to keep.
 */
function limitClimb(
  h: Float64Array,
  step: number,
  maxGrade: number,
  maxRise: number,
  protect?: Float32Array,
): void {
  const maxDelta = Math.tan(maxGrade) * step;
  let floor = h[0];
  for (let i = 1; i < h.length; i++) {
    const keep = protect ? protect[i] : 0;
    if (keep < 0.999) {
      const capped = Math.min(h[i], h[i - 1] + maxDelta, floor + maxRise);
      // Blend rather than switch, so a partially-protected sample does not
      // step. At keep = 1 the authored height survives untouched.
      h[i] = h[i] * keep + capped * (1 - keep);
    }
    if (h[i] < floor) floor = h[i];
  }
}

function boxSmooth(src: Float32Array, dst: Float32Array, radius: number): void {
  const n = src.length;
  const inv = 1 / (radius * 2 + 1);
  // Running sum. Clamped at both ends rather than wrapped — the start gate and
  // the finish line are genuine boundaries, not a loop.
  let acc = 0;
  for (let k = -radius; k <= radius; k++) acc += src[clamp(k, 0, n - 1)];
  for (let i = 0; i < n; i++) {
    dst[i] = acc * inv;
    acc -= src[clamp(i - radius, 0, n - 1)];
    acc += src[clamp(i + radius + 1, 0, n - 1)];
  }
}

function nearestPlanIndex(ax: Float64Array, az: Float64Array, x: number, z: number): number {
  let best = -1;
  let bestD2 = Infinity;
  for (let i = 0; i < ax.length; i++) {
    const dx = ax[i] - x;
    const dz = az[i] - z;
    const d2 = dx * dx + dz * dz;
    if (d2 < bestD2) {
      bestD2 = d2;
      best = i;
    }
  }
  return best;
}

function planToArc(planDistance: number, planStep: number, cum3: Float64Array): number {
  const fi = planDistance / planStep;
  const i0 = clamp(Math.floor(fi), 0, cum3.length - 1);
  const i1 = Math.min(cum3.length - 1, i0 + 1);
  return lerp(cum3[i0], cum3[i1], fi - i0);
}

function sampleKeyframes(keys: [number, number][], x: number): number {
  if (x <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    if (x <= keys[i][0]) {
      const [x0, y0] = keys[i - 1];
      const [x1, y1] = keys[i];
      return lerp(y0, y1, smoothstep(x0, x1, x));
    }
  }
  return keys[keys.length - 1][1];
}
