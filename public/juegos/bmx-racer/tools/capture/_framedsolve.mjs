/**
 * _framedsolve.mjs — what is the framed-shot solver actually doing to each
 * authored pose?
 *
 * The solve has two axes and a lot of authority: `framedAzMax` is 2.80 rad, so
 * in principle it can put the camera on the far side of the subject from where
 * the author put it. Before trusting it, print per pose how much rise and how
 * much yaw it is spending, and the resulting camera height above the pivot.
 * A pose that is spending nothing is a pose the author got right.
 */
import { chromium } from 'playwright';

const args = {};
for (let i = 0; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (!a.startsWith('--')) continue;
  const n = process.argv[i + 1];
  args[a.slice(2)] = n && !n.startsWith('--') ? n : true;
}
const URL_BASE = args.url ?? 'http://127.0.0.1:5173';

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist'],
});
const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
const page = await context.newPage();
page.on('pageerror', (e) => console.log('  [page:exception]', e.message));
await page.goto(`${URL_BASE}/?capture=1&pr=2`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
await page.waitForFunction(() => !!window.__DESCENT__?.game?.capture, null, { timeout: 240_000 });
await page.evaluate(() => window.__DESCENT__.game.capture.takeControl());

const poses = await page.evaluate(() => window.__DESCENT__.game.capture.listPoses());
console.log('pose                    mode  rise°   az°   dist   camY-pivotY  elev°');
for (const p of poses) {
  await page.evaluate((n) => window.__DESCENT__.game.capture.setPose(n), p);
  await page.evaluate(() => { for (let i = 0; i < 12; i++) window.__DESCENT__.game.capture.step(1 / 60); });
  const r = await page.evaluate(() => {
    const G = window.__DESCENT__.game;
    const d = G.effects.cameraDirector;
    const cam = G.engine.camera;
    const st = G.race.player.bike.state;
    const px = st.position.x, py = st.position.y + 1.05, pz = st.position.z;
    const dx = cam.position.x - px, dy = cam.position.y - py, dz = cam.position.z - pz;
    const h = Math.hypot(dx, dz);
    return {
      mode: d?.mode ?? -1,
      rise: d?.framedRise ?? 0,
      az: d?.framedAz ?? 0,
      dist: Math.hypot(h, dy),
      dh: dy,
      elev: Math.atan2(dy, h),
    };
  });
  const D = 180 / Math.PI;
  console.log(
    `${p.padEnd(22)} ${String(r.mode).padStart(3)}  ${(r.rise * D).toFixed(1).padStart(5)} ${(r.az * D).toFixed(1).padStart(6)} ${r.dist.toFixed(1).padStart(6)} ${r.dh.toFixed(2).padStart(11)} ${(r.elev * D).toFixed(1).padStart(6)}`,
  );
}
await browser.close();
