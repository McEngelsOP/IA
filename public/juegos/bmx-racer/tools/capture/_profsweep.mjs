/**
 * SUPERSEDED by `_profsweep2.mjs`. Its rival checks describe a marker that no
 * longer exists — the rivals were moved off the skyline onto a rail because
 * they collided with the PLAYER's marker, which this probe never tested for.
 * It also hard-codes the marker constants, which have since changed; run
 * `_profsweep2.mjs` instead, which drives the shipped widget and reads
 * `PROFILE_METRICS` off the module.
 *
 * Throwaway probe: sweep the route-profile markers across the whole route and
 * report the closest approach between their INK and every fixed thing in the
 * panel — the title above, the checkpoint digits below, the baseline rule, and
 * the slab's own leaning walls.
 *
 * The critic tested stills; the marker moves, so a still cannot prove this.
 * Every number below is a clearance in design units. All must be > 0.
 */
import { chromium } from 'playwright';

const MARK_R = 11, MARK_INK = 2.2, MARK_LIFT = 2, MARK_DX = 2;
const RIVAL_R = 8, RIVAL_INK = 2.0, RIVAL_LIFT = 13;
const SHEAR = 0.20;
const TITLE_SIZE = 16, TITLE_WEIGHT = 0.17;

const b = await chromium.launch({ args: ['--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
p.on('pageerror', (e) => console.log('PAGEERR', e.message.slice(0, 300)));
await p.goto('http://127.0.0.1:5173/?capture=1&pr=1', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => !!window.__DESCENT__?.game?.capture, null, { timeout: 240000 });
await p.evaluate(() => window.__DESCENT__.game.capture.takeControl());
await p.evaluate(() => { window.__DESCENT__.game.capture.setPose('summit-wide'); for (let i = 0; i < 8; i++) window.__DESCENT__.game.capture.step(1 / 60); });

const r = await p.evaluate(async (K) => {
  const g = window.__DESCENT__.game;
  const w = g.hud.profile;
  const h = g.hud.profile.layer.h;
  const mod = await import('/src/game/WorldConstants.ts');
  const CP = mod.CHECKPOINT_TS;

  // Player marker is `tri`: tip a full radius along dir, base 0.7 back, ±0.78.
  const pts = [
    [K.MARK_R, 0], [-K.MARK_R * 0.7, K.MARK_R * 0.78], [-K.MARK_R * 0.7, -K.MARK_R * 0.78],
  ];
  const titleInkBottom = 30 + K.TITLE_SIZE * (K.TITLE_WEIGHT * 0.5 + 0.052);
  const digitCapTop = w.cpBaseY - 10 - 10 * 0.20 * 0.5;
  const wallL = (y) => K.SHEAR * h * (1 - y / h);          // panel inner left edge at y
  const wallR = (y) => w.bodyW + K.SHEAR * (h - y);        // panel inner right edge at y

  const res = {
    h, bodyW: +w.bodyW.toFixed(1), plotX: w.plotX, plotW: +w.plotW.toFixed(1),
    ruleY: +w.ruleY.toFixed(1), skyTop: +w.skyTop.toFixed(1), skyBot: +w.skyBot.toFixed(1),
    skySpan: +(w.skyBot - w.skyTop).toFixed(1),
    titleInkBottom: +titleInkBottom.toFixed(1), digitCapTop: +digitCapTop.toFixed(1),
    clearance: {},
  };
  const worst = (key, v, t) => {
    const c = res.clearance;
    if (!(key in c) || v < c[key][0]) c[key] = [+v.toFixed(2), +t.toFixed(3)];
  };

  for (let t = 0; t <= 1.0001; t += 0.001) {
    const px = w.plotX + t * w.plotW;
    const py = w.yAt(t);
    const y2 = w.yAt(Math.min(1, t + 0.02));
    const dir = Math.atan2(y2 - py, w.plotW * 0.02);
    const c = Math.cos(dir), s = Math.sin(dir);
    let bot = -1e9, top = 1e9, left = 1e9, right = -1e9;
    for (const q of pts) {
      const X = px + K.MARK_DX + q[0] * c - q[1] * s;
      const Y = py - K.MARK_LIFT + q[0] * s + q[1] * c;
      if (Y > bot) bot = Y; if (Y < top) top = Y;
      if (X < left) left = X; if (X > right) right = X;
    }
    const hi = K.MARK_INK * 0.5;
    bot += hi; top -= hi; left -= hi; right += hi;

    worst('chevron_vs_rule', w.ruleY - bot, t);
    worst('chevron_vs_leftWall', left - wallL(top), t);
    worst('chevron_vs_rightWall', wallR(bot) - right, t);
    if (right > w.plotX && left < w.plotX + 250) worst('chevron_vs_title', top - titleInkBottom, t);
    for (let i = 1; i < CP.length - 1; i++) {
      const dx = w.plotX + CP[i] * w.plotW;
      if (right < dx - 4 || left > dx + 4) continue;
      worst('chevron_vs_cpDigit', digitCapTop - bot, t);
    }

    // Rival triangle at the same t: tip a full radius down, base 0.7 back.
    const rTop = py - K.RIVAL_LIFT - K.RIVAL_R * 0.7 - K.RIVAL_INK * 0.5;
    const rBot = py - K.RIVAL_LIFT + K.RIVAL_R + K.RIVAL_INK * 0.5;
    worst('rival_vs_title', rTop - titleInkBottom, t);
    worst('rival_vs_rule', w.ruleY - rBot, t);
  }
  return res;
}, { MARK_R, MARK_INK, MARK_LIFT, MARK_DX, RIVAL_R, RIVAL_INK, RIVAL_LIFT, SHEAR, TITLE_SIZE, TITLE_WEIGHT });

console.log(JSON.stringify(r, null, 1));
const bad = Object.entries(r.clearance).filter(([, v]) => v[0] <= 0);
console.log(bad.length ? '  ✗ COLLISIONS: ' + JSON.stringify(bad) : '  ✓ all clearances positive');
await b.close();
