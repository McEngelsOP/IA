/**
 * _skycol.mjs — vertical colour-band census down a column.
 * Groups consecutive rows whose RGB stays within a tolerance and prints the
 * runs, so a "flat slab" shows up as one run with a row count.
 *
 *   node tools/capture/_skycol.mjs <png> <x> [y0] [y1] [tol]
 */
import { readPng } from './_pngread.mjs';

const [file, xs, y0s, y1s, tols] = process.argv.slice(2);
const img = readPng(file);
const x = Number(xs);
const y0 = Number(y0s ?? 0);
const y1 = Number(y1s ?? img.height - 1);
const tol = Number(tols ?? 6);
const ch = img.channels;

function px(yy) {
  const i = (yy * img.width + x) * ch;
  return [img.data[i], img.data[i + 1], img.data[i + 2]];
}
function hsv([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d > 1e-6) {
    if (mx === r) h = ((g - b) / d) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
  }
  h = (h * 60 + 360) % 360;
  return [Math.round(h), Math.round((mx ? d / mx : 0) * 100), Math.round(mx * 100)];
}

let start = y0;
let ref = px(y0);
const runs = [];
for (let y = y0 + 1; y <= y1; y++) {
  const c = px(y);
  const dd = Math.max(Math.abs(c[0] - ref[0]), Math.abs(c[1] - ref[1]), Math.abs(c[2] - ref[2]));
  if (dd > tol) {
    runs.push([start, y - 1, ref]);
    start = y;
    ref = c;
  }
}
runs.push([start, y1, ref]);
console.log(`${file} x=${x} rows ${y0}..${y1} tol ${tol}`);
for (const [a, b, c] of runs) {
  const n = b - a + 1;
  if (n < 4) continue;
  const [h, s, v] = hsv(c);
  console.log(`  ${String(a).padStart(4)}..${String(b).padStart(4)}  ${String(n).padStart(4)} rows  ` +
    `#${c.map((q) => q.toString(16).padStart(2, '0')).join('')}  hsv(${h}, ${s}%, ${v}%)`);
}
