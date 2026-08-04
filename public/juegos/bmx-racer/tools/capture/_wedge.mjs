/**
 * _wedge.mjs — where do the pale radial wedges live? Dump the raw HDR scene
 * target (no bloom, no ink, no speed lines, no grade) as a PNG, and also a
 * bloom-only view, so the wedges can be attributed to a stage.
 *
 * node tools/capture/_wedge.mjs <pose>
 */
import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { mkdirSync } from 'node:fs';

const OUT = path.resolve('tools/capture/_out');
mkdirSync(OUT, { recursive: true });
const pose = process.argv[2] ?? 'treeline-silhouette';

const b = await chromium.launch({
  args: ['--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--force-color-profile=srgb'],
});
const c = await b.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
const p = await c.newPage();
p.on('pageerror', (e) => console.log('  [ex]', e.message));
await p.goto('http://127.0.0.1:5173/?capture=1&pr=1', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => !!window.__DESCENT__?.game?.capture, null, { timeout: 240000 });
await p.evaluate(() => window.__DESCENT__.game.capture.takeControl());
await p.evaluate((x) => window.__DESCENT__.game.capture.setPose(x), pose);
for (let i = 0; i < 12; i++) await p.evaluate(() => window.__DESCENT__.game.capture.step(1 / 60));

const out = await p.evaluate(() => {
  const g = window.__DESCENT__.game;
  const r = window.__DESCENT__.engine.renderer;
  const rt = g.post.hdr;
  const buf = new Float32Array(rt.width * rt.height * 4);
  let ok = true;
  try { r.readRenderTargetPixels(rt, 0, 0, rt.width, rt.height, buf); } catch (e) { ok = false; }
  const cv = document.createElement('canvas');
  cv.width = rt.width; cv.height = rt.height;
  const c2 = cv.getContext('2d');
  const im = c2.createImageData(rt.width, rt.height);
  const enc = (v) => {
    v = Math.max(0, Math.min(1, v));
    return Math.round(255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055));
  };
  for (let y = 0; y < rt.height; y++) {
    for (let x = 0; x < rt.width; x++) {
      const s = ((rt.height - 1 - y) * rt.width + x) * 4;
      const d = (y * rt.width + x) * 4;
      im.data[d] = enc(buf[s]); im.data[d + 1] = enc(buf[s + 1]); im.data[d + 2] = enc(buf[s + 2]);
      im.data[d + 3] = 255;
    }
  }
  c2.putImageData(im, 0, 0);
  return { ok, w: rt.width, h: rt.height, png: cv.toDataURL('image/png').split(',')[1] };
});
await writeFile(path.join(OUT, `hdr-${pose}.png`), Buffer.from(out.png, 'base64'));
console.log('hdr', out.ok, out.w + 'x' + out.h, '->', `tools/capture/_out/hdr-${pose}.png`);

// Bloom-only
await p.evaluate(() => { window.__DESCENT__.game.post.setDebugView('bloom'); });
await p.evaluate(() => window.__DESCENT__.game.capture.step(1 / 60));
await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
await p.screenshot({ path: path.join(OUT, `bloomonly-${pose}.png`) });
await p.evaluate(() => { window.__DESCENT__.game.post.setDebugView('off'); });
console.log('wrote bloom-only');
await c.close();
await b.close();
