/**
 * Input — keyboard and gamepad, normalised into one analogue rider intent.
 *
 * Two design points that matter downstream:
 *
 *  1. Digital keys are SMOOTHED into analogue axes with asymmetric attack and
 *     release. A keyboard steer input that snaps from 0 to 1 makes the bike
 *     feel like it is on rails; ramping it over ~110ms and releasing over ~70ms
 *     gives keyboard players something close to a stick's feel without making
 *     the controls sluggish.
 *
 *  2. Every button exposes `pressed`, `justPressed`, `justReleased` and a
 *     `heldFor` timer. Preload-and-pump, bunny hop timing and trick input all
 *     depend on *when* a button was released relative to a physics event, so
 *     edge detection has to survive a frame in which several physics steps ran.
 *
 * The whole struct is also settable from outside, which is how the capture
 * harness drives the game to an exact moment without touching the DOM.
 */

import { clamp, moveTowards } from './MathX';

export interface ButtonState {
  pressed: boolean;
  justPressed: boolean;
  justReleased: boolean;
  /** Seconds held. Reset to 0 on release. */
  heldFor: number;
  /** Seconds since the last release edge — for pump timing windows. */
  sinceRelease: number;
}

function makeButton(): ButtonState {
  return { pressed: false, justPressed: false, justReleased: false, heldFor: 0, sinceRelease: 999 };
}

/** The action set. Everything the rider can express. */
export const ACTIONS = [
  'steerLeft',
  'steerRight',
  'pedal',
  'brakeRear',
  'brakeFront',
  'crouch',       // preload / manual / bunny-hop charge
  'leanBack',
  'leanForward',
  'trick1',       // tailwhip / x-up modifier
  'trick2',       // superman / tabletop modifier
  'boost',
  'reset',
  'lookBack',
  'pause',
  'restart',
  'toggleCam',
  'toggleDebug',
] as const;
export type Action = (typeof ACTIONS)[number];

const DEFAULT_BINDINGS: Record<string, Action> = {
  KeyA: 'steerLeft',
  ArrowLeft: 'steerLeft',
  KeyD: 'steerRight',
  ArrowRight: 'steerRight',
  KeyW: 'pedal',
  ArrowUp: 'pedal',
  KeyS: 'brakeRear',
  ArrowDown: 'brakeRear',
  KeyQ: 'brakeFront',
  Space: 'crouch',
  KeyJ: 'leanBack',
  KeyK: 'leanForward',
  ShiftLeft: 'trick1',
  ShiftRight: 'trick1',
  KeyE: 'trick2',
  KeyF: 'boost',
  KeyR: 'reset',
  KeyC: 'lookBack',
  Escape: 'pause',
  Enter: 'restart',
  KeyV: 'toggleCam',
  Backquote: 'toggleDebug',
};

/** Smoothed analogue rider intent, consumed by the bike and rider systems. */
export interface RiderIntent {
  /** -1 (left) .. +1 (right). Smoothed. */
  steer: number;
  /** 0..1 pedal effort. */
  pedal: number;
  /** 0..1 rear brake. */
  brakeRear: number;
  /** 0..1 front brake. */
  brakeFront: number;
  /** 0..1 crouch/compression. This is the preload channel. */
  crouch: number;
  /** -1 (forward over the bars) .. +1 (back, manual). */
  pitchLean: number;
  /** Raw button states for edge-sensitive logic. */
  buttons: Record<Action, ButtonState>;
  /** True while any gamepad is providing input — HUD swaps its prompts. */
  usingGamepad: boolean;
}

export class Input {
  readonly intent: RiderIntent;
  private down = new Set<string>();
  private pressedThisFrame = new Set<string>();
  private releasedThisFrame = new Set<string>();
  private bindings: Record<string, Action>;
  private enabled = true;
  /** When true, all hardware input is ignored and the harness drives `intent`. */
  scripted = false;
  private gamepadIndex: number | null = null;

