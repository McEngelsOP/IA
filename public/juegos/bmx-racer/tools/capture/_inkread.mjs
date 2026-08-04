/**
 * Throwaway probe: read the LinesPass render target back as NUMBERS.
 *
 * The composited frame is graded, vignetted, grained and covered by the HUD, so
 * "is there ink on that ridge" cannot be answered from it reliably. This reads
 * the ink buffer itself, before any of that.
 *
 *   node tools/capture/_inkread.mjs <pose> <debugMode> <mode> <args...>
 *
 *   ... col <x> <y0> <y1>          print one column
 *   ... row <y> <x0> <x1>          print one row
 *   ... ridge <x0> <x1> <stride> <y0> <y1>
 *         walk each column down from y0 looking for the first covered pixel
 *         (the sky/terrain boundary in the G-buffer) and report the ink there
 *
 * debugMode 0 = shipping ink, 7 = (contour, hull, coverage, alpha),
 *           8 = (nMagX, nMagY, spanX/4m, spanY/4m).
 */
import { chromium } from 'playwright';

const [, , pose, dbgS, mode, ...rest] = process.argv;
const dbg = Number(dbgS ?? 0);

const browser = await chromium.launch({
  args: ['--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'],
});
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('PAGEERR', e.message.slice(0, 300)));
await page.goto('http://127.0.0.1:5173/?capture=1&pr=2', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!window.__DESCENT__?.game?.capture, null, { timeout: 240000 });

const out = await page.evaluate(
  async ({ pose, dbg, mode, rest }) => {
    const g = window.__DESCENT__.game;
    const renderer = window.__DESCENT__.engine.renderer;
    g.capture.takeControl();
    g.capture.setPose(pose);
    g.post.lines.setDebug(dbg);
    for (let i = 0; i < 12; i++) g.capture.step(1 / 60);

    const rt = g.post.lines.target;
    const W = rt.width;
    const H = rt.height;
    const buf = new Uint8Array(W * H * 4);
    renderer.readRenderTargetPixels(rt, 0, 0, W, H, buf);
    // readRenderTargetPixels origin is BOTTOM-left; flip to screen coords.
    const at = (x, y) => {
      const i = (((H - 1 - y) * W) + x) * 4;
      return [buf[i], buf[i + 1], buf[i + 2], buf[i + 3]];
    };

    const rows = [];
    if (mode === 'col' || mode === 'row') {
      const a = Number(rest[0]);
      const b0 = Number(rest[1]);
      const b1 = Number(rest[2]);
      for (let t = b0; t <= b1; t++) {
        const x = mode === 'col' ? a : t;
        const y = mode === 'col' ? t : a;
        rows.push([x, y, ...at(x, y)]);
      }
    } else if (mode === 'ridge') {
      const [x0, x1, stride, y0, y1] = rest.map(Number);
      for (let x = x0; x <= x1; x += stride) {
        let edge = -1;
        for (let y = y0; y <= y1; y++) {
          // Debug 7 writes b=1 on every covered pixel and the shader early-outs
          // to all-zero on background, so blue is an exact coverage mask.
          if (at(x, y)[2] > 128) { edge = y; break; }
        }
        if (edge < 0) { rows.push([x, -1, 0, 0, 0, 0]); continue; }
        // Report the strongest ink in the first 5 rows of geometry.
        let best = [0, 0, 0, 0];
        let bestY = edge;
        for (let y = edge; y < edge + 5 && y <= y1; y++) {
          const p = at(x, y);
          if (p[3] > best[3]) { best = p; bestY = y; }
        }
        const e = at(x, edge);
        rows.push([x, edge, e[0], e[1], best[3], bestY]);
      }
    }
    return { W, H, rows, mode };
  },
  { pose, dbg, mode, rest },
);
await browser.close();

if (out.mode === 'ridge') {
  console.log('     x   edge  contour  hull  maxA  atY');
  let n = 0, weak = 0, hullHit = 0;
  for (const [x, edge, c, h, a, ay] of out.rows) {
    if (edge < 0) { console.log(String(x).padStart(6), '   —'); continue; }
    console.log(
      String(x).padStart(6), String(edge).padStart(6),
      String(c).padStart(8), String(h).padStart(5),
      String(a).padStart(6), String(ay).padStart(5),
      a < 90 ? '   <-- WEAK' : '',
    );
    n++;
    if (a < 90) weak++;
    if (h > 128) hullHit++;
  }
  console.log(`\ncolumns ${n}  weak(alpha<90) ${weak}  hull-suppressed ${hullHit}`);
} else {
  console.log('     x     y     r     g     b     a');
  for (const r of out.rows) console.log(r.map((v) => String(v).padStart(6)).join(''));
}
