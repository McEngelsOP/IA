/**
 * _stipple.mjs — isolated-pixel fraction over a rectangle.
 *
 * A cel frame is made of plateaus. The one measurement that separates "a drawn
 * mark" from "noise" is how many pixels agree with NOBODY around them: a stroke
 * a painter made is at least two pixels wide somewhere along its length, so its
 * pixels always have an ally. A dither, a per-pixel band flip or an aliased
 * hairline does not.
 *
 * A pixel counts as ISOLATED when its luma differs from the median of its eight
 * neighbours by more than `thr` levels AND not one of those eight is within
 * `thr/2` of it.
 *
 *   node tools/capture/_stipple.mjs <png> <x> <y> <w> <h> [thr]
 */
import { readPng } from './_pngread.mjs';

const [, , file, xS, yS, wS, hS, tS] = process.argv;
const X = Number(xS), Y = Number(yS), W_ = Number(wS), H_ = Number(hS);
const THR = Number(tS ?? 6);

const img = readPng(file);
const { width: W, height: H, channels: CH, data } = img;
const lum = (x, y) => {
  const i = (Math.min(H - 1, Math.max(0, y)) * W + Math.min(W - 1, Math.max(0, x))) * CH;
  return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
};

let iso = 0, n = 0;
for (let y = Y; y < Y + H_; y++) {
  for (let x = X; x < X + W_; x++) {
    const c = lum(x, y);
    const ns = [];
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) if (dx || dy) ns.push(lum(x + dx, y + dy));
    const sorted = ns.slice().sort((a, b) => a - b);
    const med = (sorted[3] + sorted[4]) / 2;
    let ally = false;
    for (const v of ns) if (Math.abs(v - c) <= THR / 2) { ally = true; break; }
    n++;
    if (Math.abs(c - med) > THR && !ally) iso++;
  }
}
console.log(
  `${file}  rect ${X},${Y} ${W_}x${H_}  thr=${THR}   isolated ${iso} / ${n} = ${((iso / n) * 100).toFixed(2)}%`,
);
