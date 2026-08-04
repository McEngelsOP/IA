import { chromium } from 'playwright';
const b = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader','--use-angle=default','--enable-gpu','--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1200, height: 675 } });
await p.goto('http://127.0.0.1:5173/?capture=1&pr=2', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => !!window.__DESCENT__?.game?.capture, null, { timeout: 240000 });
await p.evaluate(() => window.__DESCENT__.game.capture.takeControl());
for (const pose of ['crash','summit-wide','valley-vista']) {
  await p.evaluate((n) => window.__DESCENT__.game.capture.setPose(n), pose);
  const rows = await p.evaluate(() => {
    const g = window.__DESCENT__.game; const out = [];
    for (let i = 0; i < 12; i++) {
      g.capture.step(1/60);
      const st = g.race.player.bike.state;
      let cur = 0; for (const e of g.effects.speed.entries.values()) cur = Math.max(cur, e.current);
      out.push(`${i} spd=${st.speed.toFixed(2)} om=${st.angularVelocity.length().toFixed(2)} mode=${st.mode} cur=${cur.toFixed(3)}`);
    }
    return out;
  });
  console.log('==', pose); console.log(rows.join('\n'));
}
await b.close();
