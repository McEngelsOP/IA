/** Tight crop on the rider's head at rider-closeup, for face iteration. */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
const TAG = process.argv[2] ?? 'x';
const POSE = process.argv[3] ?? 'rider-closeup';
await mkdir('captures/_face', { recursive: true });
const b = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader','--use-angle=default','--enable-gpu','--ignore-gpu-blocklist','--force-color-profile=srgb'] });
const ctx = await b.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
const p = await ctx.newPage();
p.on('pageerror', e => console.log('PAGEERR', e.message.slice(0,300)));
await p.goto('http://127.0.0.1:5173/?capture=1&pr=2', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => !!window.__DESCENT__?.game?.capture, null, { timeout: 240000 });
await p.evaluate(() => window.__DESCENT__.game.capture.takeControl());
await p.evaluate((n) => window.__DESCENT__.game.capture.setPose(n), POSE);
await p.evaluate(() => { for (let i=0;i<12;i++) window.__DESCENT__.game.capture.step(1/60); });
await p.evaluate(() => new Promise(r => requestAnimationFrame(() => r())));
await p.screenshot({ path: `captures/_face/${TAG}.png`, clip: { x: 630, y: 380, width: 170, height: 150 }, animations: 'disabled' });
console.log('ok', TAG);
await b.close();
