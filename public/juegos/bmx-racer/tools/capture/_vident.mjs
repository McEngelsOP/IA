/**
 * _vident.mjs — does a rider hold its committed jersey hue as it shrinks?
 *
 * The existing _identity probe samples a fixed box around the projected rider,
 * so most of what it measures is terrain, and two riders standing near each
 * other contaminate one another. This one is exact:
 *
 *   1. Park a free camera behind a chosen racer, at a distance computed to make
 *      the rider a requested number of DEVICE pixels tall.
 *   2. Render the frame twice — once normally, once with that rider's meshes
 *      hidden — and take the pixels that CHANGED. That set is the rider's
 *      silhouette, exactly, including its outline.
 *   3. Report, over that set only: the peak-chroma pixel and its hue error
 *      against RIDER_COLORS, the fraction of the silhouette carrying the
 *      committed hue, and the brightest pixel (the separating rim).
 *
 *   node tools/capture/_vident.mjs [racerId] [px,px,px...]
 */
import { chromium } from 'playwright';

const WHO = process.argv[2] ?? 'ai0';
const SIZES = (process.argv[3] ?? '120,60,40,25,18,15,12').split(',').map(Number);

const RIDER_HEX = { player: 0xe0574c, ai0: 0x3f9ad9, ai1: 0xf2c14e, ai2: 0x74c96b };

function rgb2hsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d > 1e-6) {
    if (mx === r) h = ((g - b) / d) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  return [h, mx > 0 ? d / mx : 0, mx, d * 255];
}
function hueErr(a, b) { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; }

const b = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader','--use-angle=default','--enable-gpu','--ignore-gpu-blocklist','--force-color-profile=srgb'] });
const ctx = await b.newContext({ viewport: { width: 700, height: 700 }, deviceScaleFactor: 2 });
const p = await ctx.newPage();
p.on('pageerror', (e) => console.log('PAGEERR', e.message.slice(0, 400)));
await p.goto('http://127.0.0.1:5173/?capture=1&pr=2', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => !!window.__DESCENT__?.game?.capture, null, { timeout: 240000 });
await p.evaluate(() => window.__DESCENT__.game.capture.takeControl());
await p.evaluate(() => window.__DESCENT__.game.capture.setPose('ridge-exposure'));
await p.evaluate(() => { for (let i = 0; i < 12; i++) window.__DESCENT__.game.capture.step(1 / 60); });
await p.evaluate(async () => { window.__G2 = await import('/src/npr/NprGlobals.ts'); });

const tgtHex = RIDER_HEX[WHO];
const tgtHue = rgb2hsv((tgtHex >> 16) & 255, (tgtHex >> 8) & 255, tgtHex & 255)[0];
console.log(`${WHO}: committed jersey #${tgtHex.toString(16)}  hue ${tgtHue.toFixed(0)}deg`);
console.log('  px   dist    silPx   peakChroma  peakHueErr   onHue%   maxLum   meanChroma');

