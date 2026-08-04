/**
 * _seqshot.mjs — shoot NAMED FRAMES of a sequence, and retry the whole run if
 * the page reloads underneath us.
 *
 *   node tools/capture/_seqshot.mjs switchback 70,71,72 [outdir]
 *
 * Seven agents share one dev server. Vite reloads the page whenever any of them
 * saves a file, which kills a 120-frame `capture.mjs --seq` run at whatever
 * frame it had reached. This shoots only the frames asked for — so the window
 * in which a reload can land is a fraction as wide — and starts over cleanly
 * when one does.
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const SEQ = process.argv[2] ?? 'switchback';
const FRAMES = (process.argv[3] ?? '70').split(',').map(Number).sort((a, b) => a - b);
const OUT = process.argv[4] ?? `captures/_seqshot/${SEQ}`;
const TRIES = 6;

await mkdir(OUT, { recursive: true });

async function attempt() {
  const b = await chromium.launch({
    headless: true,
    args: ['--enable-unsafe-swiftshader', '--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist', '--force-color-profile=srgb'],
  });
  try {
    const ctx = await b.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => console.log('PAGEERR', e.message.slice(0, 200)));
    await p.goto('http://127.0.0.1:5173/?capture=1&pr=2', { waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => !!window.__DESCENT__?.game?.capture, null, { timeout: 240000 });
    const ok = await p.evaluate((s) => {
      const g = window.__DESCENT__.game;
      g.capture.takeControl();
      return g.capture.setSequence(s);
    }, SEQ);
    if (!ok) throw new Error(`unknown sequence ${SEQ}`);
    await p.evaluate(() => {
      for (let i = 0; i < 4; i++) window.__DESCENT__.game.capture.step(1 / 60);
    });

    // Shoot EVERY frame, keep only the ones asked for. The camera director is
    // handed the real wall-clock delta as well as the fixed step, so a run that
    // skips the screenshots does not produce the same framing as `capture.mjs`
    // — the first version of this probe put the subject in a different part of
    // the frame and the comparison was worthless.
    const last = FRAMES[FRAMES.length - 1];
    const want = new Set(FRAMES);
    for (let f = 0; f <= last; f++) {
      await p.evaluate(() => window.__DESCENT__.game.capture.step(1 / 60));
      await p.screenshot({
        path: want.has(f) ? `${OUT}/f${String(f).padStart(4, '0')}.png` : `${OUT}/_scratch.png`,
        animations: 'disabled',
      });
      if (want.has(f)) console.log('  shot', f);
    }
    return true;
  } finally {
    await b.close();
  }
}

for (let t = 0; t < TRIES; t++) {
  try {
    await attempt();
    console.log('→', OUT);
    process.exit(0);
  } catch (e) {
    console.log(`attempt ${t + 1} failed:`, String(e).slice(0, 140));
  }
}
console.log('gave up');
process.exit(1);
