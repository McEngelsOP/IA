/**
 * Widgets — the race HUD elements.
 *
 * Every widget owns exactly one layer, decides for itself whether its content
 * changed this frame, and draws only when it did. The `sig()` pattern below is
 * the whole dirty-tracking scheme: a widget builds a short string describing
 * everything it would draw, and if that string is unchanged the layer is skipped
 * entirely — no clear, no strokes, no texture upload. It is crude and it is
 * exactly right: it is impossible to forget to invalidate something, because the
 * signature *is* the content.
 *
 * Enter/exit animation lives on the quad (slide + scale + alpha), not on the
 * canvas, so a panel flying in costs nothing to draw. See HudLayer.slideX.
 */

import { Color } from 'three';
import type { HudModel, RacerProgress } from '../game/Contracts';
import { RacePhase } from '../game/Contracts';
import { HUD_PALETTE, RIDER_COLORS } from '../npr/Palette';
import { CHECKPOINT_TS, ROUTE } from '../game/WorldConstants';
import { TrackSectionKind } from '../game/Contracts';
import {
  clamp,
  clamp01,
  dampHL,
  ease,
  formatGap,
  makeSpring,
  springStep,
  type SpringState,
} from '../core/MathX';
import {
  HudLayer,
  bar,
  chevron,
  cornerTicks,
  css,
  cssA,
  cssMix,
  hazard,
  slab,
  slabPath,
  tick,
  tri,
  INK_W,
  SHEAR,
} from './HudCanvas';
import { drawText, measureText, type TextStyle } from './Typeface';

// ── Shared palette strings, resolved once ────────────────────────────────────
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
  boost: css(HUD_PALETTE.boost),
  boostFull: css(HUD_PALETTE.boostFull),
  shadow: css(HUD_PALETTE.shadow),
  // ── PANEL OPACITY ──────────────────────────────────────────────────────────
  // These were 0.66 / 0.82 / 0.50 and that is not a stylistic difference, it is
  // a bug. At 0.66 a high-contrast subject behind a panel is still fully
  // legible THROUGH it: conifers and terrain read inside the descent profile,
  // the rear tyre and spokes of the bike read across the boost meter, a marker
  // post reads over the word BOOST, and a whole rider reads on top of the
  // speedometer. The HUD is composited after the graded frame precisely so that
  // nothing in the scene can sit in front of it — a translucent fill throws
  // that away and lets the scene sit in front of it anyway.
  //
  // 0.93 was tried first and it is NOT enough, which is worth recording: the
  // panels are near-black, and 7% of a bright rear tyre over a value of 29 is
  // a 14-unit step — on a dark flat field that is not a hint of the scene, it
  // is the scene. Weber's law does not care that the number is small.
  //
  // So they are opaque, and the two levels are now two INKS rather than two
  // alphas: a lifted violet-black for the general panel, the true ink for the
  // ones that carry the primary readouts. That keeps the depth hierarchy the
  // design had, and it makes the guarantee absolute rather than probabilistic.
  panel: css(HUD_PALETTE.inkSoft),
  panelDeep: css(HUD_PALETTE.ink),
  panelLight: cssA(HUD_PALETTE.inkSoft, 0.85),
};

const RIDER_CSS = RIDER_COLORS.map((r) => ({
  jersey: css(r.jersey as Color),
  accent: css(r.accent as Color),
  /** The rider's colour as a hairline — the profile's leader lines. */
  lead: cssA(r.jersey as Color, 0.5),
  name: r.name as string,
}));

// Body text style. Tables and small labels do NOT get the house shear — a
// sheared column of numbers is unreadable, and legibility beats consistency.
const LABEL: TextStyle = { size: 18, weight: 0.16, fill: P.paperDim, ink: P.ink, tracking: 0.13, skew: 0 };
const VALUE: TextStyle = { size: 26, weight: 0.15, fill: P.paper, ink: P.ink, tracking: 0.06, skew: 0 };

// ── The profile panel's header row, hoisted ──────────────────────────────────
//
// These three sit on ONE baseline and are laid out left to right against each
// other: title, then the live section name, then the percentage hard right.
// That is the fix for the collisions. Previously the section name was anchored
// to the moving player marker and clamped only to the PLOT, so any time the
// marker sat left of centre — which is the whole first half of every run, and
// therefore most of the capture set — it printed straight through the title.
// TECHNICAL START through DESCENT PROFILE in five frames, SCREE RUN through it
// in a sixth. At the other end of the run the same clamp pushed it right, into
// the clock's TIME label and its own percentage: three strings on one spot in
// streambed. A label that moves cannot be laid out. This one does not move.
const PROFILE_TITLE = 'DESCENT PROFILE';
/**
 * The one baseline the whole header row sits on.
 *
 * 26 rather than 30. The four units are not cosmetic: the rival rail below
 * (see PROFILE_RIVAL_*) is a new band inside the same panel, and every unit it
 * takes comes out of the mountain's relief. The title's caps are 11.5 tall, so
 * at 26 they still sit 14.5 units clear of the slab's top edge — more air than
 * the accent stripe gets at the bottom — and the header row reads as tight to
 * the panel's top rather than floating in it.
 */
const PROFILE_HEAD_BASE = 26;
const PROFILE_TITLE_ST: TextStyle = {
  size: 16, weight: 0.17, fill: P.gold, ink: P.ink, tracking: 0.22, skew: SHEAR,
};
const PROFILE_SECTION_ST: TextStyle = {
  size: 13, weight: 0.17, fill: P.paper, ink: P.ink, tracking: 0.13, skew: SHEAR,
};
const PROFILE_PCT_ST: TextStyle = {
  size: 16, weight: 0.18, fill: P.goldHot, ink: P.ink, tracking: 0.06, align: 'right', skew: SHEAR,
};
/**
 * The two label rows under the baseline rule.
 *
 * These used to share a 34-unit band: the checkpoint digits on baseline
 * rule+17 and SUMMIT/FINISH on rule+30. Thirteen units apart, for a 12-unit
 * digit over a 13-unit cap — which means the digit's stroke ENDED where the end
 * label's cap line BEGAN, and the two collided the moment they shared an x.
 * They always do at both ends: checkpoint 7 is at t = 0.92 and FINISH is
 * right-aligned to t = 1.0, so `7` printed through the F and the I; checkpoint 1
 * at t = 0.13 sat on the T of SUMMIT.
 *
 * A stack of two type sizes needs (cap + stroke/2 + gap) between baselines, not
 * a number that looked about right. These are derived from the sizes below and
 * asserted in `layoutRows()`: 19 units of baseline pitch for a 10 over an 11,
 * which puts 7 clear units between the digit's ink and the end label's caps.
 */
const PROFILE_CP_ST: TextStyle = {
  size: 10, weight: 0.20, fill: P.paperDim, ink: null, align: 'center', tracking: 0.02, skew: 0,
};
const PROFILE_END_ST: TextStyle = {
  size: 11, weight: 0.18, fill: P.paperDim, ink: null, tracking: 0.16, skew: 0,
};
const PROFILE_ACCENT_H = 5;
const PROFILE_CUT = 20;

/**
 * ── THE MARKERS ARE PART OF THE LAYOUT, NOT DECORATION ON TOP OF IT ──────────
 *
 * The two label rows were separated from each other and from the title, and the
 * plot was fitted to what was left. That solves the STATIC collisions and it is
 * why the `7`/`FINISH` and `1`/`SUMMIT` pairs are clean. It does not solve the
 * moving ones, and a still cannot show them: the player chevron rides on the
 * skyline, the skyline's height is the terrain's, and the chevron is fifteen
 * units tall in a plot that is seventy-two units deep. Swept over the whole
 * route (`_profsweep.mjs`) the chevron's ink:
 *
 *     t = 0.938   overlaps the `7` checkpoint digit's cap box by 2.9 units
 *     t = 0.976   hangs 8.9 units BELOW the baseline rule
 *     t = 0       hangs off the plot's left edge onto the slab's chamfered
 *                 top-left corner, where it reads as a black scribble
 *
 * So the marker is now a first-class term in the layout. The SKYLINE gets its
 * own band — `skyTop`/`skyBot` — which is inset from the obstacles above and
 * below it by exactly the marker's ink reach:
 *
 *     skyTop = rail ink bottom  + gap + (how far the marker reaches UP)
 *     skyBot = digit cap top    − gap − (how far the marker reaches DOWN)
 *
 * and the plot's left inset is the slab's leaning wall plus the marker's
 * sideways reach, so the chevron at t = 0 is whole and inside the panel. Every
 * one of those terms is computed from the constants below, so changing the
 * marker's size re-solves the panel instead of silently re-breaking it.
 *
 * That band costs vertical room, and it is why the panel is 184 rather than
 * 158 tall — see the note in Hud.ts. At 158 the reserved band left the
 * silhouette 41 units of relief out of 72, which is a flat line pretending to
 * be a mountain. At 184 it gets 71, marginally MORE than the 68 it had while
 * colliding.
 */
/**
 * The player's marker is a SOLID triangle, not the stroked chevron it was.
 *
 * `chevron()` is an outline shape: an arrowhead with a notched tail, so its
 * coloured core is the gap between two strokes. At the size this panel can
 * afford that gap is 4.2 units wide and the ink halo either side of it is
 * 2.6 — the marker was delivered with 1.6 units of gold inside 5.2 of ink and
 * read as a black scribble on the ridge, which is also why it was easy to miss
 * that it was scribbling over the `7`. A filled triangle has no such failure
 * mode: it is gold all the way through at any size, it is the same idiom as the
 * rival markers and the standings chips, and pointing it along the local
 * downhill keeps the "travelling, not parked" read the chevron was there for.
 *
 * `tri` puts its tip a full radius along `dir` and its base corners at
 * 1.048 R, so that factor — not R — is its true reach.
 */
const PROFILE_MARK_R = 11;
const PROFILE_MARK_REACH = 1.048;
const PROFILE_MARK_INK = 2.2;
/** Drawn this far above / right of the skyline point it marks. */
const PROFILE_MARK_LIFT = 2;
const PROFILE_MARK_DX = 2;

/**
 * ── AND THE RIVALS COLLIDE WITH THE PLAYER, WHICH IS THE SAME BUG AGAIN ──────
 *
 * The rival triangles used to ride the skyline too, floated 13 units above it.
 * Two markers that both follow the same curve are at the same height whenever
 * they are at the same place, so a rival within ~3% of the player printed
 * straight through the player's chevron: at `ridge-exposure` (t = 0.757) the
 * green triangle sat on the gold one with about half its area inside it, and
 * the OTHER two rivals were completely underneath it — one visible marker for a
 * field of three. The previous sweep did not catch it because it swept each
 * marker against the panel's FURNITURE and never against the other markers.
 *
 * A lift cannot fix it. The rivals are at ay, the player at py, and both are
 * terrain: whatever constant offset separates them when ay = py brings them
 * together again when the rival is that far up or down the ridge from the
 * player. The only structural fix is to make one of the two families' y
 * CONSTANT, and then the separation is a layout fact rather than a coincidence
 * of the route.
 *
 * So the rivals get a RAIL: a fixed line just under the header, tips pointing
 * down at the mountain, with a leader hairline tying each one to its true point
 * on the ridge. The player keeps the skyline to itself, which is right — the
 * gold flood behind it, the drop line under it and the marker on it are one
 * object, and it is the only marker that has to be findable instantly.
 *
 * The rail is worth more than the collision it removes. Three markers on one
 * line are directly comparable: their order and their spacing IS the race, read
 * in one glance. On the ridge they were three heights and three sizes of gap,
 * and the eye had to do the projection itself.
 *
 * It costs 7.8 units of the mountain's relief (69.6 → 61.8 of the 184-unit
 * panel) and 4 of those are bought back by the header baseline above. Markers
 * on a rail can also be de-collided along it, which the ridge could never do
 * — see `railLayout()`.
 */
