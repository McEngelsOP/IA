/**
 * Throwaway probe: mean frame time at a pose, measured with the real clock.
 *   node tools/capture/_perf.mjs <pose> [frames]
 */
import { chromium } from 'playwright';

const [, , pose, framesS] = process.argv;
const frames = Number(framesS ?? 240);
const browser = await chromium.launch({ args: ['--use-angle=metal'] });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:5173/?capture=1&pr=2', { waitUntil: 'load' });
await page.waitForFunction(() => window.__DESCENT__ && window.__DESCENT__.game, { timeout: 60000 });
await page.evaluate((p) => window.__DESCENT__.game.capture.setPose(p), pose);
await page.evaluate(() => { for (let i = 0; i < 20; i++) window.__DESCENT__.game.capture.step(1 / 60); });
const ms = await page.evaluate(async (n) => {
  const g = window.__DESCENT__.game;
  for (let i = 0; i < 30; i++) g.capture.step(1 / 60);          // warm
  const t0 = performance.now();
  for (let i = 0; i < n; i++) g.capture.step(1 / 60);
  await new Promise((r) => requestAnimationFrame(() => r()));
  return (performance.now() - t0) / n;
}, frames);
const info = await page.evaluate(() => {
  const r = window.__DESCENT__.game.engine.renderer;
  return { calls: r.info.render.calls, tris: r.info.render.triangles };
});
console.log(pose, 'cpu+submit ms/frame', ms.toFixed(3), JSON.stringify(info));
await browser.close();
