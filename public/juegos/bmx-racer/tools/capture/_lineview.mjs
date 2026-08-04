/**
 * Throwaway probe: capture one pose through each of the line-pass debug views,
 * to attribute a stray mark on the terrain to the channel that drew it.
 *
 *   node tools/capture/_lineview.mjs <pose> <outdir> [url]
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const pose = process.argv[2] ?? 'summit-rider';
const outdir = path.resolve(process.argv[3] ?? 'captures/lines');
const URL_BASE = process.argv[4] ?? 'http://127.0.0.1:5174';
await mkdir(outdir, { recursive: true });

const browser = await chromium.launch({
  args: ['--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist', '--force-color-profile=srgb'],
});
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('[exc]', e.message));
await page.goto(`${URL_BASE}/?capture=1&pr=2`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => !!window.__DESCENT__?.game?.capture, null, { timeout: 180000 });
await page.evaluate(() => window.__DESCENT__.game.capture.takeControl());
await page.evaluate((p) => window.__DESCENT__.game.capture.setPose(p), pose);

for (const view of ['off', 'lines', 'lines-normal', 'lines-depth', 'lines-id', 'curvature']) {
  await page.evaluate((v) => window.__DESCENT__.game.capture.setDebugView(v), view);
  await page.evaluate(() => { for (let i = 0; i < 8; i++) window.__DESCENT__.game.capture.step(1 / 60); });
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
  const out = path.join(outdir, `${pose}.${view}.png`);
  await page.screenshot({ path: out, animations: 'disabled' });
  console.log('  ✓', out);
}
await page.evaluate(() => window.__DESCENT__.game.capture.setDebugView('off'));
await ctx.close();
await browser.close();
