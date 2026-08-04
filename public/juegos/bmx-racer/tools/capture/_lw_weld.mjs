/**
 * Throwaway probe (line-work agent): read the outline weld's report card off
 * every live geometry — `geometry.userData.outlineWeld` — so "is the weld
 * running on those instances" stops being a hypothesis.
 *
 *   node tools/capture/_lw_weld.mjs [nameRegex] [url]
 */
import { chromium } from 'playwright';

const rx = process.argv[2] ?? '.';
const URL_BASE = process.argv[3] ?? 'http://127.0.0.1:5173';

const b = await chromium.launch({ args: ['--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist'] });
const c = await b.newContext({ viewport: { width: 800, height: 450 }, deviceScaleFactor: 1 });
const p = await c.newPage();
p.on('pageerror', (e) => console.log('[exc]', e.message.slice(0, 300)));
await p.goto(`${URL_BASE}/?capture=1&pr=1`, { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => !!window.__DESCENT__?.game?.capture, null, { timeout: 240000 });

const rows = await p.evaluate((r) => {
  const re = new RegExp(r, 'i');
  const seen = new Set();
  const out = [];
  window.__DESCENT__.engine.scene.traverse((o) => {
    if (!o.geometry || !re.test(o.name || '')) return;
    const g = o.geometry;
    if (seen.has(g.uuid)) return;
    seen.add(g.uuid);
    const w = g.userData?.outlineWeld;
    const cv = g.getAttribute('aCurvature');
    let lo = Infinity, hi = -Infinity, sum = 0;
    if (cv) {
      for (let i = 0; i < cv.count; i++) {
        const v = cv.getX(i);
        if (v < lo) lo = v;
        if (v > hi) hi = v;
        sum += v;
      }
    }
    out.push(
      `${(o.name || '?').padEnd(28)} verts=${String(g.getAttribute('position')?.count).padStart(6)} ` +
      (w
        ? `weld tol=${w.tolerance} groups=${String(w.weldGroups).padStart(6)} singleton=${(w.singletonFraction * 100).toFixed(1)}%`
        : 'weld NOT RUN'.padEnd(46)) +
      (cv ? `  curv ${lo.toFixed(2)}..${hi.toFixed(2)} mean ${(sum / cv.count).toFixed(2)}` : '  no aCurvature'),
    );
  });
  return out;
}, rx);

console.log(rows.join('\n'));
await c.close();
await b.close();
