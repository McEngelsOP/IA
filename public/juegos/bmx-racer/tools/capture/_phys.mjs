/**
 * _phys.mjs — BIKE PHYSICS TEST HARNESS.
 *
 * Drives the bike down named sections at a fixed timestep and reports numbers,
 * not pictures. Everything is sampled inside the 120 Hz physics step (by
 * wrapping BikePhysics.step) so the report is the simulation's own truth, not a
 * 60 Hz render-side sample of it.
 *
 * Reports per section:
 *   - speed over time (start / min / max / final, and a sparkline)
 *   - % of physics steps each wheel is grounded, and both together
 *   - lean statistics with the given steer input (should be ~0 for steer 0)
 *   - pitch statistics
 *   - mode histogram, airborne episodes, landing quality/impact distribution
 *   - suspension compression range (is the travel being used?)
 *
 * Plus a PUMP test: identical approach to a lip, released at several timings,
 * reporting peak air height for each so the payoff curve is visible.
 *
 * Usage: node tools/capture/_phys.mjs [--tag before] [--sections a,b] [--json]
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

// [pose, seconds, inputOverride]
const SECTIONS = [
  ['scree-speed', 4.0, { pedal: 1 }],
  ['summit-rider', 4.0, { pedal: 1 }],
  ['rockgarden-low', 4.0, { pedal: 1 }],
  ['ridge-exposure', 4.0, { pedal: 1 }],
  ['streambed', 4.0, { pedal: 1 }],
  ['finish-sprint', 4.0, { pedal: 1 }],
  ['switchback-lean', 3.0, { steer: 0.85, pedal: 0.4 }],
  ['scree-brake', 3.0, { pedal: 0, brakeRear: 1 }, 'scree-speed'],
  ['crash', 3.0, {}],
  ['tabletop-air', 3.0, { airPitch: 0.35 }],
  ['ravine-gap', 3.0, { airPitch: 0.15 }],
];

const b = await chromium.launch({
  headless: true,
  args: ['--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'],
});
let p = await b.newPage();
p.on('pageerror', (e) => console.log('ERR', e.message.slice(0, 300)));

/**
 * The dev server is shared with other agents editing other subsystems, and a
 * vite full-reload mid-run destroys the execution context. Every evaluate goes
 * through here so a reload costs one retry instead of the whole report.
 */
