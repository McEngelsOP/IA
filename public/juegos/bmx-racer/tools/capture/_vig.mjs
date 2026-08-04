import { chromium } from 'playwright';
import path from 'node:path';
const OUT = path.resolve('tools/capture/_out');
const b = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader','--use-angle=default','--enable-gpu','--ignore-gpu-blocklist','--enable-webgl','--force-color-profile=srgb'] });
const c = await b.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
const p = await c.newPage();
p.on('pageerror', e => console.log('  [ex]', e.message));
await p.goto('http://127.0.0.1:5173/?capture=1&pr=1', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => !!window.__DESCENT__?.game?.capture, null, { timeout: 180000 });
await p.evaluate(() => {
  const g = window.__DESCENT__.game; g.capture.takeControl();
  const comp = g.post.composite; const orig = comp.syncState.bind(comp);
  comp.syncState = (t) => { orig(t); if (window.__v !== undefined) comp.uniforms.uVignette.value = window.__v; };
});
for (const v of [0, 0.28]) {
  await p.evaluate((x) => { window.__v = x; window.__DESCENT__.game.capture.setPose('valley-vista'); }, v);
  for (let i=0;i<10;i++) await p.evaluate(() => window.__DESCENT__.game.capture.step(1/60));
  await p.evaluate(() => new Promise(r => requestAnimationFrame(() => r())));
  await p.screenshot({ path: path.join(OUT, `vig-${v}.png`) });
}
console.log('ok');
await c.close(); await b.close();
