/**
 * _skyab.mjs — override arbitrary composite uniforms and shoot the same pose.
 *
 * Same trap as _ab.mjs: PostPipeline.render() calls composite.syncState(), which
 * reloads every uniform out of POST_STATE, so the override is installed ON
 * syncState rather than written before a render.
 *
 * Usage: node tools/capture/_skyab.mjs <pose> <tag>=<uniform>:<value>[,<uniform>:<value>] ...
 *   node tools/capture/_skyab.mjs ravine-gap base= noVig=uVignette:0 noSpd=uSpeedIntensity:0
 */
import { chromium } from 'playwright';
import path from 'node:path';
import { mkdirSync } from 'node:fs';

const OUT = path.resolve('tools/capture/_out');
mkdirSync(OUT, { recursive: true });
const [pose, ...specs] = process.argv.slice(2);

const variants = specs.map((s) => {
  const eq = s.indexOf('=');
  const tag = s.slice(0, eq);
  const body = s.slice(eq + 1);
  const ov = {};
  if (body.trim()) {
    for (const kv of body.split(',')) {
      const [k, v] = kv.split(':');
      ov[k] = Number(v);
    }
  }
  return [tag, ov];
});

const b = await chromium.launch({
  args: ['--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--force-color-profile=srgb'],
});
const c = await b.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
const p = await c.newPage();
p.on('pageerror', (e) => console.log('  [ex]', e.message));
await p.goto('http://127.0.0.1:5173/?capture=1&pr=2', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => !!window.__DESCENT__?.game?.capture, null, { timeout: 240000 });
await p.evaluate(() => {
  const cp = window.__DESCENT__.game.post.composite;
  const orig = cp.syncState.bind(cp);
  window.__OV__ = {};
  cp.syncState = (t) => { orig(t); for (const k in window.__OV__) cp.uniforms[k].value = window.__OV__[k]; };
  window.__DESCENT__.game.capture.takeControl();
});

await p.evaluate((x) => window.__DESCENT__.game.capture.setPose(x), pose);
for (let i = 0; i < 12; i++) await p.evaluate(() => window.__DESCENT__.game.capture.step(1 / 60));

for (const [tag, ov] of variants) {
  await p.evaluate((o) => {
    window.__OV__ = o;
    const g = window.__DESCENT__.game;
    g.post.render(g.engine.scene, g.engine.camera, 1 / 60, performance.now() / 1000);
    g.hud.render(g.engine.renderer);
    window.__OV__ = {};
  }, ov);
  await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
  await p.screenshot({ path: path.join(OUT, `sab-${pose}-${tag}.png`), animations: 'disabled' });
  console.log('wrote', `sab-${pose}-${tag}.png`, JSON.stringify(ov));
}
await c.close();
await b.close();
