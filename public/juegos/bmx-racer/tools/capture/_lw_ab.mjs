/**
 * Throwaway probe (line-work agent): A/B the new interior-line rules against
 * the old ones in ONE session, on ONE settled frame, so the two images differ
 * by the rule and by nothing else.
 *
 *   A = "before": paint gating off, pen pressure pinned to the old constant
 *   B = "after" : shipped settings
 *
 *   node tools/capture/_lw_ab.mjs <pose> <outdir> [settle] [url]
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const pose = process.argv[2] ?? 'treeline-silhouette';
const outdir = path.resolve(process.argv[3] ?? 'captures/lw2');
const SETTLE = Number(process.argv[4] ?? 60);
const URL_BASE = process.argv[5] ?? 'http://127.0.0.1:5173';
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
await page.evaluate((n) => { for (let i = 0; i < n; i++) window.__DESCENT__.game.capture.step(1 / 60); }, SETTLE);

async function shot(name) {
  await page.evaluate(() => window.__DESCENT__.game.capture.step(0));
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
  const out = path.join(outdir, `${pose}.${name}.png`);
  await page.screenshot({ path: out, animations: 'disabled' });
  console.log('  ✓', out);
}

const setMode = (mode) => page.evaluate((m) => {
  const u = window.__DESCENT__.game.post.lines.uniforms;
  if (m === 'before') {
    u.uPaintMask.value = 0;          // no paint gating at all
    u.uPressure.value.set(0.95, 0.95);  // the old flat mix(0.82,1.0,weight)
  } else {
    u.uPaintMask.value = 254;
    u.uPressure.value.set(0.45, 1.05);
  }
}, mode);

const setView = (v) => page.evaluate((n) => window.__DESCENT__.game.post.lines.setDebug(n), v);

for (const mode of ['before', 'after']) {
  await setMode(mode);
  for (const [name, dbg] of [['off', 0], ['lines', 1], ['depth', 3], ['id', 4]]) {
    await setView(dbg);
    await shot(`${mode}.${name}`);
  }
  await setView(0);
}
await ctx.close();
await browser.close();
