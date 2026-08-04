// Measure terrain-vs-spline agreement per section, plus tabletop detail.
import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 800, height: 450 } })).newPage();
page.on('pageerror', (e) => console.log('  [exception] ' + e.message));
await page.goto('http://127.0.0.1:5173/?capture=1&pr=1', { waitUntil: 'load' });
await page.waitForFunction(() => window.__DESCENT__ && window.__DESCENT__.game && window.__DESCENT__.game.track, null, { timeout: 300000 });
const out = await page.evaluate(() => {
  const g = window.__DESCENT__.game;
  const s = g.track.spline ?? g.track;
  const t = g.terrain;
  const L = [];
  L.push('section          min      max     mean    steepest');
  const rows = [];
  for (const r of s.sectionRanges) {
    let mn = Infinity, mx = -Infinity, sum = 0, n = 0, steep = 0;
    let prev = null;
    for (let d = r.start; d <= r.end; d += 1.5) {
      const sm = s.sampleAtDistance(d);
      const p = { x: sm.position.x, y: sm.position.y, z: sm.position.z };
      const dh = t.heightAt(p.x, p.z) - p.y;
      if (dh < mn) mn = dh;
      if (dh > mx) mx = dh;
      sum += dh; n++;
      if (prev) {
        const hz = Math.hypot(p.x - prev.x, p.z - prev.z);
        const ang = Math.atan2(Math.abs(p.y - prev.y), Math.max(hz, 1e-6)) * 180 / Math.PI;
        if (ang > steep) steep = ang;
      }
      prev = p;
    }
    const name = String(r.kind);
    rows.push({ name, mn, mx, mean: sum / n, steep, start: r.start, end: r.end });
    L.push(`${name.padEnd(16)} ${mn.toFixed(2).padStart(6)}  ${mx.toFixed(2).padStart(6)}  ${(sum/n).toFixed(2).padStart(6)}  ${steep.toFixed(1).padStart(6)}`);
  }
  // Tabletop detail dump
  const tab = rows.find(r => /tabletop/i.test(r.name));
  L.push('');
  L.push(`tabletop range ${tab.start.toFixed(1)} .. ${tab.end.toFixed(1)}   tabletopTakeoff=${s.tabletopTakeoff?.toFixed(1)} landing=${s.tabletopLanding?.toFixed(1)}`);
  L.push('   d        x       z    splineY   terrY    diff');
  for (let d = tab.start; d <= tab.end + 0.001; d += 1.0) {
    const sm = s.sampleAtDistance(d);
    const p = sm.position;
    const th = t.heightAt(p.x, p.z);
    L.push(`${d.toFixed(1).padStart(7)} ${p.x.toFixed(2).padStart(8)} ${p.z.toFixed(2).padStart(8)} ${p.y.toFixed(2).padStart(8)} ${th.toFixed(2).padStart(8)} ${(th-p.y).toFixed(2).padStart(7)}`);
  }
  // Terrain cross-section along the mound axis at x from route
  L.push('');
  L.push('terrain profile along z at the tabletop (x follows route):');
  for (let z = 100; z <= 205; z += 2.5) {
    // route x at this z
    let bx = 0, bd = 1e9;
    for (let d = tab.start - 60; d < tab.end + 60; d += 0.5) {
      const p = s.sampleAtDistance(d).position;
      if (Math.abs(p.z - z) < bd) { bd = Math.abs(p.z - z); bx = p.x; }
    }
    L.push(`  z=${z.toFixed(1).padStart(6)} x=${bx.toFixed(2).padStart(7)}  h=${t.heightAt(bx, z).toFixed(2)}   hL=${t.heightAt(bx-10, z).toFixed(2)}  hR=${t.heightAt(bx+10, z).toFixed(2)}`);
  }
  return L.join('\n');
});
console.log(out);
await browser.close();
