/**
 * _impactseq.mjs — drive a sequence, log the impact dials per frame, and
 * screenshot only the frames that matter (the flash, plus two either side).
 *
 * The full-sequence harness keeps losing its execution context on these two
 * sequences, and 120 retina PNGs is the wrong artefact anyway: what has to be
 * proved about the impact accent is (a) how many frames it is up, and (b) that
 * the sky, the palette and the composition survive on every one of them.
 *
 * node tools/capture/_impactseq.mjs <sequence> [frames]
 */
import { chromium } from 'playwright';
import path from 'node:path';
import { mkdirSync } from 'node:fs';

const OUT = path.resolve('tools/capture/_out');
mkdirSync(OUT, { recursive: true });
const seq = process.argv[2] ?? 'crash';
const N = Number(process.argv[3] ?? 130);

const b = await chromium.launch({
  args: ['--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--force-color-profile=srgb'],
});
const c = await b.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
const p = await c.newPage();
p.on('pageerror', (e) => console.log('  [ex]', e.message));
await p.goto('http://127.0.0.1:5173/?capture=1&pr=2', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => !!window.__DESCENT__?.game?.capture, null, { timeout: 240000 });
await p.evaluate(() => window.__DESCENT__.game.capture.takeControl());
const ok = await p.evaluate((s) => window.__DESCENT__.game.capture.setSequence(s), seq);
console.log(seq, 'setSequence ->', ok);
for (let i = 0; i < 4; i++) await p.evaluate(() => window.__DESCENT__.game.capture.step(1 / 60));

const hot = [];
const rows = [];
for (let f = 0; f < N; f++) {
  const st = await p.evaluate(() => {
    window.__DESCENT__.game.capture.step(1 / 60);
    const u = window.__DESCENT__.game.post.composite.uniforms;
    return {
      flash: u.uImpactFlash.value,
      desat: u.uDesaturate.value,
      flood: u.uInkFlood.value,
      tint: [u.uImpactTint.value.r, u.uImpactTint.value.g, u.uImpactTint.value.b],
    };
  });
  rows.push(st);
  if (st.flash > 0.001 || st.desat > 0.001 || st.flood > 0.001) {
    hot.push(f);
    console.log(`  f${String(f).padStart(4, '0')} flash ${st.flash.toFixed(3)} desat ${st.desat.toFixed(3)} flood ${st.flood.toFixed(3)} tint ${st.tint.map((v) => v.toFixed(2)).join(',')}`);
  }
}
console.log(`  flagged frames: ${hot.length} -> ${hot.join(',')}`);

// Replay and shoot the window around the first hot run.
if (hot.length) {
  const lo = Math.max(0, hot[0] - 2), hi = Math.min(N - 1, hot[hot.length - 1] + 2);
  await p.evaluate((s) => window.__DESCENT__.game.capture.setSequence(s), seq);
  for (let i = 0; i < 4; i++) await p.evaluate(() => window.__DESCENT__.game.capture.step(1 / 60));
  for (let f = 0; f <= hi; f++) {
    await p.evaluate(() => window.__DESCENT__.game.capture.step(1 / 60));
    if (f < lo) continue;
    await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
    await p.screenshot({ path: path.join(OUT, `imp-${seq}-f${String(f).padStart(4, '0')}.png`), animations: 'disabled' });
  }
  console.log(`  shot frames ${lo}..${hi}`);
}
await c.close();
await b.close();
