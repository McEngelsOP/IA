import { chromium } from 'playwright';
const b = await chromium.launch({ headless: true, args: ['--use-angle=default','--enable-gpu','--ignore-gpu-blocklist','--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 800, height: 450 } });
p.on('pageerror', e => console.log('PAGEERR', e.message.slice(0,300)));
await p.goto('http://127.0.0.1:5173/?capture=1&pr=1', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => !!window.__DESCENT__?.game?.effects, null, { timeout: 240000 });
console.log(JSON.stringify(await p.evaluate(() => {
  const g = window.__DESCENT__.game, fx = g.effects;
  g.capture.takeControl(); g.capture.setSequence('landing');
  const ev = [];
  const origTrig = fx.impact.trigger.bind(fx.impact);
  fx.impact.trigger = (i, t, c) => { const r = origTrig(i, t, c); ev.push({ kind:'trigger', i:+i.toFixed(2), crash:!!c, held:r }); return r; };
  const origLand = fx.notifyLanding.bind(fx);
  fx.notifyLanding = (s) => { ev.push({ kind:'land', impact:+s.landingImpact.toFixed(2), mode:s.mode }); return origLand(s); };
  const flashes = [];
  for (let i = 0; i < 120; i++) {
    g.capture.step(1/60);
    const u = g.post.composite.uniforms;
    if (u.uImpactFlash.value > 0.005) flashes.push({ f:i, v:+u.uImpactFlash.value.toFixed(3), ink:+u.uInkFlood.value.toFixed(3), ts:+fx.timeScale.toFixed(2) });
  }
  return { events: ev.slice(0,10), flashFrameCount: flashes.length, flashes: flashes.slice(0,10) };
}, null), null, 1));
// Also: force a big landing directly and count frames.
console.log('FORCED', JSON.stringify(await p.evaluate(() => {
  const g = window.__DESCENT__.game, fx = g.effects;
  fx.impact.reset();
  fx.impact.trigger(0.95);
  const rows = [];
  for (let i = 0; i < 10; i++) {
    g.capture.step(1/60);
    const u = g.post.composite.uniforms;
    rows.push([i, +u.uImpactFlash.value.toFixed(3), +u.uInkFlood.value.toFixed(3), +u.uDesaturate.value.toFixed(3), +fx.timeScale.toFixed(2)]);
  }
  return rows;
}, null)));
await b.close();
