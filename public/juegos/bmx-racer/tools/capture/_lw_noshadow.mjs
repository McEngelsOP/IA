/**
 * Throwaway probe (line-work agent): kill the sun shadow term in every material
 * (shared uniform object) and capture, to separate shadow artefacts from ink.
 *   node tools/capture/_lw_noshadow.mjs <pose> <out.png> [url]
 */
import { chromium } from 'playwright';
const pose = process.argv[2] ?? 'treeline-silhouette';
const out = process.argv[3] ?? 'captures/lw/noshadow.png';
const URL_BASE = process.argv[4] ?? 'http://127.0.0.1:5173';
const b = await chromium.launch({ args: ['--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist'] });
const c = await b.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
const p = await c.newPage();
p.on('pageerror', (e) => console.log('[exc]', e.message));
await p.goto(`${URL_BASE}/?capture=1&pr=2`, { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => !!window.__DESCENT__?.game?.capture, null, { timeout: 240000 });
await p.evaluate((pose) => {
  const g = window.__DESCENT__.game;
  g.capture.takeControl();
  g.capture.setPose(pose);
  for (let i = 0; i < 12; i++) g.capture.step(1 / 60);
  const seen = new Set();
  window.__DESCENT__.engine.scene.traverse((o) => {
    const mats = [].concat(o.material ?? [], o.userData?.hullMaterial ?? [], o.userData?.prepassMaterial ?? []);
    for (const m of mats) {
      if (!m || !m.uniforms || seen.has(m)) continue;
      seen.add(m);
      if (m.uniforms.uShadowStrength) m.uniforms.uShadowStrength.value = 0;
    }
  });
  for (let i = 0; i < 2; i++) g.capture.step(1 / 60);
}, pose);
await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
await p.screenshot({ path: out, animations: 'disabled' });
console.log('wrote', out);
await b.close();
