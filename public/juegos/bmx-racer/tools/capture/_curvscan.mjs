/**
 * Throwaway probe: dump the track curvature ahead of the rider at a pose, so we
 * can tell "no corner call" from "corner call failed".
 */
import { chromium } from 'playwright';

const POSES = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ['scree-speed', 'tabletop-air', 'ravine-gap', 'finish-sprint', 'summit-wide'];

const b = await chromium.launch({ args: ['--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 800, height: 450 } });
p.on('pageerror', (e) => console.log('PAGEERR', e.message.slice(0, 300)));
await p.goto('http://127.0.0.1:5173/?capture=1&pr=1', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => !!window.__DESCENT__?.game?.capture, null, { timeout: 240000 });
await p.evaluate(() => window.__DESCENT__.game.capture.takeControl());

for (const pose of POSES) {
  const r = await p.evaluate((pose) => {
    const g = window.__DESCENT__.game;
    g.capture.setPose(pose);
    for (let i = 0; i < 12; i++) g.capture.step(1 / 60);
    const track = g.race.track ?? g.track;
    const prog = g.race.player.tracker ?? null;
    const m = g.race.getHudModel();
    let d0 = 0;
    for (const s of m.standings) if (s.isPlayer) d0 = s.distance;
    const out = [];
    for (let d = 0; d <= 400; d += 10) {
      const s = track.sampleAtDistance(Math.min(d0 + d, track.length));
      out.push(+(s.curvature * 1000).toFixed(2));
    }
    return { pose, d0: Math.round(d0), len: Math.round(track.length), out };
  }, pose);
  console.log(r.pose.padEnd(16), 'dist=' + r.d0 + '/' + r.len);
  console.log('   k*1e3 @0..400m step10:', r.out.join(' '));
}
await b.close();
