/**
 * _fxshots.mjs — grab an arbitrary set of (sequence, frame) stills in ONE page.
 *
 *   node tools/capture/_fxshots.mjs <tag> "crash:24,28,29,30 launch:12,24"
 *
 * Sequences are re-armed with setSequence between groups, which is exactly what
 * `--poses` does for stills, so the same reset()/preroll path is exercised.
 * One page for the whole set: a cold load is ~90 s of terrain erosion and the
 * shared dev server can reload under a long run.
 */
import { chromium } from 'playwright';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';

const TAG = process.argv[2] ?? 'fx';
const SPEC = process.argv[3] ?? 'crash:24,28,29,30';
const PR = Number(process.argv[4] ?? 2);
const OUT = path.resolve('captures/fxshots', TAG);

const groups = SPEC.split(/\s+/).filter(Boolean).map((g) => {
  const [seq, list] = g.split(':');
  return { seq, frames: list.split(',').map(Number).sort((a, b) => a - b) };
});

for (let attempt = 1; attempt <= 5; attempt++) {
  try {
    await run();
    console.log(`✓ ${OUT}`);
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
    await p.goto(`http://127.0.0.1:5173/?capture=1&pr=${PR}`, { waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => !!window.__DESCENT__?.game?.capture, null, { timeout: 240000 });
    await p.evaluate(() => window.__DESCENT__.game.capture.takeControl());

    for (const g of groups) {
      const isPose = g.seq.startsWith('pose');
      if (isPose) {
        await p.evaluate((n) => window.__DESCENT__.game.capture.setPose(n), g.seq.replace(/^pose=/, ''));
      } else {
        const ok = await p.evaluate((n) => window.__DESCENT__.game.capture.setSequence(n), g.seq);
        if (!ok) throw new Error(`unknown sequence ${g.seq}`);
      }
      await step(p, 4);
      let at = -1;
      for (const f of g.frames) {
        await step(p, f - at);
        at = f;
        await p.screenshot({
          path: path.join(OUT, `${g.seq}-f${String(f).padStart(4, '0')}.png`),
          animations: 'disabled',
        });
      }
      console.log(`  ${g.seq}: ${g.frames.join(',')}`);
    }
  } finally {
    await b.close();
  }
}

async function step(p, n) {
  if (n <= 0) return;
  await p.evaluate((count) => {
    for (let i = 0; i < count; i++) window.__DESCENT__.game.capture.step(1 / 60);
  }, n);
  await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
}
