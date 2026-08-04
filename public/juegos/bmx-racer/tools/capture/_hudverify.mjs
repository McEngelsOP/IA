/**
 * _hudverify.mjs — HUD verification probe.
 *
 *  1. Forces the speed readout through 0 / 4 / 70 / 100 / 128 and shoots the
 *     bottom-right corner at each, so the numeral is checked at every width it
 *     can be.
 *  2. Runs each pose forward under its own scripted input for 3 s and logs the
 *     corner call's `has` / alpha every frame — the chatter test.
 *
 *   node tools/capture/_hudverify.mjs [width height pr]
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const URL = process.env.DURL ?? 'http://127.0.0.1:5173';
const W = Number(process.argv[2] ?? 1600);
const H = Number(process.argv[3] ?? 900);
const PR = Number(process.argv[4] ?? 2);
const TAG = process.env.TAG ?? `${W}x${H}@${PR}`;
const DIR = `captures/hud3/${TAG}`;
await mkdir(DIR, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist', '--force-color-profile=srgb'],
});
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: PR });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('  [exception]', e.message));
await page.goto(`${URL}/?capture=1&pr=${PR}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => !!window.__DESCENT__?.game?.capture, null, { timeout: 180000 });
await page.evaluate(() => window.__DESCENT__.game.capture.takeControl());

// ── 1. Speed sweep ───────────────────────────────────────────────────────────
await page.evaluate(() => {
  const sp = window.__DESCENT__.game.hud.speed;
  const orig = Object.getPrototypeOf(sp).update;
  window.__FORCE_KMH = null;
  sp.update = function (m, dt, t) {
    if (window.__FORCE_KMH !== null) m.speedKmh = window.__FORCE_KMH;
    return orig.call(this, m, dt, t);
  };
});
await page.evaluate(() => window.__DESCENT__.game.capture.setPose('scree-speed'));
for (const v of [0, 4, 70, 100, 128]) {
  await page.evaluate((val) => {
    window.__FORCE_KMH = val;
    const sp = window.__DESCENT__.game.hud.speed;
    sp.needle.value = val;
    sp.needle.vel = 0;
    for (let i = 0; i < 8; i++) window.__DESCENT__.game.capture.step(1 / 60);
  }, v);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
  await page.screenshot({ path: `${DIR}/speed-${v}.png`, animations: 'disabled' });
  console.log(`  ✓ speed ${v}`);
}
await page.evaluate(() => { window.__FORCE_KMH = null; });

// ── 2. Corner-call chatter under real motion ─────────────────────────────────
const POSES = ['summit-wide', 'scree-speed', 'switchback-lean', 'tabletop-air',
  'ravine-gap', 'finish-sprint', 'streambed', 'ridge-exposure', 'rockgarden-low'];
console.log('\ncorner call under 3 s of scripted motion (h=latched, .=off):');
for (const pose of POSES) {
  const r = await page.evaluate(async (p) => {
    const g = window.__DESCENT__.game;
    g.capture.setPose(p);
    g.race.player.scripted = { steer: 0, pedal: 1, brake: 0 };
    const seq = [];
    let minA = 1, mid = 0, kmh = 0;
    for (let i = 0; i < 180; i++) {
      g.capture.step(1 / 60);
      const c = g.hud.corner;
      seq.push(c.has ? 1 : 0);
      const a = c.layer.alpha;
      if (c.has) { if (a < minA) minA = a; }
      // any alpha strictly between 0 and 0.55 is the ghost state
      if (a > 0.004 && a < 0.55) mid++;
      kmh = g.hud.speed.kmh;
    }
    return { seq, minA, mid, kmh: +kmh.toFixed(0) };
  }, pose);
  const on = r.seq.reduce((a, b) => a + b, 0);
  const str = r.seq.map((v) => (v ? 'h' : '.')).join('');
  console.log(
    `${pose.padEnd(20)} kmh=${String(r.kmh).padStart(4)} on=${String(on).padStart(3)}/180 ` +
    `minAlphaWhenOn=${r.minA.toFixed(2)} ghostFrames=${r.mid}\n    ${str}`,
  );
}

await browser.close();
