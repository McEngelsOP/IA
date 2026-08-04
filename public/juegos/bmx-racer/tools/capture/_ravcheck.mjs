import { chromium } from 'playwright';
const b = await chromium.launch({ args: ['--use-angle=default','--enable-gpu','--ignore-gpu-blocklist','--enable-unsafe-swiftshader'] });
const p = await (await b.newContext({ viewport: { width: 900, height: 500 } })).newPage();
p.on('pageerror', (e) => console.log('ERR ' + e.message));
await p.goto('http://127.0.0.1:5173/?capture=1&pr=1', { waitUntil: 'load' });
await p.waitForFunction(() => window.__DESCENT__?.game?.capture, null, { timeout: 300000 });
const out = await p.evaluate(() => {
  const g = window.__DESCENT__.game, s = g.track.spline ?? g.track;
  g.capture.takeControl();
  const L = [];
  for (const pose of ['ravine-gap', 'tabletop-air', 'landing', 'crash']) {
    g.capture.setPose(pose);
    const st = g.race.player.bike.state;
    let modes = '', peak = 0, minClear = 1e9;
    for (let i = 0; i < 90; i++) {
      g.capture.step(1/60);
      modes += st.mode[0] === 'a' ? 'A' : st.mode[0] === 'c' ? 'X' : '.';
      peak = Math.max(peak, st.peakAirHeight);
      minClear = Math.min(minClear, st.position.y - g.terrain.heightAt(st.position.x, st.position.z));
    }
    L.push(`${pose.padEnd(13)} air=${(modes.match(/A/g)||[]).length}/90 crash=${(modes.match(/X/g)||[]).length} peakAir=${peak.toFixed(2)} minClearance=${minClear.toFixed(2)}\n  ${modes}`);
  }
  L.push('');
  L.push('gaps: ' + JSON.stringify(s.gaps.map(x => ({ s: +x.start.toFixed(1), e: +x.end.toFixed(1), w: +(x.end-x.start).toFixed(1) }))));
  return L.join('\n');
});
console.log(out);
await b.close();
