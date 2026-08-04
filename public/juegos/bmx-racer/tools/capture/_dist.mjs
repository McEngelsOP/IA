/**
 * Ground-truth probe: view distance, world position, zone and the aerial-plate
 * index the terrain shader will compute, for a COLUMN of pixels in a pose.
 *
 * The stills tell you a surface is flat; only this tells you WHY — which plate
 * the pixel is on, and therefore whether the ladder has a boundary anywhere
 * inside the run the critic measured.
 *
 *   node tools/capture/_dist.mjs <pose> <xNative> <y0Native> <y1Native> [stepPx]
 *
 * Coordinates are NATIVE (3200x1800): the same numbers the still scans use.
 */
import { chromium } from 'playwright';

const [, , pose, xS, y0S, y1S, stepS] = process.argv;
const X = Number(xS), Y0 = Number(y0S), Y1 = Number(y1S), STEP = Number(stepS ?? 8);

const browser = await chromium.launch({
  args: ['--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'],
});
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('PAGEERR', e.message.slice(0, 300)));
await page.goto('http://127.0.0.1:5173/?capture=1&pr=2', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!window.__DESCENT__?.game?.capture, null, { timeout: 240000 });

const rows = await page.evaluate(
  async ({ pose, X, Y0, Y1, STEP }) => {
    const D = window.__DESCENT__;
    const g = D.game;
    g.capture.takeControl();
    g.capture.setPose(pose);
    for (let i = 0; i < 12; i++) g.capture.step(1 / 60);
    const cam = D.engine.camera;
    cam.updateMatrixWorld(true);
    const T = g.terrain;
    const THREE = D.THREE ?? null;

    // Native frame size: CSS pixels * device pixel ratio.
    const NW = 1600 * 2, NH = 900 * 2;

    const camPos = { x: cam.position.x, y: cam.position.y, z: cam.position.z };
    const out = [];
    for (let y = Y0; y <= Y1; y += STEP) {
      // NDC for the pixel centre.
      const ndcX = ((X + 0.5) / NW) * 2 - 1;
      const ndcY = 1 - ((y + 0.5) / NH) * 2;
      // Unproject without needing THREE on the page: build the ray from the
      // camera's own inverse projection-view.
      const v = new cam.position.constructor(ndcX, ndcY, 0.5);
      v.unproject(cam);
      let dx = v.x - camPos.x, dy = v.y - camPos.y, dz = v.z - camPos.z;
      const L = Math.hypot(dx, dy, dz);
      dx /= L; dy /= L; dz /= L;

      // March until below the surface, then bisect.
      let t = 0.2, hit = -1;
      let prevT = 0.2, prevAbove = true;
      for (let i = 0; i < 4000 && t < 3000; i++) {
        const px = camPos.x + dx * t, py = camPos.y + dy * t, pz = camPos.z + dz * t;
        const h = T.heightAt(px, pz);
        const above = py > h;
        if (!above && prevAbove) {
          let lo = prevT, hi = t;
          for (let k = 0; k < 40; k++) {
            const m = (lo + hi) * 0.5;
            const mh = T.heightAt(camPos.x + dx * m, camPos.z + dz * m);
            if (camPos.y + dy * m > mh) lo = m; else hi = m;
          }
          hit = (lo + hi) * 0.5;
          break;
        }
        prevAbove = above; prevT = t;
        t += Math.max(0.06, t * 0.012);
      }
      if (hit < 0) { out.push([y, null]); continue; }
      const wx = camPos.x + dx * hit, wy = camPos.y + dy * hit, wz = camPos.z + dz * hit;
      const zone = T.zoneAt(wx, wz);
      // The shader's ladder, evaluated exactly as written in TerrainMaterial.
      const aerialT = Math.min(1, Math.max(0, Math.log2(Math.min(420, Math.max(2.2, hit)) / 2.2) / 7.577));
      const plate = Math.floor(aerialT * 7 + 0.5) / 7;
      const n = T.normalAt(wx, wz);
      out.push([y, hit, wx, wy, wz, zone, plate, n.y]);
    }
    return { camPos, out };
  },
  { pose, X, Y0, Y1, STEP },
);
await browser.close();

console.log(`pose ${pose}  x=${X}  camera (${rows.camPos.x.toFixed(1)}, ${rows.camPos.y.toFixed(1)}, ${rows.camPos.z.toFixed(1)})`);
console.log('    y     dist    plate  zone   N.y     world');
let prevPlate = null;
for (const r of rows.out) {
  if (r[1] === null) { console.log(`${String(r[0]).padStart(5)}     ---`); continue; }
  const [y, d, wx, wy, wz, zone, plate, ny] = r;
  const mark = prevPlate !== null && plate !== prevPlate ? '  <== PLATE STEP' : '';
  console.log(`${String(y).padStart(5)} ${d.toFixed(2).padStart(8)} ${(plate * 7).toFixed(0).padStart(6)} ${String(zone).padStart(5)} ${ny.toFixed(3).padStart(6)}   ${wx.toFixed(1)},${wy.toFixed(1)},${wz.toFixed(1)}${mark}`);
  prevPlate = plate;
}
