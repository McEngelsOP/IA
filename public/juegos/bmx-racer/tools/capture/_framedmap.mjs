/**
 * _framedmap.mjs — map the framed solver's legal set.
 *
 * The solver claims yaw is cheaper than pitch, yet every authored pose comes
 * out with azimuth exactly 0 and up to 30 degrees of crane. Either no azimuth
 * step is legal, or the cost model is not what its comment says it is. Only a
 * map of `framedClear` over the (azimuth, rise) grid can tell the two apart.
 *
 * Prints, per pose, the minimum rise that is clear at each azimuth offset.
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

const list = args.pose ? String(args.pose).split(',') : ['ravine-gap', 'treeline-silhouette', 'rockgarden-low', 'rider-closeup'];
const D = 180 / Math.PI;
console.log('min clear rise (deg) per azimuth offset (deg); "-" = nothing legal within range');
for (const p of list) {
  const ok = await page.evaluate((n) => window.__DESCENT__.game.capture.setPose(n), p);
  if (!ok) { console.log('unknown', p); continue; }
  await page.evaluate(() => { for (let i = 0; i < 12; i++) window.__DESCENT__.game.capture.step(1 / 60); });
  const rows = await page.evaluate(() => {
    const G = window.__DESCENT__.game;
    const d = G.effects.cameraDirector;
    const st = G.race.player.bike.state;
    const V = st.position.constructor;
    // The orbit pivot, exactly as updateOrbit builds it.
    const pivot = new V(st.position.x, st.position.y + 1.1, st.position.z);
    const dist = Math.max(d.orbitDist, 3.25);
    const az0 = d.orbitYaw;
    const e0 = d.orbitPitch;
    const out = [];
    for (let k = -8; k <= 8; k++) {
      const az = k * 0.35;
      let found = null;
      for (let r = 0; r <= 0.9001; r += 0.075) {
        if (d.framedClear(pivot, dist, az0 + az, e0 + r)) { found = r; break; }
      }
      out.push({ az, r: found });
    }
    return { rows: out, az0, e0, dist };
  });
  console.log(`\n${p}  (authored az=${(rows.az0 * D).toFixed(0)}° elev=${(rows.e0 * D).toFixed(1)}° dist=${rows.dist})`);
  console.log('  ' + rows.rows.map((r) => `${(r.az * D).toFixed(0).padStart(5)}`).join(''));
  console.log('  ' + rows.rows.map((r) => `${(r.r === null ? '-' : (r.r * D).toFixed(0)).padStart(5)}`).join(''));
}
await browser.close();
