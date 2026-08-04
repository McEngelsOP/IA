import { chromium } from 'playwright';
const SEQ = process.argv[2] ?? 'scree-speed';
const N = Number(process.argv[3] ?? 60);
const TAG = process.argv[4] ?? SEQ;
const b = await chromium.launch({ headless: true, args: ['--use-angle=default','--enable-gpu','--ignore-gpu-blocklist','--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1000, height: 560 } });
p.on('pageerror', e => console.log('PAGEERR', e.message.slice(0,400)));
p.on('console', m => { if (m.type()==='error') console.log('[err]', m.text().slice(0,600)); });
await p.goto('http://127.0.0.1:5173/?capture=1&pr=1', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => !!window.__DESCENT__?.game?.effects, null, { timeout: 240000 });
const r = await p.evaluate(([seq, n]) => {
  const g = window.__DESCENT__.game;
  g.capture.takeControl(); g.capture.setSequence(seq);
  const dust = g.effects.dust;
  let maxAlive = 0, sum = 0, gnd = 0;
  for (let i = 0; i < n; i++) {
    g.capture.step(1/60);
    if (g.race.player.bike.state.rear.grounded) gnd++;
    const a = dust.countAlive(); sum += a; if (a > maxAlive) maxAlive = a;
  }
  const st = g.race.player.bike.state;
  return { maxAlive, avgAlive: +(sum/n).toFixed(0), grounded: gnd + '/' + n,
           kmh: +(st.speed*3.6).toFixed(1), fxTime: +dust.time.toFixed(2),
           instanceCount: dust.mesh.geometry.instanceCount };
}, [SEQ, N]);
console.log(TAG, JSON.stringify(r));
await p.evaluate(() => new Promise(r => requestAnimationFrame(() => r())));
await p.screenshot({ path: `captures/_v_${TAG}.png` });
await b.close();
