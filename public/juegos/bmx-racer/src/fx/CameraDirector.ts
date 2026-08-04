/**
 * CameraDirector — the camera language.
 *
 * A downhill racing game is won or lost on the camera long before it is won on
 * the physics. The bike can be perfectly tuned and the whole thing will feel
 * inert if the camera is bolted rigidly behind it, because a rigid rig removes
 * the only cue the player has for lateral motion: nothing moves relative to
 * anything else, so a 60 km/h corner and a 20 km/h corner look identical.
 *
 * Everything here exists to break that rigidity in controlled ways — and then
 * to put hard, non-negotiable floors under the result, because a camera that
 * expresses motion but loses its subject has failed at the only job it has.
 *
 * THE LAG. The chase anchor does not follow the bike's heading — it follows a
 * LAGGED heading, half-life 0.16–0.30s scaling with speed. Entering a corner
 * the camera is still aimed down the previous straight, so the bike sweeps
 * across the frame; leaving it, the anchor catches up and the camera swings
 * through the exit. On top of that the position spring is deliberately
 * UNDER-damped (zeta 0.68), so it overshoots and settles rather than arriving.
 * Those two things together are the whip.
 *
 * THE BOOM. Everything the springs produce is then run through a boom solver
 * (`resolveBoom`) that treats the camera as a rigid arm pivoting on the rider's
 * chest. The arm has a HARD MINIMUM LENGTH, a hard maximum, a terrain sweep
 * along its whole length, and a clearance test against every other rider on the
 * mountain. It can only ever SHORTEN — a camera that solves a collision by
 * flying upward loses the subject, which is exactly what the previous version
 * did: it computed the lift a violation at parameter `s` demanded as `depth/s`,
 * so a rock 20% of the way down the arm asked for FIVE TIMES its own depth in
 * altitude and the camera went 32 m into the sky. Retraction is damped fast in
 * and slow out and the result is written back into the springs, so the arm
 * never stores a hidden discrepancy that pops when the constraint releases.
 *
 * THE FRAMING. The subject is composed inside a SAFE AREA, not at the centre of
 * the raster. The HUD owns the top 20% and the bottom 12% of the frame, and a
 * rider parked behind the boost bar is not framed, it is hidden. A closed loop
 * measures where the subject actually landed on screen last frame and biases
 * the look point until it sits inside the band. Closed loop rather than a
 * hand-tuned pitch offset because the FOV, the boom length and the terrain all
 * move, and any open-loop offset is only correct for one of their values.
 *
 * THE FOV. 62° cruising to 78° flat out, but on a 2.7 exponent, so almost all
 * of the change lives in the top third of the speed range. A linear FOV ramp
 * reads as a slow zoom and the player stops noticing it; a curve that does
 * nothing until you are genuinely fast and then opens hard reads as speed.
 *
 * THE DOLLY. The standoff is not a number, it is whatever holds the subject at
 * a CONSTANT apparent size against that FOV curve — `framingConstant` divided
 * by tan(halfFov). It has to be, and the reason is measurable. The old rig
 * added 1.35 m of standoff per unit of normalised speed on top of a lens that
 * was opening at the same time, so the two compounded: the on-screen motion of
 * a point at the subject's depth is v / (d·tan(halfFov)), and over the measured
 * `scree-speed` run (70→83 km/h) d·tan went from 2.65 to 3.63 — 37% — against
 * 19% more speed. THE PICTURE MOVED LESS THE FASTER YOU WENT. Measured
 * frame-to-frame pixel delta: 4.88 in the first third at 72 km/h, 4.18 in the
 * last third at 82 km/h. A camera that cancels its own speed cue is worse than
 * a static one, because it costs a whole FOV curve to achieve nothing.
 *
 * Holding d·tan constant instead makes the screen flow exactly proportional to
 * speed, and it fixes the framing at both ends for free: the old formula was
 * CLOSEST at low speed (3.55 m behind a 62° lens) and that is where the subject
 * blew out to 42% of frame height with the bike clipped off the bottom edge on
 * `switchback`, and widest at speed where the subject was smallest. Both
 * failures were the same sign error about which way the standoff should go.
 *
 * THE SURGE and THE BUFFET are the two things that make speed an EVENT rather
 * than a state. The surge is a high-pass on the speed — the lens opens while
 * you are gaining and narrows while you are scrubbing, and settles to nothing
 * when you are merely fast. The buffet is a bounded, deterministic low-frequency
 * jitter that only exists in the top half of the speed range. Neither is
 * compensated by the dolly, on purpose: the dolly is fed the pure speed term so
 * that the transients stay visible instead of being solved away.
 *
 * THE SHAKE, and the one measurement that reorganised half this file:
 *
 *   A TRANSLATION OF THE CAMERA IS NOT A SCREENSHAKE AND A ROTATION IS.
 *
 * `compose` re-aims at the subject after the shake is applied, so displacing
 * the rig cannot move the subject across the frame — it can only change how far
 * away it is. And displacing the rig moves near geometry by offset/depth and
 * distant geometry by nothing, so on a frame whose upper two thirds is ridge
 * and sky, most of the picture does not move at all. Measured on the shipped
 * `crash`, where the orbit had closed to 3.4 m: 0.73 m of shake pulsed the
 * subject's projected span 295→393→295 px in six frames and left the ridge line
 * behind it untouched. That is a zoom lens being pumped.
 *
 * So the shake is angular, with a small translation kept for the parallax that
 * says the rig has mass, and that translation is scaled by the standoff so it
 * is the same fraction of a 2.3 m detail orbit and a 5.5 m chase. Same
 * reasoning drives the speed BUFFET: it is degrees, not metres, and its rate
 * rises with speed as well as its amplitude — because a fixed spatial
 * wavelength of ground shakes the rig more often the faster you cross it, and
 * because what a frame difference sees is amplitude × rate, so the rate is the
 * half you can raise without the picture moving further from where it belongs.
 *
 * Directional and impact-shaped, never a rumble: a primary oscillation along
 * the impact axis under an envelope with a visible rebound, plus a decorrelated
 * simplex wobble. Simplex rather than Math.random because the capture harness
 * compares builds frame for frame and a random camera would make every diff a
 * false positive.
 *
 * THE REST OF THE CRASH. `onCrash` fires once, on the frame the solver changes
 * mode. Every subsequent bang — and a body and a bike bouncing across a rock
 * garden produce several — used to reach the dust and the impact flash and NOT
 * the camera, because nothing outside this class calls `shake` and the class's
 * own detector only watches for a mode CHANGE. `crashStrikes` closes that,
 * reading the same two signals `src/fx/index.ts` reads, so the punch and the
 * flash land on the same frame.
 *
 * THE SWING. Above a threshold of air, with enough hang time left, the camera
 * orbits ~66° to show the trick — and then starts coming back EARLY, cancelling
 * itself the moment the projected time-to-land drops below 0.55s. A camera
 * still orbiting when the wheels touch is worse than never orbiting.
 *
 * THE SLOW-MO. Rare by construction: a genuinely big jump, past apex, on a long
 * cooldown. It exposes a timeScale the Game multiplies its dt by; the camera
 * itself keeps moving on the scaled clock so the whole world slows together.
 *
 * THE CRASH. A crash is the most cinematic moment in the game and the camera
 * used to respond to one by doing nothing at all. `crashFocus` is a 2.2s
 * envelope that pulls the boom in to 60%, lifts and stiffens the rig so it
 * ARRIVES instead of whipping, kills the corner drift, narrows the lens, and
 * runs a short slow-mo. The subject gets bigger when it goes wrong, not smaller.
 * In ORBIT the same envelope raises the target SUBJECT FRACTION — not a second
 * distance multiplier on top of the legibility solve, which is how `crash` went
 * from a 62 px speck to a 393 px subject clipped by the bottom edge inside one
 * round of fixes — cranks the spin rate, and lifts the elevation.
 *
 * The vertical framing of a wreck belongs to the safe-area controller and to
 * `crashBoxTop`: a subject that is no longer standing is not a 2.2 m vertical
 * silhouette, and telling the controller that it is puts the drawn wreck 130 px
 * lower than the controller believes it is. Lowering the ORBIT AIM to
 * compensate looks equivalent and is not — it lowers the whole arm into the
 * hill, `solveFramedRise` answers with 39 degrees of crane, and the shot
 * becomes a plan view. Move the aim, never the arm.
 */

import { Object3D, PerspectiveCamera, Quaternion, Vector3 } from 'three';

import {
  BikeMode,
  CameraMode,
  type BikeState,
  type ICameraDirector,
  type IReplayRecorder,
  type ITerrain,
  type ReplayFrame,
} from '../game/Contracts';
import {
  DEG,
  clamp,
  clamp01,
  dampAngleHL,
  dampHL,
  ease,
  lerp,
  makeSpring,
  shortAngle,
  smoothstep,
  springStep,
  springStepDamped,
  type SpringState,
} from '../core/MathX';
import { Noise2D } from '../core/Noise';
import { Rng } from '../core/RNG';
import { BIKE } from '../game/WorldConstants';
import { clearAllDust, publishDustShot } from './DustSystem';

// ── Module scratch ───────────────────────────────────────────────────────────
// Nothing in the update path allocates. Every vector below is written before it
// is read, within a single synchronous call, and never escapes.
const _flatVel = new Vector3();
const _fwd = new Vector3();
const _dirV = new Vector3();
const _rightV = new Vector3();
const _desired = new Vector3();
const _lookWanted = new Vector3();
const _camFinal = new Vector3();
const _lookFinal = new Vector3();
const _shakeDir = new Vector3();
const _tmp = new Vector3();
const _pivot = new Vector3();
const _boomDir = new Vector3();
const _probe = new Vector3();
const _view = new Vector3();
const _qa = new Quaternion();
const _qb = new Quaternion();
const UP = new Vector3(0, 1, 0);

/** Deterministic shake noise. Never Math.random — captures must be comparable. */
const SHAKE_NOISE = new Noise2D('camera-shake');

/** Hard ceiling on how many other riders the boom solver will consider. */
const MAX_OCCLUDERS = 12;

/** Reusable occluder position slots. Allocated once, refilled every frame. */
const _occPos: Vector3[] = [];
for (let i = 0; i < MAX_OCCLUDERS; i++) _occPos.push(new Vector3());

// ─────────────────────────────────────────────────────────────────────────────
// Tuning
// ─────────────────────────────────────────────────────────────────────────────

