/**
 * Game — the orchestrator.
 *
 * Every subsystem in this project is written against `Contracts.ts` and nothing
 * else. This file is the only place that knows all of them exist, and its job
 * is to build them in dependency order and then call them in the right order,
 * every frame, forever.
 *
 * The order is not arbitrary and changing it will break things:
 *
 *   FIXED STEP (120 Hz, from the engine's accumulator)
 *     race.fixedUpdate  ->  per racer: AI/player input -> bike.step -> tricks
 *
 *   RENDER (once per displayed frame, on interpolated state)
 *     input                the player's raw intent for THIS frame
 *     effects.beginFrame   returns the time-scaled dt (slow-mo lives here)
 *     race.updateVisual    bikes interpolate, rider rigs solve IK onto them
 *     camera               reads the finished bike transform, never a stale one
 *     effects.update       dust/debris/speed lines follow the camera it just set
 *     hud / audio          read the resolved frame
 *     post.render          shadows -> G-buffer -> hulls -> cel -> lines -> grade
 *     hud.render           drawn over the graded frame, never through the LUT
 *
 * The rider rig MUST solve after the bike has been placed and before the camera
 * reads anything, or the hands lag the bars by one frame — which is visible.
 */

import { Color, PerspectiveCamera, Vector3 } from 'three';

import { Engine } from '../core/Engine';
import { Input } from '../core/Input';
import { Sky } from '../npr/Sky';
import { NPR, POST_STATE, updateNprGlobals } from '../npr/NprGlobals';
import { initGeneratedTextures } from '../npr/GeneratedTextures';
import { PostPipeline, decayPostState, type PostDebugView } from '../npr/PostPipeline';
import { RIDER_COLORS } from '../npr/Palette';

import { createTerrain, type Terrain } from '../terrain';
import { createTrack, type Track } from '../track';
import { Bike, createBike } from '../bike';
import { attachRigToBike, createRiderRig } from '../rider';
import { createEffects, type Effects } from '../fx';
import { Hud } from '../hud';
import { AudioEngine } from '../audio';
import { RaceDirector, type RacerSpec } from '../ai';

import {
  CameraMode,
  RacePhase,
  type BikeInput,
  type IBike,
  type IRiderRig,
} from './Contracts';
import { clamp01 } from '../core/MathX';
import { BIKE, COUNTDOWN_SECONDS } from './WorldConstants';

export interface GameOptions {
  params: URLSearchParams;
}

/**
 * The surface the Playwright harness drives. Kept deliberately small: take the
 * clock, set a named situation, step a fixed dt, shoot. Anything the harness
 * needs that isn't expressible as "a named pose" belongs in the game, not here.
 */
export interface CaptureApi {
  takeControl(): void;
  releaseControl(): void;
  step(dt: number): void;
  setPose(name: string): boolean;
  setSequence(name: string): boolean;
  listPoses(): string[];
  listSequences(): string[];
  setDebugView(view: string): void;
}

/**
 * A capture setup. `t` is the fraction along the course the player is
 * teleported to; the camera is placed by `camera` (+ `orbit` when framing by
 * hand), and `input` is held for every step until the next setup.
 */
