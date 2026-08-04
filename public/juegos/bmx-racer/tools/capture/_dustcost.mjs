/**
 * _dustcost.mjs — what does the dust actually cost?
 *
 * Hundreds of large transparent quads at close range is an OVERDRAW question,
 * not a draw-call question, and the draw-call count cannot answer it. So: settle
 * a sequence until the plume is at full population, then render the same frame
 * many times with the dust mesh visible and hidden, and difference the wall
 * clock. finish() on the GL context each pass, or the timing measures the
 * command queue rather than the work.
 *
 *   node tools/capture/_dustcost.mjs <seq> [settle] [reps]
 */
import { chromium } from 'playwright';

const SEQ = process.argv[2] ?? 'scree-speed';
const SETTLE = Number(process.argv[3] ?? 110);
const REPS = Number(process.argv[4] ?? 90);

const b = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const c = await b.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
const p = await c.newPage();
p.on('pageerror', (e) => console.log('  [ex]', e.message));
await p.goto('http://127.0.0.1:5173/?capture=1&pr=2', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => !!window.__DESCENT__?.game?.capture, null, { timeout: 240000 });
await p.evaluate(() => window.__DESCENT__.game.capture.takeControl());
await p.evaluate((s) => window.__DESCENT__.game.capture.setSequence(s), SEQ);
await p.evaluate((n) => { for (let i = 0; i < n; i++) window.__DESCENT__.game.capture.step(1 / 60); }, SETTLE);

const out = await p.evaluate(async (reps) => {
  const g = window.__DESCENT__.game;
  const gl = g.engine.renderer.getContext();
  const dust = g.effects.dust.mesh;
  const run = (visible) => {
    dust.visible = visible;
    for (let i = 0; i < 8; i++) g.post.render(g.engine.scene, g.engine.camera, 1 / 60, 0);
    gl.finish();
    const t0 = performance.now();
    for (let i = 0; i < reps; i++) g.post.render(g.engine.scene, g.engine.camera, 1 / 60, 0);
    gl.finish();
    return (performance.now() - t0) / reps;
  };
  // ALTERNATE. A single on-then-off pair measures the driver warming up as much
  // as it measures the dust — the first ordering here reported the dust as
  // costing MINUS 5.7 ms. Four interleaved passes cancel any monotonic drift.
  const on = [];
  const off = [];
  for (let k = 0; k < 4; k++) { on.push(run(true)); off.push(run(false)); }
  const med = (a) => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)];
  dust.visible = true;
  return {
    on: med(on), off: med(off), onAll: on, offAll: off,
    alive: g.effects.dust.countAlive(), instances: dust.geometry.instanceCount,
  };
}, REPS);

console.log(`${SEQ}  alive ${out.alive}  instances ${out.instances}`);
console.log(`  with dust    ${out.on.toFixed(3)} ms`);
console.log(`  without dust ${out.off.toFixed(3)} ms`);
console.log(`  dust costs   ${(out.on - out.off).toFixed(3)} ms`);
await b.close();
