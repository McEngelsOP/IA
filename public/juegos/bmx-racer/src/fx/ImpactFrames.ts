/**
 * ImpactFrames — the anime impact hold.
 *
 * The convention: on a hit that matters, the film stops. One or two frames of
 * a held, high-contrast, often near-monochrome drawing, then it cuts straight
 * back to full motion. It costs almost nothing and it is the single largest
 * multiplier on how heavy a hit feels, because the eye reads the discontinuity
 * as force rather than as a stutter.
 *
 * It is also the effect most easily ruined. Used on every landing it stops
 * being punctuation and becomes framerate. So this module is mostly a
 * gatekeeper:
 *
 *   SEVERITY THRESHOLD  0.42 for landings, 0.30 for crashes.
 *                       A crash is always worth a frame; a landing has to earn it.
 *   COOLDOWN            0.85 s. Below that, two hits blur into one long hitch.
 *   BURST LIMIT         3 holds in any 6 s window. A rider bouncing down a rock
 *                       garden would otherwise trigger on every impact and the
 *                       game would look broken rather than brutal.
 *   FRAME COUNT         1 frame under 0.72 severity, 2 above. Never 3 — at
 *                       60fps a third frame reads as a dropped frame.
 *
 * Below the threshold we still fire a FLASH without freezing, so smaller hits
 * get punctuation without the game stopping. That split is what lets the hold
 * stay rare.
 *
 * The flash itself decays as an explicit STAIRCASE, in whole frames, rather
 * than a curve. A smoothly fading white flash is a bloom artefact; a flash that
 * holds a value and then cuts is a drawn effect.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * KNOWN DEFECT, DOWNSTREAM OF HERE — src/npr/passes/CompositePass.ts
 *
 * This module publishes only a scalar (POST_STATE.impactFlash) and a tint. How
 * that becomes pixels is the composite's business, and the composite currently
 * gets it wrong in a way no amount of tuning here can fully repair. Section 9
 * of COMPOSITE_FRAG reads, in essence:
 *
 *     float k = smoothstep(0.33, 0.39, luma(disp));
 *     vec3 punch = mix(inkColor * 0.8, impactTint, k);
 *     disp = mix(disp, punch, uImpactFlash);
 *
 * `punch` discards the frame and rebuilds it as a two-value threshold of its
 * own luminance. As uImpactFlash approaches 1 the ENTIRE image — sky included
 * — is replaced by that two-tone remap: bright sky and lit rock both land on
 * the same flat tint, shadowed riders land on flat ink, and the shot reads as
 * a posterised negative with the sky deleted. Captured `landing` f0033-f0036,
 * `crash` f0015-f0016, `trick-360` f0100 and `switchback` ~f0044 are all this.
 *
 * Two things are wrong and only the first is ours:
 *
 *  1. AMPLITUDE (fixed here). The peak is now capped by
 *     IMPACT_TUNING.flashCeiling so `f` never exceeds ~0.34 and the original
 *     image always survives the blend. This alone stops the negative.
 *
 *  2. THE OPERATOR (needs a change in CompositePass, which this agent does not
 *     own). An impact accent should ADD contrast, not REPLACE the image. The
 *     minimal correct form keeps the shot's own colour and pushes it away from
 *     mid-grey toward the tint, instead of quantising it to two values:
 *
 *         float l    = luma(disp);
 *         float f    = saturate1(uImpactFlash);
 *         // widen the frame's existing contrast about its own mid-point...
 *         vec3  hard = clamp((disp - 0.5) * (1.0 + f * 2.2) + 0.5, 0.0, 1.0);
 *         // ...and tint only the part that was already bright.
 *         disp = mix(disp, hard, f);
 *         disp += linearToSrgb(uImpactTint) * f * f * smoothstep(0.45, 0.85, l) * 0.5;
 *
 *     That keeps the sky a sky, keeps the riders coloured, and still snaps the
 *     frame to a hard graphic read for the one or two frames it is up.
 * ──────────────────────────────────────────────────────────────────────────
 */

import { Color } from 'three';
import { clamp01 } from '../core/MathX';
import { POST_STATE } from '../npr/NprGlobals';
import { HUD_PALETTE, SUN_RIM_COLOR } from '../npr/Palette';

