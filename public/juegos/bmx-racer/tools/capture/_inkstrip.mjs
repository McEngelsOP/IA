/**
 * Throwaway probe. Prints, for each column in a range, the vertical run of
 * (contour, alpha) values from the LinesPass debug-7 target across a band —
 * so a stroke that fires but arrives thin, or a row that fires and is then
 * suppressed, is visible as a sequence rather than as a single max.
 *
 *   node tools/capture/_inkstrip.mjs <pose> x0 x1 xstep y0 y1
 */
import { chromium } from 'playwright';

const [, , pose, x0s, x1s, xsteps, y0s, y1s] = process.argv;
const x0 = Number(x0s), x1 = Number(x1s), xstep = Number(xsteps), y0 = Number(y0s), y1 = Number(y1s);

const browser = await chromium.launch({
  args: ['--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist'],
});
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('PAGEERR', e.message.slice(0, 300)));
await page.goto('http://127.0.0.1:5173/?capture=1&pr=2', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!window.__DESCENT__?.game?.capture, null, { timeout: 240000 });

const res = await page.evaluate(
  async ({ pose, x0, x1, xstep, y0, y1 }) => {
    const g = window.__DESCENT__.game;
    const renderer = window.__DESCENT__.engine.renderer;
    g.capture.takeControl();
    g.capture.setPose(pose);
    g.post.lines.setDebug(7);
    for (let i = 0; i < 12; i++) g.capture.step(1 / 60);
    const rt = g.post.lines.target;
    const buf = new Uint8Array(rt.width * rt.height * 4);
    renderer.readRenderTargetPixels(rt, 0, 0, rt.width, rt.height, buf);
    const at = (x, y) => {
      const i = ((rt.height - 1 - y) * rt.width + x) * 4;
      return [buf[i], buf[i + 1], buf[i + 3]];
    };
    const out = [];
    for (let x = x0; x <= x1; x += xstep) {
      const col = [];
      for (let y = y0; y <= y1; y++) col.push(at(x, y));
      out.push({ x, col });
    }
    return out;
  },
  { pose, x0, x1, xstep, y0, y1 },
);
await browser.close();

for (const r of res) {
  const c = r.col.map((v) => (v[0] > 127 ? 'C' : v[0] > 0 ? 'c' : '.')).join('');
  const h = r.col.map((v) => (v[1] > 127 ? 'H' : v[1] > 0 ? 'h' : '.')).join('');
  const a = r.col.map((v) => String(Math.round(v[2] / 26)));
  console.log(`x=${String(r.x).padStart(4)} y${y0}..${y1}`);
  console.log(`   contour ${c}`);
  console.log(`   hull    ${h}`);
  console.log(`   alpha/26 ${a.join('')}`);
}
