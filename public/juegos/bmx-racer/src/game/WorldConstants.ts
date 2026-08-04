/**
 * WorldConstants — the canonical numbers, shared by terrain and track.
 *
 * Terrain generation and course layout are the one genuinely coupled pair in
 * this project: the mountain has to be shaped so the course is rideable, and
 * the course has to sit on the mountain so it looks carved rather than pasted.
 *
 * They are decoupled here by making the ROUTE the authority. The route control
 * points below are fixed. The terrain generator adds a "corridor prior" to its
 * heightfield before erosion — a gentle bias that guarantees a continuously
 * descending, rideable band of ground along this line — and then erosion runs
 * over the whole thing so the corridor ends up with real gullies and spurs
 * around it rather than looking like a bulldozed ramp. The track builder then
 * conforms its spline to the FINAL eroded surface.
 *
 * Neither system needs to know anything about the other's internals.
 */

import { CatmullRomCurve3, Vector3 } from 'three';
import { TrackSectionKind } from './Contracts';

// ── World scale ──────────────────────────────────────────────────────────────
/** Heightfield resolution. 2048² over 4096m gives a 2m sample spacing. */
export const HEIGHTMAP_SIZE = 2048;
/** World extent of the heightfield, metres, centred on the origin. */
export const WORLD_SIZE = 4096;
export const WORLD_HALF = WORLD_SIZE / 2;
export const METRES_PER_SAMPLE = WORLD_SIZE / HEIGHTMAP_SIZE;

/**
 * COURSE SCALE — one number that makes the whole mountain smaller.
 *
 * The course was 3807 m with 571 m of drop, which is four to five minutes of
 * riding. That is a long way to ask anyone to hold a line on a keyboard, and
 * far too long to show. Everything below is expressed so that scaling this
 * shrinks the course WITHOUT changing how it rides:
 *
 *   - route control points and feature anchors scale in XZ, so the plan shape
 *     is identical and every section keeps its share of the course;
 *   - the vertical range scales about the valley floor, so the average grade
 *     is unchanged — halving the length and keeping the drop would double the
 *     steepness of every section;
 *   - the altitude zone boundaries scale with it, so snow, scree, rock, dirt
 *     and grass still band across the descent in the same places;
 *   - what a bike interacts with does NOT scale: trail widths, jump gaps, lip
 *     heights, ravine width. A 11.5 m gap needs the same speed to clear at any
 *     course length, and a 3 m trail is as wide as the bike needs it to be.
 *
 * 0.58 gives roughly 2.2 km and a two-and-a-half minute run.
 */
export const COURSE_SCALE = 0.58;

/**
 * How long the RACE is, in metres of track. The mountain is unaffected.
 *
 * A full descent of this course is a two-and-a-half minute run, and that is
 * still far too long to play on a keyboard or to show to anyone. This ends the
 * ribbon — and therefore the finish line, the checkpoints, the HUD profile and
 * the AI's planning horizon, all of which measure against `track.length` — at
 * 800 m, which is a little over a minute of riding.
 *
 * It is the TRACK that is truncated, never the route. The massif's descent
 * profile, the corridor prior and every terrain feature are built from the full
 * route, so the mountain still rises behind the start gate and still falls away
 * for two kilometres past the finish. Shortening the route instead would shrink
 * the world with it and leave the rider on a 30 m hillock.
 */
export const RACE_LENGTH = 800;

/** Vertical range of the mountain. */
export const SEA_LEVEL = 0;
export const VALLEY_HEIGHT = 55;
export const SUMMIT_HEIGHT = VALLEY_HEIGHT + (640 - 55) * COURSE_SCALE;

/** Scale an altitude about the valley floor, so bands keep their place. */
const zoneAt = (h: number): number => VALLEY_HEIGHT + (h - 55) * COURSE_SCALE;

/** Altitude zone boundaries, metres. Hard cel transitions, not blends. */
export const ZONE = {
  waterLine: zoneAt(62),
  grassTop: zoneAt(210),
  dirtTop: zoneAt(330),
  rockTop: zoneAt(470),
  screeTop: zoneAt(545),
  // Above screeTop is snow.
  /** Slopes steeper than this are always rock, regardless of altitude. */
  rockSlopeRad: 0.72,
  /** Slopes steeper than this are always scree above the grass line. */
  screeSlopeRad: 0.52,
};

