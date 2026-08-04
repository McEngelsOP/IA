/** Throwaway: why is the aux attachment empty for some poses? */
import { chromium } from 'playwright';
const poses = (process.argv[2] ?? 'valley-vista,ridge-exposure').split(',');
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
  const lines = [];
  const half = (h) => {
    const s = (h & 0x8000) ? -1 : 1, e = (h >> 10) & 0x1f, f = h & 0x3ff;
    if (e === 0) return s * Math.pow(2, -14) * (f / 1024);
    if (e === 31) return f ? NaN : s * Infinity;
    return s * Math.pow(2, e - 15) * (1 + f / 1024);
  };
  for (const pose of poses) {
    const ok = g.capture.setPose(pose);
    for (let i = 0; i < 60; i++) g.capture.step(1 / 60);
    const rt = g.post.gbuffer.target;
    for (const att of [0, 1]) {
      const buf = new Uint16Array(rt.width * 4 * 8);
      // one 8-row strip at mid height
      r.readRenderTargetPixels(rt, 0, Math.floor(rt.height / 2), rt.width, 8, buf, 0, att);
      let nz = 0, sample = [];
      for (let i = 0; i < buf.length; i += 4) if (buf[i] !== 0 || buf[i + 1] !== 0) nz++;
      for (let i = 0; i < 8; i++) sample.push(half(buf[(1600 + i) * 4]).toFixed(3));
      lines.push(`${pose} ok=${ok} att${att} nonzero=${nz}/${rt.width * 8} sample=${sample.join(',')}`);
    }
    lines.push(`  prepassMeshes=${g.post.stats.prepassMeshes} casters=${g.post.stats.casters}`);
  }
  return lines;
}, poses);
console.log(out.join('\n'));
await c.close();
await b.close();
