/**
 * Throwaway probe (line-work agent): over a WHOLE frame, find every pixel the
 * depth detector fires on and histogram the NORMAL step (the paint's own
 * evidence for a fold) at those pixels, split by whether the material id also
 * changes there.
 *
 * The question it answers: if the depth channel were required to be
 * corroborated by the paint, what would be lost and what would be gained.
 *
 *   node tools/capture/_lw_hist.mjs <poses,csv> [url]
 */
import { chromium } from 'playwright';

const poses = (process.argv[2] ?? 'treeline-silhouette').split(',');
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

    const read = (dbg) => {
      g.post.lines.setDebug(dbg);
      g.capture.step(0);
      const rt = g.post.lines.target;
      const buf = new Uint8Array(W * H * 4);
      r.readRenderTargetPixels(rt, 0, 0, W, H, buf);
      return buf;
    };
    const d9 = read(9);
    const d8 = read(8);
    g.post.lines.setDebug(0);
    g.capture.step(0);

    // Histogram of max(mx,my) at pixels where eDepth > 0.5, split by whether
    // any 4-neighbour carries a different material id.
    const BINS = 14;
    const edge = [0, .02, .04, .06, .08, .10, .125, .15, .20, .25, .30, .40, .60, 1.01];
    const sameId = new Array(BINS).fill(0);
    const diffId = new Array(BINS).fill(0);
    let fired = 0;
    for (let y = 2; y < H - 2; y++) {
      for (let x = 2; x < W - 2; x++) {
        const k = y * W + x;
        if (d9[k * 4 + 2] < 128) continue;      // eDepth
        fired++;
        const mx = d8[k * 4] / 255, my = d8[k * 4 + 1] / 255;
        const m = Math.max(mx, my);
        let bin = 0;
        while (bin < BINS - 1 && m >= edge[bin + 1]) bin++;
        const id0 = Math.round(half(aux[k * 4]));
        let allTerrain = id0 >= 1 && id0 <= 7;
        for (const o of [-1, 1, -W, W]) {
          const id1 = Math.round(half(aux[(k + o) * 4]));
          if (!(id1 >= 1 && id1 <= 7)) allTerrain = false;
        }
        (allTerrain ? sameId : diffId)[bin]++;
      }
    }
    lines.push(`── ${pose}: ${fired} px with eDepth>0.5`);
    lines.push('   max(mx,my)  allTerrain     other');
    for (let i = 0; i < BINS; i++) {
      if (!sameId[i] && !diffId[i]) continue;
      lines.push(`   ${edge[i].toFixed(3)}-${(edge[i + 1] ?? 1).toFixed(3)}  ${String(sameId[i]).padStart(8)}  ${String(diffId[i]).padStart(8)}`);
    }
  }
  return lines;
}, poses);

console.log(out.join('\n'));
await c.close();
await b.close();
