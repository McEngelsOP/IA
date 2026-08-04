/**
 * _nohud.mjs — the full frame with the HUD suppressed.
 *
 * The horizon probe measures EDGE COINCIDENCE PER ROW, and the HUD panels are
 * opaque rectangles whose bottom edges are perfectly level across hundreds of
 * columns. On a pose like treeline-silhouette they own the measurement outright
 * (100% coincidence at y=249 in a window the panels cross), which is a true
 * statement about the HUD and tells you nothing at all about the sky. This
 * renders the composite without the HUD pass so the probe sees only the frame.
 *
 * node tools/capture/_nohud.mjs <pose> [pose...]
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
await p.evaluate(() => window.__DESCENT__.game.capture.takeControl());

for (const pose of poses) {
  await p.evaluate((x) => window.__DESCENT__.game.capture.setPose(x), pose);
  for (let i = 0; i < 12; i++) await p.evaluate(() => window.__DESCENT__.game.capture.step(1 / 60));
  await p.evaluate(() => {
    const g = window.__DESCENT__.game;
    g.post.render(g.engine.scene, g.engine.camera, 1 / 60, performance.now() / 1000);
  });
  await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
  await p.screenshot({ path: path.join(OUT, `nohud-${pose}.png`), animations: 'disabled' });
  console.log('  wrote', `nohud-${pose}.png`);
}
await c.close();
await b.close();