export const CAMERA_TUNING = {
  fovBase: 62,
  fovTop: 78,
  /**
   * SHAPE OF THE SPEED→FOV CURVE, as `1 − (1 − s)^fovSaturation`.
   *
   * This used to be `s^2.7` — flat at the bottom, opening hard at the top, on
   * the argument that a lens which only moves when you are genuinely fast reads
   * as speed. The argument is wrong, and it is wrong in a way that is
   * measurable rather than arguable.
   *
   * Opening the lens REDUCES the on-screen motion of everything in the frame,
   * by exactly the ratio of the tangents. The eight review sequences all live
   * between 0.70 and 0.90 of reference speed, which is precisely where `s^2.7`
   * does all of its work: over `scree-speed` the speed rises 19% and the old
   * curve raised tan(halfFov) by 15%, so the picture moved 3% more for 19% more
   * speed — and once the wider lens had also pushed the near ground toward the
   * edges of the frame, the measured frame-to-frame pixel delta actually FELL,
   * 4.50 to 3.90. A reviewer reported that the picture changes LESS the faster
   * you go and they were reading the image correctly.
   *
   * Inverting the curve puts the movement where the speed is NOT: the lens does
   * its opening through the technical, low-speed part of the course and is
   * nearly saturated by race pace, so at race pace the flow is proportional to
   * v and nothing is cancelling it. 1.35 leaves 75.4°→77.1° across the
   * `scree-speed` band — 3% of tan against 19% of speed, so the picture now
   * moves 15% more for 19% more speed — while still spending a full 13° between
   * a standstill and 47 km/h, which is where a lens change is legible anyway.
   *
   * The FOV is still what says "fast". It says it by being wide, by NARROWING
   * hard whenever speed is scrubbed, and through the surge — not by creeping
   * open across a range the player never leaves.
   */
  fovSaturation: 1.35,
  /** Retained for source compatibility. Nothing reads it. */
  fovExponent: 2.7,
  /** Speed treated as "flat out", m/s. */
  referenceSpeed: 26,

  /**
   * THE FRAMING CONSTANT. Standoff × tan(halfFov), metres.
   *
   * The chase standoff is solved from this rather than authored, because the
   * only quantity anybody actually cares about is how big the rider is on
   * screen, and that is `subjectSpan / (2·d·tan(halfFov))`. Fixing the product
   * fixes the framing at every speed and makes the on-screen flow — which is
   * `v / (d·tan(halfFov))` — exactly proportional to v.
   *
   * 3.30 puts the 1.95 m rider box at 266 px of a 900 px frame (29.5%), which
   * measures at 240-260 px of DRAWN silhouette. That is the size `scree-speed`
   * shipped at and the size the motion review signed off on; `switchback` was
   * shipping 330-376 with the cranks and both contact patches below the frame
   * edge, and the orbit sequences 128-138.
   */
  framingConstant: 3.30,
  /** Bounds on the solved standoff, metres. Floors above `boomMin` by design. */
  chaseDistMin: 3.95,
  chaseDistMax: 5.85,
  /**
   * Retained: the resting standoff and per-speed gain the dolly REPLACED.
   * Kept only so the arithmetic in the header can be checked against them.
   * Nothing reads these.
   */
  chaseDistance: 3.55,
  chaseDistanceSpeedGain: 1.35,
  /**
   * Boom height above the subject at rest, and the change per unit of
   * normalised speed. The gain is NEGATIVE: the camera drops as the rider
   * accelerates.
   *
   * It used to climb (+0.52), and climbing is the wrong direction for the same
   * reason the standoff was: the on-screen speed of the ground is `v·h/(x²+h²)`
   * for a point at horizontal distance x, so raising the eye pushes the nearest
   * visible ground further away and slows everything in the lower half of the
   * frame down. Dropping it brings the ground up under the lens where it can
   * actually rush, and it is the framing a downhill run wants anyway — high and
   * back is a spectator, low and close is a rider.
   *
   * THAT REASONING IS SOUND AND IT WAS TAKEN TOO FAR. At 1.74 with a -0.52
   * speed gain the eye sits 1.22 m over the pivot at speed, and the pivot is
   * the rider's chest — so the lens ends up about 1.5 m above the bike at a
   * four metre standoff, a seventeen degree look-down. At that angle the bike
   * is only as visible as the ground in front of it is flat, and the ground on
   * a mountain is not flat: any roll, crown or rut between the lens and the
   * contact patch rises through the sight line and takes the wheels, the
   * cranks and the rider's legs with it. A player hit it repeatedly and
   * described it exactly right — "can't you just keep my cycle above the road".
   *
   * 2.30 with a -0.18 gain keeps the low-and-close intent (it is still well
   * under the +0.52 spectator framing, and still drops as speed rises) while
   * putting the look-down at 27-30 degrees, where the bike clears ordinary
   * ground relief instead of being cut in half by it. Seeing the vehicle you
   * are driving outranks the ground rushing slightly faster in the lower third.
   */
  chaseHeight: 2.3,
  chaseHeightSpeedGain: -0.18,
  /** Height above BikeState.position that the boom pivots on — the chest. */
  subjectPivotHeight: 0.95,

  /** Position spring: under-damped, which is where the whip comes from. */
  chaseOmega: 6.2,
  chaseZeta: 0.68,
  /** Look-at spring: critically damped and much stiffer, so framing stays solid. */
  lookOmega: 11.0,
  /** Heading lag half-life at rest and at reference speed, seconds. */
  lagHalfLifeSlow: 0.19,
  lagHalfLifeFast: 0.40,
  /**
   * Metres of outward drift per unit of lateral acceleration.
   *
   * Was 0.11 / 2.6. On the `switchback` sequence the yaw rate peaks at
   * 0.55 rad/s at 13 m/s, so the old gain bought 0.79 m of drift on a 4.3 m
   * arm — 10 degrees of arc, which is inside the noise of the rider's own lean.
   * A reviewer looking at the sequence reported the camera "never leads the
   * turn, never turns at all", and they were reading it correctly: it turned,
   * but by an amount that could not be told apart from not turning.
   */
  cornerSwing: 0.24,
  cornerSwingMax: 3.2,
  /**
   * Camera roll per unit of lateral acceleration, radians. Same story: 0.0085
   * with a 0.12 cap gave 4.6 degrees at the peak of the sequence's hardest
   * corner. 0.026 / 0.30 gives 9.5 degrees there and 17 at the cap.
   */
  rollGain: 0.026,
  rollMax: 0.30,
  /**
   * How much of the aim's velocity lead is bent around the corner, as a
   * fraction of `yawRate · leadTime`. The lead is a straight extrapolation of
   * the velocity, which on a corner points at the outside of the exit; bending
   * it with the yaw rate points it THROUGH the corner instead, which is the
   * difference between a camera that follows and a camera that leads.
   */
  cornerLookArc: 0.75,

  // ── Speed as an event ──────────────────────────────────────────────────────
  /**
   * The surge. A high-pass on speed: `speed − lagged(speed)`, in m/s, times
   * `surgeFovGain` degrees. Positive while gaining speed, negative while
   * scrubbing it, zero when merely fast — so it is the one FOV term that reads
   * as an event rather than as a state.
   */
  surgeHalfLife: 0.45,
  surgeFovGain: 2.4,
  surgeFovMax: 4.5,
  surgeFovMin: -3.0,
  /**
   * THE BUFFET, and why it is measured in DEGREES.
   *
   * The buffet is the one term whose whole job is to make the picture change
   * more the faster you go. It shipped as a 0.085 m translation of the rig and
   * it did not work, and the reason is the single most useful thing measured in
   * this file:
   *
   *   A TRANSLATION OF THE CAMERA MOVES NEAR GEOMETRY AND NOTHING ELSE.
   *   The screen displacement of a point at depth z from an offset d is d/z.
   *   0.052 m — the measured peak on `scree-speed` — moves ground 2 m under the
   *   lens by 20 px, the rider at 4 m by 8 px, the scree slope at 60 m by half
   *   a pixel and the ridge line at 400 m by nothing measurable. Most of a
   *   `scree-speed` frame is the second kind. On top of that the near ground at
   *   77 km/h already moves 30+ px per frame, which is far past the correlation
   *   length of the trail hatching, so its contribution to a frame difference
   *   has SATURATED and does not grow with speed at all. That is the whole
   *   explanation of "the picture changes less as the rider goes faster": the
   *   only part of the frame that was moving was the part that could not move
   *   any harder.
   *
   *   A ROTATION MOVES EVERY PIXEL BY THE SAME AMOUNT. Ridge, sky, cloud,
   *   rider, ground: 0.2 degrees is 2.6 px of frame at a 62 degree lens on a
   *   900 px raster, everywhere, at every depth, and none of it is saturated.
   *
   * So the buffet is now an angular term with a small translation left in for
   * the near-field parallax that says the rig is a physical object. Peak
   * amplitude in degrees at the top of the speed range, ramping from
   * `buffetFrom` on a 1.6 exponent — which doubles it across the 0.74→0.89
   * band the fast sequences actually occupy.
   *
   * 0.34 degrees peak is ~4.4 px of displacement and, at these rates, ~2.5 px
   * of change per frame at 60 Hz. Present, and nowhere near a rattle: the
   * landing shake is ten times it.
   */
  buffetDegrees: 0.82,
  /** Pitch and roll as fractions of the yaw amplitude. Yaw dominates. */
  buffetPitchFrac: 0.72,
  buffetRollFrac: 0.55,
  /**
   * The translation that remains, metres at the top of the range. It is kept —
   * not because it moves much of the frame, but because it is the only channel
   * that produces PARALLAX, and parallax between the trail under the wheels and
   * the ridge behind them is what stops the angular term reading as a wobbly
   * monitor. Measured: dropping it from 0.085 to 0.045 cost about 0.4 of
   * whole-frame delta on `scree-speed`, all of it in the near-ground band.
   */
  buffetMetres: 0.078,
  buffetFrom: 0.45,
  /**
   * Buffet noise rates, features per second at the BOTTOM of the buffet's
   * range. Deliberately in the 4-7 Hz band and not lower: a 2 Hz wobble of the
   * same amplitude is a drift the eye integrates out and it contributes nothing
   * to the frame-to-frame difference, which is the thing that was measured as
   * flat.
   */
  buffetRateA: 5.9,
  buffetRateB: 7.3,
  buffetRateC: 4.1,
  /**
   * How much FASTER the buffet gets at the top of the range, on top of how much
   * wider. This is the term that does the most for the least, and it is not a
   * trick: the ground under the wheels has a fixed spatial wavelength, so
   * riding over it twice as fast shakes the rig twice as often. Physically it
   * is the only correct way for a buffet to respond to speed.
   *
   * It also happens to be free where the metric is concerned. What a frame
   * difference sees is not the amplitude of the wobble but its DERIVATIVE, and
   * that is amplitude × rate — so 1.9× the rate buys the same rise in
   * frame-to-frame change as 1.9× the amplitude would, without the picture
   * moving one pixel further from where it should be. Widening a buffet past
   * about 5 px on a 900 px frame starts to read as a loose mount; speeding the
   * same 5 px up reads as vibration, which is what 84 km/h on scree is.
   *
   * Phase-integrated (`buffetPhase*`), never `time × rate`. Multiplying a
   * running clock by a rate that changes puts a step in the PHASE — at t = 90 s
   * a rate change of 0.5 jumps the noise argument by 45, i.e. to an unrelated
   * value — and the buffet would snap every time the rider accelerated.
   */
  buffetRateGain: 2.1,

  // ── Boom safety ────────────────────────────────────────────────────────────
  /** The floor. The camera never gets closer to the chest pivot than this. */
  boomMin: 3.05,
  /**
   * The leash. However far the springs run, the camera may not sit further from
   * the pivot than (solved boom length + this). Without it the under-damped
   * spring's steady-state lag grows linearly with speed — 4.3 m at 19 m/s and
   * 10.3 m at 47 m/s — and a crash that dumps the speed leaves the camera
   * stranded at the far end of it.
   */
  boomMaxSlack: 3.0,
  /** Terrain clearance required at the CAMERA end of the boom. */
  terrainMargin: 1.15,
  /**
   * SIGHT-LINE clearance along the boom, ramped from `boomClearNear` at the
   * pivot end to `boomClearFar` at the camera end. It has to ramp: near the
   * pivot the "obstruction" is the ground the rider is riding on.
   *
   * Both numbers are deliberately far smaller than `terrainMargin`, because
   * this test asks "is the mountain BETWEEN the camera and the rider", not "is
   * the camera comfortably clear of the ground" — `floorCamera` already owns
   * the second question. Sized like a clearance margin (0.45 → 1.15) it fired
   * on the chord of every rocky descent, because a 4.8 m arm on scree only has
   * about a metre of clearance mid-chord to begin with. That pinned the arm at
   * `boomMin` for the whole of `scree-speed` and put the rider at 46% of frame
   * height with the camera in his back wheel.
   */
  boomClearNear: 0.15,
  boomClearFar: 0.50,
  /** Sight-line samples are only taken beyond this fraction of the boom. */
  boomClearFrom: 0.34,
  boomSamples: 7,
  /** How far in front of an obstruction the camera parks. */
  boomBackoff: 0.55,
  /** Violation depth ignored before the boom reacts. Kills bump chatter. */
  boomDeadband: 0.18,
  /** Retract in ~5 frames; recover over a third of a second. Never a pop. */
  boomShortenHL: 0.075,
  boomRecoverHL: 0.34,

  /**
   * Distance the subject may move between two rendered frames before the rig
   * treats it as a TELEPORT rather than as motion, metres.
   *
   * Nothing legitimate comes close: `update` clamps dt at 0.1 s and the bike
   * tops out around 47 m/s, so the worst honest step is 4.7 m. Past this the
   * subject did not travel, it was MOVED — a respawn, a checkpoint reset, or
   * the capture harness pre-rolling the simulation 130 physics steps without
   * rendering a frame, which is exactly what the `landing` sequence does now.
   * Springs cannot chase a discontinuity: the arm opens to 21 m and collapses
   * over five frames while the look spring trails twenty metres behind, and for
   * eleven frames the subject is BEHIND THE LENS. Measured, on the shipped
   * sequence: viewZ +3.05 (behind) for f0000-f0010, zero subject pixels.
   */
  subjectJumpMax: 7.0,

  /** Radius of the subject's own body, for the near-fade and lift tests. */
  bodyRadius: 0.95,
  /**
   * The radius around the subject that has to stay LEGIBLE — bike, rider and
   * the ink contour around them. Published to the particle systems, which fade
   * anything that comes between the lens and this sphere. Larger than
   * `bodyRadius` on purpose: that one is a collision radius, this one is a
   * composition radius and it has to cover the drawn silhouette, not the body.
   */
  subjectClearRadius: 1.25,
  /**
   * Minimum standoff for the HAND-FRAMED modes (Orbit, Cinematic), metres.
   *
   * `bike-detail` is authored at 2.3 m, and at 2.3 m the lens is INSIDE the
   * emitter volume: the wheels throw dust from the contact patch, a plume grows
   * to nearly two metres across, and several of them end up strung out between
   * the camera and the bike. The corridor fade in DustSystem removes what does
   * get in the way, but a camera that is standing in the dust cloud is asking
   * that fade to save every single frame. Outside the cloud is a better place
   * to be, and 3.25 m still frames a bike portrait that fills half the raster.
   */
  framedMinDist: 3.25,
  /** Radius of another rider's body as an occluding cylinder. */
  occluderRadius: 1.10,
  /** Clearance kept between the camera and an occluder on the boom line. */
  occluderClearance: 1.25,
  /**
   * The occluder rule may never retract the arm below this fraction of what the
   * shot asked for. In a four-up pack somebody is nearly always somewhere on
   * the arm, and a rule that answers every one of them by diving toward the
   * rider is not a camera, it is a yo-yo. Past this floor the response switches
   * to rising over the intruder instead.
   */
  occluderBoomFloor: 0.86,
  /** Horizontal radius around the camera within which a rider forces a lift. */
  occluderLiftRadius: 1.70,
  /**
   * Ceiling on how steeply the arm may point upward, as sin(elevation). Without
   * it a rider dropping down a face drags the arm to vertical and the shot
   * becomes a plan view of a helmet. 0.72 is about 46 degrees — a steep
   * three-quarter, which still reads as a rider on a mountain.
   */
  boomMaxRise: 0.72,
  /** Height of a rider's head above their BikeState.position. */
  riderTop: 1.75,

  /**
   * Peak shake DISPLACEMENT in metres at amount 1.0.
   *
   * Deliberately small, and it used to be 0.42. Displacing the rig is the wrong
   * half of a screenshake and the review set proves it: `compose` re-aims at the
   * subject every frame (`camera.lookAt(_lookFinal)`), so a translation of the
   * camera does NOT move the subject across the frame — it changes the standoff.
   * Measured on `crash`, where the orbit had closed to 3.4 m, 0.42 m of shake
   * put 0.73 m on the arm and the subject's projected span pulsed 295→393→295 px
   * inside six frames. That is a zoom lens being pumped, not an impact. Worse,
   * a translation moves near geometry by offset/depth and the ridge line at
   * 400 m by nothing at all, so most of the frame does not move even when the
   * near ground is swimming.
   *
   * The punch is `shakeDegrees` below. This term survives only as the WEIGHT
   * cue — the parallax shift of the near ground that says the camera is a
   * physical object — at an amplitude that cannot pump the framing.
   */
  shakeMetres: 0.11,
  /**
   * Peak angular shake in DEGREES at amount 1.0, before the envelope.
   *
   * This is the shake. A rotation displaces every pixel in the frame by the same
   * amount regardless of depth, which is what "the camera was struck" looks
   * like, and it costs the subject's apparent size nothing. 2.6 degrees on a
   * 900 px frame at 62 degrees vertical is about 38 px at the peak of a full-
   * severity crash and about 22 px on a heavy landing.
   */
  shakeDegrees: 2.6,
  /**
   * Distance, in metres, at which `shakeMetres` is the literal displacement.
   * Closer than this the translation is scaled DOWN in proportion, so the
   * parallax cue is a constant fraction of the standoff instead of a 20% arm
   * modulation on a tight orbit and 2% on a 52 m crane.
   */
  shakeStandoffRef: 4.6,
  shakeStandoffMin: 0.45,
  shakeStandoffMax: 1.5,
  /** Primary oscillation, rad/s (~10 Hz). */
  shakeFrequency: 62,

  // ── The rest of a crash, felt ─────────────────────────────────────────────
  /**
   * A crash is not one impact. `onCrash` fires on the frame the solver changes
   * mode and then the camera hears NOTHING for the two seconds in which a body
   * and a bike bounce off a rock garden — because nothing else calls into this
   * class. `src/fx/index.ts` detects those strikes for the dust and the impact
   * flash (`crashStrikes`) and does not, and cannot, route them here.
   *
   * So detect them here too, off the same state, with the same test: a contact
   * rising edge, or a single-frame speed loss too large to be friction. Measured
   * on the `crash` sequence the hard one is f0027→f0028, 15.6→8.9 km/h in 16 ms.
   * A reviewer cross-correlating static geometry across the impact frames found
   * a smooth orbit drift and no impulse whatsoever, and they were right: there
   * was no second impulse in the entire sequence.
   *
   * 6 m/s² of friction over a 60 Hz frame is 0.1 m/s; four times that in one
   * frame is the ground arriving.
   */
  crashStrikeDrop: 0.42,
  crashStrikeCooldown: 0.13,
  /**
   * Sized so the hardest secondary strike lands at about two thirds of the
   * crash's own entry impulse (`onCrash` asks for 0.65 + 0.85·severity). The
   * second bang being smaller than the first is most of what makes a tumble
   * read as a tumble rather than as a sequence of unrelated hits.
   */
  crashStrikeAmp: 0.22,
  crashStrikeAmpGain: 0.80,
  crashStrikeDur: 0.30,

  /** Vertical escape when shortening cannot solve it. Bounded, unlike `depth/s`. */
  liftMax: 2.6,
  liftAttackHL: 0.05,
  liftReleaseHL: 0.30,

  // ── Framed-shot elevation solve ────────────────────────────────────────────
  /**
   * A hand-framed shot (Orbit, Cinematic) may not be shortened — `summit-wide`
   * is a deliberate 52 m crane and `valley-vista` a 180 m establishing shot —
   * but it may be RAISED, and it must be, because the mountain does not care
   * what yaw and pitch an author typed. `ravine-gap` is authored at 19 m and
   * 12.6 degrees of elevation on a slope that is steeper than that: the camera
   * lands inside the hillside, the unconditional terrain floor shoves it back
   * out to sit ON the surface, and the shot becomes a violet-grey slab with the
   * rider somewhere behind it. Measured: 0 subject pixels in the frame.
   *
   * So the arm is rotated UP about the pivot, in fixed steps, until the camera
   * end is clear of the ground and the whole sight line to the subject is
   * clear. Rotating rather than lifting keeps the authored DISTANCE and AZIMUTH
   * exactly — the shot's scale and its side are what the author chose, and the
   * elevation is the one axis the terrain has a legitimate vote on. It is also
   * self-correcting for the ravine specifically: swinging up at constant radius
   * pulls the camera horizontally in off the hillside and out over the void,
   * which is precisely where the shot wants to be.
   *
   * Searched from the authored elevation, never below it, and capped so a
   * blocked shot degrades to a steep three-quarter rather than to a map view.
   *
   * MEASURED, current build: `ravine-gap` spends 30.1 degrees of rise and lands
   * at 42.8 degrees of elevation — a steep three-quarter, inside the 71 degree
   * cap — with the camera clear of the hillside and 52 px of subject in frame,
   * against 0 px before. `treeline-silhouette` spends 21.5, `rider-closeup` and
   * `rockgarden-low` 2.9 each, and every other framed pose spends nothing.
   *
   * 52 px is legible but it is not a subject, and it is not the solver's to
   * fix: it is the authored `dist: 19` in the situation table. The elevation
   * solve can put the lens somewhere it can SEE from; it cannot make a 19 m
   * shot into a close one without throwing away the scale the author chose.
   */
  framedRiseStep: 0.075,
  framedRiseMax: 0.90,
  framedRiseMaxElev: 1.24,
  framedRiseAttackHL: 0.06,
  /**
   * Release is fast for a smoothing term — 0.10 s, not the 0.34 s the vertical
   * escape uses. This correction is a SOLVED CONSTRAINT, not a spring: the
   * moment the shot is legal again the authored framing is the right answer and
   * every frame spent easing back to it is a frame of a shot nobody composed.
   * It also has to converge inside the twelve frames the capture harness settles
   * for, or every still ships a half-released correction.
   */
  framedRiseReleaseHL: 0.10,
  framedClearSamples: 7,
  /**
   * ...and the second axis. Elevation alone can only ever crane, and craning
   * far enough turns a shot into a map, so the solve searches azimuth as well
   * and takes whichever is cheaper.
   *
   * WHAT IT ACTUALLY COSTS. A candidate is priced
   *   |az|·framedAzCost + |az − framedAz|·framedAzStickCost + rise
   * in radians. The second term is hysteresis — hold the side you are already
   * on, because a camera that re-picks its side every frame is worse than one
   * that picks a mediocre side and stays there — but note that at rest
   * `framedAz` is 0, which is the steady state of every authored pose, and
   * there the two terms collapse to |az|·1.20. So in practice azimuth is priced
   * ABOVE rise, not below it, and only wins when it is a LOT cheaper in
   * geometry. That is deliberate: the author picked the side, and the mountain
   * gets a vote on the elevation before it gets one on the side.
   *
   * WHAT IT DOES ON THE CURRENT POSE SET: nothing, and that is the correct
   * answer rather than a dead axis. Mapping `framedClear` over the whole
   * (azimuth, rise) grid for every framed pose — `tools/capture/_framedmap.mjs`
   * — the minimum clear rise at the authored azimuth, and the nearest azimuth
   * that is clear with NO rise, come out:
   *
   *   ravine-gap           0°: 30° rise    nearest 0-rise azimuth: −60°
   *   treeline-silhouette  0°: 21° rise    nearest 0-rise azimuth: +80°
   *   rockgarden-low       0°:  4° rise    nearest 0-rise azimuth: −20° (0°)
   *   rider-closeup        0°:  4° rise    nearest 0-rise azimuth: −20° (0°)
   *
   * A 60-degree swing costs 0.79 rad even with the stickiness term removed
   * entirely, against 0.53 for the 30-degree crane, so rise wins on ravine-gap
   * under ANY pricing that keeps yaw and pitch within a factor of two of each
   * other. An earlier revision of this comment claimed a 20-degree step was
   * clear at ravine-gap's authored elevation; that was measured on the old pose
   * that framed the CROSSING. The pose now frames the approach and the claim no
   * longer holds — re-measured, ±20° there needs 26-30° of rise, more than
   * doing nothing. Do not re-tune the weights to force this axis to fire.
   *
   * What the axis is actually for is the case rise cannot solve at all: when
   * nothing within `framedRiseMax` is clear the rise column returns the
   * infinite-cost fallback, every azimuth column is then searched, and a shot
   * that would otherwise ship as a hillside interior becomes a shot from the
   * side. That case does not occur on today's poses. It is a floor, not a
   * preference.
   */
  framedAzStep: 0.35,
  framedAzMax: 2.80,
  framedAzCost: 0.75,
  framedAzStickCost: 0.45,
  framedAzAttackHL: 0.10,
  framedAzReleaseHL: 0.12,

  /** Another rider begins dithering out at this range and is gone by `Full`. */
  nearFadeStart: 2.60,
  nearFadeFull: 1.05,

  // ── Safe-area composition ──────────────────────────────────────────────────
  /**
   * The HUD owns the top 20% and the bottom 12% of the frame. Compose inside
   * that with a margin, and hold an inner band so the controller is not
   * constantly correcting a subject that is already fine.
   */
  safeTop: 0.255,
  safeBottom: 0.800,
  safeInnerPad: 0.045,
  /**
   * The subject box the framing loop measures, metres above and below
   * `BikeState.position`. NOT the collision extents and not `riderTop`.
   *
   * It used to measure +1.75 / −0.48, and both ends were wrong in the same
   * direction: the drawn silhouette's centre sits about 0.05 of frame height
   * BELOW the centre of that box, because the head never reaches 1.75 and the
   * wheels and their contact shadow go well past −0.48. So the loop was
   * satisfied — measured, `switchback` held its modelled bottom at 0.823
   * against a 0.815 limit — while the thing on screen was at 0.868 with both
   * contact patches and the cranks under the boost bar. Measured from the
   * difference-rendered silhouette on the shipped frames.
   */
  frameBoxTop: 1.58,
  frameBoxBottom: -0.62,
  /**
   * The same box for a subject that is NO LONGER UPRIGHT, lerped in on the
   * crash envelope.
   *
   * A wreck is not a 2.2 m vertical silhouette with its feet at the origin, and
   * feeding the standing box to the framing loop during one is how `crash`
   * ended up with the bike below the frame edge while the controller reported
   * itself satisfied. Measured off the shipped `crash` f0056: the drawn wreck
   * ran from about +0.70 down to about −1.05 of `BikeState.position`, a box
   * whose centre is 0.63 m BELOW the centre of the standing one — which at that
   * shot's 4.2 m and 55 degrees is 0.145 of frame height, 130 px of subject
   * pushed toward the bottom edge. The loop was not failing; it was being told
   * the wrong shape.
   */
  crashBoxTop: 0.72,
  crashBoxBottom: -1.05,
  frameBiasMax: 3.0,
  /** Loop gain. Under 1 so the controller converges rather than ringing. */
  frameBiasGain: 0.6,
  frameBiasCorrectHL: 0.18,
  frameBiasRelaxHL: 0.55,

  // ── Air swing ──────────────────────────────────────────────────────────────
  /**
   * THE GATES ARE SIZED AGAINST WHAT THE COURSE ACTUALLY LAUNCHES YOU OFF, and
   * that is a much smaller number than anybody writing this file has assumed.
   *
   * MEASURED, every sequence in the review set, peak air height and total hang:
   *
   *   switchback     1.97 m   0.30 s      tabletop-air   0.75 m   0.38 s
   *   trick-360      0.71 m   0.36 s      landing        0.55 m   0.30 s
   *   crash / launch / scree-speed / pack-race:  never leaves the ground
   *
   * The previous gates asked for 2.2 m of air AND 0.72 s of flight remaining
   * AFTER 0.20 s had already elapsed — i.e. about 0.9 s of hang time, three
   * times the longest jump on the mountain. The swing could not fire, has never
   * fired, and an earlier report that it fired on 71 of 200 frames cannot have
   * been measuring this code path. Same for the slow-mo's 5.5 m.
   *
   * These are not "lowered thresholds", they are the first ones that have ever
   * been in range. 0.55 m of air with 0.26 s left is a real hop off a real
   * feature; anything under it is suspension travel.
   */
  airSwingArc: 1.15,
  airSwingMinAirTime: 0.06,
  airSwingMinRemaining: 0.26,
  airSwingMinPeak: 0.55,
  airSwingBailout: 0.13,
  airSwingCooldown: 1.5,
  airSwingRise: 1.4,
  /**
   * The arc is SCALED by the size of the jump, between these two peaks. A 66°
   * whip around a 0.6 m hop is a camera having a seizure; the same whip around
   * a 3 m table is the shot. Interpolated on the peak air height so the two
   * cases get 28° and 66° respectively out of one code path.
   */
  airSwingScaleFrom: 0.55,
  airSwingScaleTo: 3.2,
  airSwingScaleMin: 0.42,

  // ── Slow-mo ────────────────────────────────────────────────────────────────
  /**
   * Rare by construction, and now reachable. 1.5 m is above every hop in the
   * review set except the one genuine launch on `switchback`, so exactly one
   * sequence in eight holds — which is what "on the biggest jumps" means. The
   * apex is detected by the SIGN of the vertical velocity, never by a clock:
   * the old `airTime > 0.85` window was wider than the whole flight.
   */
  slowMoMinPeak: 1.5,
  slowMoMinAirTime: 0.10,
  slowMoMinRemaining: 0.08,
  slowMoScale: 0.38,
  slowMoAttack: 0.12,
  slowMoHold: 0.30,
  slowMoRelease: 0.32,
  slowMoCooldown: 9.0,

  // ── Crash focus ────────────────────────────────────────────────────────────
  crashFocusAttack: 0.16,
  crashFocusHold: 1.15,
  crashFocusRelease: 0.85,
  /** Boom multiplier at full focus — the push-in. */
  crashFocusPull: 0.88,
  crashFocusRise: 0.45,
  /** Lens narrows into the crash. Widening it would flatten the impact. */
  crashFocusFov: 7.0,
  crashSlowMoMinSeverity: 0.28,
  crashSlowMoScale: 0.45,
  crashSlowMoAttack: 0.09,
  crashSlowMoHold: 0.34,
  crashSlowMoRelease: 0.40,
  crashSlowMoCooldown: 4.0,

  // ── The crash, seen from a hand-framed orbit ───────────────────────────────
  /**
   * `crashFocusPull` and `crashFocusRise` live on the chase arm and the review
   * set's `crash` is shot from an ORBIT, so for the one sequence named after
   * the event none of the crash language applied: measured, the orbit held a
   * constant 8.00 m and a constant 0.35 rad/s for the whole 2 s while the
   * subject fell to 62 px and the reviewer lost it outright.
   *
   * Three terms, all multiplied by the same envelope, all zero when nothing has
   * gone wrong — so no still pose can be touched by them:
   *
   *   PULL   the arc closes. A wreck is the one moment the author's standoff
   *          is definitely wrong.
   *   SPIN   the arc accelerates 3.4×, ~150 degrees over the envelope. A
   *          constant-rate orbit through a crash reads as indifference.
   *   RISE   the elevation lifts 0.38 rad. A rider on the ground is a
   *          HORIZONTAL subject and the authored 10 degrees is edge-on to it —
   *          which is most of where the missing pixels went.
   *
   * The PULL is expressed as a SUBJECT FRACTION and not as a distance
   * multiplier, and the difference is not cosmetic. As a multiplier it composed
   * with the legibility close below — that solve had already brought 8 m in to
   * the distance which puts the subject at 29.5% of frame, and then 0.55 of
   * THAT put it at 54%. Measured on the shipped `crash`: 3.25-3.49 m, subject
   * span 338-393 px against a 266 px target, sitting hard on the bottom edge.
   * One over-correction of one under-correction. Stated as a fraction there is
   * exactly one number in the file that decides how big the wreck is.
   */
  crashOrbitFrac: 0.40,
  crashOrbitSpin: 2.4,
  crashOrbitRise: 0.38,
  crashOrbitMaxPitch: 1.15,
  /**
   * THERE IS NO CRASH AIM OFFSET, and there was one for about an hour.
   *
   * 1.1 m above `BikeState.position` is a rider's chest when they are on a bike
   * and half a metre of empty air above a rider who is on their back, so
   * dropping the aim during a wreck looks like the obvious fix and it measures
   * beautifully — right up until you look at the frame. Lowering the aim lowers
   * the whole arm with it, and 0.65 m of drop at a 4.5 m standoff put the
   * camera end far enough into the hillside that `solveFramedRise` answered
   * with 0.68 rad of crane. Authored 0.18, plus the crash rise, plus that:
   * 71 degrees, a PLAN VIEW of a wreck, subject span collapsed from 320 px to
   * 127 by foreshortening alone. Measured on `crash` f0054-f0060.
   *
   * The vertical framing is already solved, correctly and in closed loop, by
   * `crashBoxTop`/`crashBoxBottom` — which move the LOOK POINT and leave the
   * arm exactly where the shot put it. Two mechanisms for one job, one of them
   * open-loop and with a side effect, is one too many.
   */

  // ── Orbit legibility ───────────────────────────────────────────────────────
  /**
   * A hand-framed orbit is authored as one of two completely different things
   * and the number tells you which: `valley-vista` at 180 m and `summit-wide`
   * at 52 m are COMPOSITIONS, where the subject being small is the point;
   * `summit-rider` at 9 and `crash` at 8 are STANDOFFS, where the number is a
   * guess at how far back you have to stand and the subject being 128 px is
   * nobody's intent. Only the second kind is touched, and the gate is the
   * authored distance itself.
   *
   * Inside the gate the arc closes until the subject's projected span reaches
   * `orbitSubjectFrac` of frame height — the same 29.5% the chase dolly holds —
   * never past `orbitCloseFloor` of what was authored, and never inside
   * `framedMinDist`. It can only ever close: `rider-closeup` at 3.4 m is
   * already larger than the target and is left exactly where it is.
   */
  orbitCloseMaxDist: 10.5,
  orbitSubjectSpan: 1.95,
  orbitSubjectFrac: 0.295,
  orbitCloseFloor: 0.52,

  /** Retained for source compatibility; the boom solver supersedes them. */
  collisionSamples: 7,
  collisionMargin: 1.15,
} as const;

