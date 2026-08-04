/**
 * Identify the rectilinear inked lattice on the far slopes of valley-vista.
 *   node tools/capture/_lattice.mjs
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
await mkdir('captures/_lattice', { recursive: true });

const b = await chromium.launch({
  args: ['--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'],
});
const ctx = await b.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
const p = await ctx.newPage();
p.on('pageerror', (e) => console.log('PAGEERR', e.message.slice(0, 300)));
await p.goto('http://127.0.0.1:5173/?capture=1&pr=2', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => !!window.__DESCENT__?.game?.capture, null, { timeout: 240000 });
await p.evaluate(() => {
  const g = window.__DESCENT__.game;
  g.capture.takeControl();
  g.capture.setPose('valley-vista');
  for (let i = 0; i < 14; i++) g.capture.step(1 / 60);
});
// Native 2100..2600 x, 700..1000 y  ->  CSS 1050..1300, 350..500
const CLIP = { x: 1050, y: 350, width: 250, height: 150 };
const shoot = async (n) => {
  await p.evaluate(() => window.__DESCENT__.game.capture.step(1e-6));
  await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
  await p.screenshot({ path: `captures/_lattice/${n}.png`, clip: CLIP, animations: 'disabled' });
  console.log('ok', n);
};
await shoot('base');
for (const v of ['lines-id', 'lines-normal', 'lines-depth', 'lines', 'ink']) {
  await p.evaluate((vv) => window.__DESCENT__.game.post.setDebugView(vv), v);
  await shoot(v.replace(/-/g, '_'));
}
await p.evaluate(() => window.__DESCENT__.game.post.setDebugView('off'));
// Foliage / scatter off.
await p.evaluate(() => {
  window.__DESCENT__.engine.scene.traverse((o) => {
    const n = (o.name || '').toLowerCase();
    if (n.includes('foliage') || n.includes('scatter') || n.includes('rock') || n.includes('boulder')) o.visible = false;
  });
});
await shoot('noScatter');
await b.close();
