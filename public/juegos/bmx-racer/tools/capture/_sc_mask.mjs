/**
 * Throwaway: where do two shots differ, and how dark is what only the first
 * one draws? Writes a mask (differing pixels kept, the rest greyed) and prints
 * a luminance histogram of the differing pixels from image A.
 *
 *   node tools/capture/_sc_mask.mjs a.png b.png out.png [x y w h]
 */
import { PNG } from 'pngjs';
import { readFileSync, writeFileSync } from 'node:fs';

const [, , aPath, bPath, outPath, xs, ys, ws, hs] = process.argv;
const A = PNG.sync.read(readFileSync(aPath));
const B = PNG.sync.read(readFileSync(bPath));
const x0 = Number(xs ?? 0), y0 = Number(ys ?? 0);
const w = Number(ws ?? A.width), h = Number(hs ?? A.height);

const out = new PNG({ width: w, height: h });
let n = 0;
const hist = new Array(8).fill(0);
let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
for (let y = 0; y < h; y++) {
  for (let x = 0; x < w; x++) {
    const si = ((y + y0) * A.width + (x + x0)) * 4;
    const di = (y * w + x) * 4;
    const d = Math.abs(A.data[si] - B.data[si]) + Math.abs(A.data[si + 1] - B.data[si + 1]) + Math.abs(A.data[si + 2] - B.data[si + 2]);
    if (d > 14) {
      out.data[di] = A.data[si];
      out.data[di + 1] = A.data[si + 1];
      out.data[di + 2] = A.data[si + 2];
      n++;
      const lum = 0.2126 * A.data[si] + 0.7152 * A.data[si + 1] + 0.0722 * A.data[si + 2];
      hist[Math.min(7, Math.floor(lum / 32))]++;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    } else {
      out.data[di] = out.data[di + 1] = out.data[di + 2] = 30;
    }
    out.data[di + 3] = 255;
  }
}
writeFileSync(outPath, PNG.sync.write(out));
console.log(`differing px: ${n} (${((n / (w * h)) * 100).toFixed(2)}%)  bbox x${minX + x0}-${maxX + x0} y${minY + y0}-${maxY + y0}`);
console.log('luminance histogram (0-31,32-63,...):', hist.join(' '));
