/**
 * _faceview.mjs — park a free camera on the rider's head and render one frame.
 *
 * The capture poses are all orbit/chase framings of the BIKE; none of them can
 * put the lens in front of the face, which is the only place the face can be
 * judged. This drives the post pipeline by hand after stepping, so nothing in
 * the game has to know about it.
 *
 *   node tools/capture/_faceview.mjs <tag> <azimuth-deg> <elev-deg> <dist-m> [pose]
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const TAG = process.argv[2] ?? 'front';
const AZ = Number(process.argv[3] ?? 0);
const EL = Number(process.argv[4] ?? 0);
const DIST = Number(process.argv[5] ?? 0.62);
const POSE = process.argv[6] ?? 'rider-closeup';

await mkdir('captures/_face', { recursive: true });
const b = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader','--use-angle=default','--enable-gpu','--ignore-gpu-blocklist','--force-color-profile=srgb'] });
const ctx = await b.newContext({ viewport: { width: 900, height: 900 }, deviceScaleFactor: 2 });
const p = await ctx.newPage();
p.on('pageerror', (e) => console.log('PAGEERR', e.message.slice(0, 400)));
await p.goto('http://127.0.0.1:5173/?capture=1&pr=2', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => !!window.__DESCENT__?.game?.capture, null, { timeout: 240000 });
await p.evaluate(() => window.__DESCENT__.game.capture.takeControl());
await p.evaluate((n) => window.__DESCENT__.game.capture.setPose(n), POSE);
await p.evaluate(() => { for (let i = 0; i < 12; i++) window.__DESCENT__.game.capture.step(1 / 60); });

const info = await p.evaluate(async ([az, el, dist]) => {
  const THREE = await import('/node_modules/three/build/three.module.js');
  const G = await import('/src/npr/NprGlobals.ts');
  const D = window.__DESCENT__;
  const g = D.game, eng = D.engine;

  // Head bone: the rider's skinned meshes share one skeleton.
  let bone = null, skin = null;
  eng.scene.traverse((o) => {
    if (o.isSkinnedMesh && o.name.startsWith('rider:player') && !skin) skin = o;
  });
  if (skin) bone = skin.skeleton.bones.find((x) => x.name === 'head') ?? null;
  if (!bone) return { err: 'no head bone', names: skin ? skin.skeleton.bones.map(x=>x.name) : null };

  const c = new THREE.Vector3();
  bone.getWorldPosition(c);
  // Aim at the middle of the skull rather than the joint at its base.
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(bone.getWorldQuaternion(new THREE.Quaternion()));
  c.addScaledVector(up, 0.09);

  // Head-forward in world, so azimuth 0 is dead in front of the face.
  const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(bone.getWorldQuaternion(new THREE.Quaternion()));
  fwd.y = 0; fwd.normalize();
  const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();

  const a = (az * Math.PI) / 180, e = (el * Math.PI) / 180;
  const dir = new THREE.Vector3()
    .addScaledVector(fwd, Math.cos(a) * Math.cos(e))
    .addScaledVector(right, Math.sin(a) * Math.cos(e))
    .addScaledVector(new THREE.Vector3(0, 1, 0), Math.sin(e))
    .normalize();

  const cam = eng.camera;
  const savedFov = cam.fov;
  cam.fov = 26;
  cam.position.copy(c).addScaledVector(dir, dist);
  cam.lookAt(c);
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld(true);

  G.updateNprGlobals(eng.elapsed ?? 0, cam, eng.renderSize.x, eng.renderSize.y);
  g.sky.update(cam, 0.6);
  g.post.render(eng.scene, cam, 0, eng.elapsed ?? 0);
  cam.fov = savedFov;
  return { ok: true, c: c.toArray().map((v) => +v.toFixed(2)) };
}, [AZ, EL, DIST]);
console.log(JSON.stringify(info));
await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
await p.screenshot({ path: `captures/_face/${TAG}.png`, animations: 'disabled' });
console.log('wrote captures/_face/' + TAG + '.png');
await b.close();
