/**
 * _trace2.mjs — trace ONE sky boundary across the frame and report how level it
 * is. The decisive number for "is this a screen-space letterbox rule" is the
 * standard deviation, in native rows, of the boundary's y position across the
 * full frame width. A dome feature at this field of view should move tens of
 * rows; a screen-space bar moves none.
 *
 * node tools/capture/_trace2.mjs <png> <yLo> <yHi> [x0] [x1] [step]
 */
import { readPng, px, hex } from './_pngread.mjs';

const [, , file, loS, hiS, x0S, x1S, stS] = process.argv;
const img = readPng(file);
const lo = Number(loS), hi = Number(hiS);
const x0 = Number(x0S ?? 0), x1 = Number(x1S ?? img.width - 1), st = Number(stS ?? 16);
const d3 = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);

const ys = [], mags = [];
for (let x = x0; x <= x1; x += st) {
  let best = -1, bestY = -1;
  for (let y = lo; y <= hi; y++) {
    const v = d3(px(img, x, y - 2), px(img, x, y + 2));
    if (v > best) { best = v; bestY = y; }
  }
  ys.push(bestY); mags.push(best);
}
const mean = ys.reduce((s, v) => s + v, 0) / ys.length;
const sd = Math.sqrt(ys.reduce((s, v) => s + (v - mean) ** 2, 0) / ys.length);
console.log(`${file}  boundary in y=${lo}..${hi}, x=${x0}..${x1} step ${st}`);
console.log(`  mean y ${mean.toFixed(1)}  sd ${sd.toFixed(1)} rows  min ${Math.min(...ys)}  max ${Math.max(...ys)}  range ${Math.max(...ys) - Math.min(...ys)}`);
console.log(`  mean step magnitude ${(mags.reduce((s, v) => s + v, 0) / mags.length).toFixed(1)}/765`);
const cols = [];
for (let i = 0; i < ys.length; i += Math.max(1, Math.floor(ys.length / 20))) cols.push(`${x0 + i * st}:${ys[i]}`);
console.log(`  samples ${cols.join(' ')}`);
// Colour either side at the middle column
const mid = Math.floor((x0 + x1) / 2);
console.log(`  at x=${mid}: above ${hex(px(img, mid, Math.round(mean) - 12))}  below ${hex(px(img, mid, Math.round(mean) + 12))}`);
