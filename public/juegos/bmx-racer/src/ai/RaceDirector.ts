/**
 * RaceDirector — the race itself.
 *
 * Owns the state machine, the grid, the four racers, the ghost, the replay, and
 * the one HudModel the HUD reads. It is the only thing in the game that knows
 * who is winning.
 *
 * Design notes worth reading before changing anything:
 *
 *  • GAPS ARE TIMES, NOT DISTANCES. A straight-line distance between two riders
 *    on a switchback reads as 12m when they are 90m apart along the ribbon, and
 *    the HUD would flicker between "0.5s" and "6s" every corner. Everything here
 *    works in distance-along-track, converted to seconds using the TRAILING
 *    rider's speed — which is the definition a stopwatch at a fixed point on the
 *    course would give you.
 *
 *  • THE RUBBER BAND IS ±6% AND YOU SHOULD NOT BE ABLE TO FEEL IT. It is a
 *    multiplier on the AI's planned target speed, half-life smoothed over 1.6s,
 *    with a 25m dead zone so a genuine wheel-to-wheel fight is never assisted,
 *    and it is switched off entirely for the first 6 seconds and once the player
 *    has finished. See RUBBER_BAND below for the exact numbers.
 *
 *  • COLLISIONS ARE RESOLVED HERE, not in the bike physics, because the bikes do
 *    not know about each other. Riders exchange a real impulse and are both
 *    knocked off line; nobody passes through anybody.
 */

import { Object3D, Vector3 } from 'three';

import {
  BikeMode,
  Checkpoint,
  HudModel,
  IAudio,
  IBike,
  IEffects,
  IRacer,
  IRiderRig,
  ITerrain,
  ITrack,
  RaceContext,
  RacePhase,
  RacerProgress,
  TrackSampleResult,
  TrickKind,
} from '../game/Contracts';
import { BIKE, COUNTDOWN_SECONDS, RACER_COUNT, START_SPACING } from '../game/WorldConstants';
import { RIDER_COLORS } from '../npr/Palette';
import { RiderIntent } from '../core/Input';
import { Rng, WORLD_SEED } from '../core/RNG';
import { clamp, clamp01, dampHL } from '../core/MathX';
import { AIRider } from './AIRider';
import { PlayerRacer } from './PlayerRacer';
import { DEFAULT_GRID, PERSONALITIES, PersonalityKind } from './Personality';
import { Ghost, GhostVisual } from './Ghost';
import { Replay } from './Replay';

// ── Scratch ──────────────────────────────────────────────────────────────────
const _v0 = new Vector3();
const _v1 = new Vector3();
const _n = new Vector3();

// ── Tuning ───────────────────────────────────────────────────────────────────

/**
 * Stuck detection, in `rescueStuck`. Long enough that a rider fighting for
 * traction out of a slow corner, or picking a line through the rock garden, is
 * never yanked off it — a genuinely stuck rider shows 0-2 km/h and no distance
 * at all, which is nothing like a slow one.
 */
/** Metres of trail kept between the outermost grid slot and the edge. */
const GRID_EDGE_MARGIN = 1.0;

const STUCK_SECONDS = 4.5;
/** Metres of course that count as "still going". */
const STUCK_PROGRESS = 1.5;
/** Placed this far ahead, so they do not drop straight back into the trap. */
const STUCK_NUDGE = 12;
/** Rolling, not stationary: m/s. */
const STUCK_SPEED = 7;

export const RUBBER_BAND = {
  /** Maximum speed multiplier deviation. ±6%. */
  maxDeviation: 0.06,
  /** Gap, in metres, at which the band saturates. */
  saturationGap: 130,
  /** Gaps below this get no assistance at all — close racing stays honest. */
  deadZone: 25,
  /** Half-life of the smoothing, seconds. Slow enough to be imperceptible. */
  halfLife: 1.6,
  /** No band at all for this long after the gun. */
  graceSeconds: 6,
  /**
   * Asymmetry. A trailing AI is helped by the full amount; a leading AI is only
   * slowed by 70% of it, because "the leader mysteriously waits for you" is far
   * more noticeable than "the tail-ender hangs on".
   */
  leadScale: 0.7,
};

/** Combined collision radius of two bikes in the horizontal plane, metres. */
const CONTACT_RADIUS = 1.28;
/** Vertical separation beyond which two riders are simply not in contact. */
const CONTACT_HEIGHT = 1.9;
/** Restitution of a rider-to-rider hit. Low: bikes are not billiard balls. */
const CONTACT_RESTITUTION = 0.32;
/** Seconds between contact sound/FX triggers for a given pair. */
const CONTACT_COOLDOWN = 0.35;

/** Samples in the HUD's route elevation profile. */
const PROFILE_SAMPLES = 128;

/** Seconds spent on the finish flourish before the results screen. */
const FINISH_HOLD = 3.0;