/** Thresholds and timings, exported so the HUD/debug overlay can show them. */
export const IMPACT_TUNING = {
  landingThreshold: 0.42,
  crashThreshold: 0.30,
  /** Below the hold threshold but above this, we flash without freezing. */
  flashOnlyThreshold: 0.16,
  cooldown: 0.85,
  burstWindow: 6.0,
  burstLimit: 3,
  /** Severity at or above which we hold for two frames instead of one. */
  twoFrameSeverity: 0.72,
  /** Seconds of partial-speed recovery after the hold releases. */
  recoverTime: 0.10,
  recoverScale: 0.34,
  /**
   * Staircase length, in RENDERED FRAMES. Not seconds.
   *
   * This was a duration (0.055 s, then 0.018 s) and that was the whole bug.
   * The convention is "one or two frames" — the unit is a frame, and the
   * moment you express it in seconds you are betting on the frame rate. 0.055
   * gave a ten-frame flash at 60fps; even 0.018 gives three, and would give
   * six on a 120 Hz display for identical code. Counting frames makes the hold
   * exactly as long as the spec says on every machine, which is the only
   * reason the effect reads as punctuation rather than as a hitch.
   *
   * 2 for a hold (full strength, then one step out), 1 for a flash-only.
   */
  flashFrames: 2,
  flashOnlyFrames: 1,
  /**
   * CEILING ON THE FLASH. This is the number that stops the composite from
   * eating the frame, and it is worth being explicit about why it is so low.
   *
   * CompositePass applies `uImpactFlash` as `mix(disp, punch, f)` where
   * `punch` is a TWO-VALUE posterisation of the frame's own luminance —
   * everything under 0.33 luma becomes ink, everything over becomes the tint.
   * At f near 1 that is not an accent, it is a full-frame replacement: the sky
   * and the lit terrain collapse to the same flat highlight, the riders
   * collapse to solid black, and the result reads as a photographic negative
   * with the sky deleted. Which is precisely what four consecutive frames of
   * `landing` showed.
   *
   * The composite's blend is the thing that should be fixed (see the note in
   * ImpactFrames' class comment), but the amplitude is ours, and holding the
   * peak at 0.34 keeps enough of the original image alive that the effect
   * reads as a hard high-contrast accent laid OVER the shot rather than
   * instead of it.
   */
  flashCeiling: 0.34,
  /** Ceiling on the edge-in ink wash. Above ~0.3 it closes over the frame. */
  inkCeiling: 0.30,
  /** Ceiling on the desaturation. Above this the shot simply goes monochrome. */
  desatCeiling: 0.16,
} as const;

const _tint = new Color();

export class ImpactFrames {
  /** 0 while the world is held, then a short partial-speed tail, then 1. */
  timeScale = 1;

  /** True on any frame the simulation is fully frozen. */
  get frozen(): boolean {
    return this.framesLeft > 0;
  }

  private framesLeft = 0;
  private cooldown = 0;
  private recover = 0;

  /** Rendered frames of flash remaining. -1 = idle. Counted, never timed. */
  private flashFramesLeft = -1;
  private flashSpan = 1;
  private flashPeak = 0;
  private inkPeak = 0;
  private flashTint = new Color(1, 1, 1);

  private clock = 0;
  /** Ring of the last few hold timestamps, for the burst limiter. */
  private recent = new Float32Array(IMPACT_TUNING.burstLimit);
  private recentHead = 0;

  constructor() {
    this.recent.fill(-1e6);
  }

