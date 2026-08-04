/** Hide one rider part at a time and shoot the head crop, to identify a form. */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
await mkdir('captures/_hide', { recursive: true });
const b = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader','--use-angle=default','--enable-gpu','--ignore-gpu-blocklist','--force-color-profile=srgb'] });
const ctx = await b.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
const p = await ctx.newPage();
p.on('pageerror', e => console.log('PAGEERR', e.message.slice(0,300)));
await p.goto('http://127.0.0.1:5173/?capture=1&pr=2', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => !!window.__DESCENT__?.game?.capture, null, { timeout: 240000 });
await p.evaluate(() => window.__DESCENT__.game.capture.takeControl());
await p.evaluate(() => window.__DESCENT__.game.capture.setPose('rider-closeup'));
await p.evaluate(() => { for (let i=0;i<12;i++) window.__DESCENT__.game.capture.step(1/60); });
const CLIP = { x: 630, y: 380, width: 170, height: 150 };
for (const part of ['none','skin','helmet','lens','rubber']) {
  await p.evaluate((t) => {
    window.__DESCENT__.engine.scene.traverse((o) => {
      const n = o.name || '';
      if (!n.startsWith('rider:player:')) return;
      const base = n.replace(':hull','');
      o.visible = !(t !== 'none' && base.endsWith(':' + t));
    });
  }, part);
  await p.evaluate(() => window.__DESCENT__.game.capture.step(1e-6));
  await p.evaluate(() => new Promise(r => requestAnimationFrame(() => r())));
  await p.screenshot({ path: `captures/_hide/${part}.png`, clip: CLIP, animations: 'disabled' });
  console.log('ok', part);
}
await b.close();
