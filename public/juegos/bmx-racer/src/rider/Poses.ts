/**
 * Poses — every named body attitude the rider can be in, as blendable numbers.
 *
 * A pose here is NOT a set of bone quaternions. It is a fixed-length vector of
 * ~40 named channels — where the pelvis sits, how far the spine curls, how far
 * the elbows swing out, whether the hands are welded to the bar — and the rig
 * turns that vector into bones through FK and IK every frame.
 *
 * That indirection is the whole design, and it buys three things:
 *
 *  1. BLENDING IS A LERP OVER FLOATS. Two poses, five poses, a trick fading over
 *     a landing absorption over a pedalling cycle — all of it is `dst += (src -
 *     dst) * w` over a Float32Array. Blending quaternion sets pairwise is where
 *     procedural rigs get their mushy, averaged-out look; blending intent and
 *     re-solving keeps every intermediate pose a VALID pose.
 *
 *  2. THE CONTACTS SURVIVE BLENDING. `handLock` and `footLock` are channels, so
 *     a pose can say "hands stay on the bar no matter what else you blend into
 *     me". A quaternion blend cannot express that, which is exactly why rigs
 *     built that way slide their hands off the grips during transitions.
 *
 *  3. POSES MIRROR. One authored tabletop covers both sides; `mirrorPose` flips
 *     the lateral channels and swaps the left/right pairs.
 *
 * Sign conventions, in rig space (+X left, +Y up, +Z forward):
 *   bend  + = curl forward         side  + = lean LEFT
 *   twist + = turn LEFT            pitch + = look DOWN
 *   yaw   + = turn LEFT            roll  + = tilt RIGHT-shoulder-down
 *
 * The brief's test for the trick poses is "the silhouette alone should identify
 * the trick", so each one below is authored around one unmistakable shape:
 * superman is a straight line from bar to toe, backflip is an arch, frontflip is
 * a ball, tabletop is a hard lateral break at the waist.
 */

import { TrickKind } from '../game/Contracts';

// ─────────────────────────────────────────────────────────────────────────────
// Channels
// ─────────────────────────────────────────────────────────────────────────────

export const PC = {
  pelvisX: 0,
  pelvisY: 1,
  pelvisZ: 2,
  pelvisPitch: 3,
  pelvisYaw: 4,
  pelvisRoll: 5,

  spineBend: 6,
  spineSide: 7,
  spineTwist: 8,
  /** Torso length multiplier. <1 compresses (landing), >1 extends (pump). */
  spineStretch: 9,
  /** Extra curl applied at the chest only — the difference between a hunch and a bow. */
  chestBend: 10,

  headPitch: 11,
  headYaw: 12,
  headRoll: 13,
  /** 0..1 authority the look-at target has over the head. */
  headLook: 14,

  handLockL: 15,
  handLockR: 16,
  handOffLX: 17,
  handOffLY: 18,
  handOffLZ: 19,
  handOffRX: 20,
  handOffRY: 21,
  handOffRZ: 22,
  elbowOutL: 23,
  elbowOutR: 24,

  footLockL: 25,
  footLockR: 26,
  footOffLX: 27,
  footOffLY: 28,
  footOffLZ: 29,
  footOffRX: 30,
  footOffRY: 31,
  footOffRZ: 32,
  kneeOutL: 33,
  kneeOutR: 34,
  ankleFlexL: 35,
  ankleFlexR: 36,

  shrug: 37,
  /** Base attitude of the cloth hem bones — poses can hold the jersey out. */
  hemSwing: 38,
  /** Extra elbow/knee straightening allowance; 1 lets a limb go fully out. */
  reachBias: 39,
} as const;

export type ChannelName = keyof typeof PC;
export const POSE_CHANNELS = 40;

export type Pose = Float32Array;

/** The neutral pose: rest skeleton, hands and feet locked to the bike. */
export function makePose(): Pose {
  const p = new Float32Array(POSE_CHANNELS);
  p[PC.spineStretch] = 1;
  p[PC.handLockL] = 1;
  p[PC.handLockR] = 1;
  p[PC.footLockL] = 1;
  p[PC.footLockR] = 1;
  p[PC.headLook] = 1;
  return p;
}

