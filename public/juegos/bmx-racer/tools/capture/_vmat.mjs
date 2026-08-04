import { chromium } from 'playwright';
const b = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader','--use-angle=default','--enable-gpu','--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 800, height: 600 } });
p.on('pageerror', e => console.log('PAGEERR', e.message.slice(0,300)));
await p.goto('http://127.0.0.1:5173/?capture=1&pr=2', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => !!window.__DESCENT__?.game?.capture, null, { timeout: 240000 });
await p.evaluate(() => window.__DESCENT__.game.capture.takeControl());
await p.evaluate(() => window.__DESCENT__.game.capture.setPose('rider-closeup'));
await p.evaluate(() => { for (let i=0;i<6;i++) window.__DESCENT__.game.capture.step(1/60); });
const r = await p.evaluate(async () => {
  const G = await import('/src/npr/NprGlobals.ts');
  const out = { mats: [], npr: {}, post: {} };
  const seen = new Set();
  window.__DESCENT__.engine.scene.traverse((o) => {
    const m = o.material; if (!m || !m.uniforms) return;
    const n = m.name || '?';
    if (!n.startsWith('rider') && !n.startsWith('hull:jersey') && !n.startsWith('hull:helmet')) return;
    if (seen.has(o.name)) return; seen.add(o.name);
    const u = m.uniforms;
    out.mats.push({
      mesh: o.name, mat: n, hull: !!o.userData.isHull,
      defines: Object.keys(m.defines || {}).join(','),
      specP: u.uSpecPower?.value, specS: u.uSpecStrength?.value,
      mc: u.uMatcapMix?.value, rimS: u.uRimStrength?.value, rimP: u.uRimPower?.value,
      vsteps: u.uValueSteps?.value,
      idChroma: u.uIdentityChroma?.value, idRim: u.uIdentityRim?.value,
      idInk: u.uIdentityInkFloor?.value,
      idColor: u.uIdentityColor?.value ? [u.uIdentityColor.value.r, u.uIdentityColor.value.g, u.uIdentityColor.value.b].map(v=>+v.toFixed(3)) : null,
      hatch: u.uHatchStrength?.value,
      edgeSoft: u.uEdgeSoftness?.value,
      bands: u.uBandColor?.value?.map(c => [c.r,c.g,c.b].map(v=>+v.toFixed(3))),
      thr: u.uBandThreshold?.value,
    });
  });
  out.npr = { ambient: G.NPR.uAmbient.value, hatchGlobal: G.NPR.uHatchGlobal.value, shadowStrength: G.NPR.uShadowStrength.value, sunDir: G.NPR.uSunDir.value.toArray().map(v=>+v.toFixed(3)) };
  out.post = { bloom: G.POST_STATE.bloomIntensity, radial: G.POST_STATE.radialBlur, lines: G.POST_STATE.speedLineIntensity };
  return out;
});
console.log(JSON.stringify(r, null, 1));
await b.close();
