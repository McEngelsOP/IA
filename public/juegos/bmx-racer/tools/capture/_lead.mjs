/**
 * _lead.mjs — where is the subject relative to the lens, frame by frame?
 * Prints the rider's position in VIEW space (z negative = in front) plus the
 * camera basis, for a sequence run through the real harness path.
 */
import { chromium } from 'playwright';
const args = {};
for (let i = 0; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (!a.startsWith('--')) continue;
  const n = process.argv[i + 1];
  args[a.slice(2)] = n && !n.startsWith('--') ? n : true;
}
const URL_BASE = args.url ?? 'http://127.0.0.1:5175';
const b = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader', '--use-angle=default'] });
const c = await b.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
const p = await c.newPage();
p.on('pageerror', (e) => console.log('  [page:exception]', e.message));
await p.goto(`${URL_BASE}/?capture=1&pr=2`, { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => !!window.__DESCENT__?.game?.capture, null, { timeout: 240000 });
await p.evaluate(() => window.__DESCENT__.game.capture.takeControl());

const name = String(args.seq ?? 'landing');
await p.evaluate((n) => window.__DESCENT__.game.capture.setSequence(n), name);
const frames = Number(args.frames ?? 20);
for (let f = -4; f < frames; f++) {
  const row = await p.evaluate(() => {
    const g = window.__DESCENT__.game;
    g.capture.step(1 / 60);
    const cam = g.engine.camera;
    cam.updateMatrixWorld();
    const st = g.race.player.bike.state;
    const V = st.position.constructor;
    const v = new V(st.position.x, st.position.y + 0.95, st.position.z).applyMatrix4(cam.matrixWorldInverse);
    const d = g.effects.cameraDirector;
    const look = d.lookAtPoint;
    return {
      viewZ: +v.z.toFixed(2), viewY: +v.y.toFixed(2), viewX: +v.x.toFixed(2),
      cam: [+cam.position.x.toFixed(1), +cam.position.y.toFixed(1), +cam.position.z.toFixed(1)],
      sub: [+st.position.x.toFixed(1), +st.position.y.toFixed(1), +st.position.z.toFixed(1)],
      look: [+look.x.toFixed(1), +look.y.toFixed(1), +look.z.toFixed(1)],
      spd: +st.speed.toFixed(1), mode: st.mode,
      vel: [+st.velocity.x.toFixed(1), +st.velocity.y.toFixed(1), +st.velocity.z.toFixed(1)],
      boom: +d.boomDistance.toFixed(2), fov: +cam.fov.toFixed(1),
      crash: +(d.crashFocus ?? 0).toFixed(2), ts: +d.timeScale.toFixed(2),
    };
  });
  console.log(`f${String(f).padStart(3)} viewZ=${String(row.viewZ).padStart(7)} viewY=${String(row.viewY).padStart(6)} cam=${row.cam} sub=${row.sub} look=${row.look} vel=${row.vel} spd=${row.spd} boom=${row.boom} fov=${row.fov} ts=${row.ts} ${row.mode}`);
}
await b.close();
