/**
 * AudioEngine — implements IAudio.
 *
 * One AudioContext, one master bus, a fixed set of voices built at unlock, and
 * nothing allocated afterwards. `update()` is called once per rendered frame
 * with the player's BikeState and the surface under the tyres; everything else
 * is an explicit trigger.
 *
 * ── THE AUTOPLAY POLICY ─────────────────────────────────────────────────────
 * The context is constructed eagerly, in the Game's load phase, and lives in the
 * `suspended` state until `unlock()` is called from a real user gesture. Every
 * API on this class is safe to call before that: parameter automation on a
 * suspended context is legal and simply queues against a clock that is not
 * running. The graph is not built until unlock, though — building it on a
 * suspended context and then resuming makes every looping source start from
 * whatever phase the clock happened to be at, and on some builds that lands as
 * an audible pop on the first frame of audio.
 *
 * ── WHY THE VOICES ARE INFERRED FROM BikeState ──────────────────────────────
 * `BikeState` has no pedal or brake field — those live in `BikeInput`, which is
 * the physics' input, not its output. Rather than reach into another subsystem,
 * this engine infers drive and lockup from the rear wheel's slip ratio, which is
 * exactly the physical quantity that determines whether the freewheel is
 * engaged. If the game wants exact values it can hand them over with
 * `setRiderInput()` and the inference is bypassed.
 */

import type {
  BikeState,
  IAudio,
  SurfaceProperties,
  BikeInput,
} from '../game/Contracts';

import { BIKE } from '../game/WorldConstants';
import { clamp, clamp01, dampHL } from '../core/MathX';
import {
  BoostVoice,
  DrivetrainVoice,
  HornVoice,
  ImpactPool,
  MasterBus,
  NoiseBank,
  SuspensionPool,
  TyreVoice,
  UiPool,
  WindVoice,
  type SurfaceTone,
  type UiKind,
} from './Synths';

/** Nominal total normal force at rest, for normalising wheel load. */
const NOMINAL_LOAD = BIKE.mass * BIKE.gravity;

export interface AudioOptions {
  /**
   * Fire landing, crash, suspension and boost sounds automatically from the
   * state passed to `update()`. Turn this off if the game triggers them itself,
   * or you will hear every landing twice.
   */
  autoTrigger?: boolean;
  /** Initial master volume, 0..1. */
  volume?: number;
}

export class AudioEngine implements IAudio {
  private ctx: AudioContext | null = null;
  private bus: MasterBus | null = null;
  private bank: NoiseBank | null = null;

  private wind: WindVoice | null = null;
  private tyre: TyreVoice | null = null;
  private drive: DrivetrainVoice | null = null;
  private susp: SuspensionPool | null = null;
  private impacts: ImpactPool | null = null;
  private horn: HornVoice | null = null;
  private ui: UiPool | null = null;
  private boost: BoostVoice | null = null;

  private built = false;
  private unlocked = false;
  private disposed = false;
  private volume: number;

  autoTrigger: boolean;

  /**
   * Global duck, 0..1. Menus, the results screen and the replay all pull this
   * down so the world does not shout over them. Smoothed, never stepped.
   */
  private duckTarget = 1;
  private duckValue = 1;

  // ── Derived per-frame state ───────────────────────────────────────────────
  private groundedSmooth = 0;
  private lastFrontCv = 0;
  private lastRearCv = 0;
  private frontCool = 0;
  private rearCool = 0;
  private impactCool = 0;
  private wasBoosting = false;
  private input: BikeInput | null = null;

  constructor(opts: AudioOptions = {}) {
    this.autoTrigger = opts.autoTrigger ?? true;
    this.volume = opts.volume ?? 0.85;
    this.createContext();
  }