// ── The route ────────────────────────────────────────────────────────────────
/**
 * Control points for the descent, summit to valley. XZ only — Y is taken from
 * the terrain at build time. Points are dense through technical sections and
 * sparse through fast ones, which is what shapes the pacing: the spline's own
 * curvature distribution becomes the course's rhythm.
 *
 * Reading the shape: a long raking traverse off the summit, a straight fast
 * plunge down the scree face, six tightening switchbacks through the tree line,
 * a broken diagonal through the rock garden, two jumps on a straight approach,
 * a knife-edge ridge, a drop into the stream, and a final open run-out.
 */
export interface RouteControl {
  x: number;
  z: number;
  /** Rideable half-width here, metres. Narrow = technical. */
  halfWidth: number;
  /** Requested bank, radians. Positive banks the outside of a left turn. */
  bank?: number;
  section: TrackSectionKind;
  /** Optional explicit height offset above the eroded terrain. */
  lift?: number;
}

export const ROUTE: RouteControl[] = [
  // ── 1. The race, in full. See RACE_LENGTH ────────────────────────────────
  //
  // These seven points ARE the course: the track is truncated at 240 m, so
  // everything past the seventh is mountain the rider looks at and never rides.
  // That makes this stretch the whole of the game, and it was previously the
  // WORST possible choice for one — the section is authored "exposed rock,
  // tight, off-camber", the narrowest and most serpentine on the descent, and
  // handing a player nothing but that is why the pack spent 70% of its samples
  // off the trail.
  //
  // Re-cut as a demo run: one gentle left-to-right diagonal, no switchback, a
  // tabletop at 150 m, and a trail wide enough to make a mistake on. The x
  // swing is 120 m across 175 m of z, which is a lean the bike carries rather
  // than a corner it has to be set up for.
  { x: -70, z: -940, halfWidth: 7.0, section: TrackSectionKind.TechnicalStart },
  { x: -58, z: -900, halfWidth: 7.0, section: TrackSectionKind.TechnicalStart },
  { x: -42, z: -862, halfWidth: 7.0, bank: 0.12, section: TrackSectionKind.TechnicalStart },
  { x: -22, z: -826, halfWidth: 6.8, bank: 0.14, section: TrackSectionKind.TechnicalStart },
  { x: -2, z: -796, halfWidth: 6.8, section: TrackSectionKind.TechnicalStart },
  { x: 22, z: -782, halfWidth: 7.2, section: TrackSectionKind.TechnicalStart },
  { x: 48, z: -768, halfWidth: 8.0, section: TrackSectionKind.TechnicalStart },

  // ── 2. Scree run: open, straight, build speed ────────────────────────────
  { x: 51, z: -742.4, halfWidth: 8, section: TrackSectionKind.ScreeRun },
  { x: 37.1, z: -672.8, halfWidth: 10.2, section: TrackSectionKind.ScreeRun },
  { x: 23.2, z: -597.4, halfWidth: 11.6, section: TrackSectionKind.ScreeRun },
  { x: 15.1, z: -522, halfWidth: 11.6, section: TrackSectionKind.ScreeRun },
  { x: 13.9, z: -458.2, halfWidth: 9.4, section: TrackSectionKind.ScreeRun },

  // ── 3. Switchbacks: six bermed corners, tightening ───────────────────────
  //
  // The FIRST SEVEN are inside the 800 m race (see RACE_LENGTH) and have been
  // opened out; the rest are past the finish and left as authored.
  //
  // As written they swung x from 30 to 87 and back to 23 across ninety metres
  // of z — a hairpin pair on a 27 m radius with the trail down to 5.6 m — and
  // that one stretch produced 105 of the pack's 130 excursions and blew the
  // finishing spread from 2.3 s to 24 s. Halving the swing and widening to 8 m
  // keeps a pair of real corners at the end of the run without making the last
  // quarter of the race the only part anyone struggles with.
  { x: 30.2, z: -411.8, halfWidth: 8.6, bank: -0.30, section: TrackSectionKind.Switchbacks },
  { x: 56, z: -392, halfWidth: 8.4, bank: -0.36, section: TrackSectionKind.Switchbacks },
  { x: 70, z: -364, halfWidth: 8.2, bank: -0.32, section: TrackSectionKind.Switchbacks },
  { x: 56, z: -338, halfWidth: 8.0, bank: 0.34, section: TrackSectionKind.Switchbacks },
  { x: 28, z: -322, halfWidth: 8.0, bank: 0.38, section: TrackSectionKind.Switchbacks },
  { x: -14, z: -308, halfWidth: 8.0, bank: 0.34, section: TrackSectionKind.Switchbacks },
  { x: -46, z: -288, halfWidth: 7.6, bank: -0.38, section: TrackSectionKind.Switchbacks },
  { x: -49.9, z: -251.7, halfWidth: 5.2, bank: -0.52, section: TrackSectionKind.Switchbacks },
  { x: -11.6, z: -234.3, halfWidth: 5.2, bank: -0.44, section: TrackSectionKind.Switchbacks },
  { x: 31.3, z: -225, halfWidth: 5.4, bank: 0.46, section: TrackSectionKind.Switchbacks },
  { x: 61.5, z: -199.5, halfWidth: 5.2, bank: 0.54, section: TrackSectionKind.Switchbacks },
  { x: 55.7, z: -163.6, halfWidth: 5.1, bank: 0.50, section: TrackSectionKind.Switchbacks },
  { x: 19.7, z: -146.2, halfWidth: 5.5, bank: -0.30, section: TrackSectionKind.Switchbacks },

  // ── 4. Rock garden: broken diagonal, punishes a bad line ─────────────────
  { x: -10.4, z: -123, halfWidth: 6.4, section: TrackSectionKind.RockGarden },
  { x: -31.3, z: -90.5, halfWidth: 7, section: TrackSectionKind.RockGarden },
  { x: -38.3, z: -55.7, halfWidth: 7.5, section: TrackSectionKind.RockGarden },
  { x: -27.8, z: -20.9, halfWidth: 7.2, section: TrackSectionKind.RockGarden },
  { x: -8.1, z: 7, halfWidth: 6.7, section: TrackSectionKind.RockGarden },

  // ── 5. Tabletop: straight, clear takeoff read ────────────────────────────
  { x: 5.8, z: 36, halfWidth: 7.2, section: TrackSectionKind.Tabletop },
  { x: 12.8, z: 70.8, halfWidth: 7.8, section: TrackSectionKind.Tabletop },
  { x: 16.2, z: 105.6, halfWidth: 7.8, section: TrackSectionKind.Tabletop },

  // ── 6. Ravine gap: a real hole in the ground ─────────────────────────────
  { x: 17.4, z: 142.7, halfWidth: 7.2, section: TrackSectionKind.RavineGap },
  { x: 18.6, z: 177.5, halfWidth: 6.7, section: TrackSectionKind.RavineGap },
  { x: 19.7, z: 210, halfWidth: 7.2, section: TrackSectionKind.RavineGap },

  // ── 7. Ridge sprint: exposure on both sides ──────────────────────────────
  { x: 23.2, z: 249.4, halfWidth: 3.8, section: TrackSectionKind.RidgeSprint },
  { x: 31.3, z: 295.8, halfWidth: 3.3, section: TrackSectionKind.RidgeSprint },
  { x: 42.9, z: 345.7, halfWidth: 3.2, section: TrackSectionKind.RidgeSprint },
  { x: 53.4, z: 396.7, halfWidth: 3.5, section: TrackSectionKind.RidgeSprint },
  { x: 58, z: 444.3, halfWidth: 4.2, section: TrackSectionKind.RidgeSprint },

  // ── 8. Stream bed: a drop in, wet rock, then out ─────────────────────────
  { x: 53.4, z: 486, halfWidth: 5.5, section: TrackSectionKind.StreamBed },
  { x: 38.3, z: 520.8, halfWidth: 6.4, section: TrackSectionKind.StreamBed },
  { x: 23.2, z: 558, halfWidth: 6.7, section: TrackSectionKind.StreamBed },
  { x: 17.4, z: 598.6, halfWidth: 6.4, section: TrackSectionKind.StreamBed },

  // ── 9. Final sprint ──────────────────────────────────────────────────────
  { x: 25.5, z: 643.8, halfWidth: 8.1, section: TrackSectionKind.FinalSprint },
  { x: 41.8, z: 696, halfWidth: 9.3, section: TrackSectionKind.FinalSprint },
  { x: 55.7, z: 754, halfWidth: 10.2, section: TrackSectionKind.FinalSprint },
  { x: 61.5, z: 812, halfWidth: 10.2, section: TrackSectionKind.FinalSprint },
  { x: 62.6, z: 864.2, halfWidth: 8.7, section: TrackSectionKind.FinalSprint },
];

