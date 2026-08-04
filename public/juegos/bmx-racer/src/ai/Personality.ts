/**
 * Personality — the three CPU riders, expressed as numbers.
 *
 * The design rule here is that a personality is NOT a behaviour tree or a set of
 * special cases. It is a parameter vector fed into one shared controller. Every
 * rider runs identical code; the only thing that differs is where on this
 * parameter manifold they sit. That is what makes them read as three riders with
 * different temperaments rather than three scripted routines — the same corner
 * produces a late-braking overshoot from one and a tidy apex from another purely
 * because `brakePointBias` and `cornerSpeedMul` differ.
 *
 * Everything is either dimensionless (a multiplier or a 0..1 skill) or in SI.
 *
 * Reading the three from the saddle:
 *   • KESTREL (aggressive) — arrives at your rear wheel braking absurdly late,
 *     runs wide on the exit, throws a flip off the tabletop, and occasionally
 *     puts it in the scree.
 *   • MAGS (clean) — never in your mirrors and never far away. Hits the same
 *     apex every lap, never a wasted input. The benchmark: if you cannot beat
 *     Mags you have not learned the course.
 *   • OKOYE (erratic) — brilliant for three corners, then loses the front end on
 *     a nothing turn. Picks a different line every run.
 */

import { Rng } from '../core/RNG';
import { clamp, clamp01, lerp } from '../core/MathX';

export enum PersonalityKind {
  Aggressive = 'aggressive',
  Clean = 'clean',
  Erratic = 'erratic',
}

/**
 * The full parameter vector. Every field is consumed somewhere in AIRider; there
 * are no decorative parameters. If you change one, something visible changes.
 */
export interface Personality {
  kind: PersonalityKind;
  /** Display name — matched to RIDER_COLORS by the race director. */
  name: string;

  // ── Speed and braking ─────────────────────────────────────────────────────
  /**
   * Multiplier on the computed braking distance. 1.0 = textbook. Below 1 means
   * the rider commits to the brake later than physics says is safe, so they
   * enter hot and have to scrub speed by sliding.
   */
  brakePointBias: number;
  /**
   * Multiplier on the lateral acceleration budget used to derive a corner speed
   * limit. Above 1 = carries more speed than grip supports and slides.
   */
  cornerSpeedMul: number;
  /** Deceleration the rider plans around, m/s². Not the physical brake limit. */
  planBrakeAccel: number;
  /** How hard they pedal when below target speed, 0..1 scale on pedal. */
  throttleDiscipline: number;
  /** Straight-line top-speed appetite as a multiple of BIKE.spinOutSpeed. */
  straightSpeedMul: number;

  // ── Line ──────────────────────────────────────────────────────────────────
  /**
   * Preferred resting lateral offset in units of the ribbon half-width.
   * Positive = left of centre. This is where they sit when nothing else applies.
   */
  lineOffsetPref: number;
  /** Per-run randomisation of lineOffsetPref (uniform ± this). */
  lineOffsetVariance: number;
  /**
   * 0..1 how hard they cut to the inside of a corner. 1 = clips the apex kerb,
   * 0 = rides the middle of the ribbon regardless of curvature.
   */
  apexAggression: number;
  /** Amplitude of slow lateral drift, half-widths. Cheap "not a robot" noise. */
  lineDriftAmp: number;
  /** Frequency of that drift, Hz. */
  lineDriftFreq: number;

  // ── Steering controller ───────────────────────────────────────────────────
  /** Proportional gain on heading error. */
  steerKp: number;
  /** Derivative gain on heading error rate. Too low = weave, too high = lazy. */
  steerKd: number;
  /** Lookahead distance scale. Higher = smoother, later reactions. */
  lookaheadScale: number;
  /** Extra steering added when the rider is off their target line, per metre. */
  lateralGain: number;

  // ── Jumps ─────────────────────────────────────────────────────────────────
  /** Seconds before the lip the rider intends to begin compressing. */
  preloadLead: number;
  /** Standard deviation of the preload timing error, seconds. The mistake dial. */
  preloadSigma: number;
  /** 0..1 how completely they commit to the compression once begun. */
  preloadDepth: number;
  /** 0..1 how well they level the bike in the air for the landing slope. */
  airControl: number;

  // ── Tricks ────────────────────────────────────────────────────────────────
  /** 0..1 probability of attempting a trick given enough hang time. */
  trickAppetite: number;
  /** 0..1 bias toward rotation tricks (flips/spins) over pose tricks. */
  trickAmbition: number;

