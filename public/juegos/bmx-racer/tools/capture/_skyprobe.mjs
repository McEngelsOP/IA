/**
 * Throwaway probe: isolate which pass draws the pale wedges / vertical seam.
 * Renders one pose four ways — as-is, no shafts, no speed lines, neither.
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const POSE = process.argv[2] ?? 'finish-sprint';
const OUT = path.resolve('tools/capture/_out');

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-angle=default', '--enable-gpu',
    '--ignore-gpu-blocklist', '--enable-webgl', '--force-color-profile=srgb'],
});
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('  [ex]', e.message));
await page.goto('http://127.0.0.1:5173/?capture=1&pr=1', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!window.__DESCENT__?.game?.capture, null, { timeout: 180000 });
await page.evaluate(() => window.__DESCENT__.game.capture.takeControl());
await mkdir(OUT, { recursive: true });

async function shot(name, shafts, speed) {
  await page.evaluate((p) => window.__DESCENT__.game.capture.setPose(p), POSE);
  await page.evaluate(([sh, sp]) => {
    const g = window.__DESCENT__.game;
    const m = g.engine.scene.getObjectByName('sky:shafts');
    if (m) m.visible = sh;
    window.__probeSpeed = sp;
    if (!window.__probePatched) {
      window.__probePatched = true;
      const comp = g.post.composite;
      const orig = comp.syncState.bind(comp);
      comp.syncState = (t) => {
        orig(t);
        if (window.__probeSpeed === false) comp.uniforms.uSpeedIntensity.value = 0;
      };
    }
  }, [shafts, speed]);
  for (let i = 0; i < 14; i++) {
    await page.evaluate(() => window.__DESCENT__.game.capture.step(1 / 60));
  }
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
  await page.screenshot({ path: path.join(OUT, `probe-${POSE}-${name}.png`) });
  console.log('  ✓', name);
}

await shot('all', true, true);
await shot('noshaft', false, true);
await shot('nospeed', true, false);
await shot('neither', false, false);

await ctx.close();
await browser.close();
