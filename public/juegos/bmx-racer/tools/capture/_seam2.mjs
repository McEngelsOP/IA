/**
 * Second seam probe: wide crop, ink channel, and the ribbon alone.
 *   node tools/capture/_seam2.mjs
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
await mkdir('captures/_seam2', { recursive: true });

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
  g.capture.setPose('rider-closeup');
  for (let i = 0; i < 14; i++) g.capture.step(1 / 60);
});
const CLIP = { x: 0, y: 640, width: 1600, height: 200 };
const shoot = async (n) => {
  await p.evaluate(() => window.__DESCENT__.game.capture.step(1e-6));
  await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
  await p.screenshot({ path: `captures/_seam2/${n}.png`, clip: CLIP, animations: 'disabled' });
  console.log('ok', n);
};
await shoot('base');
await p.evaluate(() => window.__DESCENT__.game.post.setDebugView('ink'));
await shoot('ink');
await p.evaluate(() => window.__DESCENT__.game.post.setDebugView('lines-id'));
await shoot('id');
await p.evaluate(() => window.__DESCENT__.game.post.setDebugView('lines-depth'));
await shoot('depth');
await p.evaluate(() => {
  window.__DESCENT__.game.post.setDebugView('off');
  window.__DESCENT__.game.track.object.visible = false;
});
await shoot('noTrack');
// Ribbon only: hide the terrain instead.
await p.evaluate(() => {
  window.__DESCENT__.game.track.object.visible = true;
  window.__DESCENT__.game.terrain.object.visible = false;
});
await shoot('ribbonOnly');
await b.close();
