/**
 * Throwaway: which term of the sky dome draws the vertical seam?
 * Mutates the dome's colour uniforms so each contribution can be switched off.
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const POSE = process.argv[2] ?? 'finish-sprint';
const OUT = path.resolve('tools/capture/_out');
await mkdir(OUT, { recursive: true });

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
await page.evaluate((p) => window.__DESCENT__.game.capture.setPose(p), POSE);

async function shot(tag, patch) {
  await page.evaluate(([pt, p]) => {
    const g = window.__DESCENT__.game;
    const dome = g.engine.scene.getObjectByName('sky:dome');
    const u = dome.material.uniforms;
    if (!window.__save) {
      window.__save = {};
      for (const k of ['uCloudLit', 'uCloudMid', 'uCloudShadow', 'uSunGlow', 'uSunDisc', 'uUpper', 'uZenith']) {
        window.__save[k] = u[k].value.clone();
      }
    }
    for (const k of Object.keys(window.__save)) u[k].value.copy(window.__save[k]);
    // patch: list of [dst, src] copies
    for (const [dst, src] of pt) u[dst].value.copy(u[src].value);
    g.capture.setPose(p);
  }, [patch, POSE]);
  for (let i = 0; i < 12; i++) await page.evaluate(() => window.__DESCENT__.game.capture.step(1 / 60));
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
  await page.screenshot({ path: path.join(OUT, `dome-${POSE}-${tag}.png`) });
  console.log('  ✓', tag);
}

await shot('base', []);
// Clouds painted the same colour as the upper band -> cloud term invisible.
await shot('noclouds', [['uCloudLit', 'uUpper'], ['uCloudMid', 'uUpper'], ['uCloudShadow', 'uUpper']]);
// Sun glow painted as the upper band -> the azimuthal warm term + rings vanish.
await shot('noglow', [['uSunGlow', 'uUpper'], ['uSunDisc', 'uUpper']]);
await shot('neither', [['uCloudLit', 'uUpper'], ['uCloudMid', 'uUpper'], ['uCloudShadow', 'uUpper'],
  ['uSunGlow', 'uUpper'], ['uSunDisc', 'uUpper']]);

await ctx.close();
await browser.close();
