/**
 * _bandtrace.mjs — trace the cream/orange horizon boundary specifically, by
 * colour identity rather than by "biggest step", so clouds and terrain cannot
 * capture the tracer.
 *
 * For every column it finds the LAST row in the window whose colour is within
 * tol of the upper plateau colour and whose row+span is within tol of the lower
 * plateau colour. Columns where the pair does not occur are reported as breaks
 * — a boundary interrupted by cloud or terrain is exactly what we want.
 *
 * node tools/capture/_bandtrace.mjs <png> <yLo> <yHi> <#upper> <#lower> [tol]
 */
import { readPng, px } from './_pngread.mjs';

const [, , file, loS, hiS, upS, dnS, tolS] = process.argv;
const img = readPng(file);
const lo = Number(loS), hi = Number(hiS), tol = Number(tolS ?? 10);
const parse = (s) => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16));
const UP = parse(upS), DN = parse(dnS);
const near = (c, t) => Math.abs(c[0] - t[0]) <= tol && Math.abs(c[1] - t[1]) <= tol && Math.abs(c[2] - t[2]) <= tol;

const ys = [];
let breaks = 0;
for (let x = 0; x < img.width; x++) {
  let found = -1;
  for (let y = lo; y <= hi; y++) {
    if (near(px(img, x, y), UP) && near(px(img, x, y + 8), DN)) { found = y; break; }
  }
  if (found < 0) breaks++; else ys.push([x, found]);
}
if (!ys.length) { console.log(`${file}: boundary NOT FOUND anywhere in y=${lo}..${hi}`); process.exit(0); }
const v = ys.map((p) => p[1]);
const mean = v.reduce((s, a) => s + a, 0) / v.length;
const sd = Math.sqrt(v.reduce((s, a) => s + (a - mean) ** 2, 0) / v.length);
console.log(`${file}  ${img.width}x${img.height}`);
console.log(`  boundary ${upS} -> ${dnS} present in ${ys.length}/${img.width} columns (${breaks} broken)`);
console.log(`  y mean ${mean.toFixed(1)}  sd ${sd.toFixed(2)} rows  min ${Math.min(...v)}  max ${Math.max(...v)}  range ${Math.max(...v) - Math.min(...v)}`);
const s = [];
for (let i = 0; i < ys.length; i += Math.max(1, Math.floor(ys.length / 24))) s.push(`${ys[i][0]}:${ys[i][1]}`);
console.log(`  samples ${s.join(' ')}`);
