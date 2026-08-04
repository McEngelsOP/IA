/**
 * Throwaway probe (line-work agent): report the outline attributes actually
 * present on a named mesh's geometry at runtime.
 *   node tools/capture/_lw_geo.mjs <nameRegex> [url]
 */
import { chromium } from 'playwright';
const rx = process.argv[2] ?? 'rock';
const URL_BASE = process.argv[3] ?? 'http://127.0.0.1:5173';
const b = await chromium.launch({ args: ['--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist'] });
const c = await b.newContext({ viewport: { width: 800, height: 450 }, deviceScaleFactor: 1 });
const p = await c.newPage();
p.on('pageerror', (e) => console.log('[exc]', e.message));
await p.goto(`${URL_BASE}/?capture=1&pr=1`, { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => !!window.__DESCENT__?.game?.capture, null, { timeout: 240000 });
const rows = await p.evaluate((r) => {
  const re = new RegExp(r, 'i');
  const out = [];
  const seen = new Set();
  window.__DESCENT__.engine.scene.traverse((o) => {
    if (!(o.isMesh || o.isInstancedMesh || o.isSkinnedMesh)) return;
    if (!re.test(o.name || '')) return;
    const g = o.geometry;
    if (seen.has(g.uuid)) { out.push(`${o.name}: SAME geometry as earlier (${g.uuid.slice(0, 8)})`); return; }
    seen.add(g.uuid);
    const pos = g.getAttribute('position');
    const nrm = g.getAttribute('normal');
    const sn = g.getAttribute('aSmoothNormal');
    const cv = g.getAttribute('aCurvature');
    const line = [`${o.name}  geo=${g.uuid.slice(0, 8)} verts=${pos?.count} indexed=${!!g.getIndex()}`];
    line.push(`  attrs: ${Object.keys(g.attributes).join(',')}`);
    if (sn && nrm) {
      // how many vertices have aSmoothNormal identical to their own normal
      let same = 0;
      const a = sn.array, n = nrm.array;
      for (let i = 0; i < sn.count; i++) {
        const d = a[i * 3] * n[i * 3] + a[i * 3 + 1] * n[i * 3 + 1] + a[i * 3 + 2] * n[i * 3 + 2];
        if (d > 0.99999) same++;
      }
      line.push(`  aSmoothNormal == normal on ${same}/${sn.count} (${(100 * same / sn.count).toFixed(1)}%)`);
    }
    if (cv) {
      const arr = cv.array;
      let mn = 1e9, mx = -1e9, s = 0;
      for (let i = 0; i < cv.count; i++) { const v = arr[i]; mn = Math.min(mn, v); mx = Math.max(mx, v); s += v; }
      line.push(`  aCurvature min=${mn.toFixed(3)} max=${mx.toFixed(3)} mean=${(s / cv.count).toFixed(3)}`);
    }
    // weld group census at 1e-3
    if (pos) {
      const m = new Map();
      const q = 1e3;
      const pa = pos.array;
      for (let i = 0; i < pos.count; i++) {
        const k = `${Math.round(pa[i * 3] * q)}|${Math.round(pa[i * 3 + 1] * q)}|${Math.round(pa[i * 3 + 2] * q)}`;
        m.set(k, (m.get(k) ?? 0) + 1);
      }
      let singles = 0;
      for (const v of m.values()) if (v === 1) singles++;
      line.push(`  weld groups=${m.size} singletons=${singles}`);
    }
    const mat = o.material;
    if (mat?.uniforms) {
      const u = mat.uniforms;
      line.push(`  mat=${mat.name} outlineWidth=${u.uOutlineWidth?.value} targetPx=${u.uTargetPixels?.value} curvW=${u.uCurvatureWeight?.value} curvFloor=${u.uCurvatureFloor?.value}`);
    } else if (mat) line.push(`  mat=${mat.name} (no uniforms)`);
    out.push(line.join('\n'));
  });
  return out;
}, rx);
console.log(rows.join('\n'));
await b.close();
