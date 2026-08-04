/**
 * _energy.mjs — WHERE IS THE SPEED COMING FROM AND GOING TO?
 *
 * Runs a named sequence exactly as the review harness does and, for every one of
 * the 120 Hz physics steps, attributes the change in |velocity| to its source:
 * every force term projected onto the direction of travel, plus the DISCRETE
 * velocity edits (landing plane projection, ground hold, penetration recovery,
 * crash cap, pump/hop impulses) which are not forces at all and therefore never
 * appear in a force sum.
 *
 * Prints the worst 60-frame acceleration window in each direction and the term
 * that owns it.
 *
 * Usage: node tools/capture/_energy.mjs [--tag before] [--seq switchback]
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
  window.__EN__ = {
    runSeq(name, seconds) {
      g.capture.setSequence(name);
      const bike = g.race.player.bike;
      const phys = bike.physics;
      const st = bike.state;
      const d = phys.diag;
      d.enabled = true;
      if (!phys.__origStep) phys.__origStep = phys.step.bind(phys);
      const rec = [];
      let n = 0;
      phys.step = (inp, dt) => {
        // Direction of travel BEFORE the step — that is the axis a force has to
        // be projected on to explain a change in |v|.
        const vx = st.velocity.x, vy = st.velocity.y, vz = st.velocity.z;
        const sp = Math.hypot(vx, vy, vz) || 1e-9;
        const ux = vx / sp, uy = vy / sp, uz = vz / sp;
        phys.__origStep(inp, dt);
        const proj = (ax, ay, az) => ax * ux + ay * uy + az * uz;
        rec.push({
          i: n,
          spPre: d.speedPre, spInt: d.speedInt, spFin: d.speedFinal,
          grav: proj(d.gx, d.gy, d.gz),
          drag: proj(d.dx, d.dy, d.dz),
          hug: proj(d.hx, d.hy, d.hz),
          susp: proj(d.sx, d.sy, d.sz),
          tyF: proj(d.fx, d.fy, d.fz),
          tyR: proj(d.rx, d.ry, d.rz),
          crash: proj(d.cx, d.cy, d.cz),
          drive: d.drive,
          dvPen: d.dvPen, dvHold: d.dvHold, dvLand: d.dvLand,
          dvCrash: d.dvCrash, dvImp: d.dvImpulse,
          gnd: d.grounded, air: d.airborne, mode: st.mode,
          y: st.position.y, airH: st.airHeight,
          lean: d.lean, tgtLean: d.targetLean,
        });
        n++;
      };
      const frames = Math.round(seconds * 60);
      for (let i = 0; i < frames; i++) g.capture.step(1 / 60);
      phys.step = phys.__origStep;
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
      const has = await p.evaluate(() => !!window.__EN__).catch(() => false);
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

const MASS = 92;
const TERMS = ['grav', 'drag', 'hug', 'susp', 'tyF', 'tyR', 'crash'];
const DVS = ['dvPen', 'dvHold', 'dvLand', 'dvCrash', 'dvImp'];

function analyse(name, rec) {
  const dt = 1 / 120;
  // Cumulative attribution over a window: force terms integrate, dv terms sum.
  const win = 60; // physics steps = 0.5 s
  let worstUp = { a: -1e9 }, worstDown = { a: 1e9 };
  for (let i = 0; i + win < rec.length; i++) {
    const a = (rec[i + win].spFin - rec[i].spFin) / (win * dt);
    if (a > worstUp.a) worstUp = { a, i };
    if (a < worstDown.a) worstDown = { a, i };
  }
  const attribute = (i0) => {
    const out = {};
    for (const t of TERMS) out[t] = 0;
    for (const t of DVS) out[t] = 0;
    let air = 0;
    for (let i = i0; i < i0 + win; i++) {
      for (const t of TERMS) out[t] += (rec[i][t] / MASS) * dt;
      for (const t of DVS) out[t] += rec[i][t];
      if (!rec[i].gnd) air++;
    }
    out.airPct = Math.round((100 * air) / win);
    for (const k of Object.keys(out)) out[k] = +out[k].toFixed(2);
    return out;
  };
  return {
    section: name,
    steps: rec.length,
    speedStart: +rec[0].spFin.toFixed(2),
    speedEnd: +rec[rec.length - 1].spFin.toFixed(2),
    airPct: +((100 * rec.filter((r) => !r.gnd).length) / rec.length).toFixed(1),
    worstAccel: { a: +worstUp.a.toFixed(2), at: worstUp.i, dv: attribute(worstUp.i) },
    worstDecel: { a: +worstDown.a.toFixed(2), at: worstDown.i, dv: attribute(worstDown.i) },
    // Whole-run totals.
    total: attribute(0) && (() => {
      const out = {};
      for (const t of TERMS) out[t] = 0;
      for (const t of DVS) out[t] = 0;
      for (const r of rec) {
        for (const t of TERMS) out[t] += (r[t] / MASS) * dt;
        for (const t of DVS) out[t] += r[t];
      }
      for (const k of Object.keys(out)) out[k] = +out[k].toFixed(2);
      return out;
    })(),
  };
}

const report = { tag: TAG, at: new Date().toISOString(), sections: [] };
const SEQS = [['switchback', 2.2], ['tabletop-air', 2.2], ['scree-speed', 2.2], ['crash', 2.2]];

for (const [name, secs] of SEQS) {
  const rec = await evalRetry(([n, s]) => window.__EN__.runSeq(n, s), [name, secs]);
  const a = analyse(name, rec);
  report.sections.push(a);
  console.log(`\n=== ${name}  ${a.speedStart} → ${a.speedEnd} m/s   airborne ${a.airPct}% of steps`);
  const fmt = (o) => Object.entries(o).filter(([k, v]) => k !== 'airPct' && Math.abs(v) > 0.01)
    .map(([k, v]) => `${k} ${v > 0 ? '+' : ''}${v}`).join('  ');
  console.log(`  worst 0.5 s ACCEL ${a.worstAccel.a} m/s^2 @step ${a.worstAccel.at} (air ${a.worstAccel.dv.airPct}%)`);
  console.log(`     ${fmt(a.worstAccel.dv)}`);
  console.log(`  worst 0.5 s DECEL ${a.worstDecel.a} m/s^2 @step ${a.worstDecel.at} (air ${a.worstDecel.dv.airPct}%)`);
  console.log(`     ${fmt(a.worstDecel.dv)}`);
  console.log(`  whole run: ${fmt(a.total)}`);
  // 60fps speed trace, as the review sees it (km/h)
  const kmh = [];
  for (let i = 0; i < rec.length; i += 2) kmh.push(Math.round(rec[i].spFin * 3.6));
  console.log(`  km/h @60fps: ${kmh.join(' ')}`);
  a.kmh = kmh;
}

await mkdir(OUT, { recursive: true });
await writeFile(path.join(OUT, `energy-${TAG}.json`), JSON.stringify(report, null, 1));
console.log(`\n→ tools/capture/_out/energy-${TAG}.json`);
await b.close();
