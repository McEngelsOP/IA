/** Throwaway probe: world size of one shadow texel in each cascade. */
import { chromium } from 'playwright';
const b = await chromium.launch({ args: ['--use-angle=metal'] });
const c = await b.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
const p = await c.newPage();
await p.goto('http://127.0.0.1:5173/?capture=1&pr=2', { waitUntil: 'load' });
await p.waitForFunction(() => window.__DESCENT__?.game?.capture, { timeout: 120000 });
console.log(await p.evaluate(() => {
  const s = window.__DESCENT__.game.post.shadows;
  return JSON.stringify({ texelWorld: s.texelWorldSize(), sizes: s.sizes ?? 'private' });
}));
await b.close();
