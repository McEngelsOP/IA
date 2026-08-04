/**
 * Throwaway: project every live scatter instance to device pixels at a named
 * pose and list the ones landing inside a rect, with world scale and distance.
 * Pure matrix math on the instanceMatrix arrays — no THREE import needed.
 *
 *   node tools/capture/_scatray.mjs streambed 2050,1010,600,400
 */
import { chromium } from 'playwright';

const POSE = process.argv[2] ?? 'streambed';
const [RX, RY, RW, RH] = (process.argv[3] ?? '2050,1010,600,400').split(',').map(Number);

const b = await chromium.launch({ headless: true, args: ['--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist'] });
const ctx = await b.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
const p = await ctx.newPage();
p.on('pageerror', (e) => console.log('ERR', e.message.slice(0, 300)));
await p.goto('http://127.0.0.1:5173/?capture=1&pr=2', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => !!window.__DESCENT__?.game?.race, null, { timeout: 300000 });
await p.evaluate(() => window.__DESCENT__.game.capture.takeControl());
await p.evaluate((pose) => {
  const g = window.__DESCENT__.game;
  g.capture.setPose(pose);
  for (let i = 0; i < 8; i++) g.capture.step(1 / 60);
}, POSE);

const res = await p.evaluate((rect) => {
  const [rx, ry, rw, rh] = rect;
  const g = window.__DESCENT__.game;
  const cam = g.engine.camera;
  cam.updateMatrixWorld(true);
  const vp = cam.projectionMatrix.clone().multiply(cam.matrixWorldInverse);
  const e = vp.elements;
  const project = (x, y, z) => {
    const w = e[3] * x + e[7] * y + e[11] * z + e[15];
    const cx = (e[0] * x + e[4] * y + e[8] * z + e[12]) / w;
    const cy = (e[1] * x + e[5] * y + e[9] * z + e[13]) / w;
    return [(cx * 0.5 + 0.5) * 3200, (-cy * 0.5 + 0.5) * 1800, w];
  };
  const out = [];
  const walk = (o) => {
    if (o.isInstancedMesh && o.visible && o.count > 0 && !o.userData.isHull) {
      const arr = o.instanceMatrix.array;
      for (let i = 0; i < o.count; i++) {
        const b = i * 16;
        const x = arr[b + 12], y = arr[b + 13], z = arr[b + 14];
        const sc = Math.hypot(arr[b], arr[b + 1], arr[b + 2]);
        const [sx, sy, d] = project(x, y, z);
        if (d <= 0) continue;
        if (sx < rx - 60 || sx > rx + rw + 60 || sy < ry - 60 || sy > ry + rh + 60) continue;
        out.push({ n: o.name, i, sx: Math.round(sx), sy: Math.round(sy), sc: +sc.toFixed(2), d: +d.toFixed(1), w: [x.toFixed(1), y.toFixed(1), z.toFixed(1)] });
      }
    }
    else if (o.isMesh && o.visible && !o.userData.isHull && o.geometry) {
      const m = o.matrixWorld.elements;
      const x = m[12], y = m[13], z = m[14];
      const [sx, sy, d] = project(x, y, z);
      if (d > 0 && sx > rx - 200 && sx < rx + rw + 200 && sy > ry - 200 && sy < ry + rh + 200) {
        out.push({ n: `MESH ${o.name}`, i: -1, sx: Math.round(sx), sy: Math.round(sy), sc: 1, d: +d.toFixed(1), w: [x.toFixed(1), y.toFixed(1), z.toFixed(1)] });
      }
    }
    for (const c of o.children) walk(c);
  };
  walk(g.engine.scene);
  const cp = cam.position;
  return { out, cam: [cp.x, cp.y, cp.z] };
}, [RX, RY, RW, RH]);

console.log('camera', res.cam.map((n) => n.toFixed(1)).join(', '));
res.out.sort((a, b2) => a.d - b2.d);
for (const r of res.out) console.log(`${r.n.padEnd(24)} #${String(r.i).padStart(4)} screen(${r.sx},${r.sy}) scale=${r.sc} viewDist=${r.d} world=${r.w}`);
console.log('total in rect:', res.out.length);
await b.close();
