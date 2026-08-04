/**
 * Throwaway probe: the ridge-contour audit.
 *
 * Reads the ink buffer (which knows exactly where the sky/terrain boundary is,
 * because the G-buffer coverage mask is in it) AND the finished frame, then
 * reports both at the same pixel. That correlation is the only way to tell
 * "the detector never fired" apart from "the detector fired and the stroke is
 * invisible once it has been fogged and graded".
 *
 *   node tools/capture/_ridge2.mjs <pose> [x0] [x1] [stride] [y0] [y1]
 */
import { chromium } from 'playwright';

const [, , pose, x0S, x1S, strideS, y0S, y1S] = process.argv;
const X0 = Number(x0S ?? 0);
const X1 = Number(x1S ?? 3199);
const STRIDE = Number(strideS ?? 20);
const Y0 = Number(y0S ?? 0);
const Y1 = Number(y1S ?? 1500);

const browser = await chromium.launch({
  args: ['--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'],
});
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('PAGEERR', e.message.slice(0, 300)));
await page.goto('http://127.0.0.1:5173/?capture=1&pr=2', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!window.__DESCENT__?.game?.capture, null, { timeout: 240000 });

// 1. the ink buffer, packed diagnostics
const ink = await page.evaluate(
  async ({ pose }) => {
    const g = window.__DESCENT__.game;
    const renderer = window.__DESCENT__.engine.renderer;
    g.capture.takeControl();
    g.capture.setPose(pose);
    g.post.lines.setDebug(7);
    for (let i = 0; i < 12; i++) g.capture.step(1 / 60);
    const rt = g.post.lines.target;
    const buf = new Uint8Array(rt.width * rt.height * 4);
    renderer.readRenderTargetPixels(rt, 0, 0, rt.width, rt.height, buf);
    // Left in the page. Shipping 23 MB of typed array over CDP as JSON is an
    // out-of-memory kill, and the analysis wants it in the page anyway.
    window.__inkbuf = { W: rt.width, H: rt.height, buf };
    return { W: rt.width, H: rt.height };
  },
  { pose },
);

// 2. the finished frame
await page.evaluate(() => {
  const g = window.__DESCENT__.game;
  g.post.lines.setDebug(0);
  for (let i = 0; i < 2; i++) g.capture.step(1 / 60);
});
await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
const shot = await page.screenshot({ animations: 'disabled' });

const analysis = await page.evaluate(
  async ({ b64, X0, X1, STRIDE, Y0, Y1 }) => {
    const ink = window.__inkbuf;
    const img = new Image();
    img.src = 'data:image/png;base64,' + b64;
    await img.decode();
    const cv = document.createElement('canvas');
    cv.width = img.width;
    cv.height = img.height;
    const g2 = cv.getContext('2d', { willReadFrequently: true });
    g2.drawImage(img, 0, 0);
    const px = g2.getImageData(0, 0, img.width, img.height).data;
    const W = img.width;
    const L = (x, y) => {
      const i = (y * W + x) * 4;
      return 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
    };
    const IW = ink.W;
    const IH = ink.H;
    const inkAt = (x, y) => {
      const i = ((IH - 1 - y) * IW + x) * 4;
      return [ink.buf[i], ink.buf[i + 1], ink.buf[i + 2], ink.buf[i + 3]];
    };
    const rows = [];
    for (let x = X0; x <= X1; x += STRIDE) {
      let edge = -1;
      for (let y = Y0; y <= Y1; y++) {
        if (inkAt(x, y)[2] > 128) { edge = y; break; }
      }
      if (edge < 0) { rows.push({ x, edge: -1 }); continue; }
      let a = 0, ay = edge, contour = 0, hull = 0;
      for (let y = edge; y < edge + 4; y++) {
        const p = inkAt(x, y);
        if (p[3] > a) { a = p[3]; ay = y; contour = p[0]; hull = p[1]; }
      }
      const skyL = (L(x, edge - 3) + L(x, edge - 4) + L(x, edge - 5)) / 3;
      let strokeL = 1e9;
      for (let y = edge - 1; y < edge + 5; y++) strokeL = Math.min(strokeL, L(x, y));
      const bodyL = (L(x, edge + 7) + L(x, edge + 8) + L(x, edge + 9)) / 3;
      // Contrast the stroke actually achieves against the two things it sits
      // between. A stroke that is not darker than BOTH is not reading as ink.
      rows.push({ x, edge, a, ay, contour, hull, skyL, strokeL, bodyL,
        vsSky: skyL - strokeL, vsBody: bodyL - strokeL });
    }
    return rows;
  },
  { b64: shot.toString('base64'), X0, X1, STRIDE, Y0, Y1 },
);
await browser.close();

console.log(`# ${pose}`);
console.log('     x   edge  inkA  ctr  hull    skyL strokeL  bodyL   vsSky  vsBody');
let n = 0, sumSky = 0, sumBody = 0, minSky = 1e9, minBody = 1e9;
for (const r of analysis) {
  if (r.edge < 0) { console.log(String(r.x).padStart(6), '   —'); continue; }
  const flag = r.vsBody < 18 || r.vsSky < 12 ? '  <-- DROPOUT' : '';
  console.log(
    String(r.x).padStart(6), String(r.edge).padStart(6),
    String(r.a).padStart(6), String(r.contour).padStart(5), String(r.hull).padStart(5),
    r.skyL.toFixed(0).padStart(8), r.strokeL.toFixed(0).padStart(8), r.bodyL.toFixed(0).padStart(7),
    r.vsSky.toFixed(0).padStart(8), r.vsBody.toFixed(0).padStart(8), flag,
  );
  n++; sumSky += r.vsSky; sumBody += r.vsBody;
  minSky = Math.min(minSky, r.vsSky); minBody = Math.min(minBody, r.vsBody);
}
if (n) {
  console.log(`\nn=${n}  mean vsSky ${(sumSky / n).toFixed(1)}  mean vsBody ${(sumBody / n).toFixed(1)}`);
  console.log(`       min  vsSky ${minSky.toFixed(1)}  min  vsBody ${minBody.toFixed(1)}`);
}