  /**
   * Request an impact frame.
   *
   * `intensity` 0..1. `tint` is an optional sRGB hex for the flash colour —
   * defaults to the hot rim gold so the flash sits inside the palette instead
   * of punching a pure white hole in the frame.
   *
   * Returns true if the request produced a genuine hold (as opposed to a
   * flash-only, or nothing at all). The caller does not need the return value;
   * it exists so the audio system can decide whether to fire the big hit.
   */
  trigger(intensity: number, tint?: number, isCrash = false): boolean {
    const s = clamp01(intensity);
    const threshold = isCrash ? IMPACT_TUNING.crashThreshold : IMPACT_TUNING.landingThreshold;

    if (s < threshold || this.cooldown > 0 || this.burstExhausted()) {
      if (s >= IMPACT_TUNING.flashOnlyThreshold) this.flashOnly(s * 0.55, tint);
      return false;
    }

    this.framesLeft = s >= IMPACT_TUNING.twoFrameSeverity ? 2 : 1;
    this.cooldown = IMPACT_TUNING.cooldown;
    this.recent[this.recentHead] = this.clock;
    this.recentHead = (this.recentHead + 1) % this.recent.length;

    this.flashSpan = IMPACT_TUNING.flashFrames;
    this.flashFramesLeft = this.flashSpan;
    this.flashPeak = (0.55 + 0.45 * s) * IMPACT_TUNING.flashCeiling;
    // Ink flood is the other half of the convention: the frame collapses toward
    // the ink colour at the same moment it blows out, which is what gives the
    // held drawing its poster-like contrast instead of just making it bright.
    this.inkPeak = (0.30 + 0.55 * s * (isCrash ? 1.0 : 0.7)) * IMPACT_TUNING.inkCeiling;
    this.setTint(tint, isCrash);
    this.publish();
    return true;
  }

  /**
   * A flash with no freeze. Boost ignition, checkpoint gates, a clean landing
   * that doesn't deserve to stop the world.
   */
  /**
   * `frames` is the staircase length in RENDERED FRAMES, defaulting to the
   * one-frame flash. A caller that is punctuating a real hit — a body coming
   * down inside a crash, as opposed to a boost igniting — asks for two, which
   * is the length the convention specifies and the length a motion review
   * measured as correct on the crash capture (2 frames / 33 ms). Never three.
   */
  flashOnly(intensity: number, tint?: number, frames: number = IMPACT_TUNING.flashOnlyFrames): void {
    const s = clamp01(intensity);
    if (s <= 0.01) return;
    // Never let a small flash stomp a big one that is still playing.
    const peak = s * 0.7 * IMPACT_TUNING.flashCeiling;
    if (this.flashFramesLeft > 0 && peak <= this.flashPeak * this.staircase()) return;
    this.flashSpan = Math.max(1, Math.min(Math.round(frames), IMPACT_TUNING.flashFrames));
    this.flashFramesLeft = this.flashSpan;
    this.flashPeak = peak;
    this.inkPeak = s * 0.18 * IMPACT_TUNING.inkCeiling;
    this.setTint(tint, false);
    this.publish();
  }

  /**
   * Write the dials for THIS frame and consume one frame of the staircase.
   *
   * ── THE ACCENT USED TO LAND ONE FRAME AFTER THE HIT, ALWAYS. ───────────────
   *
   * Everything here published only from update(), and update() runs at the TOP
   * of the frame (Game.render calls effects.beginFrame first, because the scaled
   * dt it returns has to exist before anything else can use it). Every caller,
   * on the other hand, is downstream: Effects.detectEvents → crashStrikes →
   * flashOnly happens in the MIDDLE of the frame, long after update() has been
   * and gone. So a flash requested on frame N was not written to POST_STATE
   * until update() ran again on frame N+1, and the composite drew frame N with
   * the dials still at zero.
   *
   * That is a whole 16.7 ms, and for a two-frame accent it is half the effect,
   * placed on the wrong side of the event. Measured on the `crash` capture: the
   * body arrives at f0028 (the speedo falls 15.6 → 8.9 km/h in one frame) and
   * the composite's uImpactFlash first goes non-zero at f0029. The punch landed
   * on the frame AFTER the frame the eye reads as the hit — which is precisely
   * the "fires on the wrong frame" the motion review measured, at the small
   * scale that survived after the gross 267-433 ms error was fixed.
   *
   * Publishing here, at the moment of the request, puts the first and loudest
   * step of the staircase on the frame the hit happens. update() then carries
   * the remaining steps exactly as before, because this consumes its frame the
   * same way update() does — the two are deliberately the same three lines.
   */
  private publish(): void {
    if (this.flashFramesLeft <= 0) return;
    const s = this.staircase();
    POST_STATE.impactFlash = this.flashPeak * s;
    POST_STATE.impactTint.copy(this.flashTint);
    POST_STATE.inkFlood = this.inkPeak * this.staircase(1);
    POST_STATE.desaturate = Math.min(this.flashPeak * s * 0.45, IMPACT_TUNING.desatCeiling);
    this.flashFramesLeft--;
  }

