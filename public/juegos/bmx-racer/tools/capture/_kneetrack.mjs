/**
 * _kneetrack.mjs — does the knee actually move, in pixels, frame to frame?
 *
 *   node tools/capture/_kneetrack.mjs [seq] [from] [count]
 *
 * The pedalling defect was measured as "the near knee pad is at IDENTICAL
 * height and shape in all eight sampled frames". So measure exactly that: the
 * knee joint projected to screen pixels on a 3200x1800 frame, every frame, plus
 * the crank angle driving it.
 */
import { chromium } from 'playwright';

const SEQ = process.argv[2] ?? 'switchback';
const FROM = Number(process.argv[3] ?? 40);
const COUNT = Number(process.argv[4] ?? 14);

const b = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist'],
});
const ctx = await b.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
const p = await ctx.newPage();
p.on('pageerror', (e) => console.log('ERR', e.message.slice(0, 200)));
await p.goto('http://127.0.0.1:5173/?capture=1&pr=2', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => !!window.__DESCENT__?.game?.capture, null, { timeout: 240000 });
await p.evaluate((s) => {
  const g = window.__DESCENT__.game;
  g.capture.takeControl();
  g.capture.setSequence(s);
}, SEQ);
await p.evaluate(async () => {
  window.__T = await import('/node_modules/three/build/three.module.js');
});
await p.evaluate(() => {
  for (let i = 0; i < 4; i++) window.__DESCENT__.game.capture.step(1 / 60);
});

const rows = [];
for (let f = 0; f < FROM + COUNT; f++) {
  const row = await p.evaluate(async (measure) => {
    const g = window.__DESCENT__.game;
    g.capture.step(1 / 60);
    if (!measure) return null;
    const T = window.__T;
    const D = window.__DESCENT__;
    const r = D.game.race.player;
    const cam = D.engine.camera;
    cam.updateMatrixWorld(true);
    const bones = r.rig.skel.bones;
    const idx = {};
    bones.forEach((b, i) => (idx[b.name] = i));
    const px = (name) => {
      const o = bones[idx[name]];
      o.updateWorldMatrix(true, false);
      const v = new T.Vector3().setFromMatrixPosition(o.matrixWorld).project(cam);
      return [Math.round(((v.x + 1) / 2) * 3200), Math.round(((1 - v.y) / 2) * 1800)];
    };
    return {
      crank: +r.rig.crankAngle.toFixed(3),
      omega: +r.rig.crankOmega.toFixed(2),
      eff: +r.rig.effort.toFixed(3),
      kneeL: px('shinL'),
      kneeR: px('shinR'),
      footL: px('footL'),
    };
  }, f >= FROM);
  if (row) rows.push([f, row]);
}

let prev = null;
for (const [f, r] of rows) {
  const d = prev ? Math.hypot(r.kneeL[0] - prev.kneeL[0], r.kneeL[1] - prev.kneeL[1]) : 0;
  console.log(
    `f${f}  crank=${String(r.crank).padStart(7)}  omega=${String(r.omega).padStart(6)}  eff=${r.eff}` +
      `  kneeL=(${r.kneeL[0]},${r.kneeL[1]})  kneeR=(${r.kneeR[0]},${r.kneeR[1]})  ΔkneeL=${d.toFixed(1)}px`,
  );
  prev = r;
}
const ys = rows.map(([, r]) => r.kneeL[1]);
console.log(`kneeL screen-Y range over ${rows.length} frames: ${Math.min(...ys)}..${Math.max(...ys)} = ${Math.max(...ys) - Math.min(...ys)} px`);
await b.close();
