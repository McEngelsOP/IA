/**
 * _horizonprobe.mjs — numeric test for "is there a dead-straight full-width
 * horizontal band across the horizon".
 *
 * The decisive measurement is EDGE COINCIDENCE PER ROW: for every row in the
 * sky region, the fraction of columns at which the colour steps by more than a
 * threshold between y-2 and y+2. A screen-space letterbox bar is a row where
 * essentially EVERY column steps at once — that is what "perfectly level
 * across all 3200 px" means, expressed as a number. A dome feature that
 * wanders, or one broken by cloud contours and terrain, never gets near it.
 *
 * Also reported:
 *   - the longest run of consecutive rows that are themselves near-uniform
 *     across the full frame width (an empty plateau);
 *   - the per-column position of the strongest step, and its spread.
 *
 * Usage: node tools/capture/_horizonprobe.mjs <png> [column] [x0] [x1]
 */
import { readPng, px, hex } from './_pngread.mjs';

const file = process.argv[2] ?? 'captures/stills/treeline-silhouette.png';
const col = Number(process.argv[3] ?? 2200);
const img = readPng(file);
// HUD panels are opaque graphics and would swamp every statistic, so the sweep
// runs over the clear middle of the frame unless told otherwise.
const X0 = Number(process.argv[4] ?? 900);
const X1 = Number(process.argv[5] ?? 2300);
const skyTop = Math.floor(img.height * 0.06);
const skyBot = Math.floor(img.height * 0.46);

console.log(`${file}  ${img.width}x${img.height}`);
console.log(`sky window y=${skyTop}..${skyBot}, x=${X0}..${X1}`);

const d3 = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);

// ── 1. Edge coincidence per row ────────────────────────────────────────────
const T = 12;
let bestRow = -1, bestFrac = 0;
const rows = [];
for (let y = skyTop; y < skyBot; y++) {
  let n = 0, tot = 0;
  for (let x = X0; x <= X1; x += 2) {
    tot++;
    if (d3(px(img, x, y - 2), px(img, x, y + 2)) > T) n++;
  }
  const f = n / tot;
  rows.push([y, f]);
  if (f > bestFrac) { bestFrac = f; bestRow = y; }
}
const over = (t) => rows.filter((r) => r[1] >= t).length;
console.log(`\nEDGE COINCIDENCE (fraction of columns stepping at a given row):`);
console.log(`  peak            ${(bestFrac * 100).toFixed(1)}%  at y=${bestRow}`);
console.log(`  rows >= 90%     ${over(0.9)}`);
console.log(`  rows >= 70%     ${over(0.7)}`);
console.log(`  rows >= 50%     ${over(0.5)}`);
const top = rows.slice().sort((a, b) => b[1] - a[1]).slice(0, 6);
console.log(`  top rows        ${top.map((r) => `y=${r[0]}:${(r[1] * 100).toFixed(0)}%`).join('  ')}`);

// ── 2. Longest run of full-width-uniform rows (an empty plateau) ───────────
let run = 0, bestRun = 0, bestRunAt = -1;
for (let y = skyTop; y < skyBot; y++) {
  let mn = [255, 255, 255], mx = [0, 0, 0];
  for (let x = X0; x <= X1; x += 4) {
    const c = px(img, x, y);
    for (let k = 0; k < 3; k++) { if (c[k] < mn[k]) mn[k] = c[k]; if (c[k] > mx[k]) mx[k] = c[k]; }
  }
  const range = Math.max(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]);
  if (range <= 8) { run++; if (run > bestRun) { bestRun = run; bestRunAt = y; } } else run = 0;
}
console.log(`\nEMPTY PLATEAU (consecutive rows uniform to <= 8/255 across ${X1 - X0} px):`);
console.log(`  longest run ${bestRun} rows, ending y=${bestRunAt}`);

// ── 3. Where the strongest step sits, column by column ─────────────────────
const ys = [];
for (let x = X0; x <= X1; x += 20) {
  let best = -1, bestY = -1;
  for (let y = skyTop; y < skyBot; y++) {
    const v = d3(px(img, x, y - 2), px(img, x, y + 2));
    if (v > best) { best = v; bestY = y; }
  }
  ys.push(bestY);
}
const mean = ys.reduce((s, v) => s + v, 0) / ys.length;
const sd = Math.sqrt(ys.reduce((s, v) => s + (v - mean) ** 2, 0) / ys.length);
console.log(`\nSTRONGEST STEP PER COLUMN: min=${Math.min(...ys)} max=${Math.max(...ys)} spread=${Math.max(...ys) - Math.min(...ys)} sd=${sd.toFixed(1)}`);

// ── 4. Runs down one column, for eyeballing plateau heights ────────────────
const TOL = 2;
let runStart = 0, runCol = px(img, col, 0);
const runsC = [];
for (let y = 1; y <= img.height; y++) {
  const c = y < img.height ? px(img, col, y) : null;
  const same = c && Math.abs(c[0] - runCol[0]) <= TOL && Math.abs(c[1] - runCol[1]) <= TOL && Math.abs(c[2] - runCol[2]) <= TOL;
  if (!same) { runsC.push([runStart, y - 1, y - runStart, runCol]); runStart = y; runCol = c; }
}
const flat = runsC.filter((r) => r[2] >= 12 && r[0] < skyBot).sort((a, b) => b[2] - a[2]);
console.log(`\nCOLUMN x=${col}, flat runs >= 12 rows above y=${skyBot}:`);
for (const [a, b, n, c] of flat.slice(0, 8)) {
  console.log(`  y ${String(a).padStart(4)}..${String(b).padStart(4)}  ${String(n).padStart(4)} rows  ${hex(c)}`);
}
