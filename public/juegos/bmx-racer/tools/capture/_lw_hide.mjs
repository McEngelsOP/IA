/**
 * Throwaway probe (line-work agent): list the scene, and capture a pose with
 * selected objects hidden, to attribute a stray mark to the mesh that drew it.
 *
 *   node tools/capture/_lw_hide.mjs <pose> <regex|-> <out.png> [url]
 * regex '-' means: only dump the scene listing.
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const pose = process.argv[2] ?? 'treeline-silhouette';
const rx = process.argv[3] ?? '-';
const out = path.resolve(process.argv[4] ?? 'captures/lw/hide.png');
const URL_BASE = process.argv[5] ?? 'http://127.0.0.1:5173';
await mkdir(path.dirname(out), { recursive: true });

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
await page.evaluate(() => { for (let i = 0; i < 12; i++) window.__DESCENT__.game.capture.step(1 / 60); });

const listing = await page.evaluate(() => {
  const rows = [];
  window.__DESCENT__.engine.scene.traverse((o) => {
    if (!o.isMesh && !o.isInstancedMesh && !o.isSkinnedMesh) return;
    rows.push([
      o.name || '(anon)',
      o.isInstancedMesh ? `inst x${o.count}` : o.type,
      o.material?.name ?? '?',
      o.renderOrder,
      o.visible ? 'vis' : 'hid',
    ].join(' | '));
  });
  return rows;
});
console.log(listing.join('\n'));

if (rx !== '-') {
  // A BEFORE frame from the same session. Poses are not fully independent of
  // what ran before them (the camera director springs), so comparing against a
  // capture taken in another session compares two different framings.
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
  await page.screenshot({ path: out.replace(/\.png$/, '.before.png'), animations: 'disabled' });
  const n = await page.evaluate((r) => {
    const re = new RegExp(r, 'i');
    let n = 0;
    window.__DESCENT__.engine.scene.traverse((o) => {
      if (!(o.isMesh || o.isInstancedMesh || o.isSkinnedMesh)) return;
      if (re.test(o.name || '') || re.test(o.material?.name || '')) { o.visible = false; n++; }
    });
    return n;
  }, rx);
  console.log(`hid ${n} objects matching /${rx}/i`);
  await page.evaluate(() => { for (let i = 0; i < 2; i++) window.__DESCENT__.game.capture.step(1 / 60); });
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
  await page.screenshot({ path: out, animations: 'disabled' });
  console.log('wrote', out);
}
await ctx.close();
await browser.close();
