/**
 * _dir.mjs — which way does the corner go, and which way does steer go?
 *
 * The `switchback` capture holds steer +0.9. Before blaming the handling model
 * for not turning, establish the sign convention empirically: the track's own
 * heading change over the next 60 m, and the heading change the bike makes for
 * +steer and -steer from the same spawn.
 */
import { chromium } from 'playwright';

const b = await chromium.launch({
  headless: true,
  args: ['--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'],
});
const p = await b.newPage();
p.on('pageerror', (e) => console.log('ERR', e.message.slice(0, 300)));
await p.goto('http://127.0.0.1:5173/?capture=1&pr=1', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => !!window.__DESCENT__?.game?.capture, null, { timeout: 300000 });

const res = await p.evaluate(() => {
  const g = window.__DESCENT__.game;
  g.capture.takeControl();
  const out = { track: [], runs: [] };

  // Track heading along the switchback, from the sequence spawn.
  g.capture.setSequence('switchback');
  const st0 = g.race.player.bike.state;
  const d0 = g.track.project(st0.position).distance;
  let prev = null;
  for (let s = 0; s <= 120; s += 10) {
    const smp = g.track.sampleAtDistance(d0 + s);
    const h = Math.atan2(smp.tangent.x, smp.tangent.z);
    out.track.push({ s, heading: +h.toFixed(3), dh: prev === null ? 0 : +(h - prev).toFixed(3), bank: +(smp.bank ?? 0).toFixed(2) });
    prev = h;
  }

  const run = (steer) => {
    g.capture.setSequence('switchback');
    g.race.player.scripted.steer = steer;
    const bike = g.race.player.bike;
    const st = bike.state;
    const start = { d: g.track.project(st.position).distance };
    const q0 = st.orientation;
    const h0 = Math.atan2(2 * (q0.x * q0.z + q0.w * q0.y), 1 - 2 * (q0.x * q0.x + q0.y * q0.y));
    for (let i = 0; i < 132; i++) g.capture.step(1 / 60);
    const pr = g.track.project(st.position);
    const q = st.orientation;
    const h = Math.atan2(2 * (q.x * q.z + q.w * q.y), 1 - 2 * (q.x * q.x + q.y * q.y));
    let dh = h - h0;
    while (dh > Math.PI) dh -= 2 * Math.PI;
    while (dh < -Math.PI) dh += 2 * Math.PI;
    return {
      steer,
      progress: +(pr.distance - start.d).toFixed(1),
      lateral: +pr.lateral.toFixed(2),
      vert: +pr.vertical.toFixed(2),
      dHeading: +dh.toFixed(3),
      lean: +st.lean.toFixed(2),
      speed: +st.speed.toFixed(2),
      mode: st.mode,
    };
  };
  for (const s of [0.9, -0.9, 0]) out.runs.push(run(s));
  return out;
});

console.log('TRACK heading along the switchback from the capture spawn:');
console.log('  s   heading   d(heading)  bank');
for (const t of res.track) {
  console.log(`  ${String(t.s).padStart(3)}  ${String(t.heading).padStart(7)}  ${String(t.dh).padStart(9)}  ${t.bank}`);
}
console.log('\nBIKE after 2.2 s from the same spawn:');
console.log('  steer  progress  lateral  vert  dHeading  lean  speed  mode');
for (const r of res.runs) {
  console.log(
    `  ${String(r.steer).padStart(5)}  ${String(r.progress).padStart(8)}  ${String(r.lateral).padStart(7)}  ` +
    `${String(r.vert).padStart(5)} ${String(r.dHeading).padStart(9)}  ${String(r.lean).padStart(5)}  ` +
    `${String(r.speed).padStart(5)}  ${r.mode}`,
  );
}
await b.close();
