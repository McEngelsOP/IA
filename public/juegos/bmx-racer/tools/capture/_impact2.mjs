import { chromium } from 'playwright';
const b = await chromium.launch({ headless: true, args: ['--use-angle=default','--enable-gpu','--ignore-gpu-blocklist','--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 800, height: 450 } });
p.on('pageerror', e => console.log('PAGEERR', e.message.slice(0,300)));
p.on('console', m => { if (m.type()==='error') console.log('[err]', m.text().slice(0,700)); });
await p.goto('http://127.0.0.1:5173/?capture=1&pr=1', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => !!window.__DESCENT__?.game?.effects, null, { timeout: 240000 });
console.log('CRASH', JSON.stringify(await p.evaluate(() => {
  const g = window.__DESCENT__.game, fx = g.effects;
  g.capture.takeControl(); g.capture.setSequence('crash');
  const rows = [];
  for (let i = 0; i < 60; i++) {
    g.capture.step(1/60);
    const u = g.post.composite.uniforms;
    if (u.uImpactFlash.value > 0.005) rows.push([i, +u.uImpactFlash.value.toFixed(3), +u.uInkFlood.value.toFixed(3), +fx.timeScale.toFixed(2)]);
  }
  return { flashFrames: rows.length, rows };
}, null)));
await b.close();