function estimateAirRemaining(t: BikeState): number {
  // Ballistic time to return to the ground directly below, from the current
  // vertical velocity and height. Cheap, and good enough that the swing knows
  // when to start coming home.
  const g = BIKE.gravity;
  const vy = t.velocity.y;
  const h = Math.max(t.airHeight, 0);
  const disc = vy * vy + 2 * g * h;
  if (disc <= 0) return 0;
  return (vy + Math.sqrt(disc)) / g;
}

// ─────────────────────────────────────────────────────────────────────────────

export interface CameraDirectorOptions {
  /** The camera to drive. Pass the Engine's so aspect/resize keep working. */
  camera: PerspectiveCamera;
  terrain?: ITerrain | null;
  fovBase?: number;
  fovTop?: number;
  /**
   * The bike's forward axis in its own local space. Only used as a FALLBACK
   * when the bike is nearly stationary — the heading normally comes straight
   * from the velocity, which needs no convention at all.
   */
  forwardAxis?: Vector3;
  rng?: Rng;
  /** Detect landings/crashes from BikeState itself. Off if you drive them. */
  autoDetectEvents?: boolean;
  /** Other riders the boom must not collide with. See `setOccluders`. */
  occluders?: readonly BikeState[];
}

export class CameraDirector implements ICameraDirector {
  readonly camera: PerspectiveCamera;
  mode: CameraMode = CameraMode.Chase;

  /** The Game multiplies its dt by this. 1 normally, <1 during a big-air hold. */
  timeScale = 1;

  /** Last state passed to update(). Null before the first frame. */
  subject: BikeState | null = null;

  private terrain: ITerrain | null;
  private forwardAxis: Vector3;
  private rng: Rng;
  private autoDetect: boolean;

  // Springs.
  private sx: SpringState = makeSpring();
  private sy: SpringState = makeSpring();
  private sz: SpringState = makeSpring();
  private lx: SpringState = makeSpring();
  private ly: SpringState = makeSpring();
  private lz: SpringState = makeSpring();
  private fovS: SpringState;
  /**
   * The lens the DOLLY is solved against — speed curve plus surge, on its own
   * spring with the same constants as `fovS` so the arm and the lens never
   * drift out of phase.
   */
  private dollyFovS: SpringState;

  // Composed each frame.
  private camPos = new Vector3(0, 5, 10);
  private lookPos = new Vector3();

  // Heading.
  private aimYaw = 0;
  private prevYaw = 0;
  private yawRate = 0;
  private roll = 0;
  private headingPrimed = false;

  // FOV.
  private fovBase: number;
  private fovTop: number;
  private kick = 0;
  private prevBoosting = false;
  /** Lagged speed. The surge is the difference. Negative until first seen. */
  private speedLag = -1;
  private surge = 0;

  // Speed buffet. A lens wobble, so it is applied where the shake is applied
  // and never enters the boom solve or the springs. Angular first — see
  // `buffetDegrees` for the measurement that settled it.
  private buffetOffset = new Vector3();
  private buffetPhaseA = 0;
  private buffetPhaseB = 0;
  private buffetPhaseC = 0;
  private buffetYaw = 0;
  private buffetPitch = 0;
  private buffetRoll = 0;

  // Shake. `shakeOffset` is the parallax translation; the yaw/pitch/roll triple
  // is the punch. See `shakeDegrees`.
  private shakeAmp = 0;
  private shakeT = 0;
  private shakeDur = 0;
  private shakeSeed = 0;
  private shakeDir = new Vector3(0, 1, 0);
  private shakeOffset = new Vector3();
  private shakeYaw = 0;
  private shakePitch = 0;
  private shakeRoll = 0;
  /** Distance the shake is being applied at, for the standoff scaling. */
  private shakeStandoff: number = CAMERA_TUNING.shakeStandoffRef;

  // Air swing.
  private swingActive = false;
  private swingT = 0;
  private swingDur = 1;
  private swingDir = 1;
  private swingAmount = 0;
  private swingCooldown = 0;
  /** Arc of the CURRENT swing, radians. Scaled by the size of the jump. */
  private swingArc: number = CAMERA_TUNING.airSwingArc;

  // Slow-mo. The envelope shape is captured at trigger time so a crash hold and
  // a big-air hold can have different timing without two state machines.
  private slowActive = false;
  private slowT = 0;
  private slowCooldown = 0;
  private slowScale: number = CAMERA_TUNING.slowMoScale;
  private slowA: number = CAMERA_TUNING.slowMoAttack;
  private slowH: number = CAMERA_TUNING.slowMoHold;
  private slowR: number = CAMERA_TUNING.slowMoRelease;
  private slowCool: number = CAMERA_TUNING.slowMoCooldown;

  // Crash focus.
  private crashT = -1;
  private crashFocus = 0;

  // The rest of a crash. See `crashStrikeDrop`.
  private crashPrevSpeed = 0;
  private crashPrevContact = false;
  private crashStrikeCd = 0;

  // Boom solver state.
  /** Metres the boom is currently retracted from what the springs asked for. */
  private boomRetract = 0;
  /** Vertical escape currently applied. Bounded by `liftMax`. */
  private collisionLift = 0;
  /**
   * Extra ELEVATION applied to a hand-framed arm, radians. Never negative — the
   * solver can only ever raise a shot, never drop it below what was authored.
   */
  private framedRise = 0;
  /** Extra AZIMUTH applied to a hand-framed arm, radians, signed. */
  private framedAz = 0;
  /** Last solved boom length, pivot to camera. */
  private boomLength = 0;
  /**
   * The boom length the active mode ASKED for this frame, before any constraint.
   * The leash is measured against this and not against the previous solution —
   * leashing to the last frame would let the arm grow by a full slack every
   * frame, which is not a leash at all.
   */
  private boomDesired = 8;

  // Occluders (other riders).
  private occluders: readonly BikeState[] | null = null;
  private occNodes: (Object3D | null)[] = new Array(MAX_OCCLUDERS).fill(null);
  private occCount = 0;
  private discovered: Object3D[] = [];
  private discoveredBodies: Object3D[] = [];
  private discoverTimer = 0;
  private discoveredSceneKids = -1;
  private autoDiscover = true;

  // Safe-area framing controller.
  private frameBias = 0;

  // Subject continuity.
  private lastSubject = new Vector3();
  private subjectSeen = false;

  // Event edge detection.
  private prevAirborne = false;
  private prevCrashing = false;
  private landCooldown = 0;
  private crashCooldown = 0;

  // Cinematic.
  private cineAnchor = new Vector3();
  private cineValid = false;
  private cineSide = 1;

  // Orbit / free / fixed.
  private orbitYaw = 0.6;
  private orbitPitch = 0.22;
  private orbitDist = 9;
  private orbitSpin = 0.35;
  private freePos = new Vector3(0, 8, 20);
  private freeYaw = 0;
  private freePitch = 0;
  private freeInput = { forward: 0, strafe: 0, lift: 0, yaw: 0, pitch: 0, speed: 1 };
  private fixedPos = new Vector3(0, 5, 10);
  private fixedLook = new Vector3();

  // Replay.
  private replaySource: IReplayRecorder | null = null;
  private replayT = 0;
  private replayStart = 0;
  private replayEnd = 0;
  private replaySpeed = 0.55;
  private replayBaseYaw = 0;
  /** Sampled replay subject — the Game can pose a ghost bike from these. */
  readonly replayPosition = new Vector3();
  readonly replayOrientation = new Quaternion();
  replayProgress = 0;

  /** Fired on a detected landing / crash. The FX facade hangs dust off these. */
  onLandingEvent: ((state: BikeState, impact: number) => void) | null = null;
  onCrashEvent: ((state: BikeState, severity: number) => void) | null = null;

  constructor(opts: CameraDirectorOptions) {
    this.camera = opts.camera;
    this.terrain = opts.terrain ?? null;
    this.forwardAxis = (opts.forwardAxis ?? new Vector3(0, 0, 1)).clone().normalize();
    this.rng = opts.rng ?? new Rng('fx:camera');
    this.autoDetect = opts.autoDetectEvents ?? true;
    this.fovBase = opts.fovBase ?? CAMERA_TUNING.fovBase;
    this.fovTop = opts.fovTop ?? CAMERA_TUNING.fovTop;
    this.fovS = makeSpring(this.fovBase);
    this.dollyFovS = makeSpring(this.fovBase);
    this.camera.fov = this.fovBase;
    this.camera.updateProjectionMatrix();
    this.camPos.copy(this.camera.position);
    this.sx.value = this.camPos.x;
    this.sy.value = this.camPos.y;
    this.sz.value = this.camPos.z;
    if (opts.occluders) this.setOccluders(opts.occluders);
  }