  private setTint(tint: number | undefined, isCrash: boolean): void {
    if (tint !== undefined) {
      _tint.setHex(tint);
      this.flashTint.copy(_tint);
    } else if (isCrash) {
      // A crash flashes red-hot, not white — it should read as damage.
      this.flashTint.copy(HUD_PALETTE.red).lerp(SUN_RIM_COLOR, 0.45);
    } else {
      this.flashTint.copy(SUN_RIM_COLOR);
    }
  }

  private burstExhausted(): boolean {
    let n = 0;
    for (let i = 0; i < this.recent.length; i++) {
      if (this.clock - this.recent[i] < IMPACT_TUNING.burstWindow) n++;
    }
    return n >= IMPACT_TUNING.burstLimit;
  }

  /**
   * The staircase, in frames. The first frame is full strength and each
   * subsequent frame drops a hard step; there is never an in-between value,
   * because the whole point of the convention is that the accent is CUT, not
   * faded. A two-frame hold reads {1, 0.5}; a one-frame flash reads {1}.
   */
  private staircase(offset = 0): number {
    const left = this.flashFramesLeft - offset;
    if (left <= 0) return 0;
    return left / this.flashSpan;
  }

  /**
   * Advance. `dt` MUST be the real, unscaled frame delta — this is the clock
   * that ends the freeze, so feeding it the scaled dt would hold forever.
   *
   * Called once per RENDERED frame; the freeze is counted in frames, not
   * seconds, because "one frame" is the actual unit of the convention.
   */
  update(dt: number): void {
    this.clock += dt;
    if (this.cooldown > 0) this.cooldown -= dt;

    if (this.framesLeft > 0) {
      this.timeScale = 0;
      this.framesLeft--;
      if (this.framesLeft === 0) this.recover = IMPACT_TUNING.recoverTime;
    } else if (this.recover > 0) {
      // A short partial-speed tail out of the hold. Not a slow-mo — 100ms of
      // a third speed, which reads as the world taking the hit and shrugging
      // it off rather than as an effect.
      this.recover -= dt;
      const u = clamp01(1 - this.recover / IMPACT_TUNING.recoverTime);
      this.timeScale = IMPACT_TUNING.recoverScale + (1 - IMPACT_TUNING.recoverScale) * (u * u);
      if (this.recover <= 0) this.timeScale = 1;
    } else {
      this.timeScale = 1;
    }

    // Publishing is one shared routine (see publish()): the ink flood decays one
    // step faster than the flash so the frame goes white-hot first and graphic
    // second, the desaturation rides the flash, and the frame counter is
    // consumed AFTER the write — a one-frame flash that zeroed itself in the
    // same call that raised it would never survive to be composited at all.
    // update() carries the steps AFTER the first; the first is written by the
    // trigger itself, on the frame of the hit.
    if (this.flashFramesLeft > 0) {
      this.publish();
    } else if (this.flashFramesLeft === 0) {
      this.flashFramesLeft = -1;
      // Hand the dials straight back rather than leaving them latched — the
      // accent is over on the frame it is over.
      POST_STATE.impactFlash = 0;
      POST_STATE.inkFlood = 0;
      POST_STATE.desaturate = 0;
    }
  }

  /** Hard reset — used on race restart and by the capture harness. */
  reset(): void {
    this.framesLeft = 0;
    this.cooldown = 0;
    this.recover = 0;
    this.flashFramesLeft = -1;
    this.timeScale = 1;
    this.recent.fill(-1e6);
    this.recentHead = 0;
    POST_STATE.impactFlash = 0;
    POST_STATE.inkFlood = 0;
    POST_STATE.desaturate = 0;
    POST_STATE.impactTint.copy(SUN_RIM_COLOR);
  }
}
