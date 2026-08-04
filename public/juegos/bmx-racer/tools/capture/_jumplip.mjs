// Compare the spline lip with the collision surface the bike actually rides.
import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 600, height: 400 } })).newPage();
p.on('pageerror', (e) => console.log('ERR ' + e.message));
await p.goto('http://127.0.0.1:5173/?capture=1&pr=1', { waitUntil: 'load' });
await p.waitForFunction(() => window.__DESCENT__?.game?.track, null, { timeout: 300000 });
const out = await p.evaluate(() => {
  const g = window.__DESCENT__.game;
  const s = g.track.spline ?? g.track;
  const t = g.terrain;
  const L = [];
  const c = s.getCarve();
  L.push(`carve points=${c.points.length} featherWidth=${c.featherWidth}`);
  // spacing of carve points near the lip
  const lipP = s.sampleAtDistance(s.tabletopTakeoff).position;
  const near = [];
  for (let i = 1; i < c.points.length; i++) {
    if (Math.hypot(c.points[i].x - lipP.x, c.points[i].z - lipP.z) < 14) {
      near.push(Math.hypot(c.points[i].x - c.points[i - 1].x, c.points[i].z - c.points[i - 1].z).toFixed(2));
    }
  }
  L.push(`carve XZ spacing near the lip: ${near.join(' ')}`);
  L.push('');
  L.push('   d    splineY  splineDeg   terrY  terrDeg');
  let pv = null, pt = null;
  for (let d = s.tabletopTakeoff - 12; d <= s.tabletopTakeoff + 10; d += 0.5) {
    const sm = s.sampleAtDistance(d);
    const q = sm.position;
    const th = t.heightAt(q.x, q.z);
    let sd = 0, td = 0;
    if (pv) {
      const hz = Math.hypot(q.x - pv.x, q.z - pv.z);
      sd = (Math.atan2(q.y - pv.y, Math.max(hz, 1e-6)) * 180) / Math.PI;
      td = (Math.atan2(th - pt, Math.max(hz, 1e-6)) * 180) / Math.PI;
    }
    L.push(`${d.toFixed(1).padStart(7)} ${q.y.toFixed(3).padStart(9)} ${sd.toFixed(1).padStart(7)} ${th.toFixed(3).padStart(9)} ${td.toFixed(1).padStart(7)}`);
    pv = { x: q.x, y: q.y, z: q.z };
    pt = th;
  }
  return L.join('\n');
});
console.log(out);
await b.close();
