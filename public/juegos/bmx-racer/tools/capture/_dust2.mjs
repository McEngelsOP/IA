import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';

const b = await chromium.launch({ headless: true, args: ['--use-angle=default','--enable-gpu','--ignore-gpu-blocklist','--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 900, height: 520 } });
p.on('pageerror', e => console.log('PAGEERR', e.message.slice(0,400)));
p.on('console', m => { const t=m.type(); if(t==='error') console.log(`[page:${t}]`, m.text().slice(0,1200)); });
await p.setViewportSize({ width: 900, height: 520 });
await p.goto('http://127.0.0.1:5173/?capture=1&pr=1', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => !!window.__DESCENT__?.game?.effects, null, { timeout: 240000 });

await p.evaluate(() => {
  const g = window.__DESCENT__.game;
  g.capture.takeControl();
  g.capture.setSequence('scree-speed');
  for (let i = 0; i < 60; i++) g.capture.step(1/60);
});
await p.screenshot({ path: 'captures/_probe_base.png' });

// Now force a huge burst right at the rider and step one frame.
const info = await p.evaluate(() => {
  const g = window.__DESCENT__.game;
  const st = g.race.player.bike.state;
  const dust = g.effects.dust;
  const THREE = dust.object.constructor; // Object3D ctor, unused
  const surf = st.rear.surface ?? { kind: 3, dustAmount: 1.35, grip: 1, rollResist: 1, audioTone: 'x' };
  const pos = st.rear.contactPoint.clone();
  const nrm = st.rear.contactNormal.clone();
  // 40 bursts of ~24 puffs each
  for (let i = 0; i < 40; i++) dust.burst(pos, nrm, st.velocity, 1.0, surf);
  let alive = 0;
  const pool = dust.pool, aP = pool.array('aParams');
  const ft = dust.time;
  for (let i = 0; i < pool.capacity; i++) {
    const age = (ft - aP[i*4]) * aP[i*4+1];
    if (age >= 0 && age < 1) alive++;
  }
  return { aliveAfterBurst: alive, pos: pos.toArray().map(v=>+v.toFixed(1)), instanceCount: dust.mesh.geometry.instanceCount };
});
await p.evaluate(() => { window.__DESCENT__.game.capture.step(1/60); });
await p.evaluate(() => new Promise(r => requestAnimationFrame(() => r())));
await p.screenshot({ path: 'captures/_probe_burst.png' });

const after = await p.evaluate(() => {
  const dust = window.__DESCENT__.game.effects.dust;
  const pool = dust.pool, aP = pool.array('aParams'); const ft = dust.time;
  let alive = 0;
  for (let i = 0; i < pool.capacity; i++) { const age = (ft - aP[i*4]) * aP[i*4+1]; if (age >= 0 && age < 1) alive++; }
  return { aliveAtDraw: alive, instanceCount: dust.mesh.geometry.instanceCount, fxTime: dust.time };
});
console.log(JSON.stringify({ ...info, ...after }, null, 1));
await b.close();
