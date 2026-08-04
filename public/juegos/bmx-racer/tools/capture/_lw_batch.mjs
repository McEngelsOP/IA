/**
 * Throwaway probe (line-work agent): capture N poses through M line-pass debug
 * views in ONE browser session.
 *
 *   node tools/capture/_lw_batch.mjs <poses,csv> <views,csv> <outdir> [url] [tag]
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const poses = (process.argv[2] ?? 'rockgarden-low').split(',');
const views = (process.argv[3] ?? 'off,lines,lines-normal,lines-depth,lines-id,curvature').split(',');
const outdir = path.resolve(process.argv[4] ?? 'captures/lw');
const URL_BASE = process.argv[5] ?? 'http://127.0.0.1:5173';
const TAG = process.argv[6] ?? '';
await mkdir(outdir, { recursive: true });

const browser = await chromium.launch({
  args: ['--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist', '--force-color-profile=srgb'],
});
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('[exc]', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('[err]', m.text()); });
await page.goto(`${URL_BASE}/?capture=1&pr=2`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => !!window.__DESCENT__?.game?.capture, null, { timeout: 180000 });
await page.evaluate(() => window.__DESCENT__.game.capture.takeControl());

for (const pose of poses) {
  const ok = await page.evaluate((p) => window.__DESCENT__.game.capture.setPose(p), pose);
  if (!ok) { console.log('  ✗ unknown pose', pose); continue; }
  await page.evaluate(() => { for (let i = 0; i < 12; i++) window.__DESCENT__.game.capture.step(1 / 60); });
  for (const view of views) {
    await page.evaluate((v) => window.__DESCENT__.game.capture.setDebugView(v), view);
    await page.evaluate(() => { for (let i = 0; i < 2; i++) window.__DESCENT__.game.capture.step(1 / 60); });
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
    const out = path.join(outdir, `${pose}.${view}${TAG ? '.' + TAG : ''}.png`);
    await page.screenshot({ path: out, animations: 'disabled' });
    console.log('  ✓', out);
  }
  await page.evaluate(() => window.__DESCENT__.game.capture.setDebugView('off'));
}
await ctx.close();
await browser.close();
