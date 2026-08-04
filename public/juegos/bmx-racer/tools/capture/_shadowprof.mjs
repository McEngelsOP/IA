import { chromium } from 'playwright';
const [, , pose] = process.argv;
const browser = await chromium.launch({ args: ['--use-angle=metal'] });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:5173/?capture=1&pr=2', { waitUntil: 'load' });
await page.waitForFunction(() => window.__DESCENT__?.game?.capture, { timeout: 120000 });
const out = await page.evaluate(async (p) => {
  const g = window.__DESCENT__.game;
  g.capture.takeControl(); g.capture.setPose(p);
  g.post.profile = true;
  for (let i = 0; i < 90; i++) g.capture.step(1 / 60);
  const a = JSON.parse(JSON.stringify(g.post.stats));
  // now with shadows off, to isolate their cost
  const keep = g.post.shadows.enabled;
  g.post.shadows.enabled = false;
  for (let i = 0; i < 90; i++) g.capture.step(1 / 60);
  const b = JSON.parse(JSON.stringify(g.post.stats));
  g.post.shadows.enabled = keep;
  return { on: a, off: b };
}, pose);
console.log(pose, JSON.stringify(out, null, 1));
await browser.close();
