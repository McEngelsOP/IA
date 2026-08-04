import { chromium } from 'playwright';
import path from 'node:path';
const OUT = path.resolve('tools/capture/_out');
const b = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader','--use-angle=default','--enable-gpu','--ignore-gpu-blocklist','--enable-webgl','--force-color-profile=srgb'] });
const c = await b.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
const p = await c.newPage();
p.on('pageerror', e => console.log('  [ex]', e.message));
await p.goto('http://127.0.0.1:5173/?capture=1&pr=1', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => !!window.__DESCENT__?.game?.capture, null, { timeout: 180000 });
await p.evaluate(() => window.__DESCENT__.game.capture.takeControl());
for (const pose of ['treeline-silhouette','summit-wide','finish-sprint']) {
  await p.evaluate((x) => window.__DESCENT__.game.capture.setPose(x), pose);
  for (let i=0;i<10;i++) await p.evaluate(() => window.__DESCENT__.game.capture.step(1/60));
  // Force the fan fully on, ignoring the visibility ramp, then render one frame.
  const info = await p.evaluate(() => {
    const g = window.__DESCENT__.game;
    const m = g.engine.scene.getObjectByName('sky:shafts');
    const u = m.material.uniforms;
    const before = u.uIntensity.value;
    const sky = g.sky; const camera = g.engine.camera;
    sky.update(camera, 1.0);
    u.uSunView.value.set(0.16, 0.42, -0.89).normalize();
    u.uIntensity.value = 0.55;
    g.post.render(g.engine.scene, camera, 1/60, performance.now()/1000);
    g.hud.render(g.engine.renderer);
    return { before, sunView: [u.uSunView.value.x, u.uSunView.value.y, u.uSunView.value.z] };
  });
  await p.evaluate(() => new Promise(r => requestAnimationFrame(() => r())));
  await p.screenshot({ path: path.join(OUT, `shaft-${pose}.png`) });
  console.log(' ', pose, 'settled intensity', info.before.toFixed(3), 'sunView', info.sunView.map(v=>v.toFixed(2)).join(','));
}
await c.close(); await b.close();
