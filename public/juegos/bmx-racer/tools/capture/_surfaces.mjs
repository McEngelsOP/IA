import { chromium } from 'playwright';
const b = await chromium.launch({ headless: true, args: ['--use-angle=default','--enable-gpu','--ignore-gpu-blocklist','--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 900, height: 520 } });
p.on('pageerror', e => console.log('PAGEERR', e.message.slice(0,300)));
await p.goto('http://127.0.0.1:5173/?capture=1&pr=1', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => !!window.__DESCENT__?.game?.effects, null, { timeout: 240000 });

// 1. Does Water exist near the stream bed at all?
console.log('WATER SCAN', JSON.stringify(await p.evaluate(() => {
  const g = window.__DESCENT__.game;
  const counts = {};
  let waterPts = 0, sample = null;
  for (let i = 0; i <= 200; i++) {
    const t = 0.811 + (0.887 - 0.811) * (i / 200);
    const s = g.track.sampleAtT(t);
    for (let o = -8; o <= 8; o += 1) {
      const x = s.position.x + s.left.x * o, z = s.position.z + s.left.z * o;
      const k = g.terrain.sampleAt(x, z).kind;
      counts[k] = (counts[k] ?? 0) + 1;
      if (k === 5) { waterPts++; if (!sample) sample = { t: +t.toFixed(3), off: o }; }
    }
  }
  return { kindCounts: counts, waterPts, firstWater: sample };
}, null)));

// 2. Debris/dust volume per surface, by direct call, all else equal.
console.log('PER-SURFACE', JSON.stringify(await p.evaluate(() => {
  const g = window.__DESCENT__.game, fx = g.effects;
  g.capture.takeControl(); g.capture.setPose('scree-speed');
  for (let i = 0; i < 10; i++) g.capture.step(1/60);
  const st = g.race.player.bike.state;
  const S = { scree:{kind:3,dustAmount:1.35}, snow:{kind:4,dustAmount:1.5}, water:{kind:5,dustAmount:1.8}, rock:{kind:0,dustAmount:0.18}, trail:{kind:6,dustAmount:0.55} };
  const out = {};
  for (const [name, s] of Object.entries(S)) {
    const surf = { kind:s.kind, grip:1, rollingResistance:1, drag:0, dustAmount:s.dustAmount, harshness:1, audioTone:'gravel' };
    fx.debris.clear();
    const d0 = fx.dust.countAlive();
    fx.dust.burst(st.rear.contactPoint, st.rear.contactNormal, st.velocity, 0.9, surf);
    fx.debris.screeSpray(st.rear.contactPoint, st.rear.contactNormal, st.velocity, 0.8, surf);
    out[name] = { dustPuffs: fx.dust.countAlive() - d0, debrisChips: fx.debris.liveCount };
  }
  // Splash path
  fx.debris.clear();
  fx.debris.splash(st.rear.contactPoint, st.rear.contactNormal, st.velocity, 0.9);
  out.splashCall = { chips: fx.debris.liveCount };
  return out;
}, null)));
await b.close();