/** How far ahead the HUD's corner preview looks, metres. */
const CORNER_PREVIEW_RANGE = 150;

// ── Factories supplied by the orchestrator ───────────────────────────────────

export interface RacerSpec {
  id: string;
  name: string;
  colorIndex: number;
  isPlayer: boolean;
  isGhost: boolean;
  /** Palette colours for this rider, straight from RIDER_COLORS. */
  jersey: number;
  accent: number;
  frame: number;
  /** Where the racer starts, and which way it faces. */
  position: Vector3;
  forward: Vector3;
}

export type BikeFactory = (spec: RacerSpec) => IBike;
export type RigFactory = (spec: RacerSpec) => IRiderRig;

export interface RaceDeps {
  terrain: ITerrain;
  track: ITrack;
  /** The player's smoothed input, from core/Input. */
  intent: RiderIntent;
  makeBike: BikeFactory;
  makeRig: RigFactory;
  effects?: IEffects;
  audio?: IAudio;
  /** Parent for every racer's scene node. Defaults to the director's own group. */
  scene?: Object3D;
  seed?: number;
  racerCount?: number;
  /** Override the personality grid. Defaults to clean / aggressive / erratic. */
  personalities?: PersonalityKind[];
  /** Set false to skip building the ghost rider entirely (capture harness). */
  enableGhost?: boolean;
  ghostKey?: string;
}

// ─────────────────────────────────────────────────────────────────────────────

export class RaceDirector {
  readonly object = new Object3D();
  readonly racers: IRacer[] = [];
  readonly aiRiders: AIRider[] = [];
  readonly ghost: Ghost;
  readonly replay = new Replay();

  private _player!: PlayerRacer;
  /** The human. Always present; the grid always has exactly one player slot. */
  get player(): PlayerRacer {
    return this._player;
  }

  phase: RacePhase = RacePhase.Attract;
  /** Seconds since the countdown began. The gun is at COUNTDOWN_SECONDS. */
  raceTime = 0;
  /** Seconds since the gun. Negative during the countdown. */
  get elapsed(): number {
    return this.raceTime - COUNTDOWN_SECONDS;
  }

  private terrain: ITerrain;
  private track: ITrack;
  private effects?: IEffects;
  private audio?: IAudio;
  private rng: Rng;

  private ctx: RaceContext;
  private standings: RacerProgress[] = [];
  private smoothedSpeed: number[] = [];
  private bandValue: number[] = [];
  private contactCooldown: number[] = [];
  /** Per-AI stuck detection. See `rescueStuck`. */
  private stuckTime: number[] = [];
  private stuckMark: number[] = [];
  /** How many times a rider had to be put back on the trail this race. */
  rescues = 0;
  /** racers[i].progress, in racer order. Used to map a progress back to an index. */
  private progressOrder: RacerProgress[] = [];
  private lastCountdownBeep = -1;
  private finishHold = 0;
  private started = false;

  private hud: HudModel;
  private popups: HudModel['popups'] = [];
  private hudSplits: HudModel['splits'] = [];
  private cornerPreview = { curvature: 0, distance: 0 };
  private routeProfile = new Float32Array(PROFILE_SAMPLES);
  private scratchSample: TrackSampleResult;
  private checkpoints: Checkpoint[];