interface Situation {
  /**
   * Where on the course, as a fraction of track length. Anchored to the REAL
   * section boundaries reported by `track.sectionRanges`, not guessed — a pose
   * sitting exactly on a boundary reads as the previous section, which is how
   * the first review set ended up with a `rockgarden` frame labelled
   * SWITCHBACKS and a `tabletop` frame labelled ROCK GARDEN. Half the set was
   * reviewing the wrong feature.
   */
  t: number;
  speed: number;
  /** Height above the trail at spawn — greater than 0 puts the rider in the air. */
  lift?: number;
  /**
   * Vertical launch velocity, m/s. An air pose needs the rider to be genuinely
   * ballistic over the feature; dropping one in at a fixed height just makes a
   * rider hanging in space, and the settle frames put it straight back on the
   * ground before the shutter opens.
   */
  launch?: number;
  /**
   * Fixed physics steps to run before the shutter, at 120 Hz.
   *
   * The jumps work for real now — a rider placed on the run-in with speed and
   * no impulse launches off the kicker and lands on the deck. So an air pose
   * should be REACHED by riding into it, not faked with a vertical impulse:
   * the artificial launch on `ravine-gap` flew the rider straight past the
   * receiving ramp and 13 m into the far hillside. The harness only settles 12
   * frames before shooting, which is 4 m of travel, so a pose that needs to
   * cover 25 m of run-in has to say so.
   */
  preroll?: number;
  camera: CameraMode;
  orbit?: { yaw: number; pitch: number; dist: number; spin?: number };
  input?: Partial<BikeInput>;
  /** Put the bike down on the first step, deterministically. */
  crash?: boolean;
  /**
   * Where the pack goes. Rivals used to spawn 3.5 m behind the player, which
   * is inside the chase boom, so an opponent filled a screen quadrant. Moving
   * them to 12 m+ behind fixed that and created the opposite failure: a
   * sequence named `pack-race` with no rival in a single frame of it, because
   * behind the player is exactly where a chase camera cannot see.
   */
  pack?: 'behind' | 'ahead';
}

// Section boundaries as a fraction of the 3839 m course, measured from the
// built track rather than assumed:
//   technical-start 0.000–0.109   scree-run    0.109–0.269
//   switchbacks     0.269–0.518   rock-garden  0.518–0.600
//   tabletop        0.600–0.651   ravine-gap   0.651–0.702
//   ridge-sprint    0.702–0.811   stream-bed   0.811–0.887
//   final-sprint    0.887–1.000
// The ravine's actual hole is at 0.675–0.678.
const SITUATIONS: Record<string, Situation> = {
  'summit-wide':        { t: 0.004, speed: 0,  camera: CameraMode.Orbit, orbit: { yaw: 0.35, pitch: 0.22, dist: 52, spin: 0 } },
  'summit-rider':       { t: 0.020, speed: 6,  camera: CameraMode.Orbit, orbit: { yaw: 0.95, pitch: 0.18, dist: 9 } },
  'rider-closeup':      { t: 0.075, speed: 12, camera: CameraMode.Orbit, orbit: { yaw: 2.30, pitch: 0.10, dist: 3.4 } },
  'rider-threequarter': { t: 0.075, speed: 12, camera: CameraMode.Orbit, orbit: { yaw: 0.95, pitch: 0.20, dist: 5.0 } },
  // Side-on and low, so the bike is a readable silhouette rather than a
  // three-quarter rear view half-occluded by the rider's own leg.
  'bike-detail':        { t: 0.075, speed: 8,  camera: CameraMode.Orbit, orbit: { yaw: 1.57, pitch: 0.02, dist: 2.3 } },
  'scree-speed':        { t: 0.189, speed: 19, camera: CameraMode.Chase, input: { pedal: 1 } },
  'switchback-lean':    { t: 0.394, speed: 14, camera: CameraMode.Chase, input: { steer: 0.38, pedal: 0.4 } },
  'treeline-silhouette':{ t: 0.470, speed: 13, camera: CameraMode.Orbit, orbit: { yaw: 2.65, pitch: 0.06, dist: 16 } },
  'rockgarden-low':     { t: 0.559, speed: 13, camera: CameraMode.Orbit, orbit: { yaw: 0.60, pitch: -0.08, dist: 6.5 } },
  // Genuinely ballistic off the table, not parked in the air above it.
  // Placed on the run-in and ridden off the lip. No impulse.
  'tabletop-air':       { t: 0.6175, speed: 19, preroll: 271, camera: CameraMode.Chase, input: { airPitch: 0.22 } },
  // Placed just short of the hole (0.675) and launched, so the rider is
  // arcing OVER the ravine rather than standing next to it.
  // The harness settles 12 frames (0.2 s) before the shutter, which carries the
  // rider ~4 m. Spawn that far SHORT of the near lip so the shutter opens with
  // the rider over the hole and still rising.
  // KNOWN BAD: at 22 m/s the rider launches off the natural rollover before the
  // ravine, peaks at 7.7 m, and falls PAST the far lip into the hole,
  // accelerating to 150 km/h inside the mountain. The gap is not currently
  // clearable. Framed on the approach until the jump itself is fixed.
  'ravine-gap':         { t: 0.6665, speed: 22, preroll: 96, camera: CameraMode.Orbit, orbit: { yaw: 2.10, pitch: 0.26, dist: 9.5 } },
  'ridge-exposure':     { t: 0.757, speed: 16, camera: CameraMode.Orbit, orbit: { yaw: 0.20, pitch: 0.30, dist: 26 } },
  streambed:            { t: 0.849, speed: 12, camera: CameraMode.Chase },
  // Short of the line, so the gate is ahead of the rider and in frame.
  'finish-sprint':      { t: 0.955, speed: 20, camera: CameraMode.Chase, input: { pedal: 1 } },
  crash:                { t: 0.559, speed: 17, camera: CameraMode.Orbit, orbit: { yaw: 1.25, pitch: 0.18, dist: 8 }, crash: true },
  'valley-vista':       { t: 0.300, speed: 0,  camera: CameraMode.Orbit, orbit: { yaw: 0.0, pitch: 0.06, dist: 180, spin: 0 } },
  // The player hunting the pack, so the rivals are in the chase frustum.
  'pack-race':          { t: 0.205, speed: 19, camera: CameraMode.Chase, pack: 'ahead', input: { pedal: 1 } },
};