for (const want of SIZES) {
  const shot = async (hide, FLOORS) => {
    await p.evaluate(([who, h, wantPx, floors]) => {
      
      const D = window.__DESCENT__, eng = D.engine, g = D.game;
      const racer = g.race.racers.find((r) => r.id === who) ?? g.race.racers[0];
      const st = racer.bike.state;
      const c = st.position.clone(); c.y += 0.9;
      // Distance that makes 1.7 m subtend `wantPx` DEVICE pixels.
      const cam = eng.camera;
      const f = cam.projectionMatrix.elements[5];   // 1/tan(fovY/2)
      const dist = (1.7 * eng.renderSize.y * f) / (2 * wantPx);
      // Behind and slightly above, looking down the hill, so the terrain the
      // rider must separate from is genuinely behind him.
      const back = st.velocity.clone(); back.y = 0;
      if (back.lengthSq() < 1) back.set(0, 0, 1);
      back.normalize().multiplyScalar(-1);
      back.y = 0.28; back.normalize();
      cam.position.copy(c).addScaledVector(back, dist);
      cam.lookAt(c); cam.updateMatrixWorld(true);
      window.__HID = [];
      if (h) {
        // ONLY the jersey (and its hull). The diff is then exactly the pixels
        // that carry the committed identity colour, with no bike frame, shorts,
        // skin or helmet to average it away.
        eng.scene.traverse((o) => {
          if (!o.visible || !o.name) return;
          if (o.name === `rider:${racer.id}:jersey` || o.name === `rider:${racer.id}:jersey:hull`) {
            o.visible = false; window.__HID.push(o);
          }
        });
      }
      // A/B the distance-identity floors on the SAME frame.
      eng.scene.traverse((o) => {
        const m = o.material;
        if (!m || !m.uniforms || !m.uniforms.uIdentityChroma) return;
        if (!o.name.startsWith(`rider:${racer.id}`) && !o.name.startsWith(`bike:${racer.id}`)) return;
        if (!m.__save) m.__save = {
          c: m.uniforms.uIdentityChroma.value,
          r: m.uniforms.uIdentityRim.value,
          i: m.uniforms.uIdentityInkFloor ? m.uniforms.uIdentityInkFloor.value : 1,
        };
        m.uniforms.uIdentityChroma.value = floors ? m.__save.c : 0;
        m.uniforms.uIdentityRim.value = floors ? m.__save.r : 0;
        if (m.uniforms.uIdentityInkFloor) m.uniforms.uIdentityInkFloor.value = floors ? m.__save.i : 1;
      });
      const G = window.__G2;
      G.updateNprGlobals(eng.elapsed ?? 0, cam, eng.renderSize.x, eng.renderSize.y);
      g.sky.update(cam, 0.6);
      g.post.render(eng.scene, cam, 0, eng.elapsed ?? 0);
      
    }, [WHO, hide, want, FLOORS]);
    await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
    const buf = await p.screenshot({ animations: 'disabled' });
    await p.evaluate(() => { for (const o of window.__HID ?? []) o.visible = true; window.__HID = []; });
    return buf;
  };
  for (const FLOORS of [true, false]) {
  const a = await shot(false, FLOORS);
  const bImg = await shot(true, FLOORS);
  const { readPngBuf } = await import('./_pngbuf.mjs');
  const A = readPngBuf(a), B = readPngBuf(bImg);
  let n = 0, peak = -1, peakHue = 0, onHue = 0, maxLum = 0, sumC = 0;
  const hist = new Array(12).fill(0);
  let peakOn = -1;
  for (let i = 0; i < A.data.length; i += A.channels) {
    const dr = A.data[i] - B.data[i], dg = A.data[i+1] - B.data[i+1], db = A.data[i+2] - B.data[i+2];
    if (Math.abs(dr) + Math.abs(dg) + Math.abs(db) < 12) continue;
    n++;
    const [h, , v, c] = rgb2hsv(A.data[i], A.data[i+1], A.data[i+2]);
    sumC += c;
    if (c > peak) { peak = c; peakHue = h; }
    if (c >= 25) hist[Math.floor(h / 30) % 12]++;
    if (c >= 40 && hueErr(h, tgtHue) <= 30) { onHue++; if (c > peakOn) peakOn = c; }
    maxLum = Math.max(maxLum, v * 255);
  }
  const dist = await p.evaluate(() => 0);
  void dist;
  console.log(
    `${FLOORS ? 'ON ' : 'off'} ${String(want).padStart(5)} ${''.padStart(6)} ${String(n).padStart(7)} ${peak.toFixed(0).padStart(11)} ` +
    `${hueErr(peakHue, tgtHue).toFixed(0).padStart(11)} ${((onHue / Math.max(n,1)) * 100).toFixed(0).padStart(8)} ` +
    `${maxLum.toFixed(0).padStart(8)} ${(sumC / Math.max(n,1)).toFixed(1).padStart(12)}` +
    `  onPeak=${peakOn.toFixed(0)}  hist=${hist.map((v,i)=>v?`${i*30}:${v}`:'').filter(Boolean).join(' ')}`,
  );
  }
}
await b.close();
