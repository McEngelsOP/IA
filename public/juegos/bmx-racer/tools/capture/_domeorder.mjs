/**
 * _domeorder.mjs — prove that depth-testing the dome and drawing it last among
 * the opaques is PIXEL-NEUTRAL, by toggling exactly those two properties at
 * runtime on the same frame and differencing.
 *
 * Toggling at runtime rather than editing the file is the point: nothing else
 * about the frame — time, drift phase, camera, sim state — can move between the
 * two shots, so any difference is the change and nothing else.
 *
 * node tools/capture/_domeorder.mjs <pose> [pose...]
 */
import { chromium } from 'playwright';
import path from 'node:path';
import { mkdirSync } from 'node:fs';

const OUT = path.resolve('tools/capture/_out');
mkdirSync(OUT, { recursive: true });
const poses = process.argv.slice(2);
if (!poses.length) poses.push('scree-speed');

const b = await chromium.launch({
  args: ['--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--force-color-profile=srgb'],
});
const c = await b.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
const p = await c.newPage();
p.on('pageerror', (e) => console.log('  [ex]', e.message));
await p.goto('http://127.0.0.1:5173/?capture=1&pr=2', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => !!window.__DESCENT__?.game?.capture, null, { timeout: 240000 });
await p.evaluate(() => window.__DESCENT__.game.capture.takeControl());

for (const pose of poses) {
  await p.evaluate((x) => window.__DESCENT__.game.capture.setPose(x), pose);
  for (let i = 0; i < 12; i++) await p.evaluate(() => window.__DESCENT__.game.capture.step(1 / 60));
  for (const [name, test, order] of [['new', true, 900], ['old', false, -1000]]) {
    await p.evaluate(([t, o]) => {
      const s = window.__DESCENT__.engine.scene;
      const dome = s.getObjectByName('sky').children.find((k) => k.name === 'sky:dome');
      dome.material.depthTest = t;
      dome.material.needsUpdate = true;
      dome.renderOrder = o;
      const g = window.__DESCENT__.game;
      g.post.render(s, window.__DESCENT__.engine.camera, 1 / 60, 3.0);
    }, [test, order]);
    await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
    await p.screenshot({ path: path.join(OUT, `dome-${pose}-${name}.png`), animations: 'disabled' });
  }
  // Leave it in the shipping configuration.
  await p.evaluate(() => {
    const dome = window.__DESCENT__.engine.scene.getObjectByName('sky').children.find((k) => k.name === 'sky:dome');
    dome.material.depthTest = true; dome.material.needsUpdate = true; dome.renderOrder = 900;
  });
  console.log('  wrote', pose);
}
await c.close();
await b.close();
