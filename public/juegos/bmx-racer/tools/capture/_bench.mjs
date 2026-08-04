/**
 * _bench.mjs — THE HANDLING BENCH.
 *
 * The mountain is a terrible place to measure a handling model: every number is
 * contaminated by the slope the bike happens to be on and by whether it was in
 * the air at the time. This probe swaps the terrain under the player for a
 * FLAT, uniform-grip plane (BikeTerrain is a three-method duck type, so this
 * costs nothing and touches no other subsystem) and asks the questions the
 * handling model claims to answer:
 *
 *   • hold full steer at 8 / 14 / 20 m/s — what lean, what yaw rate, what
 *     radius, and does the radius agree with v^2/(g·tanθ)?
 *   • release the steer — does the bike come back to straight, and how fast?
 *   • kick the bike into 0.25 rad of yaw error with no input — does the yaw
 *     converge (stable) or diverge (a flat spin)?
 *
 * Usage: node tools/capture/_bench.mjs [--tag before] [--slope 0]
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
const SLOPE = +(args.slope ?? 0);
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
  const bike = g.race.player.bike;
  const phys = bike.physics;

  window.__BN__ = {
    /**
     * Replace the player's terrain with a flat (or constant-gradient) plane of
     * uniform surface. `surface` is borrowed from the live table so grip,
     * rolling resistance and harshness are the real shipped numbers.
     */
    flat(slope, surfaceKind) {
      const src = phys.rear.surface;
      const table = { base: 260 };
      // Reuse a real SurfaceProperties object; override grip if asked.
      const surf = surfaceKind ? Object.assign({}, src, surfaceKind) : src;
      const h = (x, z) => table.base - z * slope;
      const ny = 1 / Math.hypot(1, slope);
      const nz = slope * ny;
      const sample = { height: 0, normal: null, slope: Math.atan(slope), kind: src.kind, surface: surf };
      const terrain = {
        heightAt: h,
        normalAt(x, z, out) { if (out) { out.set(0, ny, nz); return out; } return null; },
        sampleAt(x, z, out) {
          const o = out ?? sample;
          o.height = h(x, z);
          o.normal.set(0, ny, nz);
          o.slope = Math.atan(slope);
          o.kind = src.kind;
          o.surface = surf;
          return o;
        },
      };
      phys.terrain = terrain;
      return { grip: surf.grip, rr: surf.rollingResistance, kind: String(src.kind) };
    },

    /** Place the bike on the plane facing +Z at `speed`, then run. */
    run(speed, input, seconds, kick) {
      const THREE_pos = bike.state.position;
      const fwd = { x: 0, y: 0, z: 1 };
      const pos = THREE_pos.clone().set(0, 260 + 0.267 - 0.02, -80);
      const f = THREE_pos.clone().set(0, 0, 1);
      bike.reset(pos, f);
      bike.state.velocity.set(0, 0, speed);
      for (const r of g.race.racers) {
        if (r === g.race.player) continue;
        r.bike.state.position.y -= 4000;
        r.bike.state.velocity.set(0, 0, 0);
      }
      const base = {
        steer: 0, pedal: 0, brakeRear: 0, brakeFront: 0, crouch: 0,
        pitchLean: 0, airPitch: 0, airYaw: 0, airRoll: 0,
        wantBoost: false, wantHop: false,
      };
      g.race.player.scripted = Object.assign(base, input);

      const st = bike.state;
      const d = phys.diag;
      d.enabled = true;
      const orig = phys.step.bind(phys);
      const rec = [];
      let n = 0;
      phys.step = (inp, dt) => {
        if (kick && n === kick.at) {
          // Rotate the body about world up by `kick.yaw` without touching the
          // velocity: an instantaneous yaw disturbance, like a rock.
          const c = Math.cos(kick.yaw / 2), s = Math.sin(kick.yaw / 2);
          const q = st.orientation;
          const x = q.x, y = q.y, z = q.z, w = q.w;
          q.set(c * x + s * z, c * y + s * w, c * z - s * x, c * w - s * y);
        }
        orig(inp, dt);
        const q = st.orientation;
        const hx = 2 * (q.x * q.z + q.w * q.y);
        const hz = 1 - 2 * (q.x * q.x + q.y * q.y);
        const ux = 2 * (q.x * q.y - q.w * q.z);
        const uy = 1 - 2 * (q.x * q.x + q.z * q.z);
        const uz = 2 * (q.y * q.z + q.w * q.x);
        const w2 = st.angularVelocity;
        rec.push({
          i: n, sp: st.speed,
          x: st.position.x, y: st.position.y, z: st.position.z,
          heading: Math.atan2(hx, hz),
          course: Math.atan2(st.velocity.x, st.velocity.z),
          yaw: w2.x * ux + w2.y * uy + w2.z * uz,
          lean: st.lean, tgt: d.targetLean, steerA: st.steerAngle,
          gnd: (phys.front.grounded || phys.rear.grounded) ? 1 : 0,
          fL: phys.front.load, rL: phys.rear.load,
          fLat: phys.front.grounded
            ? phys.front.tyreForce.x * phys.front.left.x + phys.front.tyreForce.y * phys.front.left.y + phys.front.tyreForce.z * phys.front.left.z : 0,
          rLat: phys.rear.grounded
            ? phys.rear.tyreForce.x * phys.rear.left.x + phys.rear.tyreForce.y * phys.rear.left.y + phys.rear.tyreForce.z * phys.rear.left.z : 0,
          fSA: phys.front.slipAngle, rSA: phys.rear.slipAngle,
          mode: st.mode,
        });
        n++;
      };
      const frames = Math.round(seconds * 60);
      for (let i = 0; i < frames; i++) g.capture.step(1 / 60);
      phys.step = orig;
      d.enabled = false;
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
      const has = await p.evaluate(() => !!window.__BN__).catch(() => false);
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

function unwrap(a) {
  const o = [a[0]];
  for (let i = 1; i < a.length; i++) {
    let d = a[i] - a[i - 1];
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    o.push(o[i - 1] + d);
  }
  return o;
}
const mean = (r, f) => r.reduce((a, x) => a + f(x), 0) / r.length;

const surf = await evalRetry((s) => window.__BN__.flat(s, null), SLOPE);
console.log(`BENCH: flat plane, slope ${SLOPE}, surface kind ${surf.kind} grip ${surf.grip} rr ${surf.rr}`);
const G = 20.4;
const report = { tag: TAG, slope: SLOPE, surface: surf, steady: [], release: [], kick: [] };

// ── 1. STEADY CORNER ────────────────────────────────────────────────────────
console.log('\n1) FULL STEER HELD 3 s — the steady corner');
console.log('  v   steer  lean  target  steerA  yawRate  R_yaw  R_path  R_lean  drift  fLat  rLat  gnd%');
for (const v of [8, 14, 20]) {
  for (const st of [0.5, 1.0]) {
    const rec = await evalRetry(
      ([v, st]) => window.__BN__.run(v, { steer: st }, 3.0, null),
      [v, st],
    );
    const r = rec.slice(180); // last 1.5 s = settled
    const head = unwrap(r.map((x) => x.heading));
    const dt = (r.length - 1) / 120;
    const yawM = (head[head.length - 1] - head[0]) / dt;
    const sp = mean(r, (x) => x.sp);
    const Ryaw = Math.abs(yawM) > 1e-3 ? sp / Math.abs(yawM) : Infinity;
    // Radius from the path itself: fit a circle through three points.
    const a0 = r[0], a1 = r[(r.length / 2) | 0], a2 = r[r.length - 1];
    const Rpath = circumradius(a0.x, a0.z, a1.x, a1.z, a2.x, a2.z);
    const lean = mean(r, (x) => x.lean);
    const Rlean = Math.abs(Math.tan(lean)) > 1e-3 ? (sp * sp) / (G * Math.abs(Math.tan(lean))) : Infinity;
    let drift = mean(r, (x) => {
      let d = x.course - x.heading;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      return d;
    });
    const row = {
      v, steer: st, lean: +lean.toFixed(3), target: +mean(r, (x) => x.tgt).toFixed(3),
      steerA: +mean(r, (x) => x.steerA).toFixed(3), yawRate: +yawM.toFixed(3),
      Ryaw: +Ryaw.toFixed(1), Rpath: +Rpath.toFixed(1), Rlean: +Rlean.toFixed(1),
      drift: +drift.toFixed(3), speed: +sp.toFixed(2),
      fLat: +mean(r, (x) => x.fLat).toFixed(0), rLat: +mean(r, (x) => x.rLat).toFixed(0),
      gnd: +(100 * mean(r, (x) => x.gnd)).toFixed(0),
    };
    report.steady.push(row);
    console.log(
      ` ${String(v).padStart(2)}  ${st.toFixed(1)}  ${String(row.lean).padStart(6)} ${String(row.target).padStart(6)}  ` +
      `${String(row.steerA).padStart(6)} ${String(row.yawRate).padStart(7)} ${String(row.Ryaw).padStart(6)} ` +
      `${String(row.Rpath).padStart(7)} ${String(row.Rlean).padStart(7)} ${String(row.drift).padStart(6)} ` +
      `${String(row.fLat).padStart(6)}${String(row.rLat).padStart(6)}  ${row.gnd}%`,
    );
  }
}

function circumradius(x1, y1, x2, y2, x3, y3) {
  const a = Math.hypot(x1 - x2, y1 - y2);
  const bb = Math.hypot(x2 - x3, y2 - y3);
  const c = Math.hypot(x3 - x1, y3 - y1);
  const area = Math.abs((x2 - x1) * (y3 - y1) - (x3 - x1) * (y2 - y1)) / 2;
  return area < 1e-6 ? Infinity : (a * bb * c) / (4 * area);
}

// ── 2. YAW DISTURBANCE ──────────────────────────────────────────────────────
console.log('\n2) YAW KICK — 0.25 rad of heading error at step 120, NO input after');
console.log('  v   drift@kick  +0.25s  +0.5s  +1.0s  +1.5s   verdict');
for (const v of [8, 14, 20]) {
  const rec = await evalRetry(
    (v) => window.__BN__.run(v, {}, 3.5, { at: 120, yaw: 0.25 }),
    v,
  );
  const drift = (i) => {
    const x = rec[Math.min(rec.length - 1, i)];
    let d = x.course - x.heading;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    return d;
  };
  const row = {
    v, at: +drift(121).toFixed(3), d25: +drift(150).toFixed(3), d50: +drift(180).toFixed(3),
    d100: +drift(240).toFixed(3), d150: +drift(300).toFixed(3),
    speedEnd: +rec[rec.length - 1].sp.toFixed(2), speedStart: +rec[110].sp.toFixed(2),
  };
  const conv = Math.abs(row.d150) < Math.abs(row.at) * 0.4;
  row.verdict = conv ? 'converges' : (Math.abs(row.d150) > Math.abs(row.at) ? 'DIVERGES' : 'lingers');
  report.kick.push(row);
  console.log(
    ` ${String(v).padStart(2)}   ${String(row.at).padStart(9)} ${String(row.d25).padStart(7)} ` +
    `${String(row.d50).padStart(6)} ${String(row.d100).padStart(6)} ${String(row.d150).padStart(6)}   ` +
    `${row.verdict}   speed ${row.speedStart}→${row.speedEnd}`,
  );
}

// ── 3. STEER RELEASE ────────────────────────────────────────────────────────
console.log('\n3) STEER RELEASE — full steer for 1 s, then centred');
console.log('  v   yaw@1.0s  yaw@1.25s  yaw@1.5s  yaw@2.0s  lean@2.0s');
for (const v of [8, 14, 20]) {
  const rec = await evalRetry(
    (v) => {
      const g = window.__DESCENT__.game;
      const scr = g.race.player.scripted;
      const out = window.__BN__.run(v, { steer: 1 }, 1.0, null);
      // Second leg: centre the stick and keep going from where we are.
      g.race.player.scripted.steer = 0;
      const bike = g.race.player.bike;
      const phys = bike.physics;
      const st = bike.state;
      const orig = phys.step.bind(phys);
      let n = out.length;
      phys.step = (inp, dt) => {
        orig(inp, dt);
        const q = st.orientation;
        const ux = 2 * (q.x * q.y - q.w * q.z);
        const uy = 1 - 2 * (q.x * q.x + q.z * q.z);
        const uz = 2 * (q.y * q.z + q.w * q.x);
        const w2 = st.angularVelocity;
        out.push({
          i: n++, sp: st.speed, lean: st.lean,
          yaw: w2.x * ux + w2.y * uy + w2.z * uz,
          heading: Math.atan2(2 * (q.x * q.z + q.w * q.y), 1 - 2 * (q.x * q.x + q.y * q.y)),
          course: Math.atan2(st.velocity.x, st.velocity.z),
        });
      };
      for (let i = 0; i < 90; i++) g.capture.step(1 / 60);
      phys.step = orig;
      return out;
    },
    v,
  );
  const at = (i) => rec[Math.min(rec.length - 1, i)];
  const row = {
    v, y120: +at(119).yaw.toFixed(3), y150: +at(150).yaw.toFixed(3),
    y180: +at(180).yaw.toFixed(3), y240: +at(240).yaw.toFixed(3),
    lean240: +at(240).lean.toFixed(3),
  };
  report.release.push(row);
  console.log(
    ` ${String(v).padStart(2)}   ${String(row.y120).padStart(8)} ${String(row.y150).padStart(9)} ` +
    `${String(row.y180).padStart(9)} ${String(row.y240).padStart(9)} ${String(row.lean240).padStart(9)}`,
  );
}

await mkdir(OUT, { recursive: true });
await writeFile(path.join(OUT, `bench-${TAG}.json`), JSON.stringify(report, null, 1));
console.log(`\n→ tools/capture/_out/bench-${TAG}.json`);
await b.close();