  constructor(deps: RaceDeps) {
    this.terrain = deps.terrain;
    this.track = deps.track;
    this.effects = deps.effects;
    this.audio = deps.audio;
    this.rng = new Rng(deps.seed ?? WORLD_SEED).fork('race');
    this.object.name = 'race';
    this.scratchSample = deps.track.sampleAtDistance(0);
    this.checkpoints = deps.track.checkpoints ?? [];

    const count = clamp(deps.racerCount ?? RACER_COUNT, 1, RIDER_COLORS.length);
    const grid = deps.personalities ?? DEFAULT_GRID;

    // ── Grid ────────────────────────────────────────────────────────────────
    // Riders abreast on the start line, the player second from the left, with
    // the outer riders set back a touch so the gate reads as a chevron rather
    // than a ruler. Deterministic — the capture harness needs the same grid.
    const start = this.track.sampleAtDistance(0, this.scratchSample);
    const playerSlot = Math.min(1, count - 1);
    const startForward = start.tangent.clone();

    let aiIndex = 0;
    for (let slot = 0; slot < count; slot++) {
      const isPlayer = slot === playerSlot;
      const lane = slot - (count - 1) / 2;
      const setback = Math.abs(lane) * 1.1;

      // Fit the grid to the TRAIL, never to a fixed spacing.
      //
      // START_SPACING is 2.1 m, so four riders sit at -3.15, -1.05, +1.05 and
      // +3.15 — and the trail's half-width on the start line is 3.55 m. The
      // outer two therefore began 40 cm from the edge, which is less than half
      // a handlebar, and the first steering input of the race put them over it.
      // A player watching the start saw a rival simply ride off to the left and
      // fall over before the clock reached 1.3 s.
      //
      // The grid is squeezed to keep every rider a full bike inside the edge,
      // and only ever squeezed — a wide start line still uses the authored
      // spacing.
      const halfSpan = (count - 1) / 2;
      const usable = Math.max(start.halfWidth - GRID_EDGE_MARGIN, 0.6);
      const spacing = halfSpan > 0 ? Math.min(START_SPACING, usable / halfSpan) : START_SPACING;

      _v0.copy(start.position)
        .addScaledVector(start.left, lane * spacing)
        .addScaledVector(start.tangent, -setback);
      // A small lift; the bike's own reset settles it onto the ground.
      _v0.y += 0.35;

      const colorIndex = isPlayer ? 0 : 1 + aiIndex;
      const colors = RIDER_COLORS[Math.min(colorIndex, RIDER_COLORS.length - 1)];
      const personality = isPlayer ? null : PERSONALITIES[grid[aiIndex % grid.length]];

      const spec: RacerSpec = {
        id: isPlayer ? 'player' : `ai${aiIndex}`,
        // Name AND colours both come from RIDER_COLORS, always.
        //
        // The name used to come from the PERSONALITY while the chip colour came
        // from RIDER_COLORS[1 + aiIndex] — two independent lists that only
        // agree by coincidence. DEFAULT_GRID is [Clean, Aggressive, Erratic]
        // and the colour table is [player, kestrel, mags, okoye], so the first
        // AI took Clean's name with kestrel's blue chip: the leaderboard drew
        // MAGS in blue and KESTREL in yellow in every single frame of the
        // review set. A rider's identity is one thing; personality supplies
        // behaviour and nothing else.
        name: colors.name,
        colorIndex,
        isPlayer,
        isGhost: false,
        jersey: colors.jersey.getHex(),
        accent: colors.accent.getHex(),
        frame: colors.frame.getHex(),
        position: _v0.clone(),
        forward: startForward.clone(),
      };

      const bike = deps.makeBike(spec);
      const rig = deps.makeRig(spec);
      rig.setJerseyColor(spec.jersey, spec.accent);

      const init = {
        id: spec.id,
        name: spec.name,
        colorIndex,
        bike,
        rig,
        terrain: this.terrain,
        track: this.track,
        checkpointCount: this.checkpoints.length,
        startPosition: spec.position,
        startForward: spec.forward,
        phase: slot / Math.max(count, 1),
      };

      if (isPlayer) {
        const p = new PlayerRacer({ ...init, intent: deps.intent });
        this.racers.push(p);
        this._player = p;
      } else {
        const ai = new AIRider({
          ...init,
          personality: personality!,
          rng: this.rng.fork(`rider:${spec.id}`),
          index: slot,
        });
        this.racers.push(ai);
        this.aiRiders.push(ai);
        aiIndex++;
      }
    }

    if (!this._player) throw new Error('[race] no player slot on the grid');

    const parent = deps.scene ?? this.object;
    for (const r of this.racers) {
      if (r.object.parent !== parent) parent.add(r.object);
      this.smoothedSpeed.push(0);
      this.bandValue.push(1);
      this.standings.push(r.progress);
      this.progressOrder.push(r.progress);
    }
    for (let i = 0; i < this.aiRiders.length; i++) {
      this.stuckTime.push(0);
      this.stuckMark.push(0);
    }

    this.contactCooldown = new Array((count * (count - 1)) / 2).fill(0);

    // ── Ghost ───────────────────────────────────────────────────────────────
    this.ghost = new Ghost({
      trackLength: this.track.length,
      storageKey: deps.ghostKey ?? `descent.ghost.v1.${(deps.seed ?? WORLD_SEED) >>> 0}`,
    });
    this.object.add(this.ghost.object);
    void this.ghost.load();

    if (deps.enableGhost !== false) {
      const gcolors = RIDER_COLORS[0];
      const gspec: RacerSpec = {
        id: 'ghost',
        name: 'GHOST',
        colorIndex: 0,
        isPlayer: false,
        isGhost: true,
        jersey: gcolors.jersey.getHex(),
        accent: gcolors.accent.getHex(),
        frame: gcolors.frame.getHex(),
        position: this.player.bike.state.position.clone(),
        forward: startForward.clone(),
      };
      try {
        const gbike = deps.makeBike(gspec);
        const grig = deps.makeRig(gspec);
        const gvis: GhostVisual = { object: new Object3D(), rig: grig, bike: gbike };
        gvis.object.name = 'ghost:visual';
        if (!gbike.object.parent) gvis.object.add(gbike.object);
        if (!grig.object.parent) gvis.object.add(grig.object);
        this.ghost.attachVisual(gvis);
      } catch (e) {
        // A ghost that fails to build must never take the race down with it.
        console.warn('[race] ghost visual unavailable', e);
      }
    }

    // ── Reusable HUD model ──────────────────────────────────────────────────
    this.buildRouteProfile();
    for (let i = 0; i < this.checkpoints.length; i++) {
      this.hudSplits.push({ index: i, time: null, delta: null });
    }
    this.hud = {
      phase: this.phase,
      speedKmh: 0,
      position: 1,
      racerCount: count,
      raceTime: 0,
      boost: 0,
      boosting: false,
      trickScore: 0,
      activeTrick: null,
      popups: this.popups,
      routeProgress: 0,
      splits: this.hudSplits,
      gapAhead: null,
      gapBehind: null,
      cornerPreview: null,
      wrongWay: false,
      countdown: null,
      standings: this.standings,
      routeProfile: this.routeProfile,
      ghostDelta: null,
    };

    this.ctx = {
      terrain: this.terrain,
      track: this.track,
      racers: this.racers,
      phase: this.phase,
      raceTime: 0,
      leaderDistance: 0,
      dt: 1 / 120,
    };

    this.resetRace();
  }

