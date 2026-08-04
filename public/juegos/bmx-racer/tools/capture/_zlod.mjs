/**
 * Force the terrain zone lookup to a fixed mip level and shoot a pose.
 *
 * The question this answers: is a material tongue on screen a fact about the
 * zone FIELD, or about the majority mip chain the shader reads it through?
 * Pinning the level answers it in one frame.
 *
 *   node tools/capture/_zlod.mjs <pose> <lodMax> <out.png>
 */
import { chromium } from 'playwright';

const pose = process.argv[2] ?? 'valley-vista';
const lod = Number(process.argv[3] ?? 0);
const out = process.argv[4] ?? '/tmp/zlod.png';

const b = await chromium.launch({
  args: ['--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist', '--force-color-profile=srgb'],
});
const c = await b.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
const p = await c.newPage();
p.on('pageerror', (e) => console.log('[exc]', e.message));
await p.goto('http://127.0.0.1:5173/?capture=1&pr=2', { waitUntil: 'domcontentloaded', timeout: 60000 });
await p.waitForFunction(() => !!window.__DESCENT__?.game?.capture, null, { timeout: 180000 });
await p.evaluate(() => window.__DESCENT__.game.capture.takeControl());
await p.evaluate((x) => window.__DESCENT__.game.capture.setPose(x), pose);
await p.evaluate(() => { for (let i = 0; i < 12; i++) window.__DESCENT__.game.capture.step(1 / 60); });

const n = await p.evaluate((l) => {
  let hit = 0;
  window.__DESCENT__.engine.scene.traverse((o) => {
    const m = o.material;
    if (m && m.uniforms && m.uniforms.uZoneLodMax) { m.uniforms.uZoneLodMax.value = l; hit++; }
  });
  return hit;
}, lod);
console.log('materials patched:', n, ' lodMax =', lod);

await p.evaluate(() => { for (let i = 0; i < 2; i++) window.__DESCENT__.game.capture.step(1 / 60); });
await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
await p.screenshot({ path: out, animations: 'disabled' });
console.log('  ok', out);
await c.close();
await b.close();
