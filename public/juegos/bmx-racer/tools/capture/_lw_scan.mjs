/**
 * Throwaway probe (line-work agent): read the LinesPass packed diagnostic
 * channels along a scanline, together with the G-buffer depth, so a stray
 * stroke can be given NUMBERS instead of an opinion.
 *
 *   node tools/capture/_lw_scan.mjs <pose> <x0> <x1> <y> [step] [url]
 *
 * Prints, per column: view depth (m), dRel*1e4, rawLap*1e4, eDepth,
 * mx, my, sx (m), sy (m), and the final ink alpha.
 */
import { chromium } from 'playwright';

const pose = process.argv[2] ?? 'treeline-silhouette';
const X0 = Number(process.argv[3] ?? 0);
const X1 = Number(process.argv[4] ?? 3200);
const Y = Number(process.argv[5] ?? 900);
const STEP = Number(process.argv[6] ?? 1);
const URL_BASE = process.argv[7] ?? 'http://127.0.0.1:5173';

const b = await chromium.launch({ args: ['--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist'] });
const c = await b.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
const p = await c.newPage();
p.on('pageerror', (e) => console.log('[exc]', e.message));
await p.goto(`${URL_BASE}/?capture=1&pr=2`, { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => !!window.__DESCENT__?.game?.capture, null, { timeout: 240000 });

const rows = await p.evaluate(async ({ pose, X0, X1, Y, STEP }) => {
  const g = window.__DESCENT__.game;
  const r = window.__DESCENT__.engine.renderer;
  g.capture.takeControl();
  g.capture.setPose(pose);
  for (let i = 0; i < 60; i++) g.capture.step(1 / 60);

  const half = (h) => {
    const s = (h & 0x8000) ? -1 : 1, e = (h >> 10) & 0x1f, f = h & 0x3ff;
    if (e === 0) return s * Math.pow(2, -14) * (f / 1024);
    if (e === 31) return f ? NaN : s * Infinity;
    return s * Math.pow(2, e - 15) * (1 + f / 1024);
  };

  const W = X1 - X0;
  const grt = g.post.gbuffer.target;
  const gbuf = new Uint16Array(W * 4);
  r.readRenderTargetPixels(grt, X0, grt.height - 1 - Y, W, 1, gbuf, 0, 0);
  const abuf = new Uint16Array(W * 4);
  r.readRenderTargetPixels(grt, X0, grt.height - 1 - Y, W, 1, abuf, 0, 1);

  const read = (dbg) => {
    g.post.lines.setDebug(dbg);
    g.capture.step(0);
    const rt = g.post.lines.target;
    const buf = new Uint8Array(W * 4);
    r.readRenderTargetPixels(rt, X0, rt.height - 1 - Y, W, 1, buf);
    return buf;
  };
  const d9 = read(9);
  const d8 = read(8);
  const d1 = read(1);
  g.post.lines.setDebug(0);
  g.capture.step(0);

  const out = [];
  for (let i = 0; i < W; i += STEP) {
    out.push({
      x: X0 + i,
      z: half(gbuf[i * 4 + 3]),
      id: Math.round(half(abuf[i * 4])),
      curv: half(abuf[i * 4 + 1]),
      dRel: d9[i * 4] / 255 / 200,
      raw: d9[i * 4 + 1] / 255 / 200,
      eDepth: d9[i * 4 + 2] / 255,
      mx: d8[i * 4] / 255,
      my: d8[i * 4 + 1] / 255,
      sx: (d8[i * 4 + 2] / 255) * 4,
      sy: (d8[i * 4 + 3] / 255) * 4,
      alpha: d1[i * 4] / 255,
    });
  }
  return out;
}, { pose, X0, X1, Y, STEP });

console.log('   x     z(m)  id  curv    dRel     raw   eDep     mx     my   sx(m)  sy(m)  alpha');
for (const r of rows) {
  console.log(
    `${String(r.x).padStart(5)} ${r.z.toFixed(1).padStart(8)} ${String(r.id).padStart(3)} ` +
    `${r.curv.toFixed(2)} ${(r.dRel * 1e4).toFixed(1).padStart(7)} ${(r.raw * 1e4).toFixed(1).padStart(7)} ` +
    `${r.eDepth.toFixed(2)} ${r.mx.toFixed(3)} ${r.my.toFixed(3)} ${r.sx.toFixed(3)} ${r.sy.toFixed(3)} ${r.alpha.toFixed(2)}`,
  );
}
await c.close();
await b.close();
