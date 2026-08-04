/**
 * _tyre.mjs — per-step tyre force breakdown for one sequence.
 *
 * The energy probe attributes a 12 m/s^2 deceleration on a coasting bike to
 * "the tyres". This one says WHICH COMPONENT: longitudinal (brake/rolling) or
 * lateral (scrub), with the slip state that produced it.
 *
 * Usage: node tools/capture/_tyre.mjs [--seq tabletop-air] [--secs 2.2] [--every 4]
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
const SEQ = args.seq ?? 'tabletop-air';
const SECS = +(args.secs ?? 2.2);
const EVERY = +(args.every ?? 4);

const b = await chromium.launch({
  headless: true,
  args: ['--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'],
});
const p = await b.newPage();
p.on('pageerror', (e) => console.log('ERR', e.message.slice(0, 300)));
await p.goto('http://127.0.0.1:5173/?capture=1&pr=1', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => !!window.__DESCENT__?.game?.capture, null, { timeout: 300000 });

const rec = await p.evaluate(([seq, secs]) => {
  const g = window.__DESCENT__.game;
  g.capture.takeControl();
  g.capture.setSequence(seq);
  const bike = g.race.player.bike;
  const phys = bike.physics;
  const st = bike.state;
  const orig = phys.step.bind(phys);
  const out = [];
  let n = 0;
  const dotv = (v, a) => v.x * a.x + v.y * a.y + v.z * a.z;
  phys.step = (inp, dt) => {
    orig(inp, dt);
    const f = phys.front, r = phys.rear;
    const q = st.orientation;
    const fx = 2 * (q.x * q.z + q.w * q.y);
    const fz = 1 - 2 * (q.x * q.x + q.y * q.y);
    out.push({
      i: n, sp: st.speed, fwdSp: st.forwardSpeed, mode: st.mode,
      y: st.position.y, airH: st.airHeight, lean: st.lean, pitch: st.pitch,
      fG: f.grounded ? 1 : 0, rG: r.grounded ? 1 : 0,
      fLoad: f.load, rLoad: r.load,
      fLong: f.grounded ? dotv(f.tyreForce, f.forward) : 0,
      fLat: f.grounded ? dotv(f.tyreForce, f.left) : 0,
      rLong: r.grounded ? dotv(r.tyreForce, r.forward) : 0,
      rLat: r.grounded ? dotv(r.tyreForce, r.left) : 0,
      fVl: f.vLat, rVl: r.vLat, fVL: f.vLong, rVL: r.vLong,
      fSA: f.slipAngle, rSA: r.slipAngle,
      fLk: f.locked ? 1 : 0, rLk: r.locked ? 1 : 0,
      surf: r.grounded ? r.surface.kind : (f.grounded ? f.surface.kind : '-'),
      heading: Math.atan2(fx, fz), course: Math.atan2(st.velocity.x, st.velocity.z),
      steerA: st.steerAngle,
    });
    n++;
  };
  const frames = Math.round(secs * 60);
  for (let i = 0; i < frames; i++) g.capture.step(1 / 60);
  phys.step = orig;
  return out;
}, [SEQ, SECS]);

console.log(`${SEQ}: ${rec.length} steps`);
console.log('step   sp  mode        y   airH  lean pitch  fG rG  fLong  fLat  rLong  rLat   fVlat rVlat  fSA    rSA   drift  surf');
for (let i = 0; i < rec.length; i += EVERY) {
  const r = rec[i];
  let d = r.course - r.heading;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  console.log(
    `${String(r.i).padStart(4)} ${r.sp.toFixed(1).padStart(5)} ${String(r.mode).padEnd(10)} ` +
    `${r.y.toFixed(1).padStart(6)} ${r.airH.toFixed(2).padStart(5)} ` +
    `${r.lean.toFixed(2).padStart(5)} ${r.pitch.toFixed(2).padStart(5)}  ` +
    `${r.fG} ${r.rG} ${r.fLong.toFixed(0).padStart(6)} ${r.fLat.toFixed(0).padStart(5)} ` +
    `${r.rLong.toFixed(0).padStart(6)} ${r.rLat.toFixed(0).padStart(5)}  ` +
    `${r.fVl.toFixed(1).padStart(6)} ${r.rVl.toFixed(1).padStart(5)} ` +
    `${r.fSA.toFixed(2).padStart(6)} ${r.rSA.toFixed(2).padStart(6)} ` +
    `${d.toFixed(2).padStart(6)}  ${r.surf}`,
  );
}
await b.close();