/**
 * Explicit terrain features the mountain must contain for the course to work.
 * The terrain generator carves these into the heightfield after erosion so
 * they survive intact — erosion would otherwise silt up a ravine or round off
 * a jump lip, and "the jump got eroded away" is not a debuggable failure.
 */
export interface TerrainFeature {
  kind: 'ravine' | 'tabletop' | 'berm-bowl' | 'stream-channel' | 'ridge-narrow' | 'rock-garden' | 'start-plateau' | 'finish-flat';
  /** Route distance (metres) this feature is centred on, or explicit XZ. */
  at?: number;
  x?: number;
  z?: number;
  /** Feature-specific parameters. */
  params: Record<string, number>;
}

/**
 * The tabletop, as an explicit jump rather than as a lump with a width.
 *
 * Every length here is measured ALONG THE ROUTE from the takeoff lip, which is
 * the feature's anchor point. That is the only frame in which the numbers mean
 * anything: a jump described in world XZ with a hardcoded azimuth is only a
 * jump if the course happens to agree with the azimuth, and when it does not
 * the rider crosses the mound's flank instead of running up the kicker.
 *
 * The heights are relative to the mountain's own fall line under the mound, not
 * to sea level, so the deck follows the descent instead of sitting level and
 * pointing the landing ramp back uphill.
 *
 * Reading the shape, and why each number is what it is:
 *
 *   face 8.5m / height 4.2m / faceEase 0.38
 *     A kicker is a STRAIGHT ramp with a rounded transition at its foot, and it
 *     has to be built that way rather than as a curve. The first attempt used
 *     `height * k^1.3`, whose gradient reaches the takeoff angle at exactly one
 *     point — the lip — and the 1.6 m kernel the track builder runs over
 *     designed features promptly rounded that point off, leaving a 19 degree
 *     roller that got shallower as it approached the lip. Backwards.
 *
 *     So: ease from zero slope over the first `faceEase` of the face, then hold
 *     one gradient the rest of the way and STOP. The held gradient is
 *     height / (face * (1 - faceEase/2)) = 0.61, which over ground falling at
 *     0.11 is a 26.7 degree takeoff sustained over the last 5.3 m. A straight
 *     segment is invariant under a symmetric blur, so smoothing now rounds only
 *     the lip corner itself — which is what a real lip looks like — instead of
 *     eating the angle the rider is supposed to read from 40 m out.
 *
 *   deck 18m
 *     An 18 m/s launch off a 26.7 degree lip flies 12.7 m under this game's
 *     20.4 m/s^2 gravity. The deck is longer than that, so the default outcome
 *     is landing ON it: that is what makes this a tabletop and not a gap. It is
 *     also short enough that clearing it is worth trying.
 *
 *   landing 16m
 *     Falls away as a smoothstep — zero slope where it leaves the deck, so there
 *     is no second lip to launch off, and zero slope where it rejoins the hill,
 *     so there is no compression at the bottom. Peak fall 1.5 * height / landing
 *     = 0.39, about 22 degrees.
 *
 *     deck + landing = 34 m is not arbitrary: the corridor here is a bench about
 *     34 m long (the descent profile deliberately flattens through `tabletop
 *     approach — flatter so the lip reads`) and then plunges at 0.30 into the
 *     ravine. Ending the landing at the bench edge keeps the ramp's own fall and
 *     the mountain's out of each other's way; overlapping them was worth 10
 *     degrees of landing gradient for nothing.
 *
 *   feather 12m
 *     Run-in and run-out over which the carve blends into untouched ground.
 *     Without it the carve's authority collapses across one texel and the spline
 *     tries to climb the step.
 */
