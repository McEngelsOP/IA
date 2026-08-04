import { chromium } from 'playwright';
const b = await chromium.launch({ headless: true, args: ['--use-angle=default','--enable-gpu','--ignore-gpu-blocklist','--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 900, height: 520 } });
p.on('pageerror', e => console.log('PAGEERR', e.message.slice(0,200)));
await p.goto('http://127.0.0.1:5173/?capture=1&pr=1', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => !!window.__DESCENT__?.game?.effects, null, { timeout: 240000 });
await p.evaluate(() => window.__DESCENT__.game.capture.takeControl());
for (const kmh of [30, 50, 70]) {
  const r = await p.evaluate((k) => {
    const g = window.__DESCENT__.game;
    g.capture.setPose('scree-speed');
    const st = g.race.player.bike.state;
    // Pin the speed each frame so the ramp is sampled at exactly this value.
    const v = k / 3.6;
    for (let i = 0; i < 40; i++) {
      const s = st.velocity.length();
      if (s > 0.01) st.velocity.multiplyScalar(v / s);
      st.speed = v;
      g.capture.step(1/60);
    }
    const sp = g.effects.speed;
    const u = g.post.composite.uniforms;
    return { kmh: k, intensity: +u.uSpeedIntensity.value.toFixed(3),
             radial: +sp.radial.toFixed(3), chroma: +sp.chroma.toFixed(3),
             focus: [+sp.focus.x.toFixed(2), +sp.focus.y.toFixed(2)] };
  }, kmh);
  console.log(JSON.stringify(r));
  await p.evaluate(() => new Promise(r => requestAnimationFrame(() => r())));
  await p.screenshot({ path: `captures/_sl_${kmh}.png` });
}
await b.close();
