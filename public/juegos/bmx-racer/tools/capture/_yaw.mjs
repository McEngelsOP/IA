/**
 * _yaw.mjs — DOES THE LEAN TURN THE BIKE?
 *
 * Holds full steer at a range of speeds and measures the thing the handling
 * model claims: heading change, yaw rate, and the achieved turn radius, against
 * the radius the lean the bike is actually holding implies (v^2 / (g tan lean)).
 *
 * Also breaks the yaw moment down by source so a null result can be attributed:
 * front tyre lateral, rear tyre lateral, the yaw damper, everything else.
 *
 * Usage: node tools/capture/_yaw.mjs [--tag before]
 */
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const args = {};
for (let i = 0; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith('--')) {
    const n = process.argv[i + 1];
    args[a.slice(2)] = n && !n.startsWith('--') ? n : true;
  }
}
const TAG = args.tag ?? 'run';
const OUT = path.resolve('tools/capture/_out');

const b = await chromium.launch({
  headless: true,
  args: ['--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'],
});
let p = await b.newPage();
p.on('pageerror', (e) => console.log('ERR', e.message.slice(0, 300)));

const INSTALL = () => {
  const g = window.__DESCENT__.game;
  g.capture.takeControl();
  window.__YW__ = {
    /** Spawn on the ribbon at normalised t, on the wheels, at `speed`. */
    spawnAt(t, speed) {
      g.capture.setPose('summit-rider');
      const total = g.track.length;
      const d = Math.max(1, Math.min(total - 2, t * total));
      const smp = g.track.sampleAtDistance(d);
      const bike = g.race.player.bike;
      const pos = smp.position.clone();
      pos.y += 0.267 - 0.03;
      bike.reset(pos, smp.tangent.clone());
      bike.state.velocity.copy(smp.tangent).multiplyScalar(speed);
      for (const r of g.race.racers) {
        if (r === g.race.player) continue;
        r.bike.state.position.y -= 400;
        r.bike.state.velocity.set(0, 0, 0);
      }
      g.effects.cameraDirector.resetTo(bike.state);
    },
    run(t, speed, input, seconds) {
      window.__YW__.spawnAt(t, speed);
      const base = {
        steer: 0, pedal: 0, brakeRear: 0, brakeFront: 0, crouch: 0,
        pitchLean: 0, airPitch: 0, airYaw: 0, airRoll: 0,
        wantBoost: false, wantHop: false,
      };
      g.race.player.scripted = Object.assign(base, input);

      const bike = g.race.player.bike;
      const phys = bike.physics;
      const st = bike.state;
      if (!phys.__origStep) phys.__origStep = phys.step.bind(phys);
      const rec = [];
      const T = window.__DESCENT__.THREE ?? null;
      let n = 0;
      phys.step = (inp, dt) => {
        phys.__origStep(inp, dt);
        // Body axes from the orientation.
        const q = st.orientation;
        const fx = 2 * (q.x * q.z + q.w * q.y);
        const fy = 2 * (q.y * q.z - q.w * q.x);
        const fz = 1 - 2 * (q.x * q.x + q.y * q.y);
        const ux = 2 * (q.x * q.y - q.w * q.z);
        const uy = 1 - 2 * (q.x * q.x + q.z * q.z);
        const uz = 2 * (q.y * q.z + q.w * q.x);
        const w = st.angularVelocity;
        const fw = phys.front;
        const rw = phys.rear;
        rec.push({
          t: n / 120,
          speed: st.speed,
          lean: st.lean,
          steerA: st.steerAngle,
          heading: Math.atan2(fx, fz),
          course: Math.atan2(st.velocity.x, st.velocity.z),
          yawRate: w.x * ux + w.y * uy + w.z * uz,
          yawWorld: w.y,
          x: st.position.x, y: st.position.y, z: st.position.z,
          fGnd: fw.grounded ? 1 : 0, rGnd: rw.grounded ? 1 : 0,
          fLoad: fw.load, rLoad: rw.load,
          // Lateral tyre force, signed along the wheel's own left axis.
          fLat: fw.tyreForce.x * fw.left.x + fw.tyreForce.y * fw.left.y + fw.tyreForce.z * fw.left.z,
          rLat: rw.tyreForce.x * rw.left.x + rw.tyreForce.y * rw.left.y + rw.tyreForce.z * rw.left.z,
          fSlip: fw.slipAngle, rSlip: rw.slipAngle,
          fVlat: fw.vLat, rVlat: rw.vLat,
          mode: st.mode,
        });
        n++;
      };
      const frames = Math.round(seconds * 60);
      for (let i = 0; i < frames; i++) g.capture.step(1 / 60);
      phys.step = phys.__origStep;
      return rec;
    },
  };
};

