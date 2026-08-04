/**
 * _patch.mjs — shoot a pose with named uniforms overridden and/or meshes hidden.
 *
 * Attribution, not aesthetics: when a mark is on screen and three subsystems
 * could have drawn it, the only honest way to name the one that did is to turn
 * each off in isolation and shoot the same frame.
 *
 *   node tools/capture/_patch.mjs <pose> <out.png> [uName=value ...] [--hide substr]
 *
 * Uniform overrides are applied to EVERY material in the scene that declares a
 * uniform of that name, and to the composite pass's own uniform block.
 */
import { chromium } from 'playwright';

const pose = process.argv[2] ?? 'finish-sprint';
const out = process.argv[3] ?? '/tmp/patch.png';
const rest = process.argv.slice(4);
const hides = [];
const sets = [];
for (let i = 0; i < rest.length; i++) {
  if (rest[i] === '--hide') { hides.push(rest[++i]); continue; }
  const [k, v] = rest[i].split('=');
  sets.push([k, Number(v)]);
}

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

const report = await p.evaluate(({ sets, hides }) => {
  const D = window.__DESCENT__;
  const log = [];
  const mats = new Set();
  D.engine.scene.traverse((o) => {
    if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => mats.add(m));
    for (const s of hides) {
      if ((o.isMesh || o.isLine || o.isPoints) && (o.name || '').includes(s)) {
        Object.defineProperty(o, 'visible', { get: () => false, set: () => {}, configurable: true });
      }
    }
  });
  // The composite/post materials do not live under the scene graph.
  const post = D.game.post ?? D.engine.post ?? null;
  const extra = [];
  const walk = (obj, depth) => {
    if (!obj || depth > 3 || typeof obj !== 'object') return;
    for (const k of Object.keys(obj)) {
      const v = obj[k];
      if (v && v.isMaterial) extra.push(v);
      else if (v && typeof v === 'object' && !v.isTexture && !ArrayBuffer.isView(v)) walk(v, depth + 1);
    }
  };
  walk(post, 0);
  for (const m of extra) mats.add(m);
  for (const [k, val] of sets) {
    let n = 0;
    for (const m of mats) if (m.uniforms && m.uniforms[k]) { m.uniforms[k].value = val; n++; }
    log.push(`${k}=${val} -> ${n} materials`);
  }
  return { log, mats: mats.size };
}, { sets, hides });
console.log(report.mats, 'materials;', report.log.join('; '), hides.length ? `hidden: ${hides.join(',')}` : '');

await p.evaluate(() => { for (let i = 0; i < 2; i++) window.__DESCENT__.game.capture.step(1 / 60); });
await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
await p.screenshot({ path: out, animations: 'disabled' });
console.log('  ok', out);
await c.close();
await b.close();
