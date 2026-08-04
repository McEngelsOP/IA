/**
 * Throwaway: clipmap cull stats and renderer draw/triangle counts at a pose.
 *
 *   node tools/capture/_sc_clip.mjs streambed rockgarden-low summit-rider
 */
import { chromium } from 'playwright';

const POSES = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-angle=metal'] });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('ERR', e.message.slice(0, 200)));
await page.goto('http://127.0.0.1:5173/?capture=1&pr=2', { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__DESCENT__?.game?.race, null, { timeout: 300000 });
await page.evaluate(() => window.__DESCENT__.game.capture.takeControl());

for (const pose of POSES) {
  const out = await page.evaluate(async (p) => {
    const g = window.__DESCENT__.game;
    g.capture.setPose(p);
    for (let i = 0; i < 24; i++) g.capture.step(1 / 60);
    const t0 = performance.now();
    for (let i = 0; i < 120; i++) g.capture.step(1 / 60);
    await new Promise((r) => requestAnimationFrame(() => r()));
    const ms = (performance.now() - t0) / 120;
    const r = g.engine.renderer;
    const c = g.terrain.clipmap?.stats ?? g.terrain.clipmap ?? null;
    return { ms, calls: r.info.render.calls, tris: r.info.render.triangles, clip: c };
  }, pose);
  console.log(
    `${pose.padEnd(20)} ms=${out.ms.toFixed(2)} calls=${out.calls} tris=${out.tris} clip=${JSON.stringify(out.clip)}`,
  );
}
await browser.close();