  private createContext(): void {
    try {
      const Ctor: typeof AudioContext | undefined =
        typeof AudioContext !== 'undefined'
          ? AudioContext
          : (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor({ latencyHint: 'interactive' });
    } catch {
      // No Web Audio (or blocked). Every method below no-ops from here.
      this.ctx = null;
    }
  }

  /** True once the context is running and the graph is live. */
  get ready(): boolean {
    return this.unlocked && !!this.ctx && this.ctx.state === 'running';
  }

  get context(): AudioContext | null {
    return this.ctx;
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  async unlock(): Promise<void> {
    if (this.disposed) return;
    if (!this.ctx) this.createContext();
    const ctx = this.ctx;
    if (!ctx) return;

    try {
      if (ctx.state !== 'running') await ctx.resume();
    } catch {
      return;
    }

    if (!this.built) this.build(ctx);
    this.unlocked = true;
  }

  /**
   * Rebuild nothing, just resume. Safe to call from a visibilitychange handler;
   * browsers suspend the context when a tab is hidden and do not always resume
   * it on their own.
   */
  async resume(): Promise<void> {
    if (!this.ctx || this.disposed) return;
    if (this.ctx.state === 'suspended') {
      try { await this.ctx.resume(); } catch { /* ignore */ }
    }
  }

  private build(ctx: AudioContext): void {
    this.built = true;
    const t = ctx.currentTime + 0.02;

    this.bus = new MasterBus(ctx);
    this.bus.setVolume(this.volume, ctx.currentTime);
    this.bank = new NoiseBank(ctx);

    const loop = this.bus.loop;
    const sfx = this.bus.sfx;
    const uiBus = this.bus.ui;

    this.wind = new WindVoice(ctx, this.bank, loop);
    this.tyre = new TyreVoice(ctx, this.bank, loop);
    this.drive = new DrivetrainVoice(ctx, this.bank, loop);
    this.boost = new BoostVoice(ctx, this.bank, loop);
    this.susp = new SuspensionPool(ctx, this.bank, sfx, 6);
    this.impacts = new ImpactPool(ctx, this.bank, sfx, 8);
    this.horn = new HornVoice(ctx, sfx);
    this.ui = new UiPool(ctx, this.bank, uiBus, 4);

    // Everything starts at the same instant so the shared noise sources are
    // phase-consistent with the voices that read them.
    this.bank.start(t);
    this.wind.start(t);
    this.tyre.start(t);
    this.drive.start(t);
    this.boost.start(t);
    this.susp.start(t);
    this.impacts.start(t);
    this.horn.start(t);
    this.ui.start(t);
  }

  // ── Mix control ───────────────────────────────────────────────────────────

  setMasterVolume(v: number): void {
    this.volume = clamp(v, 0, 1.5);
    if (this.bus && this.ctx) this.bus.setVolume(this.volume, this.ctx.currentTime);
  }

  /** 1 = full, 0 = world audio silent. Menus and replays pull this down. */
  setDuck(amount: number): void {
    this.duckTarget = clamp01(amount);
  }

  /** Hand the engine the exact rider input, bypassing slip-ratio inference. */
  setRiderInput(input: BikeInput | null): void {
    this.input = input;
  }

  // ── The frame ─────────────────────────────────────────────────────────────

  update(state: BikeState, surface: SurfaceProperties, dt: number): void {
    if (this.disposed) return;
    const ctx = this.ctx;
    if (!ctx || !this.ready || !this.wind || !this.tyre || !this.drive || !this.boost) return;

    const t = ctx.currentTime;
    const step = Math.min(Math.max(dt, 1 / 240), 0.1);

    this.duckValue = dampHL(this.duckValue, this.duckTarget, 0.10, step);
    const duck = this.duckValue;

    const tone = (surface?.audioTone ?? 'hardpack') as SurfaceTone;
    const harsh = surface?.harshness ?? 1;

    // ── Ground contact, smoothed. A hard 0/1 makes the tyre loop chatter over
    //    every root; a 60ms half-life reads as the tyre skipping instead. ────
    const groundedNow = (state.front.grounded ? 0.5 : 0) + (state.rear.grounded ? 0.5 : 0);
    this.groundedSmooth = dampHL(this.groundedSmooth, groundedNow, 0.05, step);

    const speed = Math.abs(state.speed);
    const air = clamp01(state.airHeight / 6) * (1 - this.groundedSmooth);

    // ── Drive / lockup ────────────────────────────────────────────────────
    let driveAmt: number;
    let lockAmt: number;
    if (this.input) {
      driveAmt = clamp01(this.input.pedal);
      lockAmt = clamp01(Math.max(this.input.brakeRear, this.input.brakeFront * 0.8));
    } else {
      driveAmt = clamp01(state.rear.slipRatio * 8);
      lockAmt = clamp01(-state.rear.slipRatio * 6);
    }
    if (state.boosting) driveAmt = Math.max(driveAmt, 0.8);

    // ── Load ──────────────────────────────────────────────────────────────
    const load = clamp01((state.front.load + state.rear.load) / NOMINAL_LOAD);
    const lateral = Math.max(Math.abs(state.front.lateralSlip), Math.abs(state.rear.lateralSlip));

    // ── Continuous voices ─────────────────────────────────────────────────
    this.tyre.setSurface(tone);
    this.tyre.update(t, step, speed, load, lateral, lockAmt, this.groundedSmooth, duck);
    this.wind.update(t, speed, air, duck);
    // The freewheel keeps ticking in the air — that is one of the sounds that
    // makes a jump feel long — so it is only mildly attenuated off the ground.
    this.drive.update(t, state.rear.spinRate, driveAmt, this.groundedSmooth * 0.25 + 0.75, duck);
    this.boost.update(t, state.boosting, speed, duck);

    if (!this.autoTrigger) return;

    // ── Automatic triggers ────────────────────────────────────────────────
    this.frontCool -= step;
    this.rearCool -= step;
    this.impactCool -= step;

    if (state.boosting && !this.wasBoosting) this.boost.fire(t, duck);
    this.wasBoosting = state.boosting;

    if (state.landedThisStep && this.impactCool <= 0) {
      this.playImpact(state.landingImpact, surface);
      this.playSuspension(Math.max(2.0, state.landingImpact * 4.2));
      this.impactCool = 0.05;
    }
    if (state.crashedThisStep && this.impactCool <= 0) {
      this.playImpact(Math.max(0.55, state.crashSeverity), surface);
      this.impactCool = 0.12;
    }

    // Suspension: fire on a rising compression edge. The state is sampled per
    // rendered frame while the physics runs at 120Hz, so short spikes between
    // two frames are genuinely missed; the peak-hold below catches most of them
    // by treating any frame whose velocity exceeds the last one as an edge.
    this.frontCool = this.edge(t, state.front.compressionVelocity, this.lastFrontCv, this.frontCool, harsh, duck);
    this.rearCool = this.edge(t, state.rear.compressionVelocity, this.lastRearCv, this.rearCool, harsh, duck);
    this.lastFrontCv = state.front.compressionVelocity;
    this.lastRearCv = state.rear.compressionVelocity;
  }

  private edge(
    t: number,
    cv: number,
    prev: number,
    cool: number,
    harsh: number,
    duck: number,
  ): number {
    if (cool > 0) return cool;
    if (cv > 1.1 && cv > prev * 1.15) {
      this.susp?.trigger(t, cv, harsh, duck);
      return 0.07;
    }
    return cool;
  }

  // ── Explicit triggers ─────────────────────────────────────────────────────

  playImpact(severity: number, surface: SurfaceProperties): void {
    if (!this.ready || !this.impacts || !this.ctx) return;
    const tone = (surface?.audioTone ?? 'hardpack') as SurfaceTone;
    this.impacts.trigger(this.ctx.currentTime, severity, tone, this.duckValue);
  }

  playSuspension(compressionVelocity: number): void {
    if (!this.ready || !this.susp || !this.ctx) return;
    this.susp.trigger(this.ctx.currentTime, compressionVelocity, 1.0, this.duckValue);
  }

  /**
   * @param pitch multiplier on the horn's base note. The convention the race
   *              director should use is 1.0 for each of the three count blips
   *              and 1.335 (a perfect fourth up) for the start blast.
   */
  playStartHorn(pitch = 1): void {
    if (!this.ready || !this.horn || !this.ctx) return;
    // A held blast for the gun, a short blip for the counts.
    this.horn.play(this.ctx.currentTime, pitch, pitch > 1.15, 1);
  }

  playUi(kind: UiKind): void {
    if (!this.ready || !this.ui || !this.ctx) return;
    // UI never ducks — a menu blip that gets quieter when the menu opens is a
    // blip you cannot hear at exactly the moment you need it.
    this.ui.play(this.ctx.currentTime, kind, 1);
  }

  /** Silence the continuous voices without tearing the graph down. */
  silence(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.wind?.silence(t);
    this.tyre?.silence(t);
    this.drive?.silence(t);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.silence();
    this.bank?.dispose();
    const ctx = this.ctx;
    this.ctx = null;
    if (ctx) {
      // close() rejects if the context is already closed; there is nothing to
      // do about it either way.
      ctx.close().catch(() => { /* ignore */ });
    }
  }
}
