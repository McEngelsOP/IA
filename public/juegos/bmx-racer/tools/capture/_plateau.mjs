/**
 * Plateau probe — the critic's own measurement, run as a number.
 *
 *   node tools/capture/_plateau.mjs <png> col <x> <y0> <y1> [minStep]
 *   node tools/capture/_plateau.mjs <png> row <y> <x0> <x1> [minStep]
 *
 * Walks EVERY pixel along the line (no stride, no box blur — a box blur turns
 * a hard step into a ramp, which is the thing under test), then reports:
 *   - the number of distinct quantised values seen
 *   - every adjacent-sample jump of at least minStep levels, with its position
 *   - the plateau run lengths between those jumps
 *
 * A 5px median is applied ACROSS the line (perpendicular) only, so a single
 * ink stroke or a hatch pixel does not register as a plateau boundary while a
 * genuine horizontal terrace still steps in one row.
 */
import { readPng } from './_pngread.mjs';

const [, , file, mode, aS, b0S, b1S, minStepS] = process.argv;
const a = Number(aS), b0 = Number(b0S), b1 = Number(b1S);
const minStep = Number(minStepS ?? 4);

const img = readPng(file);
const { width: W, height: H, channels: CH, data } = img;
const px = (x, y) => {
  const i = (Math.min(H - 1, Math.max(0, y)) * W + Math.min(W - 1, Math.max(0, x))) * CH;
  return [data[i], data[i + 1], data[i + 2]];
};

// Median of 5 samples taken PERPENDICULAR to the scan direction.
function sampleAt(t) {
  const rs = [], gs = [], bs = [];
  for (let k = -2; k <= 2; k++) {
    const [r, g, bl] = mode === 'col' ? px(a + k, t) : px(t, a + k);
    rs.push(r); gs.push(g); bs.push(bl);
  }
  const med = (v) => v.sort((p, q) => p - q)[2];
  return [med(rs), med(gs), med(bs)];
}

const vals = [];
for (let t = b0; t <= b1; t++) vals.push([t, ...sampleAt(t)]);

const lum = (v) => 0.299 * v[1] + 0.587 * v[2] + 0.114 * v[3];

if (process.env.DUMP) {
  for (const v of vals) console.log(`  ${String(v[0]).padStart(5)}  ${String(v[1]).padStart(4)} ${String(v[2]).padStart(4)} ${String(v[3]).padStart(4)}   luma ${(0.299 * v[1] + 0.587 * v[2] + 0.114 * v[3]).toFixed(1)}`);
}

const distinct = new Set(vals.map((v) => `${v[1]},${v[2]},${v[3]}`));
console.log(`${file}  ${mode} ${a}  ${b0}..${b1}   n=${vals.length}  distinct RGB triples=${distinct.size}`);

// ── PLATEAU SEGMENTATION ─────────────────────────────────────────────────────
// The critic's own vocabulary: a plateau is a run that holds its value, and a
// boundary is the short transition between two of them. Counting only
// adjacent-sample jumps misses a real terrace whose edge is antialiased across
// four rows — the jump is there, it is just spread — so the run is segmented
// first and the boundaries are measured between the plateaus, not within them.
const FLAT = 1.6;        // luma levels a plateau may wander over its length
const MAXEDGE = 10;      // samples a boundary may take and still be a boundary
const plateaus = [];
{
  let i = 0;
  while (i < vals.length) {
    let j = i;
    let lo = lum(vals[i]), hi = lo;
    while (j + 1 < vals.length) {
      const v = lum(vals[j + 1]);
      if (Math.max(hi, v) - Math.min(lo, v) > FLAT) break;
      lo = Math.min(lo, v); hi = Math.max(hi, v); j++;
    }
    plateaus.push({ from: vals[i][0], to: vals[j][0], len: j - i + 1, val: (lo + hi) / 2,
                    rgb: vals[Math.floor((i + j) / 2)].slice(1).join(',') });
    i = j + 1;
  }
}
const kept = plateaus.filter((p) => p.len >= 6);
console.log(`plateaus (>= 6 samples, holding within ${FLAT} luma): ${kept.length}`);
let prev = null;
let boundaries = 0;
for (const p of kept) {
  let note = '';
  if (prev) {
    const gap = p.from - prev.to;
    const jump = Math.abs(p.val - prev.val);
    if (gap <= MAXEDGE && jump >= minStep) { note = `   <== BOUNDARY  ${jump.toFixed(1)} levels over ${gap} rows`; boundaries++; }
    else if (jump >= minStep) note = `   (drift ${jump.toFixed(1)} over ${gap} rows — not a boundary)`;
  }
  console.log(`   ${String(p.from).padStart(5)}..${String(p.to).padStart(5)}  len ${String(p.len).padStart(4)}  luma ${p.val.toFixed(1).padStart(6)}  (${p.rgb})${note}`);
  prev = p;
}
console.log(`hard boundaries (>= ${minStep} levels across <= ${MAXEDGE} rows, between plateaus of >= 6): ${boundaries}`);

// Total drift and the largest single jump, so a "smooth drift" can be told
// apart from a terrace with the same endpoints.
let maxJump = 0;
for (let i = 1; i < vals.length; i++) maxJump = Math.max(maxJump, Math.abs(lum(vals[i]) - lum(vals[i - 1])));
console.log(`luma ${lum(vals[0]).toFixed(1)} -> ${lum(vals[vals.length - 1]).toFixed(1)}   drift ${(lum(vals[vals.length - 1]) - lum(vals[0])).toFixed(1)}   largest single-sample jump ${maxJump.toFixed(1)}`);

// Alternation test for the scanline moire: how often the sign of the delta
// flips between consecutive samples. A clean surface flips rarely; a one-pixel
// checkerboard flips on nearly every row.
let flips = 0, nz = 0;
let prevSign = 0;
for (let i = 1; i < vals.length; i++) {
  const d = lum(vals[i]) - lum(vals[i - 1]);
  if (Math.abs(d) < 0.4) continue;
  nz++;
  const s = Math.sign(d);
  if (prevSign !== 0 && s !== prevSign) flips++;
  prevSign = s;
}
console.log(`alternation: ${flips} sign flips over ${nz} non-flat deltas (${((flips / Math.max(nz, 1)) * 100).toFixed(0)}%)`);
