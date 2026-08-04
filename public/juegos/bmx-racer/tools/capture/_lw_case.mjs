/**
 * Throwaway probe (line-work agent): ONE session, ONE pose, one settled frame,
 * captured through every attribution channel — so every image compared is the
 * same framing. Poses are not independent of what ran before them (the camera
 * director springs, the scatter pool streams in), so cross-session comparison
 * of a pose is comparing two different pictures.
 *
 *   node tools/capture/_lw_case.mjs <pose> <outdir> <tag> [settleFrames] [url]
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const pose = process.argv[2] ?? 'summit-rider';
const outdir = path.resolve(process.argv[3] ?? 'captures/lw');
const tag = process.argv[4] ?? 'x';
const SETTLE = Number(process.argv[5] ?? 60);
const URL_BASE = process.argv[6] ?? 'http://127.0.0.1:5173';
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
// Settle, then FREEZE: every subsequent capture steps dt = 0 so the simulation
// cannot advance between channels.
await page.evaluate((n) => { for (let i = 0; i < n; i++) window.__DESCENT__.game.capture.step(1 / 60); }, SETTLE);

async function shot(name) {
  await page.evaluate(() => window.__DESCENT__.game.capture.step(0));
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
  const out = path.join(outdir, `${pose}.${name}.${tag}.png`);
  await page.screenshot({ path: out, animations: 'disabled' });
  console.log('  ✓', out);
}

for (const view of ['off', 'lines', 'lines-normal', 'lines-depth', 'lines-id', 'lines-hull', 'curvature']) {
  await page.evaluate((v) => window.__DESCENT__.game.capture.setDebugView(v), view);
  await shot(view);
}
await page.evaluate(() => window.__DESCENT__.game.capture.setDebugView('off'));

// Ink off entirely — the frame with no interior line field at all.
await page.evaluate(() => {
  const l = window.__DESCENT__.game.post.lines;
  l.uniforms.uStrength.value = 0;
  l.uniforms.uContourStrength.value = 0;
});
await shot('noink');
await page.evaluate(() => {
  const l = window.__DESCENT__.game.post.lines;
  l.uniforms.uStrength.value = 0.86;
  l.uniforms.uContourStrength.value = 0.98;
});

// Hulls off.
await page.evaluate(() => {
  window.__DESCENT__.engine.scene.traverse((o) => { if (o.userData?.isHull) o.visible = false; });
});
await shot('nohull');
await page.evaluate(() => {
  window.__DESCENT__.engine.scene.traverse((o) => { if (o.userData?.isHull) o.visible = true; });
});

await ctx.close();
await browser.close();
