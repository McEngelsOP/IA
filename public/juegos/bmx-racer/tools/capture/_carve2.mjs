import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 800, height: 450 } })).newPage();
await page.goto('http://127.0.0.1:5173/?capture=1&pr=1', { waitUntil: 'load' });
await page.waitForFunction(() => window.__DESCENT__ && window.__DESCENT__.game, { timeout: 90000 });
const out = await page.evaluate(() => {
  const g = window.__DESCENT__.game, t = g.terrain, s = g.track.spline;
  const rows = [];
  for (const [name, secName] of [['TABLETOP','tabletop'],['RAVINE','ravine-gap'],['STREAM','stream-bed']]) {
    const r = s.sectionRanges.find((x) => String(x.kind) === secName) ?? null;
    if (!r) { rows.push(name + ': no range; kinds=' + s.sectionRanges.map(x=>x.kind).join(',')); continue; }
    rows.push(`--- ${name}  ${r.start.toFixed(0)}..${r.end.toFixed(0)} m`);
    for (let d = r.start - 10; d <= r.end + 10; d += 2) {
      const sm = s.sampleAtDistance(d);
      const h = t.heightAt(sm.position.x, sm.position.z);
      const e = h - sm.position.y;
      if (Math.abs(e + 0.18) > 0.25 || s.isGap(d)) {
        rows.push(`  d=${d.toFixed(0).padStart(5)} splineY=${sm.position.y.toFixed(2).padStart(8)} terr=${h.toFixed(2).padStart(8)} err=${e.toFixed(2).padStart(7)} gap=${s.isGap(d)?'Y':'.'} hw=${sm.halfWidth.toFixed(1)}`);
      }
    }
  }
  return rows;
});
console.log(out.join('\n'));
await browser.close();
