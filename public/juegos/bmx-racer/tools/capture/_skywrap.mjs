import { chromium } from 'playwright';
import path from 'node:path';
const OUT = path.resolve('tools/capture/_out');
const b = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader','--use-angle=default','--enable-gpu','--ignore-gpu-blocklist','--enable-webgl'] });
const c = await b.newContext({ viewport: { width: 900, height: 900 }, deviceScaleFactor: 1 });
const p = await c.newPage();
p.on('pageerror', e => console.log('  [ex]', e.message));
await p.goto('http://127.0.0.1:5173/?capture=1&pr=1', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => !!window.__DESCENT__?.game?.capture, null, { timeout: 180000 });
await p.evaluate(() => window.__DESCENT__.game.capture.takeControl());
for (const [tag, wrap] of [['repeat', 1000], ['mirror', 1002]]) {
  await p.evaluate(([w]) => {
    const g = window.__DESCENT__.game;
    const u = g.engine.scene.getObjectByName('sky:dome').material.uniforms;
    u.uSkyDebug.value = 5;
    for (const k of ['uCloudNear','uCloudFar']) { const t=u[k].value; t.wrapS=w; t.wrapT=w; t.needsUpdate=true; t.dispose(); }
    g.capture.setPose('finish-sprint');
  }, [wrap]);
  for (let i=0;i<8;i++) await p.evaluate(() => window.__DESCENT__.game.capture.step(1/60));
  await p.evaluate(() => new Promise(r => requestAnimationFrame(() => r())));
  await p.screenshot({ path: path.join(OUT, `wrap-${tag}.png`) });
  console.log('  ok', tag);
}
await c.close(); await b.close();
