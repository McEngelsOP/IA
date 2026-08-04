/**
 * Throwaway probe: what does the corner-preview source actually say at each
 * pose's shutter, and what does the CornerWidget end up with?
 *
 *   node tools/capture/_cornerprobe.mjs
 */
import { chromium } from 'playwright';

const POSES = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ['summit-wide', 'summit-rider', 'scree-speed', 'switchback-lean', 'tabletop-air',
     'ravine-gap', 'finish-sprint', 'ridge-exposure', 'streambed', 'rockgarden-low',
     'valley-vista', 'treeline-silhouette', 'crash', 'bike-detail', 'rider-closeup',
     'rider-threequarter'];

const b = await chromium.launch({ args: ['--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
p.on('pageerror', (e) => console.log('PAGEERR', e.message.slice(0, 300)));
await p.goto('http://127.0.0.1:5173/?capture=1&pr=1', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => !!window.__DESCENT__?.game?.capture, null, { timeout: 240000 });
await p.evaluate(() => window.__DESCENT__.game.capture.takeControl());

for (const pose of POSES) {
  const r = await p.evaluate((pose) => {
    const g = window.__DESCENT__.game;
    if (!g.capture.setPose(pose)) return { pose, err: 'unknown' };
    const rows = [];
    for (let i = 0; i < 12; i++) {
      g.capture.step(1 / 60);
      const m = g.race.getHudModel();
      const cw = g.hud.corner;
      rows.push({
        cp: m.cornerPreview ? [+m.cornerPreview.curvature.toFixed(3), Math.round(m.cornerPreview.distance)] : null,
        has: cw.has,
        hold: +(cw.hold ?? 0).toFixed(2),
        a: +g.hud.corner.layer.alpha.toFixed(3),
        vis: +(cw.vis ?? 0).toFixed(3),
        t: +m.routeProgress.toFixed(5),
        kmh: Math.round(m.speedKmh),
        phase: m.phase,
      });
    }
    return { pose, rows };
  }, pose);
  if (r.err) { console.log(pose.padEnd(22), r.err); continue; }
  const cp = r.rows.map((x) => (x.cp ? '1' : '0')).join('');
  const last = r.rows[r.rows.length - 1];
  console.log(
    pose.padEnd(22),
    'cp=' + cp,
    'has=' + r.rows.map((x) => (x.has ? '1' : '0')).join(''),
    'alpha=' + last.a.toFixed(2),
    'hold=' + last.hold,
    'kmh=' + last.kmh,
    'phase=' + last.phase,
    'dt=' + (r.rows[11].t - r.rows[0].t).toExponential(2),
    r.rows[11].cp ? 'cp=' + JSON.stringify(r.rows[11].cp) : '',
  );
}
await b.close();
