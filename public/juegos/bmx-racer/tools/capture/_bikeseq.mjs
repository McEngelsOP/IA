/**
 * _bikeseq.mjs — per-physics-step trace of a named capture SEQUENCE.
 *
 * The motion critic reports in 60 fps frame numbers. This runs the same
 * sequence the capture harness runs, records every 120 Hz physics step with
 * BIKE_DIAG switched on, and prints the frame-indexed view alongside the force
 * attribution, so "impossible acceleration" can be attributed to a source
 * rather than guessed at.
 *
 * Usage: node tools/capture/_bikeseq.mjs <sequence> [seconds] [--tag t]
 */

import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const argv = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const SEQ = argv[0] ?? 'switchback';
const SECONDS = Number(argv[1] ?? 2.0);
const TAG = (process.argv.includes('--tag') ? process.argv[process.argv.indexOf('--tag') + 1] : null) ?? SEQ;
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
  window.__TR__ = {
    run(seq, seconds) {
      const bike = g.race.player.bike;
      const phys = bike.physics;
      const st = bike.state;
      if (seq.startsWith('pose:')) {
        const parts = seq.slice(5).split('@');
        g.capture.setPose(parts[0]);
        if (parts[1]) {
          const base = { steer: 0, pedal: 0, brakeRear: 0, brakeFront: 0, crouch: 0,
            pitchLean: 0, airPitch: 0, airYaw: 0, airRoll: 0, wantBoost: false, wantHop: false };
          g.race.player.scripted = Object.assign(base, JSON.parse(parts[1]));
        }
      } else {
        g.capture.setSequence(seq);
      }
      if (!phys.__origStep) phys.__origStep = phys.step.bind(phys);
      const D = phys.diag;
      D.enabled = true;
      const rec = [];
      let n = 0;
      const V = st.position.constructor;
      const fwd = new V();
      const up = new V();
      phys.step = (input, dt) => {
        phys.__origStep(input, dt);
        fwd.set(0, 0, 1).applyQuaternion(st.orientation);
        up.set(0, 1, 0).applyQuaternion(st.orientation);
        const tr = g.race.player.progress;
        rec.push({
          n, t: n / 120,
          x: +st.position.x.toFixed(3), y: +st.position.y.toFixed(3), z: +st.position.z.toFixed(3),
          speed: st.speed, fwdSpeed: st.forwardSpeed,
          heading: Math.atan2(fwd.x, fwd.z),
          yawRate: st.angularVelocity.dot(up),
          lean: st.lean, target: D.targetLean, pitch: st.pitch, steerA: st.steerAngle,
          fg: st.front.grounded ? 1 : 0, rg: st.rear.grounded ? 1 : 0,
          fl: st.front.load, rl: st.rear.load,
          fSlip: st.front.slipAngle, rSlip: st.rear.slipAngle,
          mode: st.mode, air: st.airHeight,
          dist: tr ? (tr.rawDistance ?? tr.distance ?? 0) : 0,
          off: tr ? (tr.offTrackBy ?? 0) : 0,
          lat: tr ? (tr.lateral ?? 0) : 0,
          corner: g.hud?.model?.cornerPreview ? g.hud.model.cornerPreview.distance : -1,
          proj: (() => { const pr = g.track.spline.project(st.position);
            return { d: pr.distance, lat: pr.lateral, hw: pr.sample.halfWidth }; })(),
          grip: st.rear.grounded ? st.rear.surface.grip : (st.front.grounded ? st.front.surface.grip : 0),
          kind: st.rear.grounded ? st.rear.surface.kind : (st.front.grounded ? st.front.surface.kind : '-'),
          gy: D.gy, dx: D.dx, dy: D.dy, dz: D.dz,
          hx: D.hx, hy: D.hy, hz: D.hz,
          sx: D.sx, sy: D.sy, sz: D.sz,
          ffx: D.fx, ffy: D.fy, ffz: D.fz,
          rfx: D.rx, rfy: D.ry, rfz: D.rz,
          cx: D.cx, cy: D.cy, cz: D.cz,
          drive: D.drive,
          speedPre: D.speedPre, speedInt: D.speedInt, speedFinal: D.speedFinal,
          dvPen: D.dvPen, dvHold: D.dvHold, dvLand: D.dvLand, dvCrash: D.dvCrash, dvImp: D.dvImpulse,
          yawDampT: D.yawDampT,
        });
        n++;
      };
      const frames = Math.round(seconds * 60);
      for (let i = 0; i < frames; i++) g.capture.step(1 / 60);
      phys.step = phys.__origStep;
      D.enabled = false;
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

const rec = await p.evaluate(([s, sec]) => window.__TR__.run(s, sec), [SEQ, SECONDS]);
await b.close();

const N = rec.length;
console.log(`${SEQ}: ${N} physics steps (${(N / 120).toFixed(2)}s), 2 steps per captured frame\n`);

let acc = 0, prev = rec[0].heading;
for (const r of rec) {
  let d = r.heading - prev;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  acc += d; prev = r.heading; r.hdg = acc;
}

const f = (i) => rec[Math.min(N - 1, i * 2)];
const deg = (r) => (r * 180 / Math.PI).toFixed(1);

console.log('frame  t     spd km/h  hdg°   yaw/s   lean°  tgt°  steer°  pitch°  gnd  mode      trackD    lat/hw kind');
for (let i = 0; i < Math.floor(N / 2); i += 5) {
  const r = f(i);
  console.log(
    `f${String(i).padStart(4, '0')} ${r.t.toFixed(2)} ${(r.speed * 3.6).toFixed(1).padStart(6)} ` +
    `${deg(r.hdg).padStart(7)} ${r.yawRate.toFixed(3).padStart(7)} ` +
    `${deg(r.lean).padStart(6)} ${deg(r.target).padStart(5)} ${deg(r.steerA).padStart(6)} ${deg(r.pitch).padStart(7)} ` +
    ` ${r.fg}${r.rg}  ${String(r.mode).padEnd(10)} ${r.proj.d.toFixed(1).padStart(7)} ${r.proj.lat.toFixed(2).padStart(6)}/${r.proj.hw.toFixed(1)} ${r.kind}`,
  );
}

console.log('\nLONGITUDINAL — per 5-frame window: dv/dt and the mean force along travel (m/s2 each)');
console.log('win          dv/dt    grav    drag     hug    susp  frontT   rearT   crash  |  dvPen  dvHold  dvLand dvCrash   dvImp');
for (let i = 0; i < Math.floor(N / 2) - 5; i += 5) {
  const a = f(i), c = f(i + 5);
  const dt = c.t - a.t;
  if (dt <= 0) continue;
  const acc2 = (c.speed - a.speed) / dt;
  let g0 = 0, dr = 0, hu = 0, su = 0, fr = 0, re = 0, cr = 0;
  let pen = 0, hold = 0, land = 0, cra = 0, imp = 0, cnt = 0;
  for (let k = i * 2 + 1; k <= Math.min(N - 1, (i + 5) * 2); k++) {
    const r = rec[k], q = rec[k - 1];
    const dxv = r.x - q.x, dyv = r.y - q.y, dzv = r.z - q.z;
    const L = Math.hypot(dxv, dyv, dzv) || 1;
    const ux = dxv / L, uy = dyv / L, uz = dzv / L;
    g0 += r.gy * uy;
    dr += r.dx * ux + r.dy * uy + r.dz * uz;
    hu += r.hx * ux + r.hy * uy + r.hz * uz;
    su += r.sx * ux + r.sy * uy + r.sz * uz;
    fr += r.ffx * ux + r.ffy * uy + r.ffz * uz;
    re += r.rfx * ux + r.rfy * uy + r.rfz * uz;
    cr += r.cx * ux + r.cy * uy + r.cz * uz;
    pen += r.dvPen; hold += r.dvHold; land += r.dvLand; cra += r.dvCrash; imp += r.dvImp;
    cnt++;
  }
  const M = 92;
  const p2 = (x) => (x / Math.max(cnt, 1) / M).toFixed(2).padStart(7);
  console.log(
    `f${String(i).padStart(4, '0')}-${String(i + 5).padStart(4, '0')} ${acc2.toFixed(2).padStart(8)} ` +
    `${p2(g0)} ${p2(dr)} ${p2(hu)} ${p2(su)} ${p2(fr)} ${p2(re)} ${p2(cr)}  | ` +
    `${pen.toFixed(3).padStart(6)} ${hold.toFixed(3).padStart(7)} ${land.toFixed(3).padStart(7)} ${cra.toFixed(3).padStart(7)} ${imp.toFixed(3).padStart(7)}`,
  );
}

await mkdir(OUT, { recursive: true });
await writeFile(path.join(OUT, `bikeseq-${TAG}.json`), JSON.stringify(rec, null, 0));
console.log(`\n→ tools/capture/_out/bikeseq-${TAG}.json`);
