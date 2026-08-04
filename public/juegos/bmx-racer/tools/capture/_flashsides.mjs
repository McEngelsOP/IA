/**
 * _flashsides.mjs — IS THE IMPACT FLASH ONE-SIDED?
 *
 * A motion critic read the crash accent as "a directional wash brightening only
 * the LEFT HALF of frame". That is a claim about the spatial distribution of one
 * operator, and it cannot be settled by diffing two consecutive captured frames
 * — those differ by a frame of motion as well as by the accent.
 *
 * So: same frame, same scene, rendered twice, with the composite's flash uniform
 * forced off and then on. Everything else is byte-identical, so the difference
 * IS the accent. Reported per screen quadrant and per half.
 *
 *   node tools/capture/_flashsides.mjs <pose|seq:name> [flash] [frames]
 */
import { chromium } from 'playwright';
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { readPng } from './_pngread.mjs';

const OUT = path.resolve('tools/capture/_out');
mkdirSync(OUT, { recursive: true });
const TARGET = process.argv[2] ?? 'crash';
const F = Number(process.argv[3] ?? 0.2023);
const FRAMES = Number(process.argv[4] ?? 12);

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
if (TARGET.startsWith('seq:')) {
  await p.evaluate((x) => window.__DESCENT__.game.capture.setSequence(x), TARGET.slice(4));
} else {
  await p.evaluate((x) => window.__DESCENT__.game.capture.setPose(x), TARGET);
}
for (let i = 0; i < FRAMES; i++) await p.evaluate(() => window.__DESCENT__.game.capture.step(1 / 60));

for (const [name, ov] of [['off', { uImpactFlash: 0 }], ['on', { uImpactFlash: F }]]) {
  await p.evaluate((o) => {
    window.__OV__ = o;
    const g = window.__DESCENT__.game;
    g.post.render(g.engine.scene, g.engine.camera, 1 / 60, performance.now() / 1000);
    g.hud.render(g.engine.renderer);
    window.__OV__ = {};
  }, ov);
  await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
  await p.screenshot({ path: path.join(OUT, `flashside-${name}.png`), animations: 'disabled' });
}
await c.close();
await b.close();

const A = readPng(path.join(OUT, 'flashside-off.png'));
const B = readPng(path.join(OUT, 'flashside-on.png'));
const cells = 4;
const sum = new Float64Array(cells * cells);
const abs = new Float64Array(cells * cells);
const cnt = new Float64Array(cells * cells);
const luma = (d, i) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
for (let y = 0; y < A.height; y += 2) {
  const cy = Math.min(cells - 1, Math.floor((y / A.height) * cells));
  for (let x = 0; x < A.width; x += 2) {
    const cx = Math.min(cells - 1, Math.floor((x / A.width) * cells));
    const i = (y * A.width + x) * A.channels;
    const d = luma(B.data, i) - luma(A.data, i);
    const k = cy * cells + cx;
    sum[k] += d; abs[k] += Math.abs(d); cnt[k]++;
  }
}
console.log(`${TARGET}  flash ${F}   signed mean luma delta per cell (4x4), 0-255`);
for (let r = 0; r < cells; r++) {
  const row = [];
  for (let cx = 0; cx < cells; cx++) {
    const k = r * cells + cx;
    row.push(`${(sum[k] / cnt[k]).toFixed(2).padStart(6)}`);
  }
  console.log('  ' + row.join(''));
}
const half = (from, to, vert) => {
  let s = 0, a = 0, n = 0;
  for (let r = 0; r < cells; r++) for (let cx = 0; cx < cells; cx++) {
    const idx = vert ? cx : r;
    if (idx < from || idx >= to) continue;
    const k = r * cells + cx;
    s += sum[k]; a += abs[k]; n += cnt[k];
  }
  return { mean: s / n, abs: a / n };
};
const L = half(0, 2, true), R = half(2, 4, true), T = half(0, 2, false), Bo = half(2, 4, false);
console.log(`  left  mean ${L.mean.toFixed(2)}  |d| ${L.abs.toFixed(2)}`);
console.log(`  right mean ${R.mean.toFixed(2)}  |d| ${R.abs.toFixed(2)}`);
console.log(`  top   mean ${T.mean.toFixed(2)}  |d| ${T.abs.toFixed(2)}`);
console.log(`  bot   mean ${Bo.mean.toFixed(2)}  |d| ${Bo.abs.toFixed(2)}`);
console.log(`  L/R |d| ratio ${(L.abs / Math.max(R.abs, 1e-6)).toFixed(2)}`);
