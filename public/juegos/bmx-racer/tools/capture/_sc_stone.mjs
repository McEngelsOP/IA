/**
 * Throwaway: import the stone builder straight out of the dev server's module
 * graph and check the geometry it hands back — closed, welded, curvature
 * present and spread, and sized the way the caller expects.
 */
import { chromium } from 'playwright';

const b = await chromium.launch({ args: ['--use-angle=default'] });
const p = await (await b.newContext()).newPage();
p.on('pageerror', (e) => console.log('ERR', e.message.slice(0, 300)));
await p.goto('http://127.0.0.1:5173/?capture=1&pr=1', { waitUntil: 'domcontentloaded' });

const out = await p.evaluate(async () => {
  const m = await import('/src/terrain/Scatter.ts');
  const rows = [];
  for (const v of [0, 1, 2]) {
    const g = m.buildStoneGeometry(`stream-rock-${v}`, 0.55);
    const pos = g.getAttribute('position');
    const cv = g.getAttribute('aCurvature');
    const sn = g.getAttribute('aSmoothNormal');
    // open edges: an edge midpoint with no partner is a hole in the hull
    const mid = new Map();
    for (let t = 0; t < pos.count / 3; t++) {
      for (let e = 0; e < 3; e++) {
        const a = t * 3 + e;
        const c = t * 3 + ((e + 1) % 3);
        const k = [0, 1, 2].map((j) => Math.round(((pos.getX(a) + pos.getX(c)) / 2) * 0 + 0)).join();
        const mx = Math.round(((pos.getX(a) + pos.getX(c)) / 2) * 1000);
        const my = Math.round(((pos.getY(a) + pos.getY(c)) / 2) * 1000);
        const mz = Math.round(((pos.getZ(a) + pos.getZ(c)) / 2) * 1000);
        const key = `${mx}|${my}|${mz}${k.length ? '' : ''}`;
        mid.set(key, (mid.get(key) ?? 0) + 1);
      }
    }
    let open = 0;
    for (const n of mid.values()) if (n < 2) open++;
    let x0 = 9e9, x1 = -9e9, y0 = 9e9, y1 = -9e9;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i);
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    let cmin = 9, cmax = -9, csum = 0;
    for (let i = 0; i < cv.count; i++) { const c = cv.getX(i); if (c < cmin) cmin = c; if (c > cmax) cmax = c; csum += c; }
    rows.push({
      v, verts: pos.count, tris: pos.count / 3, open,
      hasSmooth: !!sn,
      width: +(x1 - x0).toFixed(3), height: +(y1 - y0).toFixed(3), baseY: +y0.toFixed(3),
      curv: [+cmin.toFixed(3), +(csum / cv.count).toFixed(3), +cmax.toFixed(3)],
    });
  }
  return rows;
});
for (const r of out) console.log(JSON.stringify(r));
await b.close();
