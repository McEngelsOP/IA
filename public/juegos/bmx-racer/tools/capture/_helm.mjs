/**
 * _helm.mjs — isolate what is drawing the soft blobs on the helmet crown.
 *
 * Loads rider-closeup once, freezes the sim, then shoots the SAME frame with
 * one term of the helmet's shading killed at a time. No stepping between
 * variants, so the only difference between two images is the term.
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

await mkdir('captures/_helm', { recursive: true });
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

await p.evaluate(async () => {
  const G = await import('/src/npr/NprGlobals.ts');
  window.__P = G.POST_STATE;
  window.__N = G.NPR;
  let helm = null;
  window.__DESCENT__.engine.scene.traverse((o) => {
    if (o.material && o.material.name === 'rider:helmet' && !o.userData.isHull) helm = o.material;
  });
  window.__H = helm;
  window.__SAVE = {
    spec: helm.uniforms.uSpecStrength.value,
    matcap: helm.uniforms.uMatcapMix.value,
    rim: helm.uniforms.uRimStrength.value,
    power: helm.uniforms.uSpecPower.value,
    amb: G.NPR.uAmbient.value,
    bloom: G.POST_STATE.bloomIntensity,
  };
});

const CLIP = { x: 645, y: 390, width: 140, height: 140 };
const TAGS = ['a-base', 'b-nospec', 'c-nomatcap', 'd-norim', 'e-nobloom', 'f-noambient', 'g-power9'];

for (const tag of TAGS) {
  await p.evaluate((t) => {
    const h = window.__H, S = window.__SAVE;
    h.uniforms.uSpecStrength.value = S.spec;
    h.uniforms.uMatcapMix.value = S.matcap;
    h.uniforms.uRimStrength.value = S.rim;
    h.uniforms.uSpecPower.value = S.power;
    window.__N.uAmbient.value = S.amb;
    window.__P.bloomIntensity = S.bloom;
    if (t === 'b-nospec') h.uniforms.uSpecStrength.value = 0;
    if (t === 'c-nomatcap') h.uniforms.uMatcapMix.value = 0;
    if (t === 'd-norim') h.uniforms.uRimStrength.value = 0;
    if (t === 'e-nobloom') window.__P.bloomIntensity = 0;
    if (t === 'f-noambient') window.__N.uAmbient.value = 0;
    if (t === 'g-power9') h.uniforms.uSpecPower.value = 9;
  }, tag);
  // Re-render the SAME simulation state: step with dt 0 so nothing moves.
  await p.evaluate(() => window.__DESCENT__.game.capture.step(1e-6));
  await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
  await p.screenshot({ path: `captures/_helm/${tag}.png`, clip: CLIP, animations: 'disabled' });
  console.log('  ok', tag);
}
await b.close();
