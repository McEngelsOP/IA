/**
 * _camdiag.mjs — camera / dust diagnostics through the REAL capture harness path.
 *
 * Drives exactly what capture.mjs drives (takeControl → setPose/setSequence →
 * step(1/60)) so anything it measures is a property of the shipped review
 * frames, not of a bespoke probe that exercises a path the harness never takes.
 *
 * Reports, per frame:
 *   subject screen height in device px / css px / frame fraction
 *   camera pos, boom length, camera-to-subject distance, terrain clearance
 *   live dust puffs, and the ones sitting between the lens and the subject
 *
 * Usage:
 *   node tools/capture/_camdiag.mjs --pose bike-detail
 *   node tools/capture/_camdiag.mjs --seq landing --frames 60
 *   node tools/capture/_camdiag.mjs --seqs scree-speed,pack-race,switchback,tabletop-air --frames 60
 */
import { chromium } from 'playwright';

const args = {};
for (let i = 0; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (!a.startsWith('--')) continue;
  const n = process.argv[i + 1];
  args[a.slice(2)] = n && !n.startsWith('--') ? n : true;
}

const URL_BASE = args.url ?? 'http://127.0.0.1:5175';
const WIDTH = Number(args.width ?? 1600);
const HEIGHT = Number(args.height ?? 900);
const PR = Number(args.pr ?? 2);
const FPS = 60;

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist'],
});
const context = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: PR });
const page = await context.newPage();
page.on('pageerror', (e) => console.log('  [page:exception]', e.message));
await page.goto(`${URL_BASE}/?capture=1&pr=${PR}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
await page.waitForFunction(() => !!window.__DESCENT__?.game?.capture, null, { timeout: 180_000 });
await page.evaluate(() => window.__DESCENT__.game.capture.takeControl());

// The measurement, installed once in the page.
await page.evaluate(() => {
  const g = window.__DESCENT__.game;
  const V = g.race.player.bike.state.position.constructor;

  function subjectBox() {
    // The rider rig + bike root nearest the player, exactly what a critic reads
    // as "the subject". Geometry bounding boxes, transformed to world.
    const st = g.race.player.bike.state;
    const roots = [];
    g.engine.scene.traverse((o) => {
      if (!o.name) return;
      if (!o.name.startsWith('bike:') && !o.name.startsWith('rider:')) return;
      if (o.name.endsWith(':hull')) return;
      const p = new V();
      o.getWorldPosition(p);
      if (p.distanceToSquared(st.position) < 36) roots.push(o);
    });
    return roots;
  }

  window.__measure = function measure() {
    const g2 = window.__DESCENT__.game;
    const cam = g2.engine.camera;
    const st = g2.race.player.bike.state;
    const dir = g2.effects.cameraDirector;
    cam.updateMatrixWorld();

    // ── Subject screen extent ────────────────────────────────────────────────
    let minY = Infinity, maxY = -Infinity, minX = Infinity, maxX = -Infinity;
    let anyInFront = false;
    const roots = subjectBox();
    const v = new V();
    for (const root of roots) {
      root.updateMatrixWorld();
      root.traverse((o) => {
        const geo = o.geometry;
        if (!geo || !o.visible) return;
        if (!geo.boundingBox) geo.computeBoundingBox();
        const bb = geo.boundingBox;
        if (!bb) return;
        for (let i = 0; i < 8; i++) {
          v.set(i & 1 ? bb.max.x : bb.min.x, i & 2 ? bb.max.y : bb.min.y, i & 4 ? bb.max.z : bb.min.z);
          v.applyMatrix4(o.matrixWorld);
          const vc = v.clone().applyMatrix4(cam.matrixWorldInverse);
          if (vc.z > -0.05) continue; // behind the lens
          anyInFront = true;
          v.project(cam);
          const px = (v.x * 0.5 + 0.5), py = (1 - (v.y * 0.5 + 0.5));
          if (py < minY) minY = py;
          if (py > maxY) maxY = py;
          if (px < minX) minX = px;
          if (px > maxX) maxX = px;
        }
      });
    }
    const fracH = anyInFront ? maxY - minY : 0;
    const centreX = anyInFront ? (minX + maxX) * 0.5 : -1;
    const centreY = anyInFront ? (minY + maxY) * 0.5 : -1;
    // On-screen at all? (any part of the box inside the raster)
    const onScreen = anyInFront && maxX > 0 && minX < 1 && maxY > 0 && minY < 1;

    // ── Camera geometry ──────────────────────────────────────────────────────
    const cp = new V();
    cam.getWorldPosition(cp);
    const dist = cp.distanceTo(st.position);
    const terrH = g2.terrain.heightAt(cp.x, cp.z);
    const clearance = cp.y - terrH;

    // ── Dust between the lens and the subject ────────────────────────────────
    const dust = g2.effects.dust;
    const t0 = dust.fxTime;
    const cap = dust.pool.capacity;
    const O = dust.aOrigin, Vl = dust.aVel, P = dust.aParams, S = dust.aShape;
    const sizeScale = dust.material.uniforms.uSizeScale.value;
    // camera -> subject axis
    const ax = st.position.x - cp.x, ay = st.position.y + 0.95 - cp.y, az = st.position.z - cp.z;
    const aLen = Math.hypot(ax, ay, az) || 1e-6;
    const ux = ax / aLen, uy = ay / aLen, uz = az / aLen;

    let alive = 0, blockers = 0, nearBig = 0, survivors = 0, hard = 0, hardSurvivors = 0;
    let worstCover = 0;
    const samples = [];
    for (let i = 0; i < cap; i++) {
      const birth = P[i * 4], invLife = P[i * 4 + 1], seed = P[i * 4 + 2], kind = P[i * 4 + 3];
      const t = t0 - birth;
      const age = t * invLife;
      if (age < 0 || age >= 1) continue;
      alive++;
      const isPlume = kind >= 1.5 ? 1 : 0;
      const isSpray = kind >= 0.5 && !isPlume ? 1 : 0;
      const steps = isPlume ? 7 : isSpray ? 4 : 5;
      const phase = (seed * 17.13) % 1;
      const q = Math.min(Math.max(Math.floor(age * steps + phase * 0.7) / steps, 0), 1);
      const drag = isPlume ? 1.15 : 2.9;
      const k = (1 - Math.exp(-drag * t)) / drag;
      let px = O[i * 3] + Vl[i * 3] * k;
      let py = O[i * 3 + 1] + Vl[i * 3 + 1] * k;
      let pz = O[i * 3 + 2] + Vl[i * 3 + 2] * k;
      const rise = (0.28 + (0.72 - 0.28) * seed) * (isPlume ? 1.05 : 0.85);
      py += rise * t * (1 - 0.55 * age);
      const sz = S[i * 4] * (1 + S[i * 4 + 1] * q) * sizeScale;

      const dx = px - cp.x, dy = py - cp.y, dz = pz - cp.z;
      const d = Math.hypot(dx, dy, dz) || 1e-6;
      const along = dx * ux + dy * uy + dz * uz;
      const perp = Math.sqrt(Math.max(0, d * d - along * along));
      const ang = sz / d; // angular radius, radians-ish
      if (ang > 0.35) nearBig++;
      // Does this puff's disc cover the subject direction, from in front of it?
      if (along > 0.05 && along < aLen && perp < sz + 0.8) {
        blockers++;
        // What the shader will actually do with it: angular near fade x lens
        // corridor, quantised to thirds. A blocker that survives this is a
        // blocker the reviewer sees.
        const u = dust.material.uniforms;
        const nearAng = u.uNearAng ? u.uNearAng.value : { x: 1e9, y: 1e9 };
        const band = u.uLensBand ? u.uLensBand.value : { x: 1, y: 1 };
        const subR = u.uSubject ? u.uSubject.value.w : 0;
        const ss = (e0, e1, x) => { const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1); return t * t * (3 - 2 * t); };
        const nf = Math.min(Math.max((nearAng.y - ang) / Math.max(nearAng.y - nearAng.x, 1e-3), 0), 1);
        const s01 = along / aLen;
        const reff = subR * Math.min(Math.max(s01, 0), 1);
        const covSub = 1 - ss(0, sz + reff, perp);
        const ahead = 1 - ss(band.x, band.y, s01);
        const vNear = Math.floor(Math.min(Math.max(Math.min(nf, 1 - covSub * ahead), 0), 1) * 3 + 0.5) / 3;
        // A HARD blocker is one whose disc genuinely covers the subject from
        // the near part of the corridor: the thing that turns a portrait into
        // an X-ray. Those are the ones that must not survive.
        if (covSub * ahead > 0.4 || ang > nearAng.y) {
          hard++;
          if (vNear > 0) hardSurvivors++;
        }
        if (vNear > 0) survivors++;
        const cover = Math.min(1, (sz + 0.8 - perp) / (sz + 0.8)) * (1 - along / aLen);
        if (cover > worstCover) worstCover = cover;
        if (samples.length < 8) samples.push({ d: +d.toFixed(2), sz: +sz.toFixed(2), ang: +ang.toFixed(2), along: +along.toFixed(2), perp: +perp.toFixed(2) });
      }
    }

    // Nearest opponent to the lens — the "rival filling a screen quadrant" test.
    let nearestOpp = 1e9;
    for (const r of g2.race.racers) {
      if (r === g2.race.player) continue;
      const d = cp.distanceTo(r.bike.state.position);
      if (d < nearestOpp) nearestOpp = d;
    }

    return {
      mode: dir.mode,
      oppDist: +nearestOpp.toFixed(2),
      framedRise: +(dir.framedRise ?? 0).toFixed(3),
      framedAz: +(dir.framedAz ?? 0).toFixed(3),
      fracH: +fracH.toFixed(4),
      cssPx: +(fracH * 900).toFixed(1),
      devPx: +(fracH * 900 * 2).toFixed(1),
      cx: +centreX.toFixed(3), cy: +centreY.toFixed(3),
      onScreen,
      camY: +cp.y.toFixed(2),
      dist: +dist.toFixed(2),
      boom: +dir.boomDistance.toFixed(2),
      clearance: +clearance.toFixed(2),
      subY: +st.position.y.toFixed(2),
      airH: +(st.airHeight ?? 0).toFixed(2),
      bikeMode: st.mode,
      alive, blockers, survivors, hard, hardSurvivors, nearBig,
      cover: +worstCover.toFixed(2),
      samples,
    };
  };
});

async function step(n) {
  await page.evaluate(
    ([count, dt]) => {
      for (let i = 0; i < count; i++) window.__DESCENT__.game.capture.step(dt);
    },
    [n, 1 / FPS],
  );
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
}

function stats(list) {
  const s = [...list].sort((a, b) => a - b);
  const pct = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { min: s[0], p25: pct(0.25), med: pct(0.5), p75: pct(0.75), max: s[s.length - 1] };
}

if (args.pose) {
  for (const pose of String(args.pose).split(',')) {
    const ok = await page.evaluate((p) => window.__DESCENT__.game.capture.setPose(p), pose);
    if (!ok) { console.log(`unknown pose ${pose}`); continue; }
    await step(12);
    const m = await page.evaluate(() => window.__measure());
    console.log(`\n== POSE ${pose}`);
    console.log(JSON.stringify(m, null, 1));
  }
}

const seqs = args.seqs ? String(args.seqs).split(',') : args.seq ? [String(args.seq)] : [];
for (const name of seqs) {
  const frames = Number(args.frames ?? 60);
  const ok = await page.evaluate((n) => window.__DESCENT__.game.capture.setSequence(n), name);
  if (!ok) { console.log(`unknown sequence ${name}`); continue; }
  await step(4);
  const rows = [];
  for (let f = 0; f < frames; f++) {
    await step(1);
    rows.push(await page.evaluate(() => window.__measure()));
  }
  const px = rows.map((r) => r.cssPx);
  const off = rows.map((r, i) => (r.onScreen ? -1 : i)).filter((i) => i >= 0);
  console.log(`\n== SEQ ${name} (${frames} frames)`);
  console.log(`  cssPx  ${JSON.stringify(stats(px))}`);
  console.log(`  devPx  ${JSON.stringify(stats(rows.map((r) => r.devPx)))}`);
  console.log(`  frac   ${JSON.stringify(stats(rows.map((r) => r.fracH)))}`);
  console.log(`  offscreen frames: ${off.length ? `${off.length} [${off.slice(0, 12).join(',')}${off.length > 12 ? '…' : ''}]` : 'none'}`);
  console.log(`  clearance ${JSON.stringify(stats(rows.map((r) => r.clearance)))}`);
  console.log(`  dist   ${JSON.stringify(stats(rows.map((r) => r.dist)))}`);
  console.log(`  blockers ${JSON.stringify(stats(rows.map((r) => r.blockers)))}  surviving ${JSON.stringify(stats(rows.map((r) => r.survivors)))}`);
  console.log(`  HARD blockers ${JSON.stringify(stats(rows.map((r) => r.hard)))}  HARD surviving ${JSON.stringify(stats(rows.map((r) => r.hardSurvivors)))}`);
  if (args.per) {
    rows.forEach((r, i) => console.log(`   f${String(i).padStart(4, '0')} px=${r.cssPx} on=${r.onScreen ? 1 : 0} d=${r.dist} boom=${r.boom} clr=${r.clearance} camY=${r.camY} cy=${r.cy} blk=${r.blockers}/${r.survivors} opp=${r.oppDist} mode=${r.bikeMode}`));
  }
}

await browser.close();
