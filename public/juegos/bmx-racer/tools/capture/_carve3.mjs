import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 800, height: 450 } })).newPage();
await page.goto('http://127.0.0.1:5173/?capture=1&pr=1', { waitUntil: 'load' });
await page.waitForFunction(() => window.__DESCENT__ && window.__DESCENT__.game, { timeout: 90000 });
const out = await page.evaluate(() => {
  const g = window.__DESCENT__.game, s = g.track.spline, t = g.terrain;
  const c = s.getCarve();
  const rows = ['carve points near the tabletop lip (spline d 2380..2440):'];
  const target = s.sampleAtDistance(2410).position;
  for (let i = 0; i < c.points.length; i++) {
    const p = c.points[i];
    const dd = Math.hypot(p.x - target.x, p.z - target.z);
    if (dd < 40) rows.push(`  i=${i} d~${dd.toFixed(1)}m from lip  y=${p.y.toFixed(2)} hw=${c.halfWidths[i].toFixed(1)} terr=${t.heightAt(p.x,p.z).toFixed(2)}`);
  }
  rows.push('featherWidth=' + c.featherWidth + '  nPoints=' + c.points.length);
  // gap mask around there
  rows.push('isGap 2400..2425: ' + [2400,2405,2410,2415,2420,2425].map(d=>d+':'+(s.isGap(d)?'Y':'.')).join(' '));
  return rows;
});
console.log(out.join('\n'));
await browser.close();
