/**
 * _sphere.mjs — where on the sphere around the subject can a camera actually
 * SEE it? Prints a clear/blocked map over azimuth offset x elevation for a
 * given pose, at that pose's authored radius.
 */
import { chromium } from 'playwright';
const args = {};
for (let i = 0; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (!a.startsWith('--')) continue;
  const n = process.argv[i + 1];
  args[a.slice(2)] = n && !n.startsWith('--') ? n : true;
}
const URL_BASE = args.url ?? 'http://127.0.0.1:5180';
const b = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader', '--use-angle=default'] });
const c = await b.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
const p = await c.newPage();
await p.goto(`${URL_BASE}/?capture=1&pr=2`, { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => !!window.__DESCENT__?.game?.capture, null, { timeout: 240000 });
await p.evaluate(() => window.__DESCENT__.game.capture.takeControl());

for (const pose of String(args.pose ?? 'ravine-gap').split(',')) {
  await p.evaluate((n) => window.__DESCENT__.game.capture.setPose(n), pose);
  await p.evaluate(() => { for (let i = 0; i < 12; i++) window.__DESCENT__.game.capture.step(1 / 60); });
  const out = await p.evaluate(() => {
    const g = window.__DESCENT__.game;
    const st = g.race.player.bike.state;
    const cam = g.engine.camera;
    const px = st.position.x, py = st.position.y + 1.1, pz = st.position.z;
    const cp = cam.position;
    const dx = cp.x - px, dy = cp.y - py, dz = cp.z - pz;
    const h = Math.hypot(dx, dz);
    const len = Math.hypot(h, dy);
    const az0 = Math.atan2(dx, dz);
    const e0 = Math.atan2(dy, h);
    const clear = (az, e) => {
      const ce = Math.cos(e), se = Math.sin(e);
      const cx = px + Math.sin(az) * ce * len;
      const cy = py + se * len;
      const cz = pz + Math.cos(az) * ce * len;
      if (cy < g.terrain.heightAt(cx, cz) + 1.15) return 'F';
      for (let i = 1; i <= 7; i++) {
        const s = i / 8;
        const qx = px + (cx - px) * s, qy = py + (cy - py) * s, qz = pz + (cz - pz) * s;
        const m = 0.15 + (0.5 - 0.15) * s;
        if (g.terrain.heightAt(qx, qz) + m - qy > 0.18) return 'x';
      }
      return '.';
    };
    const rows = [`len=${len.toFixed(1)} az0=${az0.toFixed(2)} e0=${e0.toFixed(2)} subjY=${py.toFixed(1)} airH=${(st.airHeight ?? 0).toFixed(1)}`];
    rows.push('        ' + Array.from({ length: 13 }, (_, j) => String(-6 + j).padStart(4)).join(''));
    for (let i = 0; i <= 13; i++) {
      const e = -0.1 + i * 0.1;
      let line = `e=${(-0.1 + i * 0.1).toFixed(1)} `;
      for (let j = 0; j < 13; j++) line += '   ' + clear(az0 + (-6 + j) * 0.35, e);
      rows.push(line);
    }
    return rows.join('\n');
  });
  console.log(`\n== ${pose}\n${out}`);
}
await b.close();
