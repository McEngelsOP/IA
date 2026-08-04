import { chromium } from 'playwright';
const TAG = process.argv[2] ?? 'rig';
const b = await chromium.launch({ headless: true, args: ['--use-angle=default','--enable-gpu','--ignore-gpu-blocklist','--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 900, height: 560 } });
p.on('pageerror', e => console.log('PAGEERR', e.message.slice(0,300)));
p.on('console', m => { if (m.type()==='error') console.log('[err]', m.text().slice(0,600)); });
await p.goto('http://127.0.0.1:5173/?capture=1&pr=2', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => !!window.__DESCENT__?.game?.effects, null, { timeout: 240000 });
const r = await p.evaluate(() => {
  const g = window.__DESCENT__.game;
  g.capture.takeControl();
  g.capture.setPose('rider-threequarter');
  for (let i = 0; i < 12; i++) g.capture.step(1/60);
  const st = g.race.player.bike.state, dust = g.effects.dust;
  const surf = { kind: 3, grip: .42, rollingResistance: 1, drag: 1, dustAmount: 1.35, harshness: 1, audioTone: 'gravel' };
  // A steady plume: emit over several frames so ages fan out like a real trail.
  for (let f = 0; f < 22; f++) {
    dust.trail(st.rear.contactPoint, st.rear.contactNormal, st.velocity, 60, 1/60, surf);
    g.capture.step(1/60);
  }
  return { alive: dust.countAlive(), kmh: +(st.speed*3.6).toFixed(1) };
});
console.log(TAG, JSON.stringify(r));
await p.evaluate(() => new Promise(r => requestAnimationFrame(() => r())));
await p.screenshot({ path: `captures/_rig_${TAG}.png` });
await b.close();
