import { chromium } from 'playwright';
const b = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader','--use-angle=default'] });
const c = await b.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
const p = await c.newPage();
await p.goto('http://127.0.0.1:5175/?capture=1&pr=2', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => !!window.__DESCENT__?.game?.capture, null, { timeout: 180000 });
await p.evaluate(() => window.__DESCENT__.game.capture.takeControl());
await p.evaluate(() => window.__DESCENT__.game.capture.setPose('bike-detail'));
await p.evaluate(() => { for (let i=0;i<12;i++) window.__DESCENT__.game.capture.step(1/60); });
const out = await p.evaluate(() => {
  const g = window.__DESCENT__.game;
  const cam = g.engine.camera; cam.updateMatrixWorld();
  const st = g.race.player.bike.state;
  const V = st.position.constructor;
  const rows = [];
  const roots = [];
  g.engine.scene.traverse((o) => {
    if (!o.name) return;
    if (!o.name.startsWith('bike:') && !o.name.startsWith('rider:')) return;
    const wp = new V(); o.getWorldPosition(wp);
    if (wp.distanceToSquared(st.position) < 36) roots.push(o);
  });
  const v = new V();
  for (const root of roots) {
    root.updateMatrixWorld();
    root.traverse((o) => {
      const geo = o.geometry; if (!geo) return;
      if (!geo.boundingBox) geo.computeBoundingBox();
      const bb = geo.boundingBox; if (!bb) return;
      let lo = 1e9, hi = -1e9;
      for (let i = 0; i < 8; i++) {
        v.set(i&1?bb.max.x:bb.min.x, i&2?bb.max.y:bb.min.y, i&4?bb.max.z:bb.min.z);
        v.applyMatrix4(o.matrixWorld);
        const vc = v.clone().applyMatrix4(cam.matrixWorldInverse);
        if (vc.z > -0.05) continue;
        v.project(cam);
        const py = 1 - (v.y*0.5+0.5);
        lo = Math.min(lo, py); hi = Math.max(hi, py);
      }
      let vis = o.visible, par = o.parent;
      while (par) { vis = vis && par.visible; par = par.parent; }
      rows.push(`${root.name} / ${o.name||o.type} vis=${vis} y=[${lo.toFixed(3)},${hi.toFixed(3)}] h=${(hi-lo).toFixed(3)}`);
    });
  }
  return rows;
});
console.log(out.join('\n'));
await b.close();
