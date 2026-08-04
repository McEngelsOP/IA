/**
 * Throwaway probe: measure how STAIRCASED an edge is.
 *
 * For every column in a window it finds the row where luminance crosses a
 * threshold, then reports the run-length distribution of identical rows. A
 * texel-quantised shadow edge produces long runs of one row followed by a jump
 * (that IS the staircase); a properly resolved edge advances by ~1 row per
 * column, so runs are 1-2 long.
 *
 *   node tools/capture/_stairs.mjs img.png <x0> <x1> <y0> <y1> <threshold>
 */
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';

const [, , inPath, x0S, x1S, y0S, y1S, thrS] = process.argv;
const b64 = (await readFile(inPath)).toString('base64');

const browser = await chromium.launch();
const page = await browser.newPage();
const res = await page.evaluate(
  async ({ b64, x0, x1, y0, y1, thr }) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + b64;
    await img.decode();
    const cv = document.createElement('canvas');
    cv.width = img.width; cv.height = img.height;
    const g = cv.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0);
    const px = g.getImageData(0, 0, img.width, img.height).data;
    const W = img.width;
    const L = (x, y) => {
      const i = (y * W + x) * 4;
      return 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
    };
    const edges = [];
    for (let x = x0; x <= x1; x++) {
      let e = -1;
      for (let y = y0; y <= y1; y++) {
        if (L(x, y) > thr) { e = y; break; }
      }
      edges.push(e);
    }
    return edges;
  },
  { b64, x0: +x0S, x1: +x1S, y0: +y0S, y1: +y1S, thr: +thrS },
);
await browser.close();

const runs = [];
let cur = 1;
for (let i = 1; i < res.length; i++) {
  if (res[i] === res[i - 1] && res[i] >= 0) cur++;
  else { runs.push(cur); cur = 1; }
}
runs.push(cur);
const valid = res.filter((e) => e >= 0).length;
runs.sort((a, b) => b - a);
const mean = runs.reduce((a, b) => a + b, 0) / runs.length;
console.log(`# ${inPath}  columns=${res.length} withEdge=${valid}`);
console.log(`runs: n=${runs.length}  mean=${mean.toFixed(2)}  max=${runs[0]}  top10=${runs.slice(0, 10).join(',')}`);
console.log(`edge rows: ${res.slice(0, 60).join(' ')}`);
