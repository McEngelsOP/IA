/**
 * Throwaway geometry probe for the scatter work. Dumps, for each scatter mesh:
 * vertex count, weld-group statistics, aCurvature histogram, and the maximum
 * distance any triangle centroid sits from the geometry's own centre — which is
 * how an "exploded" mesh shows up numerically.
 */
import { chromium } from 'playwright';

const b = await chromium.launch({ headless: true, args: ['--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist'] });
const ctx = await b.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
const p = await ctx.newPage();
p.on('pageerror', (e) => console.log('ERR', e.message.slice(0, 300)));
p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log(`[page] ${m.text().slice(0, 200)}`); });
await p.goto('http://127.0.0.1:5173/?capture=1&pr=2', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => !!window.__DESCENT__?.game?.race, null, { timeout: 300000 });

const out = await p.evaluate(() => {
  const g = window.__DESCENT__.game;
  const rows = [];
  const scatter = g.terrain.scatter;
  const walk = (o) => {
    if (o.geometry && o.isMesh) {
      const geo = o.geometry;
      const pos = geo.getAttribute('position');
      const sn = geo.getAttribute('aSmoothNormal');
      const cv = geo.getAttribute('aCurvature');
      // weld groups at 1e-3
      const keys = new Map();
      let minx = 1e9, maxx = -1e9, miny = 1e9, maxy = -1e9;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
        if (x < minx) minx = x; if (x > maxx) maxx = x;
        if (y < miny) miny = y; if (y > maxy) maxy = y;
        const k = `${Math.round(x * 1000)}|${Math.round(y * 1000)}|${Math.round(z * 1000)}`;
        keys.set(k, (keys.get(k) ?? 0) + 1);
      }
      let singles = 0;
      for (const v of keys.values()) if (v === 1) singles++;
      // curvature histogram
      let cmin = 9, cmax = -9, csum = 0;
      if (cv) {
        for (let i = 0; i < cv.count; i++) {
          const c = cv.getX(i);
          if (c < cmin) cmin = c; if (c > cmax) cmax = c; csum += c;
        }
      }
      // triangle-level: how far apart are triangles that SHOULD share an edge?
      // measure: for each triangle, its 3 edge midpoints; count midpoints that
      // have no partner within 1e-3 from another triangle.
      const mid = new Map();
      const tri = pos.count / 3;
      for (let t = 0; t < tri; t++) {
        for (let e = 0; e < 3; e++) {
          const a = t * 3 + e, c2 = t * 3 + ((e + 1) % 3);
          const mx = (pos.getX(a) + pos.getX(c2)) / 2;
          const my = (pos.getY(a) + pos.getY(c2)) / 2;
          const mz = (pos.getZ(a) + pos.getZ(c2)) / 2;
          const k = `${Math.round(mx * 1000)}|${Math.round(my * 1000)}|${Math.round(mz * 1000)}`;
          mid.set(k, (mid.get(k) ?? 0) + 1);
        }
      }
      let openEdges = 0;
      for (const v of mid.values()) if (v < 2) openEdges++;
      rows.push({
        name: o.name || '(unnamed)',
        hull: !!o.userData.isHull,
        verts: pos.count,
        tris: tri,
        weldGroups: keys.size,
        singletonGroups: singles,
        openEdges,
        hasSmooth: !!sn,
        hasCurv: !!cv,
        curv: cv ? [cmin.toFixed(3), (csum / cv.count).toFixed(3), cmax.toFixed(3)] : null,
        bbox: [(maxx - minx).toFixed(3), (maxy - miny).toFixed(3)],
        count: o.count,
      });
    }
    for (const c of o.children) walk(c);
  };
  walk(scatter.object);
  const fol = g.terrain.foliage;
  if (fol) walk(fol.object);
  return rows;
});

for (const r of out) {
  console.log(
    `${r.name.padEnd(28)} ${r.hull ? 'HULL' : 'main'} n=${String(r.count).padStart(4)} v=${String(r.verts).padStart(5)} t=${String(r.tris).padStart(4)} weld=${String(r.weldGroups).padStart(5)} single=${String(r.singletonGroups).padStart(5)} openEdge=${String(r.openEdges).padStart(5)} sn=${r.hasSmooth ? 'Y' : 'N'} cv=${r.hasCurv ? 'Y' : 'N'} curv[${r.curv}] bb=${r.bbox}`,
  );
}
await b.close();
