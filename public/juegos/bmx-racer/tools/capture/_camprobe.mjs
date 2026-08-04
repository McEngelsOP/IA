/**
 * _camprobe.mjs — throwaway. Measures camera↔subject geometry over a sequence.
 *
 *   node tools/capture/_camprobe.mjs --seq scree-speed --frames 120
 *   node tools/capture/_camprobe.mjs --all
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
const SEQS = args.all
  ? ['scree-speed', 'pack-race', 'switchback', 'tabletop-air', 'landing', 'crash', 'trick-360', 'launch']
  : [args.seq ?? 'scree-speed'];
const TAG = args.tag ?? 'run';

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

// Install the sampler.
await page.evaluate(() => {
  const g = window.__DESCENT__.game;
  const THREEV = g.effects.cameraDirector.camera.position.constructor;
  window.__PROBE__ = () => {
    const dir = g.effects.cameraDirector;
    const cam = dir.camera;
    const st = g.race.player.bike.state;
    const p = st.position;
    const c = cam.position;
    const dx = c.x - p.x, dy = c.y - p.y, dz = c.z - p.z;
    const dist = Math.hypot(dx, dy, dz);
    const flat = Math.hypot(dx, dz);

    // Screen height of the rider: project a point at the bike origin and one
    // 1.85 m above it (helmet top), measure the pixel span.
    const H = window.innerHeight;
    const a = new THREEV(p.x, p.y - 0.35, p.z).project(cam);
    const b = new THREEV(p.x, p.y + 1.60, p.z).project(cam);
    const pxA = (1 - a.y) * 0.5 * H;
    const pxB = (1 - b.y) * 0.5 * H;
    const riderPx = Math.abs(pxA - pxB);
    // Vertical centre of the subject in normalised screen space (0 = top).
    const cy = (1 - (a.y + b.y) * 0.5) * 0.5;
    const cxn = ((a.x + b.x) * 0.5 + 1) * 0.5;
    const onScreen = a.z > -1 && a.z < 1;

    // Nearest OTHER racer to the camera.
    let nearOther = 1e9, nearOtherId = '';
    for (const r of g.race.racers) {
      if (r === g.race.player) continue;
      const q = r.bike.state.position;
      const d = Math.hypot(c.x - q.x, c.y - q.y, c.z - q.z);
      if (d < nearOther) { nearOther = d; nearOtherId = r.id; }
    }

    const terrH = g.terrain.heightAt(c.x, c.z);

    return {
      dist, flat, dy,
      speed: st.speed, mode: st.mode, air: st.airHeight, peak: st.peakAirHeight,
      fov: cam.fov, ts: dir.timeScale,
      swing: dir.swingAmount ?? 0, swingOn: !!dir.swingActive,
      bLen: dir.boomLength, bWant: dir.boomDesired, bRet: dir.boomRetract, lift: dir.collisionLift, bias: dir.frameBias, occN: dir.occCount, cf: dir.crashFocus,
      roll: dir.roll ?? 0, shake: dir.shakeAmp ?? 0,
      riderPx, cy, cxn, onScreen,
      nearOther, nearOtherId,
      camAboveTerrain: c.y - terrH,
      cx: c.x, cyw: c.y, cz: c.z, px: p.x, py: p.y, pz: p.z,
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
      for (let i = 0; i < 4; i++) g.capture.step(dt);
      const r = [];
      for (let f = 0; f < frames; f++) {
        g.capture.step(dt);
        r.push(window.__PROBE__());
      }
      return r;
    },
    [FRAMES, 1 / FPS],
  );
}

const out = {};
for (const seq of SEQS) {
  let rows = null;
  for (let attempt = 0; attempt < 4 && !rows; attempt++) {
    try { rows = await runSeq(seq); }
    catch (e) { console.log(`  ! ${seq} attempt ${attempt + 1}: ${String(e.message).split('\n')[0]}`); await ensureReady(); }
  }
  if (!rows) { console.log('  xx gave up on', seq); continue; }
  out[seq] = rows;

  // Summary.
  const d = rows.map((r) => r.dist);
  const px = rows.map((r) => r.riderPx);
  const no = rows.map((r) => r.nearOther);
  let maxJump = 0, jumpAt = -1;
  for (let i = 1; i < d.length; i++) {
    const j = Math.abs(d[i] - d[i - 1]);
    if (j > maxJump) { maxJump = j; jumpAt = i; }
  }
  const q = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return s[Math.floor(p * (s.length - 1))]; };
  console.log(`\n── ${seq} (${rows.length} frames)`);
  console.log(`   dist      min ${Math.min(...d).toFixed(2)}  p05 ${q(d,0.05).toFixed(2)}  med ${q(d,0.5).toFixed(2)}  max ${Math.max(...d).toFixed(2)}`);
  console.log(`   riderPx   min ${Math.min(...px).toFixed(0)}  med ${q(px,0.5).toFixed(0)}  max ${Math.max(...px).toFixed(0)}  (of 900)`);
  console.log(`   nearOther min ${Math.min(...no).toFixed(2)}`);
  console.log(`   cy (0=top,1=bottom) min ${Math.min(...rows.map(r=>r.cy)).toFixed(3)} max ${Math.max(...rows.map(r=>r.cy)).toFixed(3)}`);
  console.log(`   camAboveTerrain min ${Math.min(...rows.map(r=>r.camAboveTerrain)).toFixed(2)}`);
  let bj = 0, bjAt = -1;
  for (let i = 1; i < rows.length; i++) { const j = Math.abs(rows[i].bLen - rows[i - 1].bLen); if (j > bj) { bj = j; bjAt = i; } }
  const bd = []; for (let i = 1; i < rows.length; i++) bd.push(Math.abs(rows[i].bLen - rows[i - 1].bLen));
  bd.sort((a, b) => a - b);
  console.log(`   max per-frame dist jump ${maxJump.toFixed(3)} m at f${jumpAt} (${(jumpAt/FPS).toFixed(3)}s)`);
  console.log(`   BOOM len  min ${Math.min(...rows.map(r=>r.bLen)).toFixed(2)}  med ${q(rows.map(r=>r.bLen),0.5).toFixed(2)}  max ${Math.max(...rows.map(r=>r.bLen)).toFixed(2)}   |dBoom| p50 ${bd[Math.floor(bd.length*0.5)].toFixed(3)}  p99 ${bd[Math.floor(bd.length*0.99)].toFixed(3)}  max ${bj.toFixed(3)} @f${bjAt}`);
  console.log(`   max lift ${Math.max(...rows.map(r=>r.lift)).toFixed(2)}  max frameBias ${Math.max(...rows.map(r=>Math.abs(r.bias))).toFixed(2)}  crashFocus peak ${Math.max(...rows.map(r=>r.cf)).toFixed(2)}`);
  console.log(`   offscreen frames ${rows.filter(r=>!r.onScreen || r.cy<0||r.cy>1).length}`);
  // Frames where the subject is dangerously close or tiny.
  const bad = rows.map((r, i) => ({ i, r })).filter(({ r }) => r.dist < 3.0 || r.riderPx > 380 || r.riderPx < 45);
  if (bad.length) {
    console.log(`   BAD frames (${bad.length}): ` + bad.slice(0, 14).map(({ i, r }) => `f${i}:d=${r.dist.toFixed(2)},px=${r.riderPx.toFixed(0)}`).join('  '));
  }
}

await mkdir(path.resolve('tools/capture/_out'), { recursive: true });
await writeFile(path.resolve(`tools/capture/_out/camprobe-${TAG}.json`), JSON.stringify(out));
console.log(`\n→ tools/capture/_out/camprobe-${TAG}.json`);
await browser.close();
