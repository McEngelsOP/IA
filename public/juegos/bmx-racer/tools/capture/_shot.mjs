import { chromium } from 'playwright';
const poses = (process.argv[2] ?? 'rider-threequarter').split(',');
const tag = process.argv[3] ?? 'a';
const b = await chromium.launch({ headless: true, args: ['--use-angle=default','--enable-gpu','--ignore-gpu-blocklist','--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1100, height: 700 } });
p.on('pageerror', e => console.log('ERR', e.message.slice(0,300)));
await p.goto('http://127.0.0.1:5173/?capture=1&pr=1', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => !!window.__DESCENT__?.game?.capture, null, { timeout: 240000 });
await p.evaluate(() => window.__DESCENT__.game.capture.takeControl());
for (const pose of poses) {
  await p.evaluate((n) => { window.__DESCENT__.game.capture.setPose(n); for (let i=0;i<14;i++) window.__DESCENT__.game.capture.step(1/60); }, pose);
  await p.evaluate(() => new Promise(r => requestAnimationFrame(()=>r())));
  await p.screenshot({ path: `captures/_shot_${tag}_${pose}.png` });
  console.log('shot', pose);
}
await b.close();
