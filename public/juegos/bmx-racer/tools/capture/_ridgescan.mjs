/**
 * Throwaway probe. Walks every column across a horizontal span of a still,
 * finds the sky/terrain boundary in that column, and reports the DARKEST
 * luminance found in a window straddling the boundary — i.e. "how black is the
 * ink on the ridge at this column", column by column, so a dropout shows up as
 * a number rather than as an impression.
 *
 *   node tools/capture/_ridgescan.mjs still.png x0 x1 y0 y1 [step]
 *
 * x0..x1  columns to scan (full-res frame coords, 3200x1800)
 * y0..y1  the vertical band the ridge lives in
 */
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';

const [, , inPath, x0s, x1s, y0s, y1s, steps] = process.argv;
const x0 = Number(x0s), x1 = Number(x1s), y0 = Number(y0s), y1 = Number(y1s);
const step = Number(steps ?? 1);

const b64 = (await readFile(inPath)).toString('base64');
const browser = await chromium.launch();
const page = await browser.newPage();
const rows = await page.evaluate(
  async ({ b64, x0, x1, y0, y1, step }) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + b64;
    await img.decode();
    const cv = document.createElement('canvas');
    cv.width = img.width;
    cv.height = img.height;
    const g = cv.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, cv.width, cv.height).data;
    const lum = (x, y) => {
      const i = (y * cv.width + x) * 4;
      return 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    };
    const out = [];
    for (let x = x0; x <= x1; x += step) {
      // The boundary: the row of steepest downward luminance change in the band.
      let best = -1, bestSlope = 0;
      for (let y = y0; y < y1; y++) {
        const s = lum(x, y - 2) - lum(x, y + 3);
        if (s > bestSlope) { bestSlope = s; best = y; }
      }
      if (best < 0) { out.push({ x, y: -1 }); continue; }
      // Sky reference a little above, terrain reference a little below.
      const sky = lum(x, Math.max(0, best - 6));
      const ground = lum(x, Math.min(cv.height - 1, best + 7));
      let dark = 1e9, darkY = best;
      for (let y = best - 4; y <= best + 5; y++) {
        const L = lum(x, y);
        if (L < dark) { dark = L; darkY = y; }
      }
      // Profile of the 10-px window, for eyeballing stroke width.
      const prof = [];
      for (let y = best - 4; y <= best + 5; y++) prof.push(Math.round(lum(x, y)));
      out.push({ x, y: best, sky: Math.round(sky), ground: Math.round(ground),
                 dark: Math.round(dark), darkY, prof });
    }
    return out;
  },
  { b64, x0, x1, y0, y1, step },
);
await browser.close();

let miss = 0;
for (const r of rows) {
  if (r.y < 0) { console.log(`x=${r.x}  NO BOUNDARY`); miss++; continue; }
  // "Ink" = the darkest pixel is meaningfully darker than BOTH neighbours.
  const contrast = Math.min(r.sky, r.ground) - r.dark;
  if (contrast < 25) miss++;
  console.log(
    `x=${String(r.x).padStart(4)} y=${String(r.y).padStart(4)} sky=${String(r.sky).padStart(3)}` +
    ` gnd=${String(r.ground).padStart(3)} ink=${String(r.dark).padStart(3)}` +
    ` drop=${String(contrast).padStart(4)} | ${r.prof.join(' ')}`,
  );
}
const n = rows.length;
const inks = rows.filter((r) => r.y >= 0).map((r) => r.dark);
inks.sort((a, b) => a - b);
console.log(`\ncolumns=${n}  weak(<25 drop)=${miss} (${((100 * miss) / n).toFixed(1)}%)`);
console.log(`ink median=${inks[inks.length >> 1]}  min=${inks[0]}  max=${inks[inks.length - 1]}`);
