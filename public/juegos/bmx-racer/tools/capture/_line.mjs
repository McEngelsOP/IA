/**
 * _line.mjs — IS THE RIDER STILL ON THE COURSE?
 *
 * The motion review's "the corner marker reads 144 M and is still 144 M 35
 * frames later" is a statement about PROGRESS ALONG THE TRACK, not about speed.
 * This projects the bike onto the spline every physics step and prints track
 * distance, lateral offset against the authored half-width, and the corner
 * preview the HUD is reading.
 *
 * Usage: node tools/capture/_line.mjs [--seq switchback] [--secs 2.2]
 */
import { chromium } from 'playwright';

const args = {};
for (let i = 0; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith('--')) {
    const n = process.argv[i + 1];
    args[a.slice(2)] = n && !n.startsWith('--') ? n : true;
  }
}
const SEQ = args.seq ?? 'switchback';
const SECS = +(args.secs ?? 2.2);
const EVERY = +(args.every ?? 6);

const b = await chromium.launch({
  headless: true,
  args: ['--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'],
});
const p = await b.newPage();
p.on('pageerror', (e) => console.log('ERR', e.message.slice(0, 300)));
await p.goto('http://127.0.0.1:5173/?capture=1&pr=1', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => !!window.__DESCENT__?.game?.capture, null, { timeout: 300000 });

const out = await p.evaluate(([seq, secs]) => {
  const g = window.__DESCENT__.game;
  g.capture.takeControl();
  g.capture.setSequence(seq);
  const bike = g.race.player.bike;
  const phys = bike.physics;
  const st = bike.state;
  const orig = phys.step.bind(phys);
  const rec = [];
  let n = 0;
  phys.step = (inp, dt) => {
    orig(inp, dt);
    const pr = g.track.project(st.position);
    const cp = g.track.cornerPreview(pr.distance);
    rec.push({
      i: n, sp: st.speed, d: pr.distance, lat: pr.lateral, vert: pr.vertical,
      hw: pr.sample.halfWidth ?? null, bank: pr.sample.bank ?? null,
      curv: cp ? cp.curvature : 0, cdist: cp ? cp.distance : -1,
      lean: st.lean, mode: st.mode, y: st.position.y,
      gnd: (phys.front.grounded || phys.rear.grounded) ? 1 : 0,
    });
    n++;
  };
  const frames = Math.round(secs * 60);
  for (let i = 0; i < frames; i++) g.capture.step(1 / 60);
  phys.step = orig;
  // Track geometry around the run, for the required radius.
  const d0 = rec[0].d;
  const geom = [];
  for (let s = -20; s <= 160; s += 10) {
    const a = g.track.sampleAtDistance(Math.max(1, d0 + s - 8));
    const bq = g.track.sampleAtDistance(Math.max(1, d0 + s));
    const c = g.track.sampleAtDistance(Math.max(1, d0 + s + 8));
    const cross = (bq.position.x - a.position.x) * (c.position.z - a.position.z)
      - (bq.position.z - a.position.z) * (c.position.x - a.position.x);
    const la = Math.hypot(bq.position.x - a.position.x, bq.position.z - a.position.z);
    const lb = Math.hypot(c.position.x - bq.position.x, c.position.z - bq.position.z);
    const lc = Math.hypot(c.position.x - a.position.x, c.position.z - a.position.z);
    const area = Math.abs(cross) / 2;
    geom.push({
      s, R: area < 1e-6 ? 99999 : +((la * lb * lc) / (4 * area)).toFixed(1),
      hw: +(bq.halfWidth ?? 0).toFixed(1), bank: +(bq.bank ?? 0).toFixed(2),
      y: +bq.position.y.toFixed(1),
    });
  }
  return { rec, geom, keys: Object.keys(rec[0]) };
}, [SEQ, SECS]);

console.log(`${SEQ}: ${out.rec.length} steps`);
console.log('\nTRACK GEOMETRY ahead of the spawn (s = metres along the course from the spawn):');
console.log('  s:   ' + out.geom.map((x) => String(x.s).padStart(7)).join(''));
console.log('  R:   ' + out.geom.map((x) => String(x.R > 999 ? '-' : x.R).padStart(7)).join(''));
console.log('  hw:  ' + out.geom.map((x) => String(x.hw).padStart(7)).join(''));
console.log('  bank:' + out.geom.map((x) => String(x.bank).padStart(7)).join(''));
console.log('  y:   ' + out.geom.map((x) => String(x.y).padStart(7)).join(''));

console.log('\nstep    sp   trackDist  progress  lateral  halfW  vert   corner@  curv   lean  gnd mode');
const d0 = out.rec[0].d;
for (let i = 0; i < out.rec.length; i += EVERY) {
  const r = out.rec[i];
  console.log(
    `${String(r.i).padStart(4)} ${r.sp.toFixed(1).padStart(5)} ` +
    `${r.d.toFixed(1).padStart(11)} ${(r.d - d0).toFixed(1).padStart(9)} ` +
    `${r.lat.toFixed(2).padStart(8)} ${String(r.hw == null ? '-' : r.hw.toFixed(1)).padStart(6)} ` +
    `${r.vert.toFixed(2).padStart(6)} ${r.cdist.toFixed(0).padStart(8)} ${r.curv.toFixed(2).padStart(6)} ` +
    `${r.lean.toFixed(2).padStart(6)}  ${r.gnd}  ${r.mode}`,
  );
}
await b.close();
