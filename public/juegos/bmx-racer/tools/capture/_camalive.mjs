/**
 * _camalive.mjs — is the camera alive?
 *
 * A superset of _camtrace with the ANGULAR channels the shake and the buffet
 * moved to, plus the critic's whole-frame pixel-delta metric split into the
 * three bands that behave differently (sky, mid, ground).
 *
 *   node tools/capture/_camalive.mjs --seq scree-speed --frames 120
 *   node tools/capture/_camalive.mjs --all --tag after
 *
 * Screen displacement is reported in CSS px on a 900 px basis so it is directly
 * comparable to the motion critic's subject sizes.
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
const FPS = 60;
const FRAMES = Number(args.frames ?? 120);
const ALL = ['scree-speed', 'pack-race', 'switchback', 'tabletop-air', 'landing', 'crash', 'trick-360', 'launch'];
const SEQS = args.all ? ALL : String(args.seq ?? 'scree-speed').split(',');
const TAG = args.tag ?? 'run';
const EVERY = Number(args.every ?? 0);

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist'],
});
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('  [exception]', e.message));

async function ensureReady() {
  await page.goto(`${URL_BASE}/?capture=1&pr=1`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => !!window.__DESCENT__?.game?.capture, null, { timeout: 240000 });
  await page.evaluate(() => window.__DESCENT__.game.capture.takeControl());

  await page.evaluate(() => {
    const g = window.__DESCENT__.game;
    const V = g.effects.cameraDirector.camera.position.constructor;
    const cv = document.createElement('canvas');
    cv.width = 400; cv.height = 225;
    const c2 = cv.getContext('2d', { willReadFrequently: true });
    let prev = null;
    window.__RESETDIFF__ = () => { prev = null; };
    window.__PROBE__ = () => {
      const dir = g.effects.cameraDirector;
      const cam = dir.camera;
      const st = g.race.player.bike.state;
      const p = st.position;
      const c = cam.position;
      const H = window.innerHeight;
      const tanHalf = Math.tan((cam.fov * Math.PI) / 360);
      const pxPerRad = H / (2 * Math.atan(tanHalf));

      const a = new V(p.x, p.y - 0.35, p.z).project(cam);
      const b = new V(p.x, p.y + 1.60, p.z).project(cam);
      const riderPx = Math.abs((1 - a.y) * 0.5 * H - (1 - b.y) * 0.5 * H);
      const cy = (1 - (a.y + b.y) * 0.5) * 0.5;
      const cxn = ((a.x + b.x) * 0.5 + 1) * 0.5;
      const onScreen = a.z > -1 && a.z < 1 && cxn > -0.05 && cxn < 1.05 && cy > -0.05 && cy < 1.05;
      // Where the top and bottom of the drawn subject land, as frame fractions.
      const fTop = (1 - b.y) * 0.5;
      const fBot = (1 - a.y) * 0.5;

      const e = cam.matrixWorld.elements;
      const yaw = Math.atan2(-e[8], -e[10]);
      const dx = c.x - p.x, dy = c.y - p.y, dz = c.z - p.z;
      const dist = Math.hypot(dx, dy, dz);

      // ── The angular channels, in px of frame displacement ──────────────────
      const shkAng = Math.hypot(dir.shakeYaw ?? 0, dir.shakePitch ?? 0) * pxPerRad;
      const bufAng = Math.hypot(dir.buffetYaw ?? 0, dir.buffetPitch ?? 0) * pxPerRad;
      const so = dir.shakeOffset;
      const shakeM = Math.hypot(so.x, so.y, so.z);
      // Translation only moves things AT THE SUBJECT'S DEPTH by this much; the
      // distant half of the frame moves by essentially nothing. Reported so the
      // two channels can be compared honestly.
      const shkTrPx = dist > 0.01 ? (shakeM / dist) * pxPerRad : 0;
      const bufM = Math.hypot(dir.buffetOffset.x, dir.buffetOffset.y, dir.buffetOffset.z);
      const bufTrPx = dist > 0.01 ? (bufM / dist) * pxPerRad : 0;

      let delta = 0, dSky = 0, dMid = 0, dGnd = 0, detail = 0;
      try {
        const src = document.querySelector('canvas');
        c2.drawImage(src, 0, 0, 400, 225);
        const img = c2.getImageData(0, 0, 400, 225).data;
        // HOW MUCH THERE IS TO MOVE. Mean absolute horizontal luminance
        // gradient over the world part of the frame — the ceiling on what any
        // camera motion can contribute to a frame difference. A frame of empty
        // plateau cannot produce a large delta however it is shot.
        {
          let s = 0, n = 0;
          for (let y = 20; y < 205; y++) {
            for (let x = 61; x < 340; x++) {
              const i = (y * 400 + x) * 4;
              s += Math.abs(img[i] - img[i - 4]) + Math.abs(img[i + 1] - img[i - 3]) + Math.abs(img[i + 2] - img[i - 2]);
              n++;
            }
          }
          detail = s / (3 * n);
        }
        if (prev) {
          let s = 0, s0 = 0, s1 = 0, s2 = 0, n0 = 0, n1 = 0, n2 = 0;
          for (let y = 0; y < 225; y++) {
            for (let x = 0; x < 400; x++) {
              const i = (y * 400 + x) * 4;
              const d = Math.abs(img[i] - prev[i]) + Math.abs(img[i + 1] - prev[i + 1]) + Math.abs(img[i + 2] - prev[i + 2]);
              s += d;
              if (x < 60 || x > 340) continue;
              if (y < 78) { s0 += d; n0++; }            // sky / far ridge
              else if (y < 140) { s1 += d; n1++; }      // mid ground
              else if (y <= 200) { s2 += d; n2++; }     // near ground
            }
          }
          delta = s / (3 * 400 * 225);
          dSky = n0 ? s0 / (3 * n0) : 0;
          dMid = n1 ? s1 / (3 * n1) : 0;
          dGnd = n2 ? s2 / (3 * n2) : 0;
        }
        prev = img.slice();
      } catch (err) { delta = -1; }

      return {
        fov: cam.fov, ts: dir.timeScale, bLen: dir.boomLength, dist, riderPx, fTop, fBot,
        onScreen, cy, cxn, bias: dir.frameBias, cf: dir.crashFocus,
        shkAng, shkTrPx, bufAng, bufTrPx, shakeAmp: dir.shakeAmp,
        swing: dir.swingAmount, swingOn: !!dir.swingActive,
        yaw, roll: dir.roll, yawRate: dir.yawRate,
        speed: st.speed, mode: st.mode, air: st.airHeight, peak: st.peakAirHeight,
        surge: dir.surge, delta, dSky, dMid, dGnd, detail,
      };
    };
  });
}
await ensureReady();

async function runSeq(seq) {
  const ok = await page.evaluate((n) => window.__DESCENT__.game.capture.setSequence(n), seq);
  if (!ok) { console.log('  unknown seq', seq); return null; }
  return page.evaluate(
    ([frames, dt]) => {
      const g = window.__DESCENT__.game;
      window.__RESETDIFF__();
      for (let i = 0; i < 4; i++) g.capture.step(dt);
      const r = [];
      for (let f = 0; f < frames; f++) { g.capture.step(dt); r.push(window.__PROBE__()); }
      return r;
    },
    [FRAMES, 1 / FPS],
  );
}

const f2 = (x) => (x == null ? '   -  ' : x.toFixed(2).padStart(6));
const out = {};
for (const seq of SEQS) {
  let rows = null;
  for (let attempt = 0; attempt < 3 && !rows; attempt++) {
    try { rows = await runSeq(seq); }
    catch (e) { console.log(`  ! ${seq} try ${attempt + 1}: ${String(e.message).split('\n')[0]}`); await ensureReady(); }
  }
  if (!rows) { console.log('  xx gave up on', seq); continue; }
  out[seq] = rows;

  const col = (k) => rows.map((r) => r[k]);
  const mx = (k) => Math.max(...col(k));
  const mn = (k) => Math.min(...col(k));
  const q = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return s[Math.floor(p * (s.length - 1))]; };
  const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const n = rows.length, A = rows.slice(2, Math.floor(n / 3)), B = rows.slice(Math.floor((2 * n) / 3));

  console.log(`\n════ ${seq}  ${n} frames ════`);
  console.log(`  speed   ${(mn('speed') * 3.6).toFixed(0)}→${(mx('speed') * 3.6).toFixed(0)} km/h    fov ${mn('fov').toFixed(1)}→${mx('fov').toFixed(1)}   surge ${mn('surge').toFixed(2)}..${mx('surge').toFixed(2)}`);
  console.log(`  boom    ${mn('bLen').toFixed(2)}/${q(col('bLen'), 0.5).toFixed(2)}/${mx('bLen').toFixed(2)}   riderPx ${mn('riderPx').toFixed(0)}/${q(col('riderPx'), 0.5).toFixed(0)}/${mx('riderPx').toFixed(0)}   offscreen ${rows.filter((r) => !r.onScreen).length}`);
  console.log(`  subject top ${q(col('fTop'), 0.02).toFixed(3)}..${q(col('fTop'), 0.98).toFixed(3)}   bottom ${q(col('fBot'), 0.02).toFixed(3)}..${q(col('fBot'), 0.98).toFixed(3)}   (safe 0.255-0.800)  clipped ${rows.filter((r) => r.fBot > 1 || r.fTop < 0).length}`);
  console.log(`  shake   ang max ${mx('shkAng').toFixed(1)} px   translation ${mx('shkTrPx').toFixed(1)} px   frames>1px ${rows.filter((r) => r.shkAng > 1).length}`);
  console.log(`  buffet  ang max ${mx('bufAng').toFixed(2)} px   translation ${mx('bufTrPx').toFixed(2)} px`);
  console.log(`  timeScale min ${mn('ts').toFixed(3)}  slow frames ${rows.filter((r) => r.ts < 0.995).length}   swing max ${mx('swing').toFixed(2)} on ${rows.filter((r) => r.swingOn).length}`);
  console.log(`  roll |max| ${Math.max(...col('roll').map(Math.abs)).toFixed(3)} rad   yawRate |max| ${Math.max(...col('yawRate').map(Math.abs)).toFixed(2)}   crashFocus ${mx('cf').toFixed(2)}`);
  const dl = col('delta').slice(1);
  console.log(`  DELTA   min ${Math.min(...dl).toFixed(2)} med ${q(dl, 0.5).toFixed(2)} max ${Math.max(...dl).toFixed(2)}`);
  const da = mean(A.map((r) => r.delta)), db = mean(B.map((r) => r.delta));
  const va = mean(A.map((r) => r.speed)) * 3.6, vb = mean(B.map((r) => r.speed)) * 3.6;
  const arrow = db > da ? 'RISES' : 'FALLS';
  console.log(`  DELTA   first-third ${da.toFixed(2)} @ ${va.toFixed(0)} km/h  →  last-third ${db.toFixed(2)} @ ${vb.toFixed(0)} km/h   ${arrow} ${(((db / da) - 1) * 100).toFixed(0)}% for ${(((vb / va) - 1) * 100).toFixed(0)}% speed`);
  console.log(`  bands   sky ${mean(A.map((r) => r.dSky)).toFixed(2)}→${mean(B.map((r) => r.dSky)).toFixed(2)}   mid ${mean(A.map((r) => r.dMid)).toFixed(2)}→${mean(B.map((r) => r.dMid)).toFixed(2)}   ground ${mean(A.map((r) => r.dGnd)).toFixed(2)}→${mean(B.map((r) => r.dGnd)).toFixed(2)}`);
  const ea = mean(A.map((r) => r.detail)), eb = mean(B.map((r) => r.detail));
  console.log(`  DETAIL  in-frame contrast ${ea.toFixed(2)} → ${eb.toFixed(2)} (${(((eb / ea) - 1) * 100).toFixed(0)}%)   delta/detail ${(da / ea).toFixed(3)} → ${(db / eb).toFixed(3)} (${((((db / eb) / (da / ea)) - 1) * 100).toFixed(0)}%)`);

  if (EVERY) {
    console.log('   f | speed  fov   boom  ridPx  fTop  fBot  shkPx bufPx   ts   swing  roll   cf   delta  mode air');
    for (let i = 0; i < rows.length; i += EVERY) {
      const r = rows[i];
      console.log(`  ${String(i).padStart(3)}|${f2(r.speed * 3.6)} ${f2(r.fov)} ${f2(r.bLen)} ${f2(r.riderPx)} ${f2(r.fTop)} ${f2(r.fBot)} ${f2(r.shkAng)} ${f2(r.bufAng)} ${f2(r.ts)} ${f2(r.swing)} ${f2(r.roll)} ${f2(r.cf)} ${f2(r.delta)}  ${r.mode} ${r.air.toFixed(1)}`);
    }
  }
}

await mkdir(path.resolve('tools/capture/_out'), { recursive: true });
await writeFile(path.resolve(`tools/capture/_out/camalive-${TAG}.json`), JSON.stringify(out));
console.log(`\n→ tools/capture/_out/camalive-${TAG}.json`);
await browser.close();
