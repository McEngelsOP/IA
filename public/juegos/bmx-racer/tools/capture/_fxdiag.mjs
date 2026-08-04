/**
 * _fxdiag.mjs — per-frame FX diagnostic for one sequence.
 *
 *   node tools/capture/_fxdiag.mjs crash 60
 *
 * Reports, per rendered frame: dust alive/emitted, rear-wheel contact Y vs the
 * mean live-puff Y, spin smear state, impact flash, speed-line intensity.
 */
import { chromium } from 'playwright';

const SEQ = process.argv[2] ?? 'crash';
const N = Number(process.argv[3] ?? 60);

const b = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist'],
});
const p = await b.newPage({ viewport: { width: 1000, height: 560 } });
p.on('pageerror', (e) => console.log('PAGEERR', e.message.slice(0, 400)));
p.on('console', (m) => { if (m.type() === 'error') console.log('[err]', m.text().slice(0, 400)); });
await p.goto('http://127.0.0.1:5173/?capture=1&pr=1', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => !!window.__DESCENT__?.game?.effects, null, { timeout: 240000 });

const rows = await p.evaluate(([seq, n]) => {
  const g = window.__DESCENT__.game;
  g.capture.takeControl();
  g.capture.setSequence(seq);
  const fx = g.effects;
  const dust = fx.dust;
  const out = [];
  const settle = 4;
  for (let i = -settle; i < n; i++) {
    g.capture.step(1 / 60);
    const st = g.race.player.bike.state;
    // live puff stats
    const pool = dust.pool;
    const cap = pool.capacity;
    const par = dust.aParams, ori = dust.aOrigin, vel = dust.aVel, shp = dust.aShape;
    let alive = 0, sumY = 0, minY = 1e9, maxY = -1e9, sumSz = 0, sumVy = 0;
    const t = dust.time;
    for (let k = 0; k < cap; k++) {
      const age = (t - par[k * 4]) * par[k * 4 + 1];
      if (age < 0 || age >= 1) continue;
      alive++;
      // analytic position with the same drag law as the shader
      const kind = par[k * 4 + 3];
      const drag = kind >= 1.5 ? 1.15 : 2.9;
      const tt = t - par[k * 4];
      const y = ori[k * 3 + 1] + vel[k * 3 + 1] * ((1 - Math.exp(-drag * tt)) / drag);
      sumY += y; sumVy += vel[k * 3 + 1];
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      sumSz += shp[k * 4] * (1 + shp[k * 4 + 1] * Math.min(age, 1));
    }
    const rear = st.rear;
    const rs = fx.rearSpin, fs = fx.frontSpin;
    out.push({
      f: i,
      mode: st.mode,
      kmh: +(st.speed * 3.6).toFixed(1),
      alive,
      emit: dust.emittedThisFrame,
      contactY: +rear.contactPoint.y.toFixed(2),
      grounded: rear.grounded,
      puffY: alive ? +(sumY / alive).toFixed(2) : null,
      dY: alive ? +(sumY / alive - rear.contactPoint.y).toFixed(2) : null,
      maxdY: alive ? +(maxY - rear.contactPoint.y).toFixed(2) : null,
      // visible radius in metres = scale*(1+growth*q), sizeScale 2 => half-extent
      radM: alive ? +(sumSz / alive).toFixed(2) : null,
      spinRate: +rear.spinRate.toFixed(1),
      spin01: rs ? +rs.spin01.toFixed(3) : 'NO-RIG',
      spinVis: rs ? rs.mesh.visible : 'NO-RIG',
      fSpinVis: fs ? fs.mesh.visible : 'NO-RIG',
      flashL: fx.impact.flashFramesLeft,
      flashPk: +fx.impact.flashPeak.toFixed(3),
      lines: +fx.speed.intensity.toFixed(3),
      ts: +fx.timeScale.toFixed(2),
      crashN: st.crashCount, landN: st.landCount,
    });
  }
  return out;
}, [SEQ, N]);

for (const r of rows) console.log(JSON.stringify(r));
await b.close();
