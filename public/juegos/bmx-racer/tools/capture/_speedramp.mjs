/**
 * _speedramp.mjs — the speed-line field at a ladder of intensities, so the
 * "quantised shape, strength scales with speed" claim can be seen rather than
 * asserted. Also prints the peak paint fraction the shader can reach at each
 * intensity, which is the number the previous build had accidentally pinned.
 *
 * node tools/capture/_speedramp.mjs <pose>
 */
import { chromium } from 'playwright';
import path from 'node:path';
import { mkdirSync } from 'node:fs';

const OUT = path.resolve('tools/capture/_out');
mkdirSync(OUT, { recursive: true });
const pose = process.argv[2] ?? 'ridge-exposure';
const LADDER = [0.07, 0.17, 0.34, 0.52, 1.0];

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

for (const s of LADDER) {
  await p.evaluate((v) => {
    window.__OV__ = { uSpeedIntensity: v };
    const g = window.__DESCENT__.game;
    g.post.render(g.engine.scene, g.engine.camera, 1 / 60, 3.0);
    g.hud.render(g.engine.renderer);
    window.__OV__ = {};
  }, s);
  await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
  await p.screenshot({ path: path.join(OUT, `ramp-${pose}-${String(Math.round(s * 100)).padStart(3, '0')}.png`), animations: 'disabled' });
  console.log(`  intensity ${s.toFixed(2)}  peak paint ${(s * 0.62).toFixed(3)}  peak edge ${(s * 0.85).toFixed(3)}`);
}
await c.close();
await b.close();
