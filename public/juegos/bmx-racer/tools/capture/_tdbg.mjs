/**
 * Throwaway probe: capture a pose several times with individual TERRAIN shader
 * terms switched off through uniforms that already exist, so the source of an
 * aliasing artefact can be BISECTED instead of guessed at.
 *
 *   node tools/capture/_tdbg.mjs <pose> <outdir>
 *
 * Variants: base, nohatch (uHatchGlobal=0), nodetail (uDetailScale=0),
 *           nojitter (uZoneJitter=0), flatzone (uZoneJitter=0 + no snap via
 *           a huge jitter is not possible, so jitter only).
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const pose = process.argv[2] ?? 'summit-rider';
const outdir = path.resolve(process.argv[3] ?? 'captures/dbg');
const URL_BASE = process.argv[4] ?? 'http://127.0.0.1:5174';
await mkdir(outdir, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist', '--force-color-profile=srgb'],
});
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('  [exc]', e.message));
await page.goto(`${URL_BASE}/?capture=1&pr=2`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => !!window.__DESCENT__?.game?.capture, null, { timeout: 180000 });
await page.evaluate(() => window.__DESCENT__.game.capture.takeControl());

// Collect the terrain material once and stash the pristine uniform values.
await page.evaluate(() => {
  const mats = [];
  window.__DESCENT__.game.terrain.object.traverse((o) => {
    if (o.material && !mats.includes(o.material)) mats.push(o.material);
  });
  window.__T = mats;
  window.__SAVE = mats.map((m) => ({
    hatch: m.uniforms?.uHatchGlobal?.value,
    detail: m.uniforms?.uDetailScale?.value,
    jit: m.uniforms?.uZoneJitter?.value,
  }));
  return mats.map((m) => m.name);
}).then((n) => console.log('terrain materials:', n));

const variants = [
  ['base', {}],
  ['nohatch', { uHatchGlobal: 0 }],
  ['nodetail', { uDetailScale: 0 }],
  ['nojitter', { uZoneJitter: 0 }],
  ['bigjitter', { uZoneJitter: 0.02 }],
];

for (const [name, over] of variants) {
  await page.evaluate((o) => {
    window.__T.forEach((m, i) => {
      const s = window.__SAVE[i];
      if (!m.uniforms) return;
      if (m.uniforms.uHatchGlobal) m.uniforms.uHatchGlobal.value = s.hatch;
      if (m.uniforms.uDetailScale) m.uniforms.uDetailScale.value = s.detail;
      if (m.uniforms.uZoneJitter) m.uniforms.uZoneJitter.value = s.jit;
      for (const k of Object.keys(o)) if (m.uniforms[k]) m.uniforms[k].value = o[k];
    });
  }, over);
  await page.evaluate((p) => window.__DESCENT__.game.capture.setPose(p), pose);
  await page.evaluate(() => { for (let i = 0; i < 12; i++) window.__DESCENT__.game.capture.step(1 / 60); });
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
  const out = path.join(outdir, `${pose}.${name}.png`);
  await page.screenshot({ path: out, animations: 'disabled' });
  console.log('  ✓', out);
}

await ctx.close();
await browser.close();
