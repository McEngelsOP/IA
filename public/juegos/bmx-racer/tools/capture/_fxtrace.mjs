/**
 * _fxtrace.mjs — one line per rendered frame of the three FX channels the
 * motion critic reads: the dust population, the impact flash the composite is
 * actually handed, and the speed-line intensity.
 *
 *   node tools/capture/_fxtrace.mjs <seq> <frames> [tag]
 *
 * Every number is read AFTER the frame has been rendered, out of the uniform
 * the composite drew with — not out of POST_STATE, which is a staging buffer.
 */
import { chromium } from 'playwright';

const SEQ = process.argv[2] ?? 'crash';
const N = Number(process.argv[3] ?? 60);

for (let attempt = 1; attempt <= 5; attempt++) {
  try {
    await run();
    process.exit(0);
  } catch (e) {
    console.log(`  attempt ${attempt} failed: ${String(e.message).split('\n')[0]}`);
    await new Promise((r) => setTimeout(r, 4000));
  }
}
process.exit(1);

async function run() {
  const b = await chromium.launch({
    headless: true,
    args: ['--enable-unsafe-swiftshader', '--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist'],
  });
  try {
    const p = await b.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
    p.on('pageerror', (e) => console.log('PAGEERR', e.message.slice(0, 300)));
    await p.goto('http://127.0.0.1:5173/?capture=1&pr=2', { waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => !!window.__DESCENT__?.game?.capture, null, { timeout: 240000 });
    await p.evaluate(() => window.__DESCENT__.game.capture.takeControl());
    const ok = await p.evaluate((n) => window.__DESCENT__.game.capture.setSequence(n), SEQ);
    if (!ok) throw new Error(`unknown sequence ${SEQ}`);

    // Instrument emission BEFORE the settle frames, so the trace covers the
    // window in which a capture crash is actually forced.
    await p.evaluate(() => {
      const d = window.__DESCENT__.game.effects.dust;
      window.__EMIT__ = 0;
      const w = d.write.bind(d);
      d.write = function (...a) { window.__EMIT__++; return w(...a); };
    });

    const rows = [];
    for (let f = 0; f < N + 4; f++) {
      await p.evaluate(() => window.__DESCENT__.game.capture.step(1 / 60));
      await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
      const r = await p.evaluate(() => {
        const G = window.__DESCENT__.game;
        const st = G.race.player.bike.state;
        const u = G.post.composite.uniforms;
        const e = window.__EMIT__;
        window.__EMIT__ = 0;
        return {
          kmh: +(st.speed * 3.6).toFixed(1),
          mode: st.mode,
          land: st.landCount, crash: st.crashCount,
          air: +st.airHeight.toFixed(2),
          alive: G.effects.dust.countAlive(),
          emit: e,
          flash: +u.uImpactFlash.value.toFixed(4),
          ink: +u.uInkFlood.value.toFixed(4),
          desat: +u.uDesaturate.value.toFixed(4),
          lines: +u.uSpeedIntensity.value.toFixed(4),
          ts: +G.effects.timeScale.toFixed(2),
        };
      });
      rows.push({ f: f - 4, ...r });
    }
    for (const r of rows) if (r.f >= 0) console.log(JSON.stringify(r));
  } finally {
    await b.close();
  }
}
