/**
 * Throwaway probe. Statistics of one LinesPass debug channel over a rectangle,
 * so "does the crease detector return nothing on a plane" is a number instead
 * of an impression.
 *
 *   node tools/capture/_fieldstats.mjs <pose> <debug> x y w h [channel]
 *
 * debug 2 = eNormal, 3 = eDepth, 4 = eId, 1 = final alpha, 5 = hull.
 */
import { chromium } from 'playwright';

const [, , pose, dbgs, xs, ys, ws, hs, chs] = process.argv;
const dbg = Number(dbgs), x0 = Number(xs), y0 = Number(ys), w = Number(ws), h = Number(hs);
const ch = Number(chs ?? 0);

const browser = await chromium.launch({
  args: ['--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist'],
});
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('PAGEERR', e.message.slice(0, 300)));
await page.goto('http://127.0.0.1:5173/?capture=1&pr=2', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!window.__DESCENT__?.game?.capture, null, { timeout: 240000 });

const r = await page.evaluate(
  async ({ pose, dbg, x0, y0, w, h, ch }) => {
    const g = window.__DESCENT__.game;
    const renderer = window.__DESCENT__.engine.renderer;
    g.capture.takeControl();
    g.capture.setPose(pose);
    g.post.lines.setDebug(dbg);
    for (let i = 0; i < 12; i++) g.capture.step(1 / 60);
    const rt = g.post.lines.target;
    const buf = new Uint8Array(rt.width * rt.height * 4);
    renderer.readRenderTargetPixels(rt, 0, 0, rt.width, rt.height, buf);
    let sum = 0, max = 0, n = 0;
    const bins = new Array(8).fill(0);
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) {
        const v = buf[((rt.height - 1 - y) * rt.width + x) * 4 + ch];
        sum += v; if (v > max) max = v; n++;
        bins[Math.min(7, v >> 5)]++;
      }
    }
    return { mean: sum / n, max, n, bins };
  },
  { pose, dbg, x0, y0, w, h, ch },
);
await browser.close();
console.log(`pose=${pose} debug=${dbg} rect=${x0},${y0} ${w}x${h} ch=${ch}`);
console.log(`  mean=${r.mean.toFixed(2)}/255  max=${r.max}  px=${r.n}`);
console.log(`  histogram (32-wide bins): ${r.bins.join(' ')}`);
console.log(`  fraction >32: ${((100 * r.bins.slice(1).reduce((a, b) => a + b, 0)) / r.n).toFixed(3)}%`);
