/**
 * _hunt.mjs — list top-level scene objects, then capture the pose with each one
 * hidden in turn, so a feature can be attributed to an object by diffing.
 *
 * node tools/capture/_hunt.mjs <pose>
 */
import { chromium } from 'playwright';
import path from 'node:path';
import { mkdirSync } from 'node:fs';

const OUT = path.resolve('tools/capture/_out');
mkdirSync(OUT, { recursive: true });
const pose = process.argv[2] ?? 'treeline-silhouette';

const b = await chromium.launch({
  args: ['--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--force-color-profile=srgb'],
});
const c = await b.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
const p = await c.newPage();
p.on('pageerror', (e) => console.log('  [ex]', e.message));
await p.goto('http://127.0.0.1:5173/?capture=1&pr=1', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => !!window.__DESCENT__?.game?.capture, null, { timeout: 240000 });
await p.evaluate(() => window.__DESCENT__.game.capture.takeControl());
await p.evaluate((x) => window.__DESCENT__.game.capture.setPose(x), pose);
for (let i = 0; i < 12; i++) await p.evaluate(() => window.__DESCENT__.game.capture.step(1 / 60));

const names = await p.evaluate(() => {
  const s = window.__DESCENT__.engine.scene;
  return s.children.map((o, i) => `${i}:${o.name || o.type}`);
});
console.log(names.join('\n'));

await p.screenshot({ path: path.join(OUT, `hunt-${pose}-all.png`) });
for (let i = 0; i < names.length; i++) {
  const vis = await p.evaluate((idx) => {
    const s = window.__DESCENT__.engine.scene;
    const o = s.children[idx];
    if (!o.visible) return false;
    o.visible = false;
    const g = window.__DESCENT__.game;
    g.post.render(s, window.__DESCENT__.engine.camera, 1 / 60, performance.now() / 1000);
    g.hud.render(window.__DESCENT__.engine.renderer);
    return true;
  }, i);
  if (!vis) { console.log(`  ${names[i]} already hidden`); continue; }
  await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
  await p.screenshot({ path: path.join(OUT, `hunt-${pose}-${i}.png`) });
  await p.evaluate((idx) => { window.__DESCENT__.engine.scene.children[idx].visible = true; }, i);
}
console.log('done');
await c.close();
await b.close();