export const TABLETOP = {
  /** Kicker face length, metres along the route, ending at the lip. */
  face: 7.5,
  /** Flat deck from the lip. */
  deck: 18,
  /** Landing ramp beyond the deck. */
  landing: 16,
  /** Crest height above the natural fall line. */
  height: 4.2,
  /** Half-width of the deck. */
  halfWidth: 8.5,
  /** Lateral fall-off from the deck edge to natural ground. */
  flank: 7,
  /** Longitudinal blend into untouched ground at each end. */
  feather: 12,
  /** Fraction of the face spent easing in from zero slope. */
  faceEase: 0.36,
};

export const TERRAIN_FEATURES: TerrainFeature[] = [
  { kind: 'start-plateau', x: -70, z: -940, params: { radius: 15, flatness: 0.92 } },
  // The tabletop. x/z is the TAKEOFF LIP and sits on the route; everything else
  // is measured along the route from there. See TABLETOP above.
  //
  // Moved to 150 m along the course, and the finish flat to 240 m, because the
  // RACE is now 240 m (see RACE_LENGTH). The ravine, ridge and stream anchors
  // below are left where they are: they are two kilometres past the finish now,
  // still shaping the mountain the rider is looking at, just not ridden.
  { kind: 'tabletop', x: -10.1, z: -806, params: { ...TABLETOP } },
  // The ravine: a genuine gap the rider must clear. Steep sides, 11m across.
  { kind: 'ravine', x: 18.6, z: 177.5, params: { width: 11.5, depth: 26, length: 139, angle: 1.44 } },
  // The ridge: narrow the crest and drop the flanks hard.
  { kind: 'ridge-narrow', x: 42.9, z: 345.7, params: { length: 209, halfWidth: 9, flankDrop: 42, angle: 0.24 } },
  // The stream: a carved channel with a wet floor.
  { kind: 'stream-channel', x: 31.9, z: 545.2, params: { width: 14, depth: 5.5, length: 151, angle: 0.86 } },
  { kind: 'rock-garden', x: -29, z: -58, params: { radius: 41, roughness: 1.35, boulderCount: 46 } },
  { kind: 'finish-flat', x: 4.4, z: -318.7, params: { radius: 35, flatness: 0.85 } },
];

