/**
 * _hudshutter.mjs — replicate capture.mjs exactly (setPose + 12 steps at 1/60)
 * and report, at the shutter, every layer's alpha plus the corner call's state.
 * A layer alpha strictly between 0 and 1 is the thing the critic saw.
 */
import { chromium } from 'playwright';

const URL = process.env.DURL ?? 'http://127.0.0.1:5173';
const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist'],
});
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('  [exception]', e.message));
await page.goto(`${URL}/?capture=1&pr=2`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => !!window.__DESCENT__?.game?.capture, null, { timeout: 180000 });
await page.evaluate(() => window.__DESCENT__.game.capture.takeControl());

const poses = await page.evaluate(() => window.__DESCENT__.game.capture.listPoses());
console.log('pose                  cornerHas rawCp/12 alpha   dist  | any layer with 0<alpha<1');
for (const pose of poses) {
  const r = await page.evaluate((p) => {
    const g = window.__DESCENT__.game;
    g.capture.setPose(p);
    let raw = 0;
    for (let i = 0; i < 12; i++) {
      g.capture.step(1 / 60);
      if (g.race.hud && g.race.hud.cornerPreview) raw++;
    }
    const c = g.hud.corner;
    const partial = [];
    for (const l of g.hud.root ? g.hud.root.layers : []) {
      if (l.alpha > 0.002 && l.alpha < 0.999) partial.push(`${l.name}=${l.alpha.toFixed(3)}`);
    }
    return {
      has: c.has, alpha: +c.layer.alpha.toFixed(3), dist: +c.distance.toFixed(0),
      raw, partial, kmh: +g.hud.speed.kmh.toFixed(0),
    };
  }, pose);
  console.log(
    `${pose.padEnd(22)} ${String(r.has).padEnd(9)} ${String(r.raw).padStart(5)}   ` +
    `${r.alpha.toFixed(3)} ${String(r.dist).padStart(5)}  | ${r.partial.join(' ') || '(none)'}`,
  );
}
await browser.close();
