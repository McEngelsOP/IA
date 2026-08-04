import { chromium } from 'playwright';
const b = await chromium.launch({ headless: true, args: ['--use-angle=default','--enable-gpu','--ignore-gpu-blocklist','--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 900, height: 520 } });
p.on('pageerror', e => console.log('PAGEERR', e.message.slice(0,300)));
await p.goto('http://127.0.0.1:5173/?capture=1&pr=2', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => !!window.__DESCENT__?.game?.effects, null, { timeout: 240000 });
const r = await p.evaluate(() => {
  const g = window.__DESCENT__.game;
  // Nearest water to the racing line through the stream bed.
  let best = null;
  for (let i = 0; i <= 300; i++) {
    const t = 0.811 + (0.887 - 0.811) * (i / 300);
    const s = g.track.sampleAtT(t);
    for (let o = -14; o <= 14; o += 0.5) {
      const x = s.position.x + s.left.x * o, z = s.position.z + s.left.z * o;
      if (g.terrain.sampleAt(x, z).kind === 5 && (!best || Math.abs(o) < Math.abs(best.o))) {
        best = { t, o, x, z, tan: [s.tangent.x, s.tangent.y, s.tangent.z] };
      }
    }
  }
  if (!best) return { found: false };

  g.capture.takeControl();
  g.capture.setPose('streambed');
  for (let i = 0; i < 8; i++) g.capture.step(1/60);

  // Put the player in the water and ride through it.
  const bike = g.race.player.bike;
  const V = bike.state.position.constructor;
  const pos = new V(best.x, g.terrain.heightAt(best.x, best.z) + 0.30, best.z);
  const fwd = new V(best.tan[0], best.tan[1], best.tan[2]);
  bike.reset(pos, fwd);
  bike.state.velocity.copy(fwd).multiplyScalar(9);
  g.effects.cameraDirector.resetTo(bike.state);
  const fx = g.effects;
  let maxDeb = 0, waterFrames = 0, kinds = new Set();
  for (let i = 0; i < 45; i++) {
    g.capture.step(1/60);
    kinds.add(bike.state.rear.surface?.kind);
    if (bike.state.rear.surface?.kind === 5) waterFrames++;
    maxDeb = Math.max(maxDeb, fx.debris.liveCount);
  }
  return { found: true, nearestWaterOffsetM: +best.o.toFixed(1), atT: +best.t.toFixed(3),
           waterFrames, of: 45, surfacesSeen: [...kinds], maxDebris: maxDeb,
           dust: fx.dust.countAlive(), kmh: +(bike.state.speed*3.6).toFixed(1) };
});
console.log(JSON.stringify(r));
await p.evaluate(() => new Promise(r => requestAnimationFrame(() => r())));
await p.screenshot({ path: 'captures/_v_splash.png' });
await b.close();
