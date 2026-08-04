/**
 * _ab.mjs — isolate which effect owns a screen feature.
 *
 * NOTE, AND THIS IS THE WHOLE TRAP: PostPipeline.render() calls
 * composite.syncState(time), which reloads EVERY composite uniform out of
 * POST_STATE. Writing a uniform and then rendering therefore changes nothing —
 * an earlier A/B that did exactly that concluded the shafts were innocent when
 * it had in fact measured nothing at all. The override has to be installed on
 * syncState itself so it survives the reload.
 *
 * Usage: node tools/capture/_ab.mjs <pose> [pose...]
 */
import { chromium } from 'playwright';
import path from 'node:path';
import { mkdirSync } from 'node:fs';

const OUT = path.resolve('tools/capture/_out');
mkdirSync(OUT, { recursive: true });
const poses = process.argv.slice(2);
if (!poses.length) poses.push('treeline-silhouette');

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

for (const pose of poses) {
  await p.evaluate((x) => window.__DESCENT__.game.capture.setPose(x), pose);
  for (let i = 0; i < 12; i++) await p.evaluate(() => window.__DESCENT__.game.capture.step(1 / 60));
  const state = await p.evaluate(() => {
    const g = window.__DESCENT__.game;
    const m = g.engine.scene.getObjectByName('sky:shafts');
    const u = g.post.composite.uniforms;
    return {
      speed: +u.uSpeedIntensity.value.toFixed(4),
      focus: [+u.uSpeedFocus.value.x.toFixed(3), +u.uSpeedFocus.value.y.toFixed(3)],
      shaft: m ? +m.material.uniforms.uIntensity.value.toFixed(4) : null,
      chroma: +u.uChroma.value.toFixed(4),
      radial: +u.uRadialBlur.value.toFixed(4),
      bloom: +u.uBloomIntensity.value.toFixed(3),
    };
  });
  console.log(pose, JSON.stringify(state));

  for (const [name, ov, shaft] of [
    ['base', {}, null],
    ['noSpeed', { uSpeedIntensity: 0 }, null],
    ['noShaft', {}, 0],
    ['neither', { uSpeedIntensity: 0 }, 0],
  ]) {
    await p.evaluate(([o, sh]) => {
      window.__OV__ = o;
      const g = window.__DESCENT__.game;
      const m = g.engine.scene.getObjectByName('sky:shafts');
      if (m) m.visible = sh !== 0;
      g.post.render(g.engine.scene, g.engine.camera, 1 / 60, performance.now() / 1000);
      g.hud.render(g.engine.renderer);
      if (m) m.visible = true;
      window.__OV__ = {};
    }, [ov, shaft]);
    await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
    await p.screenshot({ path: path.join(OUT, `ab-${pose}-${name}.png`), animations: 'disabled' });
  }
  console.log('  wrote 4 variants');
}
await c.close();
await b.close();