  // ── Racecraft ─────────────────────────────────────────────────────────────
  /** 0..1 willingness to dive up the inside instead of waiting. */
  overtakeAggression: number;
  /**
   * Lateral avoidance gain. Aggressive riders deliberately have a LOW value —
   * they leave less room, which is exactly why they trade paint.
   */
  avoidanceGain: number;

  // ── Mistakes and recovery ─────────────────────────────────────────────────
  /**
   * Base rate of a front-end wobble event, events per second, before the load
   * and surface multipliers. This is the primary crash-frequency dial.
   */
  wobbleRate: number;
  /** Peak steering disturbance of a wobble, in normalised steer units. */
  wobbleAmplitude: number;
  /** 0..1 ability to catch a slide. High = the wobble decays before it bites. */
  recoverySkill: number;
  /** 0..1 how much they back off after a scare. Low = repeats the mistake. */
  chastening: number;
  /** Seconds of caution after a crash before they wind it back up. */
  postCrashCaution: number;

  // ── Consistency ───────────────────────────────────────────────────────────
  /**
   * Amplitude of low-frequency target-speed noise, as a fraction. This is what
   * makes the erratic rider genuinely inconsistent rather than just slower.
   */
  speedNoiseAmp: number;
  speedNoiseFreq: number;
  /** Per-run multiplier spread — how much better or worse a whole run can be. */
  runFormSpread: number;
}

const AGGRESSIVE: Personality = {
  kind: PersonalityKind.Aggressive,
  name: 'KESTREL',

  brakePointBias: 0.66,      // brakes at two thirds of the safe distance
  cornerSpeedMul: 1.14,      // 14% over the grip budget — slides on entry
  planBrakeAccel: 11.5,
  throttleDiscipline: 1.0,
  straightSpeedMul: 1.12,

  lineOffsetPref: -0.16,     // sits slightly right, likes the inside dive
  lineOffsetVariance: 0.22,
  apexAggression: 0.92,
  lineDriftAmp: 0.10,
  lineDriftFreq: 0.21,

  steerKp: 2.05,
  steerKd: 0.26,
  lookaheadScale: 0.86,      // short lookahead: reacts late, corrects hard
  lateralGain: 0.085,

  preloadLead: 0.30,
  preloadSigma: 0.085,       // sloppy timing — flat jumps happen
  preloadDepth: 1.0,
  airControl: 0.62,

  trickAppetite: 0.82,
  trickAmbition: 0.85,

  overtakeAggression: 0.95,
  avoidanceGain: 0.42,       // deliberately low — leaves no room

  wobbleRate: 0.135,
  wobbleAmplitude: 0.52,
  recoverySkill: 0.44,
  chastening: 0.22,
  postCrashCaution: 1.1,

  speedNoiseAmp: 0.045,
  speedNoiseFreq: 0.28,
  runFormSpread: 0.045,
};

const CLEAN: Personality = {
  kind: PersonalityKind.Clean,
  name: 'MAGS',

  brakePointBias: 1.03,      // a hair early, always
  cornerSpeedMul: 0.985,     // inside the grip budget, every corner
  planBrakeAccel: 9.2,
  throttleDiscipline: 1.0,
  straightSpeedMul: 1.06,

  lineOffsetPref: 0.0,
  lineOffsetVariance: 0.05,
  apexAggression: 0.74,      // textbook out-in-out, not a kerb-clipper
  lineDriftAmp: 0.03,
  lineDriftFreq: 0.13,

  steerKp: 1.72,
  steerKd: 0.42,             // high damping — no weave, ever
  lookaheadScale: 1.16,      // long lookahead: reads the corner before it opens
  lateralGain: 0.062,

  preloadLead: 0.34,
  preloadSigma: 0.022,       // near-perfect timing
  preloadDepth: 1.0,
  airControl: 0.94,

  trickAppetite: 0.34,
  trickAmbition: 0.30,       // pose tricks, kept clean, never risks a landing

  overtakeAggression: 0.55,
  avoidanceGain: 1.15,

  wobbleRate: 0.020,
  wobbleAmplitude: 0.20,
  recoverySkill: 0.93,
  chastening: 0.70,
  postCrashCaution: 1.9,

  speedNoiseAmp: 0.012,
  speedNoiseFreq: 0.10,
  runFormSpread: 0.012,
};