export type PoseSpec = Partial<Record<ChannelName, number>>;

/** Compile an authored spec into a full channel vector. */
export function pose(spec: PoseSpec): Pose {
  const p = makePose();
  for (const key in spec) {
    const v = spec[key as ChannelName];
    if (v !== undefined) p[PC[key as ChannelName]] = v;
  }
  return p;
}

export function copyPose(dst: Pose, src: Pose): Pose {
  dst.set(src);
  return dst;
}

/** dst = mix(dst, src, t). The layering primitive. */
export function lerpPose(dst: Pose, src: Pose, t: number): Pose {
  if (t <= 0) return dst;
  if (t >= 1) {
    dst.set(src);
    return dst;
  }
  for (let i = 0; i < POSE_CHANNELS; i++) dst[i] += (src[i] - dst[i]) * t;
  return dst;
}

/** dst += (src - neutral) * w. For layers that should add rather than replace. */
export function addPoseDelta(dst: Pose, src: Pose, neutral: Pose, w: number): Pose {
  if (w === 0) return dst;
  for (let i = 0; i < POSE_CHANNELS; i++) dst[i] += (src[i] - neutral[i]) * w;
  return dst;
}

// ── Mirroring ────────────────────────────────────────────────────────────────

/** For each channel: where it lands when mirrored, and the sign it takes. */
const MIRROR_TARGET = new Int16Array(POSE_CHANNELS);
const MIRROR_SIGN = new Float32Array(POSE_CHANNELS);
(() => {
  for (let i = 0; i < POSE_CHANNELS; i++) {
    MIRROR_TARGET[i] = i;
    MIRROR_SIGN[i] = 1;
  }
  const negate: ChannelName[] = [
    'pelvisX',
    'pelvisYaw',
    'pelvisRoll',
    'spineSide',
    'spineTwist',
    'headYaw',
    'headRoll',
    'hemSwing',
  ];
  for (const n of negate) MIRROR_SIGN[PC[n]] = -1;

  const swap: [ChannelName, ChannelName][] = [
    ['handLockL', 'handLockR'],
    ['handOffLX', 'handOffRX'],
    ['handOffLY', 'handOffRY'],
    ['handOffLZ', 'handOffRZ'],
    ['elbowOutL', 'elbowOutR'],
    ['footLockL', 'footLockR'],
    ['footOffLX', 'footOffRX'],
    ['footOffLY', 'footOffRY'],
    ['footOffLZ', 'footOffRZ'],
    ['kneeOutL', 'kneeOutR'],
    ['ankleFlexL', 'ankleFlexR'],
  ];
  for (const [a, b] of swap) {
    MIRROR_TARGET[PC[a]] = PC[b];
    MIRROR_TARGET[PC[b]] = PC[a];
  }
  // The X component of a mirrored offset flips as well as swapping sides.
  MIRROR_SIGN[PC.handOffLX] = -1;
  MIRROR_SIGN[PC.handOffRX] = -1;
  MIRROR_SIGN[PC.footOffLX] = -1;
  MIRROR_SIGN[PC.footOffRX] = -1;
})();

/** Mirror `src` about the rider's sagittal plane into `out`. */
export function mirrorPose(src: Pose, out: Pose): Pose {
  for (let i = 0; i < POSE_CHANNELS; i++) out[MIRROR_TARGET[i]] = src[i] * MIRROR_SIGN[i];
  return out;
}