  // ── Phase control ─────────────────────────────────────────────────────────

  /** Attract → Countdown. Idempotent. */
  beginCountdown(): void {
    if (this.phase === RacePhase.Countdown || this.phase === RacePhase.Racing) return;
    this.resetRace();
    this.phase = RacePhase.Countdown;
    this.raceTime = 0;
    this.lastCountdownBeep = -1;
  }

  /** Skip the countdown — used by the capture harness. */
  forceRacing(): void {
    this.resetRace();
    this.phase = RacePhase.Racing;
    this.raceTime = COUNTDOWN_SECONDS;
    this.started = true;
    this.ghost.beginRecording();
  }

  restart(): void {
    this.resetRace();
    this.phase = RacePhase.Countdown;
    this.raceTime = 0;
    this.lastCountdownBeep = -1;
  }

  pause(): void {
    if (this.phase === RacePhase.Racing || this.phase === RacePhase.Countdown) this.phase = RacePhase.Paused;
  }

  resume(): void {
    if (this.phase === RacePhase.Paused) this.phase = this.started ? RacePhase.Racing : RacePhase.Countdown;
  }

  private resetRace(): void {
    for (const r of this.racers) r.reset();
    for (let i = 0; i < this.smoothedSpeed.length; i++) {
      this.smoothedSpeed[i] = 0;
      this.bandValue[i] = 1;
    }
    for (let i = 0; i < this.stuckTime.length; i++) {
      this.stuckTime[i] = 0;
      this.stuckMark[i] = 0;
    }
    this.rescues = 0;
    for (let i = 0; i < this.contactCooldown.length; i++) this.contactCooldown[i] = 0;
    for (const s of this.hudSplits) {
      s.time = null;
      s.delta = null;
    }
    this.popups.length = 0;
    this.replay.clear();
    this.raceTime = 0;
    this.finishHold = 0;
    this.started = false;
    this.ghost.delta = null;
  }

  // ── The fixed-step tick ───────────────────────────────────────────────────

  /**
   * Call once per PHYSICS step from Engine.onFixedUpdate. Everything in the race
   * — inputs, physics, collisions, progress, splits — happens here at a fixed
   * rate, so the outcome is identical regardless of render frame rate.
   */
  fixedUpdate(dt: number): void {
    const ctx = this.ctx;
    ctx.phase = this.phase;
    ctx.dt = dt;

    if (this.phase === RacePhase.Paused) return;

    if (this.phase === RacePhase.Countdown) {
      this.raceTime += dt;
      this.tickCountdown();
    } else if (this.phase === RacePhase.Racing || this.phase === RacePhase.Finished) {
      this.raceTime += dt;
    }

    ctx.raceTime = this.raceTime;
    ctx.leaderDistance = this.standings.length > 0 ? this.standings[0].distance : 0;

    // ── Step every racer ─────────────────────────────────────────────────────
    for (let i = 0; i < this.racers.length; i++) {
      const r = this.racers[i];
      r.update(dt, ctx);
      const input = r.gatherInput(dt, ctx);
      r.bike.step(input, dt);
      (r as unknown as { postStep(dt: number): void }).postStep(dt);
    }

    this.resolveContacts(dt);
    this.updateProgress(dt);
    this.updateRubberBand(dt);
    this.rescueStuck(dt);

    // ── Recording ────────────────────────────────────────────────────────────
    if (this.phase === RacePhase.Racing || this.phase === RacePhase.Finished) {
      const t = Math.max(0, this.elapsed);
      const pst = this.player.bike.state;
      this.replay.currentTrick = this.player.trick.kind;
      this.replay.record(t, pst);
      this.ghost.record(t, pst, this.player.progress.distance, this.player.trick.kind);
      this.ghost.updateDelta(this.player.progress.distance, t);
    }

    if (this.phase === RacePhase.Finished) {
      this.finishHold += dt;
      if (this.finishHold >= FINISH_HOLD) this.phase = RacePhase.Results;
    }
  }

