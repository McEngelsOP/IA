/**
 * _flashprobe.mjs — how long, and how hard, does the impact accent hit?
 *
 * The motion critic's complaint about the impact frames was not "too bright",
 * it was "the composition is gone": seven consecutive frames in which the sky,
 * the cloud shapes, the tree greens and the jersey colours had all been
 * flattened out. So the measurement is not peak luma. It is:
 *
 *   MEAN CHROMA   the average distance from grey, over the whole frame. If the
 *                 sky and the jerseys are still coloured this barely moves.
 *   COLOUR SPREAD the standard deviation of luma. If the picture has been
 *                 washed to one value, this collapses.
 *   SKY CHROMA    the same, measured only in the top strip of the frame, which
 *                 is the region the old flash deleted outright.
 *
 * A frame is flagged when it departs from the sequence median by more than the
 * given tolerance, and the report is the LENGTH OF THE RUN of flagged frames.
 * 1-2 frames is the convention; 7 is a hitch.
 *
 * Usage: node tools/capture/_flashprobe.mjs <dir-of-pngs>
 */
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { readPng } from './_pngread.mjs';

const dir = process.argv[2];
const files = readdirSync(dir).filter((f) => f.endsWith('.png')).sort();

const rows = [];
for (const f of files) {
  const img = readPng(path.join(dir, f));
  const step = 7;
  let chroma = 0, lum = 0, lum2 = 0, n = 0;
  let skyChroma = 0, skyLum = 0, sn = 0;
  const skyBot = Math.floor(img.height * 0.22);
  for (let y = 0; y < img.height; y += step) {
    for (let x = 0; x < img.width; x += step) {
      const i = (y * img.width + x) * img.channels;
      const r = img.data[i], g = img.data[i + 1], b = img.data[i + 2];
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      const c = mx - mn;
      const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      chroma += c; lum += l; lum2 += l * l; n++;
      if (y < skyBot) { skyChroma += c; skyLum += l; sn++; }
    }
  }
  const mean = lum / n;
  rows.push({
    f,
    chroma: chroma / n,
    lum: mean,
    sd: Math.sqrt(Math.max(0, lum2 / n - mean * mean)),
    skyChroma: skyChroma / sn,
    skyLum: skyLum / sn,
  });
}

const med = (k) => {
  const v = rows.map((r) => r[k]).sort((a, b) => a - b);
  return v[Math.floor(v.length / 2)];
};
const mC = med('chroma'), mL = med('lum'), mS = med('sd'), mSC = med('skyChroma');

console.log(`${files.length} frames from ${dir}`);
console.log(`medians: chroma ${mC.toFixed(1)}  luma ${mL.toFixed(1)}  lumaSD ${mS.toFixed(1)}  skyChroma ${mSC.toFixed(1)}`);

// A frame is "washed" if it has lost 12% of its chroma or 12% of its luma
// spread, or gained 8% of luma. Any of the three is a visible departure.
// Camera motion alone moves skyChroma by 30% in a 2 s shot, so it is reported
// but never used as a trigger; the trigger is whole-frame chroma, whole-frame
// luma and the luma spread, all three of which a real wash destroys at once.
const flag = (r) =>
  r.chroma < mC * 0.88 || r.sd < mS * 0.88 || r.lum > mL * 1.05 || r.lum < mL * 0.92;

let run = 0, best = 0, bestAt = '';
const hits = [];
for (const r of rows) {
  if (flag(r)) {
    run++;
    hits.push(r);
    if (run > best) { best = run; bestAt = r.f; }
  } else run = 0;
}
console.log(`\nflagged frames: ${hits.length}   longest consecutive run: ${best} (ending ${bestAt})`);
const rank = rows.slice().sort((a, b) => Math.abs(b.lum - mL) - Math.abs(a.lum - mL)).slice(0, 5);
console.log(`largest luma departures: ${rank.map((r) => `${r.f}:${((r.lum / mL - 1) * 100).toFixed(1)}%`).join('  ')}`);
for (const r of hits) {
  console.log(
    `  ${r.f}  chroma ${r.chroma.toFixed(1)} (${((r.chroma / mC - 1) * 100).toFixed(0)}%)` +
    `  luma ${r.lum.toFixed(1)} (${((r.lum / mL - 1) * 100).toFixed(0)}%)` +
    `  lumaSD ${r.sd.toFixed(1)} (${((r.sd / mS - 1) * 100).toFixed(0)}%)` +
    `  skyChroma ${r.skyChroma.toFixed(1)} (${((r.skyChroma / mSC - 1) * 100).toFixed(0)}%)`,
  );
}
