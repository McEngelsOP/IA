/**
 * Route-profile layout sweep, second edition.
 *
 * `_profsweep.mjs` swept the player marker against the panel's FURNITURE — the
 * title, the checkpoint digits, the baseline rule, the leaning walls — and it
 * cleared them all. It never swept a marker against another MARKER, which is
 * why the rival triangle sat on the player's at t = 0.757 in `ridge-exposure`
 * with about half its area inside it, and why the other two rivals were
 * invisible underneath it.
 *
 * This one drives the shipped widget: it writes the rival slots, calls the
 * widget's own `railLayout()`, and measures the ink boxes the widget will draw
 * from the metrics the widget draws them with (`PROFILE_METRICS`). Nothing here
 * is a copy of a constant.
 *
 * Every number printed is a clearance in design units. All must be > 0.
 */
import { chromium } from 'playwright';

const b = await chromium.launch({ args: ['--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
p.on('pageerror', (e) => console.log('PAGEERR', e.message.slice(0, 300)));
await p.goto('http://127.0.0.1:5173/?capture=1&pr=1', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => !!window.__DESCENT__?.game?.capture, null, { timeout: 240000 });
await p.evaluate(() => window.__DESCENT__.game.capture.takeControl());
await p.evaluate(() => {
  window.__DESCENT__.game.capture.setPose('summit-wide');
  for (let i = 0; i < 8; i++) window.__DESCENT__.game.capture.step(1 / 60);
});

const r = await p.evaluate(async () => {
  const g = window.__DESCENT__.game;
  const w = g.hud.profile;
  const h = w.layer.h;
  const M = (await import('/src/hud/Widgets.ts')).PROFILE_METRICS;
  const CP = (await import('/src/game/WorldConstants.ts')).CHECKPOINT_TS;

  const titleInkBottom = M.headBase + M.titleSize * (M.titleWeight * 0.5 + 0.052);
  const digitCapTop = w.cpBaseY - M.cpSize - M.cpSize * 0.2 * 0.5;
  const wallL = (y) => M.shear * h * (1 - y / h);
  const wallR = (y) => w.bodyW + M.shear * (h - y);

  const res = {
    h,
    bodyW: +w.bodyW.toFixed(1), plotX: w.plotX, plotW: +w.plotW.toFixed(1),
    railY: +w.railY.toFixed(1), skyTop: +w.skyTop.toFixed(1), skyBot: +w.skyBot.toFixed(1),
    relief: +(w.skyBot - w.skyTop).toFixed(1), ruleY: +w.ruleY.toFixed(1),
    titleInkBottom: +titleInkBottom.toFixed(1), digitCapTop: +digitCapTop.toFixed(1),
    samples: 0, clearance: {},
  };
  const worst = (key, v, t) => {
    const c = res.clearance;
    if (!(key in c) || v < c[key][0]) c[key] = [+v.toFixed(2), +t.toFixed(3)];
  };

  // Player marker: `tri` at (px + dx, py − lift), tip a full R along `dir`,
  // base corners 0.7 R back and 0.78 R either side.
  const tp = [[M.markR, 0], [-M.markR * M.triBack, M.markR * M.triHalf], [-M.markR * M.triBack, -M.markR * M.triHalf]];
  const hi = M.markInk * 0.5;

  // Rail marker ink box, from the widget's own placement.
  const railTop = w.railY - M.railUp;
  const railBot = w.railY + M.railDown;

  // Give the widget a field to lay out. Three rivals plus the player, which is
  // what the game fields; `railLayout` skips the player's slot.
  w.ai.length = 0;
  for (let i = 0; i < 4; i++) w.ai.push({ t: 0, color: '#fff', lead: '#fff', player: i === 0 });
  w.railIdx.length = 4; w.railX.length = 4;
  w.aiCount = 4;

  const OFF = [-0.05, -0.02, -0.005, 0, 0.005, 0.02, 0.05];
  const SPREAD = [0, 0.002, 0.01];

  for (let t = 0; t <= 1.0001; t += 0.001) {
    const px = w.plotX + t * w.plotW;
    const py = w.yAt(t);
    const y2 = w.yAt(Math.min(1, t + 0.02));
    const dir = Math.atan2(y2 - py, w.plotW * 0.02);
    const c = Math.cos(dir), s = Math.sin(dir);
    let bot = -1e9, top = 1e9, left = 1e9, right = -1e9;
    for (const q of tp) {
      const X = px + M.markDx + q[0] * c - q[1] * s;
      const Y = py - M.markLift + q[0] * s + q[1] * c;
      if (Y > bot) bot = Y; if (Y < top) top = Y;
      if (X < left) left = X; if (X > right) right = X;
    }
    bot += hi; top -= hi; left -= hi; right += hi;

    worst('mark_vs_rule', w.ruleY - bot, t);
    worst('mark_vs_railBottom', top - railBot, t);
    worst('mark_vs_leftWall', left - wallL(top), t);
    worst('mark_vs_rightWall', wallR(bot) - right, t);
    worst('mark_vs_title', top - titleInkBottom, t);
    for (let i = 1; i < CP.length - 1; i++) {
      const dx = w.plotX + CP[i] * w.plotW;
      if (right < dx - 4 || left > dx + 4) continue;
      worst('mark_vs_cpDigit', digitCapTop - bot, t);
    }

    // The rail, over every rival configuration worth testing: the whole field
    // sitting exactly on the player, bunched just off him, and strung out.
    for (const o of OFF) {
      for (const d of SPREAD) {
        for (let i = 1; i < 4; i++) w.ai[i].t = Math.max(0, Math.min(1, t + o + (i - 1) * d));
        w.railLayout();
        res.samples++;
        for (let i = 0; i < w.railN; i++) {
          const x = w.railX[i];
          worst('rail_vs_title', railTop - titleInkBottom, t);
          worst('rail_vs_leftWall', (x - M.railHalf) - wallL(railTop), t);
          worst('rail_vs_rightWall', wallR(railBot) - (x + M.railHalf), t);
          // Against the player's marker: a real 2-D box test, not a band claim.
          const ox = Math.min(right, x + M.railHalf) - Math.max(left, x - M.railHalf);
          const oy = Math.min(bot, railBot) - Math.max(top, railTop);
          worst('rail_vs_mark', ox <= 0 || oy <= 0 ? Math.max(-ox, -oy) : -Math.min(ox, oy), t);
          for (let j = i + 1; j < w.railN; j++) {
            worst('rail_vs_rail', Math.abs(w.railX[j] - x) - 2 * M.railHalf, t);
          }
        }
        // Order must survive the de-collision, or the panel is lying about who
        // is in front.
        for (let i = 1; i < w.railN; i++) {
          if (w.ai[w.railIdx[i]].t < w.ai[w.railIdx[i - 1]].t) worst('rail_order', -1, t);
        }
        // And nothing may be pushed outside the plot.
        for (let i = 0; i < w.railN; i++) {
          worst('rail_in_plot', Math.min(w.railX[i] - w.plotX, w.plotX + w.plotW - w.railX[i]), t);
        }
      }
    }
  }
  return res;
});

console.log(JSON.stringify(r, null, 1));
// `rail_in_plot` is an inclusive bound — a marker at t = 0 sits exactly on the
// plot's left edge, which is where it belongs. Everything else is strict.
const bad = Object.entries(r.clearance).filter(([k, v]) => (k === 'rail_in_plot' ? v[0] < 0 : v[0] <= 0));
console.log(bad.length ? '  ✗ COLLISIONS: ' + JSON.stringify(bad) : '  ✓ all clearances positive');
await b.close();
