/**
 * _maskdump.mjs — WHAT IS THE DIFFERENCE PROBE ACTUALLY COUNTING?
 *
 * `_subjpx.mjs` measures the subject by hiding `bike:player` + `rider:player`
 * and taking the bounding box of the pixels that changed. Two agents disagree
 * by a factor of two on the answer, so before either number is trusted the mask
 * itself has to be looked at: hiding a mesh also removes everything that mesh
 * CAUSES — its cast shadow above all — and a shadow stretched down a slope is
 * as tall on screen as the rider that threw it.
 *
 * Writes the frame with the changed pixels tinted, plus the bounding box, so
 * the mask can be read back with eyes rather than argued about.
 *
 *   node tools/capture/_maskdump.mjs --seq scree-speed --at 30
 */
import { chromium } from 'playwright';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const args = {};
for (let i = 0; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (!a.startsWith('--')) continue;
  const n = process.argv[i + 1];
  args[a.slice(2)] = n && !n.startsWith('--') ? n : true;
}

const URL_BASE = args.url ?? 'http://127.0.0.1:5173';
const OUT = path.resolve(args.outdir ?? 'captures/mask');
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist'],
});
const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
const page = await context.newPage();
page.on('pageerror', (e) => console.log('  [page:exception]', e.message));

await page.goto(`${URL_BASE}/?capture=1&pr=2`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
await page.waitForFunction(() => !!window.__DESCENT__?.game?.capture, null, { timeout: 240_000 });
await page.evaluate(() => window.__DESCENT__.game.capture.takeControl());

await page.evaluate(() => {
  const G = () => window.__DESCENT__.game;
  const W = 800, H = 450;
  const c2 = document.createElement('canvas');
  c2.width = W; c2.height = H;
  const g2 = c2.getContext('2d', { willReadFrequently: true });
  function grab() {
    const gl = document.querySelector('canvas');
    g2.clearRect(0, 0, W, H);
    g2.drawImage(gl, 0, 0, W, H);
    return g2.getImageData(0, 0, W, H).data;
  }
  function roots(names) {
    const out = [];
    G().engine.scene.traverse((o) => { if (o.name && names.includes(o.name)) out.push(o); });
    return out;
  }

  /**
   * @param names  which scene roots to hide
   * @param noShadow  also disable shadow CASTING on those roots first, so the
   *                  diff is the subject's own silhouette and nothing else
   */
  window.__mask = function (names, noShadow) {
    const rs = roots(names);
    if (noShadow) {
      // Kill the cast shadow FIRST and render, so the "before" frame already
      // has no shadow in it. Whatever differs after that is the mesh itself.
      const prev = [];
      rs.forEach((r) => r.traverse((o) => { prev.push([o, o.castShadow]); o.castShadow = false; }));
      G().capture.step(0);
      var a = grab();
      var restoreShadow = () => prev.forEach(([o, v]) => { o.castShadow = v; });
    } else {
      var a = grab();
      var restoreShadow = () => {};
    }
    const vis = rs.map((r) => r.visible);
    rs.forEach((r) => { r.visible = false; });
    G().capture.step(0);
    const b = grab();
    rs.forEach((r, i) => { r.visible = vis[i]; });
    G().capture.step(0);
    const c = grab();

    let minX = 1e9, maxX = -1, minY = 1e9, maxY = -1, n = 0;
    const rowN = new Uint16Array(H), colN = new Uint16Array(W);
    const hit = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        const d = Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
        if (d < 40) continue;
        const noise = Math.abs(a[i] - c[i]) + Math.abs(a[i + 1] - c[i + 1]) + Math.abs(a[i + 2] - c[i + 2]);
        if (noise >= d * 0.5) continue;
        n++; rowN[y]++; colN[x]++; hit[y * W + x] = 1;
      }
    }
    for (let y = 0; y < H; y++) if (rowN[y] >= 3) { if (y < minY) minY = y; if (y > maxY) maxY = y; }
    for (let x = 0; x < W; x++) if (colN[x] >= 3) { if (x < minX) minX = x; if (x > maxX) maxX = x; }
    restoreShadow();
    G().capture.step(0);

    // Paint: original frame, changed pixels tinted magenta, bbox in green.
    const img = g2.getImageData(0, 0, W, H);
    const px = img.data;
    for (let i = 0; i < W * H; i++) {
      if (!hit[i]) continue;
      px[i * 4] = Math.min(255, px[i * 4] * 0.35 + 200);
      px[i * 4 + 1] = px[i * 4 + 1] * 0.25;
      px[i * 4 + 2] = Math.min(255, px[i * 4 + 2] * 0.35 + 200);
    }
    if (maxY >= 0 && maxX >= 0) {
      const line = (x, y) => { if (x >= 0 && x < W && y >= 0 && y < H) { const i = (y * W + x) * 4; px[i] = 40; px[i + 1] = 255; px[i + 2] = 80; } };
      for (let x = minX; x <= maxX; x++) { line(x, minY); line(x, maxY); }
      for (let y = minY; y <= maxY; y++) { line(minX, y); line(maxX, y); }
    }
    g2.putImageData(img, 0, 0);
    return {
      png: c2.toDataURL('image/png'),
      px: maxY < 0 ? 0 : +(((maxY - minY + 1) / H) * 900).toFixed(1),
      wpx: maxX < 0 ? 0 : +(((maxX - minX + 1) / W) * 1600).toFixed(1),
      n, minY, maxY, minX, maxX,
    };
  };
});

const step = (n) => page.evaluate((c) => { for (let i = 0; i < c; i++) window.__DESCENT__.game.capture.step(1 / 60); }, n);

const which = args.seq ?? args.pose;
const isSeq = !!args.seq;
const ok = await page.evaluate(
  ([n, s]) => (s ? window.__DESCENT__.game.capture.setSequence(n) : window.__DESCENT__.game.capture.setPose(n)),
  [which, isSeq],
);
if (!ok) { console.log('unknown', which); process.exit(1); }
await step(isSeq ? 4 : 12);
await step(Number(args.at ?? 0));
await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));

for (const [label, names, noShadow] of [
  ['both', ['bike:player', 'rider:player'], false],
  ['noshadow', ['bike:player', 'rider:player'], true],
]) {
  const m = await page.evaluate(([n, ns]) => window.__mask(n, ns), [names, noShadow]);
  const file = path.join(OUT, `${which}-${args.at ?? 0}-${label}.png`);
  await writeFile(file, Buffer.from(m.png.split(',')[1], 'base64'));
  console.log(`${label.padEnd(10)} px=${String(m.px).padStart(6)} wpx=${String(m.wpx).padStart(6)} n=${m.n}  y=[${m.minY},${m.maxY}] x=[${m.minX},${m.maxX}]  → ${file}`);
}

await browser.close();