async function boot() {
  await p.goto('http://127.0.0.1:5173/?capture=1&pr=1', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => !!window.__DESCENT__?.game?.capture, null, { timeout: 300000 });
  await p.evaluate(INSTALL);
}
await boot();

async function evalRetry(fn, arg, tries = 4) {
  for (let i = 0; ; i++) {
    try {
      const has = await p.evaluate(() => !!window.__YW__).catch(() => false);
      if (!has) await p.evaluate(INSTALL);
      return await p.evaluate(fn, arg);
    } catch (e) {
      if (i >= tries) throw e;
      console.log(`  (retry ${i + 1}: ${String(e.message).split('\n')[0].slice(0, 60)})`);
      try { await p.close(); } catch {}
      p = await b.newPage();
      p.on('pageerror', (ev) => console.log('ERR', ev.message.slice(0, 200)));
      await boot();
    }
  }
}

function unwrap(a) {
  const out = [a[0]];
  for (let i = 1; i < a.length; i++) {
    let d = a[i] - a[i - 1];
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    out.push(out[i - 1] + d);
  }
  return out;
}

const report = { tag: TAG, at: new Date().toISOString(), rows: [] };
const G = 20.4;

// t = 0.19 is the scree run: open, straight, no berms to confuse the reading.
// t = 0.394 is the switchback the review's `switchback` sequence uses.
const CASES = [
  ['scree  ', 0.189, 8], ['scree  ', 0.189, 14], ['scree  ', 0.189, 20],
  ['switchb', 0.394, 8], ['switchb', 0.394, 14], ['switchb', 0.394, 20],
];

console.log('FULL STEER HELD 2.0 s — steer 0.9, no pedal');
console.log('site     v0    vEnd  |lean|  steerA  dHeading  yawRate  R_actual  R_from_lean  fLat   rLat');
for (const [site, t, v] of CASES) {
  const rec = await evalRetry(
    ([t, v]) => window.__YW__.run(t, v, { steer: 0.9 }, 2.0),
    [t, v],
  );
  // Skip the first 0.25 s: spawn settle.
  const r = rec.slice(30);
  const head = unwrap(r.map((x) => x.heading));
  const dHead = head[head.length - 1] - head[0];
  const dt = (r.length - 1) / 120;
  const mean = (f) => r.reduce((a, x) => a + f(x), 0) / r.length;
  const meanSpeed = mean((x) => x.speed);
  const meanLean = mean((x) => x.lean);
  const meanYaw = dHead / dt;
  const Ractual = Math.abs(meanYaw) > 1e-4 ? meanSpeed / Math.abs(meanYaw) : Infinity;
  const Rlean = Math.abs(Math.tan(meanLean)) > 1e-4
    ? (meanSpeed * meanSpeed) / (G * Math.abs(Math.tan(meanLean))) : Infinity;
  const row = {
    site: site.trim(), t, v0: v,
    vEnd: +r[r.length - 1].speed.toFixed(2),
    lean: +meanLean.toFixed(3),
    steerA: +mean((x) => x.steerA).toFixed(4),
    dHeading: +dHead.toFixed(3),
    yawRate: +meanYaw.toFixed(3),
    Ractual: +Ractual.toFixed(1),
    Rlean: +Rlean.toFixed(1),
    fLat: +mean((x) => x.fLat).toFixed(0),
    rLat: +mean((x) => x.rLat).toFixed(0),
    fSlip: +mean((x) => x.fSlip).toFixed(4),
    rSlip: +mean((x) => x.rSlip).toFixed(4),
    grounded: +(100 * mean((x) => (x.fGnd || x.rGnd) ? 1 : 0)).toFixed(0),
    modes: [...new Set(r.map((x) => x.mode))],
  };
  report.rows.push(row);
  console.log(
    `${site} ${String(v).padStart(4)} ${String(row.vEnd).padStart(7)} ` +
    `${String(row.lean).padStart(7)} ${String(row.steerA).padStart(7)} ` +
    `${String(row.dHeading).padStart(9)} ${String(row.yawRate).padStart(8)} ` +
    `${String(row.Ractual).padStart(9)} ${String(row.Rlean).padStart(12)} ` +
    `${String(row.fLat).padStart(6)} ${String(row.rLat).padStart(6)}  gnd${row.grounded}% ${row.modes.join('/')}`,
  );
}

await mkdir(OUT, { recursive: true });
await writeFile(path.join(OUT, `yaw-${TAG}.json`), JSON.stringify(report, null, 1));
console.log(`\n→ tools/capture/_out/yaw-${TAG}.json`);
await b.close();