/** `out = side >= 0 ? src : mirror(src)`, without allocating. */
export function sidedPose(src: Pose, side: number, out: Pose): Pose {
  if (side >= 0) {
    out.set(src);
    return out;
  }
  return mirrorPose(src, out);
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-channel response speed
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Half-life, seconds, for each channel's approach to its target.
 *
 * This table is where a lot of the "weight" lives. The pelvis is heavy and lags;
 * the head is light and leads; the lock channels are near-instant because a hand
 * releasing the bar over 200 ms looks like the rider is unsure. Everything is
 * half-life based, so the behaviour is identical at 30 fps and at 240 fps.
 */
export const POSE_HALFLIFE = (() => {
  const h = new Float32Array(POSE_CHANNELS);
  h.fill(0.075);
  h[PC.pelvisX] = 0.085;
  h[PC.pelvisY] = 0.070;
  h[PC.pelvisZ] = 0.085;
  h[PC.pelvisPitch] = 0.090;
  h[PC.pelvisYaw] = 0.090;
  h[PC.pelvisRoll] = 0.090;
  h[PC.spineBend] = 0.080;
  h[PC.spineSide] = 0.090;
  h[PC.spineTwist] = 0.085;
  h[PC.spineStretch] = 0.070;
  h[PC.chestBend] = 0.075;
  h[PC.headPitch] = 0.055;
  h[PC.headYaw] = 0.050;
  h[PC.headRoll] = 0.060;
  h[PC.headLook] = 0.080;
  h[PC.handLockL] = 0.030;
  h[PC.handLockR] = 0.030;
  h[PC.footLockL] = 0.030;
  h[PC.footLockR] = 0.030;
  h[PC.elbowOutL] = 0.070;
  h[PC.elbowOutR] = 0.070;
  h[PC.kneeOutL] = 0.070;
  h[PC.kneeOutR] = 0.070;
  h[PC.shrug] = 0.090;
  h[PC.hemSwing] = 0.110;
  return h;
})();

/**
 * Half-life for the four LOCK channels when the lock is being RE-MADE.
 *
 * Releasing a contact and re-making one are not the same action and must not
 * share a timing. A foot leaving a pedal for a superman, a no-footer or a
 * tailwhip is a kick: it is over in two frames and any hesitation reads as the
 * rider being unsure. A foot coming BACK has to find the platform — the rider
 * is looking down, the pedal is moving, and it takes a beat. Running the return
 * on the same 30 ms half-life as the release is what makes procedural riders
 * look magnetic, with feet that teleport onto pedals the instant a trick ends.
 *
 * Hands are a little quicker than feet on the way back because the bar is not
 * going anywhere and the rider can see it.
 */
export const POSE_HALFLIFE_RETURN = (() => {
  const h = new Float32Array(POSE_CHANNELS);
  h.set(POSE_HALFLIFE);
  h[PC.handLockL] = 0.075;
  h[PC.handLockR] = 0.075;
  h[PC.footLockL] = 0.115;
  h[PC.footLockR] = 0.115;
  return h;
})();

/** 1 for the four contact-lock channels, 0 elsewhere. Indexed by channel. */
export const LOCK_CHANNELS = (() => {
  const m = new Uint8Array(POSE_CHANNELS);
  m[PC.handLockL] = 1;
  m[PC.handLockR] = 1;
  m[PC.footLockL] = 1;
  m[PC.footLockR] = 1;
  return m;
})();

// ─────────────────────────────────────────────────────────────────────────────
// Riding poses
// ─────────────────────────────────────────────────────────────────────────────

/** Neutral. Identical to the bind pose: standing, hands and feet on the bike. */
export const NEUTRAL = makePose();

/**
 * ATTACK — out of the saddle, weight centred, elbows out, eyes up the trail.
 * This is the pose the bike is fastest in and the one the player sees most, so
 * it is the one everything else is authored as a deviation from.
 */
export const ATTACK = pose({
  pelvisY: 0.012,
  pelvisZ: -0.012,
  spineBend: 0.10,
  chestBend: -0.06,
  headPitch: -0.14,
  elbowOutL: 0.16,
  elbowOutR: 0.16,
  kneeOutL: 0.06,
  kneeOutR: 0.06,
  shrug: 0.04,
});

/** SEATED — rolling, low effort. Hips back on the saddle, torso more upright. */
export const SEATED = pose({
  pelvisY: -0.205,
  pelvisZ: -0.098,
  pelvisPitch: -0.12,
  spineBend: 0.20,
  chestBend: -0.10,
  headPitch: -0.20,
  elbowOutL: -0.06,
  elbowOutR: -0.06,
  kneeOutL: 0.14,
  kneeOutR: 0.14,
  hemSwing: 0,
});

/** CROUCH / PRELOAD — compressed, loading the bike. Everything folds. */
export const CROUCH = pose({
  pelvisY: -0.135,
  pelvisZ: -0.055,
  pelvisPitch: 0.10,
  spineBend: 0.46,
  spineStretch: 0.93,
  chestBend: 0.10,
  headPitch: -0.30,
  elbowOutL: 0.30,
  elbowOutR: 0.30,
  kneeOutL: 0.22,
  kneeOutR: 0.22,
  shrug: 0.16,
});

/** PUMP RELEASE — the explosive extension off the lip. Long, tall, open. */
export const PUMP_RELEASE = pose({
  pelvisY: 0.105,
  pelvisZ: 0.030,
  pelvisPitch: -0.16,
  spineBend: -0.14,
  spineStretch: 1.045,
  chestBend: -0.12,
  headPitch: -0.34,
  elbowOutL: 0.06,
  elbowOutR: 0.06,
  ankleFlexL: 0.28,
  ankleFlexR: 0.28,
  shrug: -0.06,
  reachBias: 0.5,
});

/** MANUAL — hips slung back off the rear of the bike, arms straight, chest up. */
export const MANUAL = pose({
  pelvisY: -0.075,
  pelvisZ: -0.235,
  pelvisPitch: -0.22,
  spineBend: -0.06,
  chestBend: -0.16,
  headPitch: -0.26,
  elbowOutL: -0.22,
  elbowOutR: -0.22,
  kneeOutL: 0.10,
  kneeOutR: 0.10,
  reachBias: 0.7,
});

/** AIRBORNE NEUTRAL — a slight tuck, weight found, ready to spot the landing. */
export const AIR = pose({
  pelvisY: -0.035,
  pelvisZ: -0.020,
  spineBend: 0.22,
  chestBend: -0.04,
  headPitch: 0.06,
  elbowOutL: 0.24,
  elbowOutR: 0.24,
  kneeOutL: 0.18,
  kneeOutR: 0.18,
  shrug: 0.10,
});

/** BRAKING — hips back and low, arms braced straight against the bars. */
export const BRAKE = pose({
  pelvisY: -0.090,
  pelvisZ: -0.150,
  pelvisPitch: -0.06,
  spineBend: 0.24,
  chestBend: -0.14,
  headPitch: -0.18,
  elbowOutL: -0.14,
  elbowOutR: -0.14,
  kneeOutL: 0.10,
  kneeOutR: 0.10,
});

/**
 * COASTING / FREEWHEELING — moving fast, not driving the cranks.
 *
 * A BMX gear spins out around 30 km/h, so above that a rider is NOT pedalling,
 * and the difference between working and resting has to be visible or every
 * high-speed frame looks like every other one. The tells are all small and all
 * specific: cranks level, heels dropped onto the platforms, hips slid back and
 * down out of the wind, chest lower, chin up looking further ahead. Nothing
 * here is a large angle; the whole point is that it changes the SHAPE of the
 * silhouette without changing the pose the rider is in.
 */
export const COAST = pose({
  pelvisY: -0.030,
  pelvisZ: -0.075,
  pelvisPitch: -0.08,
  spineBend: 0.30,
  chestBend: -0.14,
  headPitch: -0.24,
  elbowOutL: 0.04,
  elbowOutR: 0.04,
  kneeOutL: 0.05,
  kneeOutR: 0.05,
  // Heels down on the platforms — the single clearest "not pedalling" read.
  ankleFlexL: -0.30,
  ankleFlexR: -0.30,
  shrug: -0.04,
  hemSwing: 0.25,
});

/** PEDALLING (standing) — the attitude a rider takes when actually driving. */
export const SPRINT = pose({
  pelvisY: 0.030,
  pelvisZ: 0.020,
  spineBend: 0.26,
  chestBend: -0.02,
  headPitch: -0.10,
  elbowOutL: 0.26,
  elbowOutR: 0.26,
  shrug: 0.12,
});

// ─────────────────────────────────────────────────────────────────────────────
// Trick poses — authored for side = +1 (left), mirrored by the rig
// ─────────────────────────────────────────────────────────────────────────────

/**
 * TABLETOP — the bike is laid flat sideways under the rider. The rider's job is
 * to stay square to the world: a hard lateral break at the waist, hips driven
 * across, head turned down the line of the bike. In silhouette this is the only
 * trick where the torso and the bike form an L.
 */
export const TABLETOP = pose({
  pelvisX: 0.085,
  pelvisY: -0.020,
  pelvisZ: -0.030,
  pelvisRoll: -0.22,
  pelvisYaw: 0.14,
  spineSide: -0.30,
  spineTwist: 0.20,
  spineBend: 0.12,
  headYaw: -0.26,
  headPitch: 0.10,
  headRoll: -0.14,
  headLook: 0,
  elbowOutL: 0.42,
  elbowOutR: -0.12,
  kneeOutL: 0.30,
  kneeOutR: -0.05,
  footOffLX: 0.045,
  footOffRX: 0.025,
  hemSwing: -0.5,
});

/**
 * X-UP — bars cranked past 180°, arms crossed. The arms are driven by the bar
 * anchors (which the bike twists), so what this pose adds is the rest of the
 * body: shoulders squared and dropped, chin down watching the bars, knees
 * pinched together.
 */
export const XUP = pose({
  pelvisY: -0.015,
  spineBend: 0.24,
  chestBend: 0.10,
  headPitch: 0.42,
  headLook: 0,
  elbowOutL: -0.34,
  elbowOutR: -0.34,
  shrug: 0.22,
  kneeOutL: -0.22,
  kneeOutR: -0.22,
  reachBias: 0.4,
});

/**
 * SUPERMAN — the whole body a straight line trailing behind the bars, feet off
 * the pedals. This is the one trick where the feet MUST release: the trick is
 * defined by the separation, and locking the feet would produce a rider doing a
 * strange squat instead. The hands stay welded.
 */
export const SUPERMAN = pose({
  pelvisY: -0.020,
  pelvisZ: -0.520,
  // The pelvis carries the whole rotation and the spine ARCHES back against it.
  // Authoring this as a small pelvis pitch plus a big spine extension cancels
  // out and leaves the rider sitting upright behind the bars — which is a squat,
  // not a superman.
  pelvisPitch: 0.95,
  spineBend: -0.22,
  spineStretch: 1.06,
  chestBend: -0.22,
  headPitch: -0.46,
  headLook: 0,
  elbowOutL: -0.30,
  elbowOutR: -0.30,
  footLockL: 0,
  footLockR: 0,
  footOffLX: 0.075,
  footOffLY: 0.300,
  footOffLZ: -0.520,
  footOffRX: -0.075,
  footOffRY: 0.300,
  footOffRZ: -0.520,
  kneeOutL: -0.35,
  kneeOutR: -0.35,
  ankleFlexL: 0.55,
  ankleFlexR: 0.55,
  hemSwing: 0,
  reachBias: 1,
});

/**
 * TAILWHIP — the frame swings a full turn beneath a rider who is hanging on the
 * bars with both feet lifted and tucked. Feet release; knees come up high and
 * together so the frame has room to pass.
 */
export const TAILWHIP = pose({
  pelvisY: 0.115,
  pelvisZ: -0.045,
  pelvisPitch: 0.16,
  spineBend: 0.42,
  chestBend: 0.06,
  headPitch: 0.38,
  headLook: 0,
  elbowOutL: 0.10,
  elbowOutR: 0.10,
  shrug: 0.26,
  footLockL: 0,
  footLockR: 0,
  footOffLX: 0.055,
  footOffLY: 0.330,
  footOffLZ: 0.145,
  footOffRX: -0.055,
  footOffRY: 0.330,
  footOffRZ: 0.145,
  kneeOutL: 0.34,
  kneeOutR: 0.34,
  ankleFlexL: -0.25,
  ankleFlexR: -0.25,
});

/**
 * 360 — the rider LEADS the spin. Head first, then shoulders, then hips: the
 * counter-wound torso is what tells you which way the bike is about to go, and
 * it is the single detail that separates a spin from a bike that happens to be
 * pointing the wrong way.
 */
export const SPIN = pose({
  pelvisYaw: 0.22,
  pelvisY: -0.020,
  spineTwist: 0.52,
  spineSide: 0.14,
  spineBend: 0.26,
  headYaw: 0.85,
  headPitch: 0.10,
  headLook: 0,
  elbowOutL: -0.20,
  elbowOutR: 0.28,
  kneeOutL: -0.16,
  kneeOutR: -0.16,
  shrug: 0.14,
  hemSwing: 0.6,
});

/**
 * BACKFLIP — an arch. Head thrown back, chest open, hips driven forward into the
 * bars, knees pulled up. Read as a C opening backwards.
 */
export const BACKFLIP = pose({
  pelvisY: 0.060,
  pelvisZ: 0.075,
  pelvisPitch: -0.34,
  spineBend: -0.52,
  spineStretch: 1.02,
  chestBend: -0.26,
  headPitch: -0.72,
  headLook: 0,
  elbowOutL: 0.36,
  elbowOutR: 0.36,
  kneeOutL: 0.34,
  kneeOutR: 0.34,
  ankleFlexL: -0.35,
  ankleFlexR: -0.35,
  hemSwing: 0.8,
});

/**
 * FRONTFLIP — a ball. Chin to chest, spine fully curled, hips high behind the
 * bars, everything folded in. The exact opposite silhouette to the backflip,
 * which is what makes the two readable at a glance in a still frame.
 */
export const FRONTFLIP = pose({
  pelvisY: 0.095,
  pelvisZ: -0.075,
  pelvisPitch: 0.46,
  spineBend: 0.74,
  spineStretch: 0.90,
  chestBend: 0.30,
  headPitch: 0.78,
  headLook: 0,
  elbowOutL: -0.18,
  elbowOutR: -0.18,
  kneeOutL: 0.10,
  kneeOutR: 0.10,
  ankleFlexL: 0.35,
  ankleFlexR: 0.35,
  shrug: 0.30,
  hemSwing: -0.4,
});

/** NO-FOOTER — feet kicked straight out sideways off the pedals, body upright. */
export const NO_FOOTER = pose({
  pelvisY: 0.045,
  spineBend: 0.12,
  chestBend: -0.10,
  headPitch: 0.20,
  headLook: 0,
  footLockL: 0,
  footLockR: 0,
  footOffLX: 0.330,
  footOffLY: 0.240,
  footOffLZ: 0.060,
  footOffRX: -0.330,
  footOffRY: 0.240,
  footOffRZ: 0.060,
  kneeOutL: 0.45,
  kneeOutR: 0.45,
  ankleFlexL: 0.30,
  ankleFlexR: 0.30,
});

/** Every TrickKind gets a distinct pose. `None` and `Manual` reuse the riding set. */
export const TRICK_POSES: Record<TrickKind, Pose> = {
  [TrickKind.None]: NEUTRAL,
  [TrickKind.Tabletop]: TABLETOP,
  [TrickKind.XUp]: XUP,
  [TrickKind.Superman]: SUPERMAN,
  [TrickKind.Tailwhip]: TAILWHIP,
  [TrickKind.Spin360]: SPIN,
  [TrickKind.Backflip]: BACKFLIP,
  [TrickKind.Frontflip]: FRONTFLIP,
  [TrickKind.Manual]: MANUAL,
  [TrickKind.NoFooter]: NO_FOOTER,
};

/**
 * How the BIKE has to move for each trick, for the fallback anchor path only.
 * When a real IBike supplies its anchors these are ignored — the bike's own
 * trick visual has already moved the bars and the frame, and the rig simply
 * follows them. Angles in radians at full extension.
 */
export interface TrickAnchorMotion {
  /** Bar twist about the steering axis. */
  barTwist: number;
  /** Frame (and therefore pedal) rotation about the steering axis. */
  whip: number;
}

export const TRICK_ANCHORS: Record<TrickKind, TrickAnchorMotion> = {
  [TrickKind.None]: { barTwist: 0, whip: 0 },
  [TrickKind.Tabletop]: { barTwist: 0, whip: 0 },
  [TrickKind.XUp]: { barTwist: Math.PI * 1.06, whip: 0 },
  [TrickKind.Superman]: { barTwist: 0, whip: 0 },
  [TrickKind.Tailwhip]: { barTwist: 0, whip: Math.PI * 2 },
  [TrickKind.Spin360]: { barTwist: 0, whip: 0 },
  [TrickKind.Backflip]: { barTwist: 0, whip: 0 },
  [TrickKind.Frontflip]: { barTwist: 0, whip: 0 },
  [TrickKind.Manual]: { barTwist: 0, whip: 0 },
  [TrickKind.NoFooter]: { barTwist: 0, whip: 0 },
};

// ─────────────────────────────────────────────────────────────────────────────
// Crash poses
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The crash set is authored for an impact arriving from the rider's FRONT-LEFT.
 * The rig picks between them on impact geometry and mirrors as needed, then adds
 * a direction-driven flail on top — see RiderRig.applyCrash.
 *
 * All four release the hands. A rider who keeps hold of the bars through a crash
 * reads as a mannequin bolted to the bike, which is the exact failure the brief
 * calls out.
 */

/**
 * CRASH_BRACE — the first 100 ms, and the reason a crash reads as a fall rather
 * than as a pose swap.
 *
 * A rider does not arrive on the floor. A crash measured at 60 fps runs:
 * something lets go, the leading hand comes off the bar, the shoulder drops
 * toward the impact, the hips slide off the back of the bike, and only THEN
 * does the body rotate down onto the ground — a fall from saddle height takes
 * 450 ms under gravity and cannot be faster. The previous crash went from
 * upright and riding to fully prone in 167 ms, because there was exactly one
 * crash pose and the blend into it was a 30 ms half-life.
 *
 * This pose is the first link. Note what it does NOT do: the trailing hand is
 * still on the bar and BOTH feet are still on the pedals. The rider is still on
 * the bike here. Everything after this is the fall.
 */
export const CRASH_BRACE = pose({
  pelvisX: 0.070,
  pelvisY: -0.070,
  pelvisZ: -0.085,
  pelvisPitch: 0.12,
  pelvisRoll: -0.26,
  pelvisYaw: 0.12,
  spineSide: -0.28,
  spineTwist: 0.24,
  spineBend: 0.32,
  chestBend: 0.12,
  headYaw: -0.36,
  headRoll: -0.24,
  headPitch: 0.20,
  headLook: 0,
  handLockL: 0,
  handLockR: 1,
  handOffLX: 0.155,
  handOffLY: -0.175,
  handOffLZ: 0.095,
  elbowOutL: 0.46,
  elbowOutR: -0.12,
  kneeOutL: 0.26,
  kneeOutR: 0.05,
  ankleFlexL: 0.18,
  shrug: 0.22,
  hemSwing: -0.45,
  reachBias: 0.8,
});

/** Thrown over the bars: body pitched forward, arms out to break the fall. */
export const CRASH_OTB = pose({
  pelvisY: 0.075,
  pelvisZ: 0.115,
  pelvisPitch: 0.62,
  spineBend: 0.58,
  chestBend: 0.18,
  headPitch: 0.48,
  headLook: 0,
  handLockL: 0,
  handLockR: 0,
  handOffLX: 0.130,
  handOffLY: -0.230,
  handOffLZ: 0.310,
  handOffRX: -0.130,
  handOffRY: -0.230,
  handOffRZ: 0.310,
  elbowOutL: 0.35,
  elbowOutR: 0.35,
  footLockL: 0,
  footLockR: 0,
  footOffLX: 0.070,
  footOffLY: 0.290,
  footOffLZ: -0.320,
  footOffRX: -0.070,
  footOffRY: 0.290,
  footOffRZ: -0.320,
  kneeOutL: 0.30,
  kneeOutR: 0.30,
  reachBias: 1,
});

/** Low-side: the bike slides out sideways and the rider goes down with it. */
export const CRASH_LOWSIDE = pose({
  pelvisX: 0.185,
  pelvisY: -0.230,
  pelvisZ: -0.075,
  pelvisRoll: -0.70,
  pelvisYaw: 0.30,
  spineSide: -0.62,
  spineTwist: 0.34,
  spineBend: 0.30,
  headRoll: -0.45,
  headYaw: -0.30,
  headPitch: 0.20,
  headLook: 0,
  handLockL: 0,
  handLockR: 1,
  handOffLX: 0.290,
  handOffLY: -0.320,
  handOffLZ: 0.060,
  elbowOutL: 0.50,
  footLockL: 0,
  footLockR: 0,
  footOffLX: 0.190,
  footOffLY: 0.130,
  footOffLZ: -0.150,
  footOffRX: 0.090,
  footOffRY: 0.210,
  footOffRZ: -0.190,
  kneeOutL: 0.42,
  kneeOutR: 0.20,
  hemSwing: -0.8,
  reachBias: 1,
});

/** Tumble: fully off the bike, curled, limbs trailing the rotation. */
export const CRASH_TUMBLE = pose({
  pelvisY: -0.060,
  pelvisZ: -0.130,
  pelvisPitch: 0.30,
  spineBend: 0.72,
  spineSide: -0.24,
  spineTwist: 0.30,
  spineStretch: 0.92,
  chestBend: 0.28,
  headPitch: 0.62,
  headYaw: -0.24,
  headLook: 0,
  handLockL: 0,
  handLockR: 0,
  handOffLX: 0.240,
  handOffLY: 0.100,
  handOffLZ: -0.090,
  handOffRX: -0.180,
  handOffRY: 0.190,
  handOffRZ: 0.060,
  elbowOutL: 0.55,
  elbowOutR: 0.40,
  footLockL: 0,
  footLockR: 0,
  footOffLX: 0.150,
  footOffLY: 0.360,
  footOffLZ: -0.180,
  footOffRX: -0.060,
  footOffRY: 0.420,
  footOffRZ: -0.060,
  kneeOutL: 0.50,
  kneeOutR: 0.36,
  hemSwing: 0.9,
  reachBias: 1,
});

/** Rear-wheel case / rag-doll settle: legs collapsed, upper body slack. */
export const CRASH_SETTLE = pose({
  pelvisY: -0.230,
  pelvisZ: -0.110,
  pelvisPitch: 0.34,
  spineBend: 0.46,
  spineSide: -0.16,
  chestBend: 0.24,
  headPitch: 0.52,
  headRoll: -0.18,
  headLook: 0,
  handLockL: 0,
  handLockR: 0,
  handOffLX: 0.130,
  handOffLY: -0.130,
  handOffLZ: 0.060,
  handOffRX: -0.130,
  handOffRY: -0.130,
  handOffRZ: 0.060,
  elbowOutL: 0.30,
  elbowOutR: 0.30,
  footLockL: 0,
  footLockR: 0,
  footOffLX: 0.120,
  footOffLY: 0.080,
  footOffLZ: -0.060,
  footOffRX: -0.120,
  footOffRY: 0.080,
  footOffRZ: -0.060,
  kneeOutL: 0.40,
  kneeOutR: 0.40,
  reachBias: 1,
});
