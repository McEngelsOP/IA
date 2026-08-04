/**
 * Throwaway probe — the one that settles defect 1.
 *
 * For every column in a range it finds the TOPMOST sky/geometry boundary from
 * the LinesPass debug target (contour channel), reads the ink alpha the pass
 * actually emitted there, and then reads the SAME pixel out of the finished,
 * graded frame. So each row of output answers all three questions at once:
 *
 *   did the detector fire · did the alpha survive · did the pixel go dark
 *
 *   node tools/capture/_ridgeink.mjs <pose> x0 x1 step [ytop ybot]
 */
import { chromium } from 'playwright';

const [, , pose, x0s, x1s, steps, ytops, ybots] = process.argv;
const x0 = Number(x0s), x1 = Number(x1s), step = Number(steps ?? 8);
const ytop = Number(ytops ?? 0), ybot = Number(ybots ?? 900);

const browser = await chromium.launch({
  args: ['--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist'],
});
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('PAGEERR', e.message.slice(0, 300)));
await page.goto('http://127.0.0.1:5173/?capture=1&pr=2', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!window.__DESCENT__?.game?.capture, null, { timeout: 240000 });

const found = await page.evaluate(
  async ({ pose, x0, x1, step, ytop, ybot }) => {
    const g = window.__DESCENT__.game;
    const renderer = window.__DESCENT__.engine.renderer;
    g.capture.takeControl();
    g.capture.setPose(pose);
    g.post.lines.setDebug(0);
    for (let i = 0; i < 12; i++) g.capture.step(1 / 60);
    // Re-render the SAME simulation state into the debug channel: dt 0 advances
    // nothing, so the ink target and the screenshot below describe one frame,
    // not two. Without this the two reads are a couple of pixels apart and the
    // correlation the probe exists to make is meaningless.
    g.post.lines.setDebug(7);
    g.capture.step(0);
    const rt = g.post.lines.target;
    const buf = new Uint8Array(rt.width * rt.height * 4);
    renderer.readRenderTargetPixels(rt, 0, 0, rt.width, rt.height, buf);
    const at = (x, y) => {
      const i = ((rt.height - 1 - y) * rt.width + x) * 4;
      return [buf[i], buf[i + 1], buf[i + 3]];
    };
    const out = [];
    for (let x = x0; x <= x1; x += step) {
      let y = -1;
      for (let yy = ytop; yy <= ybot; yy++) if (at(x, yy)[0] > 127) { y = yy; break; }
      if (y < 0) { out.push({ x, y: -1 }); continue; }
      const prof = [];
      for (let k = -2; k <= 5; k++) prof.push(at(x, y + k)[2]);
      out.push({ x, y, hull: at(x, y)[1], alpha: at(x, y)[2], prof });
    }
    g.post.lines.setDebug(0);
    g.capture.step(0);
    return out;
  },
  { pose, x0, x1, step, ytop, ybot },
);

const shot = await page.screenshot({ animations: 'disabled' });
await browser.close();

// Decode the finished frame and read the same coordinates.
const b2 = await chromium.launch();
const p2 = await b2.newPage();
const lums = await p2.evaluate(
  async ({ b64, pts }) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + b64;
    await img.decode();
    const cv = document.createElement('canvas');
    cv.width = img.width; cv.height = img.height;
    const g = cv.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, cv.width, cv.height).data;
    const L = (x, y) => {
      const i = (y * cv.width + x) * 4;
      return Math.round(0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]);
    };
    return pts.map(({ x, y }) => (y < 0 ? null : {
      sky: L(x, Math.max(0, y - 4)),
      prof: [-2, -1, 0, 1, 2, 3, 4, 5].map((k) => L(x, y + k)),
    }));
  },
  { b64: shot.toString('base64'), pts: found.map((f) => ({ x: f.x, y: f.y ?? -1 })) },
);
await b2.close();

let dead = 0, weak = 0;
const inks = [];
for (let i = 0; i < found.length; i++) {
  const f = found[i];
  if (f.y < 0) { console.log(`x=${f.x}  NO CONTOUR IN BAND`); dead++; continue; }
  const l = lums[i];
  const ink = Math.min(...l.prof.slice(2, 6));
  inks.push(ink);
  const drop = l.sky - ink;
  if (drop < 40) weak++;
  console.log(
    `x=${String(f.x).padStart(4)} y=${String(f.y).padStart(4)} hull=${String(f.hull).padStart(3)}` +
    ` a=[${f.prof.join(',')}]  sky=${String(l.sky).padStart(3)} ink=${String(ink).padStart(3)}` +
    ` drop=${String(drop).padStart(4)} | ${l.prof.join(' ')}`,
  );
}
inks.sort((a, b) => a - b);
console.log(`\ncolumns=${found.length}  no-contour=${dead}  drop<40=${weak}`);
if (inks.length) console.log(`final ink  median=${inks[inks.length >> 1]}  min=${inks[0]}  max=${inks[inks.length - 1]}`);
