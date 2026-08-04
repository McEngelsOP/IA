/**
 * _dustgeo.mjs — WHERE IS THE DUST, ACTUALLY?
 *
 * The motion critic measured dust puffs "centred ~165 source px above the rear
 * contact patch". That is a screen-space read of a world-space question, and the
 * only way to settle it is to compute the puff cloud's own centroid the way the
 * VERTEX SHADER computes it — closed-form drag, the saturating lift, the
 * quadratic settle and the lateral spread — and compare it to the contact point
 * the emitter was handed.
 *
 * Everything here mirrors DUST_VERT exactly. If the two ever disagree the probe
 * is lying, so keep them in step.
 *
 *   node tools/capture/_dustgeo.mjs <seq|pose:name> <from> <to> [stride]
 */
import { chromium } from 'playwright';

const TARGET = process.argv[2] ?? 'scree-speed';
const FROM = Number(process.argv[3] ?? 0);
const TO = Number(process.argv[4] ?? 20);
const STRIDE = Number(process.argv[5] ?? 4);

const ATTEMPTS = 5;
for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
  try {
    await run();
    process.exit(0);
  } catch (e) {
    console.log(`  attempt ${attempt} failed: ${String(e.message).split('\n')[0]}`);
    await new Promise((r) => setTimeout(r, 4000));
  }
}
process.exit(1);

