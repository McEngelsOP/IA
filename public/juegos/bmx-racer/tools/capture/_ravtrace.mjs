import { chromium } from 'playwright';
const b = await chromium.launch({ args: ['--use-angle=default','--enable-gpu','--ignore-gpu-blocklist','--enable-unsafe-swiftshader'] });
const p = await (await b.newContext({ viewport: { width: 900, height: 500 } })).newPage();
p.on('pageerror', (e) => console.log('ERR ' + e.message));
await p.goto('http://127.0.0.1:5173/?capture=1&pr=1', { waitUntil: 'load' });
await p.waitForFunction(() => window.__DESCENT__?.game?.capture, null, { timeout: 300000 });
const out = await p.evaluate(() => {
  const g = window.__DESCENT__.game, s = g.track.spline ?? g.track;
  g.capture.takeControl(); g.capture.setPose('ravine-gap');
  const st = g.race.player.bike.state; const L = [];
  for (let i = 0; i < 90; i++) {
    g.capture.step(1/60);
    const d = s.project(st.position).distance;
    const th = g.terrain.heightAt(st.position.x, st.position.z);
    if (i % 3 === 0 || (st.position.y - th) < -1) {
      L.push(`f${String(i).padStart(2)} ${st.mode[0]} d=${d.toFixed(1)} y=${st.position.y.toFixed(2)} terr=${th.toFixed(2)} clr=${(st.position.y-th).toFixed(2)} gap=${s.isGap(d)?'Y':'.'}`);
    }
  }
  return L.join('\n');
});
console.log(out);
await b.close();