  setTerrain(t: ITerrain | null): void {
    this.terrain = t;
  }

  get lookAtPoint(): Vector3 {
    return this.lookPos;
  }

  /** Current solved boom length, metres, pivot-to-camera. Read-only, for tests. */
  get boomDistance(): number {
    return this.boomLength;
  }

  // ── Occluders ─────────────────────────────────────────────────────────────

  /**
   * Register the OTHER riders on the mountain so the boom can avoid them.
   *
   * This is the supported path and the Game should call it once, with every
   * non-player racer's BikeState:
   *
   *   dir.setOccluders(race.racers.filter(r => r !== race.player).map(r => r.bike.state));
   *
   * Passing null re-enables the scene-scan fallback below.
   */
  setOccluders(states: readonly BikeState[] | null): void {
    this.occluders = states && states.length ? states : null;
    this.autoDiscover = !this.occluders;
    if (this.occluders) {
      this.discovered.length = 0;
      this.discoveredBodies.length = 0;
    }
  }

  /**
   * Fallback discovery, used until `setOccluders` is called.
   *
   * The racers are direct children of the scene named `racer:<id>`, each holding
   * a `bike:<id>` group that carries the world transform. Scanning for them costs
   * one shallow pass over the scene's children, is re-run at most every two
   * seconds, and lets the boom solver be correct in a build where nothing has
   * wired the explicit path yet. It is deliberately a fallback: an explicit list
   * is cheaper and does not depend on node names.
   */
  private discoverOccluders(dt: number): void {
    this.discoverTimer -= dt;
    const scene = this.terrain?.object?.parent ?? this.camera.parent;
    if (!scene) return;
    if (this.discoverTimer > 0 && scene.children.length === this.discoveredSceneKids) return;
    this.discoverTimer = 2.0;
    this.discoveredSceneKids = scene.children.length;

    // Restore anything the near-fade hid before dropping it from the list —
    // a node that leaves the list while invisible would never come back.
    this.clearNearFade();
    this.discovered.length = 0;
    this.discoveredBodies.length = 0;
    const kids = scene.children;
    for (let i = 0; i < kids.length && this.discovered.length < MAX_OCCLUDERS; i++) {
      const node = kids[i];
      if (!node.name || node.name.lastIndexOf('racer:', 0) !== 0) continue;
      let body: Object3D | null = null;
      for (let j = 0; j < node.children.length; j++) {
        const c = node.children[j];
        if (c.name && c.name.lastIndexOf('bike:', 0) === 0) {
          body = c;
          break;
        }
      }
      this.discovered.push(node);
      this.discoveredBodies.push(body ?? node);
    }
  }

  /**
   * Fill `_occPos` / `occNodes` with every rider that is NOT the subject.
   * Zero allocation: the slots are module-scope and refilled in place.
   */
  private gatherOccluders(subject: BikeState, dt: number): void {
    this.occCount = 0;

    if (this.occluders) {
      for (let i = 0; i < this.occluders.length && this.occCount < MAX_OCCLUDERS; i++) {
        const s = this.occluders[i];
        if (s === subject) continue;
        _occPos[this.occCount].copy(s.position);
        this.occNodes[this.occCount] = null;
        this.occCount++;
      }
      return;
    }

    if (!this.autoDiscover) return;
    this.discoverOccluders(dt);

    for (let i = 0; i < this.discoveredBodies.length && this.occCount < MAX_OCCLUDERS; i++) {
      const body = this.discoveredBodies[i];
      const e = body.matrixWorld.elements;
      // The subject is in this list too — identify it by position rather than by
      // name, so the camera never has to know what the player's node is called.
      const dx = e[12] - subject.position.x;
      const dz = e[14] - subject.position.z;
      if (dx * dx + dz * dz < 0.36) continue;
      _occPos[this.occCount].set(e[12], e[13], e[14]);
      this.occNodes[this.occCount] = this.discovered[i];
      this.occCount++;
    }
  }

  // ── Frame ─────────────────────────────────────────────────────────────────

  /**
   * `dt` is the SCALED delta — the camera slows with the world. `realDt` is
   * optional and defaults to `dt`; pass the unscaled delta so the slow-mo
   * envelope can end (driving it with its own output would never release).
   */
  update(target: BikeState, dt: number, time: number, realDt?: number): void {
    this.subject = target;
    const d = clamp(dt, 0, 0.1);
    const rd = clamp(realDt ?? dt, 0, 0.1);

    // A teleport is not a fast movement, and a spring told to treat it as one
    // loses the subject completely for as long as it takes to catch up. Re-seat
    // instead. See `subjectJumpMax`. Chase only: Orbit rebuilds its position
    // from the subject every frame and has nothing to re-seat, and Replay is
    // driven by the recorder rather than by this state at all.
    if (this.subjectSeen && this.mode === CameraMode.Chase) {
      _tmp.copy(target.position).sub(this.lastSubject);
      if (_tmp.lengthSq() > CAMERA_TUNING.subjectJumpMax * CAMERA_TUNING.subjectJumpMax) {
        this.resetTo(target);
      }
    }
    this.lastSubject.copy(target.position);
    this.subjectSeen = true;

    if (this.autoDetect) this.detectEvents(target, rd);
    this.updateCrashFocus(rd);
    this.gatherOccluders(target, rd);

    switch (this.mode) {
      case CameraMode.Chase:
        this.updateChase(target, d);
        break;
      case CameraMode.Cinematic:
        this.updateCinematic(target, d, time);
        break;
      case CameraMode.Replay:
        this.updateReplay(d);
        break;
      case CameraMode.Orbit:
        this.updateOrbit(target, d);
        break;
      case CameraMode.Free:
        this.updateFree(d);
        break;
      case CameraMode.Fixed:
        this.camPos.copy(this.fixedPos);
        this.lookPos.copy(this.fixedLook);
        break;
    }

    this.updateFov(this.mode === CameraMode.Chase ? target : null, d);
    this.updateSlowMo(target, rd);
    this.compose(target, d);
  }

  // ── Speed shaping ─────────────────────────────────────────────────────────

  /**
   * The speed-driven FOV in degrees, before kicks, surge, air and crash terms.
   *
   * Split out because the DOLLY is fed this and not `camera.fov`. Feeding it the
   * composed FOV would make the standoff compensate every transient — a boost
   * kick would open the lens and pull the camera in by exactly enough to cancel
   * it, and the kick would be invisible. The dolly answers the speed curve; the
   * transients are meant to survive it.
   */
  private speedFov(speed: number): number {
    const s01 = clamp01(speed / CAMERA_TUNING.referenceSpeed);
    const k = 1 - Math.pow(1 - s01, CAMERA_TUNING.fovSaturation);
    return this.fovBase + (this.fovTop - this.fovBase) * k;
  }

  /**
   * Standoff that holds the subject at a constant apparent size, for a given
   * lens. See the header.
   */
  private chaseStandoff(fovDeg: number): number {
    const t = Math.tan(fovDeg * DEG * 0.5);
    return clamp(
      CAMERA_TUNING.framingConstant / Math.max(t, 1e-3),
      CAMERA_TUNING.chaseDistMin,
      CAMERA_TUNING.chaseDistMax,
    );
  }

  /** The surge, in degrees of lens, clamped. Shared by the FOV and the dolly. */
  private surgeFov(): number {
    return clamp(
      this.surge * CAMERA_TUNING.surgeFovGain,
      CAMERA_TUNING.surgeFovMin,
      CAMERA_TUNING.surgeFovMax,
    );
  }

  /**
   * The buffet. Deterministic simplex, no allocation, evaluated on the sim
   * clock so two runs of the capture harness produce identical frames.
   *
   * Written into `buffetOffset` rather than added to `camPos`, because anything
   * added before `resolveBoom` is written back into the springs and becomes a
   * permanent part of the arm rather than a wobble on the lens.
   */
  private updateBuffet(speed01: number, dt: number, right: Vector3): void {
    const from = CAMERA_TUNING.buffetFrom;
    const k = clamp01((speed01 - from) / Math.max(1 - from, 1e-3));
    // Squared-ish ramp so the term is genuinely absent at cruising speed and
    // doubles across the band the fast sequences occupy. `(1 - crashFocus)`
    // because a wreck has its own language and does not need this one on top.
    const g = Math.pow(k, 1.6) * (1 - this.crashFocus);

    // Phase FIRST and unconditionally, so the noise is continuous across the
    // amplitude gate and across every change of rate. See `buffetRateGain`.
    const rk = lerp(1, CAMERA_TUNING.buffetRateGain, g);
    this.buffetPhaseA += CAMERA_TUNING.buffetRateA * rk * dt;
    this.buffetPhaseB += CAMERA_TUNING.buffetRateB * rk * dt;
    this.buffetPhaseC += CAMERA_TUNING.buffetRateC * rk * dt;

    if (g < 1e-4) {
      this.buffetOffset.set(0, 0, 0);
      this.buffetYaw = 0;
      this.buffetPitch = 0;
      this.buffetRoll = 0;
      return;
    }
    const a = SHAKE_NOISE.noise(this.buffetPhaseA, 31.7);
    const b = SHAKE_NOISE.noise(this.buffetPhaseB, 47.3);
    const c = SHAKE_NOISE.noise(this.buffetPhaseC, 63.9);

    // The punch: an angular wobble, which moves the ridge line and the sky by
    // exactly as many pixels as it moves the ground under the wheels.
    const ang = g * CAMERA_TUNING.buffetDegrees * DEG;
    this.buffetYaw = a * ang;
    this.buffetPitch = b * ang * CAMERA_TUNING.buffetPitchFrac;
    this.buffetRoll = c * ang * CAMERA_TUNING.buffetRollFrac;

    // The residual translation. Near-field parallax only — it is deliberately
    // decorrelated from the rotation so the two do not read as one gesture.
    const amp = g * CAMERA_TUNING.buffetMetres;
    this.buffetOffset.copy(right).multiplyScalar(c * amp);
    this.buffetOffset.y += a * amp * 0.8;
  }

  // ── Chase ─────────────────────────────────────────────────────────────────

  private updateChase(t: BikeState, dt: number): void {
    _flatVel.copy(t.velocity);
    _flatVel.y = 0;
    const planar = _flatVel.length();

    let travelYaw = this.aimYaw;
    if (planar > 1.2) {
      travelYaw = Math.atan2(_flatVel.x, _flatVel.z);
    } else {
      // Fallback only. The heading normally comes from velocity, which needs
      // no assumption about which local axis the bike calls "forward".
      _fwd.copy(this.forwardAxis).applyQuaternion(t.orientation);
      _fwd.y = 0;
      if (_fwd.lengthSq() > 1e-5) travelYaw = Math.atan2(_fwd.x, _fwd.z);
    }

    if (!this.headingPrimed) {
      this.aimYaw = travelYaw;
      this.prevYaw = travelYaw;
      this.headingPrimed = true;
    }

    const spd = t.speed;
    const speed01 = clamp01(spd / CAMERA_TUNING.referenceSpeed);
    const cf = this.crashFocus;

    // THE SURGE, and the lens the DOLLY is solved against.
    //
    // The dolly sees the speed curve and the surge, and nothing else. That
    // split is the whole design of both terms:
    //
    //   IN  — the surge, because a lens transient that is not matched by the
    //         arm is just a slow zoom that eats optical flow. Matched, it
    //         becomes a dolly zoom: the subject holds its size to the pixel
    //         while the mountain behind it stretches and contracts. That is
    //         both the more dramatic effect and the one that does not cancel
    //         the speed cue it was added to express.
    //   OUT — the crash narrowing, the airborne narrowing and the boost kick,
    //         all of which are supposed to change the framing. Feeding the
    //         crash's 7° of narrowing to the dolly would lengthen the arm by
    //         14% and cancel the 12% push-in almost exactly.
    //
    // Smoothed on its own spring rather than read back off `camera.fov`,
    // because `camera.fov` carries the three terms above. Same omega, so the
    // arm and the lens are always in phase.
    if (this.speedLag < 0) this.speedLag = spd;
    this.speedLag = dampHL(this.speedLag, spd, CAMERA_TUNING.surgeHalfLife, dt);
    this.surge = spd - this.speedLag;
    springStep(this.dollyFovS, this.speedFov(spd) + this.surgeFov(), 8.5, dt);

    // Yaw rate from the TRUE heading, before the lag is applied — this is the
    // corner signal, and reading it off the lagged anchor would smear it.
    const dYaw = shortAngle(this.prevYaw, travelYaw);
    this.prevYaw = travelYaw;
    const instRate = dt > 1e-4 ? clamp(dYaw / dt, -6, 6) : this.yawRate;
    this.yawRate = dampHL(this.yawRate, instRate, 0.09, dt);

    // Under crash focus the lag half-life collapses: the whip is the right
    // language for a corner and the wrong one for a wreck, where the only job
    // is to hold the subject.
    const lagHL =
      lerp(CAMERA_TUNING.lagHalfLifeSlow, CAMERA_TUNING.lagHalfLifeFast, speed01) *
      lerp(1, 0.45, cf);
    this.aimYaw = dampAngleHL(this.aimYaw, travelYaw, lagHL, dt);

    // Air framing: pull back and rise so the whole arc is legible.
    const airborne = t.mode === BikeMode.Airborne;
    const airH = airborne ? Math.max(t.airHeight, 0) : 0;
    const airLift = clamp(airH * 0.10, 0, 2.2);
    const airPull = clamp(airH * 0.16, 0, 2.8);

    this.updateAirSwing(t, dt);

    // THE DOLLY. Solved against the speed FOV, so the product that sets the
    // subject's apparent size — and the reciprocal of it, which sets the screen
    // flow — is constant across the whole speed range. See the header.
    const dist =
      (this.chaseStandoff(this.dollyFovS.value) + airPull) *
      lerp(1, CAMERA_TUNING.crashFocusPull, cf);
    const height =
      CAMERA_TUNING.chaseHeight +
      CAMERA_TUNING.chaseHeightSpeedGain * speed01 +
      airLift +
      CAMERA_TUNING.crashFocusRise * cf;

    const anchorYaw = this.aimYaw + this.swingAmount * this.swingDir * this.swingArc;
    _dirV.set(Math.sin(anchorYaw), 0, Math.cos(anchorYaw));
    // right = dir x up.
    _rightV.set(-_dirV.z, 0, _dirV.x);

    this.updateBuffet(speed01, dt, _rightV);

    // Lateral acceleration proxy. Positive yawRate turns toward +X from +Z,
    // which is a LEFT turn, whose outside is +right — so the drift sign is
    // straight through with no negation.
    const latAccel = clamp(this.yawRate * spd, -34, 34);
    const swingLat =
      clamp(
        latAccel * CAMERA_TUNING.cornerSwing,
        -CAMERA_TUNING.cornerSwingMax,
        CAMERA_TUNING.cornerSwingMax,
      ) * (1 - cf);

    // Stiffen and damp toward critical during a crash so the rig ARRIVES.
    const omega = CAMERA_TUNING.chaseOmega * lerp(1, 1.5, cf);
    const zeta = lerp(CAMERA_TUNING.chaseZeta, 0.95, cf);

    // VELOCITY FEED-FORWARD. A second-order spring chasing a target that moves
    // at a constant velocity settles with a permanent lag of v·(2ζ/ω + dt) —
    // 4.3 m at 19 m/s and 10.3 m at 47 m/s with these constants. That lag is
    // not the whip. The whip is the TRANSIENT: the overshoot when the target
    // changes direction, which is what makes a corner read. The steady-state
    // stretch just parks the camera further away the faster you go, by an
    // amount nobody chose, and it is why the rider was 7–8 m out and 12% of
    // frame height. Feeding the target's velocity forward cancels exactly that
    // term and leaves the transient untouched, so the standoff at speed is
    // whatever `chaseDistanceSpeedGain` says it is and nothing else.
    const lead = 2 * zeta / omega + dt;

    const rise =
      height +
      this.swingAmount *
        CAMERA_TUNING.airSwingRise *
        (this.swingArc / CAMERA_TUNING.airSwingArc);
    _desired
      .copy(t.position)
      .addScaledVector(_dirV, -dist)
      .addScaledVector(_rightV, swingLat)
      .addScaledVector(UP, rise)
      .addScaledVector(t.velocity, lead);

    // What the shot asked for, pivot to camera. Feeds the leash.
    const pv = rise - CAMERA_TUNING.subjectPivotHeight;
    this.boomDesired = Math.sqrt(dist * dist + swingLat * swingLat + pv * pv);

    springStepDamped(this.sx, _desired.x, omega, zeta, dt);
    springStepDamped(this.sy, _desired.y, omega * 1.25, lerp(0.92, 1.0, cf), dt);
    springStepDamped(this.sz, _desired.z, omega, zeta, dt);
    this.camPos.set(this.sx.value, this.sy.value, this.sz.value);

    // Look point: lead the rider a little so the frame shows where they are
    // going. Airborne, drop the aim so the landing stays on screen.
    const lookOmega = CAMERA_TUNING.lookOmega * lerp(1, 1.45, cf);

    // Same story on the aim. The critically-damped look spring lags a moving
    // target by v·(2/ω + dt); feed that forward so the reticle sits ON the
    // rider, then add a small genuine LEAD on top so the frame shows where they
    // are going rather than where they have been. The crash focus removes the
    // lead — mid-wreck there is no "going".
    const leadT = 2 / lookOmega + dt + 0.06 * (1 - cf);
    _lookWanted.copy(t.position);
    _lookWanted.y += 1.05;

    // THE CORNER LEAD. A straight extrapolation of the velocity aims at the
    // OUTSIDE of a corner exit — the faster you take it the further outside it
    // points, which is the opposite of leading. Bend the horizontal part of the
    // lead by the yaw rate over the lead time and it points down the arc the
    // rider is actually on. The vertical component is left alone; gravity is
    // not part of the corner.
    _tmp.copy(t.velocity).multiplyScalar(leadT);
    const bend = this.yawRate * leadT * CAMERA_TUNING.cornerLookArc * (1 - cf);
    if (Math.abs(bend) > 1e-4) {
      const cb = Math.cos(bend);
      const sb = Math.sin(bend);
      // Rotate about +Y. `yawRate` is measured as atan2(x, z), so a positive
      // rate turns +Z toward +X and the rotation matrix follows that sign.
      const nx = _tmp.x * cb + _tmp.z * sb;
      const nz = -_tmp.x * sb + _tmp.z * cb;
      _tmp.x = nx;
      _tmp.z = nz;
    }
    _lookWanted.add(_tmp);
    if (airborne) _lookWanted.y -= clamp(airH * 0.10, 0, 1.6);
    springStep(this.lx, _lookWanted.x, lookOmega, dt);
    springStep(this.ly, _lookWanted.y, lookOmega, dt);
    springStep(this.lz, _lookWanted.z, lookOmega, dt);
    this.lookPos.set(this.lx.value, this.ly.value, this.lz.value);

    const targetRoll = clamp(-latAccel * CAMERA_TUNING.rollGain, -CAMERA_TUNING.rollMax, CAMERA_TUNING.rollMax);
    this.roll = dampHL(this.roll, targetRoll, 0.10, dt);
  }

