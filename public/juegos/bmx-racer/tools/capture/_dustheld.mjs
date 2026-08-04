/**
 * _dustheld.mjs — does the bike portrait survive dust ACCUMULATION?
 *
 * The shipped still is shot 12 frames after the pose cut, which is barely
 * enough time for the emitter to fill. A portrait that is legible at 12 frames
 * and buried at 120 is not fixed, it is early. Shoots the same pose at several
 * settle depths and measures the subject each time.
 */
import { chromium } from 'playwright';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const args = {};
for (let i = 0; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (!a.startsWith('--')) continue;
  const n = process.argv[i + 1];
  args[a.slice(2)] = n && !n.startsWith('--') ? n : true;
}
const OUT = path.resolve('captures/dustheld');
await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader', '--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist'] });
const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
const page = await context.newPage();
page.on('pageerror', (e) => console.log('  [page:exception]', e.message));
await page.goto('http://127.0.0.1:5173/?capture=1&pr=2', { waitUntil: 'domcontentloaded', timeout: 60_000 });
await page.waitForFunction(() => !!window.__DESCENT__?.game?.capture, null, { timeout: 240_000 });
await page.evaluate(() => window.__DESCENT__.game.capture.takeControl());

for (const pose of String(args.pose ?? 'bike-detail,rider-closeup').split(',')) {
  for (const settle of [12, 45, 90, 150]) {
    await page.evaluate((p) => window.__DESCENT__.game.capture.setPose(p), pose);
    await page.evaluate((n) => { for (let i = 0; i < n; i++) window.__DESCENT__.game.capture.step(1 / 60); }, settle);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
    const f = path.join(OUT, `${pose}-${settle}.png`);
    await page.screenshot({ path: f, animations: 'disabled' });
    console.log(`  ${pose} settle=${settle} → ${f}`);
  }
}
await browser.close();
