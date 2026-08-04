/**
 * Throwaway probe: does the Water zone exist at all, and where is it relative
 * to the streambed camera? Answers defect 3's first question — "is the water
 * zone even being assigned where the stream is".
 */
import { chromium } from 'playwright';

const URL_BASE = process.argv[2] ?? 'http://127.0.0.1:5174';
const browser = await chromium.launch({
  args: ['--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist'],
});
const ctx = await browser.newContext({ viewport: { width: 800, height: 450 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('[exc]', e.message));
await page.goto(`${URL_BASE}/?capture=1&pr=1`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => !!window.__DESCENT__?.game?.capture, null, { timeout: 180000 });
await page.evaluate(() => window.__DESCENT__.game.capture.takeControl());
await page.evaluate((p) => window.__DESCENT__.game.capture.setPose(p), 'streambed');
await page.evaluate(() => { for (let i = 0; i < 12; i++) window.__DESCENT__.game.capture.step(1 / 60); });

const out = await page.evaluate(() => {
  const g = window.__DESCENT__.game;
  const t = g.terrain;
  const z = t.zones;
  const names = ['rock', 'dirt', 'grass', 'scree', 'snow', 'water', 'trail'];
  const counts = Array.from(z.counts);
  const cam = g.engine ? g.engine.camera : null;
  const e = cam ? cam.matrixWorld.elements : null;
  const camPos = e ? { x: e[12], y: e[13], z: e[14] } : null;

  // Where is the water? Bounding box + centroid in world metres.
  const size = z.size;
  const half = 2048;
  const mps = 4096 / size;
  let n = 0, sx = 0, sz = 0, minx = 1e9, maxx = -1e9, minz = 1e9, maxz = -1e9;
  let hmin = 1e9, hmax = -1e9;
  for (let iz = 0; iz < size; iz++) {
    for (let ix = 0; ix < size; ix++) {
      if (z.zone[iz * size + ix] !== 5) continue;
      const wx = -half + ix * mps;
      const wz = -half + iz * mps;
      n++; sx += wx; sz += wz;
      if (wx < minx) minx = wx; if (wx > maxx) maxx = wx;
      if (wz < minz) minz = wz; if (wz > maxz) maxz = wz;
      const h = t.height[iz * size + ix];
      if (h < hmin) hmin = h; if (h > hmax) hmax = h;
    }
  }
  return {
    census: names.map((nm, i) => `${nm} ${counts[i]}`).join(', '),
    waterTexels: n,
    centroid: n ? [Math.round(sx / n), Math.round(sz / n)] : null,
    bbox: n ? [minx, maxx, minz, maxz] : null,
    waterHeight: n ? [hmin.toFixed(1), hmax.toFixed(1)] : null,
    cam: camPos ? [camPos.x, camPos.y, camPos.z] : 'n/a',
  };
});
console.log(JSON.stringify(out, null, 2));

// Zone under a screen ray at the frame centre-bottom (the stream floor).
const probe = await page.evaluate(() => {
  const g = window.__DESCENT__.game;
  const t = g.terrain;
  const cam = g.engine.camera;
  const out = [];
  for (const [u, v] of [[0.5, 0.75], [0.5, 0.9], [0.35, 0.8], [0.65, 0.8], [0.5, 0.6]]) {
    // March a ray from the camera through the pixel until it hits the surface.
    const THREE = g.__three ?? null;
    const dir = { x: 0, y: 0, z: 0 };
    const ndc = { x: u * 2 - 1, y: -(v * 2 - 1) };
    const m = cam.projectionMatrixInverse.elements;
    // unproject (x, y, -1) manually
    const px = ndc.x, py = ndc.y;
    let vx = m[0] * px + m[4] * py + m[8] * -1 + m[12];
    let vy = m[1] * px + m[5] * py + m[9] * -1 + m[13];
    let vz = m[2] * px + m[6] * py + m[10] * -1 + m[14];
    const vw = m[3] * px + m[7] * py + m[11] * -1 + m[15];
    vx /= vw; vy /= vw; vz /= vw;
    const w = cam.matrixWorld.elements;
    dir.x = w[0] * vx + w[4] * vy + w[8] * vz;
    dir.y = w[1] * vx + w[5] * vy + w[9] * vz;
    dir.z = w[2] * vx + w[6] * vy + w[10] * vz;
    const len = Math.hypot(dir.x, dir.y, dir.z);
    dir.x /= len; dir.y /= len; dir.z /= len;
    const o = { x: w[12], y: w[13], z: w[14] };
    let hit = null;
    for (let s = 0.5; s < 600; s += 0.4) {
      const x = o.x + dir.x * s, y = o.y + dir.y * s, z = o.z + dir.z * s;
      const th = t.heightAt(x, z);
      if (y <= th) { hit = { x, y: th, z, s }; break; }
    }
    out.push(hit ? { uv: [u, v], dist: hit.s.toFixed(1), h: hit.y.toFixed(1), zone: t.zoneAt(hit.x, hit.z) } : { uv: [u, v], miss: true });
  }
  return out;
});
console.log('screen probes (zone 5 = water):');
console.log(JSON.stringify(probe, null, 2));

await ctx.close();
await browser.close();