const ERRATIC: Personality = {
  kind: PersonalityKind.Erratic,
  name: 'OKOYE',

  brakePointBias: 0.88,      // modulated hard per-run and per-corner below
  cornerSpeedMul: 1.03,
  planBrakeAccel: 10.2,
  throttleDiscipline: 0.94,
  straightSpeedMul: 1.09,

  lineOffsetPref: 0.10,
  lineOffsetVariance: 0.55,  // a genuinely different line every run
  apexAggression: 0.80,
  lineDriftAmp: 0.30,        // visibly wanders
  lineDriftFreq: 0.37,

  steerKp: 2.25,             // twitchy
  steerKd: 0.19,             // under-damped — this is the weave you can see
  lookaheadScale: 0.98,
  lateralGain: 0.105,

  preloadLead: 0.32,
  preloadSigma: 0.11,        // the worst timing of the three
  preloadDepth: 0.88,
  airControl: 0.70,

  trickAppetite: 0.70,
  trickAmbition: 0.72,

  overtakeAggression: 0.78,
  avoidanceGain: 0.78,

  wobbleRate: 0.155,
  wobbleAmplitude: 0.62,     // the biggest single disturbance of the three
  recoverySkill: 0.66,       // but the best save rate outside Mags
  chastening: 0.45,
  postCrashCaution: 1.4,

  speedNoiseAmp: 0.085,      // 8.5% — this is the inconsistency, and it is felt
  speedNoiseFreq: 0.33,
  runFormSpread: 0.075,      // whole runs are good or bad, not just corners
};

export const PERSONALITIES: Record<PersonalityKind, Personality> = {
  [PersonalityKind.Aggressive]: AGGRESSIVE,
  [PersonalityKind.Clean]: CLEAN,
  [PersonalityKind.Erratic]: ERRATIC,
};

/** The default grid, in order. Index 0 of RIDER_COLORS is the player. */
export const DEFAULT_GRID: PersonalityKind[] = [
  PersonalityKind.Clean,
  PersonalityKind.Aggressive,
  PersonalityKind.Erratic,
];

/**
 * Per-run variation. Called once when a race is created or restarted, from a
 * deterministic stream — the same seed and the same run index give the same
 * race, which is what lets the capture harness compare builds.
 *
 * This is where "sometimes brilliant, sometimes loses the front end" actually
 * lives: `formMul` shifts the rider's whole speed envelope for the entire run,
 * so a bad Okoye run is bad from the gate rather than bad only where it crashes.
 */
export interface RunForm {
  /** Multiplier applied to the rider's target speed all run. ~1 ± runFormSpread. */
  formMul: number;
  /** This run's resting lateral preference, half-widths. */
  lineOffset: number;
  /** This run's crash-risk multiplier. */
  riskMul: number;
  /** Phase offsets so two riders never wander in sync. */
  driftPhase: number;
  noisePhase: number;
  /** Commitment 0..1 — scales apex aggression and trick appetite for the run. */
  commitment: number;
}

export function rollRunForm(p: Personality, rng: Rng): RunForm {
  // gaussian() here is the sum-of-four-uniforms approximation from RNG.ts; it is
  // slightly light in the tails, which is what we want. A true normal produces
  // the occasional 4-sigma run where a rider is unrecognisably fast or slow, and
  // that reads as a bug rather than as form.
  const form = 1 + clamp(rng.gaussian(), -2.2, 2.2) * p.runFormSpread;
  const commitment = clamp01(0.5 + rng.gaussian() * 0.22 + (p.kind === PersonalityKind.Aggressive ? 0.3 : 0.12));
  return {
    formMul: form,
    lineOffset: clamp(p.lineOffsetPref + rng.signed() * p.lineOffsetVariance, -0.85, 0.85),
    // A rider on a good-form run is not just faster, they are also (slightly)
    // less likely to bin it. Coupling these makes a strong run feel coherent.
    riskMul: clamp(lerp(1.35, 0.72, clamp01((form - (1 - p.runFormSpread)) / (2 * p.runFormSpread + 1e-6))), 0.6, 1.5),
    driftPhase: rng.range(0, Math.PI * 2),
    noisePhase: rng.range(0, Math.PI * 2),
    commitment,
  };
}

/**
 * Blend a personality toward "cautious" — used after a crash and when a rider is
 * badly off-line. Returns a scalar 0..1 that callers multiply into their
 * aggression terms rather than a whole new Personality, because allocating a
 * personality object per frame would be absurd.
 */
export function cautionScalar(p: Personality, secondsSinceCrash: number): number {
  if (secondsSinceCrash >= p.postCrashCaution) return 1;
  const k = clamp01(secondsSinceCrash / Math.max(p.postCrashCaution, 1e-3));
  // Chastening decides how deep the initial back-off is; the recovery is smooth.
  const floor = lerp(1.0, 0.72, p.chastening);
  return lerp(floor, 1, k * k * (3 - 2 * k));
}
