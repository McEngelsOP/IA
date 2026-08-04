/**
 * _skyonly.mjs — sky dome alone (everything else hidden), plus each uSkyDebug
 * channel, so a sky feature can be attributed to a term.
 *
 * node tools/capture/_skyonly.mjs <pose> [tag]
 */
import { chromium } from 'playwright';
import path from 'node:path';
import { mkdirSync } from 'node:fs';

const OUT = path.resolve('tools/capture/_out');
mkdirSync(OUT, { recursive: true });
const pose = process.argv[2] ?? 'treeline-silhouette';
const tag = process.argv[3] ?? '';

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

const draw = (dbg, hideShafts) => p.evaluate(([d, hs]) => {
  const s = window.__DESCENT__.engine.scene;
  const g = window.__DESCENT__.game;
  for (const o of s.children) o.visible = o.name === 'sky';
  const sh = s.getObjectByName('sky:shafts');
  if (sh) sh.visible = !hs;
  g.sky.setDebug(d);
  // Kill every post dial that could add its own structure.
  const u = g.post.composite.uniforms;
  u.uSpeedIntensity.value = 0; u.uChroma.value = 0; u.uRadialBlur.value = 0;
  u.uBloomIntensity.value = 0; u.uLineOpacity.value = 0; u.uVignette.value = 0;
  u.uGrainStrength.value = 0;
  g.post.render(s, window.__DESCENT__.engine.camera, 1 / 60, performance.now() / 1000);
}, [dbg, hideShafts]);

for (const [name, dbg, hs] of [
  ['plain', 0, true], ['withshafts', 0, false],
  ['near', 1, true], ['far', 2, true], ['bank', 3, true],
  ['wander', 4, true], ['detail', 5, true],
]) {
  await draw(dbg, hs);
  await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
  await p.screenshot({ path: path.join(OUT, `sky${tag}-${pose}-${name}.png`), animations: 'disabled' });
  console.log('  wrote', `sky${tag}-${pose}-${name}.png`);
}
await c.close();
await b.close();
