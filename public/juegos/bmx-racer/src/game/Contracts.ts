/**
 * Contracts — the frozen interfaces between subsystems.
 *
 * This file is the architectural spine of the project. Every subsystem is
 * written against these types and nothing else, which is what lets terrain,
 * physics, the rider rig, the AI, the camera and the HUD be developed
 * independently without any of them reaching into another's internals.
 *
 * Rules:
 *  • Nothing in here imports a subsystem. It may import three and core utils.
 *  • Units are SI: metres, seconds, radians, m/s. Not km/h, not degrees.
 *  • +Y is up. The mountain descends toward -Y and (broadly) +Z.
 *  • Any subsystem that renders owns an Object3D and adds it to the scene
 *    itself; the Game never reaches into a subsystem's scene graph.
 */

import type { Object3D, Vector2, Vector3, Quaternion, Camera, PerspectiveCamera, Scene, WebGLRenderer } from 'three';

// ─────────────────────────────────────────────────────────────────────────────
// Terrain
// ─────────────────────────────────────────────────────────────────────────────

/** Which material zone a point on the mountain belongs to. */
export enum SurfaceKind {
  Rock = 0,
  Dirt = 1,
  Grass = 2,
  Scree = 3,
  Snow = 4,
  Water = 5,
  /** The groomed trail ribbon. Highest grip, fastest. */
  Trail = 6,
}

/** Grip and rolling behaviour per surface. Consumed by the bike physics. */
export interface SurfaceProperties {
  kind: SurfaceKind;
  /** Lateral grip coefficient. Trail ~1.0, scree ~0.42. */
  grip: number;
  /** Rolling resistance, m/s² of deceleration at 10 m/s. */
  rollingResistance: number;
  /** How much the surface slows you when you plough into it off-line. */
  drag: number;
  /** Dust colour multiplier and emission rate scale. */
  dustAmount: number;
  /** Suspension damping multiplier — rock is harsh, dirt is forgiving. */
  harshness: number;
  /** Audio tone selector for the tyre synth. */
  audioTone: 'hardpack' | 'gravel' | 'grass' | 'rock' | 'water' | 'snow';
}

/** A sample of the mountain at a world XZ position. */
export interface TerrainSample {
  height: number;
  /** Unit surface normal. */
  normal: Vector3;
  /** Steepest-descent slope in radians, 0 = flat. */
  slope: number;
  kind: SurfaceKind;
  surface: SurfaceProperties;
}

export interface ITerrain {
  readonly object: Object3D;
  /** World-space extent of the heightfield. */
  readonly worldSize: number;
  readonly maxHeight: number;

  /** Fast height-only query. Bilinear on the eroded heightmap. */
  heightAt(x: number, z: number): number;
  /** Full sample including normal and surface classification. */
  sampleAt(x: number, z: number, out?: TerrainSample): TerrainSample;
  /** Normal only — cheaper than a full sample. */
  normalAt(x: number, z: number, out?: Vector3): Vector3;
  /** Downhill direction at a point, normalised, XZ-projected. */
  downhillAt(x: number, z: number, out?: Vector3): Vector3;

  /** Raycast straight down from `y`. Returns hit height or null if off-map. */
  raycastDown(x: number, y: number, z: number): number | null;

  /**
   * Called every frame with the camera so the clipmap can re-centre and the
   * scatter systems can stream. Must be cheap — this is on the hot path.
   */
  update(camera: PerspectiveCamera, dt: number): void;

  /** Register a region where the track ribbon has flattened the ground. */
  applyTrackCarve(carve: TrackCarve): void;

  dispose(): void;
}