// ── The tabletop, as one shape both systems build ────────────────────────────
/**
 * Resolved tabletop geometry, with the two derived stations the callers want.
 *
 * `sMin`/`sMax` are lip-relative route distances bounding the whole footprint
 * INCLUDING the feather, so a caller can ask "is this sample inside the jump"
 * without re-deriving the arithmetic and getting a different answer.
 */
export interface TabletopGeometry {
  face: number;
  deck: number;
  landing: number;
  height: number;
  halfWidth: number;
  flank: number;
  feather: number;
  faceEase: number;
  /** Start of the run-in feather, lip-relative. Negative. */
  sMin: number;
  /** End of the run-out feather, lip-relative. */
  sMax: number;
}

export function tabletopGeometry(f?: TerrainFeature): TabletopGeometry {
  const p = f?.params ?? {};
  const g = {
    face: p.face ?? TABLETOP.face,
    deck: p.deck ?? TABLETOP.deck,
    landing: p.landing ?? TABLETOP.landing,
    height: p.height ?? TABLETOP.height,
    halfWidth: p.halfWidth ?? TABLETOP.halfWidth,
    flank: p.flank ?? TABLETOP.flank,
    feather: p.feather ?? TABLETOP.feather,
    faceEase: p.faceEase ?? TABLETOP.faceEase,
    sMin: 0,
    sMax: 0,
  };
  g.sMin = -g.face - g.feather;
  g.sMax = g.deck + g.landing + g.feather;
  return g;
}

/**
 * Height of the jump ABOVE THE FALL LINE at a lip-relative route distance.
 *
 * Zero outside `-face .. deck + landing`, and zero-sloped where it reaches zero
 * at both ends, so adding it to any fall line can never introduce a step. The
 * heightfield carve and the track profile both call this, which is the whole
 * point: the collision surface and the racing line are the same curve plus a
 * known offset, not two independent guesses that have to be reconciled after
 * the fact.
 */
export function tabletopProfile(g: TabletopGeometry, s: number): number {
  if (s <= -g.face || s >= g.deck + g.landing) return 0;
  if (s < 0) {
    // Face: a quadratic ease from zero slope, then a STRAIGHT ramp at the
    // takeoff gradient all the way to the lip, where it stops dead.
    const k = (s + g.face) / g.face;
    const e = Math.min(Math.max(g.faceEase, 1e-3), 0.99);
    // Held gradient, in units of height per unit k.
    const m = 1 / (1 - e * 0.5);
    return g.height * (k < e ? (m * k * k) / (2 * e) : m * (k - e * 0.5));
  }
  if (s <= g.deck) return g.height;
  // Landing. Smoothstep, so there is no second lip at the deck edge and no
  // compression where it rejoins the hillside.
  const k = (s - g.deck) / g.landing;
  return g.height * (1 - k * k * (3 - 2 * k));
}

// ── Checkpoints ──────────────────────────────────────────────────────────────
/** Normalised positions along the track where a checkpoint gate stands. */
export const CHECKPOINT_TS = [0.0, 0.13, 0.28, 0.44, 0.58, 0.70, 0.82, 0.92, 1.0];

// ── Race ─────────────────────────────────────────────────────────────────────
export const RACER_COUNT = 4;
export const COUNTDOWN_SECONDS = 3.4;
/** Lateral spacing of the four riders on the start line, metres. */
export const START_SPACING = 2.1;

