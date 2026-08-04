/**
 * _rav.mjs — THE RAVINE, AS GEOMETRY AND AS A JUMP.
 *
 * Prints the terrain and ribbon profile along the route through the ravine at
 * 1 m stations, marks the near and far lips and the gap the spline declares,
 * and then rides in from the run-in at a range of speeds and reports where the
 * rider actually lands.
 *
 * Usage: node tools/capture/_rav.mjs [--speeds 18,20,22,24]
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
const SPEEDS = String(args.speeds ?? '18,20,22,24').split(',').map(Number);

const b = await chromium.launch({
  headless: true,
  args: ['--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'],
});
const p = await b.newPage();
p.on('pageerror', (e) => console.log('ERR', e.message.slice(0, 300)));
await p.goto('http://127.0.0.1:5173/?capture=1&pr=1', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => !!window.__DESCENT__?.game?.capture, null, { timeout: 300000 });

const res = await p.evaluate((speeds) => {
  const g = window.__DESCENT__.game;
  const track = g.track;
  const spline = track.spline ?? track;
  g.capture.takeControl();

  // Locate the ravine: the declared gap nearest the RavineGap section.
  const gaps = (spline.gaps ?? []).map((x) => ({ start: x.start, end: x.end }));
  const total = track.length;

  // Profile along the route through the whole ravine neighbourhood.
  const prof = [];
  const gapMid = gaps.length ? (gaps[0].start + gaps[0].end) / 2 : total * 0.6765;
  for (let d = gapMid - 60; d <= gapMid + 60; d += 1) {
    const s = track.sampleAtDistance(d);
    const th = g.terrain.heightAt(s.position.x, s.position.z);
    prof.push({
      d: +d.toFixed(0), rel: +(d - gapMid).toFixed(0),
      ribbon: +s.position.y.toFixed(2), terr: +th.toFixed(2),
      x: +s.position.x.toFixed(1), z: +s.position.z.toFixed(1),
      gap: spline.isGap ? !!spline.isGap(d) : false,
      hw: +(s.halfWidth ?? 0).toFixed(1),
    });
  }

  // Ride in.
  const runs = [];
  for (const speed of speeds) {
    // Spawn 45 m before the near lip, on the ground.
    const nearLip = gaps.length ? gaps[0].start : gapMid - 6;
    const d0 = nearLip - 45;
    g.capture.setPose('ridge-exposure');
    const smp = track.sampleAtDistance(d0);
    const bike = g.race.player.bike;
    const pos = smp.position.clone();
    pos.y += 0.267 - 0.03;
    bike.reset(pos, smp.tangent.clone());
    bike.state.velocity.copy(smp.tangent).multiplyScalar(speed);
    for (const r of g.race.racers) {
      if (r === g.race.player) continue;
      r.bike.state.position.y -= 4000;
      r.bike.state.velocity.set(0, 0, 0);
    }
    g.race.player.scripted = {
      steer: 0, pedal: 0, brakeRear: 0, brakeFront: 0, crouch: 0,
      pitchLean: 0, airPitch: 0, airYaw: 0, airRoll: 0, wantBoost: false, wantHop: false,
    };
    const st = bike.state;
    const tr = [];
    let takeoff = -1, land = -1, minY = 1e9, peakRise = -1e9, launchY = 0;
    let prevG = true;
    for (let i = 0; i < 300; i++) {
      g.capture.step(1 / 60);
      const gnd = bike.physics.front.grounded || bike.physics.rear.grounded;
      const d = spline.project(st.position).distance;
      if (prevG && !gnd && takeoff < 0 && d > nearLip - 45) { takeoff = i; launchY = st.position.y; }
      if (takeoff >= 0 && !prevG && gnd && land < 0) land = i;
      prevG = gnd;
      if (takeoff >= 0 && land < 0) {
        minY = Math.min(minY, st.position.y);
        peakRise = Math.max(peakRise, st.position.y - launchY);
      }
      if (i % 10 === 0 || (takeoff >= 0 && land < 0 && i % 5 === 0)) {
        tr.push({
          i, d: +d.toFixed(1), y: +st.position.y.toFixed(2),
          terr: +g.terrain.heightAt(st.position.x, st.position.z).toFixed(2),
          sp: +st.speed.toFixed(1), mode: st.mode, gnd: gnd ? 1 : 0,
        });
      }
    }
    const dEnd = spline.project(st.position).distance;
    runs.push({
      speed, takeoff, land, launchY: +launchY.toFixed(2),
      peakRise: +peakRise.toFixed(2),
      finalD: +dEnd.toFixed(1), finalY: +st.position.y.toFixed(2),
      finalSpeed: +st.speed.toFixed(1), mode: st.mode,
      cleared: dEnd > (gaps.length ? gaps[0].end : gapMid + 6) + 5,
      trace: tr,
    });
  }
  return { gaps, gapMid, prof, runs, total };
}, SPEEDS);

console.log(`declared gaps: ${JSON.stringify(res.gaps.map((x) => ({ s: +x.start.toFixed(1), e: +x.end.toFixed(1), w: +(x.end - x.start).toFixed(1) })))}`);
console.log(`ravine centre at track distance ${res.gapMid.toFixed(1)} of ${res.total.toFixed(0)}\n`);
console.log('PROFILE along the route (rel = metres from gap centre)');
console.log(' rel   ribbonY   terrainY   drop   gap  hw     grad(terr/m)');
let prevT = null;
for (const r of res.prof) {
  if (r.rel % 2 !== 0 && Math.abs(r.rel) > 24) { prevT = r.terr; continue; }
  const grad = prevT === null ? 0 : r.terr - prevT;
  prevT = r.terr;
  console.log(
    `${String(r.rel).padStart(4)} ${String(r.ribbon).padStart(9)} ${String(r.terr).padStart(10)} ` +
    `${String((r.terr - r.ribbon).toFixed(2)).padStart(7)}  ${r.gap ? 'GAP' : '  .'}  ${r.hw}   ${grad.toFixed(2)}`,
  );
}
console.log('\nRIDE-IN from 45 m before the near lip:');
for (const r of res.runs) {
  console.log(
    `\n v0=${r.speed}  takeoff@f${r.takeoff} land@f${r.land} launchY ${r.launchY} peakRise ${r.peakRise} ` +
    `→ finalD ${r.finalD} finalY ${r.finalY} v ${r.finalSpeed} ${r.mode} ${r.cleared ? 'CLEARED' : 'FELL IN'}`,
  );
  console.log('   ' + r.trace.map((t) => `f${t.i}:d${t.d}/y${t.y}/t${t.terr}/${t.sp}${t.gnd ? 'G' : 'a'}`).join(' '));
}
await b.close();