  // ── Air swing ─────────────────────────────────────────────────────────────

  private updateAirSwing(t: BikeState, dt: number): void {
    if (this.swingCooldown > 0) this.swingCooldown -= dt;

    const airborne = t.mode === BikeMode.Airborne;

    if (!this.swingActive && airborne && this.swingCooldown <= 0 && this.crashFocus <= 0.01) {
      const rem = estimateAirRemaining(t);
      // Big enough to be worth showing, early enough that there is genuinely
      // time to go out and come back before the wheels touch.
      if (
        t.airTime > CAMERA_TUNING.airSwingMinAirTime &&
        rem > CAMERA_TUNING.airSwingMinRemaining &&
        t.velocity.y > -1.0 &&
        Math.max(t.peakAirHeight, t.airHeight) > CAMERA_TUNING.airSwingMinPeak
      ) {
        this.beginAirSwing(Math.min(rem * 0.82, 2.4));
      }
    }

    if (!this.swingActive) {
      this.swingAmount = dampHL(this.swingAmount, 0, 0.14, dt);
      return;
    }

    this.swingT += dt;

    // Bail out early. Landing legibility beats showing off the trick, always.
    const rem = airborne ? estimateAirRemaining(t) : 0;
    if (!airborne || rem < CAMERA_TUNING.airSwingBailout) {
      this.swingDur = Math.min(this.swingDur, this.swingT + 0.18);
    }

    const u = clamp01(this.swingT / Math.max(this.swingDur, 0.2));
    let env: number;
    if (u < 0.42) env = ease.inOutCubic(u / 0.42);
    else if (u < 0.60) env = 1;
    else env = 1 - ease.inOutCubic((u - 0.60) / 0.40);

    this.swingAmount = dampHL(this.swingAmount, env, 0.05, dt);

    if (u >= 1) {
      this.swingActive = false;
      this.swingCooldown = CAMERA_TUNING.airSwingCooldown;
    }
  }

  beginAirSwing(duration: number): void {
    this.swingActive = true;
    this.swingT = 0;
    this.swingDur = Math.max(duration, 0.24);
    const t = this.subject;

    // Scale the arc to the jump. Everything the course actually launches you
    // off is between 0.55 m and 2 m of air, and a 66-degree whip around a
    // 0.6 m hop is not a camera move, it is a fault. See `airSwingScaleFrom`.
    const peak = t ? Math.max(t.peakAirHeight, t.airHeight) : 0;
    this.swingArc =
      CAMERA_TUNING.airSwingArc *
      lerp(
        CAMERA_TUNING.airSwingScaleMin,
        1,
        smoothstep(CAMERA_TUNING.airSwingScaleFrom, CAMERA_TUNING.airSwingScaleTo, peak),
      );
    // Orbit AGAINST the spin: the relative rotation is larger, which is what
    // makes the trick read. Orbiting with it would cancel the spin out and the
    // rider would look like they were hanging still in the air.
    if (t && Math.abs(t.angularVelocity.y) > 0.6) {
      this.swingDir = t.angularVelocity.y > 0 ? -1 : 1;
    } else if (Math.abs(this.yawRate) > 0.15) {
      this.swingDir = this.yawRate > 0 ? 1 : -1;
    } else {
      this.swingDir = this.rng.chance(0.5) ? 1 : -1;
    }
  }

  // ── FOV ───────────────────────────────────────────────────────────────────

  private updateFov(t: BikeState | null, dt: number): void {
    let target = this.fovBase;

    if (t) {
      target = this.speedFov(t.speed);
      // THE SURGE. The speed curve is a state and states stop being noticed;
      // this is its derivative, and a derivative is an event. Opens while the
      // rider is gaining, closes while they are scrubbing, and is worth nothing
      // at all at a steady 83 km/h — which is correct, because a steady 83 does
      // not feel like anything either.
      target += this.surgeFov();
      // Narrowing slightly in the air makes the height read as height. The
      // instinct is to widen for drama; widening actually flattens the drop.
      if (t.mode === BikeMode.Airborne) target -= clamp(t.airHeight * 0.22, 0, 3.2);

      if (t.boosting) {
        if (!this.prevBoosting) this.fovKick(6.5);
        target += 2.4;
      }
      this.prevBoosting = t.boosting;
    }

    // The crash push-in. Narrowing while the boom also shortens reads as the
    // camera leaning in to look, which is the whole point of the moment.
    target -= CAMERA_TUNING.crashFocusFov * this.crashFocus;

    this.kick = dampHL(this.kick, 0, 0.20, dt);
    target += this.kick;

    springStep(this.fovS, target, 8.5, dt);
    const f = clamp(this.fovS.value, 40, 110);
    if (Math.abs(this.camera.fov - f) > 1e-3) {
      this.camera.fov = f;
      this.camera.updateProjectionMatrix();
    }
  }

  fovKick(amount: number): void {
    if (amount > this.kick) this.kick = amount;
  }

  // ── Slow-mo ───────────────────────────────────────────────────────────────

  private updateSlowMo(t: BikeState | null, realDt: number): void {
    if (this.slowCooldown > 0) this.slowCooldown -= realDt;

    if (
      t &&
      !this.slowActive &&
      this.slowCooldown <= 0 &&
      this.mode === CameraMode.Chase &&
      t.mode === BikeMode.Airborne &&
      t.peakAirHeight >= CAMERA_TUNING.slowMoMinPeak &&
      t.airTime > CAMERA_TUNING.slowMoMinAirTime &&
      // At or just past apex. Detected by the SIGN of the vertical velocity, not
      // by a stopwatch — the clock version's window was a handful of frames wide
      // and it missed every single jump in the review set.
      t.velocity.y < 0.8 &&
      estimateAirRemaining(t) > CAMERA_TUNING.slowMoMinRemaining
    ) {
      this.beginSlowMo(
        CAMERA_TUNING.slowMoScale,
        CAMERA_TUNING.slowMoAttack,
        CAMERA_TUNING.slowMoHold,
        CAMERA_TUNING.slowMoRelease,
        CAMERA_TUNING.slowMoCooldown,
      );
    }

    if (!this.slowActive) {
      this.timeScale = 1;
      return;
    }

    this.slowT += realDt;
    const A = this.slowA;
    const H = this.slowH;
    const R = this.slowR;

    let s: number;
    if (this.slowT < A) s = ease.inOutCubic(this.slowT / A);
    else if (this.slowT < A + H) s = 1;
    else s = 1 - ease.inOutCubic((this.slowT - A - H) / R);

    if (this.slowT >= A + H + R) {
      this.slowActive = false;
      this.slowCooldown = this.slowCool;
      s = 0;
    }
    this.timeScale = lerp(1, this.slowScale, clamp01(s));
  }

  private beginSlowMo(scale: number, a: number, h: number, r: number, cooldown: number): void {
    this.slowActive = true;
    this.slowT = 0;
    this.slowScale = scale;
    this.slowA = a;
    this.slowH = h;
    this.slowR = r;
    this.slowCool = cooldown;
  }

  /** Force a slow-mo hold. Ignores the trigger conditions but honours nothing else. */
  triggerSlowMo(): void {
    this.beginSlowMo(
      CAMERA_TUNING.slowMoScale,
      CAMERA_TUNING.slowMoAttack,
      CAMERA_TUNING.slowMoHold,
      CAMERA_TUNING.slowMoRelease,
      CAMERA_TUNING.slowMoCooldown,
    );
  }

  // ── Crash focus ───────────────────────────────────────────────────────────

  /**
   * The 2.2s envelope that makes a wreck the best-looking thing in the game.
   * Driven on REAL time — a crash that triggers slow-mo must not also stretch
   * its own envelope, or the push-in outlives the moment it is punctuating.
   */
  private updateCrashFocus(realDt: number): void {
    if (this.crashT < 0) {
      if (this.crashFocus > 1e-4) this.crashFocus = dampHL(this.crashFocus, 0, 0.25, realDt);
      else this.crashFocus = 0;
      return;
    }

    this.crashT += realDt;
    const A = CAMERA_TUNING.crashFocusAttack;
    const H = CAMERA_TUNING.crashFocusHold;
    const R = CAMERA_TUNING.crashFocusRelease;

    let v: number;
    if (this.crashT < A) v = ease.inOutCubic(this.crashT / A);
    else if (this.crashT < A + H) v = 1;
    else v = 1 - ease.inOutCubic((this.crashT - A - H) / R);

    if (this.crashT >= A + H + R) {
      this.crashT = -1;
      v = 0;
    }
    this.crashFocus = clamp01(v);
  }

  /** Start the crash push-in by hand. Useful for scripted sequences. */
  beginCrashFocus(): void {
    this.crashT = 0;
  }

  // ── Shake ─────────────────────────────────────────────────────────────────

  /**
   * The impact envelope, evaluated at normalised time. Steep power decay for
   * the instantaneous peak, cosine term for one visible rebound in the tail.
   *
   * Shared with the dominance test below, and that sharing is the whole point.
   */
  private shakeEnvelope(u: number): number {
    if (u >= 1) return 0;
    return Math.pow(1 - u, 2.4) * (1 + 0.38 * Math.cos(u * Math.PI * 3.0));
  }

  /** How hard the camera is being shaken RIGHT NOW, in request units. */
  private shakeCurrent(): number {
    if (this.shakeDur <= 0 || this.shakeT >= this.shakeDur) return 0;
    return this.shakeAmp * this.shakeEnvelope(clamp01(this.shakeT / this.shakeDur));
  }

  shake(amount: number, duration: number): void {
    // Never downgrade a shake that is still stronger than the new request — a
    // small follow-up hit must not cut a big one short.
    //
    // Compared against the envelope's CURRENT VALUE, not against the fraction
    // of the duration left to run. Those are wildly different numbers: a 0.94 s
    // crash shake 70% of the way through has 30% of its clock remaining and
    // 6% of its amplitude. Testing the clock made a decayed shake keep veto
    // power over every new impulse for the whole of its tail, and that is
    // exactly what was measured on the `crash` sequence — the body's ground
    // impact at f0056 fired the impact flash, called straight through to here,
    // and was silently thrown away by a shake that was already invisible.
    // Cross-correlation of the static geometry over f0048-f0066 found no
    // impulse at all on the punch frame.
    if (amount <= this.shakeCurrent()) return;
    this.shakeAmp = amount;
    this.shakeDur = Math.max(duration, 0.05);
    this.shakeT = 0;
    this.shakeSeed += 13.77;
  }

  /** Directional shake. `dir` is the world-space axis the impulse arrived along. */
  shakeFrom(dir: Vector3, amount: number, duration: number): void {
    _shakeDir.copy(dir);
    if (_shakeDir.lengthSq() < 1e-8) _shakeDir.set(0, 1, 0);
    else _shakeDir.normalize();
    // Same test as `shake`, run first so the direction is not adopted by a
    // request that is about to be rejected.
    if (amount <= this.shakeCurrent()) return;
    this.shakeDir.copy(_shakeDir);
    this.shake(amount, duration);
  }

  /**
   * The shake, as a frame displacement plus a parallax nudge.
   *
   * TWO channels, and the split is the fix. `compose` re-aims the camera at the
   * subject after the shake is added, so a pure translation cannot move the
   * subject across the frame — it can only change how far away it is. On the
   * shipped `crash`, where the orbit closes to 3.4 m, 0.73 m of translation
   * pumped the subject's projected span 295→393→295 px in six frames and moved
   * the ridge line behind it by nothing at all. So:
   *
   *   ANGULAR   the punch. Displaces every pixel by the same amount at every
   *             depth and costs the framing nothing. Driven along the impact
   *             axis projected into the frame, so a hit from below throws the
   *             view up and a hit from the side throws it sideways.
   *   METRIC    a small translation, scaled by the standoff so it is the same
   *             fraction of the arm on a 2.3 m detail orbit and a 5.5 m chase.
   *             This is the weight cue: it is the only channel that produces
   *             parallax, and parallax is what says the camera has mass.
   */
  private applyShake(dt: number): void {
    this.shakeOffset.set(0, 0, 0);
    this.shakeYaw = 0;
    this.shakePitch = 0;
    this.shakeRoll = 0;
    if (this.shakeDur <= 0 || this.shakeT >= this.shakeDur) return;

    this.shakeT += dt;
    const u = clamp01(this.shakeT / this.shakeDur);

    // The envelope is the whole difference between an impact and a rumble.
    const env = this.shakeEnvelope(u);
    const osc = Math.sin(this.shakeT * CAMERA_TUNING.shakeFrequency);
    const s = this.shakeSeed;

    // ── Angular ──────────────────────────────────────────────────────────────
    // Split the impact axis into a frame-vertical part (its world Y, since the
    // camera is never far from level) and a frame-horizontal part (everything
    // else). A landing is dominantly +Y and throws the view up; a side impact
    // is dominantly horizontal and throws it sideways.
    const dy = this.shakeDir.y;
    const dh = Math.sqrt(Math.max(1 - dy * dy, 0));
    const ang = this.shakeAmp * CAMERA_TUNING.shakeDegrees * DEG * env;
    const wob = ang * 0.40;
    this.shakePitch = osc * ang * dy + SHAKE_NOISE.noise(this.shakeT * 11.3 + s, 5.7) * wob;
    this.shakeYaw = osc * ang * dh * 0.7 + SHAKE_NOISE.noise(this.shakeT * 13.0 + s, 0.0) * wob;
    this.shakeRoll =
      SHAKE_NOISE.noise(this.shakeT * 8.6 + s, 21.1) * ang * 0.55 + osc * ang * dh * 0.25;

    // ── Metric ───────────────────────────────────────────────────────────────
    const scale = clamp(
      this.shakeStandoff / CAMERA_TUNING.shakeStandoffRef,
      CAMERA_TUNING.shakeStandoffMin,
      CAMERA_TUNING.shakeStandoffMax,
    );
    const amp = this.shakeAmp * CAMERA_TUNING.shakeMetres * scale;
    this.shakeOffset.copy(this.shakeDir).multiplyScalar(osc * env * amp);
    const w = env * amp * 0.42;
    this.shakeOffset.x += SHAKE_NOISE.noise(this.shakeT * 15.1 + s, 11.3) * w;
    this.shakeOffset.y += SHAKE_NOISE.noise(this.shakeT * 11.3 + s, 5.7) * w;
    this.shakeOffset.z += SHAKE_NOISE.noise(this.shakeT * 13.0 + s, 0.0) * w;
  }

  // ── Events ────────────────────────────────────────────────────────────────

  private detectEvents(t: BikeState, dt: number): void {
    if (this.landCooldown > 0) this.landCooldown -= dt;
    if (this.crashCooldown > 0) this.crashCooldown -= dt;

    const airborneNow = t.mode === BikeMode.Airborne;
    const crashingNow = t.mode === BikeMode.Crashing;

    // Landings are detected from the mode TRANSITION as well as from the
    // one-step flag, because update() runs once per rendered frame while
    // physics runs at 120Hz — the flag can be set and cleared inside a single
    // frame's pair of steps and never be observed here.
    const landed = t.landedThisStep || (this.prevAirborne && !airborneNow && !crashingNow);
    if (landed && this.landCooldown <= 0) {
      this.landCooldown = 0.08;
      this.onLanding(t);
    }

    const crashed = t.crashedThisStep || (!this.prevCrashing && crashingNow);
    if (crashed && this.crashCooldown <= 0) {
      this.crashCooldown = 0.40;
      this.onCrash(t);
    }

    if (crashingNow) this.crashStrikes(t, dt);
    else this.crashStrikeCd = 0;
    this.crashPrevSpeed = t.speed;
    this.crashPrevContact = !!(t.rear?.grounded || t.front?.grounded);

    this.prevAirborne = airborneNow;
    this.prevCrashing = crashingNow;
  }