const PROFILE_RIVAL_R = 7;
const PROFILE_RIVAL_INK = 1.8;
/** `tri` geometry: the base sits 0.7 R behind the tip and 0.78 R either side. */
const PROFILE_TRI_BACK = 0.7;
const PROFILE_TRI_HALF = 0.78;
/** How far a rail marker's ink reaches above / below / either side of its centre. */
const PROFILE_RAIL_UP = PROFILE_RIVAL_R * PROFILE_TRI_BACK + PROFILE_RIVAL_INK * 0.5;
const PROFILE_RAIL_DOWN = PROFILE_RIVAL_R + PROFILE_RIVAL_INK * 0.5;
const PROFILE_RAIL_HALF = PROFILE_RIVAL_R * PROFILE_TRI_HALF + PROFILE_RIVAL_INK * 0.5;
/**
 * Minimum centre-to-centre spacing of two rail markers. Two riders inside this
 * are shown side by side rather than on top of each other, with their leader
 * lines still landing on their true positions — which is the honest reading of
 * "these two are together", and the only one where you can still see that there
 * are two of them.
 */
const PROFILE_RAIL_PITCH = 2 * PROFILE_RAIL_HALF + 1.6;
/** Clear air between a marker's ink and the type it is passing. */
const PROFILE_MARK_GAP = 3;

/**
 * The marker metrics, exported so a layout probe asserts against the numbers
 * the widget actually draws with instead of a copy of them that can rot.
 * `tools/capture/_profsweep2.mjs` is the sweep; it must stay green.
 */
export const PROFILE_METRICS = {
  markR: PROFILE_MARK_R,
  markReach: PROFILE_MARK_REACH,
  markInk: PROFILE_MARK_INK,
  markLift: PROFILE_MARK_LIFT,
  markDx: PROFILE_MARK_DX,
  rivalR: PROFILE_RIVAL_R,
  rivalInk: PROFILE_RIVAL_INK,
  triBack: PROFILE_TRI_BACK,
  triHalf: PROFILE_TRI_HALF,
  railUp: PROFILE_RAIL_UP,
  railDown: PROFILE_RAIL_DOWN,
  railHalf: PROFILE_RAIL_HALF,
  railPitch: PROFILE_RAIL_PITCH,
  gap: PROFILE_MARK_GAP,
  headBase: PROFILE_HEAD_BASE,
  titleSize: PROFILE_TITLE_ST.size,
  titleWeight: PROFILE_TITLE_ST.weight ?? 0.17,
  cpSize: PROFILE_CP_ST.size,
  shear: SHEAR,
} as const;

function pad2(n: number): string {
  return n < 10 ? '0' + n : '' + n;
}

/** M:SS.hh. Hundredths, not thousandths — the last digit of a millisecond
 *  field is unreadable in motion and it doubles the clock's redraw rate. */
