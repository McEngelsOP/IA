/**
 * Throwaway probe: prove (or disprove) that a column of pixels contains HARD
 * value steps and flat plateaus rather than a smooth drift.
 *
 *   node tools/capture/_bands.mjs <png> <x> <y0> <y1> [minStep]
 *
 * Prints:
 *   - a run-length encoding of the column's luma, collapsing runs that stay
 *     inside a +-1 level dead band (that is a "plateau")
 *   - every adjacent-row jump >= minStep (default 4 levels) as a "boundary"
 *   - the distinct-value count, which is the number the critic quoted
 */
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';

const [, , inPath, xS, y0S, y1S, minStepS] = process.argv;
const x = Number(xS);
const y0 = Number(y0S);
const y1 = Number(y1S);
const MIN_STEP = Number(minStepS ?? 4);

const b64 = (await readFile(inPath)).toString('base64');
const browser = await chromium.launch();
const page = await browser.newPage();
const col = await page.evaluate(
  async ({ b64, x, y0, y1 }) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + b64;
    await img.decode();
    const cv = document.createElement('canvas');
    cv.width = img.width;
    cv.height = img.height;
    const g = cv.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0);
    const d = g.getImageData(x, y0, 1, y1 - y0 + 1).data;
    const out = [];
    for (let i = 0; i < d.length; i += 4) out.push([d[i], d[i + 1], d[i + 2]]);
    return { out, w: img.width, h: img.height };
  },
  { b64, x, y0, y1 },
);
await browser.close();

const px = col.out;
console.log(`image ${col.w}x${col.h}  column x=${x}  rows ${y0}..${y1} (${px.length})`);

const lum = px.map(([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b);

// ── Distinct values ────────────────────────────────────────────────────────
const distinct = new Set(px.map((p) => p.join(','))).size;
const distinctL = new Set(lum.map((v) => Math.round(v))).size;

// ── Per-row deltas ─────────────────────────────────────────────────────────
const steps = [];
for (let i = 1; i < lum.length; i++) {
  const dv = lum[i] - lum[i - 1];
  if (Math.abs(dv) >= MIN_STEP) steps.push([y0 + i, dv.toFixed(1), px[i - 1].join(','), px[i].join(',')]);
}

// ── Alternation test (defect 2: 1px scanline moire) ────────────────────────
let flips = 0;
for (let i = 2; i < lum.length; i++) {
  const a = lum[i - 1] - lum[i - 2];
  const b = lum[i] - lum[i - 1];
  if (a * b < 0 && Math.abs(a) >= 1.0 && Math.abs(b) >= 1.0) flips++;
}

// ── Plateaus: maximal runs inside a +-1.5 level dead band ───────────────────
const plateaus = [];
let s = 0;
let lo = lum[0];
let hi = lum[0];
for (let i = 1; i <= lum.length; i++) {
  const v = lum[i];
  const nlo = Math.min(lo, v);
  const nhi = Math.max(hi, v);
  if (i === lum.length || nhi - nlo > 3.0) {
    plateaus.push([y0 + s, y0 + i - 1, i - s, ((lo + hi) / 2).toFixed(1)]);
    s = i;
    lo = v;
    hi = v;
  } else {
    lo = nlo;
    hi = nhi;
  }
}
const big = plateaus.filter((p) => p[2] >= 8);

console.log(`distinct rgb triples : ${distinct}`);
console.log(`distinct luma levels : ${distinctL}`);
console.log(`luma range           : ${Math.min(...lum).toFixed(1)} .. ${Math.max(...lum).toFixed(1)}`);
console.log(`sign flips >=1.0     : ${flips}  (${((flips / lum.length) * 100).toFixed(0)}% of rows -> moire if high)`);
console.log(`\nhard steps >= ${MIN_STEP} levels: ${steps.length}`);
for (const [y, dv, a, b] of steps) console.log(`   y=${y}  d=${dv}   ${a}  ->  ${b}`);
console.log(`\nplateaus >= 8 rows (band-limited +-1.5): ${big.length}`);
for (const [a, b, n, v] of big) console.log(`   y=${a}..${b}  ${n} rows  luma~${v}`);