  private tickCountdown(): void {
    const remaining = COUNTDOWN_SECONDS - this.raceTime;
    const beep = Math.ceil(remaining);
    if (beep !== this.lastCountdownBeep && beep >= 1 && remaining > 0) {
      this.lastCountdownBeep = beep;
      this.audio?.playUi('tick');
    }
    if (remaining <= 0) {
      this.phase = RacePhase.Racing;
      this.started = true;
      this.audio?.playStartHorn(1);
      this.ghost.beginRecording();
      this.replay.clear();
    }
  }

  // ── Contacts ──────────────────────────────────────────────────────────────

  /**
   * Rider-to-rider collision. Equal masses, so the impulse split is symmetric;
   * the positional correction is split symmetrically too, which means neither
   * rider "wins" a contact by virtue of update order.
   *
   * The yaw kick is the part that matters for feel: a clean push-apart just
   * translates two riders and looks like magnetism. Adding an angular impulse
   * proportional to the off-centre component of the contact is what makes a
   * shoulder-to-shoulder bump actually knock somebody off their line.
   */
  private resolveContacts(dt: number): void {
    const n = this.racers.length;
    let pair = 0;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++, pair++) {
        if (this.contactCooldown[pair] > 0) this.contactCooldown[pair] -= dt;

        const a = this.racers[i].bike.state;
        const b = this.racers[j].bike.state;
        if (a.mode === BikeMode.Finished || b.mode === BikeMode.Finished) continue;

        _v0.copy(b.position).sub(a.position);
        if (Math.abs(_v0.y) > CONTACT_HEIGHT) continue;
        const dx = _v0.x;
        const dz = _v0.z;
        const distSq = dx * dx + dz * dz;
        if (distSq > CONTACT_RADIUS * CONTACT_RADIUS) continue;

        const dist = Math.sqrt(distSq);
        if (dist < 1e-4) {
          // Perfectly co-located (a respawn overlap). Push apart along the track.
          _n.set(1, 0, 0);
        } else {
          _n.set(dx / dist, 0, dz / dist);
        }
        const overlap = CONTACT_RADIUS - dist;

        // Positional correction, split, with a Baumgarte-style relaxation factor
        // so we do not snap riders apart in one step.
        const push = overlap * 0.5 * 0.6;
        a.position.addScaledVector(_n, -push);
        b.position.addScaledVector(_n, push);

        // Relative velocity along the contact normal.
        _v1.copy(b.velocity).sub(a.velocity);
        const approach = _v1.x * _n.x + _v1.z * _n.z;
        if (approach < 0) {
          const m = BIKE.mass;
          // Equal masses: reduced mass = m/2.
          const jImp = (-(1 + CONTACT_RESTITUTION) * approach * m) / 2;
          const dv = jImp / m;
          a.velocity.addScaledVector(_n, -dv);
          b.velocity.addScaledVector(_n, dv);

          // Yaw kick — the knock off line. Sign follows which side of each other
          // they hit on, scaled by the impact strength.
          const kick = clamp(-approach * 0.10, 0, 0.85);
          const side = Math.sign(_n.x * a.velocity.z - _n.z * a.velocity.x) || 1;
          a.angularVelocity.y -= kick * side;
          b.angularVelocity.y += kick * side;

          const severity = clamp01(-approach / 7);
          if (severity > 0.12 && this.contactCooldown[pair] <= 0) {
            this.contactCooldown[pair] = CONTACT_COOLDOWN;
            this.audio?.playImpact(severity * 0.7, a.rear.surface);
            if (severity > 0.45) {
              this.effects?.impactFrame(severity * 0.6);
              _v0.copy(a.position).lerp(b.position, 0.5);
              _v1.copy(_n).multiplyScalar(-approach);
              this.effects?.dustBurst(_v0, UP_Y, _v1, severity * 0.8, a.rear.surface);
            }
          }
        }
      }
    }
  }

  // ── Progress, positions, gaps, splits ─────────────────────────────────────

  private updateProgress(dt: number): void {
    const racing = this.phase === RacePhase.Racing || this.phase === RacePhase.Finished;
    const t = Math.max(0, this.elapsed);

    for (let i = 0; i < this.racers.length; i++) {
      const r = this.racers[i];
      const p = r.progress;
      const st = r.bike.state;

      // Monotonic distance: going backwards must not reduce your progress, or a
      // rider who overshoots a switchback and reverses gains a position.
      const d = (r as unknown as { trackDistance: number }).trackDistance;
      if (d > p.distance) p.distance = d;

      if (racing && !p.finished) p.raceTime = t;
      this.smoothedSpeed[i] = dampHL(this.smoothedSpeed[i], st.speed, 0.35, dt);

      if (st.crashedThisStep) {
        p.crashCount++;
        if (r.progress.isPlayer) this.pushPopup('CRASH', 0, 'warning');
      }

      if (racing && !p.finished) this.checkSplits(r, p, t);
    }

    // ── Order ────────────────────────────────────────────────────────────────
    // Finished racers sort by their finish time and always rank ahead of anyone
    // still on the mountain.
    this.standings.sort(compareProgress);
    for (let k = 0; k < this.standings.length; k++) {
      const p = this.standings[k];
      p.position = k + 1;
      if (k === 0) {
        p.gapAhead = null;
      } else {
        const ahead = this.standings[k - 1];
        p.gapAhead = this.gapSeconds(ahead, p);
      }
    }
  }

  /**
   * Gap from `behind` to `ahead`, in seconds.
   *
   * The reference speed is the TRAILING rider's smoothed speed with a floor: gap
   * means "how long until I reach the point they are at now", so it must be my
   * speed, not theirs, and it must not blow up to infinity when I am stopped.
   */
  private gapSeconds(ahead: RacerProgress, behind: RacerProgress): number {
    if (ahead.finished && behind.finished && ahead.finishTime !== null && behind.finishTime !== null) {
      return behind.finishTime - ahead.finishTime;
    }
    const dd = Math.max(0, ahead.distance - behind.distance);
    let idx = -1;
    for (let i = 0; i < this.progressOrder.length; i++) {
      if (this.progressOrder[i] === behind) {
        idx = i;
        break;
      }
    }
    const ref = Math.max(idx >= 0 ? this.smoothedSpeed[idx] : 0, 5.5);
    return dd / ref;
  }

  private checkSplits(r: IRacer, p: RacerProgress, t: number): void {
    for (let c = 0; c < this.checkpoints.length; c++) {
      if (p.splits[c] !== null) continue;
      const cp = this.checkpoints[c];
      if (p.distance < cp.distance) break; // checkpoints are ordered
      p.splits[c] = t;

      if (p.isPlayer) {
        const g = this.ghost.data;
        const gsplit = g && c < g.splits.length ? g.splits[c] : null;
        const hs = this.hudSplits[c];
        if (hs) {
          hs.time = t;
          hs.delta = gsplit !== null && gsplit !== undefined ? t - gsplit : null;
        }
        if (!cp.isFinish) {
          this.audio?.playUi('checkpoint');
          this.pushPopup('SPLIT', hs?.delta ?? 0, 'split');
        }
      }

      if (cp.isFinish) this.finishRacer(r, p, t);
    }

    // Belt and braces: a rider who somehow ran past the finish gate without the
    // checkpoint firing still finishes.
    if (!p.finished && p.distance >= this.track.length - 0.5) this.finishRacer(r, p, t);
  }

  private finishRacer(r: IRacer, p: RacerProgress, t: number): void {
    if (p.finished) return;
    p.finished = true;
    p.finishTime = t;
    r.bike.state.mode = BikeMode.Finished;

    if (p.isPlayer) {
      this.player.justFinished = true;
      this.phase = RacePhase.Finished;
      this.finishHold = 0;
      const result = this.ghost.finishRecording(t, p.trickScore, p.crashCount);
      this.audio?.playUi('confirm');
      if (result.isBest) {
        this.pushPopup(result.previous === null ? 'FIRST RUN' : 'NEW BEST', 0, 'combo');
      }
    }
  }

  // ── Rubber band ───────────────────────────────────────────────────────────

  /**
   * A multiplier on each AI's planned target speed, in [1-0.06, 1+0.06].
   *
   * Deliberately applied to the PLAN, not to the physics: the rider still has to
   * brake for the corner, still loses time when it makes a mistake, and still
   * cannot exceed what the grip allows. A band on velocity would produce the
   * "impossible catch-up" the brief forbids; a band on intent produces a rider
   * who is trying a little harder or a little less hard, which is invisible.
   */
  /**
   * Put a rider who has stopped making progress back on the trail.
   *
   * This exists because no steering controller is ever good enough to make it
   * unnecessary. A rider who runs wide onto open mountainside, or lands a jump
   * in a hollow, can end up somewhere the bike physically cannot climb out of —
   * measured before this: three of three riders wedged in the switchbacks at
   * 1202, 1223 and 1611 m, pinned at full lock and 2 km/h, and the race simply
   * never finished. Improving the AI moved that to one rider in three at
   * 1683 m. It will never move it to zero, because "somewhere a bike cannot
   * climb out of" is a property of a mountain, not of the controller.
   *
   * So the guarantee is structural: a race always completes. The AI's job is to
   * make this fire rarely; this is what happens on the occasion it does not.
   *
   * AI only. The player gets the R key, because a player who has stopped to
   * look at the view has not made a mistake and must not be teleported for it.
   */
  private rescueStuck(dt: number): void {
    if (this.phase !== RacePhase.Racing && this.phase !== RacePhase.Finished) return;

    for (let i = 0; i < this.aiRiders.length; i++) {
      const r = this.aiRiders[i];
      if (r.progress.finished) {
        this.stuckTime[i] = 0;
        continue;
      }
      const d = r.progress.distance;
      if (d - this.stuckMark[i] > STUCK_PROGRESS) {
        this.stuckMark[i] = d;
        this.stuckTime[i] = 0;
        continue;
      }
      this.stuckTime[i] += dt;
      if (this.stuckTime[i] < STUCK_SECONDS) continue;

      // Back onto the centreline, a little ahead of where they died so they do
      // not immediately re-enter whatever caught them, facing down-course and
      // rolling — dropping a rider in stationary would just hand the same
      // corner back to them with no speed to carry through it.
      const ahead = Math.min(d + STUCK_NUDGE, this.track.length);
      const s = this.track.sampleAtDistance(ahead, this.scratchSample);
      _v0.copy(s.position);
      const ground = this.terrain.heightAt(_v0.x, _v0.z);
      if (ground > _v0.y) _v0.y = ground;
      _v0.y += 0.35;
      _v1.copy(s.tangent);

      r.bike.reset(_v0, _v1);
      r.reseat(_v0, ahead);
      r.bike.state.velocity.copy(_v1).multiplyScalar(STUCK_SPEED);
      r.bike.state.forwardSpeed = STUCK_SPEED;
      r.bike.state.speed = STUCK_SPEED;

      this.stuckMark[i] = ahead;
      this.stuckTime[i] = 0;
      this.rescues++;
    }
  }

  private updateRubberBand(dt: number): void {
    const playerDist = this.player.progress.distance;
    const inGrace = this.elapsed < RUBBER_BAND.graceSeconds;
    const off = inGrace || this.player.progress.finished || this.phase !== RacePhase.Racing;

    for (let i = 0; i < this.racers.length; i++) {
      const r = this.racers[i];
      if (r.progress.isPlayer) continue;
      const ai = r as AIRider;

      let target = 1;
      if (!off && !r.progress.finished) {
        const gap = r.progress.distance - playerDist; // + = AI is ahead
        const mag = Math.max(0, Math.abs(gap) - RUBBER_BAND.deadZone);
        const norm = clamp01(mag / (RUBBER_BAND.saturationGap - RUBBER_BAND.deadZone));
        // Smootherstep so there is no perceptible knee at the dead-zone edge.
        const shaped = norm * norm * (3 - 2 * norm);
        if (gap > 0) {
          target = 1 - shaped * RUBBER_BAND.maxDeviation * RUBBER_BAND.leadScale;
        } else {
          target = 1 + shaped * RUBBER_BAND.maxDeviation;
        }
      }
      this.bandValue[i] = dampHL(this.bandValue[i], target, RUBBER_BAND.halfLife, dt);
      ai.rubberBand = this.bandValue[i];
    }
  }

  // ── Visual tick ───────────────────────────────────────────────────────────

  /** Call once per RENDERED frame, after fixedUpdate has run. */
  updateVisual(alpha: number, dt: number, time: number): void {
    for (const r of this.racers) r.updateVisual(alpha, dt, time);
    this.ghost.update(Math.max(0, this.elapsed), dt, time);
  }

  // ── HUD ───────────────────────────────────────────────────────────────────

  /**
   * The one HudModel. Returned by reference and mutated in place — the HUD is
   * expected to read it every frame and to drain `popups`, and allocating a
   * fresh model plus a standings array 60 times a second is exactly the kind of
   * per-frame garbage this project does not do.
   */
  getHudModel(): HudModel {
    const h = this.hud;
    const p = this.player;
    const st = p.bike.state;
    const prog = p.progress;

    h.phase = this.phase;
    h.speedKmh = st.speed * 3.6;
    h.position = prog.position;
    h.racerCount = this.racers.length;
    h.raceTime = Math.max(0, this.elapsed);
    h.boost = st.boost;
    h.boosting = st.boosting;
    h.trickScore = prog.trickScore;

    const tk = p.trick.kind;
    h.activeTrick = tk === TrickKind.None ? null : trickLabel(tk, p.trick.rotations);

    h.routeProgress = clamp01(prog.distance / Math.max(this.track.length, 1));
    h.gapAhead = prog.gapAhead;
    h.gapBehind = this.gapBehindPlayer();
    h.wrongWay = p.wrongWayTime > 0.6;
    h.countdown = this.phase === RacePhase.Countdown ? Math.max(0, COUNTDOWN_SECONDS - this.raceTime) : null;
    h.ghostDelta = this.ghost.hasGhost ? this.ghost.delta : null;
    h.cornerPreview = this.updateCornerPreview(prog.distance);
    return h;
  }

  private gapBehindPlayer(): number | null {
    const k = this.player.progress.position; // 1-based
    if (k >= this.standings.length) return null;
    const behind = this.standings[k];
    return this.gapSeconds(this.player.progress, behind);
  }

  /**
   * The next corner worth warning about: the first point ahead whose curvature
   * exceeds a threshold, reported as a signed -1..1 severity plus a distance.
   * Scanning to the first hit rather than to the maximum is deliberate — the
   * player needs to know about the corner they are arriving at, not the biggest
   * one on the mountain.
   */
  private updateCornerPreview(distance: number): HudModel['cornerPreview'] {
    const step = 8;
    const kThreshold = 2.6e-3;
    const curvAt = (d: number): number => {
      const s = this.track.sampleAtDistance(
        Math.min(distance + d, this.track.length),
        this.scratchSample,
      );
      return s.curvature;
    };

    // Announce the NEXT corner, not the one you are already riding.
    //
    // The scan used to start at 10 m and return the first sample past
    // threshold, so a rider mid-corner was told "10 M" about the corner their
    // front wheel was already in — a preview of the present, which is the one
    // thing a preview cannot be. If the track is already turning here, walk
    // forward to the exit first and only then start looking.
    let d = 0;
    if (Math.abs(curvAt(0)) > kThreshold) {
      // Two consecutive straight samples to call it an exit, so a brief
      // slackening in the middle of a long bend does not split it in two and
      // re-announce the same corner.
      let straightRun = 0;
      while (d <= CORNER_PREVIEW_RANGE) {
        d += step;
        if (Math.abs(curvAt(d)) <= kThreshold) {
          if (++straightRun >= 2) break;
        } else {
          straightRun = 0;
        }
      }
    }

    for (d = Math.max(d, 10); d <= CORNER_PREVIEW_RANGE; d += step) {
      const k = curvAt(d);
      if (Math.abs(k) > kThreshold) {
        this.cornerPreview.curvature = clamp(k * 320, -1, 1);
        this.cornerPreview.distance = d;
        return this.cornerPreview;
      }
    }
    return null;
  }

  private pushPopup(text: string, value: number, kind: 'trick' | 'split' | 'warning' | 'combo'): void {
    // Bounded: if the HUD is not draining these (paused, not yet wired) we must
    // not grow an unbounded array for the whole run.
    if (this.popups.length > 16) this.popups.shift();
    this.popups.push({ text, value, kind });
  }

  /** Trick popups are pushed from here so the HUD gets them exactly once. */
  reportTrick(text: string, value: number): void {
    this.pushPopup(text, value, 'trick');
  }

  // ── Route profile ─────────────────────────────────────────────────────────

  private buildRouteProfile(): void {
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < PROFILE_SAMPLES; i++) {
      const d = (i / (PROFILE_SAMPLES - 1)) * this.track.length;
      const s = this.track.sampleAtDistance(d, this.scratchSample);
      this.routeProfile[i] = s.position.y;
      if (s.position.y < lo) lo = s.position.y;
      if (s.position.y > hi) hi = s.position.y;
    }
    const span = Math.max(hi - lo, 1);
    for (let i = 0; i < PROFILE_SAMPLES; i++) {
      this.routeProfile[i] = (this.routeProfile[i] - lo) / span;
    }
  }

  // ── Teardown ──────────────────────────────────────────────────────────────

  dispose(): void {
    for (const r of this.racers) r.dispose();
    this.racers.length = 0;
    this.aiRiders.length = 0;
    this.ghost.dispose();
    this.replay.clear();
    this.object.removeFromParent();
  }
}