  /**
   * THE REST OF THE CRASH.
   *
   * `onCrash` fires once, on the frame the solver changes mode, and for the two
   * seconds that follow — the part an audience actually watches — this class
   * used to hear nothing at all. Not because the impulses were being rejected:
   * because nobody was sending any. `src/fx/index.ts` detects a body arriving
   * back on the ground for the dust and the impact flash and has no route into
   * the camera; the camera's own event detector only watches for a MODE change,
   * and a bike that is already `Crashing` cannot change into it again. A
   * reviewer cross-correlated static geometry across the frames either side of
   * the impact flash and found a smooth orbit drift with no impulse on the
   * punch frame, which was exactly right.
   *
   * Same two signals the FX layer uses, off the same state, so the flash and
   * the punch land on the same frame: a contact rising edge, or a single-frame
   * speed loss too large to be friction.
   */
  private crashStrikes(t: BikeState, dt: number): void {
    if (this.crashStrikeCd > 0) {
      this.crashStrikeCd -= dt;
      return;
    }
    const contact = !!(t.rear?.grounded || t.front?.grounded);
    const drop = this.crashPrevSpeed - t.speed;
    const hardHit = drop > CAMERA_TUNING.crashStrikeDrop && t.speed > 0.8;
    if (!((contact && !this.crashPrevContact) || hardHit)) return;

    this.crashStrikeCd = CAMERA_TUNING.crashStrikeCooldown;
    const force = clamp01(0.30 + drop * 0.9 + t.speed * 0.035);
    // Up and back along travel: the ground pushed, and it pushed against
    // whatever direction the wreck was still sliding in.
    _flatVel.copy(t.velocity);
    _flatVel.y = 0;
    if (_flatVel.lengthSq() > 1e-6) _flatVel.normalize();
    _tmp.set(0, 1, 0).addScaledVector(_flatVel, -0.45);
    this.shakeFrom(
      _tmp,
      CAMERA_TUNING.crashStrikeAmp + force * CAMERA_TUNING.crashStrikeAmpGain,
      CAMERA_TUNING.crashStrikeDur,
    );
  }

  /** Public so a caller with exact physics-step timing can drive it instead. */
  onLanding(t: BikeState): void {
    const impact = clamp01(t.landingImpact);
    if (impact < 0.04) return;

    // Direction: dominantly vertical, because the ground pushed up — plus a
    // component back along travel so a fast flat landing shoves the camera as
    // well as bouncing it.
    _flatVel.copy(t.velocity);
    _flatVel.y = 0;
    if (_flatVel.lengthSq() > 1e-6) _flatVel.normalize();
    _tmp.set(0, 1, 0).addScaledVector(_flatVel, -0.35);

    this.shakeFrom(_tmp, 0.30 + impact * 0.90, 0.28 + impact * 0.30);
    this.fovKick(1.6 + impact * 5.0);
    // The swing has no business continuing once the wheels are down.
    this.swingActive = false;
    this.onLandingEvent?.(t, impact);
  }

  onCrash(t: BikeState): void {
    const sev = clamp01(t.crashSeverity || 0.6);
    _tmp.copy(t.crashDirection).multiplyScalar(-1);
    _tmp.y += 0.7;
    this.shakeFrom(_tmp, 0.65 + sev * 0.85, 0.55 + sev * 0.45);
    this.swingActive = false;

    // Push in and hold. A crash used to cancel the slow-mo and add nothing in
    // its place, which is how a `switchback` capture ended up spending 60% of
    // its length watching a 20-pixel speck from a wide aerial.
    this.crashT = 0;
    if (sev >= CAMERA_TUNING.crashSlowMoMinSeverity) {
      this.slowActive = false;
      this.beginSlowMo(
        CAMERA_TUNING.crashSlowMoScale,
        CAMERA_TUNING.crashSlowMoAttack,
        CAMERA_TUNING.crashSlowMoHold,
        CAMERA_TUNING.crashSlowMoRelease,
        CAMERA_TUNING.crashSlowMoCooldown,
      );
    }
    this.onCrashEvent?.(t, sev);
  }

  // ── Cinematic ─────────────────────────────────────────────────────────────

  private updateCinematic(t: BikeState, dt: number, time: number): void {
    _tmp.copy(t.position).sub(this.cineAnchor);
    _tmp.y = 0;
    if (!this.cineValid || _tmp.length() > 62) this.pickCinematicAnchor(t);

    // A held shot still has to breathe or it reads as a still frame with a
    // moving subject pasted on.
    _desired.copy(this.cineAnchor);
    _desired.y += Math.sin(time * 0.21) * 0.9;
    _desired.x += Math.sin(time * 0.13) * 1.2;
    _desired.z += Math.cos(time * 0.11) * 1.2;

    // Much softer than the chase: a crane, not an arm.
    springStepDamped(this.sx, _desired.x, 2.2, 1.0, dt);
    springStepDamped(this.sy, _desired.y, 2.2, 1.0, dt);
    springStepDamped(this.sz, _desired.z, 2.2, 1.0, dt);
    this.camPos.set(this.sx.value, this.sy.value, this.sz.value);

    _lookWanted.copy(t.position);
    _lookWanted.y += 1.2;
    springStep(this.lx, _lookWanted.x, 5.0, dt);
    springStep(this.ly, _lookWanted.y, 5.0, dt);
    springStep(this.lz, _lookWanted.z, 5.0, dt);
    this.lookPos.set(this.lx.value, this.ly.value, this.lz.value);
    this.boomDesired = this.camPos.distanceTo(this.lookPos);

    this.roll = dampHL(this.roll, 0, 0.4, dt);
  }

  private pickCinematicAnchor(t: BikeState): void {
    _flatVel.copy(t.velocity);
    _flatVel.y = 0;
    if (_flatVel.lengthSq() < 1e-4) _flatVel.copy(this.forwardAxis).applyQuaternion(t.orientation);
    _flatVel.y = 0;
    if (_flatVel.lengthSq() < 1e-6) _flatVel.set(0, 0, 1);
    _flatVel.normalize();
    _rightV.set(-_flatVel.z, 0, _flatVel.x);

    this.cineSide = this.rng.chance(0.5) ? 1 : -1;
    this.cineAnchor
      .copy(t.position)
      .addScaledVector(_flatVel, this.rng.range(26, 44))
      .addScaledVector(_rightV, this.cineSide * this.rng.range(14, 26));
    this.cineAnchor.y += this.rng.range(6, 14);

    if (this.terrain) {
      const h = this.terrain.heightAt(this.cineAnchor.x, this.cineAnchor.z);
      if (this.cineAnchor.y < h + 4) this.cineAnchor.y = h + 4;
    }
    this.cineValid = true;
  }

  // ── Orbit / free / fixed ──────────────────────────────────────────────────

  setOrbit(yaw: number, pitch: number, dist: number, spin = 0.35): void {
    this.orbitYaw = yaw;
    this.orbitPitch = pitch;
    this.orbitDist = dist;
    this.orbitSpin = spin;
  }

  private updateOrbit(t: BikeState, dt: number): void {
    const cf = this.crashFocus;

    // The arc ACCELERATES through a wreck. A constant-rate orbit is the correct
    // language for an establishing shot and an admission of indifference during
    // the most cinematic two seconds in the game.
    this.orbitYaw += this.orbitSpin * (1 + CAMERA_TUNING.crashOrbitSpin * cf) * dt;

    // The standoff floor. An orbit closer than this has the lens inside the
    // subject's own dust — see `framedMinDist`.
    let dist = Math.max(this.orbitDist, CAMERA_TUNING.framedMinDist);

    // LEGIBILITY CLOSE. Only for shots authored as a standoff rather than as a
    // composition, only ever inward, floored twice. See `orbitCloseMaxDist`.
    //
    // Solved rather than damped: it is a pure function of the authored distance
    // and the current FOV, both of which are already smooth, so there is no
    // transient to smooth and nothing for a damper to do except make the
    // harness's twelve settle frames ship a half-converged shot.
    // THE CRASH PUSH-IN IS THE SAME SOLVE WITH A BIGGER TARGET, not a second
    // multiplier stacked on the first. Composing them is what took `crash` from
    // an authored 8 m to 3.25 m and 393 px of clipped subject: the legibility
    // close had already delivered the framing the crash multiplier then assumed
    // it still had to buy.
    const frac = lerp(CAMERA_TUNING.orbitSubjectFrac, CAMERA_TUNING.crashOrbitFrac, cf);
    if (this.orbitDist <= CAMERA_TUNING.orbitCloseMaxDist) {
      const tanHalf = Math.tan(this.camera.fov * DEG * 0.5);
      const want = CAMERA_TUNING.orbitSubjectSpan / (2 * Math.max(tanHalf, 1e-3) * frac);
      if (want < dist) {
        dist = Math.max(
          want,
          this.orbitDist * CAMERA_TUNING.orbitCloseFloor,
          CAMERA_TUNING.framedMinDist,
        );
      }
    }
    dist = Math.max(dist, CAMERA_TUNING.framedMinDist);

    // The crash elevation. A rider on the ground is a horizontal subject; the
    // authored pitch is chosen for one on a bike.
    const pitch = Math.min(
      this.orbitPitch + CAMERA_TUNING.crashOrbitRise * cf,
      CAMERA_TUNING.crashOrbitMaxPitch,
    );

    this.boomDesired = dist;
    const cy = Math.cos(pitch);
    this.lookPos.copy(t.position);
    // Never lowered for a crash. See the note on `crashOrbitMaxPitch`: the
    // vertical framing of a wreck belongs to `crashBoxTop`, which moves the
    // aim without moving the arm into the hill.
    this.lookPos.y += 1.1;
    this.camPos.set(
      this.lookPos.x + Math.sin(this.orbitYaw) * cy * dist,
      this.lookPos.y + Math.sin(pitch) * dist,
      this.lookPos.z + Math.cos(this.orbitYaw) * cy * dist,
    );
    this.roll = dampHL(this.roll, 0, 0.2, dt);
  }

  setFreeInput(forward: number, strafe: number, lift: number, yaw: number, pitch: number, speed = 1): void {
    this.freeInput.forward = forward;
    this.freeInput.strafe = strafe;
    this.freeInput.lift = lift;
    this.freeInput.yaw = yaw;
    this.freeInput.pitch = pitch;
    this.freeInput.speed = speed;
  }

  private updateFree(dt: number): void {
    const i = this.freeInput;
    this.freeYaw += i.yaw * dt;
    this.freePitch = clamp(this.freePitch + i.pitch * dt, -1.4, 1.4);

    const cp = Math.cos(this.freePitch);
    _dirV.set(Math.sin(this.freeYaw) * cp, Math.sin(this.freePitch), Math.cos(this.freeYaw) * cp).normalize();
    _rightV.set(-_dirV.z, 0, _dirV.x).normalize();

    const v = 18 * i.speed * dt;
    this.freePos.addScaledVector(_dirV, i.forward * v);
    this.freePos.addScaledVector(_rightV, i.strafe * v);
    this.freePos.y += i.lift * v;

    this.camPos.copy(this.freePos);
    this.lookPos.copy(this.freePos).add(_dirV);
    this.roll = 0;
  }

  snapTo(position: Vector3, lookAt: Vector3): void {
    this.camPos.copy(position);
    this.lookPos.copy(lookAt);
    this.fixedPos.copy(position);
    this.fixedLook.copy(lookAt);
    this.freePos.copy(position);

    this.sx.value = position.x; this.sx.velocity = 0;
    this.sy.value = position.y; this.sy.velocity = 0;
    this.sz.value = position.z; this.sz.velocity = 0;
    this.lx.value = lookAt.x; this.lx.velocity = 0;
    this.ly.value = lookAt.y; this.ly.velocity = 0;
    this.lz.value = lookAt.z; this.lz.velocity = 0;

    this.collisionLift = 0;
    this.framedRise = 0;
    this.framedAz = 0;
    this.boomRetract = 0;
    this.frameBias = 0;
    this.shakeDur = 0;
    this.shakeT = 0;
    this.swingActive = false;
    this.swingAmount = 0;
    this.roll = 0;

    this.camera.position.copy(position);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(lookAt);
    this.camera.updateMatrixWorld();
  }

  /** Re-seat the chase rig on the subject with no spring travel. Use on reset. */
  resetTo(target: BikeState): void {
    this.headingPrimed = false;
    this.aimYaw = 0;
    this.yawRate = 0;

    // SPEED FROM THE VELOCITY, NOT FROM `state.speed`.
    //
    // `speed` is a DERIVED field the physics writes during its step, and every
    // caller of this function re-seats the bike and then immediately resets the
    // camera — so at this instant `velocity` is the caller's 19 m/s and `speed`
    // is still whatever it was, which for a fresh spawn is zero. Everything
    // seeded off it was therefore seeded for a STATIONARY rider: the arm at the
    // resting standoff, the lens at 62°, the surge at a full 19 m/s of phantom
    // acceleration. Measured before this fix, on `scree-speed` at a steady
    // 19-23 m/s: the surge never dropped below 3.3 m/s for the whole two-second
    // run and pinned +4.5° of spurious FOV on every frame of it, the lens ran
    // 63.8→77.6 instead of 69.2→73.5, and the arm opened from 5.45 m — a metre
    // and a half of unasked-for travel — while the subject settled.
    const spd0 = Math.max(target.velocity.length(), target.speed);

    _flatVel.copy(target.velocity);
    _flatVel.y = 0;
    if (_flatVel.lengthSq() < 1e-4) {
      _flatVel.copy(this.forwardAxis).applyQuaternion(target.orientation);
      _flatVel.y = 0;
    }
    if (_flatVel.lengthSq() < 1e-6) _flatVel.set(0, 0, 1);
    _flatVel.normalize();

    // Seat the arm at the length this SPEED wants, not at the base length. The
    // capture harness settles four frames and opens the shutter, so seating at
    // the resting distance meant every sequence began with the camera 3.4 m out
    // and spent its first 15 frames expanding — the rider filled 68% of frame
    // one of `scree-speed` for no reason other than the reset.
    const s01 = clamp01(spd0 / CAMERA_TUNING.referenceSpeed);
    const f0 = this.mode === CameraMode.Chase ? this.speedFov(spd0) : this.fovBase;
    this.dollyFovS.value = this.speedFov(spd0);
    this.dollyFovS.velocity = 0;
    const d0 = this.chaseStandoff(this.dollyFovS.value);
    const h0 = CAMERA_TUNING.chaseHeight + CAMERA_TUNING.chaseHeightSpeedGain * s01;
    _desired
      .copy(target.position)
      .addScaledVector(_flatVel, -d0)
      .addScaledVector(UP, h0);
    _lookWanted.copy(target.position);
    _lookWanted.y += 1.05;
    this.snapTo(_desired, _lookWanted);

    // Prime the springs with the subject's velocity. `snapTo` zeroes them,
    // which is right for a teleport but wrong for a re-seat on a bike already
    // doing 20 m/s: the feed-forward term puts the target a lead-time ahead
    // immediately, and a spring starting from rest sprints to catch it and
    // arrives too close. The capture harness opens its shutter four frames
    // after the reset, so that transient WAS the first quarter-second of every
    // sequence — the rider at 52% of frame height on frame one.
    this.sx.velocity = target.velocity.x;
    this.sy.velocity = target.velocity.y;
    this.sz.velocity = target.velocity.z;
    this.lx.velocity = target.velocity.x;
    this.ly.velocity = target.velocity.y;
    this.lz.velocity = target.velocity.z;

    const pv0 = h0 - CAMERA_TUNING.subjectPivotHeight;
    this.boomDesired = Math.sqrt(d0 * d0 + pv0 * pv0);
    this.boomLength = this.boomDesired;
    this.subject = target;
    this.lastSubject.copy(target.position);
    this.subjectSeen = true;
    this.prevAirborne = target.mode === BikeMode.Airborne;
    this.prevCrashing = target.mode === BikeMode.Crashing;
    this.timeScale = 1;
    this.slowActive = false;
    this.crashT = -1;
    this.crashFocus = 0;
    this.kick = 0;
    this.speedLag = spd0;
    this.surge = 0;
    this.buffetOffset.set(0, 0, 0);
    this.buffetYaw = 0;
    this.buffetPitch = 0;
    this.buffetRoll = 0;
    this.swingCooldown = 0;
    this.shakeYaw = 0;
    this.shakePitch = 0;
    this.shakeRoll = 0;
    this.shakeOffset.set(0, 0, 0);
    // The subject has teleported: the previous frame's speed and contact are
    // about somewhere else on the mountain, and a strike detector fed them
    // would read the re-seat itself as the ground arriving.
    this.crashPrevSpeed = spd0;
    this.crashPrevContact = true;
    this.crashStrikeCd = 0;

    // Seat the LENS at the speed it is being re-seated at, exactly as the arm
    // is. Starting the FOV spring at `fovBase` on a bike already doing 23 m/s
    // meant the first twelve frames of every capture were a 62°→73° zoom that
    // nobody composed, and since the dolly is solved against the FOV it would
    // now drag the standoff through the same transient. Measured before this:
    // `scree-speed` f0000 shipped the rider at 366 px against 245 by f0112.
    this.fovS.value = f0;
    this.fovS.velocity = 0;
    this.camera.fov = f0;
    this.camera.updateProjectionMatrix();
    this.clearNearFade();

    // THE SUBJECT HAS TELEPORTED. Everything the old shot left hanging in the
    // air belongs to a place that is now hundreds of metres away, and the one
    // system that does not find that out on its own is the dust: a puff is a
    // fire-and-forget instance with a 0.7-2.3 s life and no idea the world
    // moved underneath it.
    //
    // This is the whole of the `bike-detail` failure. The capture harness runs
    // rider-closeup, rider-threequarter and bike-detail back to back at the
    // SAME point on the course, twelve frames each; each pose re-spawns the
    // bike, which lands and throws a burst, and the previous two poses' clouds
    // are still very much alive when the bike-detail shutter opens 2.3 m away.
    // Measured on the shipped harness path: 30 live puffs, 9 of them between
    // the lens and the bike, covering 46% of the sight line — the bike rendered
    // as X-ray line art through four to six overlapping peach impostors. Run
    // on its own, the identical pose was clean, which is exactly the signature
    // of state carried across a cut.
    clearAllDust();
  }

  // ── Replay ────────────────────────────────────────────────────────────────

  setReplaySource(rec: IReplayRecorder | null): void {
    this.replaySource = rec;
  }

