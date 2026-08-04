/** _hudpopstress.mjs — worst-case popup column: six bars at once, a positive
 *  split, and a five-figure score caught at full punch. */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const CASES = {
  six: {
    push: [
      ['SPLIT', 1.42, 'split'], ['TABLETOP', 450, 'trick'], ['COMBO X3', 900, 'combo'],
      ['WHIP', 300, 'trick'], ['CUT THE LINE', 0, 'warning'], ['SUPERMAN', 750, 'trick'],
    ],
    score: 18400, trick: 'TAILWHIP', frames: 14,
  },
  splitonly: { push: [['SPLIT', 1.42, 'split']], score: 0, trick: null, frames: 14 },
  punch: { push: [['SPLIT', -0.08, 'split']], score: 18400, trick: 'SUPERMAN SEATGRAB', frames: 3 },
};

await mkdir('captures/hud3', { recursive: true });
const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist'],
});
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('  [exception]', e.message));
await page.goto('http://127.0.0.1:5173/?capture=1&pr=2', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => !!window.__DESCENT__?.game?.capture, null, { timeout: 180000 });
await page.evaluate(() => window.__DESCENT__.game.capture.takeControl());

for (const [name, c] of Object.entries(CASES)) {
  await page.evaluate((c) => {
    const g = window.__DESCENT__.game;
    const pw = g.hud.popups;
    pw.clear();
    const proto = Object.getPrototypeOf(pw).update;
    let queued = false;
    pw.update = function (m, dt, t) {
      if (!queued) {
        queued = true;
        for (const [text, value, kind] of c.push) m.popups.push({ text, value, kind });
      }
      m.trickScore = c.score;
      m.activeTrick = c.trick;
      return proto.call(this, m, dt, t);
    };
    g.capture.setPose('tabletop-air');
    for (let i = 0; i < c.frames; i++) g.capture.step(1 / 60);
  }, c);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
  await page.screenshot({ path: `captures/hud3/pop-${name}.png`, animations: 'disabled' });
  console.log(`  ✓ captures/hud3/pop-${name}.png`);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.__DESCENT__?.game?.capture, null, { timeout: 180000 });
  await page.evaluate(() => window.__DESCENT__.game.capture.takeControl());
}
await browser.close();