/** The trail flattens and smooths the terrain along its length. */
export interface TrackCarve {
  /** Sampled centreline points, world space. */
  points: Vector3[];
  /** Half-width of the flattened corridor at each point. */
  halfWidths: number[];
  /**
   * RIDEABLE half-width at each point — what the trail is, as opposed to how
   * wide the ground was flattened around it.
   *
   * `halfWidths` is the flattening reach and is inflated (about 1.22x plus a
   * berm term plus 1.1 m of shoulder), so it cannot be inverted back to the
   * trail's real width. Painting the Trail zone out to a fraction of the
   * INFLATED width left a 1-2 m ring of trail-coloured terrain outside the
   * ribbon mesh all the way down the course — which at the 1-2 degree grazing
   * incidence of a receding trail projects to 30-70 px of torn edge.
   */
  rideWidths?: number[];

  /**
   * Rise of the trail surface per metre of LEFT offset — the y component of the
   * banked surface-left unit vector, which is exactly what the ribbon mesh uses
   * to place its own vertices (`y = centre.y + surfaceLeft.y * lateral`).
   *
   * The carve used to rebuild this from `banks` as `tan(bank)`, and it came out
   * with the OPPOSITE SIGN. That gave the ground a mirror-image camber to the
   * trail drawn on it: measured at 300 m, the ribbon fell 0.672 m to the left
   * across the trail while the heightfield rose 0.613 m, so the two surfaces
   * were 1.285 m apart at the edge of a trail whose half-width is about 3 m.
   * The bike rides the heightfield and the player sees the ribbon, so on one
   * side of every banked corner the drawn trail stood above the rider and cut
   * him off at the chest.
   *
   * Supplying the gradient itself removes the chance to re-derive it wrongly.
   * `banks` remains for anything that wants the angle.
   */
  crossSlopes?: number[];
  /** Bank angle in radians at each point (positive = banked right). */
  banks: number[];
  /** Blend falloff distance beyond the half-width. */
  featherWidth: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Track
// ─────────────────────────────────────────────────────────────────────────────

export interface TrackSampleResult {
  /** Position on the centreline. */
  position: Vector3;
  /** Forward tangent, normalised. */
  tangent: Vector3;
  /** Left-hand normal in the horizontal plane. */
  left: Vector3;
  /** Surface up at this point (accounts for bank). */
  up: Vector3;
  /** Half width of the rideable ribbon here. */
  halfWidth: number;
  /** Bank angle, radians. */
  bank: number;
  /** Signed curvature, 1/m. Positive = turning left. */
  curvature: number;
  /** Distance along the track from the start, metres. */
  distance: number;
  /** Normalised progress 0..1. */
  t: number;
  /** Which named section of the course this is. */
  section: TrackSectionKind;
}

export enum TrackSectionKind {
  TechnicalStart = 'technical-start',
  ScreeRun = 'scree-run',
  Switchbacks = 'switchbacks',
  RockGarden = 'rock-garden',
  Tabletop = 'tabletop',
  RavineGap = 'ravine-gap',
  RidgeSprint = 'ridge-sprint',
  StreamBed = 'stream-bed',
  FinalSprint = 'final-sprint',
}

export interface Checkpoint {
  index: number;
  /** Distance along the track. */
  distance: number;
  position: Vector3;
  /** Gate width, metres. */
  halfWidth: number;
  /** Forward direction through the gate. */
  forward: Vector3;
  isFinish: boolean;
}

export interface ITrack {
  readonly object: Object3D;
  readonly length: number;
  readonly checkpoints: Checkpoint[];

  /** Sample by distance along the centreline, metres. */
  sampleAtDistance(d: number, out?: TrackSampleResult): TrackSampleResult;
  /** Sample by normalised parameter 0..1. */
  sampleAtT(t: number, out?: TrackSampleResult): TrackSampleResult;

  /**
   * Project a world position onto the track.
   * Returns distance along, signed lateral offset (positive = left of centre),
   * and how far above/below the ribbon surface the point is.
   */
  project(
    position: Vector3,
    hintDistance?: number,
  ): { distance: number; lateral: number; vertical: number; sample: TrackSampleResult };

  /** The carve description handed to the terrain. */
  getCarve(): TrackCarve;

