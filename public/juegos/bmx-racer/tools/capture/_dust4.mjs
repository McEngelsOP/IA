import { chromium } from 'playwright';

const b = await chromium.launch({ headless: true, args: ['--use-angle=default','--enable-gpu','--ignore-gpu-blocklist','--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1000, height: 560 } });
p.on('pageerror', e => console.log('PAGEERR', e.message.slice(0,400)));
p.on('console', m => { if (m.type()==='error') console.log('[err]', m.text().slice(0,800)); });
await p.goto('http://127.0.0.1:5173/?capture=1&pr=1', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => !!window.__DESCENT__?.game?.effects, null, { timeout: 240000 });

const r = await p.evaluate(() => {
  const g = window.__DESCENT__.game;
  g.capture.takeControl();
  g.capture.setSequence('scree-speed');
  for (let i = 0; i < 50; i++) g.capture.step(1/60);

  const dust = g.effects.dust, pool = dust.pool;
  const aO = pool.array('aOrigin'), aV = pool.array('aVel'), aP = pool.array('aParams'), aS = pool.array('aShape');
  const cam = g.effects.cameraDirector.camera;
  cam.updateMatrixWorld(true);
  const ft = dust.time;

  // Replicate the vertex shader on the CPU.
  const mvp = new (cam.projectionMatrix.constructor)();
  mvp.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
  const V3 = cam.position.constructor;
  const wp = new V3();
  let alive = 0, inFront = 0, onScreen = 0, minPx = 1e9, maxPx = 0, sumPx = 0;
  const near = [];
  for (let i = 0; i < pool.capacity; i++) {
    const t = ft - aP[i*4]; const age = t * aP[i*4+1];
    if (age < 0 || age >= 1) continue;
    alive++;
    const kind = aP[i*4+3];
    const isPlume = kind >= 1.5 ? 1 : 0;
    const drag = isPlume ? 1.15 : 2.9;
    const f = (1 - Math.exp(-drag*t)) / drag;
    wp.set(aO[i*3] + aV[i*3]*f, aO[i*3+1] + aV[i*3+1]*f, aO[i*3+2] + aV[i*3+2]*f);
    const rise = (0.45 + (1.25-0.45)*aP[i*4+2]) * (isPlume ? 1.5 : 0.7);
    wp.y += rise * t * (1 - 0.55*age);
    const d = wp.distanceTo(cam.position);
    const c = wp.clone().project(cam);
    if (c.z > -1 && c.z < 1) inFront++;
    const sx = (c.x*0.5+0.5)*1000, sy = (1-(c.y*0.5+0.5))*560;
    if (c.z > -1 && c.z < 1 && sx > -100 && sx < 1100 && sy > -100 && sy < 660) {
      onScreen++;
      const steps = isPlume ? 7 : (kind >= 0.5 ? 4 : 5);
      const q = Math.min(Math.floor(age*steps + (aP[i*4+2]*17.13 % 1)*0.7)/steps, 1);
      const sz = aS[i*4] * (1 + aS[i*4+1]*q) * 2.0;
      const px = (sz / d) * (560/2) / Math.tan(cam.fov*Math.PI/360);
      sumPx += px; if (px < minPx) minPx = px; if (px > maxPx) maxPx = px;
      if (near.length < 5) near.push({ d: +d.toFixed(1), sx: sx|0, sy: sy|0, px: +px.toFixed(1), age: +age.toFixed(2) });
    }
  }
  return { alive, inFront, onScreen, avgPx: +(sumPx/Math.max(onScreen,1)).toFixed(1),
           minPx: +minPx.toFixed(1), maxPx: +maxPx.toFixed(1), near,
           camPos: cam.position.toArray().map(v=>+v.toFixed(1)),
           bikePos: g.race.player.bike.state.position.toArray().map(v=>+v.toFixed(1)) };
});
console.log(JSON.stringify(r, null, 1));

// Now: flat-red override, no discard, depthTest off. Does ANYTHING draw?
await p.evaluate(() => {
  const m = window.__DESCENT__.game.effects.dust.material;
  m.fragmentShader = m.fragmentShader
    .replace('if (tex.a < 0.5) discard;', '')
    .replace('fragColor = vec4(col, vAlpha * uOpacity);', 'fragColor = vec4(1.0, 0.0, 0.0, 1.0);');
  m.depthTest = false;
  m.needsUpdate = true;
  window.__DESCENT__.game.capture.step(1/60);
});
await p.evaluate(() => new Promise(r => requestAnimationFrame(() => r())));
await p.screenshot({ path: 'captures/_v_redquads.png' });
await b.close();
