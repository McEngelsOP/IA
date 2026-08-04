// Probe the natural fall line beside the tabletop and the mound's real height.
import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 800, height: 450 } })).newPage();
page.on('pageerror', (e) => console.log('  [exception] ' + e.message));
await page.goto('http://127.0.0.1:5173/?capture=1&pr=1', { waitUntil: 'load' });
await page.waitForFunction(() => window.__DESCENT__?.game?.track, null, { timeout: 300000 });
const out = await page.evaluate(async () => {
  const W = await import('/src/game/WorldConstants.ts');
  const g = window.__DESCENT__.game;
  const t = g.terrain;
  const s = g.track.spline ?? g.track;
  const tab = W.TERRAIN_FEATURES.find((f) => f.kind === 'tabletop');
  const geo = W.tabletopGeometry(tab);
  const sLip = W.routeDistanceOf(tab.x, tab.z);
  const rf = W.makeRouteFrame();
  const L = [];
  L.push(`sLip=${sLip.toFixed(1)}  geom ${JSON.stringify(geo)}`);
  L.push('   s      x       z    prof   centre   u=+22   u=-22   natMean   c-nat');
  for (let ss = geo.sMin - 25; ss <= geo.sMax + 25; ss += 2) {
    W.routeAt(sLip + ss, rf);
    const nx = rf.tz, nz = -rf.tx;
    const c = t.heightAt(rf.x, rf.z);
    const a = t.heightAt(rf.x + nx * 22, rf.z + nz * 22);
    const b = t.heightAt(rf.x - nx * 22, rf.z - nz * 22);
    const nat = (a + b) / 2;
    L.push(
      `${ss.toFixed(0).padStart(5)} ${rf.x.toFixed(1).padStart(7)} ${rf.z.toFixed(1).padStart(7)} ` +
      `${W.tabletopProfile(geo, ss).toFixed(2).padStart(5)} ${c.toFixed(2).padStart(8)} ` +
      `${a.toFixed(2).padStart(7)} ${b.toFixed(2).padStart(7)} ${nat.toFixed(2).padStart(8)} ${(c - nat).toFixed(2).padStart(6)}`,
    );
  }
  // Local gradient of the ridden surface (spline) along the face and landing.
  L.push('');
  L.push('ridden gradient (spline y, 2m window):');
  const d0 = 2380, d1 = 2470;
  for (let d = d0; d <= d1; d += 2) {
    const p0 = s.sampleAtDistance(d - 1).position.clone();
    const p1 = s.sampleAtDistance(d + 1).position.clone();
    const hz = Math.hypot(p1.x - p0.x, p1.z - p0.z);
    const deg = (Math.atan2(p1.y - p0.y, Math.max(hz, 1e-6)) * 180) / Math.PI;
    L.push(`  d=${d}  z=${s.sampleAtDistance(d).position.z.toFixed(1).padStart(6)}  y=${s.sampleAtDistance(d).position.y.toFixed(2)}  ${deg.toFixed(1).padStart(6)} deg`);
  }
  return L.join('\n');
});
console.log(out);
await browser.close();