  /**
   * Drive the results-screen cinematic from the recorder's biggest-air window.
   * Returns false if there is nothing worth showing, so the results screen can
   * fall back to a static framing rather than playing an empty replay.
   */
  playBiggestAir(opts: { speed?: number; lead?: number; trail?: number } = {}): boolean {
    const rec = this.replaySource;
    if (!rec || rec.frames.length < 4) return false;
    const w = rec.getBiggestAir();
    if (!w) return false;

    const lead = opts.lead ?? 0.7;
    const trail = opts.trail ?? 1.0;
    this.replayStart = Math.max(rec.frames[0].t, w.start - lead);
    this.replayEnd = Math.min(rec.frames[rec.frames.length - 1].t, w.end + trail);
    if (this.replayEnd - this.replayStart < 0.35) return false;

    this.replayT = this.replayStart;
    this.replaySpeed = opts.speed ?? 0.55;
    this.sampleReplay(this.replayT);

    // Base the sweep on the direction of travel at the start of the window.
    _fwd.copy(this.forwardAxis).applyQuaternion(this.replayOrientation);
    _fwd.y = 0;
    this.replayBaseYaw = _fwd.lengthSq() > 1e-6 ? Math.atan2(_fwd.x, _fwd.z) : 0;

    this.mode = CameraMode.Replay;
    this.cineValid = false;
    return true;
  }

  private updateReplay(dt: number): void {
    if (!this.replaySource || this.replayEnd <= this.replayStart) return;

    this.replayT += dt * this.replaySpeed;
    if (this.replayT > this.replayEnd) this.replayT = this.replayStart;
    this.sampleReplay(this.replayT);

    const u = clamp01((this.replayT - this.replayStart) / (this.replayEnd - this.replayStart));
    this.replayProgress = u;

    // A single continuous arc: start wide and behind, sweep around and push in
    // through the apex, then ease back out as the rider comes down. One move,
    // no cuts — cutting inside a two-second clip reads as a bug.
    const yaw = this.replayBaseYaw + lerp(-0.85, 2.05, ease.inOutCubic(u));
    const dist = lerp(16, 7.5, smoothstep(0, 0.55, u)) + lerp(0, 5.5, smoothstep(0.72, 1, u));
    const height = lerp(3.4, 1.7, smoothstep(0.1, 0.62, u)) + lerp(0, 1.8, smoothstep(0.75, 1, u));

    const cy = Math.cos(0.12);
    _desired.set(
      this.replayPosition.x + Math.sin(yaw) * cy * dist,
      this.replayPosition.y + height,
      this.replayPosition.z + Math.cos(yaw) * cy * dist,
    );
    const rpv = height - CAMERA_TUNING.subjectPivotHeight;
    this.boomDesired = Math.sqrt(dist * dist + rpv * rpv);

    springStepDamped(this.sx, _desired.x, 5.0, 1.0, dt);
    springStepDamped(this.sy, _desired.y, 5.0, 1.0, dt);
    springStepDamped(this.sz, _desired.z, 5.0, 1.0, dt);
    this.camPos.set(this.sx.value, this.sy.value, this.sz.value);

    _lookWanted.copy(this.replayPosition);
    _lookWanted.y += 1.0;
    springStep(this.lx, _lookWanted.x, 9.0, dt);
    springStep(this.ly, _lookWanted.y, 9.0, dt);
    springStep(this.lz, _lookWanted.z, 9.0, dt);
    this.lookPos.set(this.lx.value, this.ly.value, this.lz.value);

    // A slow roll through the arc. Tiny, but it is what turns an orbit into
    // a shot.
    this.roll = lerp(-0.05, 0.06, ease.inOutCubic(u));
  }

  /**
   * Sample the replay trajectory at time `t` into replayPosition/Orientation.
   * Public so the Game can pose a ghost bike on exactly the same curve.
   */
  sampleReplay(t: number): void {
    const rec = this.replaySource;
    if (!rec || rec.frames.length === 0) return;
    const f = rec.frames;

    if (t <= f[0].t) {
      this.applyFrame(f[0]);
      return;
    }
    const last = f[f.length - 1];
    if (t >= last.t) {
      this.applyFrame(last);
      return;
    }

    // Binary search — replay windows are thousands of frames long and a linear
    // scan here would show up on the results screen.
    let lo = 0;
    let hi = f.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (f[mid].t <= t) lo = mid;
      else hi = mid;
    }
    const a = f[lo];
    const b = f[hi];
    const span = b.t - a.t;
    const k = span > 1e-6 ? (t - a.t) / span : 0;