  dispose(): void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Bike + rider physics
// ─────────────────────────────────────────────────────────────────────────────

export interface WheelState {
  /** World position of the contact point (or the wheel centre if airborne). */
  contactPoint: Vector3;
  contactNormal: Vector3;
  /** True if the wheel is touching the ground this step. */
  grounded: boolean;
  /** Current suspension compression, 0 = topped out, 1 = bottomed. */
  compression: number;
  /** Compression velocity, +ve = compressing. Drives the visual and the audio. */
  compressionVelocity: number;
  /** Wheel spin angle, radians. */
  spin: number;
  /** Angular velocity, rad/s. */
  spinRate: number;
  /** Longitudinal slip ratio, -1..1. Negative = locked/skidding. */
  slipRatio: number;
  /** Lateral slip velocity, m/s. Drives dust and tyre squeal. */
  lateralSlip: number;
  /** Surface under this wheel. */
  surface: SurfaceProperties;
  /** Normal force, newtons. */
  load: number;
}

export enum BikeMode {
  Grounded = 'grounded',
  Airborne = 'airborne',
  Crashing = 'crashing',
  Recovering = 'recovering',
  Finished = 'finished',
}

/**
 * The full physical state of one bike+rider. Read by the rider rig, camera,
 * FX, HUD, AI and audio. Nothing else in the game should describe motion.
 */
export interface BikeState {
  position: Vector3;      // rear-axle-ish reference point, world space
  velocity: Vector3;      // m/s, world
  orientation: Quaternion;
  angularVelocity: Vector3;

  /** Signed forward speed along the bike's own forward axis, m/s. */
  forwardSpeed: number;
  /** Total speed magnitude, m/s. */
  speed: number;

  /** Body lean about the forward axis, radians. Positive = leaning right. */
  lean: number;
  /** Steering angle at the bars, radians. */
  steerAngle: number;
  /** Frame pitch relative to the ground plane, radians. */
  pitch: number;

  front: WheelState;
  rear: WheelState;

  mode: BikeMode;
  /** Seconds spent in the current mode. */
  modeTime: number;
  /** Height above the ground directly below, metres. */
  airHeight: number;
  /** Time since the last time both wheels were grounded. */
  airTime: number;
  /** Peak height reached in the current jump. */
  peakAirHeight: number;

  /** 0..1 how compressed the rider is (preload). */
  preload: number;
  /** Energy stored by a good preload, released on the lip. 0..1. */
  pumpCharge: number;
  /** True during a manual (front wheel lifted). */
  manualling: boolean;
  /** 0..1 front wheel lift amount. */
  manualAmount: number;

  /** Boost meter 0..1 and whether boost is currently firing. */
  boost: number;
  boosting: boolean;

  /** Set for exactly one physics step when the bike lands. */
  landedThisStep: boolean;
  /** Landing impact severity 0..1, valid on the step landedThisStep is true. */
  landingImpact: number;
  /** How well the landing angle matched the slope. 1 = perfect. */
  landingQuality: number;
  /** Set for exactly one step when a crash begins. */
  crashedThisStep: boolean;
  /** Direction the crash impulse came from, world space, normalised. */
  crashDirection: Vector3;
  crashSeverity: number;
}

/** Everything the physics needs from the outside world each step. */
export interface BikeInput {
  steer: number;       // -1..1
  pedal: number;       // 0..1
  brakeRear: number;   // 0..1
  brakeFront: number;  // 0..1
  crouch: number;      // 0..1
  pitchLean: number;   // -1..1
  /** Air rotation intent: x = flip (pitch), y = spin (yaw), z = roll. */
  airPitch: number;
  airYaw: number;
  airRoll: number;
  wantBoost: boolean;
  wantHop: boolean;
}

export interface IBike {
  readonly state: BikeState;
  readonly object: Object3D;
  /** Anchor transforms the rider rig's IK targets attach to. */
  readonly anchors: BikeAnchors;

  step(input: BikeInput, dt: number): void;
  /** Interpolated visual update. `alpha` blends the last two physics states. */
  updateVisual(alpha: number, dt: number): void;

