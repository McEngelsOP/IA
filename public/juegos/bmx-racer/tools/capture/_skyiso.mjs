/**
 * Throwaway: isolate what draws the rectangular block in the upper sky.
 * Screenshots the pose with individual scene subtrees hidden.
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

const names = await page.evaluate(() => {
  const g = window.__DESCENT__.game;
  return g.engine.scene.children.map((c) => `${c.name || c.type}|${c.type}|${c.children.length}`);
});
console.log('scene children:\n  ' + names.join('\n  '));

async function shot(tag, hideFn) {
  await page.evaluate((p) => window.__DESCENT__.game.capture.setPose(p), POSE);
  for (let i = 0; i < 12; i++) await page.evaluate(() => window.__DESCENT__.game.capture.step(1 / 60));
  await page.evaluate(hideFn);
  await page.evaluate(() => window.__DESCENT__.game.capture.step(1 / 60));
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
  await page.screenshot({ path: path.join(OUT, `iso-${POSE}-${tag}.png`) });
  // restore
  await page.evaluate(() => {
    window.__DESCENT__.game.engine.scene.traverse((o) => { if (o.__wasHidden) { o.visible = true; delete o.__wasHidden; } });
  });
  console.log('  ✓', tag);
}

// 1. sky group only (hide every other top-level child)
await shot('skyonly', () => {
  const s = window.__DESCENT__.game.engine.scene;
  for (const c of s.children) if (c.name !== 'sky') { c.__wasHidden = true; c.visible = false; }
});
// 2. everything except the sky dome
await shot('nosky', () => {
  const s = window.__DESCENT__.game.engine.scene;
  for (const c of s.children) if (c.name === 'sky') { c.__wasHidden = true; c.visible = false; }
});
// 3. all
await shot('all', () => {});

await ctx.close();
await browser.close();