// ── Physics tuning shared between the bike and the AI ────────────────────────
export const BIKE = {
  mass: 92,               // rider + bike, kg
  wheelbase: 1.08,        // m
  wheelRadius: 0.267,     // 26" wheel
  comHeight: 1.02,        // centre of mass above the axle line
  /** Suspension travel, metres. */
  forkTravel: 0.13,
  shockTravel: 0.09,
  forkStiffness: 32000,   // N/m
  forkDamping: 2300,      // Ns/m
  shockStiffness: 46000,
  shockDamping: 3100,
  /**
   * Peak drive force from pedalling, newtons.
   *
   * 460 N on a 92 kg bike+rider is 5.0 m/s^2 at a standstill and far less as
   * soon as the spin-out term bites, which made recovering from any stop a
   * chore and made a 5 degree rise genuinely impassable: measured, a player
   * holding pedal from the line reached 70 km/h at 67 m and then sat between 11
   * and 32 km/h unable to get up the 4.9 degree section at 244-252 m. This is
   * an arcade downhill racer, not a simulation of a tired cyclist.
   */
  pedalForce: 720,
  /**
   * Speed beyond which pedalling adds nothing (spun out), m/s.
   *
   * Was 17.5 (63 km/h), so the drive died right where the game gets fast and
   * the whole midrange coasted. 27 m/s is 97 km/h.
   */
  spinOutSpeed: 19.5,
  brakeForceRear: 1450,
  brakeForceFront: 2350,
  /**
   * Aerodynamic drag coefficient — 0.5 * rho * Cd * A.
   *
   * Drag is what actually sets terminal speed on a long descent: at 0.42 it
   * reached 262 N by 25 m/s, which is more than the gravity component on a
   * 15 degree slope, so the course could not accelerate the rider past about
   * 23 m/s no matter how steep it got. 0.25 moves that ceiling well past what
   * the trail is wide enough for, and leaves the corners as the speed limit
   * instead of the air.
   */
  dragK: 0.42,
  /** Maximum steering angle at the bars, radians. */
  maxSteer: 0.78,
  /** How much steering authority falls off with speed. */
  steerSpeedFalloff: 0.055,
  /**
   * Maximum body lean, radians. 1.02 rad is 58 degrees.
   *
   * Lean is what a corner IS in this model — the steer input asks for a
   * cornering acceleration and `tan(lean) = a / g` is the angle that holds it —
   * so this constant is the hard ceiling on how sharply the player can turn at
   * any speed. At 0.86 (49 deg) the bike simply would not come round quickly
   * enough to feel connected to the keys, which a player described as the
   * controls being "very weak". Raising it is the single largest change to how
   * responsive the bike feels, and it is an arcade racer: real downhill riders
   * do reach 50-55 degrees, and going a little past that is the point.
   */
  maxLean: 1.02,
  /** Air rotation rates, rad/s. */
  airPitchRate: 4.6,
  airYawRate: 3.9,
  airRollRate: 3.4,
  /** Landing tolerance: angle mismatch above this crashes, radians. */
  landingAngleTolerance: 0.62,
  /** Vertical impact speed above this crashes, m/s. */
  landingSpeedTolerance: 15.5,
  /** Boost. */
  boostForce: 620,
  boostDrainPerSecond: 0.42,
  boostPerTrickPoint: 0.00042,
  gravity: 20.4,          // exaggerated — arcade weight, not 9.81
};

export const SURFACES = {
  trail: { grip: 1.0, rollingResistance: 0.24, drag: 0.0, dustAmount: 0.55, harshness: 0.7 },
  dirt: { grip: 0.88, rollingResistance: 0.42, drag: 0.08, dustAmount: 1.0, harshness: 0.8 },
  grass: { grip: 0.74, rollingResistance: 0.92, drag: 0.28, dustAmount: 0.35, harshness: 0.55 },
  rock: { grip: 0.92, rollingResistance: 0.36, drag: 0.12, dustAmount: 0.18, harshness: 1.45 },
  scree: { grip: 0.46, rollingResistance: 0.70, drag: 0.22, dustAmount: 1.35, harshness: 1.15 },
  snow: { grip: 0.58, rollingResistance: 1.05, drag: 0.30, dustAmount: 1.5, harshness: 0.45 },
  water: { grip: 0.52, rollingResistance: 1.6, drag: 0.55, dustAmount: 1.8, harshness: 0.9 },
};

// ── Derived helpers ──────────────────────────────────────────────────────────

/** Route control points as Vector3 with y = 0 (filled in from terrain later). */
export function routePoints(): Vector3[] {
  return ROUTE.map((r) => new Vector3(r.x, 0, r.z));
}

// ── The route as geometry ────────────────────────────────────────────────────
/**
 * One shared, arc-length-parameterised polyline through the ROUTE controls.
 *
 * Terrain and track each used to carry their own idea of where the course goes:
 * the terrain re-splined the controls itself, and the authored features were
 * pinned to a hardcoded world XZ and a hardcoded azimuth. That is fine right up
 * until an azimuth disagrees with the route it is supposed to be aligned to, at
 * which point the feature is built across the course instead of along it and
 * nothing downstream can tell you why. The tabletop was 5.7 degrees out.
 *
 * So there is exactly one route curve, it lives here with the controls, and both
 * systems project onto it. `centripetal` matches TrackSpline's own curve type,
 * which is what makes a station computed here land on the same ground the track
 * builder will put the centreline.
 *
 * Deterministic: a pure function of ROUTE, built once, cached.
 */
