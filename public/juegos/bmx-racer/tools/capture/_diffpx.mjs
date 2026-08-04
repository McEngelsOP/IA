/** Pixel diff between two PNGs: count and max delta, plus a bounding box. */
import { readPng, px } from './_pngread.mjs';
const [a, b] = process.argv.slice(2);
const A = readPng(a), B = readPng(b);
let n = 0, mx = 0, x0 = 1e9, x1 = -1, y0 = 1e9, y1 = -1, sum = 0;
for (let y = 0; y < A.height; y += 2) {
  for (let x = 0; x < A.width; x += 2) {
    const p = px(A, x, y), q = px(B, x, y);
    const d = Math.max(Math.abs(p[0] - q[0]), Math.abs(p[1] - q[1]), Math.abs(p[2] - q[2]));
    if (d > 2) {
      n++; sum += d;
      if (d > mx) mx = d;
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
}
const tot = (A.width / 2) * (A.height / 2);
console.log(`${a.split('/').pop()} vs ${b.split('/').pop()}`);
console.log(`  changed ${n}/${tot} samples = ${(100 * n / tot).toFixed(2)}%  maxdelta=${mx}  meandelta=${n ? (sum / n).toFixed(1) : 0}`);
if (n) console.log(`  bbox x ${x0}..${x1}  y ${y0}..${y1}`);
