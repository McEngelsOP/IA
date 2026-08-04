/**
 * _smearprobe.mjs — dump the live smear + post state at a list of poses.
 *
 *   node tools/capture/_smearprobe.mjs pose1,pose2,...
 */
import { chromium } from 'playwright';

const POSES = (process.argv[2] ?? 'tabletop-air,bike-detail,streambed,rider-threequarter,crash,rider-closeup')
  .split(',')
  .filter(Boolean);

const b = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist'],
});
const p = await b.newPage({ viewport: { width: 1200, height: 675 } });
p.on('pageerror', (e) => console.log('PAGEERR', e.message.slice(0, 300)));
await p.goto('http://127.0.0.1:5173/?capture=1&pr=2', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => !!window.__DESCENT__?.game?.capture, null, { timeout: 240000 });
await p.evaluate(() => window.__DESCENT__.game.capture.takeControl());

console.log('pose'.padEnd(20), 'spd'.padStart(6), 'omega'.padStart(6), 'mode'.padEnd(10), 'cur'.padStart(6), 'amt'.padStart(6), 'opac'.padStart(6), 'velMax'.padStart(9), 'vis');
for (const pose of POSES) {
  const ok = await p.evaluate((n) => window.__DESCENT__.game.capture.setPose(n), pose);
  if (!ok) { console.log('unknown', pose); continue; }
  const out = await p.evaluate(() => {
    const g = window.__DESCENT__.game;
    for (let i = 0; i < 12; i++) g.capture.step(1 / 60);
    const sp = g.effects.speed;
    const st = g.race.player.bike.state;
    let cur = 0, amt = 0, opac = 0, velMax = 0, vis = 0, n = 0;
    for (const e of sp.entries.values()) {
      cur = Math.max(cur, e.current);
      for (const q of e.parts) {
        n++;
        amt = Math.max(amt, q.material.uniforms.uAmount.value);
        opac = Math.max(opac, q.material.uniforms.uOpacity.value);
        velMax = Math.max(velMax, q.vel.value.length());
        if (q.mesh.visible) vis++;
      }
    }
    return {
      speed: st.speed, mode: st.mode, omega: st.angularVelocity.length(),
      cur, amt, opac, velMax, vis, n, camVel: sp.camVel.value.length(),
    };
  });
  console.log(
    pose.padEnd(20),
    out.speed.toFixed(2).padStart(6),
    out.omega.toFixed(3).padStart(6),
    out.mode.padEnd(10),
    out.cur.toFixed(3).padStart(6),
    out.amt.toFixed(3).padStart(6),
    out.opac.toFixed(3).padStart(6),
    out.velMax.toFixed(1).padStart(9),
    `${out.vis}/${out.n}`,
    'camV=' + out.camVel.toFixed(1),
  );
}
await b.close();