export interface RoutePolyline {
  x: Float64Array;
  z: Float64Array;
  /** Unit tangent in XZ at each station. */
  tx: Float64Array;
  tz: Float64Array;
  /** Station spacing, metres. */
  step: number;
  count: number;
  length: number;
}

let _routePoly: RoutePolyline | null = null;

/** The shared route polyline, resampled to a uniform ~1 m station spacing. */
export function routePolyline(): RoutePolyline {
  if (_routePoly) return _routePoly;

  const ctrl = ROUTE.map((r) => new Vector3(r.x, 0, r.z));
  const curve = new CatmullRomCurve3(ctrl, false, 'centripetal', 0.5);

  const DENSE = 12000;
  const dx = new Float64Array(DENSE + 1);
  const dz = new Float64Array(DENSE + 1);
  const cum = new Float64Array(DENSE + 1);
  const p = new Vector3();
  for (let i = 0; i <= DENSE; i++) {
    curve.getPoint(i / DENSE, p);
    dx[i] = p.x;
    dz[i] = p.z;
    if (i > 0) cum[i] = cum[i - 1] + Math.hypot(dx[i] - dx[i - 1], dz[i] - dz[i - 1]);
  }
  const length = cum[DENSE];
  const count = Math.max(2, Math.round(length) + 1);
  const step = length / (count - 1);

  const x = new Float64Array(count);
  const z = new Float64Array(count);
  const tx = new Float64Array(count);
  const tz = new Float64Array(count);
  let j = 0;
  for (let i = 0; i < count; i++) {
    const target = i * step;
    while (j < DENSE && cum[j + 1] < target) j++;
    const seg = cum[j + 1] - cum[j];
    const f = seg > 1e-9 ? (target - cum[j]) / seg : 0;
    x[i] = dx[j] + (dx[j + 1] - dx[j]) * f;
    z[i] = dz[j] + (dz[j + 1] - dz[j]) * f;
  }
  for (let i = 0; i < count; i++) {
    const a = Math.max(0, i - 1);
    const b = Math.min(count - 1, i + 1);
    const ux = x[b] - x[a];
    const uz = z[b] - z[a];
    const l = Math.hypot(ux, uz) || 1;
    tx[i] = ux / l;
    tz[i] = uz / l;
  }

  _routePoly = { x, z, tx, tz, step, count, length };
  return _routePoly;
}

/** A point resolved against the route: arc distance, lateral offset, tangent. */
export interface RouteFrame {
  /** Arc distance along the route, metres from the start gate. */
  s: number;
  /** Signed lateral offset, metres. Positive is to the LEFT of travel. */
  u: number;
  x: number;
  z: number;
  tx: number;
  tz: number;
}

export function makeRouteFrame(): RouteFrame {
  return { s: 0, u: 0, x: 0, z: 0, tx: 0, tz: 1 };
}

/**
 * Route position and tangent at an arc distance. Clamped, allocation-free.
 */
export function routeAt(s: number, out: RouteFrame): RouteFrame {
  const poly = routePolyline();
  const f = Math.min(Math.max(s / poly.step, 0), poly.count - 1);
  const i0 = Math.min(f | 0, poly.count - 1);
  const i1 = Math.min(i0 + 1, poly.count - 1);
  const k = f - i0;
  out.s = s;
  out.u = 0;
  out.x = poly.x[i0] + (poly.x[i1] - poly.x[i0]) * k;
  out.z = poly.z[i0] + (poly.z[i1] - poly.z[i0]) * k;
  const ux = poly.tx[i0] + (poly.tx[i1] - poly.tx[i0]) * k;
  const uz = poly.tz[i0] + (poly.tz[i1] - poly.tz[i0]) * k;
  const l = Math.hypot(ux, uz) || 1;
  out.tx = ux / l;
  out.tz = uz / l;
  return out;
}

/**
 * Project a world XZ point onto the route.
 *
 * `from`/`to` bound the station scan. The switchbacks bring two legs of the
 * course within 45 m of each other, so an unbounded scan genuinely can pick the
 * wrong leg; every caller here knows which stretch of route it is asking about
 * and says so.
 */
