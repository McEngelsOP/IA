/**
 * Throwaway probe: print one column of the INK buffer and the FINISHED frame
 * side by side. `debug` selects which ink packing is read (0 = shipping ink
 * rgb/alpha, 7 = contour/hull/coverage/alpha, 8 = normal magnitudes/spans).
 *
 *   node tools/capture/_dual.mjs <pose> <debug> col <x> <y0> <y1>
 *   node tools/capture/_dual.mjs <pose> <debug> row <y> <x0> <x1>
 */
import { chromium } from 'playwright';

const [, , pose, dbgS, mode, aS, b0S, b1S] = process.argv;
const dbg = Number(dbgS ?? 0);
const A = Number(aS), B0 = Number(b0S), B1 = Number(b1S);

const browser = await chromium.launch({
  args: ['--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'],
});
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('PAGEERR', e.message.slice(0, 300)));
await page.goto('http://127.0.0.1:5173/?capture=1&pr=2', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!window.__DESCENT__?.game?.capture, null, { timeout: 240000 });

await page.evaluate(
  async ({ pose, dbg }) => {
    const g = window.__DESCENT__.game;
    const renderer = window.__DESCENT__.engine.renderer;
    g.capture.takeControl();
    g.capture.setPose(pose);
    g.post.lines.setDebug(dbg);
    for (let i = 0; i < 12; i++) g.capture.step(1 / 60);
    const rt = g.post.lines.target;
    const buf = new Uint8Array(rt.width * rt.height * 4);
    renderer.readRenderTargetPixels(rt, 0, 0, rt.width, rt.height, buf);
    window.__inkbuf = { W: rt.width, H: rt.height, buf };
  },
  { pose, dbg },
);

await page.evaluate(() => {
  const g = window.__DESCENT__.game;
  g.post.lines.setDebug(0);
  for (let i = 0; i < 2; i++) g.capture.step(1 / 60);
});
await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
const shot = await page.screenshot({ animations: 'disabled' });

const rows = await page.evaluate(
  async ({ b64, mode, A, B0, B1 }) => {
    const ink = window.__inkbuf;
    const img = new Image();
    img.src = 'data:image/png;base64,' + b64;
    await img.decode();
    const cv = document.createElement('canvas');
    cv.width = img.width; cv.height = img.height;
    const g2 = cv.getContext('2d', { willReadFrequently: true });
    g2.drawImage(img, 0, 0);
    const px = g2.getImageData(0, 0, img.width, img.height).data;
    const W = img.width;
    const out = [];
    for (let t = B0; t <= B1; t++) {
      const x = mode === 'col' ? A : t;
      const y = mode === 'col' ? t : A;
      const j = (y * W + x) * 4;
      const i = ((ink.H - 1 - y) * ink.W + x) * 4;
      out.push([
        t,
        ink.buf[i], ink.buf[i + 1], ink.buf[i + 2], ink.buf[i + 3],
        px[j], px[j + 1], px[j + 2],
        Math.round(0.2126 * px[j] + 0.7152 * px[j + 1] + 0.0722 * px[j + 2]),
      ]);
    }
    return out;
  },
  { b64: shot.toString('base64'), mode, A, B0, B1 },
);
await browser.close();

console.log('     t | ink  r    g    b    a |  frame  r    g    b     L');
for (const r of rows) {
  console.log(
    String(r[0]).padStart(6), '|',
    String(r[1]).padStart(4), String(r[2]).padStart(4), String(r[3]).padStart(4), String(r[4]).padStart(4), '|',
    String(r[5]).padStart(8), String(r[6]).padStart(4), String(r[7]).padStart(4), String(r[8]).padStart(6),
  );
}
