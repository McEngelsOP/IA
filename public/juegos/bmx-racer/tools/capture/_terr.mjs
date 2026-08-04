/**
 * _terr.mjs — how rough is the ground the suspension has to eat, and does the
 * track ribbon agree with the heightfield the physics rides on?
 */
import { chromium } from 'playwright';

const b = await chromium.launch({ headless: true, args: ['--use-angle=default', '--enable-unsafe-swiftshader'] });
const p = await b.newPage();
p.on('pageerror', (e) => console.log('ERR', e.message.slice(0, 300)));
await p.goto('http://127.0.0.1:5173/?capture=1&pr=1', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => !!window.__DESCENT__?.game?.capture, null, { timeout: 300000 });

const out = await p.evaluate(() => {
  const g = window.__DESCENT__.game;
  const total = g.track.length;
  const res = [];
  const secs = [
    ['technical', 0.05], ['scree', 0.19], ['switchbacks', 0.39],
    ['rockgarden', 0.56], ['tabletop', 0.62], ['ridge', 0.76],
    ['streambed', 0.85], ['final', 0.95],
  ];
  for (const [name, t] of secs) {
    const d0 = t * total;
    // Ribbon vs heightfield along 60 m of centreline.
    let dmin = 1e9, dmax = -1e9, dsum = 0, n = 0;
    // Roughness: height deviation from a 6 m linear fit, sampled every 0.25 m.
    const hs = [];
    const kind = {};
    for (let s = 0; s < 60; s += 0.25) {
      const smp = g.track.sampleAtDistance(Math.min(total - 2, d0 + s));
      const th = g.terrain.heightAt(smp.position.x, smp.position.z);
      const d = th - smp.position.y;
      dmin = Math.min(dmin, d); dmax = Math.max(dmax, d); dsum += d; n++;
      hs.push(th);
      const k = g.terrain.sampleAt(smp.position.x, smp.position.z).kind;
      kind[k] = (kind[k] ?? 0) + 1;
    }
    // Detrended roughness over a sliding 24-sample (6 m) window.
    let rms = 0, peak = 0, m = 0;
    for (let i = 12; i < hs.length - 12; i++) {
      const fit = (hs[i - 12] + hs[i + 12]) * 0.5;
      const e = hs[i] - fit;
      rms += e * e; m++;
      peak = Math.max(peak, Math.abs(e));
    }
    rms = Math.sqrt(rms / Math.max(1, m));
    res.push({
      name, t,
      ribbonVsTerrain: { min: +dmin.toFixed(2), max: +dmax.toFixed(2), mean: +(dsum / n).toFixed(2) },
      roughness6m: { rms: +rms.toFixed(3), peak: +peak.toFixed(3) },
      kinds: kind,
    });
  }
  return res;
});
for (const r of out) {
  console.log(
    `${r.name.padEnd(12)} t=${r.t}  terrain-minus-ribbon min ${String(r.ribbonVsTerrain.min).padStart(6)} ` +
    `mean ${String(r.ribbonVsTerrain.mean).padStart(6)} max ${String(r.ribbonVsTerrain.max).padStart(6)}   ` +
    `roughness(6m) rms ${r.roughness6m.rms} peak ${r.roughness6m.peak}  kinds ${JSON.stringify(r.kinds)}`,
  );
}
await b.close();
