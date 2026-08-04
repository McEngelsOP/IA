/**
 * Throwaway probe (line-work agent): measure the RAW ink field — straight off
 * the line pass's own render target, before the grade, the vignette or the HUD
 * touch it — in both the old and the new interior-line rules, on ONE settled
 * frame.
 *
 * Reports, per pose:
 *   inked pixels and mean alpha, split by whether the pixel sits on a painted
 *   surface (terrain zone id) or on anything else, and split again into
 *   contour pixels (alpha owned by the silhouette term) and interior pixels.
 *
 *   node tools/capture/_lw_meas.mjs <poses,csv> [url]
 */
import { chromium } from 'playwright';

const poses = (process.argv[2] ?? 'summit-rider').split(',');
const URL_BASE = process.argv[3] ?? 'http://127.0.0.1:5173';

const b = await chromium.launch({ args: ['--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist'] });
const c = await b.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
const p = await c.newPage();
p.on('pageerror', (e) => console.log('[exc]', e.message));
await p.goto(`${URL_BASE}/?capture=1&pr=2`, { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => !!window.__DESCENT__?.game?.capture, null, { timeout: 240000 });

const out = await p.evaluate(async (poses) => {
  const g = window.__DESCENT__.game;
  const r = window.__DESCENT__.engine.renderer;
  g.capture.takeControl();
  const half = (h) => {
    const s = (h & 0x8000) ? -1 : 1, e = (h >> 10) & 0x1f, f = h & 0x3ff;
    if (e === 0) return s * Math.pow(2, -14) * (f / 1024);
    if (e === 31) return f ? NaN : s * Infinity;
    return s * Math.pow(2, e - 15) * (1 + f / 1024);
  };
  const lines = [];

  for (const pose of poses) {
    g.capture.setPose(pose);
    for (let i = 0; i < 60; i++) g.capture.step(1 / 60);

    const grt = g.post.gbuffer.target;
    const W = grt.width, H = grt.height;
    const aux = new Uint16Array(W * H * 4);
    r.readRenderTargetPixels(grt, 0, 0, W, H, aux, 0, 1);

    // Contour mask: debug 7 packs contour in R.
    const probe = (dbg) => {
      g.post.lines.setDebug(dbg);
      g.capture.step(0);
      const buf = new Uint8Array(W * H * 4);
      r.readRenderTargetPixels(g.post.lines.target, 0, 0, W, H, buf);
      return buf;
    };

    const modes = {};
    for (const mode of ['before', 'after']) {
      const u = g.post.lines.uniforms;
      if (mode === 'before') { u.uPaintMask.value = 0; u.uPressure.value.set(0.95, 0.95); }
      else { u.uPaintMask.value = 254; u.uPressure.value.set(0.45, 1.05); }
      const d7 = probe(7);           // r contour, a alpha
      g.post.lines.setDebug(0);
      g.capture.step(0);
      const buf = new Uint8Array(W * H * 4);
      r.readRenderTargetPixels(g.post.lines.target, 0, 0, W, H, buf);
      modes[mode] = { d7, ink: buf };
    }
    // restore
    const u = g.post.lines.uniforms;
    u.uPaintMask.value = 254; u.uPressure.value.set(0.45, 1.05);

    const stat = () => ({ n: 0, sum: 0, h: new Array(6).fill(0) });
    const acc = {};
    for (const mode of ['before', 'after']) {
      acc[mode] = {
        paintInterior: stat(), otherInterior: stat(),
        paintContour: stat(), otherContour: stat(),
      };
    }
    for (let k = 0; k < W * H; k++) {
      const id = Math.round(half(aux[k * 4]));
      if (id === 0) continue;
      const paint = id >= 1 && id <= 7;
      for (const mode of ['before', 'after']) {
        const a = modes[mode].d7[k * 4 + 3] / 255;
        if (a < 0.04) continue;
        const isContour = modes[mode].d7[k * 4] > 128;
        const key = (paint ? 'paint' : 'other') + (isContour ? 'Contour' : 'Interior');
        acc[mode][key].n++;
        acc[mode][key].sum += a;
        acc[mode][key].h[Math.min(5, Math.floor(a * 6))]++;
      }
    }
    lines.push(`── ${pose}`);
    for (const key of ['paintInterior', 'otherInterior', 'paintContour', 'otherContour']) {
      const bf = acc.before[key], af = acc.after[key];
      lines.push(
        `   ${key.padEnd(14)} px ${String(bf.n).padStart(7)} → ${String(af.n).padStart(7)}` +
        `   mean alpha ${(bf.sum / Math.max(bf.n, 1)).toFixed(3)} → ${(af.sum / Math.max(af.n, 1)).toFixed(3)}`,
      );
      lines.push(`        alpha bins  before ${bf.h.join('/')}`);
      lines.push(`                     after ${af.h.join('/')}`);
    }
  }
  return lines;
}, poses);

console.log(out.join('\n'));
await c.close();
await b.close();
