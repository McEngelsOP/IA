/**
 * Menus — title, countdown, pause and results.
 *
 * All four are the same object: one layer, one canvas, and a `kind` that
 * decides which furniture gets baked and which dynamic content gets drawn over
 * it. Switching kind re-bakes the furniture once; after that a menu costs one
 * small redraw whenever its selection or its blink phase changes, and nothing
 * at all in between.
 *
 * The countdown is separate because it has to sit on top of a menu-free frame
 * during the race start, and because it is the one element in the HUD that is
 * genuinely animating every frame for a second and a half.
 */

import type { HudModel, RacerProgress } from '../game/Contracts';
import { RacePhase } from '../game/Contracts';
import { HUD_PALETTE, RIDER_COLORS } from '../npr/Palette';
import { clamp01, dampHL, ease, formatTime } from '../core/MathX';
import {
  HudLayer,
  bar,
  chevron,
  cornerTicks,
  css,
  cssA,
  hazard,
  slab,
  slabPath,
  tick,
  INK_W,
  SHEAR,
} from './HudCanvas';
import { drawText, drawWordmark, measureText, type TextStyle } from './Typeface';
import { Widget } from './Widgets';

const P = {
  ink: css(HUD_PALETTE.ink),
  inkSoft: css(HUD_PALETTE.inkSoft),
  paper: css(HUD_PALETTE.paper),
  paperDim: css(HUD_PALETTE.paperDim),
  gold: css(HUD_PALETTE.gold),
  goldHot: css(HUD_PALETTE.goldHot),
  red: css(HUD_PALETTE.red),
  teal: css(HUD_PALETTE.teal),
  violet: css(HUD_PALETTE.violet),
  panel: cssA(HUD_PALETTE.ink, 0.90),
  panelSoft: cssA(HUD_PALETTE.inkSoft, 0.72),
};

export type MenuKind = 'none' | 'title' | 'pause' | 'results';

export const DEFAULT_MENU_ITEMS: Record<MenuKind, string[]> = {
  none: [],
  title: ['START DESCENT'],
  pause: ['RESUME', 'RESTART RUN', 'QUIT TO TITLE'],
  results: ['RACE AGAIN', 'QUIT TO TITLE'],
};

// ─────────────────────────────────────────────────────────────────────────────
// Countdown
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 3 — 2 — 1 — GO.
 *
 * Each number snaps in over 130ms with `ease.snap` (which overshoots and settles
 * once), holds, then cuts. A hard octagonal ring expands out of it and vanishes.
 * Nothing crossfades: the number is either the old one or the new one, and the
 * ring is the thing that carries the beat.
 */
export class CountdownWidget extends Widget {
  private value: number | null = null;
  private curDigit = -99;
  private age = 0;
  private go = -99;

  constructor(layer: HudLayer) {
    super(layer);
    this.enterY = 0;
  }

  override furniture(): void {
    // Nothing static — the countdown is pure animation.
  }

  override update(m: HudModel, dt: number, time: number): void {
    const cd = m.countdown;
    if (cd !== null && cd > 0) {
      // COUNTDOWN_SECONDS is 3.4, so the first tick would read "4". Clamp it.
      const n = Math.min(3, Math.max(1, Math.ceil(cd - 0.0001)));
      if (n !== this.curDigit) {
        this.curDigit = n;
        this.age = 0;
      }
      this.value = n;
      this.go = -99;
    } else if (cd !== null && cd <= 0) {
      if (this.go < -1) this.go = 0;
      this.value = 0;
    } else if (this.curDigit > 0 && this.go < -1) {
      // The model dropped the countdown without ever reporting <= 0; treat the
      // transition itself as the gun so GO is never skipped.
      this.go = 0;
      this.value = 0;
    }

    this.age += dt;
    if (this.go > -1) this.go += dt;

    const alive = (this.value !== null && this.value > 0) || (this.go >= 0 && this.go < 0.85);
    if (!alive) {
      this.value = null;
      this.curDigit = -99;
    }
    this.present(alive, dt, 0.02);
    this.sig(alive ? `${this.value}|${Math.round(this.age * 60)}|${Math.round(this.go * 60)}` : 'off');
  }