  constructor(target: HTMLElement | Window = window, bindings = DEFAULT_BINDINGS) {
    this.bindings = bindings;
    const buttons = {} as Record<Action, ButtonState>;
    for (const a of ACTIONS) buttons[a] = makeButton();
    this.intent = {
      steer: 0,
      pedal: 0,
      brakeRear: 0,
      brakeFront: 0,
      crouch: 0,
      pitchLean: 0,
      buttons,
      usingGamepad: false,
    };

    const el = target as Window;
    el.addEventListener('keydown', this.onKeyDown as EventListener);
    el.addEventListener('keyup', this.onKeyUp as EventListener);
    window.addEventListener('blur', this.onBlur);
    window.addEventListener('gamepadconnected', this.onGamepadConnected as EventListener);
    window.addEventListener('gamepaddisconnected', this.onGamepadDisconnected as EventListener);
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (!this.enabled || this.scripted) return;
    if (e.repeat) return;
    if (this.bindings[e.code]) {
      e.preventDefault();
      this.down.add(e.code);
      this.pressedThisFrame.add(e.code);
      this.intent.usingGamepad = false;
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    if (!this.enabled || this.scripted) return;
    if (this.bindings[e.code]) {
      e.preventDefault();
      this.down.delete(e.code);
      this.releasedThisFrame.add(e.code);
    }
  };

  /** Losing focus mid-input would otherwise leave a key stuck down forever. */
  private onBlur = (): void => {
    for (const code of this.down) this.releasedThisFrame.add(code);
    this.down.clear();
  };

  private onGamepadConnected = (e: GamepadEvent): void => {
    this.gamepadIndex = e.gamepad.index;
  };

  private onGamepadDisconnected = (e: GamepadEvent): void => {
    if (this.gamepadIndex === e.gamepad.index) this.gamepadIndex = null;
  };

  private isActionDown(a: Action): boolean {
    for (const code in this.bindings) {
      if (this.bindings[code] === a && this.down.has(code)) return true;
    }
    return false;
  }

  private wasActionPressed(a: Action): boolean {
    for (const code of this.pressedThisFrame) if (this.bindings[code] === a) return true;
    return false;
  }

  private wasActionReleased(a: Action): boolean {
    for (const code of this.releasedThisFrame) if (this.bindings[code] === a) return true;
    return false;
  }

  /** Call once per frame, before the fixed-update loop. */
  update(dt: number): void {
    if (this.scripted) {
      this.updateButtonTimers(dt);
      return;
    }

    const pad = this.pollGamepad();

    for (const a of ACTIONS) {
      const b = this.intent.buttons[a];
      const wasPressed = b.pressed;
      const nowPressed = this.isActionDown(a) || (pad ? padActionDown(pad, a) : false);

      b.justPressed = (!wasPressed && nowPressed) || this.wasActionPressed(a);
      b.justReleased = (wasPressed && !nowPressed) || this.wasActionReleased(a);
      b.pressed = nowPressed;

      if (nowPressed) {
        b.heldFor += dt;
        b.sinceRelease = 0;
      } else {
        if (wasPressed) b.heldFor = 0;
        b.sinceRelease += dt;
      }
    }

    this.pressedThisFrame.clear();
    this.releasedThisFrame.clear();

    // ── Analogue synthesis ──────────────────────────────────────────────────
    const i = this.intent;

    if (pad) {
      // A real stick bypasses the keyboard smoothing entirely — the player is
      // already providing the curve with their thumb.
      const ax = deadzone(pad.axes[0] ?? 0, 0.12);
      i.steer = clamp(ax, -1, 1);
      i.pedal = Math.max(triggerValue(pad, 7), padActionDown(pad, 'pedal') ? 1 : 0);
      i.brakeRear = Math.max(triggerValue(pad, 6), padActionDown(pad, 'brakeRear') ? 1 : 0);
      i.brakeFront = padActionDown(pad, 'brakeFront') ? 1 : 0;
      i.crouch = padActionDown(pad, 'crouch') ? 1 : 0;
      i.pitchLean = clamp(-(deadzone(pad.axes[1] ?? 0, 0.15)), -1, 1);
      i.usingGamepad = true;
    } else {
      const steerTarget = (i.buttons.steerRight.pressed ? 1 : 0) - (i.buttons.steerLeft.pressed ? 1 : 0);
      // Asymmetric: ~60ms to full lock, ~55ms to centre. Quick to release so
      // corrections feel sharp; slower to engage so the bike doesn't snap.
      const attack = dt / 0.06;
      const release = dt / 0.055;
      i.steer =
        steerTarget === 0
          ? moveTowards(i.steer, 0, release)
          : moveTowards(i.steer, steerTarget, attack);

      i.pedal = moveTowards(i.pedal, i.buttons.pedal.pressed ? 1 : 0, dt / (i.buttons.pedal.pressed ? 0.09 : 0.16));
      i.brakeRear = moveTowards(i.brakeRear, i.buttons.brakeRear.pressed ? 1 : 0, dt / 0.06);
      i.brakeFront = moveTowards(i.brakeFront, i.buttons.brakeFront.pressed ? 1 : 0, dt / 0.06);
      // Crouch attacks fast (you can slam into a preload) and releases very
      // fast (the pop off the lip must be instantaneous to feel like a pump).
      i.crouch = moveTowards(i.crouch, i.buttons.crouch.pressed ? 1 : 0, dt / (i.buttons.crouch.pressed ? 0.07 : 0.035));

      const leanTarget = (i.buttons.leanBack.pressed ? 1 : 0) - (i.buttons.leanForward.pressed ? 1 : 0);
      i.pitchLean = moveTowards(i.pitchLean, leanTarget, dt / 0.12);
    }
  }

  private updateButtonTimers(dt: number): void {
    for (const a of ACTIONS) {
      const b = this.intent.buttons[a];
      if (b.pressed) {
        b.heldFor += dt;
        b.sinceRelease = 0;
      } else {
        b.sinceRelease += dt;
      }
    }
  }

  private pollGamepad(): Gamepad | null {
    const pads = navigator.getGamepads?.() ?? [];
    if (this.gamepadIndex !== null) {
      const p = pads[this.gamepadIndex];
      if (p && p.connected) return p;
    }
    for (const p of pads) {
      if (p && p.connected) {
        this.gamepadIndex = p.index;
        return p;
      }
    }
    return null;
  }

  /** Used by the capture harness and the AI-controlled demo attract mode. */
  setScripted(on: boolean): void {
    this.scripted = on;
    if (on) {
      this.down.clear();
      const i = this.intent;
      i.steer = i.pedal = i.brakeRear = i.brakeFront = i.crouch = i.pitchLean = 0;
      for (const a of ACTIONS) {
        const b = i.buttons[a];
        b.pressed = b.justPressed = b.justReleased = false;
      }
    }
  }

  /** Programmatically press/release, for scripted playback. */
  scriptButton(a: Action, pressed: boolean): void {
    const b = this.intent.buttons[a];
    if (pressed && !b.pressed) b.justPressed = true;
    if (!pressed && b.pressed) b.justReleased = true;
    b.pressed = pressed;
  }

  /** Clear all justPressed/justReleased edges. Call at the end of a frame. */
  clearEdges(): void {
    for (const a of ACTIONS) {
      const b = this.intent.buttons[a];
      b.justPressed = false;
      b.justReleased = false;
    }
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (!on) this.onBlur();
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown as EventListener);
    window.removeEventListener('keyup', this.onKeyUp as EventListener);
    window.removeEventListener('blur', this.onBlur);
    window.removeEventListener('gamepadconnected', this.onGamepadConnected as EventListener);
    window.removeEventListener('gamepaddisconnected', this.onGamepadDisconnected as EventListener);
  }
}

// ── Gamepad helpers ──────────────────────────────────────────────────────────
function deadzone(v: number, dz: number): number {
  const a = Math.abs(v);
  if (a < dz) return 0;
  return Math.sign(v) * ((a - dz) / (1 - dz));
}

function triggerValue(pad: Gamepad, index: number): number {
  const b = pad.buttons[index];
  return b ? b.value : 0;
}

/** Standard-mapping gamepad layout. */
const PAD_MAP: Partial<Record<Action, number>> = {
  crouch: 0,        // A / cross
  trick1: 2,        // X / square
  trick2: 3,        // Y / triangle
  boost: 1,         // B / circle
  brakeFront: 4,    // LB
  pedal: 5,         // RB (also RT via trigger)
  lookBack: 10,
  reset: 8,
  pause: 9,
  toggleCam: 11,
};

function padActionDown(pad: Gamepad, a: Action): boolean {
  const idx = PAD_MAP[a];
  if (idx === undefined) return false;
  const b = pad.buttons[idx];
  return !!b && b.pressed;
}
