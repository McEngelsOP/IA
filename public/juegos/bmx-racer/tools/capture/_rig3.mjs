import { chromium } from 'playwright';
const seq = process.argv[2] ?? 'crash';
const N = Number(process.argv[3] ?? 40);
const shots = (process.argv[4] ?? '').split(',').filter(Boolean).map(Number);
const b = await chromium.launch({ headless: true, args: ['--use-angle=default','--enable-gpu','--ignore-gpu-blocklist','--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 900, height: 520 } });
p.on('pageerror', e => console.log('ERR', e.message.slice(0,300)));
await p.goto('http://127.0.0.1:5173/?capture=1&pr=1', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => !!window.__DESCENT__?.game?.capture, null, { timeout: 240000 });

await p.evaluate((s) => {
  const g = window.__DESCENT__.game;
  g.capture.takeControl();
  g.capture.setSequence(s);
  const r = g.race.player;
  window.__M = { rig: r.rig, bike: r.bike, st: r.bike.state, r };
}, seq);
// harness settle
await p.evaluate(() => { for (let i=0;i<4;i++) window.__DESCENT__.game.capture.step(1/60); });

const rows = [];
for (let f = 0; f < N; f++) {
  const row = await p.evaluate(() => {
    const g = window.__DESCENT__.game;
    g.capture.step(1/60);
    const { rig, bike, st, r } = window.__M;
    const bones = rig.skel.bones;
    const idx = {}; bones.forEach((b,i)=>idx[b.name]=i);
    const rp = (n) => { const v = rig.rigPos[idx[n]]; return [+v.x.toFixed(3),+v.y.toFixed(3),+v.z.toFixed(3)]; };
    // foot bone world vs pedal anchor world
    const wpos = (o) => { o.updateWorldMatrix(true,false); const e=o.matrixWorld.elements; return [e[12],e[13],e[14]]; };
    const d3 = (a,c)=>Math.hypot(a[0]-c[0],a[1]-c[1],a[2]-c[2]);
    const an = bike.anchors;
    const fL = wpos(bones[idx.footL]), fR = wpos(bones[idx.footR]);
    const pL = wpos(an.pedalLeft), pR = wpos(an.pedalRight);
    const hL = wpos(bones[idx.handL]), hR = wpos(bones[idx.handR]);
    const bL = wpos(an.barLeft), bR = wpos(an.barRight);
    const PC = window.__PC;
    const a = rig.applied;
    return {
      mode: st.mode, spd:+ (st.speed*3.6).toFixed(1), lean:+st.lean.toFixed(4), steer:+st.steerAngle.toFixed(4),
      landed: st.landedThisStep, imp:+st.landingImpact.toFixed(3), crashed: st.crashedThisStep,
      eff:+rig.effort.toFixed(3), stand:+rig.standWeight.toFixed(3), air:+rig.airWeight.toFixed(3),
      cw:+rig.crashWeight.toFixed(3), ct:+rig.crashTime.toFixed(3),
      absorb:[+rig.absorbFork.spring.value.toFixed(4),+rig.absorbLegs.spring.value.toFixed(4),+rig.absorbSpine.spring.value.toFixed(4),+rig.absorbHead.spring.value.toFixed(4)],
      pend:[+rig.absorbFork.pending.toFixed(3),+rig.absorbLegs.pending.toFixed(3),+rig.absorbSpine.pending.toFixed(3),+rig.absorbHead.pending.toFixed(3)],
      pelvis: rp('pelvis'), head: rp('head'), hand: rp('handL'), foot: rp('footL'), footR: rp('footR'),
      // key applied channels
      ch: { pY:+a[1].toFixed(4), sBend:+a[6].toFixed(4), sSide:+a[7].toFixed(4), sTwist:+a[8].toFixed(4), hYaw:+a[12].toFixed(4), hPitch:+a[11].toFixed(4), lockHL:+a[15].toFixed(3), lockFL:+a[25].toFixed(3) },
      footErr: [+d3(fL,pL).toFixed(4), +d3(fR,pR).toFixed(4)],
      handErr: [+d3(hL,bL).toFixed(4), +d3(hR,bR).toFixed(4)],
    };
  });
  rows.push(row);
  if (shots.includes(f)) {
    await p.evaluate(() => new Promise(r => requestAnimationFrame(()=>r())));
    await p.screenshot({ path: `captures/_probe_${seq}_f${String(f).padStart(3,'0')}.png` });
  }
}
rows.forEach((r,i)=>console.log(i, JSON.stringify(r)));
await b.close();
