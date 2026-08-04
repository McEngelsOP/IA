/**
 * Panel-against-panel layout assertions, in design space.
 *
 * The popup column and the standings board are both right-anchored and overlap
 * in x by 418 of the board's 430 units, so the only thing that has ever kept a
 * deep popup pile off the board is arithmetic. Twice that arithmetic was done
 * by hand in a comment and was wrong. This checks it against the live layers,
 * the exported metrics, and the column depth the HUD actually solved for — and
 * then drives eight simultaneous popups through the real widget to confirm the
 * live set is capped rather than merely un-drawn.
 *
 * Every clearance printed is in design units and must be > 0.
 */
import { chromium } from 'playwright';

const b = await chromium.launch({ args: ['--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
p.on('pageerror', (e) => console.log('PAGEERR', e.message.slice(0, 300)));
await p.goto('http://127.0.0.1:5173/?capture=1&pr=1', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => !!window.__DESCENT__?.game?.capture, null, { timeout: 240000 });

const r = await p.evaluate(async () => {
  const g = window.__DESCENT__.game;
  const hud = g.hud;
  const C = await import('/src/hud/HudCanvas.ts');
  const W = await import('/src/hud/Widgets.ts');
  const N = (await import('/src/game/WorldConstants.ts')).RACER_COUNT;

  // Design-space rect of a layer, at the aspect ratio where `ui` is limited by
  // height — exact at 16:9, and the worst case for a top-anchored panel against
  // a centre-anchored one (anything taller moves the centred one down).
  const rect = (l) => {
    const q = l.placement;
    const a = q.anchor;
    const x = a.endsWith('left') ? q.dx
      : a === 'top' || a === 'center' || a === 'bottom' ? C.DESIGN_W * 0.5 - q.w * 0.5 + q.dx
        : C.DESIGN_W - q.w - q.dx;
    const y = a.startsWith('top') ? q.dy
      : a === 'left' || a === 'center' || a === 'right' ? C.DESIGN_H * 0.5 - q.h * 0.5 + q.dy
        : C.DESIGN_H - q.h - q.dy;
    return { x, y, w: q.w, h: q.h };
  };

  const board = rect(hud.standings.layer);
  const col = rect(hud.popups.layer);
  const M = W.POPUP_METRICS;
  const depth = hud.popups.columnDepth;
  const boardInk = board.y + W.standingsHeight(N);
  const topBar = col.y + col.h - M.base - (depth - 1) * M.pitch;

  // Eight popups in one frame, through the shipped update path.
  g.capture.takeControl();
  const pw = hud.popups;
  pw.clear();
  const proto = Object.getPrototypeOf(pw).update;
  let queued = false;
  pw.update = function (m, dt, t) {
    if (!queued) {
      queued = true;
      for (let i = 0; i < 8; i++) m.popups.push({ text: `BAR ${i}`, value: 100, kind: 'trick' });
    }
    return proto.call(this, m, dt, t);
  };
  g.capture.setPose('tabletop-air');
  for (let i = 0; i < 4; i++) g.capture.step(1 / 60);
  let live = 0;
  for (const q of pw.pool) if (q.active) live++;
  pw.update = proto;

  return {
    board: { ...board, inkBottom: boardInk },
    column: { ...col, depth, poolSize: M.pool, liveAfter8: live },
    topBarDesign: +topBar.toFixed(1),
    xOverlap: +(Math.min(board.x + board.w, col.x + col.w) - Math.max(board.x, col.x)).toFixed(1),
    clearance: {
      column_vs_board: +(topBar - boardInk).toFixed(2),
      topBar_in_layer: +(topBar - col.y).toFixed(2),
      live_within_depth: depth - live,
    },
  };
});

console.log(JSON.stringify(r, null, 1));
const bad = Object.entries(r.clearance).filter(([, v]) => v < 0);
console.log(bad.length ? '  ✗ FAIL: ' + JSON.stringify(bad) : '  ✓ all clearances positive');
await b.close();