    this.replayPosition.set(
      a.px + (b.px - a.px) * k,
      a.py + (b.py - a.py) * k,
      a.pz + (b.pz - a.pz) * k,
    );
    _qa.set(a.qx, a.qy, a.qz, a.qw);
    _qb.set(b.qx, b.qy, b.qz, b.qw);
    this.replayOrientation.copy(_qa).slerp(_qb, k);
  }

  private applyFrame(f: ReplayFrame): void {
    this.replayPosition.set(f.px, f.py, f.pz);
    this.replayOrientation.set(f.qx, f.qy, f.qz, f.qw);
  }

  // ── Compose ───────────────────────────────────────────────────────────────

  private compose(subject: BikeState, dt: number): void {
    // Modes that hang off a moving subject and therefore get the full boom
    // solve. Orbit and Cinematic are HAND-FRAMED — `summit-wide` is a
    // deliberate 52 m crane and `valley-vista` a 180 m establishing shot, and
    // shortening those to clear a ridge would destroy the shot the author
    // asked for. They get the floors, not the arm.
    const boomed = this.mode === CameraMode.Chase || this.mode === CameraMode.Replay;
    const tracking =
      boomed || this.mode === CameraMode.Orbit || this.mode === CameraMode.Cinematic;

    // The pivot the boom hangs from. In Chase that is the rider's chest; in the
    // framed modes it is whatever the shot is looking at.
    if (this.mode === CameraMode.Chase) {
      _pivot.copy(subject.position);
      _pivot.y += CAMERA_TUNING.subjectPivotHeight;
    } else if (this.mode === CameraMode.Replay) {
      _pivot.copy(this.replayPosition);
      _pivot.y += CAMERA_TUNING.subjectPivotHeight;
    } else {
      _pivot.copy(this.lookPos);
    }

    if (tracking) {
      // Solve the arm BEFORE the shake, so the shake is a lens wobble on top of
      // a valid shot rather than an input to the collision solver.
      this.resolveBoom(this.camPos, _pivot, boomed, dt);
      // Adopt the solved position into the springs. Without the write-back the
      // springs keep integrating toward a place the solver will not allow, and
      // the discrepancy is released as a pop the moment the constraint clears.
      // Only the ARM is written back — the vertical escape stays a transient
      // offset with its own release, so it never becomes permanent altitude.
      if (boomed) {
        this.sx.value = this.camPos.x;
        this.sy.value = this.camPos.y;
        this.sz.value = this.camPos.z;
      }
    }

    // How far the lens is standing off the thing it is looking at, so the
    // shake's metric channel can be a constant fraction of the arm rather than
    // 20% of a tight orbit and 2% of a crane. Read from the solved position,
    // before the shake perturbs it.
    _tmp.copy(this.camPos).sub(_pivot);
    this.shakeStandoff = Math.max(_tmp.length(), 0.5);

    this.applyShake(dt);

    _camFinal.copy(this.camPos).add(this.shakeOffset);
    // The buffet rides on the lens with the shake, after the arm is solved, so
    // it can never be written back into the springs or mistaken for a collision.
    if (this.mode === CameraMode.Chase) _camFinal.add(this.buffetOffset);
    if (tracking) _camFinal.y += this.collisionLift;
    // Hand-framed modes take their correction as elevation about the pivot
    // instead, so the authored distance and azimuth survive it.
    if (tracking && !boomed) this.applyFramedRise(_camFinal, _pivot);
    _lookFinal.copy(this.lookPos);
    if (tracking) _lookFinal.y += this.frameBias;

    // Final unconditional floor, including the shake: whatever else happened,
    // the camera is not inside the hillside.
    if (this.terrain && this.mode !== CameraMode.Free && this.mode !== CameraMode.Fixed) {
      const h = this.terrain.heightAt(_camFinal.x, _camFinal.z) + CAMERA_TUNING.terrainMargin;
      if (_camFinal.y < h) _camFinal.y = h;
    }

    // The hard leash. That last floor is the one constraint that can still run
    // away: if the subject ends up BELOW the ground under the camera — a rider
    // falling into the ravine — the floor holds the camera on the lip while the
    // rider drops, and the arm silently grows without limit. Past this bound,
    // keeping the subject wins and the camera is allowed to graze the hillside.
    // A frame with a 0-pixel subject is a failure; a frame with a slightly
    // clipped foreground is a compromise.
    if (tracking) {
      _tmp.copy(_camFinal).sub(_pivot);
      const L = _tmp.length();
      const hardMax =
        this.boomDesired + CAMERA_TUNING.boomMaxSlack + CAMERA_TUNING.liftMax;
      if (L > hardMax && L > 1e-4) {
        _camFinal.copy(_pivot).addScaledVector(_tmp.divideScalar(L), hardMax);
      }
    }

    this.camera.position.copy(_camFinal);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(_lookFinal);
    this.camera.updateMatrixWorld();

    // Measure the composition on the un-rolled camera — roll is a stylistic
    // tilt and has no business feeding the framing loop.
    if (tracking) this.updateFraming(subject, dt);

    // ANGULAR TERMS, applied last and never fed back.
    //
    // After `updateFraming`, deliberately and for the same reason roll always
    // was: these are stylistic displacements of the frame, and a composition
    // controller that measured them would spend its life chasing its own
    // wobble. After `lookAt`, because a rotation applied to the aim point would
    // be undone by the next frame's aim.
    //
    // Yaw and pitch are what make an impact and a speed buffet visible at all —
    // they move the ridge line and the cloud deck by exactly as many pixels as
    // they move the ground under the wheels, which no translation of the rig
    // can do. See `buffetDegrees`.
    const chase = this.mode === CameraMode.Chase;
    const yaw = this.shakeYaw + (chase ? this.buffetYaw : 0);
    const pitch = this.shakePitch + (chase ? this.buffetPitch : 0);
    const roll = this.roll + this.shakeRoll + (chase ? this.buffetRoll : 0);
    if (Math.abs(yaw) > 1e-6 || Math.abs(pitch) > 1e-6 || Math.abs(roll) > 1e-6) {
      if (yaw !== 0) this.camera.rotateY(yaw);
      if (pitch !== 0) this.camera.rotateX(pitch);
      if (roll !== 0) this.camera.rotateZ(roll);
      this.camera.updateMatrixWorld();
    }

    this.updateNearFade(_camFinal, dt);

    // Tell the particle systems what this frame is OF.
    //
    // The camera is the only thing in the build that knows both where the lens
    // is and what it is pointed at, and the dust cannot make a sensible
    // decision about which puffs are allowed to exist without knowing the
    // second half of that. Published every frame, after the camera is placed,
    // so the corridor the dust tests against is this frame's corridor and not
    // the last one's.
    _tmp.copy(this.mode === CameraMode.Replay ? this.replayPosition : subject.position);
    _tmp.y += CAMERA_TUNING.subjectPivotHeight;
    publishDustShot(_tmp.x, _tmp.y, _tmp.z, CAMERA_TUNING.subjectClearRadius);
  }

  /**
   * The boom. Treats the camera as a rigid arm pivoting on the subject and
   * solves for the longest length that is legal, then damps toward it.
   *
   * It can only ever SHORTEN. That is the whole design: a camera that answers an
   * obstruction by climbing loses the subject, and the previous implementation
   * did exactly that — it solved the vertical lift a violation at parameter `s`
   * required as `depth / s`, so a ridge 20% of the way along the arm demanded
   * five times its own depth in altitude. Measured on the review set, that put
   * the camera 12 m above the rider on `switchback` and 32 m above on
   * `tabletop-air`, reducing the subject to 8 and 39 pixels respectively.
   *
   * Constraints, in the order they are applied:
   *   1. The LEASH — no further from the pivot than the spring solution asked
   *      for plus `boomMaxSlack`.
   *   2. OTHER RIDERS on the arm — park in front of them, never behind.
   *   3. TERRAIN along the arm, with the clearance margin ramped so the ground
   *      the rider is standing on is not mistaken for an occluder.
   *   4. The FLOOR — `boomMin`, below which the camera would be inside the body.
   *   5. What shortening could not fix becomes a bounded vertical escape.
   */
  private resolveBoom(cam: Vector3, pivot: Vector3, boomed: boolean, dt: number): void {
    if (boomed) {
      // Two passes. The first clamps the arm; the floor may then push the
      // camera end up out of the ground, which tilts the arm, so the second
      // pass re-clamps along the new direction. Without the second pass a rider
      // dropping over a cliff edge leaves the camera pinned on the plateau and
      // the arm silently exceeds its leash — which is how `tabletop-air` ended
      // with the subject 17 m away and 15 px tall even after the arm was added.
      // Floor FIRST. On a steep descent the resting camera position is below
      // the slope behind the rider — that is simple geometry, not a collision —
      // and sweeping the arm before lifting it out of the hill made the sweep
      // report a blockage on every single frame of a descent. Lifting first
      // points the arm up the fall line, which is where it belongs, and the
      // sweep then only fires on something genuinely in the way.
      this.floorCamera(cam);
      this.clampArm(cam, pivot, dt);
      this.floorCamera(cam);
      this.reclampArm(cam, pivot);
    } else {
      _boomDir.copy(cam).sub(pivot);
      this.boomLength = _boomDir.length();
      // A hand-framed arm is not shortened and is not lifted vertically — it is
      // rotated up about the pivot until it can see, which keeps the authored
      // distance and azimuth intact. That is the whole solve for these modes,
      // so the bounded vertical escape below has nothing left to do.
      this.solveFramedRise(cam, pivot, dt);
      this.collisionLift = 0;
      return;
    }

    this.framedRise = 0;
    this.framedAz = 0;

    // Vertical escape for what shortening could not fix — the camera end
    // sitting in rising ground, or a rider passing directly under the lens.
    // Bounded by `liftMax`, and asymmetric: out fast, back slowly. This is the
    // ONLY vertical response in the file and it is a clamp, not the old
    // `depth / s` amplification that sent the camera 32 m into the sky.
    let need = 0;
    if (this.terrain) {
      const h = this.terrain.heightAt(cam.x, cam.z) + CAMERA_TUNING.terrainMargin;
      if (cam.y < h) need = h - cam.y;
    }
    const clear = CAMERA_TUNING.occluderLiftRadius;
    const rad = CAMERA_TUNING.occluderRadius;
    const len = Math.max(this.boomLength, 1e-3);
    for (let i = 0; i < this.occCount; i++) {
      const o = _occPos[i];
      const dx = o.x - cam.x;
      const dz = o.z - cam.z;
      const r2 = dx * dx + dz * dz;
      const topY = o.y + CAMERA_TUNING.riderTop + 0.35;

      // (a) At the lens. Rise over the intruder rather than through them,
      //     faded by range so a rider drifting in does not step the camera up.
      if (r2 <= clear * clear) {
        const w = 1 - smoothstep(clear * 0.6, clear, Math.sqrt(r2));
        if (cam.y < topY) need = Math.max(need, (topY - cam.y) * w);
      }

      // (b) On the arm, between the camera and the subject. Rising over them is
      //     the composition-correct answer — it looks OVER the intruder at the
      //     subject, where ducking in front only makes the subject enormous.
      //     Raising the camera end by L raises the arm at fraction s by L·s, so
      //     the demand is depth/s; unlike the old collision solver that ratio is
      //     floored at 0.45 and the whole result is capped at `liftMax`.
      const wx = o.x - pivot.x;
      const wy = o.y + CAMERA_TUNING.riderTop * 0.5 - pivot.y;
      const wz = o.z - pivot.z;
      const along = wx * _boomDir.x + wy * _boomDir.y + wz * _boomDir.z;
      if (along <= 0.6 || along >= len) continue;
      const perp2 = wx * wx + wy * wy + wz * wz - along * along;
      if (perp2 > rad * rad) continue;
      const s = Math.max(along / len, 0.45);
      _probe.copy(pivot).addScaledVector(_boomDir, along);
      const depth = topY - _probe.y;
      if (depth <= 0) continue;
      const w = 1 - smoothstep(rad * 0.5, rad, Math.sqrt(Math.max(0, perp2)));
      need = Math.max(need, (depth / s) * w);
    }
    need = Math.min(need, CAMERA_TUNING.liftMax);

    this.collisionLift =
      need > this.collisionLift
        ? dampHL(this.collisionLift, need, CAMERA_TUNING.liftAttackHL, dt)
        : dampHL(this.collisionLift, need, CAMERA_TUNING.liftReleaseHL, dt);
  }

  /**
   * The framed-shot elevation solve. See `framedRiseStep` in the tuning block.
   *
   * Searches upward from the AUTHORED elevation in fixed steps for the first
   * one whose camera end is out of the ground and whose whole sight line to the
   * subject is clear, and damps toward it. The search is run against the raw
   * authored arm every frame, never against last frame's answer, so there is no
   * feedback path and therefore nothing to oscillate: the damping is smoothing
   * a stable target, not chasing its own output.
   */
  private solveFramedRise(cam: Vector3, pivot: Vector3, dt: number): void {
    const dx = cam.x - pivot.x;
    const dy = cam.y - pivot.y;
    const dz = cam.z - pivot.z;
    const h = Math.sqrt(dx * dx + dz * dz);
    const len = Math.sqrt(h * h + dy * dy);
    if (len < 1e-3) {
      this.framedRise = 0;
      this.framedAz = 0;
      return;
    }
    const e0 = Math.atan2(dy, h);
    const az0 = h > 1e-4 ? Math.atan2(dx, dz) : this.aimYaw + Math.PI;

    const maxRise = Math.min(
      CAMERA_TUNING.framedRiseMax,
      Math.max(0, CAMERA_TUNING.framedRiseMaxElev - e0),
    );
    const rStep = CAMERA_TUNING.framedRiseStep;
    const aStep = CAMERA_TUNING.framedAzStep;
    const wa = CAMERA_TUNING.framedAzCost;
    const ws = CAMERA_TUNING.framedAzStickCost;

    // Fall back to the top of the rise range if nothing at all is clear: a
    // steep shot with the mountain still in it beats a shot buried inside it,
    // and the unconditional floor downstream will catch what is left.
    let bestCost = Number.POSITIVE_INFINITY;
    let bestRise = maxRise;
    let bestAz = 0;

    // Azimuth candidates in order of increasing deviation, 0, -a, +a, -2a, ...
    // The column is skipped whole the moment its cheapest possible member is
    // already more expensive than the best answer found — which is what keeps
    // a two-axis search from being a two-axis cost.
    const nAz = Math.floor(CAMERA_TUNING.framedAzMax / aStep);
    for (let k = 0; k <= nAz * 2; k++) {
      const i = (k + 1) >> 1;
      const az = (k === 0 ? 0 : (k & 1 ? -i : i)) * aStep;
      const floorCost = Math.abs(az) * wa + Math.abs(az - this.framedAz) * ws;
      if (floorCost >= bestCost) {
        // Every remaining candidate in this column and every column beyond it
        // deviates further, so nothing left can win.
        if (az !== 0 && Math.abs(az) * wa >= bestCost) break;
        continue;
      }
      for (let r = 0; r <= maxRise + 1e-6; r += rStep) {
        const cost = floorCost + r;
        if (cost >= bestCost) break;
        if (!this.framedClear(pivot, len, az0 + az, e0 + r)) continue;
        bestCost = cost;
        bestRise = r;
        bestAz = az;
        break;
      }
    }

    this.framedRise =
      bestRise > this.framedRise
        ? dampHL(this.framedRise, bestRise, CAMERA_TUNING.framedRiseAttackHL, dt)
        : dampHL(this.framedRise, bestRise, CAMERA_TUNING.framedRiseReleaseHL, dt);
    this.framedAz = dampHL(
      this.framedAz,
      bestAz,
      Math.abs(bestAz) > Math.abs(this.framedAz)
        ? CAMERA_TUNING.framedAzAttackHL
        : CAMERA_TUNING.framedAzReleaseHL,
      dt,
    );

    // THE INTERMEDIATE STATE HAS TO BE LEGAL TOO.
    //
    // The search returns a discrete answer and the straight line between two
    // legal answers is not itself legal: on `ravine-gap` the solver correctly
    // found "step 20 degrees round the subject, no crane at all", and the
    // half-damped pose on the way there — 13 degrees of crane, 10 degrees of
    // yaw — was inside the hillside, which is precisely the frame that shipped.
    // A damper is the right tool for a preference and the wrong one for a
    // constraint. If the pose we are about to use cannot see the subject, take
    // the solved one outright: a camera that arrives in one frame is a cut, and
    // a cut is worth incomparably more than a frame with no subject in it.
    if (
      bestCost < Number.POSITIVE_INFINITY &&
      !this.framedClear(pivot, len, az0 + this.framedAz, e0 + this.framedRise)
    ) {
      this.framedRise = bestRise;
      this.framedAz = bestAz;
    }
  }

  /**
   * Can a camera at this azimuth and elevation, on an arm of this length, both
   * stand clear of the ground and see the pivot? Pure query, no state.
   */
  private framedClear(pivot: Vector3, len: number, azim: number, elev: number): boolean {
    const ce = Math.cos(elev);
    const se = Math.sin(elev);
    const cx = pivot.x + Math.sin(azim) * ce * len;
    const cy = pivot.y + se * len;
    const cz = pivot.z + Math.cos(azim) * ce * len;

    if (this.terrain) {
      if (cy < this.terrain.heightAt(cx, cz) + CAMERA_TUNING.terrainMargin) return false;
      const N = CAMERA_TUNING.framedClearSamples;
      for (let i = 1; i <= N; i++) {
        const s = i / (N + 1);
        const px = pivot.x + (cx - pivot.x) * s;
        const py = pivot.y + (cy - pivot.y) * s;
        const pz = pivot.z + (cz - pivot.z) * s;
        // Same ramped margin as the boom sweep, and for the same reason: close
        // to the pivot the "obstruction" is the ground the rider is riding on.
        const margin = lerp(CAMERA_TUNING.boomClearNear, CAMERA_TUNING.boomClearFar, s);
        if (this.terrain.heightAt(px, pz) + margin - py > CAMERA_TUNING.boomDeadband) return false;
      }
    }

    const r = CAMERA_TUNING.occluderLiftRadius;
    for (let i = 0; i < this.occCount; i++) {
      const o = _occPos[i];
      const ddx = o.x - cx;
      const ddz = o.z - cz;
      if (ddx * ddx + ddz * ddz < r * r && cy < o.y + CAMERA_TUNING.riderTop) return false;
    }
    return true;
  }

  /**
   * Swing a solved framed arm to the elevation and azimuth the search chose,
   * preserving its LENGTH exactly. The length is the one thing the author
   * unambiguously specified and the one thing the mountain has no opinion on.
   */
  private applyFramedRise(cam: Vector3, pivot: Vector3): void {
    if (this.framedRise <= 1e-4 && Math.abs(this.framedAz) <= 1e-4) return;
    const dx = cam.x - pivot.x;
    const dy = cam.y - pivot.y;
    const dz = cam.z - pivot.z;
    const h = Math.sqrt(dx * dx + dz * dz);
    const len = Math.sqrt(h * h + dy * dy);
    if (len < 1e-3) return;
    const e = Math.min(Math.atan2(dy, h) + this.framedRise, CAMERA_TUNING.framedRiseMaxElev);
    const a = (h > 1e-4 ? Math.atan2(dx, dz) : this.aimYaw + Math.PI) + this.framedAz;
    const ce = Math.cos(e);
    cam.set(
      pivot.x + Math.sin(a) * ce * len,
      pivot.y + Math.sin(e) * len,
      pivot.z + Math.cos(a) * ce * len,
    );
  }

  /** Raise a point clear of the hillside. No amplification, no state. */
  private floorCamera(cam: Vector3): void {
    if (!this.terrain) return;
    const h = this.terrain.heightAt(cam.x, cam.z) + CAMERA_TUNING.terrainMargin;
    if (cam.y < h) cam.y = h;
  }

  /**
   * Second pass. The floor may have pushed the camera end up, lengthening the
   * arm past what the first pass allowed; re-seat it at the solved length along
   * the NEW, tilted direction. That tilt is the desirable part — as the rider
   * drops over an edge the arm rotates toward vertical and the camera follows
   * him down over the void instead of staying pinned on the plateau watching
   * him shrink.
   */
  private reclampArm(cam: Vector3, pivot: Vector3): void {
    _boomDir.copy(cam).sub(pivot);
    const len = _boomDir.length();
    if (len < 1e-4 || len <= this.boomLength) return;
    _boomDir.divideScalar(len);
    this.limitBoomRise();
    cam.copy(pivot).addScaledVector(_boomDir, this.boomLength);
  }

  /**
   * Keep the arm off the vertical. Operates on the unit `_boomDir` in place:
   * when the subject drops away below the camera the arm rotates toward
   * straight-down, and a plan view of a helmet is not a shot. Tilting it back
   * to a steep three-quarter keeps the mountain, the fall line and the rider
   * all in the same frame.
   */
  private limitBoomRise(): void {
    const maxY = CAMERA_TUNING.boomMaxRise;
    if (_boomDir.y <= maxY) return;
    const wantH = Math.sqrt(Math.max(1e-6, 1 - maxY * maxY));
    const h = Math.sqrt(_boomDir.x * _boomDir.x + _boomDir.z * _boomDir.z);
    if (h > 1e-4) {
      const k = wantH / h;
      _boomDir.x *= k;
      _boomDir.z *= k;
    } else {
      // Perfectly overhead — there is no horizontal direction to preserve, so
      // fall back to the chase heading and put the camera behind the rider.
      _boomDir.x = -Math.sin(this.aimYaw) * wantH;
      _boomDir.z = -Math.cos(this.aimYaw) * wantH;
    }
    _boomDir.y = maxY;
  }

  /** The arm constraint: leash, riders, terrain, floor — then damp the result. */
  private clampArm(cam: Vector3, pivot: Vector3, dt: number): void {
    _boomDir.copy(cam).sub(pivot);
    let len = _boomDir.length();
    if (len < 1e-4) {
      // Degenerate: the solver has nothing to work with. Re-establish an arm
      // pointing backwards and up rather than dividing by zero.
      _boomDir.set(0, 0.45, 1).normalize();
      len = CAMERA_TUNING.boomMin;
    } else {
      _boomDir.divideScalar(len);
    }
    this.limitBoomRise();

    // 1. Leash, measured against what the shot asked for. The under-damped
    //    spring's steady-state lag scales with speed — 4.3 m at 19 m/s, 10.3 m
    //    at 47 m/s — so without this the camera is a different distance away at
    //    every speed, and a crash that dumps the speed strands it at the far end.
    let allowed = Math.min(len, this.boomDesired + CAMERA_TUNING.boomMaxSlack);

    // 2. Other riders on the arm. Weighted continuously by how far inside the
    //    body cylinder they are and faded out at both ends, because a hard
    //    in/out test on a rider crossing the arm steps the target by a metre in
    //    one frame and the damper turns that into a visible lurch.
    const rad = CAMERA_TUNING.occluderRadius;
    let occAllowed = allowed;
    for (let i = 0; i < this.occCount; i++) {
      const o = _occPos[i];
      const wx = o.x - pivot.x;
      const wy = o.y + CAMERA_TUNING.riderTop * 0.5 - pivot.y;
      const wz = o.z - pivot.z;
      const along = wx * _boomDir.x + wy * _boomDir.y + wz * _boomDir.z;
      if (along <= 0.4 || along >= len + 0.9) continue;
      const perp = Math.sqrt(Math.max(0, wx * wx + wy * wy + wz * wz - along * along));
      if (perp > rad) continue;
      let w = 1 - smoothstep(rad * 0.5, rad, perp);
      w *= smoothstep(0.4, 1.3, along);
      w *= 1 - smoothstep(len - 0.1, len + 0.9, along);
      if (w <= 1e-3) continue;
      const stop = occAllowed + (along - CAMERA_TUNING.occluderClearance - occAllowed) * w;
      if (stop < occAllowed) occAllowed = stop;
    }
    // The occluder rule is a safety rule, not a composition rule — floor it.
    const occFloor = Math.max(
      CAMERA_TUNING.boomMin,
      this.boomDesired * CAMERA_TUNING.occluderBoomFloor,
    );
    if (occAllowed < allowed) allowed = Math.max(occAllowed, occFloor);

    // 3. Terrain sweep. Sampled from `boomClearFrom` outward with a clearance
    //    that ramps to the full margin at the camera end — it has to ramp,
    //    because near the pivot the "obstruction" is the ground the rider is
    //    riding on and a uniform margin makes every descent read as a collision.
    if (this.terrain) {
      const N = CAMERA_TUNING.boomSamples;
      const from = CAMERA_TUNING.boomClearFrom;
      for (let i = 0; i < N; i++) {
        const s = from + ((1 - from) * (i + 1)) / N;
        const d = allowed * s;
        _probe.copy(pivot).addScaledVector(_boomDir, d);
        const margin = lerp(CAMERA_TUNING.boomClearNear, CAMERA_TUNING.boomClearFar, s);
        const h = this.terrain.heightAt(_probe.x, _probe.z) + margin;
        if (h - _probe.y > CAMERA_TUNING.boomDeadband) {
          const stop = d - CAMERA_TUNING.boomBackoff;
          if (stop < allowed) allowed = stop;
          break;
        }
      }
    }

    // 4. The floor. Below this the camera is inside the rider.
    const floored = Math.max(allowed, CAMERA_TUNING.boomMin);

    // Damp the RETRACTION, not the length: the length itself already carries
    // the spring's whip and smoothing it again would flatten the ride.
    const intrusion = Math.max(0, len - floored);
    this.boomRetract =
      intrusion > this.boomRetract
        ? dampHL(this.boomRetract, intrusion, CAMERA_TUNING.boomShortenHL, dt)
        : dampHL(this.boomRetract, intrusion, CAMERA_TUNING.boomRecoverHL, dt);

    const finalLen = Math.max(len - this.boomRetract, CAMERA_TUNING.boomMin);
    this.boomLength = finalLen;
    cam.copy(pivot).addScaledVector(_boomDir, finalLen);
  }

  /**
   * Safe-area composition.
   *
   * The HUD owns roughly the top 20% and the bottom 12% of the frame. A subject
   * composed at the geometric centre of the raster is fine; a subject that has
   * drifted into the boost bar is not framed at all, and `tabletop-air` used to
   * put the rider on the very bottom edge with the bar across his wheels.
   *
   * Measures where the subject's silhouette actually landed on screen this frame
   * and biases the LOOK POINT (never the camera position, which would fight the
   * boom solver) until the silhouette sits inside the band. Closed loop, damped,
   * clamped, and it relaxes back to neutral once the shot is comfortable.
   */
  private updateFraming(subject: BikeState, dt: number): void {
    const src = this.mode === CameraMode.Replay ? this.replayPosition : subject.position;
    const tanHalf = Math.tan(this.camera.fov * DEG * 0.5);
    if (tanHalf < 1e-4) return;

    // View space, straight off the camera's inverse world matrix. Doing the
    // maths here rather than calling Vector3.project keeps roll and the
    // projection matrix's near/far terms out of a purely vertical question.
    // The box collapses toward the wreck box as the crash envelope comes up:
    // a subject that is no longer standing is not 2.2 m tall and its centre is
    // not where a standing rider's is. See `crashBoxTop`.
    const cf = this.crashFocus;
    const boxTop = lerp(CAMERA_TUNING.frameBoxTop, CAMERA_TUNING.crashBoxTop, cf);
    const boxBot = lerp(CAMERA_TUNING.frameBoxBottom, CAMERA_TUNING.crashBoxBottom, cf);

    _view.set(src.x, src.y + boxTop, src.z).applyMatrix4(this.camera.matrixWorldInverse);
    if (_view.z > -0.25) return; // behind, or on, the lens — nothing to frame
    const depth = -_view.z;
    const fracTop = 0.5 - (_view.y / (depth * tanHalf)) * 0.5;

    _view.set(src.x, src.y + boxBot, src.z).applyMatrix4(this.camera.matrixWorldInverse);
    if (_view.z > -0.25) return;
    const fracBot = 0.5 - (_view.y / (-_view.z * tanHalf)) * 0.5;

    const top = CAMERA_TUNING.safeTop;
    const bottom = CAMERA_TUNING.safeBottom;
    const pad = CAMERA_TUNING.safeInnerPad;

    // Screen error, in frame fractions. Positive means the subject must move UP
    // the frame, which means the look point must move DOWN.
    let err = 0;
    let comfortable: boolean;
    if (fracBot - fracTop >= bottom - top) {
      // The subject is taller than the safe band — a close crash push-in, or a
      // near-miss with another rider. There is no way to satisfy both edges, so
      // stop trying: centre the silhouette on the band. Alternating between the
      // two unsatisfiable edges is what threw the subject from the bottom of
      // the frame to the top and back within a few frames.
      err = (fracTop + fracBot) * 0.5 - (top + bottom) * 0.5;
      if (Math.abs(err) < 0.02) err = 0;
      comfortable = err === 0;
    } else {
      if (fracBot > bottom) err = fracBot - bottom;
      else if (fracTop < top) err = fracTop - top;
      comfortable = fracBot < bottom - pad && fracTop > top + pad;
    }

    let target: number;
    if (err !== 0) {
      // One frame fraction is `2·depth·tan(fov/2)` metres at the subject.
      target = clamp(
        this.frameBias - err * 2 * depth * tanHalf * CAMERA_TUNING.frameBiasGain,
        -CAMERA_TUNING.frameBiasMax,
        CAMERA_TUNING.frameBiasMax,
      );
    } else if (comfortable) {
      target = 0;
    } else {
      target = this.frameBias; // inside the band but near an edge: hold.
    }

    this.frameBias = dampHL(
      this.frameBias,
      target,
      err !== 0 ? CAMERA_TUNING.frameBiasCorrectHL : CAMERA_TUNING.frameBiasRelaxHL,
      dt,
    );
  }

  /**
   * Near-plane treatment for other riders.
   *
   * The boom solver keeps opponents off the arm, but a rider overtaking beside
   * the camera can still arrive at the lens. `userData.nearFade` (0 = normal,
   * 1 = gone) is published for the visual layer to consume as a stipple dither;
   * see the note in the class docs about wiring it. Until something consumes it,
   * the only hard action taken is hiding a body that is literally inside the
   * near plane, where no treatment would be visible anyway.
   */
  private updateNearFade(cam: Vector3, _dt: number): void {
    const start = CAMERA_TUNING.nearFadeStart;
    const full = CAMERA_TUNING.nearFadeFull;
    for (let i = 0; i < this.occCount; i++) {
      const node = this.occNodes[i];
      if (!node) continue;
      const o = _occPos[i];
      const dx = o.x - cam.x;
      const dy = o.y + CAMERA_TUNING.riderTop * 0.5 - cam.y;
      const dz = o.z - cam.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const fade = 1 - smoothstep(full, start, d);
      node.userData.nearFade = fade;
      const visible = fade < 0.999;
      if (node.visible !== visible) node.visible = visible;
    }
  }

  private clearNearFade(): void {
    for (let i = 0; i < this.discovered.length; i++) {
      const n = this.discovered[i];
      n.userData.nearFade = 0;
      n.visible = true;
    }
  }

  dispose(): void {
    this.clearNearFade();
    this.replaySource = null;
    this.subject = null;
    this.occluders = null;
    this.occCount = 0;
    this.discovered.length = 0;
    this.discoveredBodies.length = 0;
    this.onLandingEvent = null;
    this.onCrashEvent = null;
  }
}
