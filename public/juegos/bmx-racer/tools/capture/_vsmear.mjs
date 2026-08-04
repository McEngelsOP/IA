/** Per-frame smear driver trace for one pose. */
import { chromium } from 'playwright';
const POSE = process.argv[2] ?? 'rider-closeup';
const N = Number(process.argv[3] ?? 14);
const b = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader','--use-angle=default','--enable-gpu','--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1200, height: 675 } });
p.on('pageerror', e => console.log('PAGEERR', e.message.slice(0,300)));
await p.goto('http://127.0.0.1:5173/?capture=1&pr=2', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => !!window.__DESCENT__?.game?.capture, null, { timeout: 240000 });
await p.evaluate(() => window.__DESCENT__.game.capture.takeControl());
await p.evaluate((n) => window.__DESCENT__.game.capture.setPose(n), POSE);
const rows = await p.evaluate((n) => {
  const g = window.__DESCENT__.game;
  const out = [];
  for (let i = 0; i < n; i++) {
    g.capture.step(1/60);
    const sp = g.effects.speed, st = g.race.player.bike.state;
    const es = [...sp.entries.values()];
    out.push({
      i, spd: +st.speed.toFixed(2), mode: st.mode,
      om: +st.angularVelocity.length().toFixed(2),
      ts: +g.effects.timeScale.toFixed(3),
      cur: es.map(e => +e.current.toFixed(3)),
      req: es.map(e => +e.request.toFixed(3)),
      hold: es.map(e => +e.hold.toFixed(3)),
      camV: +sp.camVel.value.length().toFixed(2),
      partV: es.length ? +Math.max(...es[0].parts.map(q=>q.vel.value.length())).toFixed(2) : 0,
    });
  }
  return out;
}, N);
for (const r of rows) console.log(JSON.stringify(r));
await b.close();
