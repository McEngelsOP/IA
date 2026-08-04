/**
 * Throwaway probe: capture a pose with every mesh whose name contains a
 * substring forced invisible, to attribute a stray mark to the object that
 * drew it.  node tools/capture/_thide.mjs <pose> <substr> <out.png>
 */
import { chromium } from 'playwright';

const pose = process.argv[2] ?? 'treeline-silhouette';
const substr = process.argv[3] ?? '';
const out = process.argv[4] ?? '/tmp/thide.png';

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

const hidden = await p.evaluate((s) => {
  if (!s) return [];
  const g = window.__DESCENT__.game;
  const names = [];
  g.engine.scene.traverse((o) => {
    if ((o.isMesh || o.isLine || o.isPoints) && o.name.includes(s)) {
      Object.defineProperty(o, 'visible', { get: () => false, set: () => {}, configurable: true });
      names.push(o.name);
    }
  });
  return names;
}, substr);
console.log('hidden:', hidden.length, hidden.slice(0, 6).join(', '));

await p.evaluate(() => { for (let i = 0; i < 2; i++) window.__DESCENT__.game.capture.step(1 / 60); });
await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
await p.screenshot({ path: out, animations: 'disabled' });
console.log('  ok', out);
await c.close();
await b.close();
