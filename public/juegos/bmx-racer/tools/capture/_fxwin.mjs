/**
 * _fxwin.mjs — shoot a WINDOW of a sequence, and retry the whole run if the
 * dev server reloads under us.
 *
 *   node tools/capture/_fxwin.mjs <seq> <from> <to> [tag] [pr]
 *
 * capture.mjs shoots a sequence from frame 0, which for a 110-frame review
 * window is two minutes of wall clock — long enough that a concurrent edit to
 * any source file reloads the page and destroys the run. This steps silently up
 * to `from` and only then opens the shutter, so a window costs the frames it
 * contains plus the run-up.
 */
import { chromium } from 'playwright';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';

const SEQ = process.argv[2] ?? 'crash';
const FROM = Number(process.argv[3] ?? 0);
const TO = Number(process.argv[4] ?? 20);
const TAG = process.argv[5] ?? SEQ;
const PR = Number(process.argv[6] ?? 2);
const OUT = path.resolve('captures/win', TAG);

const ATTEMPTS = 6;

for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
  try {
    await run();
    console.log(`✓ ${TAG} f${FROM}..f${TO} -> ${OUT}`);
    process.exit(0);
  } catch (e) {
    console.log(`  attempt ${attempt} failed: ${String(e.message).split('\n')[0]}`);
    await new Promise((r) => setTimeout(r, 4000));
  }
}
process.exit(1);

async function run() {
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  const b = await chromium.launch({
    headless: true,
    args: ['--enable-unsafe-swiftshader', '--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist'],
  });
  try {
    const p = await b.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: PR });
    p.on('pageerror', (e) => console.log('PAGEERR', e.message.slice(0, 300)));
    p.on('console', (m) => { if (m.type() === 'error') console.log('[err]', m.text().slice(0, 300)); });
    await p.goto(`http://127.0.0.1:5173/?capture=1&pr=${PR}`, { waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => !!window.__DESCENT__?.game?.capture, null, { timeout: 240000 });
    await p.evaluate(() => window.__DESCENT__.game.capture.takeControl());
    const ok = await p.evaluate((n) => window.__DESCENT__.game.capture.setSequence(n), SEQ);
    if (!ok) throw new Error(`unknown sequence ${SEQ}`);
    // Same settle as capture.mjs, so frame indices line up with the review set.
    await step(p, 4);
    if (FROM > 0) await step(p, FROM);
    for (let f = FROM; f <= TO; f++) {
      await step(p, 1);
      await p.screenshot({
        path: path.join(OUT, `f${String(f).padStart(4, '0')}.png`),
        animations: 'disabled',
      });
    }
  } finally {
    await b.close();
  }
}

async function step(p, n) {
  await p.evaluate((count) => {
    for (let i = 0; i < count; i++) window.__DESCENT__.game.capture.step(1 / 60);
  }, n);
  await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
}
