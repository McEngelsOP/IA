import { chromium } from 'playwright';
const b = await chromium.launch({ headless: true, args: ['--use-angle=default','--enable-gpu','--ignore-gpu-blocklist','--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 900, height: 520 } });
p.on('pageerror', e => console.log('PAGEERR', e.message.slice(0,400)));
p.on('console', m => { if (m.type()==='error') console.log('[err]', m.text().slice(0,600)); });
await p.goto('http://127.0.0.1:5173/?capture=1&pr=2', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => !!window.__DESCENT__?.game?.effects, null, { timeout: 240000 });
const r = await p.evaluate(() => {
  const g = window.__DESCENT__.game;
  g.capture.takeControl(); g.capture.setSequence('scree-speed');
  for (let i = 0; i < 70; i++) g.capture.step(1/60);
  const fx = g.effects, sp = fx.speed, st = g.race.player.bike.state;
  return {
    smearWired: fx.smearWired, attempts: fx.smearAttempts,
    spins: sp.spins.length,
    spinVisible: sp.spins.map(s => ({ vis: s.mesh.visible, spin: +s.material.uniforms.uSpin.value.toFixed(2) })),
    frontSpinRate: +(st.front.spinRate??0).toFixed(1), rearSpinRate: +(st.rear.spinRate??0).toFixed(1),
    smearEntries: sp.entries.size,
    smearParts: [...sp.entries.values()].map(e => ({ name: e.target.name, n: e.parts.length, cur: +e.current.toFixed(2), vis: e.parts.filter(x=>x.mesh.visible).length })),
    autoTargets: sp.autoTargets.map(o => o.name),
    kmh: +(st.speed*3.6).toFixed(1),
    speedLineIntensity: +window.__DESCENT__.POST_STATE?.speedLineIntensity?.toFixed?.(3) ?? null,
  };
});
console.log(JSON.stringify(r, null, 1));
await p.evaluate(() => new Promise(r => requestAnimationFrame(() => r())));
await p.screenshot({ path: 'captures/_v_smear.png' });
await b.close();