export function projectOnRoute(
  x: number,
  z: number,
  out: RouteFrame,
  from = 0,
  to = Number.POSITIVE_INFINITY,
): RouteFrame {
  const poly = routePolyline();
  const i0 = Math.max(0, Math.min(poly.count - 1, Math.floor(from / poly.step)));
  const i1 = Math.max(i0, Math.min(poly.count - 1, Math.ceil(to / poly.step)));

  let best = i0;
  let bestD2 = Infinity;
  for (let i = i0; i <= i1; i++) {
    const ddx = poly.x[i] - x;
    const ddz = poly.z[i] - z;
    const d2 = ddx * ddx + ddz * ddz;
    if (d2 < bestD2) {
      bestD2 = d2;
      best = i;
    }
  }

  // Refine onto the two adjoining segments so `s` is continuous rather than
  // quantised to the station spacing — a quantised `s` puts a 1 m stair in the
  // face of any ramp built in this frame.
  let bs = best * poly.step;
  let bu = 0;
  let bd2 = Infinity;
  for (let k = -1; k <= 0; k++) {
    const a = best + k;
    const b = a + 1;
    if (a < i0 || b > i1) continue;
    const sx = poly.x[b] - poly.x[a];
    const sz = poly.z[b] - poly.z[a];
    const l2 = sx * sx + sz * sz;
    if (l2 < 1e-12) continue;
    const t = Math.min(Math.max(((x - poly.x[a]) * sx + (z - poly.z[a]) * sz) / l2, 0), 1);
    const cx = poly.x[a] + sx * t;
    const cz = poly.z[a] + sz * t;
    const d2 = (x - cx) * (x - cx) + (z - cz) * (z - cz);
    if (d2 < bd2) {
      bd2 = d2;
      bs = (a + t) * poly.step;
      const l = Math.sqrt(l2);
      // Left-hand normal in plan, matching TrackSpline's `left`.
      bu = (x - cx) * (sz / l) + (z - cz) * (-sx / l);
    }
  }

  routeAt(bs, out);
  out.u = bu;
  return out;
}

/** Arc distance along the route of the point nearest (x, z). */
export function routeDistanceOf(x: number, z: number, from?: number, to?: number): number {
  return projectOnRoute(x, z, _rfScratch, from, to).s;
}

const _rfScratch = makeRouteFrame();

/** Total straight-line length of the route polyline — a rough course length. */
export function routePolylineLength(): number {
  let d = 0;
  for (let i = 1; i < ROUTE.length; i++) {
    const dx = ROUTE[i].x - ROUTE[i - 1].x;
    const dz = ROUTE[i].z - ROUTE[i - 1].z;
    d += Math.hypot(dx, dz);
  }
  return d;
}

/**
 * The descent profile the corridor prior must produce: a monotonic drop from
 * SUMMIT_HEIGHT at the start to VALLEY_HEIGHT at the finish, with the gradient
 * shaped so the scree run is steep, the switchbacks are moderate, and the final
 * sprint is gentle. Returns the target height at a normalised route position.
 */
export function corridorHeightAt(t: number): number {
  // Piecewise gradient profile, integrated. Keys are (t, relative steepness).
  const keys: [number, number][] = [
    [0.00, 0.55],  // technical start — moderate
    [0.09, 0.55],
    [0.13, 1.60],  // scree face — steep
    [0.26, 1.55],
    [0.30, 0.85],  // switchbacks — moderate, traversing
    [0.46, 0.80],
    [0.50, 1.10],  // rock garden
    [0.58, 1.05],
    [0.61, 0.70],  // tabletop approach — flatter so the lip reads
    [0.66, 0.62],
    [0.69, 1.30],  // ravine drop
    [0.73, 0.95],
    [0.76, 0.75],  // ridge — nearly level, exposure does the work
    [0.86, 0.72],
    [0.89, 1.25],  // stream drop-in
    [0.93, 0.80],
    [0.96, 0.45],  // run-out
    [1.00, 0.35],
  ];

  // Integrate the profile once to normalise it, then evaluate.
  const N = 512;
  let total = 0;
  const cum: number[] = new Array(N + 1);
  for (let i = 0; i <= N; i++) {
    const tt = i / N;
    cum[i] = total;
    total += sampleKeys(keys, tt) / N;
  }
  const idx = Math.min(N, Math.max(0, Math.floor(t * N)));
  const frac = cum[idx] / (total || 1);
  return SUMMIT_HEIGHT + (VALLEY_HEIGHT - SUMMIT_HEIGHT) * frac;
}

function sampleKeys(keys: [number, number][], t: number): number {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    if (t <= keys[i][0]) {
      const [t0, v0] = keys[i - 1];
      const [t1, v1] = keys[i];
      const k = (t - t0) / Math.max(t1 - t0, 1e-6);
      return v0 + (v1 - v0) * (k * k * (3 - 2 * k));
    }
  }
  return keys[keys.length - 1][1];
}
