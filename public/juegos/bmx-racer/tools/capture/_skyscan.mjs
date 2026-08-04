/**
 * _skyscan.mjs — horizontal luminance trace + step histogram.
 * Reproduces the stills critic's scan: "maximum single-pixel step" and
 * "number of steps above N" across a horizontal run.
 *
 *   node tools/capture/_skyscan.mjs <png> <y> <x0> <x1>
 */
import { readPng } from './_pngread.mjs';

const [file, ys, x0s, x1s] = process.argv.slice(2);
const img = readPng(file);
const y = Number(ys);
const x0 = Number(x0s);
const x1 = Number(x1s);
const ch = img.channels ?? img.ch ?? 4;

function lum(x, yy) {
  const i = (yy * img.width + x) * ch;
  return 0.2126 * img.data[i] + 0.7152 * img.data[i + 1] + 0.0722 * img.data[i + 2];
}

const L = [];
for (let x = x0; x <= x1; x++) L.push(lum(x, y));

let maxStep = 0;
let maxAt = x0;
const buckets = { '>1': 0, '>2': 0, '>4': 0, '>6': 0, '>10': 0, '>16': 0 };
for (let i = 1; i < L.length; i++) {
  const d = Math.abs(L[i] - L[i - 1]);
  if (d > maxStep) { maxStep = d; maxAt = x0 + i; }
  if (d > 1) buckets['>1']++;
  if (d > 2) buckets['>2']++;
  if (d > 4) buckets['>4']++;
  if (d > 6) buckets['>6']++;
  if (d > 10) buckets['>10']++;
  if (d > 16) buckets['>16']++;
}
const lo = Math.min(...L);
const hi = Math.max(...L);
console.log(
  `${file} y=${y} x${x0}-${x1} (${L.length}px)  lum ${L[0].toFixed(1)} -> ${L[L.length - 1].toFixed(1)}` +
  `  range ${lo.toFixed(1)}..${hi.toFixed(1)} (span ${(hi - lo).toFixed(1)})`,
);
console.log(`  maxstep ${maxStep.toFixed(2)} at x=${maxAt}   steps ` +
  Object.entries(buckets).map(([k, v]) => `${k}:${v}`).join(' '));
