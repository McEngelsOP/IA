/**
 * How much of the frame the HUD actually covers, per layer, per pose.
 *
 * "The four HUD panels take more visual weight than anything in the world" is a
 * judgement, but the first term in it is measurable: the fraction of the frame
 * that carries HUD ink rather than picture. Counted off each layer's own
 * backing store — alpha > 8 — so it is coverage, not the bounding boxes of the
 * layer rects, which for the speedometer and the boost meter are mostly air.
 *
 * node tools/capture/_hudweight.mjs [pose ...]
 */
import { chromium } from 'playwright';

const poses = process.argv.slice(2);
if (!poses.length) poses.push('summit-wide', 'scree-speed', 'ridge-exposure', 'finish-sprint');

const b = await chromium.launch({ args: ['--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
p.on('pageerror', (e) => console.log('PAGEERR', e.message.slice(0, 300)));
await p.goto('http://127.0.0.1:5173/?capture=1&pr=1', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => !!window.__DESCENT__?.game?.capture, null, { timeout: 240000 });
await p.evaluate(() => window.__DESCENT__.game.capture.takeControl());

for (const pose of poses) {
  const r = await p.evaluate((pose) => {
    const g = window.__DESCENT__.game;
    g.capture.setPose(pose);
    for (let i = 0; i < 20; i++) g.capture.step(1 / 60);
    const rows = [];
    let total = 0;
    for (const l of g.hud.root ? g.hud.root.layers : g.hud.object.children.map(() => null)) {
      if (!l || !l.mesh.visible || l.alpha <= 0.01) continue;
      const c = l.canvas;
      const d = l.ctx.getImageData(0, 0, c.width, c.height).data;
      let on = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i] > 8) on++;
      // Canvas pixels → design units² → fraction of the 1920×1080 design frame.
      const frac = (on / (c.width * c.height)) * (l.w * l.h) / (1920 * 1080);
      total += frac * l.alpha;
      rows.push([l.name, +(frac * 100).toFixed(2)]);
    }
    rows.sort((a, b) => b[1] - a[1]);
    return { pose, totalPct: +(total * 100).toFixed(2), rows };
  }, pose);
  console.log(JSON.stringify(r));
}
await b.close();
