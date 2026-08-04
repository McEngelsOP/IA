/** _hudpopups.mjs — push a realistic overlapping popup stack and shoot it. */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const URL = process.env.DURL ?? 'http://127.0.0.1:5173';
await mkdir('captures/hud3', { recursive: true });
const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist'],
});
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('  [exception]', e.message));
await page.goto(`${URL}/?capture=1&pr=2`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => !!window.__DESCENT__?.game?.capture, null, { timeout: 180000 });
await page.evaluate(() => window.__DESCENT__.game.capture.takeControl());

await page.evaluate(() => {
  const g = window.__DESCENT__.game;
  const pw = g.hud.popups;
  const orig = Object.getPrototypeOf(pw).update;
  let queued = false;
  pw.update = function (m, dt, t) {
    if (!queued) {
      queued = true;
      // Three popups landing within a few frames of each other, which is what
      // a trick landed across a checkpoint actually produces.
      m.popups.push({ text: 'SPLIT', value: -1.34, kind: 'split' });
      m.popups.push({ text: 'TABLETOP', value: 450, kind: 'trick' });
      m.popups.push({ text: 'COMBO X3', value: 900, kind: 'combo' });
    }
    m.trickScore = 1350;
    m.activeTrick = 'BARSPIN';
    return orig.call(this, m, dt, t);
  };
  g.capture.setPose('tabletop-air');
  for (let i = 0; i < 14; i++) g.capture.step(1 / 60);
});
await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
await page.screenshot({ path: 'captures/hud3/popups.png', animations: 'disabled' });
console.log('  ✓ captures/hud3/popups.png');
await browser.close();
