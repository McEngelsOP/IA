import { chromium } from 'playwright';
const b = await chromium.launch({ headless: true, args: ['--use-angle=default','--enable-gpu','--ignore-gpu-blocklist','--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 800, height: 450 } });
p.on('pageerror', e => console.log('PAGEERR', e.message.slice(0,300)));
await p.goto('http://127.0.0.1:5173/?capture=1&pr=1', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => !!window.__DESCENT__?.game?.effects, null, { timeout: 240000 });
console.log(JSON.stringify(await p.evaluate(() => {
  const g = window.__DESCENT__.game;
  g.capture.takeControl(); g.capture.setSequence('scree-speed');
  const dust = g.effects.dust;
  let calls = 0, sumRate = 0, emitted = 0, gnd = 0;
  const orig = dust.trail.bind(dust);
  dust.trail = (pos,nrm,vel,rate,dt,surf) => { calls++; sumRate += rate; const before = dust.emittedThisFrame; orig(pos,nrm,vel,rate,dt,surf); emitted += dust.emittedThisFrame - before; };
  const samples = [];
  for (let i = 0; i < 90; i++) {
    g.capture.step(1/60);
    const st = g.race.player.bike.state;
    if (st.rear.grounded) gnd++;
    if (samples.length < 8 && st.rear.grounded) samples.push({
      load: Math.round(st.rear.load), slip: +(st.rear.lateralSlip??0).toFixed(2), ratio: +(st.rear.slipRatio??0).toFixed(2),
      surf: st.rear.surface?.kind, dustAmt: st.rear.surface?.dustAmount, spd: +st.speed.toFixed(1),
    });
  }
  return { calls, avgRate: +(sumRate/Math.max(calls,1)).toFixed(1), emitted, gnd, alive: dust.countAlive(), samples,
           BIKEref: null };
}, null), null, 1));
await b.close();
