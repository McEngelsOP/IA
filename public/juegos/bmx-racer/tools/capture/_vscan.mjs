/** Print a row (or column) of RGB/luma from a PNG, with run-length of equal values. */
import { readPng } from './_pngread.mjs';
const [, , file, axis, at, from, to, step] = process.argv;
const img = readPng(file);
const A = axis ?? 'row';
const k = Number(at ?? Math.floor(img.height / 2));
const f = Number(from ?? 0);
const t = Number(to ?? (A === 'row' ? img.width : img.height));
const s = Number(step ?? 1);
const px = (x, y) => { const i = (y * img.width + x) * img.channels; return [img.data[i], img.data[i+1], img.data[i+2]]; };
let runs = [], prev = null, count = 0, start = f;
for (let i = f; i < t; i += s) {
  const c = A === 'row' ? px(i, k) : px(k, i);
  const key = c.join(',');
  if (key === prev) count++;
  else { if (prev !== null) runs.push([start, count, prev]); prev = key; count = 1; start = i; }
}
if (prev !== null) runs.push([start, count, prev]);
console.log(`${file} ${A}=${k} span ${f}..${t} → ${runs.length} distinct runs over ${Math.ceil((t-f)/s)} samples`);
for (const [x, n, c] of runs) {
  const [r, g, bl] = c.split(',').map(Number);
  const lum = Math.round(0.2126*r + 0.7152*g + 0.0722*bl);
  console.log(`  x=${String(x).padStart(4)} n=${String(n).padStart(4)}  rgb(${String(r).padStart(3)},${String(g).padStart(3)},${String(bl).padStart(3)})  lum ${String(lum).padStart(3)}`);
}
