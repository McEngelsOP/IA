/** Third seam probe: ribbon vs furniture, and a numeric column through the line. */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
await mkdir('captures/_seam3', { recursive: true });

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
const CLIP = { x: 700, y: 690, width: 500, height: 110 };
const shoot = async (n) => {
  await p.evaluate(() => window.__DESCENT__.game.capture.step(1e-6));
  await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
  await p.screenshot({ path: `captures/_seam3/${n}.png`, clip: CLIP, animations: 'disabled' });
  console.log('ok', n);
};
await shoot('base');
await p.evaluate(() => { window.__DESCENT__.game.track.ribbon.object.visible = false; });
await shoot('noRibbon');
await p.evaluate(() => {
  window.__DESCENT__.game.track.ribbon.object.visible = true;
  window.__DESCENT__.game.track.furniture.object.visible = false;
});
await shoot('noFurniture');
await p.evaluate(() => { window.__DESCENT__.game.track.furniture.object.visible = true; });
// Shadows off.
await p.evaluate(() => {
  const s = window.__DESCENT__.game.post.shadows;
  if (s) s.enabled = false;
  window.__DESCENT__.engine.scene.traverse((o) => { if (o.isMesh) o.castShadow = false; });
});
await shoot('noCast');
await b.close();
