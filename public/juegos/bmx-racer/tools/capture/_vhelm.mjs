/**
 * _vhelm.mjs — face-cam + one-term-at-a-time isolation on the helmet/skin.
 * Same frozen frame for every variant, so the only difference is the term.
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const AZ = Number(process.argv[2] ?? 10);
const EL = Number(process.argv[3] ?? -18);
const DIST = Number(process.argv[4] ?? 1.15);

await mkdir('captures/_vhelm', { recursive: true });
const b = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader','--use-angle=default','--enable-gpu','--ignore-gpu-blocklist','--force-color-profile=srgb'] });
const ctx = await b.newContext({ viewport: { width: 800, height: 800 }, deviceScaleFactor: 2 });
const p = await ctx.newPage();
p.on('pageerror', (e) => console.log('PAGEERR', e.message.slice(0, 400)));
await p.goto('http://127.0.0.1:5173/?capture=1&pr=2', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => !!window.__DESCENT__?.game?.capture, null, { timeout: 240000 });
await p.evaluate(() => window.__DESCENT__.game.capture.takeControl());
await p.evaluate(() => window.__DESCENT__.game.capture.setPose('rider-closeup'));
await p.evaluate(() => { for (let i = 0; i < 12; i++) window.__DESCENT__.game.capture.step(1 / 60); });

await p.evaluate(async () => {
  const THREE = await import('/node_modules/three/build/three.module.js');
  const G = await import('/src/npr/NprGlobals.ts');
  window.__T = THREE; window.__G = G;
  const mats = {};
  window.__DESCENT__.engine.scene.traverse((o) => {
    if (!o.material || o.userData.isHull) return;
    const n = o.material.name || '';
    if (n.startsWith('rider:')) mats[n.slice(6)] = o.material;
  });
  window.__M = mats;
  window.__SAVE = {};
  for (const [k, m] of Object.entries(mats)) {
    window.__SAVE[k] = {
      spec: m.uniforms.uSpecStrength.value, pow: m.uniforms.uSpecPower.value,
      mc: m.uniforms.uMatcapMix.value, rim: m.uniforms.uRimStrength.value,
      rimP: m.uniforms.uRimPower.value,
    };
  }
  window.__AMB = G.NPR.uAmbient.value;
  window.__BLOOM = G.POST_STATE.bloomIntensity;
});

const shoot = async (tag) => {
  await p.evaluate(([az, el, dist]) => {
    const THREE = window.__T, G = window.__G, D = window.__DESCENT__;
    const eng = D.engine, g = D.game;
    let skin = null;
    eng.scene.traverse((o) => { if (o.isSkinnedMesh && o.name.startsWith('rider:player') && !skin) skin = o; });
    const bone = skin.skeleton.bones.find((x) => x.name === 'head');
    const q = bone.getWorldQuaternion(new THREE.Quaternion());
    const c = bone.getWorldPosition(new THREE.Vector3());
    c.addScaledVector(new THREE.Vector3(0, 1, 0).applyQuaternion(q), 0.09);
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(q); fwd.y = 0; fwd.normalize();
    const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
    const a = (az * Math.PI) / 180, e = (el * Math.PI) / 180;
    const dir = new THREE.Vector3()
      .addScaledVector(fwd, Math.cos(a) * Math.cos(e))
      .addScaledVector(right, Math.sin(a) * Math.cos(e))
      .addScaledVector(new THREE.Vector3(0, 1, 0), Math.sin(e)).normalize();
    const cam = eng.camera; const sf = cam.fov; cam.fov = 26;
    cam.position.copy(c).addScaledVector(dir, dist); cam.lookAt(c);
    cam.updateProjectionMatrix(); cam.updateMatrixWorld(true);
    G.updateNprGlobals(eng.elapsed ?? 0, cam, eng.renderSize.x, eng.renderSize.y);
    g.sky.update(cam, 0.6);
    g.post.render(eng.scene, cam, 0, eng.elapsed ?? 0);
    cam.fov = sf;
  }, [AZ, EL, DIST]);
  await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
  await p.screenshot({ path: `captures/_vhelm/${tag}.png`, animations: 'disabled' });
  console.log('  ok', tag);
};

const VARIANTS = ['a-base', 'b-nospec', 'c-nomatcap', 'd-norim', 'e-nobloom', 'f-noambient', 'g-onlyramp'];
for (const v of VARIANTS) {
  await p.evaluate((t) => {
    const G = window.__G;
    for (const [k, m] of Object.entries(window.__M)) {
      const S = window.__SAVE[k];
      m.uniforms.uSpecStrength.value = S.spec; m.uniforms.uSpecPower.value = S.pow;
      m.uniforms.uMatcapMix.value = S.mc; m.uniforms.uRimStrength.value = S.rim;
    }
    G.NPR.uAmbient.value = window.__AMB;
    G.POST_STATE.bloomIntensity = window.__BLOOM;
    const all = Object.values(window.__M);
    if (t === 'b-nospec') all.forEach((m) => (m.uniforms.uSpecStrength.value = 0));
    if (t === 'c-nomatcap') all.forEach((m) => (m.uniforms.uMatcapMix.value = 0));
    if (t === 'd-norim') all.forEach((m) => (m.uniforms.uRimStrength.value = 0));
    if (t === 'e-nobloom') G.POST_STATE.bloomIntensity = 0;
    if (t === 'f-noambient') G.NPR.uAmbient.value = 0;
    if (t === 'g-onlyramp') {
      all.forEach((m) => { m.uniforms.uSpecStrength.value = 0; m.uniforms.uMatcapMix.value = 0; m.uniforms.uRimStrength.value = 0; });
      G.POST_STATE.bloomIntensity = 0;
    }
  }, v);
  await shoot(v);
}
await b.close();
