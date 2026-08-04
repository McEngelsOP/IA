import { chromium } from 'playwright';
const b = await chromium.launch({ headless: true, args: ['--use-angle=default','--enable-gpu','--ignore-gpu-blocklist','--enable-unsafe-swiftshader'] });
const p = await b.newPage();
p.on('pageerror', e => console.log('ERR', e.message.slice(0,300)));
await p.goto('http://127.0.0.1:5173/?capture=1&pr=1', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => !!window.__DESCENT__?.game?.capture, null, { timeout: 240000 });

const out = await p.evaluate((seqName) => {
  const g = window.__DESCENT__.game;
  g.capture.takeControl();
  const r = g.race.player;
  const rig = r.rig;
  const st = r.bike.state;

  const log = [];
  const orig = rig.update.bind(rig);
  rig.update = (s, t, dt, time) => { log.push({dt, time}); return orig(s, t, dt, time); };

  g.capture.setSequence(seqName);
  const rows = [];
  for (let f = 0; f < 20; f++) {
    log.length = 0;
    g.capture.step(1/60);
    rows.push({
      f,
      calls: log.length,
      dts: log.map(l => +l.dt.toFixed(6)),
      times: log.map(l => +l.time.toFixed(4)),
      timeScale: +g.effects.timeScale.toFixed(4),
      camTS: +g.effects.cameraDirector.timeScale.toFixed(4),
      impactTS: +g.effects.impact.timeScale.toFixed(4),
      mode: st.mode,
      speed: +st.speed.toFixed(2),
      landed: st.landedThisStep,
      impact: +st.landingImpact.toFixed(3),
      crashed: st.crashedThisStep,
      cw: +rig.crashWeight.toFixed(4),
    });
  }
  return rows;
}, process.argv[2] ?? 'crash');
console.log(JSON.stringify(out, null, 0).replace(/},/g,'},\n'));
await b.close();
