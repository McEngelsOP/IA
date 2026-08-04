/**
 * Throwaway probe: measure the SKY/TERRAIN silhouette stroke, column by column.
 *
 * For every sampled column it walks down from the top of the frame until the
 * luminance drops by more than `drop` from the local sky value — that row is
 * the silhouette. It then reports:
 *
 *   skyL   luminance just above the boundary
 *   inkL   darkest luminance in the first `depth` rows at/below the boundary
 *   alpha  implied ink opacity, (skyL - inkL) / (skyL - INK_L)
 *
 * INK (0x1d1626) lands at luminance ~25 in the graded frame, which is the value
 * the critic measured, so alpha is directly comparable to their numbers.
 *
 *   node tools/capture/_ridge.mjs img.png [x0] [x1] [stride] [ymin] [ymax]
 */
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';

const [, , inPath, x0S, x1S, strideS, yminS, ymaxS] = process.argv;
const b64 = (await readFile(inPath)).toString('base64');

const browser = await chromium.launch();
const page = await browser.newPage();
const res = await page.evaluate(
  async ({ b64, x0, x1, stride, ymin, ymax }) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + b64;
    await img.decode();
    const cv = document.createElement('canvas');
    cv.width = img.width;
    cv.height = img.height;
    const g = cv.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0);
    const W = img.width;
    const H = img.height;
    const data = g.getImageData(0, 0, W, H).data;
    const lum = (x, y) => {
      const i = (y * W + x) * 4;
      return 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    };
    x1 = Math.min(x1 ?? W - 1, W - 1);
    ymax = Math.min(ymax ?? H - 1, H - 1);
    const rows = [];
    const INK_L = 25;
    const DEPTH = 5;
    for (let x = x0; x <= x1; x += stride) {
      let edge = -1;
      for (let y = ymin + 4; y <= ymax; y++) {
        const above = lum(x, y - 4);
        const here = lum(x, y);
        if (above - here > 22 && above > 120) { edge = y; break; }
      }
      if (edge < 0) { rows.push({ x, edge: -1 }); continue; }
      const skyL = Math.max(lum(x, edge - 3), lum(x, edge - 4), lum(x, edge - 5));
      let inkL = 1e9;
      let inkY = edge;
      for (let y = edge - 1; y <= edge + DEPTH; y++) {
        const v = lum(x, y);
        if (v < inkL) { inkL = v; inkY = y; }
      }
      // Value the terrain settles to, past the stroke.
      const bodyL = (lum(x, edge + DEPTH + 2) + lum(x, edge + DEPTH + 3) + lum(x, edge + DEPTH + 4)) / 3;
      const alpha = (skyL - inkL) / Math.max(skyL - INK_L, 1);
      // How much darker the stroke is than the terrain it sits on: this is the
      // part that reads as a drawn line rather than as a colour step.
      const overBody = (bodyL - inkL) / Math.max(bodyL - INK_L, 1);
      rows.push({ x, edge, inkY, skyL, inkL, bodyL, alpha, overBody });
    }
    return { W, H, rows };
  },
  {
    b64,
    x0: Number(x0S ?? 0),
    x1: x1S ? Number(x1S) : undefined,
    stride: Number(strideS ?? 16),
    ymin: Number(yminS ?? 0),
    ymax: ymaxS ? Number(ymaxS) : undefined,
  },
);
await browser.close();

console.log(`# ${inPath}  ${res.W}x${res.H}`);
console.log('     x   edge   skyL   inkL  bodyL  alpha  overBody');
let n = 0;
let sum = 0;
let worst = 1e9;
for (const r of res.rows) {
  if (r.edge < 0) { console.log(String(r.x).padStart(6), '   —'); continue; }
  console.log(
    String(r.x).padStart(6),
    String(r.edge).padStart(6),
    r.skyL.toFixed(0).padStart(6),
    r.inkL.toFixed(0).padStart(6),
    r.bodyL.toFixed(0).padStart(6),
    r.alpha.toFixed(3).padStart(6),
    r.overBody.toFixed(3).padStart(9),
  );
  n++;
  sum += r.overBody;
  worst = Math.min(worst, r.overBody);
}
if (n) console.log(`\nmean overBody ${(sum / n).toFixed(3)}   min ${worst.toFixed(3)}   n=${n}`);
