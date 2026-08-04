/**
 * Throwaway: is the cloud seam a mip/anisotropy artefact, a wrap artefact, or
 * a uv artefact? Toggle the sampler state at runtime and look.
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

async function shot(tag, mode) {
  await page.evaluate(([m, p]) => {
    const g = window.__DESCENT__.game;
    const dome = g.engine.scene.getObjectByName('sky:dome');
    const u = dome.material.uniforms;
    for (const k of ['uCloudNear', 'uCloudFar']) {
      const t = u[k].value;
      if (m === 'nomip') { t.minFilter = 1006; t.generateMipmaps = false; }
      else if (m === 'noaniso') { t.anisotropy = 1; t.minFilter = 1008; t.generateMipmaps = true; }
      else { t.anisotropy = 8; t.minFilter = 1008; t.generateMipmaps = true; }
      t.needsUpdate = true;
      t.dispose();
    }
    g.capture.setPose(p);
  }, [mode, POSE]);
  for (let i = 0; i < 12; i++) await page.evaluate(() => window.__DESCENT__.game.capture.step(1 / 60));
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
  await page.screenshot({ path: path.join(OUT, `tex-${POSE}-${tag}.png`) });
  console.log('  ✓', tag);
}

await shot('normal', 'normal');
await shot('nomip', 'nomip');
await shot('noaniso', 'noaniso');

await ctx.close();
await browser.close();
