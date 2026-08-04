/**
 * Throwaway: raycast the scene through named DEVICE pixels at a pose and report
 * exactly which object (and which instance of it) is under each.
 *
 * The intersection is written out longhand rather than borrowed from THREE:
 * the page never puts the THREE namespace on `window`, and screenshot-diff
 * attribution turned out to depend on the sim clock (every `capture.step` moves
 * the world, so a trial frame and its baseline differ everywhere).
 *
 *   node tools/capture/_sc_pick.mjs streambed 2150,1100 2200,1080
 */
import { chromium } from 'playwright';

const POSE = process.argv[2] ?? 'streambed';
const PIX = process.argv.slice(3).map((s) => s.split(',').map(Number));

const b = await chromium.launch({ headless: true, args: ['--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist'] });
const ctx = await b.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
const p = await ctx.newPage();
p.on('pageerror', (e) => console.log('ERR', e.message.slice(0, 300)));
await p.goto('http://127.0.0.1:5173/?capture=1&pr=2', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => !!window.__DESCENT__?.game?.race, null, { timeout: 300000 });

const out = await p.evaluate(({ pose, pix }) => {
  const g = window.__DESCENT__.game;
  g.capture.takeControl();
  g.capture.setPose(pose);
  for (let i = 0; i < 8; i++) g.capture.step(1 / 60);
  const cam = g.engine.camera;
  cam.updateMatrixWorld(true);

  const mul = (a, b2) => {
    const o = new Float64Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b2[c * 4 + k];
      o[c * 4 + r] = s;
    }
    return o;
  };
  const xf = (m, x, y, z) => {
    const w = m[3] * x + m[7] * y + m[11] * z + m[15];
    return [(m[0] * x + m[4] * y + m[8] * z + m[12]) / w,
            (m[1] * x + m[5] * y + m[9] * z + m[13]) / w,
            (m[2] * x + m[6] * y + m[10] * z + m[14]) / w];
  };
  const unproj = mul(cam.matrixWorld.elements, cam.projectionMatrixInverse.elements);

  const meshes = [];
  const walk = (o, mw) => {
    if (o.isMesh && o.visible) meshes.push(o);
    for (const c of o.children) walk(c, mw);
  };
  walk(g.engine.scene);

  const results = [];
  for (const [px, py] of pix) {
    const nx = (px / 3200) * 2 - 1;
    const ny = -((py / 1800) * 2 - 1);
    const a = xf(unproj, nx, ny, -1);
    const c2 = xf(unproj, nx, ny, 1);
    let dx = c2[0] - a[0], dy = c2[1] - a[1], dz = c2[2] - a[2];
    const L = Math.hypot(dx, dy, dz); dx /= L; dy /= L; dz /= L;
    const ox = a[0], oy = a[1], oz = a[2];

    const hits = [];
    for (const m of meshes) {
      if (m.name === 'sky:dome' || m.name === 'sky:shafts') continue;
      const geo = m.geometry;
      const pos = geo.getAttribute('position');
      if (!pos) continue;
      const idx = geo.getIndex();
      const tri = idx ? idx.count / 3 : pos.count / 3;
      const nInst = m.isInstancedMesh ? m.count : 1;
      const im = m.instanceMatrix ? m.instanceMatrix.array : null;
      m.updateMatrixWorld();
      const mw = m.matrixWorld.elements;
      for (let ii = 0; ii < nInst; ii++) {
        const M = im ? mul(mw, im.subarray(ii * 16, ii * 16 + 16)) : mw;
        for (let t = 0; t < tri; t++) {
          const i0 = idx ? idx.getX(t * 3) : t * 3;
          const i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
          const i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
          const A = xf(M, pos.getX(i0), pos.getY(i0), pos.getZ(i0));
          const B = xf(M, pos.getX(i1), pos.getY(i1), pos.getZ(i1));
          const C = xf(M, pos.getX(i2), pos.getY(i2), pos.getZ(i2));
          const e1x = B[0] - A[0], e1y = B[1] - A[1], e1z = B[2] - A[2];
          const e2x = C[0] - A[0], e2y = C[1] - A[1], e2z = C[2] - A[2];
          const hx = dy * e2z - dz * e2y, hy = dz * e2x - dx * e2z, hz = dx * e2y - dy * e2x;
          const det = e1x * hx + e1y * hy + e1z * hz;
          if (Math.abs(det) < 1e-12) continue;
          const inv = 1 / det;
          const sx = ox - A[0], sy = oy - A[1], sz = oz - A[2];
          const u = (sx * hx + sy * hy + sz * hz) * inv;
          if (u < 0 || u > 1) continue;
          const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
          const v = (dx * qx + dy * qy + dz * qz) * inv;
          if (v < 0 || u + v > 1) continue;
          const tt = (e2x * qx + e2y * qy + e2z * qz) * inv;
          if (tt < 0.01) continue;
          hits.push({ n: m.name || m.type, hull: !!m.userData?.isHull, inst: m.isInstancedMesh ? ii : null, d: +tt.toFixed(2) });
        }
      }
    }
    hits.sort((x, y) => x.d - y.d);
    const seen = new Set();
    const uniq = [];
    for (const h of hits) {
      const k = `${h.n}|${h.inst}`;
      if (seen.has(k)) continue;
      seen.add(k);
      uniq.push(h);
      if (uniq.length >= 6) break;
    }
    results.push({ px, py, hits: uniq });
  }
  return results;
}, { pose: POSE, pix: PIX });

for (const r of out) {
  console.log(`px(${r.px},${r.py}):`);
  if (!r.hits.length) console.log('   (nothing)');
  for (const h of r.hits) console.log(`   d=${String(h.d).padStart(8)}  ${h.n}${h.hull ? ' [HULL]' : ''} inst=${h.inst}`);
}
await b.close();
