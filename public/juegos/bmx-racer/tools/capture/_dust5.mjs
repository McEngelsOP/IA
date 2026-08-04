import { chromium } from 'playwright';

const b = await chromium.launch({ headless: true, args: ['--use-angle=default','--enable-gpu','--ignore-gpu-blocklist','--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1000, height: 560 } });
p.on('pageerror', e => console.log('PAGEERR', e.message.slice(0,400)));
p.on('console', m => { if (m.type()==='error') console.log('[err]', m.text().slice(0,800)); });
await p.goto('http://127.0.0.1:5173/?capture=1&pr=1', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => !!window.__DESCENT__?.game?.effects, null, { timeout: 240000 });

await p.evaluate(() => {
  const g = window.__DESCENT__.game;
  g.capture.takeControl();
  g.capture.setSequence('scree-speed');
  for (let i = 0; i < 50; i++) g.capture.step(1/60);
  window.__ORIG_FRAG = g.effects.dust.material.fragmentShader;
});

async function variant(name, patch) {
  await p.evaluate((pj) => {
    const m = window.__DESCENT__.game.effects.dust.material;
    let f = window.__ORIG_FRAG;
    for (const [a, bq] of pj) f = f.replace(a, bq);
    m.fragmentShader = f;
    m.needsUpdate = true;
    window.__DESCENT__.game.capture.step(1/60);
  }, patch);
  await p.evaluate(() => new Promise(r => requestAnimationFrame(() => r())));
  await p.screenshot({ path: `captures/_var_${name}.png` });
  console.log('shot', name);
}

// A: keep discard, solid red  -> is the discard the killer?
await variant('A_discard_red', [['fragColor = vec4(col, vAlpha * uOpacity);', 'fragColor = vec4(1.0,0.0,0.0,1.0);']]);
// B: no discard, show atlas alpha as red channel
await variant('B_atlas_alpha', [['if (tex.a < 0.5) discard;', ''], ['fragColor = vec4(col, vAlpha * uOpacity);', 'fragColor = vec4(tex.a, tex.rgb.g, 0.0, 1.0);']]);
// C: keep discard, show vAlpha
await variant('C_valpha', [['fragColor = vec4(col, vAlpha * uOpacity);', 'fragColor = vec4(vAlpha, vAlpha, vAlpha, 1.0);']]);
// D: keep discard, real colour but alpha forced 1
await variant('D_col_a1', [['fragColor = vec4(col, vAlpha * uOpacity);', 'fragColor = vec4(col, 1.0);']]);
// E: untouched original
await variant('E_original', []);

await b.close();
