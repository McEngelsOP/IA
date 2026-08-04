/**
 * Throwaway probe: screenshot a pose with a named scene subtree hidden, so a
 * mystery shape can be attributed to the thing that actually draws it.
 *
 *   node tools/capture/_who.mjs <pose> <nameSubstring> <out.png>
 *   node tools/capture/_who.mjs <pose> --list
 */
import { chromium } from 'playwright';

const [, , pose, target, out] = process.argv;
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('[err]', e.message.split('\n')[0]));
await page.goto('http://127.0.0.1:5173/?capture=1&pr=2', { waitUntil: 'load' });
await page.waitForFunction(() => window.__DESCENT__ && window.__DESCENT__.game, { timeout: 60000 });
await page.evaluate((p) => window.__DESCENT__.game.capture.setPose(p), pose);
await page.evaluate(() => { for (let i = 0; i < 12; i++) window.__DESCENT__.game.capture.step(1 / 60); });

if (target === '--list') {
  const names = await page.evaluate(() => {
    const g = window.__DESCENT__.game;
    const scene = g.engine.scene;
    const out = [];
    const walk = (o, d) => {
      if (d > 3) return;
      out.push(' '.repeat(d) + (o.name || o.type) + ' [' + o.type + '] children=' + o.children.length);
      for (const c of o.children) walk(c, d + 1);
    };
    if (scene) walk(scene, 0);
    else out.push('no scene; keys=' + Object.keys(g).join(','));
    return out;
  });
  console.log(names.join('\n'));
} else {
  const hit = await page.evaluate((t) => {
    const g = window.__DESCENT__.game;
    const scene = g.engine.scene;
    let n = 0;
    scene.traverse((o) => {
      if (o.name && o.name.includes(t)) { o.visible = false; n++; }
    });
    return n;
  }, target);
  console.log('hid', hit, 'objects matching', target);
  await page.evaluate(() => { for (let i = 0; i < 2; i++) window.__DESCENT__.game.capture.step(1 / 60); });
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
  await page.screenshot({ path: out, animations: 'disabled' });
  console.log('wrote', out);
}
await browser.close();
