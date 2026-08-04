/**
 * _occisweep.mjs — sweep the helmet's specular terms with the camera behind the
 * head. One frozen frame, one term changed per shot.
 *
 *   node tools/capture/_occisweep.mjs [az] [el] [dist]
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const AZ = Number(process.argv[2] ?? 180);
const EL = Number(process.argv[3] ?? 8);
const DIST = Number(process.argv[4] ?? 0.85);

await mkdir('captures/_occisweep', { recursive: true });
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
  window.__T = THREE;
  // EVERY rider has its own re-hued helmet material, so picking "the last one
  // traverse found" picks an AI rider's, not the player's. Collect them all.
  const helms = new Set();
  window.__DESCENT__.engine.scene.traverse((o) => {
    if (o.material && o.material.name === 'rider:helmet' && !o.userData.isHull) helms.add(o.material);
  });
  window.__H = [...helms];
  console.log('helmet materials:', window.__H.length);
  window.__DESCENT__.game.effects.cameraDirector.update = () => {};
});

const place = async () => {
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
};

const VARIANTS = [
  ['p16-i090', 16, 0.9, 0.26],
  ['p32-i050', 32, 0.5, 0.26],
  ['p52-i042', 52, 0.42, 0.24],
  ['p52-i000', 52, 0.0, 0.24],
  ['p90-i035', 90, 0.35, 0.22],
  ['p16-i000', 16, 0.0, 0.26],
];

for (const [tag, power, ink, strength] of VARIANTS) {
  await p.evaluate(
    ([power, ink, strength]) => {
      for (const h of window.__H) {
        h.uniforms.uSpecPower.value = power;
        h.uniforms.uSpecInk.value = ink;
        h.uniforms.uSpecStrength.value = strength;
        h.uniforms.uRimStrength.value = strength < 0 ? 0 : h.uniforms.uRimStrength.value;
      }
    },
    [power, ink, strength],
  );
  await place();
  await p.evaluate(() => window.__DESCENT__.game.capture.step(0));
  await p.screenshot({ path: `captures/_occisweep/${tag}.png`, clip: { x: 175, y: 215, width: 350, height: 350 } });
  console.log('shot', tag);
}
await b.close();
