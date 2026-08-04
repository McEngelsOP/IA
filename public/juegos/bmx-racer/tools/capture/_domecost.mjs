/**
 * _domecost.mjs — what the depth-rejected dome saves, timed by toggling only
 * depthTest + renderOrder on the same frame. Each pass ends in a readPixels so
 * the GPU work is actually flushed before the clock is read, and the two
 * configurations are interleaved so thermal drift cannot favour either.
 *
 * node tools/capture/_domecost.mjs <pose> [iterations] [reps]
 */
import { chromium } from 'playwright';

const pose = process.argv[2] ?? 'valley-vista';
const N = Number(process.argv[3] ?? 90);
const REPS = Number(process.argv[4] ?? 4);
const b = await chromium.launch({ args: ['--use-angle=metal'] });
const c = await b.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
const p = await c.newPage();
await p.goto('http://127.0.0.1:5173/?capture=1&pr=2', { waitUntil: 'load' });
await p.waitForFunction(() => !!window.__DESCENT__?.game?.capture, null, { timeout: 240000 });
await p.evaluate((x) => { window.__DESCENT__.game.capture.takeControl(); window.__DESCENT__.game.capture.setPose(x); }, pose);
for (let i = 0; i < 20; i++) await p.evaluate(() => window.__DESCENT__.game.capture.step(1 / 60));

const run = (test, order, n) => p.evaluate(([t, o, nn]) => {
  const s = window.__DESCENT__.engine.scene;
  const g = window.__DESCENT__.game;
  const r = window.__DESCENT__.engine.renderer;
  const dome = s.getObjectByName('sky').children.find((k) => k.name === 'sky:dome');
  dome.material.depthTest = t; dome.material.needsUpdate = true; dome.renderOrder = o;
  const gl = r.getContext();
  const px = new Uint8Array(4);
  for (let i = 0; i < 8; i++) g.post.render(s, window.__DESCENT__.engine.camera, 1 / 60, 3.0);
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  const t0 = performance.now();
  for (let i = 0; i < nn; i++) g.post.render(s, window.__DESCENT__.engine.camera, 1 / 60, 3.0);
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  return (performance.now() - t0) / nn;
}, [test, order, n]);

let bestOld = Infinity, bestNew = Infinity;
for (let i = 0; i < REPS; i++) {
  bestOld = Math.min(bestOld, await run(false, -1000, N));
  bestNew = Math.min(bestNew, await run(true, 900, N));
}
console.log(`${pose}  post.render  background-fill dome ${bestOld.toFixed(2)} ms  ->  depth-rejected ${bestNew.toFixed(2)} ms  (best of ${REPS} x ${N})`);
await b.close();
