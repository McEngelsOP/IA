/**
 * _feel.mjs — handling probes on a CONTROLLED surface.
 *
 * The mountain is not a test rig: the ridge has 42 m flank drops, the scree run
 * has 0.4 m rollers, and a 2.5 s cornering test on any of them measures the
 * terrain rather than the bike. So these probes swap `physics.terrain` for a
 * synthetic plane of a chosen slope and a chosen surface. That is the only way
 * to get a number for "what radius does half steer give you at 16 m/s" that
 * means anything, or to compare the seven entries in the SURFACES table.
 *
 * Everything here is a pure physics measurement. Nothing is rendered.
 */
import { chromium } from 'playwright';

const b = await chromium.launch({ headless: true, args: ['--use-angle=default', '--enable-unsafe-swiftshader'] });
let p = await b.newPage();
p.on('pageerror', (e) => console.log('ERR', e.message.slice(0, 200)));

const INSTALL = () => {
  const g = window.__DESCENT__.game;
  g.capture.takeControl();
  const THREE_V = g.race.player.bike.state.position.constructor;

  /** A plane descending `slope` radians toward +Z, of one uniform surface. */
  function flatTerrain(slope, grip, roughAmp, roughLen) {
    const S = {
      kind: 6, grip, rollingResistance: 0.24, drag: 0.0,
      dustAmount: 0.55, harshness: 0.7, audioTone: 'hardpack',
    };
    const h = (x, z) => -z * Math.tan(slope)
      + (roughAmp ? roughAmp * Math.sin(z * (2 * Math.PI / roughLen)) * Math.cos(x * 0.31) : 0);
    const smp = { height: 0, normal: new THREE_V(0, 1, 0), slope: 0, kind: 6, surface: S };
    return {
      heightAt: h,
      normalAt(x, z, out) {
        const o = out ?? new THREE_V();
        const e = 0.05;
        return o.set(-(h(x + e, z) - h(x - e, z)) / (2 * e), 1, -(h(x, z + e) - h(x, z - e)) / (2 * e)).normalize();
      },
      sampleAt(x, z, out) {
        const o = out ?? smp;
        o.height = h(x, z);
        this.normalAt(x, z, o.normal);
        o.slope = Math.acos(Math.max(-1, Math.min(1, o.normal.y)));
        o.kind = 6;
        o.surface = S;
        return o;
      },
    };
  }

  window.__F__ = {
    run(opts, driver) {
      const { slope = 0, grip = 1.0, speed = 16, seconds = 2.5, roughAmp = 0, roughLen = 6 } = opts;
      g.capture.setPose('summit-rider');
      const bike = g.race.player.bike;
      const phys = bike.physics;
      const st = bike.state;
      const terr = flatTerrain(slope, grip, roughAmp, roughLen);
      const realTerrain = phys.terrain;
      phys.terrain = terr;
      for (const r of g.race.racers) {
        if (r === g.race.player) continue;
        r.bike.state.position.y -= 800;
        r.bike.state.velocity.set(0, 0, 0);
      }
      // Origin, pointing down the fall line (+Z), on its wheels.
      const pos = new THREE_V(0, terr.heightAt(0, 0) + 0.267 - 0.02, 0);
      const fwd = new THREE_V(0, 0, 1);
      bike.reset(pos, fwd);
      st.velocity.set(0, 0, 0).addScaledVector(
        new THREE_V(0, 0, 1).applyQuaternion(st.orientation), speed,
      );

      if (!phys.__o) phys.__o = phys.step.bind(phys);
      const rec = [];
      let n = 0;
      phys.step = (input, dt) => {
        if (driver) driver(input, n, st);
        phys.__o(input, dt);
        const up = new THREE_V(0, 1, 0).applyQuaternion(st.orientation);
        rec.push({
          n, speed: st.speed, lean: st.lean, steer: st.steerAngle, pitch: st.pitch,
          yawRate: st.angularVelocity.dot(up),
          rollRate: st.angularVelocity.dot(new THREE_V(0, 0, 1).applyQuaternion(st.orientation)),
          pitchRate: st.angularVelocity.dot(new THREE_V(1, 0, 0).applyQuaternion(st.orientation)),
          fg: st.front.grounded ? 1 : 0, rg: st.rear.grounded ? 1 : 0,
          fc: st.front.compression, rc: st.rear.compression,
          fl: st.front.load, rl: st.rear.load,
          rearLat: Math.abs(phys.rear.lateralSlip), rearLock: phys.rear.locked ? 1 : 0,
          mode: st.mode, manual: st.manualAmount, landed: st.landedThisStep ? 1 : 0,
          lq: st.landingQuality, li: st.landingImpact, crashed: st.crashedThisStep ? 1 : 0,
          x: st.position.x, y: st.position.y, z: st.position.z,
          agl: st.position.y - terr.heightAt(st.position.x, st.position.z) - 0.267,
        });
        n++;
      };
      for (let i = 0; i < Math.round(seconds * 60); i++) g.capture.step(1 / 60);
      phys.step = phys.__o;
      phys.terrain = realTerrain;
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
async function ev(fn, arg, tries = 4) {
  for (let i = 0; ; i++) {
    try {
      if (!(await p.evaluate(() => !!window.__F__).catch(() => false))) await p.evaluate(INSTALL);
      return await p.evaluate(fn, arg);
    } catch (e) {
      if (i >= tries) throw e;
      try { await p.close(); } catch {}
      p = await b.newPage();
      p.on('pageerror', (ev2) => console.log('ERR', ev2.message.slice(0, 200)));
      await boot();
    }
  }
}
const tail = (a, f = 0.35) => a.slice(Math.floor(a.length * (1 - f)));
const avg = (a) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
const pad = (v, n, d = 3) => String(typeof v === 'number' ? v.toFixed(d) : v).padStart(n);

// ── 1. Flat-plane ride quality ───────────────────────────────────────────────
console.log('RIDE (level plane, 18 m/s, pedal — how planted is the bike?)');
for (const [amp, len] of [[0, 6], [0.10, 6], [0.22, 6], [0.40, 6], [0.22, 3]]) {
  const r = await ev(([a, l]) => window.__F__.run({ slope: 0.19, speed: 18, seconds: 3, roughAmp: a, roughLen: l },
    (i) => { i.pedal = 1; }), [amp, len]);
  const any = r.filter((x) => x.fg || x.rg).length / r.length;
  const both = r.filter((x) => x.fg && x.rg).length / r.length;
  console.log(
    `  bump ±${amp.toFixed(2)} m / ${len} m   grounded any ${(any * 100).toFixed(0)}%  both ${(both * 100).toFixed(0)}%   ` +
    `speed ${r[0].speed.toFixed(1)}→${r[r.length - 1].speed.toFixed(1)}   |lean| max ${Math.max(...r.map((x) => Math.abs(x.lean))).toFixed(3)}   ` +
    `maxAGL ${Math.max(...r.map((x) => x.agl)).toFixed(2)} m  ` +
    `landings ${r.filter((x) => x.landed).length} (q ${r.filter((x) => x.landed).map((x) => x.lq.toFixed(2)).join(',')})`,
  );
}

// ── 2. Steady-state cornering ────────────────────────────────────────────────
console.log('\nCORNERING (level plane, trail grip, 2.5 s of held steer from 16 m/s)');
console.log('  steer  lean(rad)  yaw(rad/s)  radius(m)  latAccel(m/s²)  speed_out  rearSlip');
for (const steer of [0.25, 0.5, 0.75, 1.0]) {
  const r = await ev(([st]) => window.__F__.run({ speed: 16, seconds: 2.5 },
    (i) => { i.steer = st; i.pedal = 0.4; }), [steer]);
  const t2 = tail(r);
  const yaw = avg(t2.map((x) => x.yawRate));
  const sp = avg(t2.map((x) => x.speed));
  console.log(
    `  ${String(steer).padEnd(5)} ${pad(avg(t2.map((x) => x.lean)), 10)} ${pad(yaw, 11)} ` +
    `${pad(Math.abs(yaw) > 1e-3 ? sp / Math.abs(yaw) : 999, 10, 1)} ${pad(Math.abs(yaw) * sp, 15, 2)} ` +
    `${pad(r[r.length - 1].speed, 10, 1)} ${pad(avg(t2.map((x) => x.rearLat)), 9, 2)}`,
  );
}

// ── 3. Grip per surface ──────────────────────────────────────────────────────
console.log('\nGRIP BY SURFACE (level plane, steer 0.7 from 16 m/s — SURFACES table)');
for (const [nm, grip] of [['trail', 1.0], ['rock', 0.92], ['dirt', 0.88], ['grass', 0.74], ['snow', 0.58], ['water', 0.52], ['scree', 0.46]]) {
  const r = await ev(([gr]) => window.__F__.run({ speed: 16, seconds: 2.5, grip: gr },
    (i) => { i.steer = 0.7; i.pedal = 0.4; }), [grip]);
  const t2 = tail(r);
  const yaw = avg(t2.map((x) => x.yawRate));
  const sp = avg(t2.map((x) => x.speed));
  console.log(
    `  ${nm.padEnd(6)} grip ${grip.toFixed(2)}  lean ${pad(avg(t2.map((x) => x.lean)), 6)}  ` +
    `radius ${pad(Math.abs(yaw) > 1e-3 ? sp / Math.abs(yaw) : 999, 6, 1)} m  ` +
    `latAccel ${pad(Math.abs(yaw) * sp, 5, 1)}  rearSlip ${pad(avg(t2.map((x) => x.rearLat)), 5, 2)} m/s  ` +
    `speed_out ${pad(r[r.length - 1].speed, 5, 1)}`,
  );
}

// ── 4. Braking ───────────────────────────────────────────────────────────────
console.log('\nBRAKING (level plane, trail, from 16 m/s to a stop)');
for (const [label, br, bf, stv] of [
  ['rear only ', 1, 0, 0], ['front only', 0, 1, 0], ['both      ', 1, 1, 0], ['rear+steer', 1, 0, 0.5],
]) {
  const r = await ev(([R, F, S]) => window.__F__.run({ speed: 16, seconds: 3 },
    (i) => { i.brakeRear = R; i.brakeFront = F; i.steer = S; }), [br, bf, stv]);
  let dist = 0;
  let stopAt = r.length - 1;
  for (let i = 1; i < r.length; i++) {
    if (r[i].speed > 0.5) { dist += Math.hypot(r[i].x - r[i - 1].x, r[i].z - r[i - 1].z); stopAt = i; }
  }
  console.log(
    `  ${label}  stop in ${pad(dist, 5, 1)} m (${pad(stopAt / 120, 4, 2)} s)   ` +
    `rear locked ${pad(100 * r.filter((x) => x.rearLock).length / r.length, 4, 0)}%   ` +
    `peak rear step-out ${pad(Math.max(...r.map((x) => x.rearLat)), 5, 2)} m/s`,
  );
}

// ── 5. Hop, pump and manual ──────────────────────────────────────────────────
console.log('\nHOP / PUMP / MANUAL (level plane)');
for (const [label, pre] of [['hop, 0.35 s preload', 42], ['hop, no preload   ', 0]]) {
  const r = await ev(([P]) => window.__F__.run({ speed: 12, seconds: 2.5 },
    (i, n) => { i.pedal = 0.3; i.crouch = P && n > 60 - P && n < 60 ? 1 : 0; i.wantHop = n === 60; }), [pre]);
  console.log(`  ${label}: peak height ${pad(Math.max(...r.map((x) => x.agl)), 5, 2)} m, ` +
    `${r.filter((x) => !(x.fg || x.rg)).length} steps airborne`);
}
const man = await ev(() => window.__F__.run({ speed: 12, seconds: 3 },
  (i, n) => { i.pedal = 0.5; i.pitchLean = n > 60 ? 1 : 0; }), null);
const mt = man.slice(-90);
console.log(`  manual (pitchLean 1, 1.5 s): pitch ${pad(avg(mt.map((x) => x.pitch)), 6)} rad ` +
  `(negative = nose up), manualAmount ${pad(avg(mt.map((x) => x.manual)), 4, 2)}, ` +
  `front off ground ${pad(100 * mt.filter((x) => !x.fg).length / mt.length, 4, 0)}% of steps`);
const endo = await ev(() => window.__F__.run({ speed: 12, seconds: 3 },
  (i, n) => { i.brakeFront = 0.35; i.pitchLean = n > 60 ? -1 : 0; }), null);
const et = endo.slice(-90);
console.log(`  endo (pitchLean -1 + front brake): pitch ${pad(avg(et.map((x) => x.pitch)), 6)} rad, ` +
  `rear off ground ${pad(100 * et.filter((x) => !x.rg).length / et.length, 4, 0)}% of steps`);

// ── 6. Air control ───────────────────────────────────────────────────────────
console.log('\nAIR CONTROL (launched vertically, rotation rate reached with full input)');
for (const [nm, field, target] of [['yaw', 'airYaw', 3.9], ['pitch', 'airPitch', 4.6], ['roll', 'airRoll', 3.4]]) {
  const r = await ev(([f]) => window.__F__.run({ speed: 14, seconds: 2.2 },
    (i, n, st) => { if (n === 6) st.velocity.y += 13; if (n > 8) i[f] = 1; }), [field]);
  const air = r.filter((x) => !(x.fg || x.rg)).slice(0, 72);
  const key = nm === 'yaw' ? 'yawRate' : nm === 'pitch' ? 'pitchRate' : 'rollRate';
  const reached = air.length ? Math.max(...air.map((x) => Math.abs(x[key]))) : 0;
  const t90 = air.findIndex((x) => Math.abs(x[key]) > target * 0.9);
  console.log(`  ${nm.padEnd(6)} target ${target} rad/s, reached ${pad(reached, 5, 2)}, ` +
    `time to 90% ${t90 >= 0 ? pad(t90 / 120, 5, 3) + ' s' : ' never'}, airborne ${air.length} steps`);
}

// ── 7. Landing angle matching ────────────────────────────────────────────────
console.log('\nLANDING ANGLE MATCHING (drop onto a 20° slope, pitched by N degrees)');
for (const deg of [0, 5, 10, 20, 30, 45]) {
  const r = await ev(([d]) => {
    const g = window.__DESCENT__.game;
    return window.__F__.run({ slope: 0.35, speed: 15, seconds: 2.4 }, (i, n, st) => {
      if (n === 4) {
        st.velocity.y += 9;
        // Rotate the bike about its LEFT axis by d degrees: + = nose down.
        const L = new (st.position.constructor)(1, 0, 0).applyQuaternion(st.orientation);
        const q = new (st.orientation.constructor)().setFromAxisAngle(L, (d * Math.PI) / 180);
        st.orientation.premultiply(q).normalize();
      }
    });
  }, [deg]);
  const li = r.findIndex((x) => x.landed);
  const before = li > 0 ? r[li - 1].speed : r[0].speed;
  const after = li >= 0 ? r[li].speed : r[r.length - 1].speed;
  const crashed = r.some((x) => x.crashed);
  const q = li >= 0 ? r[li].lq : -1;
  const imp = li >= 0 ? r[li].li : -1;
  console.log(`  +${String(deg).padStart(2)}° nose-down: quality ${pad(q, 5, 2)} impact ${pad(imp, 5, 2)}  ` +
    `speed ${pad(before, 5, 1)} → ${pad(after, 5, 1)} m/s (kept ${pad(100 * after / Math.max(before, 1e-3), 4, 0)}%)  ` +
    `${crashed ? 'CRASHED' : 'rode away'}`);
}

await b.close();