  reset(position: Vector3, forward: Vector3): void;
  dispose(): void;
}

/** Where the rider's hands, feet and seat attach. All are Object3Ds on the bike. */
export interface BikeAnchors {
  barLeft: Object3D;
  barRight: Object3D;
  pedalLeft: Object3D;
  pedalRight: Object3D;
  seat: Object3D;
  /** Frame origin — the rider's pelvis orbits this. */
  frame: Object3D;
  /** Where dust is emitted from. */
  frontContact: Object3D;
  rearContact: Object3D;
}

// ─────────────────────────────────────────────────────────────────────────────
// Rider rig
// ─────────────────────────────────────────────────────────────────────────────

export enum TrickKind {
  None = 'none',
  Tabletop = 'tabletop',
  XUp = 'x-up',
  Superman = 'superman',
  Tailwhip = 'tailwhip',
  Spin360 = '360',
  Backflip = 'backflip',
  Frontflip = 'frontflip',
  Manual = 'manual',
  NoFooter = 'no-footer',
}

export interface TrickState {
  kind: TrickKind;
  /** 0..1 through the trick pose. */
  phase: number;
  /** Accumulated rotations for spins/flips. */
  rotations: number;
  /** Points this trick will bank if landed cleanly. */
  pendingScore: number;
  /** True once the trick has fully returned to neutral and can be landed. */
  committed: boolean;
}

/**
 * The rider rig. Owns its skeleton, its meshes, and all procedural animation.
 * It is a pure consumer of BikeState + TrickState — it never drives physics.
 */
export interface IRiderRig {
  readonly object: Object3D;
  /**
   * Drive the whole rig for one visual frame.
   * Must leave hands exactly on the bar anchors and feet on the pedal anchors.
   */
  update(state: BikeState, trick: TrickState, dt: number, time: number): void;
  setJerseyColor(jersey: number, accent: number): void;
  dispose(): void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Race
// ─────────────────────────────────────────────────────────────────────────────

export enum RacePhase {
  Attract = 'attract',
  Countdown = 'countdown',
  Racing = 'racing',
  Finished = 'finished',
  Results = 'results',
  Paused = 'paused',
}

export interface RacerProgress {
  id: string;
  name: string;
  isPlayer: boolean;
  /** Distance along the track, metres. Monotonic; wrong-way does not reduce it. */
  distance: number;
  /** Live position, 1 = leading. */
  position: number;
  /** Seconds since the start gun. */
  raceTime: number;
  finished: boolean;
  finishTime: number | null;
  /** Split times at each checkpoint, seconds since start. */
  splits: (number | null)[];
  trickScore: number;
  /** Gap to the racer ahead in seconds. Null for the leader. */
  gapAhead: number | null;
  /** Colour index into RIDER_COLORS. */
  colorIndex: number;
  crashCount: number;
}

export interface IRacer {
  readonly id: string;
  readonly bike: IBike;
  readonly rig: IRiderRig;
  readonly progress: RacerProgress;
  readonly trick: TrickState;
  readonly object: Object3D;
  /** Produce this racer's input for the next physics step. */
  gatherInput(dt: number, ctx: RaceContext): BikeInput;
  update(dt: number, ctx: RaceContext): void;
  updateVisual(alpha: number, dt: number, time: number): void;
  reset(): void;
  dispose(): void;
}

/** Read-only view of the race handed to every racer each step. */
export interface RaceContext {
  terrain: ITerrain;
  track: ITrack;
  racers: IRacer[];
  phase: RacePhase;
  raceTime: number;
  /** Leader distance, for rubber-banding. */
  leaderDistance: number;
  dt: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// FX + camera
// ─────────────────────────────────────────────────────────────────────────────

export enum CameraMode {
  Chase = 'chase',
  Cinematic = 'cinematic',
  Replay = 'replay',
  Orbit = 'orbit',
  Free = 'free',
  Fixed = 'fixed',
}

export interface ICameraDirector {
  readonly camera: PerspectiveCamera;
  mode: CameraMode;
  /** Called once per rendered frame, after physics. */
  update(target: BikeState, dt: number, time: number): void;
  /** Kick the camera — landing shake, crash shake, boost punch. */
  shake(amount: number, duration: number): void;
  fovKick(amount: number): void;
  /** Trigger the automatic big-air swing-around. */
  beginAirSwing(duration: number): void;
  snapTo(position: Vector3, lookAt: Vector3): void;
  dispose(): void;
}

export interface IEffects {
  readonly object: Object3D;
  update(dt: number, time: number, camera: Camera): void;
  /** Kick up a burst of cel dust. */
  dustBurst(position: Vector3, normal: Vector3, velocity: Vector3, amount: number, surface: SurfaceProperties): void;
  /** Continuous dust from a sliding/rolling wheel. */
  dustTrail(position: Vector3, normal: Vector3, velocity: Vector3, rate: number, surface: SurfaceProperties): void;
  /** The anime impact hold: freeze + high-contrast flash for 1–2 frames. */
  impactFrame(intensity: number, tint?: number): void;
  /** Motion smear on a target for a short window. */
  smear(target: Object3D, amount: number): void;
  dispose(): void;
}

// ─────────────────────────────────────────────────────────────────────────────
// HUD + audio
// ─────────────────────────────────────────────────────────────────────────────

export interface HudModel {
  phase: RacePhase;
  speedKmh: number;
  position: number;
  racerCount: number;
  raceTime: number;
  boost: number;
  boosting: boolean;
  trickScore: number;
  /** Currently-executing trick name, or null. */
  activeTrick: string | null;
  /** Score popups to show. The HUD consumes and clears these. */
  popups: { text: string; value: number; kind: 'trick' | 'split' | 'warning' | 'combo' }[];
  /** Progress down the mountain, 0..1. */
  routeProgress: number;
  /** Checkpoint splits, with deltas to the ghost. */
  splits: { index: number; time: number | null; delta: number | null }[];
  /** Signed gap to the racer ahead/behind, seconds. */
  gapAhead: number | null;
  gapBehind: number | null;
  /** Preview of the next corner: signed curvature -1..1 and distance to it. */
  cornerPreview: { curvature: number; distance: number } | null;
  wrongWay: boolean;
  countdown: number | null;
  /** All racers for the position board. */
  standings: RacerProgress[];
  /** Live route profile: elevation samples and the player's marker. */
  routeProfile: Float32Array;
  ghostDelta: number | null;
}

export interface IHud {
  readonly object: Object3D;
  update(model: HudModel, dt: number, time: number): void;
  resize(width: number, height: number): void;
  dispose(): void;
}

export interface IAudio {
  /** Must be called from a user gesture. */
  unlock(): Promise<void>;
  update(state: BikeState, surface: SurfaceProperties, dt: number): void;
  playImpact(severity: number, surface: SurfaceProperties): void;
  playSuspension(compressionVelocity: number): void;
  playStartHorn(pitch?: number): void;
  playUi(kind: 'tick' | 'confirm' | 'score' | 'checkpoint' | 'warning'): void;
  setMasterVolume(v: number): void;
  dispose(): void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Post pipeline
// ─────────────────────────────────────────────────────────────────────────────

export interface IPostPipeline {
  /** Runs the whole frame: prepass, shadows, main, lines, bloom, grade. */
  render(scene: Scene, camera: PerspectiveCamera, dt: number, time: number): void;
  resize(width: number, height: number): void;
  dispose(): void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Replay / ghost
// ─────────────────────────────────────────────────────────────────────────────

export interface ReplayFrame {
  t: number;
  px: number; py: number; pz: number;
  qx: number; qy: number; qz: number; qw: number;
  speed: number;
  lean: number;
  steer: number;
  /** Packed flags: grounded, airborne, trick id. */
  flags: number;
}

export interface IReplayRecorder {
  record(t: number, state: BikeState): void;
  /** The window around the biggest air of the run, for the results replay. */
  getBiggestAir(): { start: number; end: number; peak: number } | null;
  frames: ReplayFrame[];
  clear(): void;
}
