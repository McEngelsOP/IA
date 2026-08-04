/**
 * _course.mjs — CAN THE BIKE RIDE THE MOUNTAIN?
 *
 * A fixed stick held for two seconds is not a test of a handling model, it is a
 * test of whether the stick happens to point at the corner. This drives the
 * course with a deterministic pure-pursuit controller — aim at the centreline a
 * lookahead ahead, steer proportionally, brake when the corner ahead is tighter
 * than the current speed allows — and reports, per section:
 *
 *   progress rate, mean speed, % of physics steps with a wheel on the ground,
 *   max |lateral| against the authored half-width, time spent off the corridor,
 *   crashes, and the biggest 0.5 s change in |velocity| in each direction.
 *
 * That last one is the motion review's "physically impossible acceleration"
 * measured over a run the rider is actually trying to ride.
 *
 * Deterministic: the controller is a pure function of track + state.
 *
 * Usage: node tools/capture/_course.mjs [--tag before] [--from 0.27] [--secs 26]
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
const LEGS = [
  ['scree-run', 0.115, 12],
  ['switchbacks', 0.275, 22],
  ['rock-garden', 0.522, 10],
  ['tabletop', 0.602, 8],
  ['ridge-sprint', 0.706, 12],
  ['stream-bed', 0.815, 10],
];

const b = await chromium.launch({
  headless: true,
  args: ['--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'],
});
let p = await b.newPage();
p.on('pageerror', (e) => console.log('ERR', e.message.slice(0, 300)));

const INSTALL = () => {
  const g = window.__DESCENT__.game;
  g.capture.takeControl();
  window.__CR__ = {
    drive(t0, seconds) {
      g.capture.setPose('scree-speed');
      const track = g.track;
      const spline = track.spline ?? track;
      const total = track.length;
      const d0 = Math.max(2, Math.min(total - 4, t0 * total));
      const smp = track.sampleAtDistance(d0);
      const bike = g.race.player.bike;
      const pos = smp.position.clone();
      pos.y += 0.267 - 0.03;
      bike.reset(pos, smp.tangent.clone());
      bike.state.velocity.copy(smp.tangent).multiplyScalar(12);
      for (const r of g.race.racers) {
        if (r === g.race.player) continue;
        r.bike.state.position.y -= 4000;
        r.bike.state.velocity.set(0, 0, 0);
      }
      const inp = {
        steer: 0, pedal: 1, brakeRear: 0, brakeFront: 0, crouch: 0,
        pitchLean: 0, airPitch: 0, airYaw: 0, airRoll: 0, wantBoost: false, wantHop: false,
      };
      g.race.player.scripted = inp;

      const st = bike.state;
      const phys = bike.physics;
      const orig = phys.step.bind(phys);
      const rec = [];
      let n = 0;
      const P = st.position.clone();
      phys.step = (input, dt) => {
        // ── pure pursuit, recomputed every physics step ──────────────────────
        const pr = spline.project(st.position);
        const look = Math.max(6, Math.min(22, st.speed * 0.9));
        const aim = track.sampleAtDistance(Math.min(total - 2, pr.distance + look));
        // Heading error toward the aim point, in world XZ.
        const q = st.orientation;
        const hx = 2 * (q.x * q.z + q.w * q.y);
        const hz = 1 - 2 * (q.x * q.x + q.y * q.y);
        const dx = aim.position.x - st.position.x;
        const dz = aim.position.z - st.position.z;
        let err = Math.atan2(dx, dz) - Math.atan2(hx, hz);
        while (err > Math.PI) err -= 2 * Math.PI;
        while (err < -Math.PI) err += 2 * Math.PI;
        // heading error > 0 means the aim is to the LEFT (world +Y rotation);
        // positive steer turns RIGHT, so the sign flips.
        let steer = -err * 2.2;
        steer = Math.max(-1, Math.min(1, steer));
        // Speed control: brake for a corner tighter than the speed allows.
        const a1 = track.sampleAtDistance(Math.min(total - 2, pr.distance + 14));
        const a2 = track.sampleAtDistance(Math.min(total - 2, pr.distance + 28));
        let dh = Math.atan2(a2.tangent.x, a2.tangent.z) - Math.atan2(a1.tangent.x, a1.tangent.z);
        while (dh > Math.PI) dh -= 2 * Math.PI;
        while (dh < -Math.PI) dh += 2 * Math.PI;
        const R = Math.abs(dh) > 1e-3 ? 14 / Math.abs(dh) : 1e4;
        const vMax = Math.sqrt(Math.max(4, 12 * R));
        input.steer = steer;
        input.pedal = st.speed < vMax ? 1 : 0;
        input.brakeRear = st.speed > vMax * 1.18 ? 0.85 : 0;
        input.brakeFront = st.speed > vMax * 1.25 ? 0.5 : 0;

        const cmdSteer = input.steer, cmdBr = input.brakeRear;
        orig(input, dt);
        P.copy(st.position);
        const pr2 = spline.project(st.position);
        rec.push({
          i: n, d: pr2.distance, lat: pr2.lateral, hw: pr2.sample.halfWidth ?? 4,
          sp: st.speed, gnd: (phys.front.grounded || phys.rear.grounded) ? 1 : 0,
          mode: st.mode, lean: st.lean, crash: st.crashCount, land: st.landCount,
          y: st.position.y, steer: cmdSteer, brake: cmdBr, err, vMax, R,
          steerA: st.steerAngle, err2: err,
          fg: phys.front.grounded ? 1 : 0, rg: phys.rear.grounded ? 1 : 0,
        });
        n++;
      };
      const frames = Math.round(seconds * 60);
      for (let i = 0; i < frames; i++) g.capture.step(1 / 60);
      phys.step = orig;
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

async function evalRetry(fn, arg, tries = 5) {
  for (let i = 0; ; i++) {
    try {
      const has = await p.evaluate(() => !!window.__CR__).catch(() => false);
      if (!has) await p.evaluate(INSTALL);
      return await p.evaluate(fn, arg);
    } catch (e) {
      if (i >= tries) throw e;
      console.log(`  (retry ${i + 1}: ${String(e.message).split('\n')[0].slice(0, 70)})`);
      try { await p.close(); } catch {}
      p = await b.newPage();
      p.on('pageerror', (ev) => console.log('ERR', ev.message.slice(0, 200)));
      await boot();
    }
  }
}

const report = { tag: TAG, at: new Date().toISOString(), legs: [] };
console.log('PURE-PURSUIT COURSE DRIVE');
console.log('leg            secs  progress  m/s avg   gnd%   maxLat/hw  offTrack%  crashes  worst+a  worst-a');
for (const [name, t0, secs] of LEGS) {
  const rec = await evalRetry(([t, s]) => window.__CR__.drive(t, s), [t0, secs]);
  const r = rec.slice(24);
  const dt = 1 / 120;
  const prog = r[r.length - 1].d - r[0].d;
  const mean = r.reduce((a, x) => a + x.sp, 0) / r.length;
  const gnd = (100 * r.filter((x) => x.gnd).length) / r.length;
  let maxLatRatio = 0, off = 0;
  for (const x of r) {
    const ratio = Math.abs(x.lat) / Math.max(1, x.hw);
    if (ratio > maxLatRatio) maxLatRatio = ratio;
    if (ratio > 1) off++;
  }
  const crashes = r[r.length - 1].crash - r[0].crash;
  let wUp = -1e9, wDn = 1e9, wUpAir = 0, wDnAir = 0;
  const W = 60;
  for (let i = 0; i + W < r.length; i++) {
    const a = (r[i + W].sp - r[i].sp) / (W * dt);
    if (a > wUp) { wUp = a; wUpAir = r.slice(i, i + W).filter((x) => !x.gnd).length / W; }
    if (a < wDn) { wDn = a; wDnAir = r.slice(i, i + W).filter((x) => !x.gnd).length / W; }
  }
  const row = {
    leg: name, secs, progress: +prog.toFixed(1), meanSpeed: +mean.toFixed(2),
    groundedPct: +gnd.toFixed(1), maxLatRatio: +maxLatRatio.toFixed(2),
    offTrackPct: +((100 * off) / r.length).toFixed(1), crashes,
    worstAccel: +wUp.toFixed(2), worstAccelAir: +(100 * wUpAir).toFixed(0),
    worstDecel: +wDn.toFixed(2), worstDecelAir: +(100 * wDnAir).toFixed(0),
    landings: r[r.length - 1].land - r[0].land,
  };
  report.legs.push(row);
  if (args.dump && name === args.dump) {
    console.log('  step    d      lat/hw   sp   vMax    R    steerCmd steerA  lean  err   fg rg mode');
    for (let i = 0; i < r.length; i += 30) {
      const x = r[i];
      console.log(
        `  ${String(x.i).padStart(4)} ${x.d.toFixed(0).padStart(6)} ` +
        `${(x.lat / x.hw).toFixed(2).padStart(7)} ${x.sp.toFixed(1).padStart(5)} ` +
        `${x.vMax.toFixed(1).padStart(5)} ${(x.R > 999 ? 999 : x.R).toFixed(0).padStart(5)} ` +
        `${x.steer.toFixed(2).padStart(8)} ${x.steerA.toFixed(2).padStart(6)} ` +
        `${x.lean.toFixed(2).padStart(6)} ${x.err.toFixed(2).padStart(6)}  ${x.fg} ${x.rg}  ${x.mode}`,
      );
    }
  }
  console.log(
    `${name.padEnd(14)} ${String(secs).padStart(4)} ${String(row.progress).padStart(9)} ` +
    `${String(row.meanSpeed).padStart(9)} ${String(row.groundedPct).padStart(6)} ` +
    `${String(row.maxLatRatio).padStart(11)} ${String(row.offTrackPct).padStart(10)} ` +
    `${String(row.crashes).padStart(8)} ${String(row.worstAccel).padStart(8)}(air${row.worstAccelAir}%) ` +
    `${String(row.worstDecel).padStart(7)}(air${row.worstDecelAir}%)`,
  );
}

await mkdir(OUT, { recursive: true });
await writeFile(path.join(OUT, `course-${TAG}.json`), JSON.stringify(report, null, 1));
console.log(`\n→ tools/capture/_out/course-${TAG}.json`);
await b.close();
