/**
 * Throwaway probe: render a pose with the LinesPass debug channel forced on.
 *   node tools/capture/_lines.mjs <pose> <mode 0-6> <out.png>
 */
import { chromium } from 'playwright';

const [, , pose, modeS, out] = process.argv;
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:5173/?capture=1&pr=2', { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__DESCENT__?.game?.capture, null, { timeout: 240000 });
await page.evaluate(() => window.__DESCENT__.game.capture.takeControl());
await page.evaluate((p) => window.__DESCENT__.game.capture.setPose(p), pose);
const ok = await page.evaluate((m) => {
  const p = window.__DESCENT__.game.post;
  if (!p || !p.lines) return 'no lines: ' + Object.keys(window.__DESCENT__.game.post ?? {}).join(',');
  p.lines.setDebug(m);
  return 'ok';
}, Number(modeS));
console.log(ok);
await page.evaluate(() => { for (let i = 0; i < 12; i++) window.__DESCENT__.game.capture.step(1 / 60); });
await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
await page.screenshot({ path: out, animations: 'disabled' });
console.log('wrote', out);
await browser.close();
