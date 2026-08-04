import { chromium } from 'playwright';
const b = await chromium.launch({ args: ['--use-angle=default','--enable-gpu','--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
await p.goto('http://127.0.0.1:5173/?capture=1&pr=2', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => !!window.__DESCENT__?.game?.capture, null, { timeout: 240000 });
const r = await p.evaluate(() => {
  const g = window.__DESCENT__.game;
  g.capture.takeControl(); g.capture.setPose('scree-speed');
  for (let i = 0; i < 30; i++) g.capture.step(1/60);
  let ms = 0, lay = 0, mpx = 0, calls = 0;
  for (let i = 0; i < 120; i++) { g.capture.step(1/60);
    ms += g.hud.stats.redrawMs; lay += g.hud.stats.layersRedrawn;
    mpx += g.hud.stats.megapixels; calls = g.hud.stats.drawCalls; }
  return { redrawMs: +(ms/120).toFixed(3), layersPerFrame: +(lay/120).toFixed(2),
           mpxPerFrame: +(mpx/120).toFixed(3), drawCalls: calls };
});
console.log(JSON.stringify(r));
await b.close();
