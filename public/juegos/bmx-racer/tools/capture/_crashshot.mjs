/**
 * _crashshot.mjs — the crash on a camera that keeps the rider in frame.
 *
 *   node tools/capture/_crashshot.mjs 13,20,27,34,41,48,55
 *
 * The game's own crash camera loses the player, so a `capture.mjs --seq crash`
 * strip shows an empty hillside from about a third of the way in and cannot be
 * used to judge the body. This parks a camera on the rider's pelvis at a fixed
 * offset in the bike's own heading, with the director disabled, and tiles the
 * requested frames into one sheet.
 */
import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const FRAMES = (process.argv[2] ?? '13,20,27,34,41,48,55').split(',').map(Number);
const OUT = 'captures/_crashshot';
const DIST = Number(process.argv[3] ?? 4.2);
await mkdir(OUT, { recursive: true });

const b = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist', '--force-color-profile=srgb'],
});
const ctx = await b.newContext({ viewport: { width: 520, height: 520 }, deviceScaleFactor: 2 });
const p = await ctx.newPage();
p.on('pageerror', (e) => console.log('PAGEERR', e.message.slice(0, 200)));
await p.goto('http://127.0.0.1:5173/?capture=1&pr=2', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => !!window.__DESCENT__?.game?.capture, null, { timeout: 240000 });
await p.evaluate(() => {
  const g = window.__DESCENT__.game;
  g.capture.takeControl();
  g.capture.setSequence('crash');
});
await p.evaluate(async () => {
  const THREE = await import('/node_modules/three/build/three.module.js');
  window.__T = THREE;
  // The director is what loses the rider. Replace it with a fixed rig-relative
  // boom so the body is judged rather than the framing.
  window.__DESCENT__.game.effects.cameraDirector.update = () => {
    const D = window.__DESCENT__;
    const r = D.game.race.player;
    const cam = D.engine.camera;
    const T = window.__T;
    const skel = r.rig.skel;
    const pelvis = skel.bones.find((x) => x.name === 'pelvis');
    pelvis.updateWorldMatrix(true, false);
    const c = new T.Vector3().setFromMatrixPosition(pelvis.matrixWorld);
    // Look along the bike's own heading, from the side and slightly above, so
    // a fall toward the camera and a fall away from it read differently.
    // LATCH the heading on the first frame. Deriving it from the live bike
    // orientation is what broke the first version of this probe: once the frame
    // tumbles past vertical, the horizontal part of its forward axis collapses,
    // `side` goes to zero, and the camera ends up hovering directly over the
    // rider looking straight down — which is a degenerate lookAt and renders as
    // a frame of plain dirt from f28 on.
    if (!window.__FWD) {
      const f0 = new T.Vector3(0, 0, 1).applyQuaternion(r.bike.state.orientation);
      f0.y = 0;
      if (f0.lengthSq() < 1e-6) f0.set(0, 0, 1);
      window.__FWD = f0.normalize().toArray();
    }
    const fwd = new T.Vector3().fromArray(window.__FWD);
    const side = new T.Vector3().crossVectors(fwd, new T.Vector3(0, 1, 0)).normalize();
    cam.position
      .copy(c)
      .addScaledVector(side, window.__DIST * 0.86)
      .addScaledVector(fwd, -window.__DIST * 0.30)
      .add(new T.Vector3(0, window.__DIST * 0.34, 0));
    cam.lookAt(c);
    cam.fov = 40;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);
  };
});
await p.evaluate((d) => {
  window.__DIST = d;
}, DIST);
// The impact plume is emitted on top of the rider and never dissipates, so from
// the frame of the hit onward it is the only thing in shot. Hidden here because
// this probe is about the BODY; the dust is another agent's defect.
await p.evaluate(() => {
  window.__HIDE = () => {
    window.__DESCENT__.engine.scene.traverse((o) => {
      const n = (o.name || '').toLowerCase();
      if (n.includes('dust') || n.includes('debris') || n.includes('puff') || n.includes('smear')) o.visible = false;
    });
  };
});
await p.evaluate(() => {
  for (let i = 0; i < 4; i++) window.__DESCENT__.game.capture.step(1 / 60);
});

const last = Math.max(...FRAMES);
const want = new Set(FRAMES);
const kept = [];
for (let f = 0; f <= last; f++) {
  await p.evaluate(() => window.__DESCENT__.game.capture.step(1 / 60));
  if (want.has(f)) {
    await p.evaluate(() => {
      window.__HIDE();
      window.__DESCENT__.game.capture.step(0);
    });
  }
  const file = want.has(f) ? `${OUT}/f${String(f).padStart(4, '0')}.png` : `${OUT}/_scratch.png`;
  await p.screenshot({ path: file, animations: 'disabled' });
  if (want.has(f)) kept.push([f, file]);
}
console.log('shot', kept.map((k) => k[0]).join(','));

// Tile them into one sheet — a strip is what shows a fall as a fall.
const b64 = [];
for (const [, file] of kept) b64.push((await readFile(file)).toString('base64'));
const sheet = await p.evaluate(
  async ({ imgs, labels }) => {
    const loaded = [];
    for (const s of imgs) {
      const im = new Image();
      im.src = 'data:image/png;base64,' + s;
      await im.decode();
      loaded.push(im);
    }
    const w = loaded[0].width;
    const h = loaded[0].height;
    const cols = loaded.length;
    const cv = document.createElement('canvas');
    cv.width = w * cols;
    cv.height = h + 40;
    const g = cv.getContext('2d');
    g.fillStyle = '#101018';
    g.fillRect(0, 0, cv.width, cv.height);
    loaded.forEach((im, i) => {
      g.drawImage(im, i * w, 40);
      g.fillStyle = '#ffd479';
      g.font = 'bold 26px monospace';
      g.fillText(labels[i], i * w + 12, 28);
    });
    return cv.toDataURL('image/png').split(',')[1];
  },
  { imgs: b64, labels: kept.map(([f]) => `f${f}  ${(f / 60).toFixed(3)}s`) },
);
await writeFile(`${OUT}/strip.png`, Buffer.from(sheet, 'base64'));
console.log('→', `${OUT}/strip.png`);
await b.close();
