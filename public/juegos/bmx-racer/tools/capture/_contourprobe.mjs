/**
 * Throwaway probe. Reads the LinesPass render target directly in debug mode 7
 * (r contour, g hull, b 1, a final alpha) and walks a column band, reporting
 * for each column the strongest contour response found and the alpha that
 * actually survived at that pixel. That separates "the detector did not fire"
 * from "the detector fired and something else ate it", which is the only
 * question worth asking about a dropped ridge stroke.
 *
 *   node tools/capture/_contourprobe.mjs <pose> x0 x1 y0 y1 [step] [debug]
 *
 * Coordinates are full-resolution device pixels, top-left origin.
 */
import { chromium } from 'playwright';

const [, , pose, x0s, x1s, y0s, y1s, steps, dbgs] = process.argv;
const x0 = Number(x0s), x1 = Number(x1s), y0 = Number(y0s), y1 = Number(y1s);
const step = Number(steps ?? 8);
const dbg = Number(dbgs ?? 7);

const browser = await chromium.launch({
  args: ['--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist'],
});
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('PAGEERR', e.message.slice(0, 300)));
await page.goto('http://127.0.0.1:5173/?capture=1&pr=2', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!window.__DESCENT__?.game?.capture, null, { timeout: 240000 });

const rows = await page.evaluate(
  async ({ pose, dbg, x0, x1, y0, y1, step }) => {
    const g = window.__DESCENT__.game;
    const renderer = window.__DESCENT__.engine.renderer;
    g.capture.takeControl();
    g.capture.setPose(pose);
    g.post.lines.setDebug(dbg);
    for (let i = 0; i < 12; i++) g.capture.step(1 / 60);
    const rt = g.post.lines.target;
    const buf = new Uint8Array(rt.width * rt.height * 4);
    renderer.readRenderTargetPixels(rt, 0, 0, rt.width, rt.height, buf);
    const at = (x, y) => {
      const i = ((rt.height - 1 - y) * rt.width + x) * 4;
      return [buf[i], buf[i + 1], buf[i + 2], buf[i + 3]];
    };
    const out = [];
    for (let x = x0; x <= x1; x += step) {
      let best = null;
      for (let y = y0; y <= y1; y++) {
        const p = at(x, y);
        if (!best || p[0] > best.p[0] || (p[0] === best.p[0] && p[3] > best.p[3])) best = { y, p };
      }
      // Alpha profile through the boundary, for stroke width.
      const prof = [];
      for (let y = best.y - 3; y <= best.y + 4; y++) prof.push(at(x, y)[3]);
      out.push({ x, y: best.y, contour: best.p[0], hull: best.p[1], alpha: best.p[3], prof });
    }
    return { size: [rt.width, rt.height], out };
  },
  { pose, dbg, x0, x1, y0, y1, step },
);
await browser.close();

console.log('rt', rows.size.join('x'), 'debug', dbg);
let weak = 0;
for (const r of rows.out) {
  if (r.alpha < 200) weak++;
  console.log(
    `x=${String(r.x).padStart(4)} y=${String(r.y).padStart(4)} contour=${String(r.contour).padStart(3)}` +
    ` hull=${String(r.hull).padStart(3)} alpha=${String(r.alpha).padStart(3)} | ${r.prof.join(' ')}`,
  );
}
const a = rows.out.map((r) => r.alpha).sort((x, y) => x - y);
console.log(`\ncolumns=${rows.out.length} alpha<200: ${weak}  median=${a[a.length >> 1]} min=${a[0]} max=${a[a.length - 1]}`);