const UP_Y = new Vector3(0, 1, 0);

function compareProgress(a: RacerProgress, b: RacerProgress): number {
  if (a.finished && b.finished) return (a.finishTime ?? 0) - (b.finishTime ?? 0);
  if (a.finished) return -1;
  if (b.finished) return 1;
  return b.distance - a.distance;
}

function trickLabel(kind: TrickKind, rotations: number): string {
  switch (kind) {
    case TrickKind.Spin360: {
      const turns = Math.max(1, Math.round(rotations));
      return `${turns * 360}`;
    }
    case TrickKind.Backflip:
      return rotations >= 1.6 ? 'DOUBLE BACKFLIP' : 'BACKFLIP';
    case TrickKind.Frontflip:
      return rotations >= 1.6 ? 'DOUBLE FRONTFLIP' : 'FRONTFLIP';
    case TrickKind.Tabletop:
      return 'TABLETOP';
    case TrickKind.XUp:
      return 'X-UP';
    case TrickKind.Superman:
      return 'SUPERMAN';
    case TrickKind.Tailwhip:
      return 'TAILWHIP';
    case TrickKind.NoFooter:
      return 'NO-FOOTER';
    case TrickKind.Manual:
      return 'MANUAL';
    default:
      return '';
  }
}

/** Exposed so the HUD can label a trick without importing the whole director. */
export { trickLabel };
