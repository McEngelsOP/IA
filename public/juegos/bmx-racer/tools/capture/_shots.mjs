/** _shots.mjs — throwaway. Grabs a few named frames fast, retrying on HMR. */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const seq = process.argv[2];
const wanted = process.argv.slice(3).map(Number);
const OUT = path.resolve('captures/_shots');
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist'],
});
const page = await (await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 })).newPage();

for (let attempt = 0; attempt < 6; attempt++) {
  try {
    await page.goto('http://127.0.0.1:5173/?capture=1&pr=2', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(() => !!window.__DESCENT__?.game?.capture, null, { timeout: 240000 });
    await page.evaluate(() => window.__DESCENT__.game.capture.takeControl());
    await page.evaluate((n) => window.__DESCENT__.game.capture.setSequence(n), seq);
    await page.evaluate(() => { for (let i = 0; i < 4; i++) window.__DESCENT__.game.capture.step(1 / 60); });
    let f = 0;
    for (const target of wanted) {
      await page.evaluate((n) => { for (let i = 0; i < n; i++) window.__DESCENT__.game.capture.step(1 / 60); }, target - f);
      f = target;
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
      await page.screenshot({ path: path.join(OUT, `${seq}-f${String(target).padStart(4, '0')}.png`), animations: 'disabled' });
    }
    console.log('ok', seq, wanted.join(','));
    break;
  } catch (e) {
    console.log('retry:', String(e.message).split('\n')[0]);
  }
}
await browser.close();
