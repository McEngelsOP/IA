/**
 * Throwaway probe: dump a LinesPass debug channel as a raw PNG, straight off
 * the ink render target — no grade, no vignette, no HUD on top of it.
 *
 *   node tools/capture/_dbgimg.mjs <pose> <debug 0-8> <out.png> [x y w h]
 */
import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';

const [, , pose, dbgS, out, xS, yS, wS, hS] = process.argv;
const dbg = Number(dbgS ?? 1);

const browser = await chromium.launch({
  args: ['--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'],
});
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('PAGEERR', e.message.slice(0, 300)));
await page.goto('http://127.0.0.1:5173/?capture=1&pr=2', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!window.__DESCENT__?.game?.capture, null, { timeout: 240000 });

const b64 = await page.evaluate(
  async ({ pose, dbg, x, y, w, h }) => {
    const g = window.__DESCENT__.game;
    const renderer = window.__DESCENT__.engine.renderer;
    g.capture.takeControl();
    g.capture.setPose(pose);
    g.post.lines.setDebug(dbg);
    for (let i = 0; i < 12; i++) g.capture.step(1 / 60);
    const rt = g.post.lines.target;
    const buf = new Uint8Array(rt.width * rt.height * 4);
    renderer.readRenderTargetPixels(rt, 0, 0, rt.width, rt.height, buf);
    const X = x ?? 0, Y = y ?? 0, W = w ?? rt.width, H = h ?? rt.height;
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const c2 = cv.getContext('2d');
    const im = c2.createImageData(W, H);
    for (let j = 0; j < H; j++) {
      for (let i2 = 0; i2 < W; i2++) {
        const src = ((rt.height - 1 - (Y + j)) * rt.width + (X + i2)) * 4;
        const dst = (j * W + i2) * 4;
        im.data[dst] = buf[src];
        im.data[dst + 1] = buf[src + 1];
        im.data[dst + 2] = buf[src + 2];
        im.data[dst + 3] = 255;
      }
    }
    c2.putImageData(im, 0, 0);
    return cv.toDataURL('image/png').split(',')[1];
  },
  { pose, dbg, x: xS ? Number(xS) : null, y: yS ? Number(yS) : null, w: wS ? Number(wS) : null, h: hS ? Number(hS) : null },
);
await browser.close();
await writeFile(out, Buffer.from(b64, 'base64'));
console.log('wrote', out);
