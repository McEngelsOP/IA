/**
 * Throwaway probe: where are the feet, really, and does the rider inherit the
 * bike's attitude?
 *
 *   node tools/capture/_feet.mjs [pose|seq] [name] [frames]
 *
 * Everything is measured in WORLD space off matrixWorld, i.e. exactly what the
 * renderer draws — not off the rig's own intermediate buffers.
 */
import { chromium } from 'playwright';

const mode = process.argv[2] ?? 'pose';
const name = process.argv[3] ?? 'bike-detail';
const N = Number(process.argv[4] ?? 12);

const b = await chromium.launch({
  headless: true,
  args: ['--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'],
});
const p = await b.newPage({ viewport: { width: 900, height: 520 } });
p.on('pageerror', (e) => console.log('ERR', e.message.slice(0, 300)));
await p.goto('http://127.0.0.1:5173/?capture=1&pr=1', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => !!window.__DESCENT__?.game?.capture, null, { timeout: 240000 });

await p.evaluate(
  ({ mode, name }) => {
    const g = window.__DESCENT__.game;
    g.capture.takeControl();
    if (mode === 'seq') g.capture.setSequence(name);
    else g.capture.setPose(name);
    const r = g.race.player;
    window.__M = { rig: r.rig, bike: r.bike, st: r.bike.state };
  },
  { mode, name },
);

const rows = [];
for (let f = 0; f < N; f++) {
  const row = await p.evaluate(() => {
    const g = window.__DESCENT__.game;
    g.capture.step(1 / 60);
    const { rig, bike, st } = window.__M;
    const bones = rig.skel.bones;
    const idx = {};
    bones.forEach((b, i) => (idx[b.name] = i));

    const M = (o) => {
      o.updateWorldMatrix(true, false);
      return o.matrixWorld.elements;
    };
    const wpos = (o) => {
      const e = M(o);
      return [e[12], e[13], e[14]];
    };
    /** Apply a matrix to a local point. */
    const xf = (e, x, y, z) => [
      e[0] * x + e[4] * y + e[8] * z + e[12],
      e[1] * x + e[5] * y + e[9] * z + e[13],
      e[2] * x + e[6] * y + e[10] * z + e[14],
    ];
    const d3 = (a, c) => Math.hypot(a[0] - c[0], a[1] - c[1], a[2] - c[2]);
    const deg = (x) => +((x * 180) / Math.PI).toFixed(1);
    /** Roll about the forward axis and yaw, from a world matrix. */
    const att = (e) => {
      const lx = [e[0], e[1], e[2]];
      const n = Math.hypot(lx[0], lx[1], lx[2]) || 1;
      const fz = [e[8], e[9], e[10]];
      return { roll: deg(Math.asin(Math.max(-1, Math.min(1, lx[1] / n)))), yaw: deg(Math.atan2(fz[0], fz[2])) };
    };

    const an = bike.anchors;
    const eL = M(bones[idx.footL]);
    const eR = M(bones[idx.footR]);
    // The sole under the ball of the foot, in the foot's own frame.
    const sL = xf(eL, 0, -0.09, 0.078);
    const sR = xf(eR, 0, -0.09, 0.078);
    const pL = wpos(an.pedalLeft);
    const pR = wpos(an.pedalRight);

    const aRider = att(M(rig.object));
    const aBike = att(M(bike.object));
    const aChest = att(M(bones[idx.chest]));
    const aPelvis = att(M(bones[idx.pelvis]));

    return {
      mode: st.mode,
      kmh: +(st.speed * 3.6).toFixed(1),
      crank: +rig.crankAngle.toFixed(3),
      eff: +rig.effort.toFixed(3),
      air: +rig.airWeight.toFixed(3),
      pedY: [+pL[1].toFixed(4), +pR[1].toFixed(4)],
      pedZ: [+pL[2].toFixed(4), +pR[2].toFixed(4)],
      ankleErr: [+d3([eL[12], eL[13], eL[14]], pL).toFixed(4), +d3([eR[12], eR[13], eR[14]], pR).toFixed(4)],
      soleErr: [+d3(sL, pL).toFixed(4), +d3(sR, pR).toFixed(4)],
      soleDy: [+(sL[1] - pL[1]).toFixed(4), +(sR[1] - pR[1]).toFixed(4)],
      soleDz: [+(sL[2] - pL[2]).toFixed(4), +(sR[2] - pR[2]).toFixed(4)],
      kneeY: [+wpos(bones[idx.shinL])[1].toFixed(3), +wpos(bones[idx.shinR])[1].toFixed(3)],
      lean: +st.lean.toFixed(3),
      roll: { rider: aRider.roll, bike: aBike.roll, chest: aChest.roll, pelvis: aPelvis.roll },
      yaw: { rider: aRider.yaw, bike: aBike.yaw, chest: aChest.yaw },
      lockH: [+rig.applied[15].toFixed(3), +rig.applied[16].toFixed(3)],
      lockF: [+rig.applied[25].toFixed(3), +rig.applied[26].toFixed(3)],
    };
  });
  rows.push(row);
}
rows.forEach((r, i) => console.log(i, JSON.stringify(r)));
await b.close();
