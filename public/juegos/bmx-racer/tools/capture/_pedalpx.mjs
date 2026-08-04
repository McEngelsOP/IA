/**
 * _pedalpx.mjs — where does the pedal land ON SCREEN, and what is drawn there?
 *
 *   node tools/capture/_pedalpx.mjs [pose]
 *
 * Shoots the pose exactly as `capture.mjs` does, then reports the SCREEN pixel
 * of each pedal spindle and of the sole point under the ball of each foot. A
 * foot-to-anchor distance in metres is not evidence that the shoe renders on
 * the pedal; two pixel coordinates a few pixels apart, on the image the critic
 * is looking at, is.
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const POSE = process.argv[2] ?? 'bike-detail';
const OUT = 'captures/_pedalpx';
await mkdir(OUT, { recursive: true });

const b = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist', '--force-color-profile=srgb'],
});
const ctx = await b.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
const p = await ctx.newPage();
p.on('pageerror', (e) => console.log('PAGEERR', e.message.slice(0, 200)));
await p.goto('http://127.0.0.1:5173/?capture=1&pr=2', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => !!window.__DESCENT__?.game?.capture, null, { timeout: 240000 });
await p.evaluate(() => window.__DESCENT__.game.capture.takeControl());
await p.evaluate((s) => window.__DESCENT__.game.capture.setPose(s), POSE);
for (let i = 0; i < 24; i++) {
  await p.evaluate(() => window.__DESCENT__.game.capture.step(1 / 60));
  await p.screenshot({ path: `${OUT}/_scratch.png`, animations: 'disabled' });
}
// The dust plume emits over the drivetrain in this pose and hides both cranks
// completely, so the one thing this probe exists to look at is behind a cloud.
// Hide it for the shot only.
await p.evaluate(() => {
  const hidden = [];
  window.__DESCENT__.engine.scene.traverse((o) => {
    const n = (o.name || '').toLowerCase();
    if (n.includes('dust') || n.includes('debris') || n.includes('puff')) {
      if (o.visible) { o.visible = false; hidden.push(n); }
    }
  });
  console.log('hid', hidden.join(','));
});
await p.evaluate(() => window.__DESCENT__.game.capture.step(0));
await p.screenshot({ path: `${OUT}/${POSE}.png`, animations: 'disabled' });

const out = await p.evaluate(async () => {
  const THREE = await import('/node_modules/three/build/three.module.js');
  const D = window.__DESCENT__;
  const r = D.game.race.player;
  const cam = D.engine.camera;
  cam.updateMatrixWorld(true);
  const bones = r.rig.skel.bones;
  const idx = {};
  bones.forEach((b, i) => (idx[b.name] = i));
  const W = 3200;
  const H = 1800;
  const proj = (v) => {
    const q = v.clone().project(cam);
    return [Math.round(((q.x + 1) / 2) * W), Math.round(((1 - q.y) / 2) * H)];
  };
  const wp = (o) => {
    o.updateWorldMatrix(true, false);
    return new THREE.Vector3().setFromMatrixPosition(o.matrixWorld);
  };
  // The sole under the ball of the foot, in the foot bone's own frame.
  const sole = (name) => {
    const bn = bones[idx[name]];
    bn.updateWorldMatrix(true, false);
    return new THREE.Vector3(0, -0.09, 0.078).applyMatrix4(bn.matrixWorld);
  };
  const an = r.bike.anchors;
  const pL = wp(an.pedalLeft);
  const pR = wp(an.pedalRight);
  const sL = sole('footL');
  const sR = sole('footR');
  const camP = new THREE.Vector3().setFromMatrixPosition(cam.matrixWorld);
  return {
    hasRealAnchors: !!r.rig.anchors,
    pedalL: proj(pL),
    pedalR: proj(pR),
    soleL: proj(sL),
    soleR: proj(sR),
    // Which pedal is nearer the lens — that is the one a 2x crop shows.
    distL: +camP.distanceTo(pL).toFixed(3),
    distR: +camP.distanceTo(pR).toFixed(3),
    gapL: +sL.distanceTo(pL).toFixed(4),
    gapR: +sR.distanceTo(pR).toFixed(4),
    pedalWorldY: [+pL.y.toFixed(3), +pR.y.toFixed(3)],
    // Hands vs the bar anchors — the "a hand leaves the bars" check.
    barL: proj(wp(an.barLeft)),
    barR: proj(wp(an.barRight)),
    handL: proj(wp(bones[idx.handL])),
    handR: proj(wp(bones[idx.handR])),
    handGap: [
      +wp(bones[idx.handL]).distanceTo(wp(an.barLeft)).toFixed(4),
      +wp(bones[idx.handR]).distanceTo(wp(an.barRight)).toFixed(4),
    ],
    lockH: [+r.rig.applied[15].toFixed(3), +r.rig.applied[16].toFixed(3)],
  };
});
console.log(JSON.stringify(out, null, 1));
await b.close();