/** Motion setups: a situation plus the input held for the whole sequence. */
/**
 * Motion setups. Each is a DISTINCT run that contains its own event.
 *
 * They previously all pointed at a handful of shared situations and differed
 * only by an `input` field, which for the air sequences was inert because the
 * rider was never airborne. A motion review found the result: `landing`,
 * `tabletop-air` and `trick-360` were byte-for-intent the same capture (mean
 * absolute pixel difference 1.18 on 0-255), and so were `scree-speed` and
 * `pack-race`. Five of eight sequences were two runs.
 *
 * `preroll` is in 120 Hz physics steps and is the whole game here. Measured on
 * the tabletop: takeoff is 127 steps after the preroll finishes and the flight
 * lasts 46. A sequence settles 4 render frames (8 steps) before its first
 * shutter, so a preroll of 248 puts the takeoff about 8 captured frames in —
 * inside the window a reviewer is looking at, rather than before it.
 */
const SEQUENCES: Record<string, { from: string; input?: Partial<BikeInput>; preroll?: number }> = {
  launch:         { from: 'summit-rider', input: { pedal: 1 } },
  // 0.35, not 0.9. Full stick steers off a 3.7 m half-width ribbon in 0.9 s,
  // and every downstream "defect" measured in this capture followed from the
  // rider being off the trail and then in free fall down the side of it — a
  // frozen corner marker (the HUD reads a monotonic-max track projection),
  // -7.97 m/s^2 "coasting", +16.7 m/s^2 "acceleration" which was gravity. The
  // sequence is meant to show a switchback being carved, not a departure.
  switchback:     { from: 'switchback-lean', input: { steer: 0.35, pedal: 0.5 } },
  // Takeoff ~8 frames in, apex ~20, touchdown ~31.
  'tabletop-air': { from: 'tabletop-air', preroll: 248, input: { airPitch: 0.28 } },
  // Starts in the air so the whole capture is the descent, the touchdown and
  // the absorption chain that follows it.
  landing:        { from: 'tabletop-air', preroll: 286, input: { airPitch: 0.1 } },
  crash:          { from: 'crash' },
  'scree-speed':  { from: 'scree-speed', input: { pedal: 1 } },
  // Same launch, full yaw authority held — airYaw is inert on the ground and
  // takes hold the moment the wheels leave it.
  'trick-360':    { from: 'tabletop-air', preroll: 248, input: { airYaw: 1 } },
  'pack-race':    { from: 'pack-race', input: { pedal: 1 } },
};

