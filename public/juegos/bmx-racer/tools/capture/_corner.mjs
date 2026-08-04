import { chromium } from 'playwright';
const STEER = Number(process.argv[2] ?? 0.5);
const b = await chromium.launch({ headless: true, args: ['--use-angle=default','--enable-unsafe-swiftshader'] });
const p = await b.newPage();
p.on('pageerror', e => console.log('ERR', e.message.slice(0,200)));
await p.goto('http://127.0.0.1:5173/?capture=1&pr=1', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => !!window.__DESCENT__?.game?.capture, null, { timeout: 300000 });
const rows = await p.evaluate((STEER) => {
  const g = window.__DESCENT__.game; g.capture.takeControl(); g.capture.setPose('summit-rider');
  const bike = g.race.player.bike, phys = bike.physics, st = bike.state;
  const V = st.position.constructor;
  const S = { kind:6, grip:1.0, rollingResistance:0.24, drag:0, dustAmount:0.55, harshness:0.7, audioTone:'hardpack' };
  const h = () => 0;
  const smp = { height:0, normal:new V(0,1,0), slope:0, kind:6, surface:S };
  phys.terrain = { heightAt:h, normalAt:(x,z,o)=> (o??new V()).set(0,1,0),
    sampleAt:(x,z,o)=>{ const q=o??smp; q.height=0; q.normal.set(0,1,0); q.slope=0; q.kind=6; q.surface=S; return q; } };
  for (const r of g.race.racers) if (r!==g.race.player) { r.bike.state.position.y -= 800; r.bike.state.velocity.set(0,0,0); }
  bike.reset(new V(0,0.267-0.02,0), new V(0,0,1));
  st.velocity.set(0,0,1).multiplyScalar(16);
  const o = phys.step.bind(phys); const out=[]; let n=0;
  phys.step = (i,dt) => { i.steer = STEER; i.pedal = 0.4; o(i,dt);
    const up=new V(0,1,0).applyQuaternion(st.orientation), fw=new V(0,0,1).applyQuaternion(st.orientation);
    out.push({n, sp:+st.speed.toFixed(2), lean:+st.lean.toFixed(3), steer:+st.steerAngle.toFixed(3),
      yaw:+st.angularVelocity.dot(up).toFixed(3), roll:+st.angularVelocity.dot(fw).toFixed(2),
      fg:st.front.grounded?1:0, rg:st.rear.grounded?1:0, fl:Math.round(st.front.load), rl:Math.round(st.rear.load),
      rlat:+phys.rear.lateralSlip.toFixed(2), flat:+phys.front.lateralSlip.toFixed(2),
      pit:+st.pitch.toFixed(3), fsl:+phys.front.suspensionLength.toFixed(3), rsl:+phys.rear.suspensionLength.toFixed(3), rsa:+phys.rear.slipAngle.toFixed(3), mode:st.mode.slice(0,3), y:+st.position.y.toFixed(3)});
    n++; };
  for (let i=0;i<150;i++) g.capture.step(1/60);
  phys.step = o;
  return out;
}, STEER);
console.log('n    sp    lean   steer   yaw    roll  fg rg fLoad rLoad rLat  fLat  pitch  fSusp  rSusp  mode   y');
for (let i=0;i<rows.length;i+=4){const r=rows[i];
console.log(`${String(r.n).padStart(4)} ${String(r.sp).padStart(5)} ${String(r.lean).padStart(6)} ${String(r.steer).padStart(6)} ${String(r.yaw).padStart(6)} ${String(r.roll).padStart(6)}  ${r.fg} ${r.rg} ${String(r.fl).padStart(5)} ${String(r.rl).padStart(5)} ${String(r.rlat).padStart(5)} ${String(r.flat).padStart(5)} ${String(r.pit).padStart(6)} ${String(r.fsl).padStart(6)} ${String(r.rsl).padStart(6)} ${r.mode} ${r.y}`);}
await b.close();
