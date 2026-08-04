import { chromium } from 'playwright';
const b = await chromium.launch({ headless: true, args: ['--use-angle=default','--enable-gpu','--ignore-gpu-blocklist','--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 800, height: 450 } });
p.on('pageerror', e => console.log('PAGEERR', e.message.slice(0,300)));
await p.goto('http://127.0.0.1:5173/?capture=1&pr=1', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => !!window.__DESCENT__?.game?.effects, null, { timeout: 240000 });
console.log(JSON.stringify(await p.evaluate(() => {
  const g = window.__DESCENT__.game, fx = g.effects;
  g.capture.takeControl(); g.capture.setSequence('landing');
  const modes = []; let lands = 0, impacts = [];
  const st = g.race.player.bike.state;
  for (let i = 0; i < 80; i++) {
    g.capture.step(1/60);
    modes.push(st.mode[0]);
    if (st.landedThisStep) { lands++; impacts.push(+st.landingImpact.toFixed(2)); }
  }
  return { modeString: modes.join(''), landedThisStepSeen: lands, impacts,
           sameSubject: fx.subject === st, airTime: +st.airTime.toFixed(2),
           peakAir: +st.peakAirHeight.toFixed(2) };
}, null), null, 1));
await b.close();
