/**
 * _subjpx.mjs — how big is the subject, in PIXELS, in the frames the review set
 * actually ships?
 *
 * Measures by DIFFERENCE, not by projecting a bounding box: render the frame,
 * hide the player's bike + rider, render it again, and take the bounding box of
 * the pixels that changed. That is the only definition that is honest about
 *   - skinned meshes (their local bounding boxes are bind-pose and 30-60% too
 *     tall, which is exactly how a projected-box probe can report 254 px for a
 *     rider a critic measures at 150),
 *   - occlusion (a rider behind a ridge changes no pixels and measures 0),
 *   - the ink outline, which is part of the subject a reviewer sees.
 *
 * It drives the REAL harness path: takeControl → setSequence/setPose → step.
 *
 *   node tools/capture/_subjpx.mjs --seqs scree-speed,pack-race,switchback,tabletop-air --frames 60
 *   node tools/capture/_subjpx.mjs --pose bike-detail,ravine-gap
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
const STRIDE = Number(args.stride ?? 1);

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist'],
});
const context = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: PR });
const page = await context.newPage();
page.on('pageerror', (e) => console.log('  [page:exception]', e.message));

async function boot() {
  await page.goto(`${URL_BASE}/?capture=1&pr=${PR}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForFunction(() => !!window.__DESCENT__?.game?.capture, null, { timeout: 240_000 });
  await page.evaluate(() => window.__DESCENT__.game.capture.takeControl());
  await page.evaluate(() => {
    const G = () => window.__DESCENT__.game;
    const W = 800, H = 450;
    const c2 = document.createElement('canvas');
    c2.width = W; c2.height = H;
    const g2 = c2.getContext('2d', { willReadFrequently: true });

    function grab() {
      const gl = document.querySelector('canvas');
      g2.clearRect(0, 0, W, H);
      g2.drawImage(gl, 0, 0, W, H);
      return g2.getImageData(0, 0, W, H).data;
    }

    function subjectRoots() {
      const st = G().race.player.bike.state;
      const V = st.position.constructor;
      const out = [];
      const p = new V();
      G().engine.scene.traverse((o) => {
        if (!o.name) return;
        if (o.name !== 'bike:player' && o.name !== 'rider:player') return;
        o.getWorldPosition(p);
        out.push(o);
      });
      return out;
    }

    /**
     * Subject screen box as a fraction of the frame, by difference.
     * Returns null when the subject changed no pixels at all — i.e. it is
     * off-screen or fully occluded.
     */
    window.__subjPx = function subjPx() {
      const a = grab();
      const roots = subjectRoots();
      const wasVisible = roots.map((r) => r.visible);
      for (const r of roots) r.visible = false;
      G().capture.step(0);
      const b = grab();
      roots.forEach((r, i) => { r.visible = wasVisible[i]; });
      G().capture.step(0);
      // Third render, subject back in: anything that differs between A and C is
      // the pipeline's own frame-to-frame churn (dither, temporal terms) and
      // must not be counted as subject.
      const c = grab();

      let minX = 1e9, maxX = -1, minY = 1e9, maxY = -1, n = 0;
      const rowN = new Uint16Array(H);
      const colN = new Uint16Array(W);
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const i = (y * W + x) * 4;
          const d = Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
          if (d < 40) continue;
          const noise = Math.abs(a[i] - c[i]) + Math.abs(a[i + 1] - c[i + 1]) + Math.abs(a[i + 2] - c[i + 2]);
          if (noise >= d * 0.5) continue;
          n++;
          rowN[y]++;
          colN[x]++;
        }
      }
      // Rows/columns with a handful of changed pixels are ink fringes and stray
      // dither survivors; require a real run before a row counts as subject.
      for (let y = 0; y < H; y++) if (rowN[y] >= 3) { if (y < minY) minY = y; if (y > maxY) maxY = y; }
      for (let x = 0; x < W; x++) if (colN[x] >= 3) { if (x < minX) minX = x; if (x > maxX) maxX = x; }
      if (n < 12 || maxY < 0 || maxX < 0) return { px: 0, frac: 0, n: 0, cy: -1 };
      return {
        px: +(((maxY - minY + 1) / H) * 900).toFixed(1),
        wpx: +(((maxX - minX + 1) / W) * 1600).toFixed(1),
        frac: +((maxY - minY + 1) / H).toFixed(4),
        cy: +(((minY + maxY) * 0.5) / H).toFixed(3),
        cx: +(((minX + maxX) * 0.5) / W).toFixed(3),
        n,
      };
    };
  });
}

await boot();

async function step(n) {
  await page.evaluate(
    ([count, dt]) => { for (let i = 0; i < count; i++) window.__DESCENT__.game.capture.step(dt); },
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
    const m = await page.evaluate(() => window.__subjPx());
    console.log(`POSE ${pose.padEnd(22)} cssPx=${String(m.px).padStart(6)} devPx=${String((m.px * 2).toFixed(0)).padStart(6)} frac=${m.frac}  centre=(${m.cx},${m.cy})  pixels=${m.n}`);
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
    if (f % STRIDE) continue;
    const m = await page.evaluate(() => window.__subjPx());
    rows.push({ f, ...m });
  }
  const lost = rows.filter((r) => r.px < 12).map((r) => r.f);
  console.log(`\nSEQ ${name} (${rows.length} sampled of ${frames})`);
  console.log(`  cssPx ${JSON.stringify(stats(rows.map((r) => r.px)))}`);
  console.log(`  devPx ${JSON.stringify(stats(rows.map((r) => r.px * 2)))}`);
  console.log(`  frac  ${JSON.stringify(stats(rows.map((r) => r.frac)))}`);
  console.log(`  lost/occluded frames: ${lost.length ? `${lost.length} [${lost.slice(0, 16).join(',')}]` : 'none'}`);
  if (args.per) rows.forEach((r) => console.log(`   f${String(r.f).padStart(4, '0')} px=${r.px} cy=${r.cy} cx=${r.cx}`));
}

await browser.close();
