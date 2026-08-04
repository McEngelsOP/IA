import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
const POSE = process.argv[2] ?? 'finish-sprint';
const OUT = path.resolve('tools/capture/_out');
await mkdir(OUT, { recursive: true });
const b = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader','--use-angle=default','--enable-gpu','--ignore-gpu-blocklist','--enable-webgl','--force-color-profile=srgb'] });
const c = await b.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
const p = await c.newPage();
p.on('pageerror', e => console.log('  [ex]', e.message));
await p.goto('http://127.0.0.1:5173/?capture=1&pr=1', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => !!window.__DESCENT__?.game?.capture, null, { timeout: 180000 });
await p.evaluate(() => window.__DESCENT__.game.capture.takeControl());
for (const m of [1,2,3,4]) {
  await p.evaluate(([mode,pose]) => {
    const g = window.__DESCENT__.game;
    g.engine.scene.getObjectByName('sky:dome').material.uniforms.uSkyDebug.value = mode;
    g.capture.setPose(pose);
  }, [m, POSE]);
  for (let i=0;i<12;i++) await p.evaluate(() => window.__DESCENT__.game.capture.step(1/60));
  await p.evaluate(() => new Promise(r => requestAnimationFrame(() => r())));
  await p.screenshot({ path: path.join(OUT, `dbg-${POSE}-${m}.png`) });
  console.log('  ok', m);
}
await c.close(); await b.close();
