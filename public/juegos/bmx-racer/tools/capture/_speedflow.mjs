/**
 * _speedflow.mjs — the CONTROLLED version of the critic's pixel-delta metric.
 *
 * The critic measured frame-to-frame pixel delta across `scree-speed` as the
 * speed rose 70→83 km/h and found it FLAT, and concluded the camera was rigid.
 * That measurement confounds two things: the camera's response to speed, and
 * how much detail happens to be in front of the lens at that point on the
 * course. Over the second half of `scree-speed` the rider rides out onto an
 * open plateau — the boulder fields on both sides of the trail are simply gone
 * by f0100 — so the frame contains less to move regardless of how it is shot.
 *
 * This probe removes the confound the only way it can be removed: it holds the
 * TERRAIN fixed and varies the SPEED. Reset to the same spot, hold the player's
 * speed at a commanded value with a per-frame governor, and measure the mean
 * frame-to-frame delta over a short window that stays inside the same stretch.
 *
 *   node tools/capture/_speedflow.mjs --seq scree-speed
 *   node tools/capture/_speedflow.mjs --seq scree-speed --frames 16 --tag after
 */
import { chromium } from 'playwright';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const args = {};
for (let i = 0; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (!a.startsWith('--')) continue;
  const n = process.argv[i + 1];
  args[a.slice(2)] = n && !n.startsWith('--') ? (i++, n) : true;
}

const URL_BASE = args.url ?? 'http://127.0.0.1:5173';
const SEQ = args.seq ?? 'scree-speed';
const FRAMES = Number(args.frames ?? 16);
const TAG = args.tag ?? 'run';
const SPEEDS = (args.speeds ? String(args.speeds).split(',').map(Number) : [12, 16, 19, 23, 27]);

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist'],
});
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('  [exception]', e.message));

await page.goto(`${URL_BASE}/?capture=1&pr=1`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => !!window.__DESCENT__?.game?.capture, null, { timeout: 240000 });
await page.evaluate(() => window.__DESCENT__.game.capture.takeControl());

await page.evaluate(() => {
  const g = window.__DESCENT__.game;
  const cv = document.createElement('canvas');
  cv.width = 400; cv.height = 225;
  const c2 = cv.getContext('2d', { willReadFrequently: true });
  let prev = null;

  /**
   * Hold the player at `target` m/s along whatever direction they are already
   * travelling. Applied every frame, so the drivetrain and the drag can fight
   * it all they like and the run still happens at the commanded speed.
   */
  window.__GOVERN__ = (target) => {
    const st = g.race.player.bike.state;
    const v = st.velocity;
    const h = Math.hypot(v.x, v.z);
    if (h < 1e-3) return;
    const k = target / h;
    v.x *= k;
    v.z *= k;
    st.speed = Math.hypot(v.x, v.y, v.z);
  };

  window.__RESETDIFF__ = () => { prev = null; };
  window.__DELTA__ = () => {
    const dir = g.effects.cameraDirector;
    const cam = dir.camera;
    const st = g.race.player.bike.state;
    const src = document.querySelector('canvas');
    c2.drawImage(src, 0, 0, 400, 225);
    const img = c2.getImageData(0, 0, 400, 225).data;
    let delta = 0, gnd = 0, sky = 0, n1 = 0, n2 = 0;
    if (prev) {
      let s = 0;
      for (let y = 0; y < 225; y++) {
        for (let x = 0; x < 400; x++) {
          const i = (y * 400 + x) * 4;
          const d = Math.abs(img[i] - prev[i]) + Math.abs(img[i + 1] - prev[i + 1]) + Math.abs(img[i + 2] - prev[i + 2]);
          s += d;
          if (x < 60 || x > 340) continue;
          if (y < 78) { sky += d; n1++; }
          else if (y >= 140 && y <= 200) { gnd += d; n2++; }
        }
      }
      delta = s / (3 * 400 * 225);
      sky = n1 ? sky / (3 * n1) : 0;
      gnd = n2 ? gnd / (3 * n2) : 0;
    }
    prev = img.slice();
    return { delta, sky, gnd, speed: st.speed, fov: cam.fov, boom: dir.boomLength,
      buf: Math.hypot(dir.buffetYaw ?? 0, dir.buffetPitch ?? 0) };
  };
});

const results = [];
for (const target of SPEEDS) {
  const rows = await page.evaluate(
    ([seq, frames, dt, target]) => {
      const g = window.__DESCENT__.game;
      g.capture.setSequence(seq);
      window.__RESETDIFF__();
      // Settle exactly as the harness does, already under the governor, so the
      // camera arrives at its steady state for THIS speed rather than for the
      // situation's authored one.
      for (let i = 0; i < 10; i++) { window.__GOVERN__(target); g.capture.step(dt); }
      window.__RESETDIFF__();
      const out = [];
      for (let f = 0; f < frames; f++) {
        window.__GOVERN__(target);
        g.capture.step(dt);
        out.push(window.__DELTA__());
      }
      return out;
    },
    [SEQ, FRAMES + 1, 1 / 60, target],
  );
  const use = rows.slice(1);
  const mean = (k) => use.reduce((s, r) => s + r[k], 0) / use.length;
  const r = {
    target,
    kmh: mean('speed') * 3.6,
    delta: mean('delta'),
    sky: mean('sky'),
    gnd: mean('gnd'),
    fov: mean('fov'),
    boom: mean('boom'),
    bufDeg: (mean('buf') * 180) / Math.PI,
  };
  results.push(r);
  console.log(
    `  ${String(target).padStart(3)} m/s (${r.kmh.toFixed(0)} km/h)   delta ${r.delta.toFixed(2)}   sky ${r.sky.toFixed(2)}   ground ${r.gnd.toFixed(2)}   fov ${r.fov.toFixed(1)}   boom ${r.boom.toFixed(2)}   buffet ${r.bufDeg.toFixed(3)}°`,
  );
}

const a = results[0], b = results[results.length - 1];
console.log(
  `\n  ${SEQ}: ${a.kmh.toFixed(0)} → ${b.kmh.toFixed(0)} km/h (+${(((b.kmh / a.kmh) - 1) * 100).toFixed(0)}%)  ⇒  delta ${a.delta.toFixed(2)} → ${b.delta.toFixed(2)} (${(((b.delta / a.delta) - 1) * 100).toFixed(0)}%)`,
);

await mkdir(path.resolve('tools/capture/_out'), { recursive: true });
await writeFile(path.resolve(`tools/capture/_out/speedflow-${TAG}.json`), JSON.stringify(results, null, 1));
await browser.close();
