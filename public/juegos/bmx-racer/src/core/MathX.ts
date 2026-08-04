/**
 * MathX — the small numeric vocabulary the whole game shares.
 *
 * Everything here is frame-rate independent. Any smoothing helper takes `dt`
 * and behaves identically at 60fps, 120fps, or during a capture run at fixed
 * step. That property is load-bearing: the camera and rider rig both lean on
 * these, and a spring that changes character with frame time makes the game
 * feel different on different machines.
 */

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;

export const clamp = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v;

export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export const invLerp = (a: number, b: number, v: number): number =>
  a === b ? 0 : (v - a) / (b - a);

export const remap = (v: number, a0: number, b0: number, a1: number, b1: number): number =>
  lerp(a1, b1, invLerp(a0, b0, v));

/** Remap with the input range clamped — the form you want 90% of the time. */
export const remapClamped = (v: number, a0: number, b0: number, a1: number, b1: number): number =>
  lerp(a1, b1, clamp01(invLerp(a0, b0, v)));

export const smoothstep = (edge0: number, edge1: number, x: number): number => {
  const t = clamp01((x - edge0) / (edge1 - edge0 || 1e-9));
  return t * t * (3 - 2 * t);
};

/** Smoother Hermite (Ken Perlin's) — zero 1st and 2nd derivative at the ends. */
export const smootherstep = (edge0: number, edge1: number, x: number): number => {
  const t = clamp01((x - edge0) / (edge1 - edge0 || 1e-9));
  return t * t * t * (t * (t * 6 - 15) + 10);
};

export const sign = (v: number): number => (v > 0 ? 1 : v < 0 ? -1 : 0);

export const saturate = clamp01;

/**
 * Exponential smoothing that is exactly frame-rate independent.
 * `rate` is "fraction of the gap closed per second", in [0,1).
 * damp(a, b, 0.9, dt) closes 90% of the remaining distance every second.
 */
export function damp(current: number, target: number, rate: number, dt: number): number {
  return lerp(current, target, 1 - Math.pow(1 - clamp01(rate), dt));
}

/**
 * The form we actually use everywhere: half-life based smoothing.
 * After `halfLife` seconds the value has covered half the remaining distance.
 * Frame-rate independent by construction, and the parameter is intuitive.
 */
export function dampHL(current: number, target: number, halfLife: number, dt: number): number {
  if (halfLife <= 0) return target;
  return target + (current - target) * Math.pow(2, -dt / halfLife);
}

/** Angular version of dampHL — takes the short way around the circle. */
export function dampAngleHL(current: number, target: number, halfLife: number, dt: number): number {
  return current + shortAngle(current, target) * (1 - Math.pow(2, -dt / halfLife));
}

/** Shortest signed delta from `a` to `b` on the circle, in (-PI, PI]. */
export function shortAngle(a: number, b: number): number {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

export function wrapAngle(a: number): number {
  let x = (a + Math.PI) % TAU;
  if (x < 0) x += TAU;
  return x - Math.PI;
}

/**
 * Critically-damped spring. This is the workhorse for the chase camera,
 * suspension visuals, and HUD needles. Stable at large dt because it uses
 * the analytic solution rather than Euler integration.
 *
 * `omega` is angular frequency (rad/s) — roughly "stiffness".
 * Returns the new position; velocity is carried in the `state` object.
 */
export interface SpringState {
  value: number;
  velocity: number;
}

export function springStep(state: SpringState, target: number, omega: number, dt: number): number {
  // Analytic critically-damped solution: x(t) = (A + B t) e^(-w t)
  const w = Math.max(omega, 1e-4);
  const exp = Math.exp(-w * dt);
  const dx = state.value - target;
  const dv = state.velocity + w * dx;
  state.value = target + (dx + dv * dt) * exp;
  state.velocity = (state.velocity - w * dv * dt) * exp;
  return state.value;
}

export function makeSpring(value = 0, velocity = 0): SpringState {
  return { value, velocity };
}

/** Under-damped spring with explicit damping ratio — for overshoot you can feel. */
export function springStepDamped(
  state: SpringState,
  target: number,
  omega: number,
  zeta: number,
  dt: number,
): number {
  const w = Math.max(omega, 1e-4);
  const f = 1 + 2 * dt * zeta * w;
  const oo = w * w;
  const hoo = dt * oo;
  const hhoo = dt * hoo;
  const det = 1 / (f + hhoo);
  const detX = f * state.value + dt * state.velocity + hhoo * target;
  const detV = state.velocity + hoo * (target - state.value);
  state.value = detX * det;
  state.velocity = detV * det;
  return state.value;
}

/** Move `current` toward `target` by at most `maxDelta`. */
export function moveTowards(current: number, target: number, maxDelta: number): number {
  const d = target - current;
  if (Math.abs(d) <= maxDelta) return target;
  return current + Math.sign(d) * maxDelta;
}

/**
 * Quantise a value into `steps` discrete bands over [0,1].
 * The NPR pipeline's fundamental operation, mirrored here on the CPU so
 * gameplay logic (dust burst tiers, HUD ticks) can match the visual banding.
 */
export function quantize(v: number, steps: number): number {
  return Math.floor(clamp01(v) * steps) / Math.max(1, steps - 1);
}

/** Triangle wave in [0,1] with period 1. Useful for ping-pong animation. */
export function pingPong(t: number): number {
  const x = t - Math.floor(t);
  return x < 0.5 ? x * 2 : 2 - x * 2;
}

// ── Easing curves used by the HUD, camera cuts, and trick poses ──────────────
export const ease = {
  inQuad: (t: number) => t * t,
  outQuad: (t: number) => t * (2 - t),
  inOutQuad: (t: number) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t),
  inCubic: (t: number) => t * t * t,
  outCubic: (t: number) => 1 - Math.pow(1 - t, 3),
  inOutCubic: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  outQuart: (t: number) => 1 - Math.pow(1 - t, 4),
  outExpo: (t: number) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)),
  inExpo: (t: number) => (t <= 0 ? 0 : Math.pow(2, 10 * t - 10)),
  outBack: (t: number) => {
    const c1 = 1.70158, c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
  outElastic: (t: number) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    const c4 = TAU / 3;
    return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
  },
  /** Anime-style snap: fast attack, tiny settle. Used for HUD popups. */
  snap: (t: number) => {
    if (t >= 1) return 1;
    return 1 - Math.pow(1 - t, 5) * Math.cos(t * 9);
  },
};

/** Format seconds as M:SS.mmm — the race clock. */
export function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '--:--.---';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);
  return `${m}:${s.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
}

/** Format a signed gap as +1.23 / -0.45 — the split display. */
export function formatGap(seconds: number): string {
  if (!isFinite(seconds)) return '--.--';
  const sgn = seconds >= 0 ? '+' : '-';
  const a = Math.abs(seconds);
  return `${sgn}${a.toFixed(2)}`;
}

/** Ordinal suffix for placement: 1st, 2nd, 3rd, 4th. */
export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
