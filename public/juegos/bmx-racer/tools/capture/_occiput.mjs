/**
 * _occiput.mjs — shoot the BACK of the helmet, one term at a time.
 *
 * Same frozen frame for every variant, so the only difference between two
 * images is the term that was killed.
 *
 *   node tools/capture/_occiput.mjs [az] [el] [dist]
 *
 * az 180 = straight behind. Variants: base, no screen-space lines, no inverted
 * hulls, no lines AND no hulls (pure shading).
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const AZ = Number(process.argv[2] ?? 180);
const EL = Number(process.argv[3] ?? 8);
const DIST = Number(process.argv[4] ?? 0.85);

await mkdir('captures/_occiput', { recursive: true });
const b = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist', '--force-color-profile=srgb'],
});
const ctx = await b.newContext({ viewport: { width: 700, height: 700 }, deviceScaleFactor: 2 });
const p = await ctx.newPage();
p.on('pageerror', (e) => console.log('PAGEERR', e.message.slice(0, 400)));
await p.goto('http://127.0.0.1:5173/?capture=1&pr=2', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => !!window.__DESCENT__?.game?.capture, null, { timeout: 240000 });
await p.evaluate(() => window.__DESCENT__.game.capture.takeControl());
await p.evaluate(() => window.__DESCENT__.game.capture.setPose('rider-closeup'));
await p.evaluate(() => {
  for (let i = 0; i < 12; i++) window.__DESCENT__.game.capture.step(1 / 60);
});

await p.evaluate(async () => {
  const THREE = await import('/node_modules/three/build/three.module.js');
  const G = await import('/src/npr/NprGlobals.ts');
  window.__T = THREE;
  window.__G = G;
  const hulls = [];
  const riderParts = [];
  window.__DESCENT__.engine.scene.traverse((o) => {
    if (o.userData?.isHull) hulls.push(o);
    const n = o.material?.name ?? '';
    if (n.startsWith('rider:')) riderParts.push({ o, n: n.slice(6) });
  });
  window.__HULLS = hulls;
  window.__PARTS = riderParts;
  // The director re-places the camera inside every step, so it has to go.
  window.__DESCENT__.game.effects.cameraDirector.update = () => {};
});

const shoot = async (tag) => {
  await p.evaluate(
    ([az, el, dist]) => {
      const THREE = window.__T;
      const D = window.__DESCENT__;
      let skin = null;
      D.engine.scene.traverse((o) => {
        if (o.isSkinnedMesh && o.name.startsWith('rider:player') && !skin) skin = o;
      });
      const bone = skin.skeleton.bones.find((x) => x.name === 'head');
      const q = bone.getWorldQuaternion(new THREE.Quaternion());
      const c = bone.getWorldPosition(new THREE.Vector3());
      c.addScaledVector(new THREE.Vector3(0, 1, 0).applyQuaternion(q), 0.09);
      const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
      fwd.y = 0;
      fwd.normalize();
      const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
      const a = (az * Math.PI) / 180;
      const e = (el * Math.PI) / 180;
      const dir = new THREE.Vector3()
        .addScaledVector(fwd, Math.cos(a) * Math.cos(e))
        .addScaledVector(right, Math.sin(a) * Math.cos(e))
        .addScaledVector(new THREE.Vector3(0, 1, 0), Math.sin(e))
        .normalize();
      const cam = D.engine.camera;
      cam.position.copy(c).addScaledVector(dir, dist);
      cam.lookAt(c);
      cam.fov = 32;
      cam.updateProjectionMatrix();
      cam.updateMatrixWorld(true);
    },
    [AZ, EL, DIST],
  );
  await p.evaluate(() => window.__DESCENT__.game.capture.step(0));
  await p.screenshot({ path: `captures/_occiput/${tag}.png` });
  console.log('shot', tag);
};

await shoot('a-base');

await p.evaluate(() => {
  window.__G.POST_STATE.lineOpacity = 0;
});
await shoot('b-nolines');

await p.evaluate(() => {
  for (const h of window.__HULLS) h.visible = false;
});
await shoot('c-nolines-nohulls');

await p.evaluate(() => {
  window.__G.POST_STATE.lineOpacity = 1;
  for (const h of window.__HULLS) h.visible = true;
});
await shoot('d-restored');

// Now hide the helmet itself, so whatever is left on the occiput is not the lid.
await p.evaluate(() => {
  for (const { o, n } of window.__PARTS) if (n === 'helmet') o.visible = false;
  for (const h of window.__HULLS) if ((h.material?.name ?? '').includes('helmet')) h.visible = false;
});
await shoot('e-nohelmet');

await b.close();
