import { chromium } from 'playwright';
const b = await chromium.launch({ headless: true, args: ['--use-angle=default','--enable-gpu','--ignore-gpu-blocklist','--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1000, height: 560 } });
p.on('pageerror', e => console.log('PAGEERR', e.message.slice(0,300)));
await p.goto('http://127.0.0.1:5173/?capture=1&pr=2', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => !!window.__DESCENT__?.game?.effects, null, { timeout: 240000 });
const r = await p.evaluate(() => {
  const g = window.__DESCENT__.game, fx = g.effects;
  g.capture.takeControl(); g.capture.setPose('scree-speed');
  for (let i = 0; i < 10; i++) g.capture.step(1/60);
  const st = g.race.player.bike.state;
  // Genuinely launch it, every frame until it is off the ground.
  st.velocity.y += 11;
  const modes = []; let landFrame = -1, flashFrames = 0, dustAtLand = 0, sprayAtLand = 0;
  for (let i = 0; i < 90; i++) {
    g.capture.step(1/60);
    modes.push(st.mode[0]);
    const u = g.post.composite.uniforms;
    if (u.uImpactFlash.value > 0.005) flashFrames++;
    if (landFrame < 0 && i > 3 && modes[i-1] === 'a' && modes[i] === 'g') {
      landFrame = i; dustAtLand = fx.dust.countAlive(); sprayAtLand = fx.debris.liveCount;
    }
    if (landFrame >= 0 && i === landFrame + 4) break;
  }
  return { modes: modes.join(''), landFrame, dustAtLand, sprayAtLand,
           flashFrames, peakAir: +st.peakAirHeight.toFixed(2), kmh: +(st.speed*3.6).toFixed(1) };
});
console.log(JSON.stringify(r));
await p.evaluate(() => new Promise(r => requestAnimationFrame(() => r())));
await p.screenshot({ path: 'captures/_v_landing.png' });
await b.close();
