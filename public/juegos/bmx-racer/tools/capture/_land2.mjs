import { chromium } from 'playwright';
const b = await chromium.launch({ headless: true, args: ['--use-angle=default','--enable-gpu','--ignore-gpu-blocklist','--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1000, height: 560 } });
p.on('pageerror', e => console.log('PAGEERR', e.message.slice(0,300)));
await p.goto('http://127.0.0.1:5173/?capture=1&pr=2', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => !!window.__DESCENT__?.game?.effects, null, { timeout: 240000 });
const r = await p.evaluate(() => {
  const g = window.__DESCENT__.game, fx = g.effects;
  g.capture.takeControl(); g.capture.setPose('rider-threequarter');
  for (let i = 0; i < 12; i++) g.capture.step(1/60);
  const st = g.race.player.bike.state;
  fx.debris.clear();
  const d0 = fx.dust.countAlive();
  // A hard landing on loose ground: exactly what notifyLanding sees.
  st.landingImpact = 0.9;
  const surf = { kind: 3, grip:.46, rollingResistance:.7, drag:.22, dustAmount: 1.35, harshness: 1.15, audioTone:'gravel' };
  st.rear.surface = surf; st.front.surface = surf;
  fx.notifyLanding(st);
  const d1 = fx.dust.countAlive();
  const after = { d0, d1, sprayPuffs: d1 - d0, debrisChips: fx.debris.liveCount,
                  emittedThisFrame: fx.dust.emittedThisFrame,
                  rearGrounded: st.rear.grounded, cp: st.rear.contactPoint.toArray().map(v=>+v.toFixed(1)),
                  fxTime: +fx.dust.time.toFixed(2) };
  g.capture.step(1/60);
  const u = g.post.composite.uniforms;
  return { ...after, flashThisFrame: +u.uImpactFlash.value.toFixed(3), timeScale: +fx.timeScale.toFixed(2) };
});
console.log(JSON.stringify(r));
await p.evaluate(() => new Promise(r => requestAnimationFrame(() => r())));
await p.screenshot({ path: 'captures/_v_landspray.png' });
await b.close();
