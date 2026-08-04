/**
 * PlayerRacer — the human, wearing the same IRacer interface as the CPU riders.
 *
 * The point of making the player an IRacer is that the race director then has
 * exactly one code path. Positions, splits, gaps, collisions and rubber-banding
 * do not special-case the human; they read `progress` and `bike.state` and are
 * blind to who is driving.
 *
 * All this class actually does is translate RiderIntent (an input device) into
 * BikeInput (a physical demand). That translation is not a rename: on the ground
 * the steer axis is the bars, and in the air the same axis is yaw rotation, with
 * the trick modifiers re-routing it again to roll. Getting that mapping right is
 * most of what makes air control feel intentional rather than floaty.
 */

import {
  BikeInput,
  BikeMode,
  IRacer,
  RaceContext,
  RacePhase,
  TrickKind,
} from '../game/Contracts';
import { COUNTDOWN_SECONDS } from '../game/WorldConstants';
import { RiderIntent } from '../core/Input';
import { clamp } from '../core/MathX';
import { RacerBase, RacerInit, zeroInput } from './AIRider';

export interface PlayerRacerInit extends RacerInit {
  intent: RiderIntent;
}

export class PlayerRacer extends RacerBase implements IRacer {
  private intent: RiderIntent;

  /**
   * When set, this overrides the human. Used by the attract mode (the demo runs
   * itself) and by the capture harness, which needs a repeatable player.
   */
  scripted: BikeInput | null = null;

  /** True for the one step the player crossed the line. Consumed by the HUD. */
  justFinished = false;

  /** Seconds the player has been travelling against the track tangent. */
  wrongWayTime = 0;

  /** How long since the player last touched anything — drives the attract fade. */
  idleTime = 0;

  constructor(init: PlayerRacerInit) {
    super(init);
    this.intent = init.intent;
    this.progress.isPlayer = true;
  }

  override reset(): void {
    super.reset();
    this.wrongWayTime = 0;
    this.idleTime = 0;
    this.justFinished = false;
  }

  override update(dt: number, ctx: RaceContext): void {
    super.update(dt, ctx);

    // Wrong-way detection lives on the racer rather than the director because it
    // needs the tracker's tangent, which the racer already owns.
    const along = this.tracker.alongSpeed;
    if (ctx.phase === RacePhase.Racing && along < -1.2 && this.bike.state.speed > 1.6) {
      this.wrongWayTime += dt;
    } else {
      this.wrongWayTime = Math.max(0, this.wrongWayTime - dt * 2.2);
    }

    const i = this.intent;
    const active =
      Math.abs(i.steer) > 0.05 || i.pedal > 0.05 || i.brakeRear > 0.05 || i.crouch > 0.05 || i.brakeFront > 0.05;
    this.idleTime = active ? 0 : this.idleTime + dt;
  }

  gatherInput(dt: number, ctx: RaceContext): BikeInput {
    const o = this.input;

    if (this.scripted) {
      copyInput(this.scripted, o);
      return o;
    }

    if (ctx.phase === RacePhase.Attract || ctx.phase === RacePhase.Paused) {
      zeroInput(o);
      o.brakeFront = 1;
      o.brakeRear = 1;
      return o;
    }

    const i = this.intent;
    const st = this.bike.state;

    if (ctx.phase === RacePhase.Countdown) {
      // The player can preload on the line. A full crouch held into the gun is a
      // real launch advantage, which is the whole reason the countdown exists as
      // an interactive state rather than a wipe.
      zeroInput(o);
      o.brakeFront = 1;
      o.brakeRear = 1;
      o.crouch = i.crouch;
      const toGo = Math.max(0, COUNTDOWN_SECONDS - ctx.raceTime);
      if (toGo <= 0) {
        o.brakeFront = 0;
        o.brakeRear = 0;
      }
      return o;
    }

    if (st.mode === BikeMode.Crashing) {
      // Inputs are ignored during the crash animation, but we keep reading the
      // stick so the moment the bike is recoverable the rider is already steering.
      zeroInput(o);
      o.steer = i.steer * 0.3;
      return o;
    }

    const airborne = st.mode === BikeMode.Airborne;
    const trick1 = i.buttons.trick1.pressed;
    const trick2 = i.buttons.trick2.pressed;

    o.pedal = i.pedal;
    o.brakeRear = i.brakeRear;
    o.brakeFront = i.brakeFront;
    o.crouch = i.crouch;
    o.pitchLean = i.pitchLean;
    o.wantBoost = i.buttons.boost.pressed;

    // Bunny hop: fires on the RELEASE of crouch while grounded, and only if the
    // rider actually held it long enough to load the bike. Firing on press would
    // make the hop instant and remove the preload skill entirely.
    o.wantHop =
      !airborne &&
      i.buttons.crouch.justReleased &&
      i.buttons.crouch.heldFor >= 0 &&
      st.mode === BikeMode.Grounded;

    if (airborne) {
      // The bars still move a little in the air — it reads as body english and
      // the physics can use it for a mid-air correction — but the axis is mostly
      // handed to rotation.
      o.steer = i.steer * 0.22;

      if (trick1) {
        // Roll modifier: the stick becomes lean, not yaw.
        o.airRoll = clamp(i.steer, -1, 1);
        o.airYaw = 0;
        this.trickDriver.poseIntent = Math.abs(i.steer) > 0.4 ? TrickKind.Tailwhip : TrickKind.XUp;
      } else if (trick2) {
        o.airRoll = clamp(i.steer * 0.5, -1, 1);
        o.airYaw = 0;
        this.trickDriver.poseIntent = Math.abs(i.steer) > 0.4 ? TrickKind.Tabletop : TrickKind.Superman;
      } else {
        o.airYaw = clamp(i.steer, -1, 1);
        o.airRoll = 0;
        this.trickDriver.poseIntent = TrickKind.None;
      }

      // Lean forward/back becomes flip rotation. Inverted deliberately: pulling
      // back (positive pitchLean, the manual direction) rotates backward, which
      // is the same body motion as a real backflip.
      o.airPitch = clamp(i.pitchLean, -1, 1);
      o.pitchLean = i.pitchLean * 0.35;
    } else {
      o.steer = clamp(i.steer, -1, 1);
      o.airPitch = 0;
      o.airYaw = 0;
      o.airRoll = 0;
      this.trickDriver.poseIntent = TrickKind.None;
    }

    // Crouch also drives the manual/preload channel on the ground; nothing extra
    // needed here, the physics reads `crouch` plus `pitchLean` for that.
    void dt;
    return o;
  }
}

function copyInput(src: BikeInput, dst: BikeInput): void {
  dst.steer = src.steer;
  dst.pedal = src.pedal;
  dst.brakeRear = src.brakeRear;
  dst.brakeFront = src.brakeFront;
  dst.crouch = src.crouch;
  dst.pitchLean = src.pitchLean;
  dst.airPitch = src.airPitch;
  dst.airYaw = src.airYaw;
  dst.airRoll = src.airRoll;
  dst.wantBoost = src.wantBoost;
  dst.wantHop = src.wantHop;
}