async function run() {
  const b = await chromium.launch({
    headless: true,
    args: ['--enable-unsafe-swiftshader', '--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist'],
  });
  try {
    const p = await b.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
    p.on('pageerror', (e) => console.log('PAGEERR', e.message.slice(0, 300)));
    await p.goto('http://127.0.0.1:5173/?capture=1&pr=2', { waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => !!window.__DESCENT__?.game?.capture, null, { timeout: 240000 });
    await p.evaluate(() => window.__DESCENT__.game.capture.takeControl());

    const isPose = TARGET.startsWith('pose:');
    if (isPose) {
      await p.evaluate((n) => window.__DESCENT__.game.capture.setPose(n), TARGET.slice(5));
    } else {
      const ok = await p.evaluate((n) => window.__DESCENT__.game.capture.setSequence(n), TARGET);
      if (!ok) throw new Error(`unknown sequence ${TARGET}`);
    }
    await step(p, 4);
    if (FROM > 0) await step(p, FROM);

    const rows = [];
    for (let f = FROM; f <= TO; f++) {
      await step(p, 1);
      if ((f - FROM) % STRIDE !== 0) continue;
      rows.push({ f, ...(await p.evaluate(sample)) });
    }
    for (const r of rows) console.log(JSON.stringify(r));
  } finally {
    await b.close();
  }
}

async function step(p, n) {
  await p.evaluate((count) => {
    for (let i = 0; i < count; i++) window.__DESCENT__.game.capture.step(1 / 60);
  }, n);
  await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
}

function sample() {
  const G = window.__DESCENT__.game;
  const dust = G.effects.dust;
  const pool = dust.pool;
  const cap = pool.capacity;
  const O = pool.array('aOrigin');
  const V = pool.array('aVel');
  const P = pool.array('aParams');
  const S = pool.array('aShape');
  const now = dust.time;
  const sizeScale = dust.material.uniforms.uSizeScale.value;

  const st = G.race.player.bike.state;
  const cam = G.engine.camera;
  const rear = st.rear?.contactPoint;
  const front = st.front?.contactPoint;
  const contactY = rear && rear.lengthSq() > 1e-6 ? rear.y : G.terrain.heightAt(st.position.x, st.position.z);
  const contact = { x: rear ? rear.x : st.position.x, y: contactY, z: rear ? rear.z : st.position.z };

  const H = 900, W = 1600; // CSS px; source px = 2x
  const scratch = st.position.clone();
  const proj = (x, y, z) => {
    const v = scratch.set(x, y, z).project(cam);
    return {
      x: (v.x * 0.5 + 0.5) * W * 2, y: (1 - (v.y * 0.5 + 0.5)) * H * 2,
      ndcX: v.x, ndcY: v.y, ndcZ: v.z,
    };
  };

  let n = 0;
  let sy = 0, sYoff = 0, sScrY = 0, sScrX = 0, wsum = 0;
  let sAgl = 0, maxAgl = -1e9, nHigh = 0;
  const aglBins = [0, 0, 0, 0];
  let minY = 1e9, maxY = -1e9;
  let maxBehind = 0, maxLat = 0;
  let sSize = 0, sAlpha = 0;
  const ageBins = [0, 0, 0, 0];         // count per quarter of life
  const sizeBins = [0, 0, 0, 0];        // mean world diameter per quarter
  const alphaBins = [0, 0, 0, 0];
  const latBins = [0, 0, 0, 0];
  const TAU = Math.PI * 2;

  const fwd = { x: st.velocity.x, z: st.velocity.z };
  const fl = Math.hypot(fwd.x, fwd.z) || 1;
  fwd.x /= fl; fwd.z /= fl;

  for (let i = 0; i < cap; i++) {
    const birth = P[i * 4], inv = P[i * 4 + 1], seed = P[i * 4 + 2], kind = P[i * 4 + 3];
    const t = now - birth;
    const age = t * inv;
    if (!(age >= 0 && age < 1)) continue;
    const isPlume = kind >= 1.5 ? 1 : 0;
    const isSpray = kind >= 0.5 && !isPlume ? 1 : 0;
    const steps = isPlume ? 7 : (isSpray ? 4 : 5);
    const phase = frac(seed * 17.13);
    const q = Math.min(Math.max(Math.floor(age * steps + phase * 0.7) / steps, 0), 1);
    const drag = 2.9 + (1.6 - 2.9) * isPlume;
    const k = (1 - Math.exp(-drag * t)) / drag;
    let px = O[i * 3] + V[i * 3] * k;
    let py = O[i * 3 + 1] + V[i * 3 + 1] * k;
    let pz = O[i * 3 + 2] + V[i * 3 + 2] * k;
    const rise = (0.30 + (0.62 - 0.30) * seed) * (isPlume ? 1.0 : 0.55);
    const lift = rise * (1 - Math.exp(-2.4 * t));
    const settle = (0.20 + (0.38 - 0.20) * frac(seed * 5.77)) * age * age;
    py += lift - settle;
    const bear = frac(seed * 31.73) * TAU;
    const ageSpread = age * Math.sqrt(age);
    const spread = (0.40 + (1.30 - 0.40) * frac(seed * 12.41)) * ageSpread * (isPlume ? 1.35 : 0.85);
    px += Math.cos(bear) * spread;
    pz += Math.sin(bear) * spread;
    // VISIBLE diameter, metres. sz is the quad's half-extent, so the quad spans
    // 2*sz — but the atlas cell is twice the puff's footprint (128 px of art in
    // a 256 px cell), so the drawn puff covers exactly half the quad in each
    // axis. Visible diameter is therefore 2*sz*0.5 = sz.
    const sz = S[i * 4] * (1 + S[i * 4 + 1] * q) * sizeScale;
    const alpha = Math.round(Math.min(Math.max(1 - q, 0), 1) * 4) / 4;

    n++;
    const yoff = py - contact.y;
    sy += py; sYoff += yoff;
    if (py < minY) minY = py;
    if (py > maxY) maxY = py;
    const dx = px - st.position.x, dz = pz - st.position.z;
    const behind = -(dx * fwd.x + dz * fwd.z);
    const lat = Math.abs(dx * -fwd.z + dz * fwd.x);
    if (behind > maxBehind) maxBehind = behind;
    if (lat > maxLat) maxLat = lat;
    sSize += sz; sAlpha += alpha;

    // THE HONEST HEIGHT TEST. Measuring a puff against the rider's CURRENT
    // contact patch is meaningless on a descent: a 2 s puff was born on ground
    // 8 m higher up the hill, so an effect pinned perfectly to the floor still
    // reads as "3.5 m above the wheel". Height above the terrain UNDER THE PUFF
    // is the quantity the critic's screen measurement was a proxy for.
    const agl = py - G.terrain.heightAt(px, pz);
    sAgl += agl;
    if (agl > maxAgl) maxAgl = agl;
    if (agl > 1.5) nHigh++;

    const bin = Math.min(3, Math.floor(age * 4));
    ageBins[bin]++; sizeBins[bin] += sz; alphaBins[bin] += alpha; latBins[bin] += lat;
    aglBins[bin] += agl;

    const sp = proj(px, py, pz);
    if (sp.ndcZ > -1 && sp.ndcZ < 1 && Math.abs(sp.ndcX) < 1.3 && Math.abs(sp.ndcY) < 1.3) {
      sScrY += sp.y; sScrX += sp.x; wsum++;
    }
  }

  const cp = proj(contact.x, contact.y, contact.z);
  for (let i = 0; i < 4; i++) {
    if (ageBins[i] > 0) {
      sizeBins[i] /= ageBins[i]; alphaBins[i] /= ageBins[i];
      latBins[i] /= ageBins[i]; aglBins[i] /= ageBins[i];
    }
  }
  return {
    alive: n,
    speedKmh: +(st.speed * 3.6).toFixed(1),
    mode: st.mode,
    grounded: !!(st.rear?.grounded || st.front?.grounded),
    contactY: +contact.y.toFixed(3),
    meanYoff: n ? +(sYoff / n).toFixed(3) : null,
    meanAgl: n ? +(sAgl / n).toFixed(3) : null,
    maxAgl: n ? +maxAgl.toFixed(3) : null,
    fracAbove1m5: n ? +(nHigh / n).toFixed(3) : null,
    aglByAge: aglBins.map((v) => +v.toFixed(2)),
    minY: n ? +(minY - contact.y).toFixed(3) : null,
    maxY: n ? +(maxY - contact.y).toFixed(3) : null,
    contactPx: +cp.y.toFixed(0),
    centroidPx: wsum ? +(sScrY / wsum).toFixed(0) : null,
    pxAbove: wsum ? +(cp.y - sScrY / wsum).toFixed(0) : null,
    maxBehind: +maxBehind.toFixed(2),
    maxLat: +maxLat.toFixed(2),
    meanDia: n ? +(sSize / n).toFixed(3) : null,
    ageBins,
    diaByAge: sizeBins.map((v) => +v.toFixed(2)),
    alphaByAge: alphaBins.map((v) => +v.toFixed(2)),
    latByAge: latBins.map((v) => +v.toFixed(2)),
  };

  function frac(x) { return x - Math.floor(x); }
}
