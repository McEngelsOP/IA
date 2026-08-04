/**
 * _spec.mjs — sweep the helmet's specular exponent and strength on a frozen
 * frame, so the highlight SHAPE can be compared without anything else moving.
 * Also dumps a luma scanline through the crown for each combo.
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

await mkdir('captures/_spec', { recursive: true });
const b = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist', '--force-color-profile=srgb'],
});
const ctx = await b.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
const p = await ctx.newPage();
p.on('pageerror', (e) => console.log('PAGEERR', e.message.slice(0, 300)));
await p.goto('http://127.0.0.1:5173/?capture=1&pr=2', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => !!window.__DESCENT__?.game?.capture, null, { timeout: 240000 });
await p.evaluate(() => window.__DESCENT__.game.capture.takeControl());
await p.evaluate(() => window.__DESCENT__.game.capture.setPose('rider-closeup'));
await p.evaluate(() => { for (let i = 0; i < 12; i++) window.__DESCENT__.game.capture.step(1 / 60); });
await p.evaluate(() => {
  let h = null;
  window.__DESCENT__.engine.scene.traverse((o) => {
    if (o.material && o.material.name === 'rider:helmet' && !o.userData.isHull) h = o.material;
  });
  window.__H = h;
});

const COMBOS = [
  [16, 0.34, 0.10, 0.85],
  [16, 0.34, 0.00, 0.85],
  [16, 0.00, 0.00, 0.85],
  [16, 0.00, 0.00, 0.00],
];

const CLIP = { x: 630, y: 380, width: 170, height: 150 };
for (const [pow, str, mm, rim] of COMBOS) {
  await p.evaluate(([P, S, M, R]) => {
    window.__H.uniforms.uSpecPower.value = P;
    window.__H.uniforms.uSpecStrength.value = S;
    window.__H.uniforms.uMatcapMix.value = M;
    window.__H.uniforms.uRimStrength.value = R;
  }, [pow, str, mm, rim]);
  await p.evaluate(() => window.__DESCENT__.game.capture.step(1e-6));
  await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
  const tag = `p${pow}_s${String(str).replace('.', '')}_m${String(mm).replace('.', '')}_r${String(rim).replace('.', '')}`;
  await p.screenshot({ path: `captures/_spec/${tag}.png`, clip: CLIP, animations: 'disabled' });
  const row = await p.evaluate(() => {
    const cv = document.querySelector('canvas');
    return null; // pixels come from the PNG below
  });
  void row;
  console.log('  ok', tag);
}
await b.close();
