/** _hudprobe.mjs — dump HUD widget internals per pose. */
import { chromium } from 'playwright';

const URL = process.env.DURL ?? 'http://127.0.0.1:5173';
const POSES = ['summit-wide', 'summit-rider', 'scree-speed', 'switchback-lean',
  'tabletop-air', 'ravine-gap', 'finish-sprint', 'streambed', 'valley-vista', 'ridge-exposure'];

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

for (const pose of POSES) {
  const r = await page.evaluate(async (p) => {
    const g = window.__DESCENT__.game;
    g.capture.setPose(p);
    const trace = [];
    for (let i = 0; i < 14; i++) {
      g.capture.step(1 / 60);
      const cw = g.hud.corner;
      trace.push({
        cp: cw.has ?? null,
        vis: +(cw.vis ?? -1).toFixed(3),
        alpha: +cw.layer.alpha.toFixed(3),
        dirty: cw.layer.dirty,
        vs: cw.layer.mesh.visible,
        dist: +(cw.distance ?? -1).toFixed(1),
        curv: +(cw.curvature ?? 0).toFixed(3),
      });
    }
    const sp = g.hud.speed;
    return {
      trace,
      speed: { kmh: +sp.kmh.toFixed(1), alpha: +sp.layer.alpha.toFixed(2) },
    };
  }, pose);
  const last = r.trace[r.trace.length - 1];
  const hasSeq = r.trace.map((t) => (t.cp ? '1' : '0')).join('');
  console.log(
    `${pose.padEnd(22)} kmh=${String(r.speed.kmh).padStart(6)}  cornerHas=[${hasSeq}]  ` +
    `vis=${last.vis} alpha=${last.alpha} vis3d=${last.vs} dist=${last.dist} curv=${last.curv}`,
  );
}

await browser.close();
