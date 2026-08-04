/**
 * Throwaway probe: heightfield vs ribbon centreline, per section.
 *
 * Reports, for each track section, the signed error terrain.heightAt(x,z) minus
 * spline.py at the same arc length, and the detrended roughness of the
 * heightfield along the racing line over a 6 m window.
 *
 *   node tools/capture/_carve.mjs
 */
import { chromium } from 'playwright';

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 800, height: 450 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('[err]', e.message.split('\n')[0]));
await page.goto('http://127.0.0.1:5173/?capture=1&pr=1', { waitUntil: 'load' });
await page.waitForFunction(() => window.__DESCENT__ && window.__DESCENT__.game, { timeout: 90000 });

const out = await page.evaluate(() => {
  const g = window.__DESCENT__.game;
  const t = g.terrain;
  const s = g.track.spline;
  const rows = [];
  const err = [];
  const STEP = 0.5;
  for (let d = 0; d <= s.length; d += STEP) {
    const sm = s.sampleAtDistance(d);
    const h = t.heightAt(sm.position.x, sm.position.z);
    err.push({ d, e: h - sm.position.y, sec: String(sm.section), gap: s.isGap(d) });
  }
  // Per section min/max/rms of the error, gaps excluded.
  const bySec = new Map();
  for (const r of err) {
    if (r.gap) continue;
    let a = bySec.get(r.sec);
    if (!a) { a = { min: 1e9, max: -1e9, sum: 0, sq: 0, n: 0 }; bySec.set(r.sec, a); }
    a.min = Math.min(a.min, r.e); a.max = Math.max(a.max, r.e);
    a.sum += r.e; a.sq += r.e * r.e; a.n++;
  }
  for (const [k, a] of bySec) {
    rows.push(`${k.padEnd(16)} n=${String(a.n).padStart(5)}  min ${a.min.toFixed(2).padStart(7)}  max ${a.max.toFixed(2).padStart(7)}  mean ${(a.sum / a.n).toFixed(2).padStart(7)}  rms ${Math.sqrt(a.sq / a.n).toFixed(3)}`);
  }

  // Detrended roughness of the HEIGHTFIELD along the racing line, 6 m window.
  const W = Math.round(6 / STEP);
  const rough = new Map();
  const hs = err.map((r) => {
    const sm = s.sampleAtDistance(r.d);
    return t.heightAt(sm.position.x, sm.position.z);
  });
  for (let i = W; i < hs.length - W; i++) {
    if (err[i].gap) continue;
    // Linear detrend across the window, then the residual at the centre.
    let sx = 0, sy = 0, sxx = 0, sxy = 0, n = 0;
    for (let k = -W; k <= W; k++) {
      const x = k * STEP, y = hs[i + k];
      sx += x; sy += y; sxx += x * x; sxy += x * y; n++;
    }
    const b = (n * sxy - sx * sy) / Math.max(1e-9, n * sxx - sx * sx);
    const a = (sy - b * sx) / n;
    const res = hs[i] - a;
    const sec = err[i].sec;
    let r = rough.get(sec);
    if (!r) { r = { sq: 0, peak: 0, n: 0 }; rough.set(sec, r); }
    r.sq += res * res; r.peak = Math.max(r.peak, Math.abs(res)); r.n++;
  }
  const rrows = [];
  for (const [k, r] of rough) {
    rrows.push(`${k.padEnd(16)} rms ${Math.sqrt(r.sq / r.n).toFixed(3)} m   peak ${r.peak.toFixed(3)} m`);
  }
  return { rows, rrows };
});

console.log('=== heightAt - splineY, per section (m) ===');
console.log(out.rows.join('\n'));
console.log('\n=== detrended roughness of the heightfield along the racing line, 6 m window ===');
console.log(out.rrows.join('\n'));
await browser.close();
