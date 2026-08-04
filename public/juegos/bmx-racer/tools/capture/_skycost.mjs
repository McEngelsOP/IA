/**
 * _skycost.mjs — what the dome costs, by rendering the same frame with the sky
 * group visible and hidden and differencing the wall time. A GPU-bound shader
 * only shows up if the measurement forces a flush, so each pass ends with a
 * readPixels of one pixel.
 *
 * node tools/capture/_skycost.mjs <pose> [iterations]
 */
import { chromium } from 'playwright';

const pose = process.argv[2] ?? 'valley-vista';
const N = Number(process.argv[3] ?? 120);
const b = await chromium.launch({ args: ['--use-angle=metal'] });
const c = await b.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
const p = await c.newPage();
await p.goto('http://127.0.0.1:5173/?capture=1&pr=2', { waitUntil: 'load' });
await p.waitForFunction(() => !!window.__DESCENT__?.game?.capture, null, { timeout: 240000 });
await p.evaluate((x) => { window.__DESCENT__.game.capture.takeControl(); window.__DESCENT__.game.capture.setPose(x); }, pose);
for (let i = 0; i < 20; i++) await p.evaluate(() => window.__DESCENT__.game.capture.step(1 / 60));

const run = (show, n) => p.evaluate(([sh, nn]) => {
  const g = window.__DESCENT__.game;
  const r = window.__DESCENT__.engine.renderer;
  const sky = window.__DESCENT__.engine.scene.getObjectByName('sky');
  sky.visible = sh;
  const px = new Uint8Array(4);
  for (let i = 0; i < 10; i++) g.post.render(window.__DESCENT__.engine.scene, window.__DESCENT__.engine.camera, 1 / 60, i / 60);
  const gl = r.getContext();
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  const t0 = performance.now();
  for (let i = 0; i < nn; i++) g.post.render(window.__DESCENT__.engine.scene, window.__DESCENT__.engine.camera, 1 / 60, i / 60);
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  const t = (performance.now() - t0) / nn;
  sky.visible = true;
  return t;
}, [show, n]);

const on = await run(true, N);
const off = await run(false, N);
console.log(`${pose}  post.render with sky ${on.toFixed(3)} ms, without ${off.toFixed(3)} ms, dome costs ${(on - off).toFixed(3)} ms/frame at 3200x1800`);
await b.close();
