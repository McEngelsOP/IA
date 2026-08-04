/**
 * _impactmax.mjs — the worst case the impact accent can produce, measured.
 *
 * The captured sequences only ever ask for 3-5% flash, so they cannot answer
 * the question "does the accent delete the picture". This forces the dials to
 * the ceilings IMPACT_TUNING can publish (flash 0.34, desaturate 0.16, ink
 * flood 0.30) on a chosen pose and reports, against the same frame with the
 * dials at zero:
 *
 *   MEAN CHROMA   average distance from grey. A wash takes this down.
 *   SKY CHROMA    the same over the top fifth of the frame — the blue band the
 *                 critic said disappears.
 *   LUMA SPREAD   standard deviation of luma. A wash collapses it; a held
 *                 high-contrast drawing widens it.
 *
 * node tools/capture/_impactmax.mjs <pose> [flash] [desat] [flood]
 */
import { chromium } from 'playwright';
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { readPng } from './_pngread.mjs';

const OUT = path.resolve('tools/capture/_out');
mkdirSync(OUT, { recursive: true });
const pose = process.argv[2] ?? 'crash';
const F = Number(process.argv[3] ?? 0.34);
const D = Number(process.argv[4] ?? 0.16);
const K = Number(process.argv[5] ?? 0.30);

const b = await chromium.launch({
  args: ['--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--force-color-profile=srgb'],
});
const c = await b.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
const p = await c.newPage();
p.on('pageerror', (e) => console.log('  [ex]', e.message));
await p.goto('http://127.0.0.1:5173/?capture=1&pr=2', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => !!window.__DESCENT__?.game?.capture, null, { timeout: 240000 });
await p.evaluate(() => {
  const cp = window.__DESCENT__.game.post.composite;
  const orig = cp.syncState.bind(cp);
  window.__OV__ = {};
  cp.syncState = (t) => { orig(t); for (const k in window.__OV__) cp.uniforms[k].value = window.__OV__[k]; };
  window.__DESCENT__.game.capture.takeControl();
});
await p.evaluate((x) => window.__DESCENT__.game.capture.setPose(x), pose);
for (let i = 0; i < 12; i++) await p.evaluate(() => window.__DESCENT__.game.capture.step(1 / 60));

for (const [name, ov] of [
  ['off', { uImpactFlash: 0, uDesaturate: 0, uInkFlood: 0 }],
  ['peak', { uImpactFlash: F, uDesaturate: D, uInkFlood: K }],
]) {
  await p.evaluate((o) => {
    window.__OV__ = o;
    const g = window.__DESCENT__.game;
    g.post.render(g.engine.scene, g.engine.camera, 1 / 60, performance.now() / 1000);
    g.hud.render(g.engine.renderer);
    window.__OV__ = {};
  }, ov);
  await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
  await p.screenshot({ path: path.join(OUT, `impmax-${pose}-${name}.png`), animations: 'disabled' });
}
await c.close();
await b.close();

const stats = (f) => {
  const img = readPng(f);
  let ch = 0, l = 0, l2 = 0, n = 0, sch = 0, sn = 0;
  const skyBot = Math.floor(img.height * 0.20);
  for (let y = 0; y < img.height; y += 5) {
    for (let x = 0; x < img.width; x += 5) {
      const i = (y * img.width + x) * img.channels;
      const r = img.data[i], g = img.data[i + 1], bb = img.data[i + 2];
      const cc = Math.max(r, g, bb) - Math.min(r, g, bb);
      const lu = 0.2126 * r + 0.7152 * g + 0.0722 * bb;
      ch += cc; l += lu; l2 += lu * lu; n++;
      if (y < skyBot) { sch += cc; sn++; }
    }
  }
  const m = l / n;
  return { chroma: ch / n, sky: sch / sn, lum: m, sd: Math.sqrt(Math.max(0, l2 / n - m * m)) };
};
const a = stats(path.join(OUT, `impmax-${pose}-off.png`));
const z = stats(path.join(OUT, `impmax-${pose}-peak.png`));
const pc = (x, y) => `${(100 * (y - x) / Math.max(x, 1e-6)).toFixed(1)}%`;
console.log(`${pose}  flash ${F} desat ${D} flood ${K}`);
console.log(`  mean chroma  ${a.chroma.toFixed(1)} -> ${z.chroma.toFixed(1)}   ${pc(a.chroma, z.chroma)}`);
console.log(`  sky chroma   ${a.sky.toFixed(1)} -> ${z.sky.toFixed(1)}   ${pc(a.sky, z.sky)}`);
console.log(`  mean luma    ${a.lum.toFixed(1)} -> ${z.lum.toFixed(1)}   ${pc(a.lum, z.lum)}`);
console.log(`  luma spread  ${a.sd.toFixed(1)} -> ${z.sd.toFixed(1)}   ${pc(a.sd, z.sd)}`);
