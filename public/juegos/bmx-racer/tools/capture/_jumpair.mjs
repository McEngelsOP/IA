// Does the bike actually leave the ground on the tabletop?
//   A) the capture pose 'tabletop-air' (has an artificial launch impulse)
//   B) a NATURAL run: put the rider on the run-in at speed, let the kicker do it
import { chromium } from 'playwright';
import { Vector3 } from 'three';
const browser = await chromium.launch({
  args: ['--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'],
});
const page = await (await browser.newContext({ viewport: { width: 900, height: 500 } })).newPage();
page.on('pageerror', (e) => console.log('  [exception] ' + e.message));
await page.goto('http://127.0.0.1:5173/?capture=1&pr=1', { waitUntil: 'load' });
await page.waitForFunction(() => window.__DESCENT__?.game?.capture, null, { timeout: 300000 });

const out = await page.evaluate(async (speeds) => {
  const g = window.__DESCENT__.game;
  const s = g.track.spline ?? g.track;
  const L = [];
  g.capture.takeControl();

  const run = (label, setup, frames) => {
    setup();
    const st = g.race.player.bike.state;
    let modes = '', peak = 0, airFrames = 0, launchD = -1, landD = -1, maxY = -1e9, minGap = 1e9;
    let prevAir = false;
    for (let i = 0; i < frames; i++) {
      g.capture.step(1 / 60);
      const air = st.mode[0] === 'a';
      modes += air ? 'A' : st.mode[0] === 'c' ? 'X' : '.';
      if (air) airFrames++;
      peak = Math.max(peak, st.peakAirHeight, st.airHeight ?? 0);
      const d = s.project(st.position).distance;
      if (air && !prevAir && launchD < 0) launchD = d;
      if (!air && prevAir && launchD >= 0 && landD < 0) landD = d;
      maxY = Math.max(maxY, st.position.y);
      const terr = g.terrain.heightAt(st.position.x, st.position.z);
      minGap = Math.min(minGap, st.position.y - terr);
      prevAir = air;
    }
    L.push(
      `${label}\n  modes ${modes}\n  airFrames=${airFrames}/${frames}  peakAirHeight=${peak.toFixed(2)}m  ` +
      `launch@d=${launchD.toFixed(1)} land@d=${landD.toFixed(1)} flight=${(landD - launchD).toFixed(1)}m  ` +
      `minClearance=${minGap.toFixed(2)}m  finalSpeed=${(st.speed * 3.6).toFixed(1)}km/h`,
    );
  };

  // A) the shipped capture pose.
  run('A) pose tabletop-air (launch impulse 7.4)', () => g.capture.setPose('tabletop-air'), 100);

  // B) natural: drop the rider on the run-in and let the kicker do the work.
  const BIKE = (await import('/src/game/WorldConstants.ts')).BIKE;
  for (const sp of speeds) {
    run(`B) natural run-in @ ${sp} m/s (${(sp * 3.6).toFixed(0)} km/h), no launch impulse`, () => {
      const d = 2378;
      const sm = s.sampleAtDistance(d);
      const p = sm.position.clone();
      const gy = g.terrain.heightAt(p.x, p.z);
      p.y = Math.max(p.y, gy) + BIKE.wheelRadius - 0.03;
      const bike = g.race.player.bike;
      bike.reset(p, sm.tangent.clone());
      bike.state.velocity.copy(sm.tangent).multiplyScalar(sp);
      g.race.player.scripted = {
        steer: 0, pedal: 0, brakeRear: 0, brakeFront: 0, crouch: 0, pitchLean: 0,
        airPitch: 0, airYaw: 0, airRoll: 0, wantBoost: false, wantHop: false,
      };
    }, 150);
  }
  L.push('');
  L.push(`track length ${s.length.toFixed(1)}  tabletopTakeoff=${s.tabletopTakeoff.toFixed(1)} landing=${s.tabletopLanding.toFixed(1)}`);
  return L.join('\n');
}, [14, 18, 22]);
console.log(out);
await browser.close();
