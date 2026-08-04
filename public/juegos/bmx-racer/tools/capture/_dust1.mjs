import { chromium } from 'playwright';
const b = await chromium.launch({ headless: true, args: ['--use-angle=default','--enable-gpu','--ignore-gpu-blocklist','--enable-unsafe-swiftshader'] });
const p = await b.newPage();
p.on('pageerror', e => console.log('PAGEERR', e.message.slice(0,400)));
p.on('console', m => { const t=m.type(); if(t==='error'||t==='warning') console.log(`[page:${t}]`, m.text().slice(0,1500)); });
await p.goto('http://127.0.0.1:5173/?capture=1&pr=1', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => !!window.__DESCENT__?.game?.effects, null, { timeout: 240000 });

const out = await p.evaluate(() => {
  const g = window.__DESCENT__.game;
  g.capture.takeControl();
  g.capture.setSequence('scree-speed');
  for (let i = 0; i < 90; i++) g.capture.step(1/60);

  const dust = g.effects.dust;
  const mesh = dust.mesh;
  const pool = dust.pool;
  const geo = mesh.geometry;
  const cam = g.__cam || null;

  // walk parent chain visibility
  const chain = [];
  let o = mesh;
  while (o) { chain.push({ name: o.name || o.type, visible: o.visible, layers: o.layers.mask }); o = o.parent; }

  // atlas alpha audit
  const atlas = dust.material.uniforms.uAtlas.value;
  const img = atlas.image;
  const c2 = document.createElement('canvas'); c2.width = img.width; c2.height = img.height;
  const cx2 = c2.getContext('2d'); cx2.drawImage(img, 0, 0);
  const d = cx2.getImageData(0,0,img.width,img.height).data;
  let opaque = 0, any = 0;
  for (let i = 0; i < d.length; i += 4) { if (d[i+3] > 8) any++; if (d[i+3] >= 128) opaque++; }

  // CPU replication of the vertex shader for live particles
  const THREE = window.__DESCENT__.THREE;
  const camera = g.__engine?.camera ?? window.__DESCENT__.engine?.camera;
  const aOrigin = pool.array('aOrigin'), aVel = pool.array('aVel'),
        aParams = pool.array('aParams'), aShape = pool.array('aShape');
  const fxTime = dust.time;
  let alive = 0; const samples = [];
  for (let i = 0; i < pool.capacity; i++) {
    const t = fxTime - aParams[i*4];
    const age = t * aParams[i*4+1];
    if (age < 0 || age >= 1) continue;
    alive++;
    if (samples.length < 6) samples.push({
      age: +age.toFixed(3), t: +t.toFixed(3),
      origin: [aOrigin[i*3].toFixed(1), aOrigin[i*3+1].toFixed(1), aOrigin[i*3+2].toFixed(1)],
      scale: +aShape[i*4].toFixed(3), growth: +aShape[i*4+1].toFixed(2), kind: aParams[i*4+3],
      life: +(1/aParams[i*4+1]).toFixed(2),
    });
  }

  return {
    instanceCount: geo.instanceCount,
    poolUsed: pool.used,
    aliveNow: alive,
    samples,
    meshVisible: mesh.visible, frustumCulled: mesh.frustumCulled, renderOrder: mesh.renderOrder,
    matTransparent: dust.material.transparent, depthWrite: dust.material.depthWrite, depthTest: dust.material.depthTest,
    uFxTime: dust.material.uniforms.uFxTime.value, uOpacity: dust.material.uniforms.uOpacity.value,
    uSizeScale: dust.material.uniforms.uSizeScale.value,
    chain,
    atlas: { w: img.width, h: img.height, anyAlphaPx: any, opaqueAlphaPx: opaque, frac: +(opaque/(img.width*img.height)).toFixed(3) },
    rendererInfo: { calls: 0 },
  };
});
console.log(JSON.stringify(out, null, 1));
await b.close();