const INSTALL = () => {
  const g = window.__DESCENT__.game;
  g.capture.takeControl();
  window.__PH__ = {
    install(driver) {
      const bike = g.race.player.bike;
      const phys = bike.physics;
      const st = bike.state;
      if (!phys.__origStep) phys.__origStep = phys.step.bind(phys);
      const rec = [];
      let n = 0;
      phys.step = (input, dt) => {
        if (driver) driver(input, n, st);
        phys.__origStep(input, dt);
        rec.push({
          t: n / 120, speed: st.speed, fwd: st.forwardSpeed, y: st.position.y,
          lean: st.lean, pitch: st.pitch, steerA: st.steerAngle,
          fg: st.front.grounded ? 1 : 0, rg: st.rear.grounded ? 1 : 0,
          fc: st.front.compression, rc: st.rear.compression,
          fl: st.front.load, rl: st.rear.load,
          mode: st.mode, air: st.airHeight, peak: st.peakAirHeight,
          landed: st.landedThisStep ? 1 : 0, lq: st.landingQuality, li: st.landingImpact,
          crashed: st.crashedThisStep ? 1 : 0, pump: st.pumpCharge, pre: st.preload,
        });
        n++;
      };
      return { rec, restore: () => { phys.step = phys.__origStep; } };
    },
    run(pose, seconds, input, driver) {
      g.capture.setPose(pose);
      if (input) {
        const base = { steer: 0, pedal: 0, brakeRear: 0, brakeFront: 0, crouch: 0,
                       pitchLean: 0, airPitch: 0, airYaw: 0, airRoll: 0,
                       wantBoost: false, wantHop: false };
        g.race.player.scripted = Object.assign(base, input);
      }
      const h = window.__PH__.install(driver);
      const frames = Math.round(seconds * 60);
      for (let i = 0; i < frames; i++) g.capture.step(1 / 60);
      h.restore();
      return h.rec;
    },
    /**
     * Place the player on the ribbon at an arbitrary normalised track position,
     * on its wheels, at a given speed. The pump test needs a GROUND approach to
     * a lip; every named air pose spawns already ballistic.
     */
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
    runFrom(spawn, seconds, driver) {
      spawn();
      const h = window.__PH__.install(driver);
      const frames = Math.round(seconds * 60);
      for (let i = 0; i < frames; i++) g.capture.step(1 / 60);
      h.restore();
      return h.rec;
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
      const has = await p.evaluate(() => !!window.__PH__).catch(() => false);
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

function stats(a) {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const sum = a.reduce((x, y) => x + y, 0);
  return {
    min: +s[0].toFixed(3),
    p50: +s[(s.length >> 1)].toFixed(3),
    max: +s[s.length - 1].toFixed(3),
    mean: +(sum / a.length).toFixed(3),
  };
}

function summarize(name, rec) {
  const N = rec.length;
  const speeds = rec.map((r) => r.speed);
  const grounded = rec.filter((r) => r.fg || r.rg).length;
  const both = rec.filter((r) => r.fg && r.rg).length;
  const fg = rec.filter((r) => r.fg).length;
  const rg = rec.filter((r) => r.rg).length;

  const modes = {};
  for (const r of rec) modes[r.mode] = (modes[r.mode] ?? 0) + 1;

  const landings = rec.filter((r) => r.landed).map((r) => ({ q: +r.lq.toFixed(2), i: +r.li.toFixed(2), peak: +r.peak.toFixed(2) }));
  const crashes = rec.filter((r) => r.crashed).length;

  // airborne episodes: transitions grounded->airborne, and the longest one
  let episodes = 0;
  let run = 0;
  let longest = 0;
  for (let i = 1; i < N; i++) {
    const g = !!(rec[i].fg || rec[i].rg);
    if (!g && !!(rec[i - 1].fg || rec[i - 1].rg)) episodes++;
    run = g ? 0 : run + 1;
    if (run > longest) longest = run;
  }

  // speed sparkline at 10 points
  const spark = [];
  for (let i = 0; i < 10; i++) spark.push(+speeds[Math.floor((i * (N - 1)) / 9)].toFixed(2));

  // crash speed profile: speed at the crash step and 0.5s later
  let crashProfile = null;
  const ci = rec.findIndex((r) => r.crashed);
  if (ci >= 0) {
    const at = (k) => (rec[Math.min(N - 1, ci + k)] ? +rec[Math.min(N - 1, ci + k)].speed.toFixed(2) : null);
    crashProfile = { pre: +rec[Math.max(0, ci - 1)].speed.toFixed(2), at0: at(0), at10: at(10), at30: at(30), at60: at(60), at120: at(120), at240: at(240) };
  }

  return {
    section: name,
    steps: N,
    speed: { start: +speeds[0].toFixed(2), min: +Math.min(...speeds).toFixed(2), max: +Math.max(...speeds).toFixed(2), final: +speeds[N - 1].toFixed(2) },
    speedSpark: spark,
    groundedPct: { any: +((100 * grounded) / N).toFixed(1), both: +((100 * both) / N).toFixed(1), front: +((100 * fg) / N).toFixed(1), rear: +((100 * rg) / N).toFixed(1) },
    airEpisodes: episodes,
    longestAirSteps: longest,
    lean: stats(rec.map((r) => r.lean)),
    absLean: stats(rec.map((r) => Math.abs(r.lean))),
    pitch: stats(rec.map((r) => r.pitch)),
    frontComp: stats(rec.map((r) => r.fc)),
    rearComp: stats(rec.map((r) => r.rc)),
    frontLoad: stats(rec.map((r) => r.fl)),
    rearLoad: stats(rec.map((r) => r.rl)),
    modes,
    landings: landings.length,
    landingQ: stats(landings.map((l) => l.q)),
    landingI: stats(landings.map((l) => l.i)),
    crashes,
    crashProfile,
    landingRows: landings,
  };
}

const report = { tag: TAG, at: new Date().toISOString(), sections: [], pump: null };

for (const [name, seconds, input, poseOverride] of SECTIONS) {
  const pose = poseOverride ?? name;
  const rec = await evalRetry(
    ([pose, seconds, input]) => window.__PH__.run(pose, seconds, input, null),
    [pose, seconds, input],
  );
  const s = summarize(name, rec);
  report.sections.push(s);
  console.log(
    `${name.padEnd(16)} spd ${String(s.speed.start).padStart(5)}→${String(s.speed.final).padStart(5)}  ` +
    `gnd any ${String(s.groundedPct.any).padStart(5)}% both ${String(s.groundedPct.both).padStart(5)}% ` +
    `f ${String(s.groundedPct.front).padStart(5)}% r ${String(s.groundedPct.rear).padStart(5)}%  ` +
    `|lean| p50 ${s.absLean.p50} max ${s.absLean.max}  pitch p50 ${s.pitch.p50}  ` +
    `air${s.airEpisodes}/${s.longestAirSteps} land${s.landings} crash${s.crashes}`,
  );
  if (s.landingRows.length) console.log(`                 landings: ${s.landingRows.map((l) => `q${l.q}/i${l.i}/h${l.peak}`).join('  ')}`);
  if (s.crashProfile) console.log(`                 crash speed: pre ${s.crashProfile.pre} -> ${[s.crashProfile.at0, s.crashProfile.at10, s.crashProfile.at30, s.crashProfile.at60, s.crashProfile.at120, s.crashProfile.at240].join(' ')}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// CRASH TEST — force a crash mid-run and print the speed every 5 steps through
// it. A crash that accelerates cannot read as an impact.
// ─────────────────────────────────────────────────────────────────────────────
console.log('\nCRASH TEST — |velocity| every 5 physics steps from the impact');
const crashTrace = await evalRetry(() => {
  const g = window.__DESCENT__.game;
  const bike = g.race.player.bike;
  let fired = false;
  const driver = (input, n) => {
    input.pedal = 1;
    if (n === 60 && !fired) { fired = true; bike.physics.forceCrash(0.82); }
  };
  const rec = window.__PH__.run('rockgarden-low', 3.0, { pedal: 1 }, driver);
  const out = [];
  const inCrash = [];
  for (let i = 55; i < rec.length; i += 5) { out.push(+rec[i].speed.toFixed(2)); inCrash.push(rec[i].mode === 'crashing'); }
  return { trace: out, kmh: out.map((v) => Math.round(v * 3.6)), inCrash };
}, null);
console.log('  m/s : ' + crashTrace.trace.join(' '));
console.log('  km/h: ' + crashTrace.kmh.join(' '));
let rises = 0, inWindow = 0;
for (let i = 2; i < crashTrace.trace.length; i++) {
  if (!crashTrace.inCrash[i]) continue;
  inWindow++;
  if (crashTrace.trace[i] > crashTrace.trace[i - 1] + 1e-6) rises++;
}
console.log(`  samples where speed INCREASED while mode === crashing: ${rises} of ${inWindow}`);
report.crash = crashTrace;

// ─────────────────────────────────────────────────────────────────────────────
// PUMP TEST
// The same approach to the same lip, with the crouch released at a range of
// offsets relative to takeoff. Reports peak air height for each.
// ─────────────────────────────────────────────────────────────────────────────
console.log('\nPUMP TEST — ground approach to the tabletop lip, crouch released at step N');
const pumpRows = await evalRetry(() => {
  const rows = [];
  const T = 0.607;      // on the ground, short of the tabletop lip (~0.626)
  const SPEED = 17;
  const spawn = () => window.__PH__.spawnAt(T, SPEED);

  // Baseline: no crouch at all.
  const offsets = [-1, 0, 30, 45, 55, 60, 65, 70, 72, 74, 76, 78, 80, 82, 84, 86, 88, 90, 95, 100, 110, 130];
  for (const releaseAt of offsets) {
    const driver = (input, n) => {
      input.pedal = 1;
      input.crouch = releaseAt < 0 ? 0 : n < releaseAt ? 1 : 0;
    };
    const rec = window.__PH__.runFrom(spawn, 2.6, driver);
    // The jump is the LONGEST airborne episode, not the first — the first is
    // always the spawn settling.
    let airSteps = 0, best = { len: 0, start: -1, end: -1 }, cur = { len: 0, start: -1 };
    for (let i = 0; i < rec.length; i++) {
      const g = !!(rec[i].fg || rec[i].rg);
      if (!g) {
        airSteps++;
        if (cur.len === 0) cur.start = i;
        cur.len++;
        if (cur.len > best.len) best = { len: cur.len, start: cur.start, end: i };
      } else cur = { len: 0, start: -1 };
    }
    let peak = 0, apexY = -1e9, groundY = 0, takeoff = best.start;
    if (takeoff > 0) {
      groundY = rec[takeoff - 1].y;
      for (let i = takeoff; i <= best.end; i++) {
        if (rec[i].air > peak) peak = rec[i].air;
        if (rec[i].y > apexY) apexY = rec[i].y;
      }
    }
    rows.push({
      releaseAt,
      takeoff,
      rel: takeoff >= 0 ? releaseAt - takeoff : null,
      peakAir: +peak.toFixed(3),
      rise: takeoff >= 0 ? +(apexY - groundY).toFixed(3) : 0,
      airSteps,
    });
  }
  return rows;
}, null);
for (const r of pumpRows) {
  console.log(
    `  release@${String(r.releaseAt).padStart(4)} takeoff@${String(r.takeoff).padStart(4)} ` +
    `rel ${String(r.rel).padStart(5)} steps ${r.rel === null ? '--' : (r.rel / 120).toFixed(3) + 's'}  ` +
    `peakAir ${String(r.peakAir).padStart(6)} m  rise ${String(r.rise).padStart(6)} m  airSteps ${r.airSteps}`,
  );
}
report.pump = pumpRows;

// ── DETERMINISM ──────────────────────────────────────────────────────────────
// `step(input, dt)` must be bit-identical for identical input: the capture
// harness, the replay and the ghost all depend on it.
const det = await evalRetry(() => {
  const hash = (rec) => rec.map((r) =>
    `${r.speed.toFixed(12)}|${r.lean.toFixed(12)}|${r.pitch.toFixed(12)}|${r.y.toFixed(12)}`).join(';');
  const a = window.__PH__.run('scree-speed', 2.0, { pedal: 1, steer: 0.3, crouch: 0.5 }, null);
  const b = window.__PH__.run('scree-speed', 2.0, { pedal: 1, steer: 0.3, crouch: 0.5 }, null);
  return { identical: hash(a) === hash(b), steps: a.length,
           finiteA: a.every((r) => Number.isFinite(r.speed) && Number.isFinite(r.lean)) };
}, null);
console.log(`\nDETERMINISM: two identical ${det.steps}-step runs ${det.identical ? 'MATCH bit-for-bit' : 'DIVERGED'}; all finite: ${det.finiteA}`);
report.determinism = det;

await mkdir(OUT, { recursive: true });
await writeFile(path.join(OUT, `phys-${TAG}.json`), JSON.stringify(report, null, 1));
console.log(`\n→ tools/capture/_out/phys-${TAG}.json`);
await b.close();
