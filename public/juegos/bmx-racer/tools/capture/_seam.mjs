/**
 * Seam probe. Shoots one crop of a pose under a list of mutations so the
 * source of a hard line can be identified by elimination rather than guessed.
 *
 *   node tools/capture/_seam.mjs <pose> <x> <y> <w> <h>
 *
 * Coordinates are CSS pixels (the screenshot clip is CSS-space); multiply the
 * native coordinate by 0.5.
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const [, , pose, xS, yS, wS, hS] = process.argv;
const CLIP = { x: Number(xS), y: Number(yS), width: Number(wS), height: Number(hS) };
await mkdir('captures/_seam', { recursive: true });

const b = await chromium.launch({
  args: ['--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'],
});
const ctx = await b.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
const p = await ctx.newPage();
p.on('pageerror', (e) => console.log('PAGEERR', e.message.slice(0, 300)));
await p.goto('http://127.0.0.1:5173/?capture=1&pr=2', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => !!window.__DESCENT__?.game?.capture, null, { timeout: 240000 });
await p.evaluate((po) => {
  const g = window.__DESCENT__.game;
  g.capture.takeControl();
  g.capture.setPose(po);
  for (let i = 0; i < 14; i++) g.capture.step(1 / 60);
}, pose);

const CASES = {
  base: () => {},
  noLines: () => { window.__DESCENT__.game.post.composite.setDebug(0); window.__DESCENT__.game.post.lines.uniforms && 0; window.__DESCENT__.game.post.lines.material.uniforms.uInkStrength && (window.__DESCENT__.game.post.lines.material.uniforms.uInkStrength.value = 0); },
  noTrack: () => { window.__DESCENT__.game.track.object.visible = false; },
  noFoliage: () => { window.__DESCENT__.engine.scene.traverse((o) => { if ((o.name || '').includes('foliage') || (o.name || '').includes('scatter')) o.visible = false; }); },
  dbgDepth: () => { window.__DESCENT__.game.post.setDebugView('lines-depth'); },
  dbgNormal: () => { window.__DESCENT__.game.post.setDebugView('lines-normal'); },
  dbgId: () => { window.__DESCENT__.game.post.setDebugView('lines-id'); },
  dbgField: () => { window.__DESCENT__.game.post.setDebugView('lines'); },
  reset: () => { window.__DESCENT__.game.post.setDebugView('off'); window.__DESCENT__.game.track.object.visible = true; },
};

for (const [name, fn] of Object.entries(CASES)) {
  try { await p.evaluate(`(${fn.toString()})()`); } catch (e) { console.log('skip', name, String(e).slice(0, 120)); }
  await p.evaluate(() => window.__DESCENT__.game.capture.step(1e-6));
  await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
  if (name === 'reset') break;
  await p.screenshot({ path: `captures/_seam/${name}.png`, clip: CLIP, animations: 'disabled' });
  console.log('ok', name);
  // Undo the per-case mutation before the next one, except the cumulative ones.
  if (name === 'noTrack') await p.evaluate(() => { window.__DESCENT__.game.track.object.visible = true; });
}
await b.close();