export function clockString(s: number): string {
  if (!isFinite(s) || s < 0) return '0:00.00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  const cs = Math.floor((s - Math.floor(s)) * 100);
  return `${m}:${pad2(sec)}.${pad2(cs)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Base
// ─────────────────────────────────────────────────────────────────────────────

export abstract class Widget {
  readonly layer: HudLayer;
  /** 0 = fully out, 1 = fully in. Drives alpha and the entrance slide. */
  protected vis = 0;
  protected want = 0;
  /** Direction the panel flies in from, design units. */
  protected enterX = 0;
  protected enterY = 0;
  private sigStr = ' ';

  constructor(layer: HudLayer) {
    this.layer = layer;
    this.layer.alpha = 0;
  }

  /** Static geometry. Called once per resize. */
  abstract furniture(ctx: CanvasRenderingContext2D, w: number, h: number): void;
  /** Per-frame state update. Must call `sig()` with everything it will draw. */
  abstract update(m: HudModel, dt: number, time: number): void;
  /** Dynamic content, over the pre-blitted furniture. */
  abstract draw(ctx: CanvasRenderingContext2D, w: number, h: number): void;

  protected sig(s: string): void {
    if (s !== this.sigStr) {
      this.sigStr = s;
      this.layer.dirty = true;
    }
  }

  /** Force the next frame to redraw regardless of signature. */
  protected invalidate(): void {
    this.sigStr = ' ';
    this.layer.dirty = true;
  }

  /**
   * Advance the presence animation. The alpha ramps faster than the slide so a
   * panel is fully opaque before it finishes settling — a panel that fades in
   * over its whole travel reads as a dissolve, which is the one transition that
   * has no place in a cel HUD.
   */
  protected present(on: boolean, dt: number, halfLife = 0.07): void {
    this.want = on ? 1 : 0;
    this.vis = dampHL(this.vis, this.want, halfLife, dt);
    if (Math.abs(this.vis - this.want) < 0.002) this.vis = this.want;
    const t = ease.outQuart(clamp01(this.vis));
    this.layer.alpha = clamp01(this.vis * 1.35);
    this.layer.slideX = this.enterX * (1 - t);
    this.layer.slideY = this.enterY * (1 - t);
  }

  /**
   * Presence for elements that must never be readable at a partial alpha.
   *
   * `present()` is a symmetric damp, and for a panel that is fine: it fades out
   * over ~0.2 s showing its own last frame, which is what a panel leaving should
   * look like. It is exactly wrong for anything whose canvas holds STALE
   * content while it leaves, because the viewer does not see a fade — they see
   * the old reading at 13% alpha and read it as a draw that failed. That is the
   * corner call's whole defect: its source flickers on and off across the
   * detection threshold, so it spent most of a fast frame parked between 0.05
   * and 0.20 with a stale distance on it.
   *
   * This ramps in fast and then CUTS: once the fade-out passes below `floor`
   * the alpha goes straight to zero. Nothing is ever on screen between 0 and
   * `floor`, so a half-drawn element is not a state this HUD can be in.
   */
  protected presentCut(on: boolean, dt: number, halfLife = 0.035, floor = 0.6): void {
    this.want = on ? 1 : 0;
    this.vis = dampHL(this.vis, this.want, halfLife, dt);
    if (on) {
      if (this.vis > 0.94) this.vis = 1;
    } else if (this.vis < floor) {
      this.vis = 0;
    }
    const t = ease.outQuart(clamp01(this.vis));
    this.layer.alpha = this.vis <= 0 ? 0 : clamp01(this.vis * 1.6);
    this.layer.slideX = this.enterX * (1 - t);
    this.layer.slideY = this.enterY * (1 - t);
  }

  get shown(): boolean {
    return this.vis > 0.002;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Route profile — the signature element
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The whole descent, as an elevation cross-section, with every racer on it.
 *
 * This is the one HUD element that tells you something the 3D cannot: where you
 * are in a four-minute run, how much vertical is left, and whether the next
 * section is the steep bit. Drawn as a filled silhouette with a hard ink skyline
 * so it reads as the mountain itself rather than as a chart — the ridden portion
 * is flooded gold behind the player marker, which turns "progress" into a
 * physical thing filling up rather than a percentage.
 */
export class RouteProfileWidget extends Widget {
  private profilePath: Path2D | null = null;
  private skylinePath: Path2D | null = null;
  private samples: Float32Array | null = null;
  private sampleKey = -1;
  private plotX = 0;
  private plotY = 0;
  private plotW = 0;
  private plotH = 0;
  private curveY: number[] = [];

  /** Slab width at its BOTTOM edge. The shear pushes the top edge right by
   *  SHEAR*h, so this is `layer width − margin − SHEAR*h`; sizing the slab to
   *  the layer instead (as it was) throws the sheared top-right corner outside
   *  the backing store and the panel is delivered with its corner cut off. */
  private bodyW = 0;
  /** Baseline rule y, and the two label rows below it. */
  private ruleY = 0;
  private cpBaseY = 0;
  private endBaseY = 0;
  /** The band the SKYLINE may occupy. Insets the plot by the markers' reach. */
  private skyTop = 0;
  private skyBot = 0;
  /** Centre line of the rival rail. Constant — that is the whole point of it. */
  private railY = 0;

  private progress = 0;
  private markerT = 0;
  /**
   * Rival marker slots. POOLED, not rebuilt: this is filled in `update()`,
   * which runs every frame whether or not anything is redrawn, and
   * `push({ ... })` there was allocating one object per racer per frame — four
   * objects a frame, 240 a second, for a list whose length never changes.
   * `aiCount` is how many of the slots are live.
   */
  private ai: { t: number; color: string; lead: string; player: boolean }[] = [];
  private aiCount = 0;
  /** Rail slots: indices into `ai`, ordered by t, and their de-collided x.
   *  Both pooled — `draw()` runs on every frame the marker moves. */
  private railIdx: number[] = [];
  private railX: number[] = [];
  private railN = 0;
  private trackLen = 0;
  private sectionName = '';
  private pulse = 0;
  /** Header baseline x for the section name, measured off the title. */
  private sectionX = 250;

  /** Route-parameter → section, precomputed from the arc length of ROUTE. */
  private sectionT: { t: number; kind: TrackSectionKind }[] = [];

  constructor(layer: HudLayer) {
    super(layer);
    this.enterX = -140;
    this.buildSectionTable();
  }

  private buildSectionTable(): void {
    let total = 0;
    const cum: number[] = [0];
    for (let i = 1; i < ROUTE.length; i++) {
      total += Math.hypot(ROUTE[i].x - ROUTE[i - 1].x, ROUTE[i].z - ROUTE[i - 1].z);
      cum.push(total);
    }
    for (let i = 0; i < ROUTE.length; i++) {
      this.sectionT.push({ t: cum[i] / (total || 1), kind: ROUTE[i].section });
    }
  }

  private sectionAt(t: number): string {
    let kind = this.sectionT.length ? this.sectionT[0].kind : TrackSectionKind.TechnicalStart;
    for (const s of this.sectionT) {
      if (t >= s.t) kind = s.kind;
      else break;
    }
    return kind.replace(/-/g, ' ').toUpperCase();
  }

  /**
   * Rebuild the silhouette. Costs a couple of hundred path segments and runs on
   * resize or when the game hands over a different profile array — never per
   * frame.
   */
  private buildPaths(w: number, h: number): void {
    const s = this.samples;

    // ── PANEL METRICS ────────────────────────────────────────────────────────
    // Every y below is derived, not chosen, so the two label rows cannot drift
    // back into each other if the panel is ever resized again.
    this.bodyW = w - 12 - SHEAR * h;      // slab bottom-edge width; top fits too
    const endInk = PROFILE_END_ST.size * (PROFILE_END_ST.weight ?? 0.18) * 0.5;
    const cpInk = PROFILE_CP_ST.size * (PROFILE_CP_ST.weight ?? 0.2) * 0.5;
    // Work up from the bottom: accent stripe, then the end-label row, then the
    // checkpoint digits, and give the plot whatever is left.
    this.endBaseY = h - PROFILE_ACCENT_H - 7 - endInk;
    this.cpBaseY = this.endBaseY - PROFILE_END_ST.size - 7 - cpInk;
    this.ruleY = this.cpBaseY - PROFILE_CP_ST.size - 6;

    // ── THE RAIL, THEN THE SKYLINE'S BAND ────────────────────────────────────
    // Top down: the title's ink, the rival rail, then the band the ridge may
    // occupy, then the checkpoint digits. Every boundary is one term clear of
    // the next, and every term is the ink extent of the thing it belongs to.
    const markSide = PROFILE_MARK_R * PROFILE_MARK_REACH + PROFILE_MARK_INK * 0.5;
    const markUp = markSide + PROFILE_MARK_LIFT;
    const markDown = markSide - PROFILE_MARK_LIFT;

    // The obstacles the band sits between: the title's ink above, the
    // checkpoint digits' cap line below. Both measured, not guessed.
    // The header row is three styles on one baseline and the rail runs under
    // all of it, so the ink bottom is the HEAVIEST of them — the percentage,
    // hard right, is a hair fatter than the title.
    const headWeight = Math.max(PROFILE_TITLE_ST.weight ?? 0.17, PROFILE_PCT_ST.weight ?? 0.18);
    const titleInk = PROFILE_HEAD_BASE
      + Math.max(PROFILE_TITLE_ST.size, PROFILE_PCT_ST.size) * (headWeight * 0.5 + 0.052);
    const digitCapTop = this.cpBaseY - PROFILE_CP_ST.size - cpInk;

    const railTop = titleInk + PROFILE_MARK_GAP;
    this.railY = railTop + PROFILE_RAIL_UP;
    this.skyTop = this.railY + PROFILE_RAIL_DOWN + PROFILE_MARK_GAP + markUp;
    // The rule is furniture too: a marker that hangs across it reads as a
    // chart that has broken its own axis, so the band clears that as well as
    // the digits, and with the rows as they are it is the rule that binds.
    this.skyBot = Math.min(
      digitCapTop - PROFILE_MARK_GAP - markDown,
      this.ruleY - 1 - markDown,
    );

    // The slab leans: its left wall at height y is SHEAR*h*(1 − y/h) in from
    // the layer edge, widest at the top. The plot starts clear of that wall
    // PLUS the widest sideways reach of anything drawn in it, so the markers at
    // t = 0 are whole shapes inside the panel instead of half ones on the
    // chamfer. The wall is measured at the RAIL, the topmost thing in the plot
    // and therefore the point where it leans furthest in.
    const wallL = SHEAR * h * (1 - railTop / h);
    const reachLeft = Math.max(markSide - PROFILE_MARK_DX, PROFILE_RAIL_HALF);
    this.plotX = Math.ceil(wallL + 4 + reachLeft);
    this.plotY = this.skyTop - 6;
    // The right inset clears the slab's bottom-right chamfer: FINISH is
    // right-aligned to the plot, and at the end-label baseline the chamfer has
    // already eaten 8 units off the slab edge. The slab leans AWAY on this
    // side, so the marker at t = 1 has more room here than the label does.
    this.plotW = this.bodyW - this.plotX - 14;
    this.plotH = this.ruleY - this.plotY;
    this.curveY.length = 0;
    this.profilePath = null;
    this.skylinePath = null;
    if (!s || s.length < 2) return;

    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < s.length; i++) {
      if (s[i] < lo) lo = s[i];
      if (s[i] > hi) hi = s[i];
    }
    const span = Math.max(hi - lo, 1e-3);

    const fill = new Path2D();
    const line = new Path2D();
    const n = s.length;
    for (let i = 0; i < n; i++) {
      const x = this.plotX + (i / (n - 1)) * this.plotW;
      // Into the reserved band, not into the plot box: the box is where the
      // mountain BODY is drawn, the band is where its ridge is allowed to go.
      const y = this.skyBot - ((s[i] - lo) / span) * (this.skyBot - this.skyTop);
      this.curveY.push(y);
      if (i === 0) {
        fill.moveTo(x, y);
        line.moveTo(x, y);
      } else {
        fill.lineTo(x, y);
        line.lineTo(x, y);
      }
    }
    fill.lineTo(this.plotX + this.plotW, this.plotY + this.plotH);
    fill.lineTo(this.plotX, this.plotY + this.plotH);
    fill.closePath();
    this.profilePath = fill;
    this.skylinePath = line;
  }

  private yAt(t: number): number {
    if (this.curveY.length === 0) return (this.skyTop + this.skyBot) * 0.5;
    const f = clamp01(t) * (this.curveY.length - 1);
    const i = Math.floor(f);
    const j = Math.min(this.curveY.length - 1, i + 1);
    return this.curveY[i] + (this.curveY[j] - this.curveY[i]) * (f - i);
  }

  override furniture(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    this.buildPaths(w, h);

    slab(ctx, 0, 0, this.bodyW, h, {
      fill: P.panel,
      ink: P.ink,
      inkWidth: INK_W,
      cuts: 0b0101,
      cut: PROFILE_CUT,
      accent: P.gold,
      accentHeight: PROFILE_ACCENT_H,
    });

    // The header row starts on the plot's left edge and the percentage ends on
    // its right, so the type and the chart share one measure instead of being
    // two independently-inset things that happen to be in the same panel.
    drawText(ctx, PROFILE_TITLE, this.plotX, PROFILE_HEAD_BASE, PROFILE_TITLE_ST);
    // Where the live section name starts. Measured off the title so the two can
    // never touch, whatever the title says.
    this.sectionX = this.plotX + measureText(PROFILE_TITLE, PROFILE_TITLE_ST) + 16;

    if (!this.profilePath || !this.skylinePath) return;

    const plotR = this.plotX + this.plotW;

    // The mountain body, flat and unlit — this is a silhouette, not a chart fill.
    ctx.fillStyle = cssA(HUD_PALETTE.violet, 0.30);
    ctx.fill(this.profilePath);

    // Checkpoint hairlines, drawn under the skyline so the skyline cuts them.
    for (let i = 1; i < CHECKPOINT_TS.length - 1; i++) {
      const t = CHECKPOINT_TS[i];
      const x = this.plotX + t * this.plotW;
      tick(ctx, x, this.yAt(t), x, this.ruleY, 1.6, cssA(HUD_PALETTE.paperDim, 0.45));
    }

    // Skyline: a fat ink stroke with a thin paper highlight riding on top of it.
    // Two strokes, not one — the highlight is what stops the profile reading as
    // a black smear when it sits over a dark tree line.
    ctx.lineJoin = 'round';
    ctx.strokeStyle = P.ink;
    ctx.lineWidth = 5.0;
    ctx.stroke(this.skylinePath);
    ctx.strokeStyle = P.paperDim;
    ctx.lineWidth = 2.0;
    ctx.stroke(this.skylinePath);
    ctx.lineJoin = 'miter';

    // Baseline rule.
    tick(ctx, this.plotX, this.ruleY, plotR, this.ruleY, 2.2, P.ink);

    // ── Row 1: the checkpoint digits, each on a stub that ties it to its
    // hairline. Below the rule and clear of the end labels by construction —
    // see the PROFILE_CP_ST / PROFILE_END_ST note.
    for (let i = 1; i < CHECKPOINT_TS.length - 1; i++) {
      const x = this.plotX + CHECKPOINT_TS[i] * this.plotW;
      tick(ctx, x, this.ruleY, x, this.ruleY + 5, 1.6, cssA(HUD_PALETTE.paperDim, 0.55));
      drawText(ctx, String(i), x, this.cpBaseY, PROFILE_CP_ST);
    }

    // ── Row 2: the two end labels, on their own baseline.
    drawText(ctx, 'SUMMIT', this.plotX, this.endBaseY, PROFILE_END_ST);
    drawText(ctx, 'FINISH', plotR, this.endBaseY, { ...PROFILE_END_ST, align: 'right' });
  }

  override update(m: HudModel, dt: number, time: number): void {
    const racing = m.phase === RacePhase.Racing || m.phase === RacePhase.Countdown || m.phase === RacePhase.Finished;
    this.present(racing, dt, 0.09);

    if (m.routeProfile && m.routeProfile !== this.samples) {
      this.samples = m.routeProfile;
      this.sampleKey = m.routeProfile.length;
      this.layer.markFurniture();
      this.invalidate();
    }

    const target = clamp01(m.routeProgress);
    // Snap on a teleport, ease within a run. The easing is there because
    // progress arrives quantised by the physics step and a marker that steps
    // reads as a dropped frame — but easing a JUMP is a different thing
    // entirely: after a restart or a capture-harness reposition the marker
    // spends a fifth of a second somewhere the header's percentage says it is
    // not, and a still caught in that window shows the panel disagreeing with
    // itself. Same threshold and same reasoning as the corner call's guard: one
    // frame at racing speed moves about 8e-5 of the course, so 0.01 cannot fire
    // in play.
    if (Math.abs(target - this.progress) > 0.01) this.markerT = target;
    this.progress = target;
    this.markerT = dampHL(this.markerT, this.progress, 0.05, dt);
    this.pulse = time;

    // Track length is not in the model, so infer it once from the player's own
    // distance and normalised progress. Everything else on the profile is then
    // placed from the standings' absolute distances.
    let player: RacerProgress | null = null;
    for (const r of m.standings) if (r.isPlayer) player = r;
    if (player && this.progress > 0.02) {
      const est = player.distance / this.progress;
      if (isFinite(est) && est > 100) this.trackLen = this.trackLen === 0 ? est : dampHL(this.trackLen, est, 1.0, dt);
    }

    // Refill the pooled slots in place. A slot is only constructed the first
    // time the field is that big; after that this is three stores per racer.
    this.aiCount = 0;
    if (this.trackLen > 0) {
      for (let i = 0; i < m.standings.length; i++) {
        const r = m.standings[i];
        let slot = this.ai[this.aiCount];
        if (!slot) {
          slot = { t: 0, color: '', lead: '', player: false };
          this.ai.push(slot);
          this.railIdx.push(0);
          this.railX.push(0);
        }
        const c = RIDER_CSS[r.colorIndex % RIDER_CSS.length];
        slot.t = clamp01(r.distance / this.trackLen);
        slot.color = c.jersey;
        slot.lead = c.lead;
        slot.player = r.isPlayer;
        this.aiCount++;
      }
    }

    this.sectionName = this.sectionAt(this.progress);

    // Quantise the marker to a tenth of a design pixel: below that nothing on
    // screen changes and a redraw would be pure cost.
    const q = Math.round(this.markerT * this.plotW * 2);
    let s = `${q}|${this.sectionName}`;
    for (let i = 0; i < this.aiCount; i++) s += '|' + Math.round(this.ai[i].t * 400);
    this.sig(s);
  }

  /**
   * Place the rival markers along the rail: sort by route position, then push
   * neighbours apart until nothing is inside anything else.
   *
   * Two passes and no allocation. The first sweeps left to right opening every
   * pair to `PROFILE_RAIL_PITCH`, which cannot break an earlier pair because it
   * only ever moves markers right; the second sweeps back and does the same
   * against the plot's right edge, which cannot break the first because it only
   * ever moves markers left and the field is 3 markers in a 460-unit plot — the
   * two constraints can only meet if the whole field is inside 30 units of the
   * finish, and then the leader lines are what carry the true positions anyway.
   */
  private railLayout(): void {
    const idx = this.railIdx;
    let n = 0;
    for (let i = 0; i < this.aiCount; i++) {
      const a = this.ai[i];
      if (a.player) continue;
      // Insertion sort by t, in place, on the pooled index array.
      let k = n++;
      while (k > 0 && this.ai[idx[k - 1]].t > a.t) {
        idx[k] = idx[k - 1];
        k--;
      }
      idx[k] = i;
    }
    this.railN = n;
    for (let i = 0; i < n; i++) this.railX[i] = this.plotX + this.ai[idx[i]].t * this.plotW;
    for (let i = 1; i < n; i++) {
      const min = this.railX[i - 1] + PROFILE_RAIL_PITCH;
      if (this.railX[i] < min) this.railX[i] = min;
    }
    const right = this.plotX + this.plotW;
    if (n > 0 && this.railX[n - 1] > right) this.railX[n - 1] = right;
    for (let i = n - 2; i >= 0; i--) {
      const max = this.railX[i + 1] - PROFILE_RAIL_PITCH;
      if (this.railX[i] > max) this.railX[i] = max;
    }
  }

  override draw(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    if (!this.profilePath) return;
    const px = this.plotX + this.markerT * this.plotW;
    const py = this.yAt(this.markerT);

    // Ridden ground, flooded gold behind the marker.
    ctx.save();
    ctx.beginPath();
    ctx.rect(this.plotX - 4, this.plotY - 10, px - this.plotX + 4, this.plotH + 20);
    ctx.clip();
    ctx.fillStyle = cssA(HUD_PALETTE.gold, 0.42);
    ctx.fill(this.profilePath);
    ctx.strokeStyle = P.goldHot;
    ctx.lineWidth = 2.6;
    ctx.lineJoin = 'round';
    if (this.skylinePath) ctx.stroke(this.skylinePath);
    ctx.lineJoin = 'miter';
    ctx.restore();

    // ── The field, on its rail ───────────────────────────────────────────────
    // Leader lines first, then the markers over them, then the player over
    // everything: three depths, in the order a viewer needs to resolve them.
    this.railLayout();
    for (let i = 0; i < this.railN; i++) {
      const a = this.ai[this.railIdx[i]];
      const tx = this.plotX + a.t * this.plotW;
      tick(ctx, this.railX[i], this.railY + PROFILE_RAIL_DOWN, tx, this.yAt(a.t), 1.5, a.lead);
    }
    for (let i = 0; i < this.railN; i++) {
      tri(
        ctx, this.railX[i], this.railY, PROFILE_RIVAL_R, Math.PI * 0.5,
        this.ai[this.railIdx[i]].color, P.ink, PROFILE_RIVAL_INK,
      );
    }

    // The player: a drop line to the baseline, then the chevron on the skyline.
    tick(ctx, px, py, px, this.ruleY, 2.4, cssA(HUD_PALETTE.goldHot, 0.75));
    // Point it along the local downhill so it reads as travelling, not parked.
    const y2 = this.yAt(Math.min(1, this.markerT + 0.02));
    const dir = Math.atan2(y2 - py, this.plotW * 0.02);
    tri(
      ctx, px + PROFILE_MARK_DX, py - PROFILE_MARK_LIFT,
      PROFILE_MARK_R, dir, P.goldHot, P.ink, PROFILE_MARK_INK,
    );

    // Header row: section name after the title, percentage hard right. Both on
    // the title's baseline, both at fixed anchors. See PROFILE_TITLE_ST.
    const pct = `${Math.round(this.progress * 100)}%`;
    const pctR = this.plotX + this.plotW;
    drawText(ctx, pct, pctR, PROFILE_HEAD_BASE, PROFILE_PCT_ST);
    // The section name is clipped to the space between the title and the
    // percentage rather than allowed to run under either. Every real section
    // name fits with room to spare; the clip is here so a longer one added
    // later degrades by being cut off instead of by overprinting.
    const pctW = measureText(pct, PROFILE_PCT_ST);
    ctx.save();
    ctx.beginPath();
    ctx.rect(this.sectionX - 4, PROFILE_HEAD_BASE - 20, (pctR - pctW - 18) - this.sectionX + 4, 26);
    ctx.clip();
    drawText(ctx, this.sectionName, this.sectionX, PROFILE_HEAD_BASE, PROFILE_SECTION_ST);
    ctx.restore();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Race clock + splits
// ─────────────────────────────────────────────────────────────────────────────

export class ClockWidget extends Widget {
  private text = '0:00.00';
  private ghost: number | null = null;
  /** The most recent split, held on screen then cut. */
  private splitIdx = -1;
  private splitDelta: number | null = null;
  private splitTime = 0;
  private splitAge = 99;
  private seen = new Set<number>();

  constructor(layer: HudLayer) {
    super(layer);
    this.enterY = -90;
  }

  override furniture(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    slab(ctx, 0, 0, w - 20, 96, {
      fill: P.panelDeep,
      ink: P.ink,
      inkWidth: INK_W,
      cuts: 0b0110,
      cut: 18,
      accent: P.gold,
      accentHeight: 4,
    });
    drawText(ctx, 'TIME', 30, 30, {
      size: 15, weight: 0.18, fill: P.gold, ink: P.ink, tracking: 0.26, skew: SHEAR,
    });
  }

  override update(m: HudModel, dt: number, time: number): void {
    const on = m.phase === RacePhase.Racing || m.phase === RacePhase.Countdown || m.phase === RacePhase.Finished;
    this.present(on, dt, 0.08);

    this.text = clockString(m.raceTime);
    this.ghost = m.ghostDelta;

    // Latch the newest checkpoint split we have not shown yet.
    for (const sp of m.splits) {
      if (sp.time !== null && !this.seen.has(sp.index)) {
        this.seen.add(sp.index);
        this.splitIdx = sp.index;
        this.splitDelta = sp.delta;
        this.splitTime = sp.time;
        this.splitAge = 0;
      }
    }
    this.splitAge += dt;

    const g = this.ghost === null ? 'x' : Math.round(this.ghost * 100);
    const sp = this.splitAge < 3.0 ? `${this.splitIdx}:${Math.round(this.splitAge * 30)}` : 'n';
    this.sig(`${this.text}|${g}|${sp}`);
  }

  override draw(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    drawText(ctx, this.text, w - 34, 78, {
      size: 46,
      weight: 0.155,
      fill: P.paper,
      ink: P.ink,
      tracking: 0.04,
      align: 'right',
      tabular: true,
      skew: SHEAR * 0.7,
    });

    // Ghost delta, permanently under the clock while it exists.
    if (this.ghost !== null && isFinite(this.ghost)) {
      const ahead = this.ghost < 0;
      const col = ahead ? P.teal : P.red;
      const txt = formatGap(this.ghost);
      const tw = measureText(txt, { size: 24, weight: 0.16, tracking: 0.05, tabular: true }) + 46;
      const x = w - 20 - tw;
      bar(ctx, x, 104, tw, 34, cssA(ahead ? HUD_PALETTE.teal : HUD_PALETTE.red, 0.22), col, 2.2);
      chevron(ctx, x + 20, 121, 8, 3.4, ahead ? -Math.PI / 2 : Math.PI / 2, col, P.ink, 1.8);
      drawText(ctx, txt, x + tw - 14, 130, {
        size: 24, weight: 0.16, fill: col, ink: P.ink, tracking: 0.05, align: 'right', tabular: true, skew: 0,
      });
    }

    // Split flash: snaps in, holds, cuts out at 2.6s. No fade — a split that
    // dissolves is a split you did not read in time.
    if (this.splitAge < 2.6 && this.splitIdx >= 0) {
      const k = ease.snap(clamp01(this.splitAge / 0.22));
      const d = this.splitDelta;
      const col = d === null ? P.paper : d < 0 ? P.teal : P.red;
      const label = `CP ${this.splitIdx}`;
      const val = d === null ? clockString(this.splitTime) : formatGap(d);
      const bw = 210 * k;
      const y = 148;
      ctx.save();
      ctx.globalAlpha = clamp01(k);
      bar(ctx, 8, y, bw, 38, P.panelDeep, col, 2.4);
      if (k > 0.55) {
        drawText(ctx, label, 26, y + 27, { size: 17, weight: 0.17, fill: P.paperDim, ink: P.ink, tracking: 0.1, skew: 0 });
        drawText(ctx, val, 8 + bw - 14, y + 27, {
          size: 21, weight: 0.16, fill: col, ink: P.ink, tracking: 0.04, align: 'right', tabular: true, skew: 0,
        });
      }
      ctx.restore();
    }
  }

  reset(): void {
    this.seen.clear();
    this.splitIdx = -1;
    this.splitAge = 99;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Speed
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Speed sits in the bottom-right corner because that is where the eye is not,
 * and it is read by the needle rather than by the number — the digits are for
 * the two frames a lap where you actually look at them.
 *
 * The arc hugs the corner: 90° from due-left to straight-up, centred on the
 * corner itself, so it wraps the number instead of floating beside it.
 */
const SPEED_MAX = 100; // km/h

// ── SPEED BLOCK METRICS ──────────────────────────────────────────────────────
//
// Every number in this widget used to be a literal tuned against one screenshot
// at one speed, and three separate things fell off the edge of the layer as a
// result:
//
//   1. The dial band ran from 0.972π to 1.585π at radius rOuter+34 around a
//      centre at (w-16, h-6). At 1.585π that is 0.26·R to the RIGHT of the
//      centre and R ABOVE it, so the band's own polygon was 76 units past the
//      right edge of its backing store and 13 past the top. The band was
//      delivered with two straight razor cuts through it, which is what the
//      "100" label was sitting on.
//   2. The readout numeral was right-aligned to w-30 and set at 96 with the
//      house shear, so its sheared top-right corner reached w-30+19.2+5.3 =
//      w-5.5 — hard against the layer edge and straight through the readout
//      slab's chamfered bottom-right corner at two digits and beyond it at
//      three.
//   3. KM/H sat on baseline h-22 and the numeral on h-46. A 96 numeral's ink
//      reaches 12.7 BELOW its baseline, and KM/H's cap line is 20 above its
//      own — so the two overlapped by four units at every speed, and the `0`
//      of `70` and the `2` of `72` both printed through the M.
//
// So the geometry is now solved instead of guessed. The dial radius is the
// largest that keeps the WHOLE band polygon inside the layer with a margin
// (`fitRadius`), the gauge numerals moved OUTSIDE the tick ring where there is
// unlimited room instead of inside it where they were fighting the readout, and
// the readout plate and its two type rows are stacked from measured ink
// extents. `SPEED_LAYOUT` records the intent; `geom()` does the arithmetic.
const SPEED_A0 = Math.PI * 0.975; // band start, a hair below due-left
const SPEED_A1 = Math.PI * 1.525; // band end, a hair past straight-up
/** Margin between the band polygon and the layer edge, design units. */
const SPEED_MARGIN = 6;
/** Big readout. 86 rather than 96: three digits at 96 do not fit the plate. */
const SPEED_NUM: TextStyle = {
  size: 86, weight: 0.16, ink: P.ink, inkWidth: 0.055,
  tracking: 0.02, align: 'right', tabular: true, skew: SHEAR,
};
const SPEED_UNIT: TextStyle = {
  size: 17, weight: 0.18, fill: P.gold, ink: P.ink, tracking: 0.22, align: 'right', skew: SHEAR,
};
const SPEED_GAUGE: TextStyle = {
  size: 15, weight: 0.18, fill: P.paperDim, ink: P.ink, align: 'center', tracking: 0.04, skew: 0,
};

export class SpeedWidget extends Widget {
  private needle: SpringState = makeSpring(0, 0);
  private kmh = 0;
  private boosting = false;
  private cx = 0;
  private cy = 0;
  /** Outer radius of the tick ring. Everything else is measured off it. */
  private rTick = 0;
  /** Band annulus. */
  private rBand0 = 0;
  private rBand1 = 0;
  /** Radius the gauge numerals are centred on — OUTSIDE the ticks. */
  private rLabel = 0;
  /** Readout plate box, and the two baselines inside it. */
  private plate = { x: 0, y: 0, w: 0, h: 0 };
  private numRight = 0;
  private numBase = 0;
  private unitRight = 0;
  private unitBase = 0;

  constructor(layer: HudLayer) {
    super(layer);
    this.enterX = 150;
  }

  /**
   * Largest band radius that keeps the whole sweep inside (0,0,w,h) with
   * `SPEED_MARGIN` to spare. The band's bounding box is centre + R·[cos,sin]
   * extremes over the sweep, so each of the four edges gives a linear bound on
   * R and the answer is the smallest of them.
   */
  private fitRadius(w: number, h: number): number {
    // The sweep contains π (cos = -1) and 1.5π (sin = -1); the other two
    // extremes are at the ends.
    const cMin = -1;
    const cMax = Math.max(Math.cos(SPEED_A0), Math.cos(SPEED_A1));
    const sMin = -1;
    const sMax = Math.max(Math.sin(SPEED_A0), Math.sin(SPEED_A1));
    const m = SPEED_MARGIN;
    let r = Infinity;
    if (cMin < 0) r = Math.min(r, (this.cx - m) / -cMin);
    if (cMax > 0) r = Math.min(r, (w - m - this.cx) / cMax);
    if (sMin < 0) r = Math.min(r, (this.cy - m) / -sMin);
    if (sMax > 0) r = Math.min(r, (h - m - this.cy) / sMax);
    return r;
  }

  private geom(w: number, h: number): void {
    this.cx = w - 34;
    this.cy = h - 34;
    this.rBand1 = this.fitRadius(w, h);
    this.rTick = this.rBand1 - 48;
    this.rBand0 = this.rTick - 62;
    this.rLabel = this.rTick + 18;

    // Readout plate. Its top-left corner is chamfered so the low end of the
    // tick ring passes OUTSIDE it — see the cut in `furniture()`.
    const pb = h - 8;
    const pt = 194;
    this.plate = { x: 300, y: pt, w: (w - 44) - 300, h: pb - pt };

    // Type stack, worked up from the plate's bottom edge.
    const numInk = SPEED_NUM.size * (SPEED_NUM.inkWidth ?? 0.055);
    const unitInk = SPEED_UNIT.size * 0.052 + SPEED_UNIT.size * (SPEED_UNIT.weight ?? 0.18) * 0.5;
    this.unitBase = pb - 16;
    this.unitRight = w - 60;
    this.numBase = this.unitBase - SPEED_UNIT.size - unitInk - 8
      - (SPEED_NUM.size * (SPEED_NUM.weight ?? 0.16) * 0.5 + numInk);
    this.numRight = w - 56;
  }

  private angleFor(v: number): number {
    // 180° (due left) → 270° (straight up), measured in canvas space where +y
    // is down, so we sweep from PI to 1.5*PI.
    return Math.PI + clamp01(v / SPEED_MAX) * Math.PI * 0.5;
  }

  /**
   * The faceted annular face the ticks sit on. Runs a little wide of the tick
   * band at both ends so the numerals and the needle's tip are on it too — a
   * gauge whose extreme reading falls off the edge of its own dial is worse
   * than no dial at all.
   */
  private dialBand(ctx: CanvasRenderingContext2D): void {
    const seg = 12;
    ctx.beginPath();
    for (let i = 0; i <= seg; i++) {
      const a = SPEED_A0 + ((SPEED_A1 - SPEED_A0) * i) / seg;
      const x = this.cx + Math.cos(a) * this.rBand1;
      const y = this.cy + Math.sin(a) * this.rBand1;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    for (let i = seg; i >= 0; i--) {
      const a = SPEED_A0 + ((SPEED_A1 - SPEED_A0) * i) / seg;
      ctx.lineTo(this.cx + Math.cos(a) * this.rBand0, this.cy + Math.sin(a) * this.rBand0);
    }
    ctx.closePath();
    ctx.fillStyle = P.panel;
    ctx.fill();
    ctx.strokeStyle = P.ink;
    ctx.lineWidth = INK_W;
    ctx.stroke();
  }

  override furniture(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    this.geom(w, h);

    // ── THE DIAL BODY ────────────────────────────────────────────────────────
    // The arc used to be 41 ticks and two numbers floating on the raw frame
    // with no panel anywhere near them, and that is the whole of the defect: in
    // treeline-silhouette an entire rider rendered inside the dial, because
    // there was nothing there for the rider to be behind. A gauge is a physical
    // object with a face. This is the face.
    //
    // Drawn as a faceted band rather than a true arc — twelve straight segments
    // over the sweep — because everything else in this HUD is cut from straight
    // lines, right down to the O of the typeface being an octagon. A perfectly
    // smooth annulus in the middle of it reads as a different program.
    this.dialBand(ctx);

    // The readout plate. The top-left chamfer is not decoration: without it the
    // inner ends of the ticks around 35 km/h run into the plate's corner. The
    // cut takes exactly that corner away, so the tick ring is unbroken.
    const p = this.plate;
    slab(ctx, p.x, p.y, p.w, p.h, {
      fill: P.panelDeep, ink: P.ink, inkWidth: INK_W, cuts: 0b0101, cut: 24,
      accent: P.gold, accentHeight: 4,
    });

    // Unlit ticks. 41 of them, every fifth long and labelled.
    for (let i = 0; i <= 40; i++) {
      const v = (i / 40) * SPEED_MAX;
      const a = this.angleFor(v);
      const major = i % 5 === 0;
      const len = major ? 26 : 13;
      const c = Math.cos(a);
      const s = Math.sin(a);
      tick(
        ctx,
        this.cx + c * (this.rTick - len), this.cy + s * (this.rTick - len),
        this.cx + c * this.rTick, this.cy + s * this.rTick,
        major ? 4.5 : 2.2,
        major ? P.paperDim : cssA(HUD_PALETTE.paperDim, 0.5),
      );
      // Gauge numerals ride on the OUTSIDE of the ring. Inside, they were
      // competing with the readout plate for the same wedge of canvas — which
      // is why the `0` was cut in half by the plate's bottom edge and the `50`
      // by its top.
      if (major && i % 10 === 0) {
        drawText(
          ctx,
          String(Math.round(v)),
          this.cx + c * this.rLabel,
          this.cy + s * this.rLabel + SPEED_GAUGE.size * 0.4,
          SPEED_GAUGE,
        );
      }
    }

    drawText(ctx, 'KM/H', this.unitRight, this.unitBase, SPEED_UNIT);
  }

  override update(m: HudModel, dt: number, time: number): void {
    const on = m.phase === RacePhase.Racing || m.phase === RacePhase.Countdown || m.phase === RacePhase.Finished;
    this.present(on, dt, 0.08);

    this.kmh = Math.max(0, m.speedKmh);
    this.boosting = m.boosting;
    // The digits are instantaneous; only the needle has mass, and only just
    // enough (omega 36 settles in ~90ms) so it does not lag a hard braking event.
    springStep(this.needle, this.kmh, 36, dt);

    this.sig(`${Math.round(this.kmh)}|${Math.round(this.needle.value * 3)}|${this.boosting ? 1 : 0}`);
  }

  override draw(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const v = clamp(this.needle.value, 0, SPEED_MAX);
    const lit = Math.floor((v / SPEED_MAX) * 40);
    const hot = this.boosting;

    // Lit ticks, over the unlit furniture ones.
    for (let i = 0; i <= lit; i++) {
      const a = this.angleFor((i / 40) * SPEED_MAX);
      const major = i % 5 === 0;
      const len = major ? 26 : 13;
      const c0 = Math.cos(a);
      const s0 = Math.sin(a);
      // The top fifth of the range shifts red — the "you are going too fast for
      // this corner" read, which the needle alone does not give you.
      const frac = i / 40;
      const col = hot ? P.boostFull : frac > 0.8 ? P.red : frac > 0.6 ? P.goldHot : P.gold;
      tick(
        ctx,
        this.cx + c0 * (this.rTick - len), this.cy + s0 * (this.rTick - len),
        this.cx + c0 * this.rTick, this.cy + s0 * this.rTick,
        major ? 5.2 : 2.8,
        col,
      );
    }

    // Needle: a tapered blade, not a line.
    const a = this.angleFor(v);
    const c = Math.cos(a);
    const s = Math.sin(a);
    const nx = -s;
    const ny = c;
    const r0 = this.rTick - 56;
    const r1 = this.rTick + 6;
    ctx.beginPath();
    ctx.moveTo(this.cx + c * r1, this.cy + s * r1);
    ctx.lineTo(this.cx + c * r0 + nx * 7, this.cy + s * r0 + ny * 7);
    ctx.lineTo(this.cx + c * (r0 - 16), this.cy + s * (r0 - 16));
    ctx.lineTo(this.cx + c * r0 - nx * 7, this.cy + s * r0 - ny * 7);
    ctx.closePath();
    ctx.fillStyle = hot ? P.boostFull : P.goldHot;
    ctx.fill();
    ctx.strokeStyle = P.ink;
    ctx.lineWidth = 2.6;
    ctx.stroke();

    // The number. Tabular so it cannot shuffle sideways between 99 and 100, and
    // right-aligned so the units column is nailed down — the whole point of the
    // tabular advance is that a three-digit reading grows LEFT into the plate,
    // never right into its edge.
    const txt = String(Math.round(this.kmh));
    drawText(ctx, txt, this.numRight, this.numBase, {
      ...SPEED_NUM,
      fill: hot ? P.boostFull : P.paper,
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Placement + gaps
// ─────────────────────────────────────────────────────────────────────────────

const ORD = ['TH', 'ST', 'ND', 'RD'];
function ordSuffix(n: number): string {
  const v = n % 100;
  if (v >= 11 && v <= 13) return 'TH';
  return ORD[n % 10] ?? 'TH';
}

export class PlaceWidget extends Widget {
  private pos = 1;
  private count = 4;
  private ahead: number | null = null;
  private behind: number | null = null;
  private punch = 0;

  constructor(layer: HudLayer) {
    super(layer);
    this.enterX = -150;
  }

  override furniture(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    // The slab is 12 units taller and the label 8 higher than they were. The
    // place digit is set at 96 with a 22% punch and its ink halo, at full
    // punch, reached 6 units ABOVE the old POSITION baseline — so the digit
    // chewed the label every time the player changed position. Type that
    // collides only during an animation is still type that collides.
    slab(ctx, 0, h - 172, w - 40, 166, {
      fill: P.panelDeep, ink: P.ink, inkWidth: INK_W, cuts: 0b1001, cut: 22, accent: P.gold, accentHeight: 5,
    });
    drawText(ctx, 'POSITION', 26, h - 142, {
      size: 15, weight: 0.18, fill: P.gold, ink: P.ink, tracking: 0.26, skew: SHEAR,
    });
  }

  override update(m: HudModel, dt: number, time: number): void {
    const on = m.phase === RacePhase.Racing || m.phase === RacePhase.Countdown || m.phase === RacePhase.Finished;
    this.present(on, dt, 0.08);

    if (m.position !== this.pos) this.punch = 1;
    this.punch = dampHL(this.punch, 0, 0.10, dt);
    this.pos = m.position;
    this.count = m.racerCount;
    this.ahead = m.gapAhead;
    this.behind = m.gapBehind;

    // The place digit punches on a change — a scale pop on the quad would move
    // the gap tags too, so this one is animated inside the canvas.
    const a = this.ahead === null ? 'x' : Math.round(this.ahead * 100);
    const b = this.behind === null ? 'x' : Math.round(this.behind * 100);
    this.sig(`${this.pos}/${this.count}|${a}|${b}|${Math.round(this.punch * 40)}`);
  }

  override draw(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const k = 1 + ease.outQuart(clamp01(this.punch)) * 0.11;
    const baseY = h - 30;

    ctx.save();
    ctx.translate(66, baseY);
    ctx.scale(k, k);
    drawText(ctx, String(this.pos), 0, 0, {
      size: 88, weight: 0.17, fill: P.goldHot, ink: P.ink, inkWidth: 0.06, align: 'center', skew: SHEAR,
    });
    ctx.restore();

    drawText(ctx, ordSuffix(this.pos), 118, baseY - 52, {
      size: 30, weight: 0.18, fill: P.gold, ink: P.ink, tracking: 0.06, skew: SHEAR,
    });
    drawText(ctx, `/ ${this.count}`, 118, baseY - 8, {
      size: 24, weight: 0.16, fill: P.paperDim, ink: P.ink, tracking: 0.08, skew: 0,
    });

    // Gap tags. Ahead points up, behind points down; both are read at a glance
    // by the chevron alone, which is why the colour is not carrying the meaning.
    const tagX = 210;
    if (this.ahead !== null && isFinite(this.ahead)) {
      this.gapTag(ctx, tagX, baseY - 96, '-' + Math.abs(this.ahead).toFixed(2), P.teal, -Math.PI / 2);
    }
    if (this.behind !== null && isFinite(this.behind)) {
      this.gapTag(ctx, tagX, baseY - 44, '+' + Math.abs(this.behind).toFixed(2), P.red, Math.PI / 2);
    }
  }

  private gapTag(ctx: CanvasRenderingContext2D, x: number, y: number, txt: string, col: string, dir: number): void {
    const st: TextStyle = { size: 22, weight: 0.16, fill: col, ink: P.ink, tracking: 0.04, tabular: true, skew: 0 };
    const tw = measureText(txt, st) + 48;
    bar(ctx, x, y, tw, 38, P.panel, col, 2.2);
    chevron(ctx, x + 22, y + 19, 9, 3.6, dir, col, P.ink, 1.8);
    drawText(ctx, txt, x + tw - 14, y + 27, { ...st, align: 'right' });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Boost meter
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Segmented, and only segmented. A continuous bar would tell you the boost is
 * at 63%, which is not a number you can act on; ten discrete chunks tell you
 * "three more corners of pumping and I get a shot", which is.
 */
const BOOST_SEGMENTS = 10;

export class BoostWidget extends Widget {
  private filled = 0;
  private full = false;
  private boosting = false;
  private flash = 0;
  private phase = 0;

  constructor(layer: HudLayer) {
    super(layer);
    this.enterY = 90;
  }

  private segRect(i: number, w: number, h: number): { x: number; y: number; sw: number; sh: number } {
    const padX = 30;
    const gap = 6;
    const avail = w - padX * 2 - 22;
    const sw = (avail - gap * (BOOST_SEGMENTS - 1)) / BOOST_SEGMENTS;
    return { x: padX + i * (sw + gap), y: 50, sw, sh: 42 };
  }

  override furniture(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    // The slab now starts at y = 4 and the label sits INSIDE it. It used to
    // start at 24 with the label on baseline 18 — i.e. floating on the raw
    // frame, six units clear of any panel. That is why a marker post drew
    // straight over the word BOOST in ridge-exposure: there was nothing behind
    // the word to draw over. Every piece of type in this HUD now has panel
    // underneath it.
    slab(ctx, 0, 4, w - 22, 98, { fill: P.panel, ink: P.ink, inkWidth: 2.6, cuts: 0b0101, cut: 16 });
    drawText(ctx, 'BOOST', 34, 36, {
      size: 15, weight: 0.18, fill: P.boost, ink: P.ink, tracking: 0.3, skew: SHEAR,
    });
    for (let i = 0; i < BOOST_SEGMENTS; i++) {
      const r = this.segRect(i, w, h);
      bar(ctx, r.x, r.y, r.sw, r.sh, cssA(HUD_PALETTE.ink, 0.5), cssA(HUD_PALETTE.paperDim, 0.35), 1.8);
    }
  }

  override update(m: HudModel, dt: number, time: number): void {
    const on = m.phase === RacePhase.Racing || m.phase === RacePhase.Finished;
    this.present(on, dt, 0.08);

    const next = Math.floor(clamp01(m.boost) * BOOST_SEGMENTS + 1e-4);
    if (next > this.filled) this.flash = 1;
    this.filled = next;
    this.full = m.boost >= 0.999;
    this.boosting = m.boosting;
    this.flash = dampHL(this.flash, 0, 0.09, dt);
    this.phase = time;

    const anim = this.full || this.boosting ? Math.round(time * 12) : 0;
    this.sig(`${this.filled}|${this.full ? 1 : 0}|${this.boosting ? 1 : 0}|${Math.round(this.flash * 30)}|${anim}`);
  }

  override draw(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const strobe = this.boosting ? (Math.floor(this.phase * 22) & 1) === 0 : false;
    for (let i = 0; i < this.filled; i++) {
      const r = this.segRect(i, w, h);
      const t = i / (BOOST_SEGMENTS - 1);
      let col = cssMix(HUD_PALETTE.boost, HUD_PALETTE.boostFull, t);
      if (this.full) col = (Math.floor(this.phase * 8) + i) % 4 === 0 ? P.boostFull : P.boost;
      if (strobe) col = P.paper;
      bar(ctx, r.x, r.y, r.sw, r.sh, col, P.ink, 2.2);
    }

    // The chunk that just landed gets a one-frame-ish white overshoot so gaining
    // boost is felt rather than merely displayed.
    if (this.flash > 0.02 && this.filled > 0) {
      const r = this.segRect(this.filled - 1, w, h);
      ctx.save();
      ctx.globalAlpha = clamp01(this.flash);
      bar(ctx, r.x - 3, r.y - 3, r.sw + 6, r.sh + 6, null, P.boostFull, 3.4);
      ctx.restore();
    }

    if (this.full || this.boosting) {
      const on = (Math.floor(this.phase * 6) & 1) === 0;
      const label = this.boosting ? 'BOOSTING' : 'READY';
      drawText(ctx, label, w - 34, 36, {
        size: 16,
        weight: 0.19,
        fill: on ? P.boostFull : P.boost,
        ink: P.ink,
        tracking: 0.24,
        align: 'right',
        skew: SHEAR,
      });
      // Full-state frame around the whole meter — this is the "distinct full
      // state" the meter needs so you never have to count segments.
      ctx.save();
      slabPath(ctx, -4, 0, w - 14, 106, 0b0101, 16, SHEAR);
      ctx.strokeStyle = on ? P.boostFull : P.boost;
      ctx.lineWidth = 3.2;
      ctx.stroke();
      ctx.restore();
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Standings board
// ─────────────────────────────────────────────────────────────────────────────

const ORDER_ST: TextStyle = {
  size: 15, weight: 0.18, fill: P.gold, ink: P.ink, tracking: 0.28, align: 'right', skew: SHEAR,
};

/** Row metrics, hoisted because the layer's height is derived from them. */
const BOARD_TOP = 38;
const BOARD_ROW_H = 46;
const BOARD_ROW_GAP = 8;

/**
 * The height a board of `n` riders actually needs, ink included.
 *
 * The layer was 280 for a board whose last row of ink ends at 247, and those
 * 33 dead units were not free: the popup column's ceiling is derived from this
 * panel's rect (see `PopupWidget.setCeiling`), so slack here is a popup bar
 * that could have been shown and was not. Sized from the row metrics and the
 * field size instead, it is right for any field the game ever fields.
 */
export function standingsHeight(n: number): number {
  return BOARD_TOP + n * (BOARD_ROW_H + BOARD_ROW_GAP) - BOARD_ROW_GAP + 4;
}

export class StandingsWidget extends Widget {
  private rows: { pos: number; name: string; gap: string; color: string; player: boolean }[] = [];
  private acc = 0;

  constructor(layer: HudLayer) {
    super(layer);
    this.enterX = 150;
  }

  override furniture(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    // A tag behind the word, for the same reason the boost label got one: this
    // was the last piece of type in the race HUD standing on bare frame.
    const ow = measureText('ORDER', ORDER_ST);
    bar(ctx, w - 26 - ow - 26, -4, ow + 34, 34, P.panelDeep, cssA(HUD_PALETTE.gold, 0.55), 2.0);
    drawText(ctx, 'ORDER', w - 26, 22, ORDER_ST);
  }

  override update(m: HudModel, dt: number, time: number): void {
    const on = m.phase === RacePhase.Racing || m.phase === RacePhase.Finished;
    this.present(on, dt, 0.09);

    // The board is a glanceable list, not a telemetry feed — 8 Hz is plenty and
    // it keeps a 430×270 canvas off the per-frame upload budget.
    this.acc += dt;
    if (this.acc < 0.125) return;
    this.acc = 0;

    this.rows.length = 0;
    const sorted = m.standings.slice().sort((a, b) => a.position - b.position);
    for (const r of sorted) {
      const c = RIDER_CSS[r.colorIndex % RIDER_CSS.length];
      let gap = '';
      if (r.position === 1) gap = 'LEAD';
      else if (r.gapAhead !== null && isFinite(r.gapAhead)) gap = '+' + Math.abs(r.gapAhead).toFixed(1);
      else gap = '--';
      if (r.finished && r.finishTime !== null) gap = clockString(r.finishTime);
      this.rows.push({ pos: r.position, name: r.name.toUpperCase(), gap, color: c.jersey, player: r.isPlayer });
    }
    let s = '';
    for (const r of this.rows) s += `${r.pos}${r.name}${r.gap}|`;
    this.sig(s);
  }

  override draw(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const rowH = BOARD_ROW_H;
    for (let i = 0; i < this.rows.length; i++) {
      const r = this.rows[i];
      const y = BOARD_TOP + i * (rowH + BOARD_ROW_GAP);
      const fill = r.player ? cssA(HUD_PALETTE.gold, 0.88) : P.panelDeep;
      const text = r.player ? P.ink : P.paper;
      const inkc = r.player ? P.ink : cssA(HUD_PALETTE.paperDim, 0.55);
      bar(ctx, 14, y, w - 34, rowH, fill, inkc, 2.4);

      // Rider identity stripe — colour is the only thing that survives at the
      // edge of vision, so it goes on the leading edge of the tag.
      ctx.save();
      ctx.beginPath();
      const s = SHEAR * rowH;
      ctx.moveTo(14 + s, y);
      ctx.lineTo(14 + s + 10, y);
      ctx.lineTo(14 + 10, y + rowH);
      ctx.lineTo(14, y + rowH);
      ctx.closePath();
      ctx.fillStyle = r.color;
      ctx.fill();
      ctx.restore();

      drawText(ctx, String(r.pos), 44, y + 32, {
        size: 24, weight: 0.19, fill: text, ink: r.player ? null : P.ink, tracking: 0.04, skew: 0,
      });
      drawText(ctx, r.name, 82, y + 32, {
        size: 21, weight: 0.16, fill: text, ink: r.player ? null : P.ink, tracking: 0.09, skew: 0,
      });
      drawText(ctx, r.gap, w - 32, y + 32, {
        size: 19, weight: 0.16, fill: r.player ? P.ink : P.paperDim, ink: r.player ? null : P.ink,
        tracking: 0.04, align: 'right', tabular: true, skew: 0,
      });
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Trick popups
// ─────────────────────────────────────────────────────────────────────────────

interface Popup {
  text: string;
  value: number;
  kind: 'trick' | 'split' | 'warning' | 'combo';
  age: number;
  life: number;
  active: boolean;
}

const POPUP_POOL = 6;

// ── THE POPUP COLUMN IS A STACK OF FOUR THINGS, NOT THREE ────────────────────
//
// Bottom to top: the running SCORE block, the live trick plate, then the popup
// bars climbing away from them. Every one of those three was positioned with a
// literal measured against one screenshot, and two of the three joints were
// touching. Both are now solved from the type's own ink extents:
//
//   `SCORE_TOP` is the highest the score block can reach — at FULL punch, with
//   the number's ink halo included — so the trick plate above it is placed at
//   `SCORE_TOP + clear + its own height` rather than at a number that looked
//   right while the punch happened to be decayed.
//
//   The trick plate was 46 tall for a 30-unit cap whose ink reaches 4.1 past
//   the cap line in both directions. 38.2 of ink in 46 of plate is 3.9 either
//   side, and the ink is 1.3 of that, so BARSPIN was set with its caps in the
//   plate's own border. 52, with the baseline centred, gives it 6.9.
const SCORE_NUM_SIZE = 44;
const SCORE_LABEL_SIZE = 15;
/** How much the score block swells when points land. */
const SCORE_PUNCH = 0.18;
/** Ink past the cap line, em: half the stroke plus the halo. */
const SCORE_NUM_INK = 0.17 * 0.5 + 0.052;
const SCORE_LABEL_INK = SCORE_LABEL_SIZE * (0.18 * 0.5 + 0.052);
/** Right anchor, in from the layer edge — sized for the sheared corner of a
 *  five-figure score at full punch. */
const SCORE_RIGHT = 30;
/** The score block's total reach above the layer's bottom edge, at full punch. */
const SCORE_TOP =
  30
  + SCORE_NUM_SIZE * (1 + SCORE_PUNCH) * (1 + SCORE_NUM_INK)
  + SCORE_LABEL_INK + 8
  + SCORE_LABEL_SIZE + SCORE_LABEL_INK;
const TRICK_BAR_H = 52;
/** Trick plate top, up from the layer's bottom edge. */
const TRICK_BAR_Y = Math.ceil(SCORE_TOP + 6 + TRICK_BAR_H + 2);
/**
 * Popup stack: the bottom bar's top edge, and the pitch between bars.
 *
 * The pitch is 58 rather than the 62 it was, and that is not a taste change.
 * Six bars at 62 reach design y 294 measured from the layer's bottom edge, and
 * the standings board's bottom edge is at design y 304 — so the fourth bar of a
 * six-popup pile printed across the last row of the standings. At 58 the stack
 * is the same six bars in 20 fewer units and the fourth one clears the board.
 *
 * That was not enough, and no pitch could be: six bars plus a trick plate plus
 * a score block is 470 units of column in the 400 that exist between the
 * speedometer and the standings board. Shrinking the pitch until they fit means
 * bars that touch, which is the same defect wearing a smaller number. See
 * `setCeiling()` for what actually fixed it.
 */
const POPUP_BASE = TRICK_BAR_Y + 62;
const POPUP_PITCH = 58;
const POPUP_BAR_H = 50;

/** Exported for `tools/capture/_hudlayout.mjs`, which asserts the column
 *  against the standings board. Same reason as `PROFILE_METRICS`. */
export const POPUP_METRICS = { base: POPUP_BASE, pitch: POPUP_PITCH, barH: POPUP_BAR_H, pool: POPUP_POOL } as const;

export class PopupWidget extends Widget {
  private pool: Popup[] = [];
  /** Draw order, reused every frame. See the note in `draw()`. */
  private order: Popup[] = [];
  private live = 0;
  /** How many bars fit under the ceiling. See `setCeiling()`. */
  private depth = POPUP_POOL;
  private activeTrick: string | null = null;
  private trickScore = 0;
  private scorePunch = 0;

  constructor(layer: HudLayer) {
    super(layer);
    this.enterX = 150;
    for (let i = 0; i < POPUP_POOL; i++) {
      this.pool.push({ text: '', value: 0, kind: 'trick', age: 0, life: 0, active: false });
    }
  }

  override furniture(): void {
    // Popups are transient; there is no furniture to hold. Leaving the layer
    // background empty means every popup redraw starts from a plain clear.
  }

  /**
   * ── HOW DEEP THE COLUMN IS ALLOWED TO BE ─────────────────────────────────
   *
   * `ceiling` is the highest y, in this layer's own units, that a popup bar's
   * top edge may reach. `Hud.ts` derives it from the standings board's rect, so
   * the two panels are laid out against each other instead of both being laid
   * out against the frame and hoping.
   *
   * The alternative was to move the standings, and it is the wrong call. The
   * board is on screen for the whole race and is read constantly; the popups
   * are transient and, past four of them, unreadable anyway — six bars land
   * inside 1.9 s and slide in over 0.2 s each, so a five-deep pile is a
   * flickering wall, not information. The board keeps the corner every racing
   * game puts it in; the column takes the constraint.
   *
   * The depth is not a cap on what is DRAWN — a bar that is dropped from the
   * draw would still be counted live, still hold the layer up, and still be a
   * popup the player was told about and never shown. It is a cap on what is
   * ALIVE: pushing past it hard-cuts the oldest, which is within a couple of
   * hundred milliseconds of cutting itself. `POPUP_POOL` stays at 6 so a burst
   * is never dropped at the source; it is aged out at the top instead.
   */
  setCeiling(ceiling: number): void {
    const room = this.layer.h - POPUP_BASE - ceiling;
    this.depth = Math.max(1, Math.min(POPUP_POOL, Math.floor(room / POPUP_PITCH) + 1));
  }

  /** How many bars the column can show at once. */
  get columnDepth(): number {
    return this.depth;
  }

  /** Hard-cut the oldest until the column fits. */
  private trim(): void {
    for (;;) {
      let n = 0;
      let oldest: Popup | null = null;
      for (const p of this.pool) {
        if (!p.active) continue;
        n++;
        if (!oldest || p.age > oldest.age) oldest = p;
      }
      if (n <= this.depth || !oldest) return;
      oldest.active = false;
    }
  }

  private push(text: string, value: number, kind: Popup['kind']): void {
    // Reuse the oldest slot rather than allocating — this runs on a trick land,
    // which is exactly when the frame is already busy.
    let slot = this.pool.find((p) => !p.active);
    if (!slot) {
      slot = this.pool[0];
      for (const p of this.pool) if (p.age > slot.age) slot = p;
    }
    slot.text = text.toUpperCase();
    slot.value = value;
    slot.kind = kind;
    slot.age = 0;
    slot.life = kind === 'warning' ? 2.2 : 1.9;
    slot.active = true;
  }

  override update(m: HudModel, dt: number, time: number): void {
    // Consume the model's queue — the contract says the HUD clears it.
    if (m.popups.length > 0) {
      for (const p of m.popups) this.push(p.text, p.value, p.kind);
      m.popups.length = 0;
      this.scorePunch = 1;
      this.trim();
    }

    this.live = 0;
    for (const p of this.pool) {
      if (!p.active) continue;
      p.age += dt;
      if (p.age >= p.life) {
        // Hard cut. No fade out — the popup is gone between one frame and the
        // next, which is what makes the next one land.
        p.active = false;
        continue;
      }
      this.live++;
    }

    this.activeTrick = m.activeTrick;
    this.trickScore = m.trickScore;
    this.scorePunch = dampHL(this.scorePunch, 0, 0.11, dt);

    const on =
      (m.phase === RacePhase.Racing || m.phase === RacePhase.Finished) &&
      (this.live > 0 || this.activeTrick !== null || this.trickScore > 0);
    this.present(on, dt, 0.05);

    let s = `${this.activeTrick ?? ''}|${this.trickScore}|${Math.round(this.scorePunch * 30)}`;
    for (const p of this.pool) if (p.active) s += `|${p.text}${p.value}${Math.round(p.age * 40)}`;
    this.sig(s);
  }

  override draw(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    // ── Running score tag, pinned to the bottom of the stack ─────────────────
    //
    // SCORE used to be set at a flat −50 from the number's baseline, inside the
    // same `scale(k, k)` as the number. Both of those are wrong. The number is
    // 44 tall and its ink reaches 6.0 above its own cap line, and SCORE's ink
    // reaches 2.1 below its baseline, so −50 leaves −0.1 units of air: at rest
    // the two are exactly touching, and every punch scaled the whole block so
    // they stayed touching all the way up. On top of that the punch drove
    // SCORE's cap line THROUGH the trick plate above it at k > 1.13, and drove
    // the number's sheared top-right corner to within 2.5 units of the layer
    // edge.
    //
    // So: the punch scales the NUMBER only, about its own baseline; SCORE is
    // set unscaled at a baseline derived from the number's largest possible
    // ink extent; and the whole block is anchored far enough in that the
    // biggest reading at full punch still clears the backing store.
    if (this.trickScore > 0) {
      const k = 1 + ease.outQuart(clamp01(this.scorePunch)) * SCORE_PUNCH;
      const numTop = SCORE_NUM_SIZE * (1 + SCORE_PUNCH) * (1 + SCORE_NUM_INK);
      ctx.save();
      ctx.translate(w - SCORE_RIGHT, h - 30);
      ctx.save();
      ctx.scale(k, k);
      drawText(ctx, String(Math.round(this.trickScore)), 0, 0, {
        size: SCORE_NUM_SIZE, weight: 0.17, fill: P.goldHot, ink: P.ink, tracking: 0.04, align: 'right', tabular: true, skew: SHEAR,
      });
      ctx.restore();
      drawText(ctx, 'SCORE', 0, -(numTop + SCORE_LABEL_INK + 8), {
        size: SCORE_LABEL_SIZE, weight: 0.18, fill: P.gold, ink: P.ink, tracking: 0.26, align: 'right', skew: SHEAR,
      });
      ctx.restore();
    }

    // Live trick name while it is being thrown. Its plate sits clear of the
    // SCORE label's cap line by construction — SCORE_TOP is what that block
    // reaches up to at full punch, and the plate starts above it.
    if (this.activeTrick) {
      const t = this.activeTrick.toUpperCase();
      const st: TextStyle = { size: 30, weight: 0.17, fill: P.paper, ink: P.ink, tracking: 0.12, align: 'right', skew: SHEAR };
      const tw = measureText(t, st);
      bar(ctx, w - 34 - tw - 26, h - TRICK_BAR_Y, tw + 40, TRICK_BAR_H, cssA(HUD_PALETTE.violet, 0.7), P.paper, 2.6);
      drawText(ctx, t, w - 46, h - TRICK_BAR_Y + (TRICK_BAR_H + st.size) * 0.5, st);
    }

    // ── The stack. Newest at the bottom, older ones pushed up the frame ──────
    //
    // The sort was `b.age - a.age`, which is the opposite of that: it put the
    // OLDEST at the bottom and made each new popup appear at the top of the
    // pile. That is backwards twice over. The bottom slot is the only one that
    // is guaranteed clear of the standings board and of the layer's own top
    // edge, so it is the slot the newest popup — the one the player is being
    // told something by — has to land in; and when the pile is deeper than the
    // column, the ones that get pushed out have to be the ones already on their
    // way out, not the one that just landed.
    //
    // Built into a pooled array, not `filter().sort()`. While popups are live
    // the signature changes every frame — `age` is in it — so this IS the
    // per-frame path, and the old form allocated a fresh array and a fresh
    // comparator closure on each of those frames. Six elements: an insertion
    // sort in place is both allocation-free and faster.
    let slot = 0;
    const ord = this.order;
    let n = 0;
    for (let i = 0; i < this.pool.length; i++) {
      const p = this.pool[i];
      if (!p.active) continue;
      let k = n++;
      while (k > 0 && ord[k - 1].age > p.age) {
        ord[k] = ord[k - 1];
        k--;
      }
      ord[k] = p;
    }
    for (let i = 0; i < n && i < this.depth; i++) {
      const p = ord[i];
      const k = ease.snap(clamp01(p.age / 0.20));
      const y = h - POPUP_BASE - slot * POPUP_PITCH;
      slot++;
      // A bar that cannot fit whole in the backing store is not drawn at all.
      // The old guard let one through at y = −60, which is a bar clipped to
      // nothing — the same "failed draw" the corner call used to be.
      if (y < 4) continue;

      // A split's value is a DELTA in seconds and it is routinely negative —
      // which is the good one. `value > 0` therefore printed a bare `SPLIT`
      // with no number on exactly the splits worth celebrating, and rounded to
      // a whole second (i.e. to `+0`) on the rest. Splits get a signed
      // hundredths gap and take their colour from its sign; everything else
      // keeps the integer points score it actually is.
      const isSplit = p.kind === 'split';
      const col = p.kind === 'warning'
        ? P.red
        : p.kind === 'combo'
          ? P.violet
          : isSplit
            ? (p.value <= 0 ? P.teal : P.red)
            : P.gold;
      const st: TextStyle = { size: 27, weight: 0.17, fill: P.paper, ink: P.ink, tracking: 0.1, skew: SHEAR };
      const vs = isSplit
        ? formatGap(p.value)
        : p.value > 0 ? `+${Math.round(p.value)}` : '';
      const tw = measureText(p.text, st);
      const vw = vs ? measureText(vs, { ...st, size: 27, tabular: true }) : 0;
      const bw = (tw + vw + (vs ? 34 : 0) + 40) * k;
      const x = w - 20 - bw;

      ctx.save();
      // Slide in from the right AND scale up: the snap ease overshoots by ~6%,
      // which is the tiny bit of impact that separates "appeared" from "landed".
      ctx.globalAlpha = clamp01(k * 1.6);
      bar(ctx, x, y, bw, POPUP_BAR_H, P.panelDeep, col, 3.0);
      if (k > 0.5) {
        const base = y + (POPUP_BAR_H + st.size) * 0.5 + 1;
        drawText(ctx, p.text, x + 20, base, st);
        if (vs) {
          drawText(ctx, vs, w - 34, base, { ...st, fill: col, align: 'right', tabular: true });
        }
      }
      ctx.restore();
    }
  }

  clear(): void {
    for (const p of this.pool) p.active = false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Corner preview
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A rally-style corner call. Three chevrons leaning in the direction of the
 * turn; how many are filled is the severity, and they fill from the outside in
 * as the corner arrives, so the widget animates toward you rather than just
 * changing a number.
 */
/**
 * ── WHY THIS WIDGET LATCHES ──────────────────────────────────────────────────
 *
 * The call was invisible in every fast frame of the review set, and the reason
 * was not a fade and not a speed term — there is no speed term. It is that the
 * SOURCE flickers. `cornerPreview` is recomputed from scratch every frame by
 * marching an 8 m grid forward from the rider and returning the first sample
 * whose curvature clears a hard threshold. The grid slides with the rider, so a
 * corner sitting anywhere near that threshold is found on one frame and missed
 * on the next. Measured over the pose set at the shutter:
 *
 *     summit-wide     11111111111111   alpha 1.00   legible
 *     switchback-lean 11111111111111   alpha 1.00   legible
 *     tabletop-air    11100000000000   alpha 0.21   ghost
 *     ravine-gap      11000000000000   alpha 0.07   ghost
 *     ridge-exposure  10011111111111   alpha 1.00   legible
 *
 * With a symmetric alpha damp, that chatter parks the layer between 5% and 20%.
 * And because the widget's signature only carried curvature and distance —
 * both of which FREEZE when the preview is null — the canvas was never cleared,
 * so what sat there at 7% was the previous corner's reading. The critic read it
 * exactly right: a failed draw, not a fade.
 *
 * Two changes, both necessary. The call is LATCHED for CORNER_HOLD seconds past
 * its last sighting, which is longer than any chatter gap the scanner can
 * produce and short enough that a genuinely straight section still clears it;
 * and presence uses `presentCut`, so the layer is at full alpha or at zero and
 * never in between. `has` is in the signature now, so when the call does end
 * the canvas is cleared rather than left holding a stale distance.
 */
const CORNER_HOLD = 0.75;

export class CornerWidget extends Widget {
  private curvature = 0;
  private distance = 0;
  private has = false;
  /** Seconds of latch remaining. Refreshed on every frame the preview exists. */
  private hold = 0;
  /** Last frame's route progress, for the teleport guard below. */
  private lastT = -1;

  constructor(layer: HudLayer) {
    super(layer);
    this.enterY = -46;
  }

  override furniture(): void {
    // Nothing static: the plate is tinted by severity, so it is part of the
    // call and is drawn with it.
  }

  override update(m: HudModel, dt: number, time: number): void {
    const cp = m.cornerPreview;
    const racing = m.phase === RacePhase.Racing || m.phase === RacePhase.Countdown;

    // Teleport guard. A latch is only sound while the rider keeps riding toward
    // the corner it latched; if the rider is MOVED — a restart, or the capture
    // harness dropping them 700 m down the mountain — the held call describes a
    // corner that is now behind them. One frame can legitimately move the rider
    // about 8e-5 of the course at racing speed, so 0.01 (≈38 m in a frame)
    // cannot fire in play and cannot miss a jump.
    const t = clamp01(m.routeProgress);
    if (this.lastT >= 0 && Math.abs(t - this.lastT) > 0.01) {
      this.hold = 0;
      this.distance = cp ? cp.distance : 0;
      this.curvature = cp ? cp.curvature : 0;
    }
    this.lastT = t;

    if (cp && racing) {
      this.curvature = dampHL(this.curvature, cp.curvature, 0.06, dt);
      // Snap on a new corner, ease within one. The scanner quantises distance
      // to its 8 m step, and easing that is the difference between a number
      // that counts down and a number that ticks.
      this.distance = Math.abs(cp.distance - this.distance) > 24
        ? cp.distance
        : dampHL(this.distance, cp.distance, 0.05, dt);
      this.hold = CORNER_HOLD;
    } else if (this.hold > 0) {
      this.hold = Math.max(0, this.hold - dt);
      // Keep counting the latched corner down at the speed we are closing on
      // it, so a held call never shows a distance the rider has already ridden
      // through.
      this.distance = Math.max(0, this.distance - (m.speedKmh / 3.6) * dt);
    }

    this.has = racing && this.hold > 0;
    // 0.018 s half-life: the call is at 76% one frame after it appears and full
    // the frame after. A slower ramp is a frame the shutter can land on.
    this.presentCut(this.has, dt, 0.018);
    this.sig(`${this.has ? 1 : 0}|${Math.round(this.curvature * 60)}|${Math.round(this.distance)}`);
  }

  override draw(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    if (!this.has) return;
    const left = this.curvature > 0;
    const mag = clamp01(Math.abs(this.curvature));
    const dir = left ? Math.PI : 0;
    const cx = w * 0.5;
    const cy = 46;

    // Severity: 1 chevron for a sweeper, 3 for a hairpin.
    const count = mag > 0.66 ? 3 : mag > 0.33 ? 2 : 1;
    const col = mag > 0.66 ? P.red : mag > 0.33 ? P.gold : P.teal;
    // Proximity: a chevron lights when the corner is inside its band.
    const near = clamp01(1 - this.distance / 160);

    for (let i = 0; i < 3; i++) {
      const off = (i - 1) * 42 * (left ? -1 : 1);
      const on = i < count && near > i * 0.28;
      chevron(
        ctx,
        cx + off,
        cy,
        24,
        8,
        dir,
        on ? col : null,
        on ? P.ink : cssA(HUD_PALETTE.paperDim, 0.35),
        on ? 3.0 : 2.2,
      );
    }

    // ── The plate ────────────────────────────────────────────────────────────
    // This is the one readout in the HUD that has to survive whatever is behind
    // it, because it is the only one the player CANNOT get from the picture:
    // which way the corner they cannot see yet goes. It was the last piece of
    // type in the race HUD standing on the bare frame — over a bright sky the
    // white distance and its ink outline are a coin flip. It gets a panel, and
    // the panel carries the severity colour so the call reads before the words
    // do.
    const pw = 224;
    const ph = 80;
    const py = 82;
    const px = cx - pw * 0.5 - SHEAR * ph * 0.5;
    slab(ctx, px, py, pw, ph, {
      fill: P.panelDeep, ink: col, inkWidth: 3.0, cuts: 0b0101, cut: 18,
      accent: col, accentHeight: 4,
    });

    drawText(ctx, `${Math.max(0, Math.round(this.distance))} M`, cx, py + 32, {
      size: 24, weight: 0.17, fill: P.paper, ink: P.ink, tracking: 0.08, align: 'center', tabular: true, skew: 0,
    });
    drawText(ctx, left ? 'LEFT' : 'RIGHT', cx, py + 64, {
      size: 15, weight: 0.19, fill: col, ink: P.ink, tracking: 0.3, align: 'center', skew: SHEAR,
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Wrong-way warning
// ─────────────────────────────────────────────────────────────────────────────

export class WarningWidget extends Widget {
  private on = false;
  private phase = 0;

  constructor(layer: HudLayer) {
    super(layer);
    this.enterY = -50;
  }

  override furniture(): void {
    // Hazard stripes are phase-animated, so nothing here is static.
  }

  override update(m: HudModel, dt: number, time: number): void {
    this.on = m.wrongWay && m.phase === RacePhase.Racing;
    this.phase = time;
    this.present(this.on, dt, 0.04);
    this.sig(this.on ? String(Math.round(time * 20)) : 'off');
  }

  override draw(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    if (!this.on) return;
    const blink = (Math.floor(this.phase * 5) & 1) === 0;
    const bx = 40;
    const bw = w - 80;
    const by = 40;
    const bh = 108;

    slabPath(ctx, bx, by, bw, bh, 0b0101, 22, SHEAR);
    ctx.save();
    ctx.clip();
    ctx.fillStyle = blink ? P.red : P.ink;
    ctx.fillRect(bx - 40, by, bw + 80, bh);
    hazard(ctx, bx - 40, by, bw + 80, bh, cssA(HUD_PALETTE.ink, blink ? 0.5 : 0.85), 34, 0.5, -this.phase * 90);
    ctx.restore();
    slabPath(ctx, bx, by, bw, bh, 0b0101, 22, SHEAR);
    ctx.strokeStyle = blink ? P.goldHot : P.red;
    ctx.lineWidth = 4.0;
    ctx.stroke();

    drawText(ctx, 'WRONG WAY', w * 0.5, by + 76, {
      size: 54, weight: 0.19, fill: blink ? P.paper : P.red, ink: P.ink, inkWidth: 0.06,
      tracking: 0.16, align: 'center', skew: SHEAR,
    });

    // A U-turn arrow either side, so the instruction survives without the text.
    for (const sx of [bx + 46, bx + bw - 46]) {
      chevron(ctx, sx, by + bh * 0.5, 24, 8, Math.PI, blink ? P.paper : P.red, P.ink, 3.0);
    }

    cornerTicks(ctx, bx - 12, by - 12, bw + 24, bh + 24, 20, 2.6, blink ? P.goldHot : P.red);
  }
}
