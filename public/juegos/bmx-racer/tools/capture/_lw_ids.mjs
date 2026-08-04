/**
 * Throwaway probe (line-work agent): read the G-buffer AUX attachment and
 * report which MATERIAL IDs actually occupy a region of the frame, with a
 * legend built from the live materials — so an id line can be attributed to
 * the specific pair of surfaces that produced it rather than guessed at.
 *
 *   node tools/capture/_lw_ids.mjs <pose> <x> <y> <w> <h> [out.png] [url]
 */
import { chromium } from 'playwright';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const pose = process.argv[2] ?? 'valley-vista';
const X = Number(process.argv[3] ?? 0);
const Y = Number(process.argv[4] ?? 0);
const W = Number(process.argv[5] ?? 3200);
const H = Number(process.argv[6] ?? 1800);
const out = process.argv[7] ? path.resolve(process.argv[7]) : null;
const URL_BASE = process.argv[8] ?? 'http://127.0.0.1:5173';

const browser = await chromium.launch({
  args: ['--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist', '--force-color-profile=srgb'],
});
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('[exc]', e.message));
await page.goto(`${URL_BASE}/?capture=1&pr=2`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => !!window.__DESCENT__?.game?.capture, null, { timeout: 180000 });

const res = await page.evaluate(async ({ pose, X, Y, W, H }) => {
  const g = window.__DESCENT__.game;
  const renderer = window.__DESCENT__.engine.renderer;
  g.capture.takeControl();
  g.capture.setPose(pose);
  for (let i = 0; i < 60; i++) g.capture.step(1 / 60);

  // Legend: every live material that declares an id.
  const legend = {};
  const seen = new Set();
  window.__DESCENT__.engine.scene.traverse((o) => {
    const mats = [];
    if (o.material) mats.push(...(Array.isArray(o.material) ? o.material : [o.material]));
    if (o.userData?.prepassMaterial) mats.push(o.userData.prepassMaterial);
    for (const m of mats) {
      if (!m || seen.has(m.uuid)) continue;
      seen.add(m.uuid);
      const u = m.uniforms;
      if (!u) continue;
      if (u.uMaterialId) legend[u.uMaterialId.value] = (legend[u.uMaterialId.value] ?? m.name ?? o.name);
      if (u.uZoneIds) {
        const arr = u.uZoneIds.value;
        const names = ['rock', 'dirt', 'grass', 'scree', 'snow', 'water', 'trail'];
        for (let i = 0; i < arr.length; i++) legend[arr[i]] = `terrain:${names[i] ?? i}`;
      }
    }
  });

  const rt = g.post.gbuffer.target;
  const buf = new Uint16Array(W * H * 4);
  // readRenderTargetPixels' y origin is the BOTTOM of the target.
  renderer.readRenderTargetPixels(rt, X, rt.height - (Y + H), W, H, buf, 0, 1);

  const half = (h) => {
    const s = (h & 0x8000) ? -1 : 1;
    const e = (h >> 10) & 0x1f;
    const f = h & 0x3ff;
    if (e === 0) return s * Math.pow(2, -14) * (f / 1024);
    if (e === 31) return f ? NaN : s * Infinity;
    return s * Math.pow(2, e - 15) * (1 + f / 1024);
  };

  const hist = {};
  const ids = new Int16Array(W * H);
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const src = ((H - 1 - j) * W + i) * 4;
      const v = half(buf[src]);
      const id = Math.round(v);
      ids[j * W + i] = id;
      hist[id] = (hist[id] ?? 0) + 1;
    }
  }

  // False colour
  const PAL = [
    [20, 20, 26], [220, 70, 70], [70, 200, 90], [80, 120, 240], [240, 200, 60],
    [220, 110, 220], [90, 220, 220], [250, 150, 60], [160, 160, 160], [120, 60, 200],
    [60, 140, 90], [200, 240, 120], [140, 90, 40], [255, 255, 255], [100, 30, 30],
  ];
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const c2 = cv.getContext('2d');
  const im = c2.createImageData(W, H);
  for (let k = 0; k < W * H; k++) {
    const c = PAL[((ids[k] % PAL.length) + PAL.length) % PAL.length];
    im.data[k * 4] = c[0]; im.data[k * 4 + 1] = c[1]; im.data[k * 4 + 2] = c[2]; im.data[k * 4 + 3] = 255;
  }
  c2.putImageData(im, 0, 0);

  return { hist, legend, png: cv.toDataURL('image/png').split(',')[1], rtw: rt.width, rth: rt.height };
}, { pose, X, Y, W, H });

console.log('gbuffer', res.rtw, 'x', res.rth);
console.log('legend:', JSON.stringify(res.legend, null, 0));
const rows = Object.entries(res.hist).sort((a, b) => b[1] - a[1]);
for (const [id, n] of rows) {
  console.log(`  id ${String(id).padStart(4)}  ${String(n).padStart(9)} px  ${res.legend[id] ?? '?'}`);
}
if (out) {
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, Buffer.from(res.png, 'base64'));
  console.log('wrote', out);
}
await ctx.close();
await browser.close();