const _v = new Vector3();
const _fwd = new Vector3();

export class Game {
  private engine: Engine;
  private input: Input;

  sky!: Sky;
  terrain!: Terrain;
  track!: Track;
  race!: RaceDirector;
  effects!: Effects;
  hud!: Hud;
  audio!: AudioEngine;
  post!: PostPipeline;

  private bikes: Bike[] = [];
  private captureControlled = false;
  /**
   * Frames left to suppress HUD popups for after a capture teleport.
   *
   * Jumping the player 700 m down the course crosses three checkpoints inside a
   * single physics step, so the race layer legitimately fires three split
   * popups at once and the HUD stacks them for their full 1.9 s life. That is
   * correct behaviour reacting to an event that never happens in play — it is
   * the review harness contaminating the thing it exists to review.
   */
  private suppressPopupFrames = 0;
  /** Physics steps until a scripted capture crash fires. 0 = none pending. */
  private pendingCrashSteps = 0;
  private scriptedInput: BikeInput | null = null;
  private debugOverlay = false;
  private headless: boolean;

  readonly capture: CaptureApi;

  constructor(engine: Engine, options: GameOptions) {
    this.engine = engine;
    this.input = new Input(window);
    this.headless = options.params.get('capture') === '1';

    this.capture = {
      takeControl: () => {
        this.captureControlled = true;
        this.input.setScripted(true);
        this.engine.stop();
        this.engine.setFixedPixelRatio(this.engine.stats.pixelRatio || 2);
        this.race?.forceRacing();
      },
      releaseControl: () => {
        this.captureControlled = false;
        this.scriptedInput = null;
        if (this.race) this.race.player.scripted = null;
        this.input.setScripted(false);
        this.engine.setFixedPixelRatio(null);
        this.engine.start();
      },
      step: (dt: number) => this.engine.stepManual(dt),
      setPose: (name: string) => this.applySituation(name),
      setSequence: (name: string) => {
        const s = SEQUENCES[name];
        if (!s) return false;
        if (!this.applySituation(s.from, s.preroll)) return false;
        if (s.input) this.setScripted(s.input);
        return true;
      },
      listPoses: () => Object.keys(SITUATIONS),
      listSequences: () => Object.keys(SEQUENCES),
      setDebugView: (view: string) => this.post?.setDebugView(view as PostDebugView),
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Build
  // ───────────────────────────────────────────────────────────────────────────

  async load(progress: (p: number, label?: string) => void): Promise<void> {
    const scene = this.engine.scene;
    const camera = this.engine.camera as PerspectiveCamera;

    progress(0.04, 'Generating textures');
    initGeneratedTextures(NPR);
    await frame();

    progress(0.10, 'Building sky');
    this.sky = new Sky();
    this.sky.buildShafts();
    scene.add(this.sky.group);
    await frame();

    // The mountain is the long pole: noise, then hydraulic erosion, then thermal
    // settling, then zone classification. It reports its own sub-progress.
    progress(0.14, 'Raising the mountain');
    this.terrain = await createTerrain({
      onProgress: (p: number, label?: string) => progress(0.14 + p * 0.46, label ?? 'Eroding'),
    });
    scene.add(this.terrain.object);
    await frame();

    progress(0.62, 'Cutting the trail');
    this.track = createTrack(this.terrain, { geometry: true, applyCarve: true });
    scene.add(this.track.object);
    await frame();

    progress(0.72, 'Compiling the NPR pipeline');
    this.post = new PostPipeline(this.engine.renderer, {
      width: this.engine.renderSize.x,
      height: this.engine.renderSize.y,
      lineScale: 1,
    });
    await frame();

    // Make the terrain's own zone ids authoritative for the line pass.
    //
    // LinesPass needs to know which material ids are PAINTED terrain zones,
    // because on those a material-id edge is a colour step and must never carry
    // a stroke — the terrain prepass writes its normal from the blurred normal
    // map and its depth from the rasteriser, so the two channels describe
    // different surfaces and an id edge there is paint, not geometry. It
    // otherwise rebuilds that list from the same `terrain:<name>` naming
    // convention TerrainMaterial uses, which is correct today and would drift
    // silently if either side were renamed. Handing it the real array closes
    // that.
    const zoneIds = this.terrain.materials?.shared?.uZoneIds?.value as number[] | undefined;
    if (zoneIds) this.post.lines.setPaintIds?.(zoneIds);

    progress(0.78, 'Effects');
    this.effects = createEffects({
      scene,
      camera,
      terrain: this.terrain,
      autoEmit: true,
    });
    await frame();

    progress(0.84, 'HUD and audio');
    this.hud = new Hud(this.engine.renderSize.x, this.engine.renderSize.y, {
      initialPhase: RacePhase.Attract,
    });
    this.audio = new AudioEngine({ autoTrigger: true, volume: this.headless ? 0 : 0.8 });
    await frame();

    progress(0.90, 'Riders');
    this.race = new RaceDirector({
      terrain: this.terrain,
      track: this.track,
      intent: this.input.intent,
      makeBike: (spec) => this.makeBike(spec),
      makeRig: (spec) => this.makeRig(spec),
      effects: this.effects,
      audio: this.audio,
      scene,
      enableGhost: !this.headless,
    });
    scene.add(this.race.object);

    // Two links that can only be made once both halves of a racer exist. The
    // factories are handed a spec, not each other, so neither can do this.
    //
    //  - the bike needs the racer's TrickState, or a tailwhip never spins the
    //    frame about the steerer;
    //  - the rig needs the bike's ANCHORS, or the hands IK to a fallback bar
    //    derived from BIKE_GEOM and stay put through every whip and bar twist.
    //    That fallback keeps a rider posable with no bike at all, which is what
    //    the capture harness wants, but it is wrong the moment there is a bike.
    for (const r of this.race.racers) {
      const b = r.bike as Bike;
      if (typeof b.linkTrick === 'function') b.linkTrick(r.trick);
      attachRigToBike(r.rig, r.bike);
    }

    this.effects.setSubject(this.race.player.bike.state);
    this.effects.cameraDirector.setReplaySource(this.race.replay);

    // The boom solver needs to know the pack exists. Without this the camera
    // has no idea other riders are there, and since they spawn 3.5/8.0/12.5 m
    // behind the player they sit directly ON the boom — which is what put an
    // opponent 3.7 m from the lens and filled the frame with a stranger's torso
    // while the actual subject was 7.8 m out. The director falls back to a
    // name-based scene scan without this, which works but is fragile.
    const occluders = this.race.racers
      .filter((r) => r !== this.race.player)
      .map((r) => r.bike.state);
    this.effects.cameraDirector.setOccluders?.(occluders);
    await frame();

    progress(0.97, 'Wiring loop');
    this.engine.onFixedUpdate((dt) => this.fixedUpdate(dt));
    this.engine.onRender((dt, alpha, elapsed) => this.render(dt, alpha, elapsed));
    this.engine.onResize((w, h) => this.resize(w, h));

    if (this.headless) this.race.forceRacing();
    else this.race.beginCountdown();

    progress(1.0, 'Ready');
  }

  private makeBike(spec: RacerSpec): IBike {
    const bike = createBike({
      terrain: this.terrain,
      frameColor: new Color(spec.frame),
      name: `bike:${spec.id}`,
      detail: spec.isPlayer ? 'full' : 'reduced',
      // The pack gets a little extra balance authority. Four AI riders falling
      // over on the first berm is not "they make mistakes", it is a bug that
      // looks like a design choice.
      stabilityBias: spec.isPlayer ? 0 : 0.35,
    });
    bike.setCameraRef(this.engine.camera);
    this.bikes.push(bike);
    return bike;
  }

  private makeRig(spec: RacerSpec): IRiderRig {
    return createRiderRig(spec);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Loop
  // ───────────────────────────────────────────────────────────────────────────

  private fixedUpdate(dt: number): void {
    if (this.pendingCrashSteps > 0 && --this.pendingCrashSteps === 0) {
      (this.race.player.bike as Bike).physics.forceCrash(0.82);
    }
    if (this.scriptedInput) this.race.player.scripted = this.scriptedInput;
    this.race.fixedUpdate(dt);
    // The visual layer needs to know whether the rider is driving the cranks;
    // the physics does not care, so it is passed separately rather than being
    // smuggled into BikeState.
    for (const r of this.race.racers) {
      const b = r.bike as Bike;
      const input = (r as unknown as { input?: BikeInput }).input;
      if (input && typeof b.noteInput === 'function') b.noteInput(input);
    }
  }

  private render(realDt: number, alpha: number, elapsed: number): void {
    this.input.update(realDt);
    this.handleUiInput();

    // Slow-mo and the impact-frame hold both live in the effects layer, and
    // everything downstream of here runs on the SCALED dt so a held frame holds
    // the animation, the dust and the camera together.
    const dt = this.effects.beginFrame(realDt);
    const camera = this.engine.camera as PerspectiveCamera;

    // 1. Bikes interpolate, rider rigs solve their IK onto the finished bikes.
    this.race.updateVisual(alpha, dt, elapsed);

    // 2. Camera reads the resolved player transform.
    const player = this.race.player.bike.state;
    this.effects.cameraDirector.update(player, dt, elapsed, realDt);

    // 3. FX follow the camera the director just placed.
    this.effects.update(dt, elapsed, camera, realDt);

    // 4. Readouts.
    const hudModel = this.race.getHudModel();
    if (this.suppressPopupFrames > 0) {
      this.suppressPopupFrames--;
      hudModel.popups.length = 0;
    }
    this.hud.update(hudModel, dt, elapsed);
    this.audio.setRiderInput(this.race.player.input);
    this.audio.update(player, (this.race.player.bike as Bike).physics.surface, dt);

    // 5. Globals, sky, streaming, then the whole pipeline.
    updateNprGlobals(elapsed, camera, this.engine.renderSize.x, this.engine.renderSize.y);
    this.sky.update(camera, this.sunVisibility());
    this.terrain.update(camera, dt);

    this.post.render(this.engine.scene, camera, dt, elapsed);
    this.hud.render(this.engine.renderer);

    decayPostState(realDt);
    this.input.clearEdges();
  }

  /**
   * How much of the sun disc is unobstructed, 0..1. Deliberately crude: it only
   * drives the intensity of the shafts and the sky's sun tint, and a real
   * occlusion query for that would cost more than the effect is worth.
   */
  private sunVisibility(): number {
    const cam = this.engine.camera;
    const h = this.terrain.heightAt(cam.position.x, cam.position.z);
    return clamp01(0.25 + (cam.position.y - h) * 0.02 + h / 900);
  }

  private handleUiInput(): void {
    if (this.captureControlled) return;
    const b = this.input.intent.buttons;
    if (b.pause.justPressed) {
      if (this.race.phase === RacePhase.Paused) this.race.resume();
      else this.race.pause();
    }
    if (b.restart.justPressed) this.race.restart();
    if (b.toggleDebug.justPressed) {
      this.debugOverlay = !this.debugOverlay;
      this.post.setDebugView(this.debugOverlay ? 'lines' : 'off');
    }
  }

  private resize(width: number, height: number): void {
    this.post?.resize(width, height);
    this.hud?.resize(width, height);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Capture
  // ───────────────────────────────────────────────────────────────────────────

  private applySituation(name: string, prerollOverride?: number): boolean {
    const s = SITUATIONS[name];
    if (!s || !this.race) return false;

    this.race.forceRacing();
    this.scriptedInput = null;
    this.race.player.scripted = null;

    // Put every racer on the course at this point, the player leading and the
    // pack fanned out behind, so a wide shot has a race in it rather than one
    // rider and three dots still on the start line.
    const total = this.track.length;
    const racers = this.race.racers;
    for (let i = 0; i < racers.length; i++) {
      const r = racers[i];
      const bike = r.bike as Bike;
      const isPlayer = r === this.race.player;
      // Opponents go BEYOND the camera boom, never inside it.
      //
      // 3.5 m was the old first-rival offset and the chase boom settles around
      // 4.8 m behind the player — so the harness was parking a rival almost
      // exactly where the camera lives. Every chase capture had an opponent
      // filling a screen quadrant, near-plane-clipped, while the actual subject
      // was a 110 px figure behind it. The camera's own occluder avoidance
      // cannot help: there is nowhere for a 4.8 m boom to go that is not inside
      // a rider standing 3.5 m away. Real race spacing is metres, not
      // centimetres, and the review set has to show the race the player sees.
      const ahead = s.pack === 'ahead';
      const back = isPlayer ? 0 : (ahead ? -(9 + i * 7) : 12 + i * 6.5);
      const d = Math.max(1, Math.min(total - 2, s.t * total - back));
      const sample = this.track.sampleAtDistance(d);

      _v.copy(sample.position);
      // Spawn the pack ON the racing line, not fanned off it.
      //
      // A 2.4 m lateral offset put the AI's lateral-correction term into
      // saturation: it held full opposite lock for the whole capture, its
      // offset GREW from 2.4 m to 5.9 m, and it scrubbed 68 km/h down to 13
      // doing it. Whether the root cause is a sign disagreement between this
      // offset and the tracker's convention or simply an over-strong gain, the
      // fan was cosmetic and the correct start for a racing line is on it. They
      // separate naturally through their own line preferences.
      void isPlayer;
      _fwd.copy(sample.tangent);

      // Spawn on whichever surface is HIGHER: the ribbon mesh or the
      // heightfield under it.
      //
      // The physics collides with the heightfield; the ribbon is only what you
      // see. They currently disagree by as much as 8 m (measured: scree +1.06
      // to +2.15, tabletop -7.92 to +1.89, streambed -4.22 to +3.15), so
      // spawning on the ribbon buried the bike 1-2.5 m underground in half the
      // poses and dropped it 5 m in others. Taking the max means a pose is
      // never spawned inside the mountain — the bike settles the short distance
      // instead of exploding out of it. This is a GUARD, not the fix: the carve
      // needs to make the two agree, and that is tracked separately.
      // Spawn relative to the surface the WHEELS COLLIDE WITH.
      //
      // The ribbon mesh sits 0.18 m proud of the heightfield by design, and the
      // physics rides the heightfield. Spawning on the ribbon therefore left the
      // bike 0.15 m in the air, so frame 0 of every sequence had neither wheel
      // grounded and emitted no dust — a defect an FX reviewer correctly saw and
      // could not have fixed, because it is not in the FX.
      //
      // The guard is for the ravine, where the terrain is genuinely 13 m below
      // the ribbon because that IS the gap. Past a metre and a half of
      // disagreement, trust the ribbon rather than spawn into the hole.
      const groundY = this.terrain.heightAt(_v.x, _v.z);
      if (Math.abs(groundY - _v.y) < 1.5 || groundY > _v.y) _v.y = groundY;

      // `sample.position` is the ribbon SURFACE, and the bike's origin is on
      // the AXLE LINE — one wheel radius above whatever it is standing on.
      // Spawning the origin at the surface buried both wheels 0.27 m in the
      // ground; the suspension answered with a 14 kN spring force and launched
      // the bike, so every capture pose was shot from a rider who had been
      // flung into the air on frame one. That is why no pose ever showed dust:
      // the wheels were never touching. Less a little static sag so the springs
      // settle instead of visibly dropping.
      _v.y += BIKE.wheelRadius - 0.03 + (s.lift ?? 0);

      bike.reset(_v, _fwd);
      bike.state.velocity.copy(_fwd).multiplyScalar(s.speed);

      // Tell the racer where it now is. Without this its track tracker keeps
      // the distance it had before the teleport, so an AI wakes up steering
      // toward a target hundreds of metres behind it — the pack covered 0 m in
      // 40 s and sat 97% off-track from frame zero.
      (r as unknown as { reseat?: (p: Vector3, d?: number) => void }).reseat?.(_v, d);
      if (s.launch) bike.state.velocity.y += s.launch;
    }

    const dir = this.effects.cameraDirector;
    dir.mode = s.camera;
    if (s.camera === CameraMode.Orbit && s.orbit) {
      dir.setOrbit(s.orbit.yaw, s.orbit.pitch, s.orbit.dist, s.orbit.spin ?? 0.35);
    }
    dir.resetTo(this.race.player.bike.state);

    // Wipe every stateful effect before the situation is set up.
    //
    // The harness shoots all 16 poses in ONE page, 12 settle frames apart. Any
    // FX that latches therefore leaks from one review frame into the next, and
    // that is invisible to a single-pose capture — which is how a motion smear
    // pinned at 0.821 by the `crash` pose came to dissolve the rider in
    // `rider-closeup`, a pose that asks for 0.0. The reviewer sees a defect in
    // a frame whose own state is innocent. Any stateful system added here later
    // needs to be wiped in this call too.
    this.effects.reset();

    // Ride into the situation rather than being dropped into it.
    // Make the CLOCK agree with the position we teleported to.
    //
    // A capture jumps the player straight to a fraction of the course without
    // riding there, so the elapsed timer stayed near zero: the review set had
    // frames reading DESCENT PROFILE 96% at 72 km/h beside TIME 0:00.19. A
    // reviewer judging composition and readability is entitled to a frame whose
    // own HUD is internally consistent, and a nonsense clock is a defect they
    // will and did report. Estimated from the distance covered at a nominal
    // pace rather than simulated, because simulating 3.8 km per pose would cost
    // minutes per capture run.
    const NOMINAL_PACE = 17.5; // m/s averaged over the descent
    const covered = s.t * this.track.length;
    this.race.raceTime = COUNTDOWN_SECONDS + covered / NOMINAL_PACE;
    for (const r of this.race.racers) r.progress.raceTime = this.race.elapsed;

    const preroll = prerollOverride ?? s.preroll ?? 0;
    for (let i = 0; i < preroll; i++) this.race.fixedUpdate(1 / 120);

    // Swallow the checkpoint splits the teleport just crossed, and wipe any
    // popup already on screen from the previous pose.
    this.suppressPopupFrames = 4;
    this.hud.resetRun();

    // Deferred, so the impact lands INSIDE the captured window.
    //
    // It used to fire here, which is before the preroll and before the
    // harness's settle frames — so `crashCount` was already 1 at f0000 and the
    // flash, the freeze and the camera push-in had all burned off screen. The
    // sequence whose entire purpose is to show an impact never contained one.
    // Counted in 120 Hz steps: 8 for the harness settle plus ~20 to put the hit
    // about ten captured frames in.
    this.pendingCrashSteps = s.crash ? 28 : 0;

    if (s.input) this.setScripted(s.input);
    return true;
  }

  private setScripted(partial: Partial<BikeInput>): void {
    this.scriptedInput = {
      steer: 0, pedal: 0, brakeRear: 0, brakeFront: 0, crouch: 0, pitchLean: 0,
      airPitch: 0, airYaw: 0, airRoll: 0, wantBoost: false, wantHop: false,
      ...partial,
    };
    if (this.race) this.race.player.scripted = this.scriptedInput;
  }

  dispose(): void {
    this.input.dispose();
    this.race?.dispose();
    this.effects?.dispose();
    this.hud?.dispose();
    this.audio?.dispose();
    this.track?.dispose();
    this.terrain?.dispose();
    this.post?.dispose();
    this.sky?.dispose();
  }
}

function frame(): Promise<void> {
  return new Promise((res) => requestAnimationFrame(() => res()));
}

/** Re-exported so main.ts does not need to know where the palette lives. */
export { RIDER_COLORS, POST_STATE };
