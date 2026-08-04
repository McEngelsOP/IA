/**
 * _skirt.mjs — read the ribbon's actual vertices out of the running scene.
 *
 * The valley-vista fringe is a claim about GEOMETRY, so it has to be measured
 * on geometry rather than inferred from pixels. This walks the track-ribbon
 * group, groups vertices back into rows of NC=11 columns, and reports, per row,
 * how far the two skirt columns hang below their neighbouring trail edge.
 *
 *   node tools/capture/_skirt.mjs [worldX worldZ radius]
 */
import { chromium } from 'playwright';

const [, , cxS, czS, radS] = process.argv;
const cx = cxS === undefined ? null : Number(cxS);
const cz = czS === undefined ? null : Number(czS);
const rad = Number(radS ?? 120);

const browser = await chromium.launch({
  args: ['--enable-unsafe-swiftshader', '--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage();
await page.goto('http://127.0.0.1:5173/?capture=1&pr=1', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => !!window.__DESCENT__?.game?.capture, null, { timeout: 180000 });

const out = await page.evaluate(({ cx, cz, rad }) => {
  const NC = 11;
  const scene = window.__DESCENT__.engine.scene;
  let group = null;
  scene.traverse((o) => { if (o.name === 'track-ribbon') group = o; });
  if (!group) return { error: 'no track-ribbon' };
  const rows = [];
  group.traverse((m) => {
    if (!m.isMesh) return;
    const p = m.geometry.getAttribute('position');
    const n = p.count / NC;
    for (let r = 0; r < n; r++) {
      const g = [];
      for (let c = 0; c < NC; c++) {
        const i = r * NC + c;
        g.push([p.getX(i), p.getY(i), p.getZ(i)]);
      }
      rows.push(g);
    }
  });
  const res = [];
  for (const g of rows) {
    const mid = g[5];
    if (cx !== null && Math.hypot(mid[0] - cx, mid[2] - cz) > rad) continue;
    // column 0 is the -1.09 skirt, column 1 the -1.00 trail edge;
    // column 10 the +1.09 skirt, column 9 the +1.00 trail edge.
    res.push({
      x: +mid[0].toFixed(1), z: +mid[2].toFixed(1), y: +mid[1].toFixed(2),
      dropL: +(g[1][1] - g[0][1]).toFixed(3),
      dropR: +(g[9][1] - g[10][1]).toFixed(3),
    });
  }
  return { count: rows.length, res };
}, { cx, cz, rad });

if (out.error) { console.log(out.error); await browser.close(); process.exit(1); }
console.log(`ribbon rows total ${out.count}, in window ${out.res.length}`);
const dl = out.res.map((r) => r.dropL);
const dr = out.res.map((r) => r.dropR);
const stat = (v, name) => {
  if (!v.length) return;
  let jmax = 0, jsum = 0;
  for (let i = 1; i < v.length; i++) { const d = Math.abs(v[i] - v[i - 1]); jmax = Math.max(jmax, d); jsum += d; }
  console.log(`${name}: min ${Math.min(...v).toFixed(2)} max ${Math.max(...v).toFixed(2)} ` +
    `mean ${(v.reduce((a, b) => a + b, 0) / v.length).toFixed(2)}  ` +
    `largest row-to-row change ${jmax.toFixed(2)} m, mean |change| ${(jsum / (v.length - 1)).toFixed(3)} m`);
};
stat(dl, 'drop LEFT  (col0 below col1)');
stat(dr, 'drop RIGHT (col10 below col9)');
if (process.env.DUMP) {
  for (const r of out.res) console.log(`  x${String(r.x).padStart(8)} z${String(r.z).padStart(8)} y${String(r.y).padStart(8)}   L ${r.dropL.toFixed(2)}  R ${r.dropR.toFixed(2)}`);
}
await browser.close();
