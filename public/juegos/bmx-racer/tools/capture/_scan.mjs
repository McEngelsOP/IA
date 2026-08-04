/**
 * Throwaway probe: print a column (or row) of pixel values out of a PNG so a
 * value STEP can be measured instead of guessed at.
 *
 *   node tools/capture/_scan.mjs img.png col <x> <y0> <y1> <stride>
 *   node tools/capture/_scan.mjs img.png row <y> <x0> <x1> <stride>
 */
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';

const [, , inPath, mode, aS, b0S, b1S, strideS] = process.argv;
const a = Number(aS), b0 = Number(b0S), b1 = Number(b1S), stride = Number(strideS ?? 8);

const b64 = (await readFile(inPath)).toString('base64');
const browser = await chromium.launch();
const page = await browser.newPage();
const rows = await page.evaluate(
  async ({ b64, mode, a, b0, b1, stride }) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + b64;
    await img.decode();
    const cv = document.createElement('canvas');
    cv.width = img.width;
    cv.height = img.height;
    const g = cv.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0);
    const out = [];
    for (let t = b0; t <= b1; t += stride) {
      const x = mode === 'col' ? a : t;
      const y = mode === 'col' ? t : a;
      // Average a 5px box so single-pixel ink lines don't dominate.
      const d = g.getImageData(x - 2, y - 2, 5, 5).data;
      let r = 0, gg = 0, bb = 0;
      for (let i = 0; i < d.length; i += 4) { r += d[i]; gg += d[i + 1]; bb += d[i + 2]; }
      const n = d.length / 4;
      out.push([t, Math.round(r / n), Math.round(gg / n), Math.round(bb / n)]);
    }
    return out;
  },
  { b64, mode, a, b0, b1, stride },
);
await browser.close();
let prev = null;
for (const [t, r, g, b] of rows) {
  const d = prev ? Math.abs(r - prev[0]) + Math.abs(g - prev[1]) + Math.abs(b - prev[2]) : 0;
  console.log(String(t).padStart(5), String(r).padStart(4), String(g).padStart(4), String(b).padStart(4), d > 6 ? `  <-- step ${d}` : '');
  prev = [r, g, b];
}
