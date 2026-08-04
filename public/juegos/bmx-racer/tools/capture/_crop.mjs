/**
 * Throwaway crop probe. Crops a region out of a PNG at 1:1 so the Read tool
 * shows real pixels instead of a downsample.
 *
 *   node tools/capture/_crop.mjs in.png out.png x y w h [scale]
 */
import { chromium } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';

const [, , inPath, outPath, xs, ys, ws, hs, ss] = process.argv;
const x = Number(xs), y = Number(ys), w = Number(ws), h = Number(hs);
const scale = Number(ss ?? 1);

const b64 = (await readFile(inPath)).toString('base64');
const browser = await chromium.launch();
const page = await browser.newPage();
const out = await page.evaluate(
  async ({ b64, x, y, w, h, scale }) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + b64;
    await img.decode();
    const cv = document.createElement('canvas');
    cv.width = Math.round(w * scale);
    cv.height = Math.round(h * scale);
    const g = cv.getContext('2d');
    g.imageSmoothingEnabled = scale < 1;
    g.drawImage(img, x, y, w, h, 0, 0, cv.width, cv.height);
    return cv.toDataURL('image/png').split(',')[1];
  },
  { b64, x, y, w, h, scale },
);
await writeFile(outPath, Buffer.from(out, 'base64'));
await browser.close();
console.log('wrote', outPath, w * scale, 'x', h * scale);
