/**
 * _cols.mjs — the plateau probe, run over MANY columns at once, as a table.
 *
 * The whole point of this file is the defect it exists to catch: a banding fix
 * that lands on the one column that was measured and nowhere else. One column
 * is an anecdote. This runs a fixed battery across several frames and several
 * surface types and prints one row each, so "did it generalise" is a column of
 * numbers rather than a claim.
 *
 *   node tools/capture/_cols.mjs <dir> [minStep]
 *
 * The battery is defined below as [pose, x, y0, y1, label]. Two groups:
 * TUNED (the columns a fix was aimed at) and HELD OUT (columns never tuned
 * against). A fix is only real if the held-out group moves too.
 *
 * Reported per column, all in luma levels of 255:
 *   plat   plateaus of >= 6 rows holding within 1.6 luma
 *   bnd    boundaries: jumps >= minStep between two such plateaus
 *   long   longest single plateau, in rows
 *   max    largest single-row jump
 *   span   luma at the top row -> luma at the bottom row
 */
import { readPng } from './_pngread.mjs';
import path from 'node:path';

const dir = process.argv[2] ?? 'captures/_ts0/stills';
const minStep = Number(process.argv[3] ?? 6);

// [pose, x, y0, y1, label, heldOut]
export const BATTERY = [
  // ── The two columns the previous round tuned against ─────────────────────
  ['treeline-silhouette', 1100, 977, 1400, 'near dune / foreground flat', false],
  ['summit-rider', 1600, 1000, 1500, 'trail + verge, chase cam', false],
  // ── HELD OUT: never tuned against ────────────────────────────────────────
  ['rockgarden-low', 2400, 1150, 1500, 'broken rock, low cam', true],
  ['crash', 2400, 1250, 1500, 'ground at impact height', true],
  ['valley-vista', 700, 1150, 1500, 'snow field, wide', true],
  ['scree-speed', 1200, 1000, 1450, 'scree run', true],
  ['ridge-exposure', 2000, 1050, 1500, 'ridge flank', true],
  ['switchback-lean', 900, 1100, 1500, 'dirt, banked corner', true],
  ['summit-wide', 1600, 700, 1150, 'canyon wall / mid distance', true],
  ['finish-sprint', 800, 1000, 1450, 'final approach flat', true],
];

const lum = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;

export function scanColumn(file, x, y0, y1, minStepArg = minStep) {
  const img = readPng(file);
  const { width: W, height: H, channels: CH, data } = img;
  const px = (px_, py) => {
    const i =
      (Math.min(H - 1, Math.max(0, py)) * W + Math.min(W - 1, Math.max(0, px_))) * CH;
    return [data[i], data[i + 1], data[i + 2]];
  };
  // 5px median PERPENDICULAR to the scan, so one ink stroke is not a boundary.
  const sample = (y) => {
    const rs = [], gs = [], bs = [];
    for (let k = -2; k <= 2; k++) {
      const [r, g, b] = px(x + k, y);
      rs.push(r); gs.push(g); bs.push(b);
    }
    const med = (v) => v.sort((p, q) => p - q)[2];
    return lum(med(rs), med(gs), med(bs));
  };

  const vals = [];
  for (let y = y0; y <= y1; y++) vals.push(sample(y));

  const FLAT = 1.6;
  const MAXEDGE = 10;
  const plateaus = [];
  let i = 0;
  while (i < vals.length) {
    let j = i, lo = vals[i], hi = lo;
    while (j + 1 < vals.length) {
      const v = vals[j + 1];
      if (Math.max(hi, v) - Math.min(lo, v) > FLAT) break;
      lo = Math.min(lo, v); hi = Math.max(hi, v); j++;
    }
    plateaus.push({ from: y0 + i, to: y0 + j, len: j - i + 1, val: (lo + hi) / 2 });
    i = j + 1;
  }
  const kept = plateaus.filter((p) => p.len >= 6);
  let boundaries = 0, prev = null;
  const bnds = [];
  for (const p of kept) {
    if (prev) {
      const gap = p.from - prev.to;
      const jump = Math.abs(p.val - prev.val);
      if (gap <= MAXEDGE && jump >= minStepArg) { boundaries++; bnds.push({ y: p.from, jump }); }
    }
    prev = p;
  }
  let maxJump = 0;
  for (let k = 1; k < vals.length; k++) maxJump = Math.max(maxJump, Math.abs(vals[k] - vals[k - 1]));
  const longest = kept.reduce((m, p) => Math.max(m, p.len), 0);
  const distinct = new Set(vals.map((v) => v.toFixed(1))).size;
  return {
    n: vals.length, plateaus: kept.length, boundaries, longest, maxJump,
    lo: Math.min(...vals), hi: Math.max(...vals), first: vals[0], last: vals[vals.length - 1],
    distinct, bnds,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(`battery over ${dir}   minStep=${minStep} luma levels\n`);
  console.log(
    'pose                  x     rows   plat  bnd  long   max   luma range      note',
  );
  console.log('-'.repeat(104));
  let held = false;
  for (const [pose, x, y0, y1, label, heldOut] of BATTERY) {
    if (heldOut && !held) { console.log('  ── held out ' + '─'.repeat(88)); held = true; }
    const f = path.join(dir, `${pose}.png`);
    let r;
    try { r = scanColumn(f, x, y0, y1); } catch (e) { console.log(`${pose.padEnd(22)} MISSING`); continue; }
    const flag = r.boundaries === 0 ? '  ✗' : r.boundaries < 3 ? '  ~' : '  ✓';
    console.log(
      `${pose.padEnd(21)} ${String(x).padStart(5)} ${String(r.n).padStart(6)} ` +
      `${String(r.plateaus).padStart(6)} ${String(r.boundaries).padStart(4)} ` +
      `${String(r.longest).padStart(5)} ${r.maxJump.toFixed(1).padStart(6)}  ` +
      `${r.lo.toFixed(0).padStart(3)}..${r.hi.toFixed(0).padEnd(3)}${flag}   ${label}`,
    );
  }
}
