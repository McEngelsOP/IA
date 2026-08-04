/**
 * _crashtrace.mjs — the crash, frame by frame, as numbers.
 *
 *   node tools/capture/_crashtrace.mjs [frames]
 *
 * Reports the two things a "167 ms pose swap" shows up in: how far the body has
 * travelled from the riding pose, and how long it took. Plus the contact locks,
 * so "the hands are still on the bar during the brace" is checkable rather than
 * asserted, and the two knees separately, so "identical knee bend" is too.
 */
import { chromium } from 'playwright';

const N = Number(process.argv[2] ?? 60);

const b = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist'],
});
const p = await b.newPage({ viewport: { width: 900, height: 520 } });
p.on('pageerror', (e) => console.log('ERR', e.message.slice(0, 200)));
await p.goto('http://127.0.0.1:5173/?capture=1&pr=1', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => !!window.__DESCENT__?.game?.capture, null, { timeout: 240000 });
await p.evaluate(() => {
  const g = window.__DESCENT__.game;
  g.capture.takeControl();
  g.capture.setSequence('crash');
  window.__M = { rig: g.race.player.rig, st: g.race.player.bike.state };
});

for (let f = 0; f < N; f++) {
  const row = await p.evaluate(() => {
    const g = window.__DESCENT__.game;
    g.capture.step(1 / 60);
    const { rig, st } = window.__M;
    const a = rig.applied;
    const bones = rig.skel.bones;
    const idx = {};
    bones.forEach((b, i) => (idx[b.name] = i));
    const wy = (n) => {
      const o = bones[idx[n]];
      o.updateWorldMatrix(true, false);
      return o.matrixWorld.elements[13];
    };
    // Height of the head above the pelvis: 0.55 riding, near 0 face down.
    const stack = +(wy('head') - wy('pelvis')).toFixed(3);
    const pv = bones[idx.pelvis];
    pv.updateWorldMatrix(true, false);
    const e = pv.matrixWorld.elements;
    const dx = e[12] - st.position.x, dy = e[13] - st.position.y, dz = e[14] - st.position.z;
    const offBike = +Math.hypot(dx, dy, dz).toFixed(3);
    const vis = rig.meshes.meshes.map((m) => (m.visible ? 1 : 0)).join('');
    const an = window.__DESCENT__.game.race.player.bike.anchors;
    const cw = (o) => { o.updateWorldMatrix(true, false); return o.matrixWorld.elements[13]; };
    const groundY = (cw(an.frontContact) + cw(an.rearContact)) / 2;
    const pelvisY = e[13];
    const above = +(pelvisY - groundY).toFixed(3);
    return {
      mode: st.mode,
      cw: +rig.crashWeight.toFixed(3),
      ct: +rig.crashTime.toFixed(3),
      fall: +rig.crashFallW.toFixed(3),
      sev: +rig.crashSeverity.toFixed(2),
      spin: +rig.crashSpin.toFixed(3),
      stack,
      lockH: [+a[15].toFixed(2), +a[16].toFixed(2)],
      lockF: [+a[25].toFixed(2), +a[26].toFixed(2)],
      knee: [+a[33].toFixed(3), +a[34].toFixed(3)],
      sBend: +a[6].toFixed(3),
      offBike, vis, above,
    };
  });
  console.log(f, JSON.stringify(row));
}
await b.close();