  override draw(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const cx = w * 0.5;
    const cy = h * 0.5;
    const going = this.go >= 0 && this.go < 0.85;
    const t = going ? this.go : this.age;
    const k = ease.snap(clamp01(t / 0.13));

    // Expanding ring — a hard octagon, because a circle would be the only
    // smooth curve in the frame.
    const ring = clamp01(t / 0.42);
    if (ring < 1) {
      const r = 70 + ease.outQuart(ring) * 210;
      ctx.save();
      ctx.globalAlpha = 1 - ring;
      ctx.beginPath();
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
        const px = cx + Math.cos(a) * r;
        const py = cy + Math.sin(a) * r;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.strokeStyle = going ? P.goldHot : P.paper;
      ctx.lineWidth = 8 * (1 - ring) + 2;
      ctx.stroke();
      ctx.restore();
    }

    const label = going ? 'GO' : String(this.value ?? 3);
    const size = (going ? 210 : 190) * (0.55 + k * 0.45);
    ctx.save();
    ctx.globalAlpha = clamp01(k * 2);
    drawWordmark(ctx, label, cx, cy + size * 0.42, size, going ? P.goldHot : P.paper, P.ink, 1);
    ctx.restore();

    if (going) {
      // Speed wedges either side on the gun.
      const spread = ease.outQuart(clamp01(this.go / 0.3));
      ctx.save();
      ctx.globalAlpha = clamp01(1 - this.go / 0.7);
      for (const s of [-1, 1]) {
        for (let i = 0; i < 4; i++) {
          const x = cx + s * (150 + spread * (120 + i * 70));
          const hh = 46 - i * 8;
          bar(ctx, x - 60, cy - hh * 0.5, 120, hh, P.goldHot, null, 0, SHEAR);
        }
      }
      ctx.restore();
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Menu screen
// ─────────────────────────────────────────────────────────────────────────────

export interface MenuState {
  kind: MenuKind;
  items: string[];
  selection: number;
}

/** Where the results screen leaves a hole for the biggest-air replay. */
export interface ReplayFrameRect {
  /** In the menu layer's design units. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** The same rect in 0..1 screen space — what the camera director needs. */
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}

export class MenuScreen extends Widget {
  kind: MenuKind = 'none';
  items: string[] = [];
  selection = 0;

  /** Set true once the results replay is running so the frame label changes. */
  replayActive = false;

  private rows: {
    pos: number; name: string; time: string; delta: string; score: number; player: boolean; color: string;
  }[] = [];
  private age = 0;
  private blink = 0;
  private lastKind: MenuKind = 'none';
  private frame: ReplayFrameRect = { x: 0, y: 0, w: 0, h: 0, u0: 0, v0: 0, u1: 0, v1: 0 };

  constructor(layer: HudLayer) {
    super(layer);
    this.enterY = 60;
  }

  /** The replay window in screen UV, for whoever drives the replay camera. */
  get replayFrame(): ReplayFrameRect {
    return this.frame;
  }

  setKind(kind: MenuKind, items?: string[]): void {
    if (kind === this.kind) return;
    this.kind = kind;
    this.items = items ? items.slice() : DEFAULT_MENU_ITEMS[kind].slice();
    this.selection = 0;
    this.age = 0;
    this.layer.markFurniture();
    this.invalidate();
  }

  setItems(items: string[]): void {
    this.items = items.slice();
    this.selection = Math.min(this.selection, Math.max(0, items.length - 1));
    this.invalidate();
  }

  setSelection(i: number): void {
    const n = Math.max(1, this.items.length);
    const next = ((i % n) + n) % n;
    if (next !== this.selection) {
      this.selection = next;
      this.invalidate();
    }
  }

  moveSelection(delta: number): void {
    this.setSelection(this.selection + delta);
  }

  // ── Furniture ─────────────────────────────────────────────────────────────

  override furniture(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    if (this.kind === 'none') return;
    if (this.kind === 'title') this.titleFurniture(ctx, w, h);
    else if (this.kind === 'pause') this.pauseFurniture(ctx, w, h);
    else this.resultsFurniture(ctx, w, h);
  }

  private titleFurniture(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    // A single raking band of hazard stripes behind the wordmark — the only
    // decoration on the screen, and it does the job of a background image.
    ctx.save();
    slabPath(ctx, 40, h * 0.30, w - 80, 190, 0b0101, 34, SHEAR);
    ctx.clip();
    ctx.fillStyle = cssA(HUD_PALETTE.ink, 0.86);
    ctx.fillRect(0, 0, w, h);
    hazard(ctx, 0, h * 0.30, w, 190, cssA(HUD_PALETTE.violet, 0.45), 44, 0.45, 0);
    ctx.restore();
    slabPath(ctx, 40, h * 0.30, w - 80, 190, 0b0101, 34, SHEAR);
    ctx.strokeStyle = P.gold;
    ctx.lineWidth = 4;
    ctx.stroke();

    drawText(ctx, 'ALPINE DOWNHILL', w * 0.5, h * 0.30 - 26, {
      size: 24, weight: 0.18, fill: P.gold, ink: P.ink, tracking: 0.46, align: 'center', skew: SHEAR,
    });
    drawText(ctx, 'SUMMIT TO VALLEY   ·   ONE RUN   ·   NO BRAKES WORTH USING', w * 0.5, h * 0.30 + 236, {
      size: 18, weight: 0.16, fill: P.paperDim, ink: P.ink, tracking: 0.20, align: 'center', skew: 0,
    });

    // Rider strip along the bottom: the four identity colours, so the palette
    // introduces itself before the race does.
    const sw = 120;
    for (let i = 0; i < RIDER_COLORS.length; i++) {
      const x = w * 0.5 - (RIDER_COLORS.length * (sw + 10)) * 0.5 + i * (sw + 10);
      bar(ctx, x, h - 96, sw, 12, css(RIDER_COLORS[i].jersey), P.ink, 2);
      drawText(ctx, RIDER_COLORS[i].name, x + sw * 0.5, h - 62, {
        size: 15, weight: 0.17, fill: P.paperDim, ink: P.ink, tracking: 0.2, align: 'center', skew: 0,
      });
    }
  }

  private pauseFurniture(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const pw = 620;
    const ph = 460;
    const x = (w - pw) * 0.5;
    const y = (h - ph) * 0.5;
    slab(ctx, x, y, pw, ph, {
      fill: P.panel, ink: P.ink, inkWidth: 4, cuts: 0b0101, cut: 34, accent: P.gold, accentHeight: 8,
    });
    drawText(ctx, 'PAUSED', w * 0.5, y + 92, {
      size: 62, weight: 0.19, fill: P.paper, ink: P.ink, inkWidth: 0.06, tracking: 0.18, align: 'center', skew: SHEAR,
    });
    tick(ctx, x + 50, y + 122, x + pw - 50, y + 122, 3, P.gold);
  }

  private resultsFurniture(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    slab(ctx, 20, 20, w - 40, h - 40, {
      fill: P.panel, ink: P.ink, inkWidth: 4, cuts: 0b0101, cut: 40, accent: P.gold, accentHeight: 8,
    });
    drawText(ctx, 'RESULTS', 70, 106, {
      size: 62, weight: 0.19, fill: P.goldHot, ink: P.ink, inkWidth: 0.06, tracking: 0.16, skew: SHEAR,
    });
    tick(ctx, 62, 132, w * 0.52, 132, 3.4, P.gold);

    // Column heads for the table.
    const hy = 176;
    const cols: [string, number, TextStyle['align']][] = [
      ['POS', 74, 'left'],
      ['RIDER', 148, 'left'],
      ['TIME', 470, 'right'],
      ['DELTA', 610, 'right'],
      ['TRICKS', 748, 'right'],
    ];
    for (const [t, x, a] of cols) {
      drawText(ctx, t, x, hy, { size: 15, weight: 0.18, fill: P.paperDim, ink: null, tracking: 0.24, align: a, skew: 0 });
    }

    // The replay window. A genuine hole cut in the panel: everything behind the
    // HUD — the replay camera's view of the biggest air — shows straight
    // through it. The frame is the only thing the HUD draws here.
    this.layoutFrame(w, h);
    const f = this.frame;
    ctx.clearRect(f.x, f.y, f.w, f.h);
    ctx.strokeStyle = P.ink;
    ctx.lineWidth = 5;
    ctx.strokeRect(f.x, f.y, f.w, f.h);
    ctx.strokeStyle = P.gold;
    ctx.lineWidth = 2;
    ctx.strokeRect(f.x - 5, f.y - 5, f.w + 10, f.h + 10);
    cornerTicks(ctx, f.x + 10, f.y + 10, f.w - 20, f.h - 20, 28, 3, P.goldHot);
    drawText(ctx, 'BIGGEST AIR', f.x, f.y - 22, {
      size: 17, weight: 0.18, fill: P.gold, ink: P.ink, tracking: 0.3, skew: SHEAR,
    });
  }

  private layoutFrame(w: number, h: number): void {
    const fw = 460;
    const fh = 300;
    const fx = w - fw - 70;
    const fy = 196;
    this.frame.x = fx;
    this.frame.y = fy;
    this.frame.w = fw;
    this.frame.h = fh;
    this.frame.u0 = fx / w;
    this.frame.v0 = fy / h;
    this.frame.u1 = (fx + fw) / w;
    this.frame.v1 = (fy + fh) / h;
  }

  // ── Update ────────────────────────────────────────────────────────────────

  override update(m: HudModel, dt: number, time: number): void {
    const want: MenuKind =
      m.phase === RacePhase.Attract ? 'title'
        : m.phase === RacePhase.Paused ? 'pause'
          : m.phase === RacePhase.Results ? 'results'
            : 'none';
    if (want !== this.kind) this.setKind(want);

    if (this.kind !== this.lastKind) {
      this.lastKind = this.kind;
      this.age = 0;
    }
    this.age += dt;
    this.blink = time;

    if (this.kind === 'results') this.buildRows(m.standings);

    this.present(this.kind !== 'none', dt, 0.075);

    // While the rows stagger in the layer must redraw; after 1.4s it settles to
    // the blink rate and stops costing anything.
    const settling = this.age < 1.4 ? Math.round(this.age * 60) : 0;
    this.sig(`${this.kind}|${this.selection}|${settling}|${Math.round(this.blink * 2)}|${this.rows.length}`);
  }

  private buildRows(standings: RacerProgress[]): void {
    this.rows.length = 0;
    const sorted = standings.slice().sort((a, b) => {
      if (a.finished !== b.finished) return a.finished ? -1 : 1;
      if (a.finishTime !== null && b.finishTime !== null) return a.finishTime - b.finishTime;
      return a.position - b.position;
    });
    const winner = sorted.length && sorted[0].finishTime !== null ? sorted[0].finishTime : null;
    for (let i = 0; i < sorted.length; i++) {
      const r = sorted[i];
      const c = RIDER_COLORS[r.colorIndex % RIDER_COLORS.length];
      const t = r.finishTime;
      this.rows.push({
        pos: i + 1,
        name: r.name.toUpperCase(),
        time: t === null ? 'DNF' : formatTime(t),
        delta: i === 0 || t === null || winner === null ? '' : '+' + (t - winner).toFixed(2),
        score: Math.round(r.trickScore),
        player: r.isPlayer,
        color: css(c.jersey),
      });
    }
  }

  // ── Draw ──────────────────────────────────────────────────────────────────

  override draw(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    if (this.kind === 'none') return;
    if (this.kind === 'title') this.drawTitle(ctx, w, h);
    else if (this.kind === 'pause') this.drawPause(ctx, w, h);
    else this.drawResults(ctx, w, h);
  }

  private drawTitle(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    // The wordmark scales in once, on a snap, and then never moves again.
    const k = ease.snap(clamp01(this.age / 0.55));
    ctx.save();
    ctx.globalAlpha = clamp01(k * 1.5);
    drawWordmark(ctx, 'DESCENT', w * 0.5, h * 0.30 + 148, 132 * (0.82 + k * 0.18), P.paper, P.ink, 1);
    ctx.restore();

    if (this.items.length > 1) {
      this.drawItems(ctx, w, h * 0.62, 300);
    } else {
      const on = (Math.floor(this.blink * 1.6) & 1) === 0;
      const label = this.items[0] ?? 'PRESS ENTER TO DROP IN';
      drawText(ctx, label, w * 0.5, h * 0.70, {
        size: 30, weight: 0.17, fill: on ? P.goldHot : P.gold, ink: P.ink,
        tracking: 0.26, align: 'center', skew: SHEAR, alpha: this.age > 0.6 ? 1 : 0,
      });
    }
  }

  private drawPause(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const ph = 460;
    const y = (h - ph) * 0.5;
    this.drawItems(ctx, w, y + 186, 480);
  }

  private drawResults(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const rowH = 62;
    for (let i = 0; i < this.rows.length; i++) {
      const r = this.rows[i];
      // Stagger: 90ms apart, each on a snap. Four rows land like four beats.
      const k = ease.snap(clamp01((this.age - 0.18 - i * 0.09) / 0.24));
      if (k <= 0) continue;
      const y = 206 + i * (rowH + 10);
      const bw = (760 - 62) * k;

      ctx.save();
      ctx.globalAlpha = clamp01(k * 1.6);
      bar(ctx, 62, y, bw, rowH, r.player ? cssA(HUD_PALETTE.gold, 0.85) : P.panelSoft, P.ink, 3);
      const txt = r.player ? P.ink : P.paper;
      if (k > 0.55) {
        // Identity stripe.
        ctx.save();
        ctx.beginPath();
        const s = SHEAR * rowH;
        ctx.moveTo(62 + s, y);
        ctx.lineTo(62 + s + 12, y);
        ctx.lineTo(62 + 12, y + rowH);
        ctx.lineTo(62, y + rowH);
        ctx.closePath();
        ctx.fillStyle = r.color;
        ctx.fill();
        ctx.restore();

        drawText(ctx, String(r.pos), 92, y + 42, { size: 30, weight: 0.19, fill: txt, ink: null, skew: 0 });
        drawText(ctx, r.name, 148, y + 42, { size: 26, weight: 0.16, fill: txt, ink: null, tracking: 0.1, skew: 0 });
        drawText(ctx, r.time, 470, y + 42, {
          size: 25, weight: 0.16, fill: txt, ink: null, align: 'right', tabular: true, skew: 0,
        });
        if (r.delta) {
          drawText(ctx, r.delta, 610, y + 42, {
            size: 22, weight: 0.16, fill: r.player ? P.ink : P.red, ink: null, align: 'right', tabular: true, skew: 0,
          });
        }
        drawText(ctx, String(r.score), 748, y + 42, {
          size: 24, weight: 0.17, fill: r.player ? P.ink : P.goldHot, ink: null, align: 'right', tabular: true, skew: 0,
        });
      }
      ctx.restore();
    }

    // Player summary under the table.
    const me = this.rows.find((r) => r.player);
    if (me && this.age > 0.7) {
      const k = ease.snap(clamp01((this.age - 0.7) / 0.3));
      ctx.save();
      ctx.globalAlpha = clamp01(k * 1.5);
      drawText(ctx, 'TRICK SCORE', 62, h - 128, {
        size: 16, weight: 0.18, fill: P.gold, ink: P.ink, tracking: 0.3, skew: SHEAR,
      });
      drawText(ctx, String(me.score), 62, h - 76, {
        size: 52, weight: 0.17, fill: P.goldHot, ink: P.ink, tabular: true, skew: SHEAR,
      });
      drawText(ctx, 'FINISH TIME', 330, h - 128, {
        size: 16, weight: 0.18, fill: P.gold, ink: P.ink, tracking: 0.3, skew: SHEAR,
      });
      drawText(ctx, me.time, 330, h - 76, {
        size: 52, weight: 0.17, fill: P.paper, ink: P.ink, tabular: true, skew: SHEAR,
      });
      ctx.restore();
    }

    if (this.age > 1.1) this.drawItems(ctx, w, 616, 480, 'right');

    // Keep the replay window transparent even after a dynamic redraw.
    const f = this.frame;
    if (f.w > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = '#000';
      ctx.fillRect(f.x + 2.5, f.y + 2.5, f.w - 5, f.h - 5);
      ctx.restore();
    }
  }

  /**
   * The item list. The cursor is a chevron that sits outside the tag, and the
   * selected tag is filled rather than outlined — selection must survive being
   * read out of the corner of your eye, so it changes value, not just colour.
   */
  private drawItems(
    ctx: CanvasRenderingContext2D,
    w: number,
    y0: number,
    width: number,
    align: 'center' | 'right' = 'center',
  ): void {
    const rowH = 58;
    const x = align === 'right' ? w - width - 70 : (w - width) * 0.5;
    for (let i = 0; i < this.items.length; i++) {
      const sel = i === this.selection;
      const y = y0 + i * (rowH + 12);
      const k = ease.snap(clamp01((this.age - 0.3 - i * 0.07) / 0.25));
      if (k <= 0) continue;
      ctx.save();
      ctx.globalAlpha = clamp01(k * 1.6);
      bar(ctx, x, y, width * k, rowH, sel ? P.gold : cssA(HUD_PALETTE.ink, 0.7), sel ? P.goldHot : P.paperDim, sel ? 3.4 : 2.2);
      if (k > 0.6) {
        drawText(ctx, this.items[i], x + 52, y + 40, {
          size: 27, weight: 0.17, fill: sel ? P.ink : P.paperDim, ink: sel ? null : P.ink,
          tracking: 0.18, skew: SHEAR,
        });
        if (sel) {
          const pulse = 1 + Math.sin(this.blink * 7) * 0.10;
          chevron(ctx, x - 26, y + rowH * 0.5, 15 * pulse, 5, 0, P.goldHot, P.ink, 2.6);
        }
      }
      ctx.restore();
    }
  }
}
