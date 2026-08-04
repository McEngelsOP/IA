/**
 * Throwaway crop probe for the scatter/foliage work. Pure pngjs, no browser.
 *
 *   node tools/capture/_scatcrop.mjs in.png out.png x y w h [zoom]
 *
 * zoom is an integer nearest-neighbour magnification (default 1). A negative
 * zoom means "downsample by |zoom|" with a box filter.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';

const [, , inPath, outPath, xs, ys, ws, hs, zs] = process.argv;
const src = PNG.sync.read(readFileSync(inPath));
let x = Math.max(0, Number(xs) | 0);
let y = Math.max(0, Number(ys) | 0);
let w = Math.min(Number(ws) | 0, src.width - x);
let h = Math.min(Number(hs) | 0, src.height - y);
const z = Number(zs ?? 1) || 1;

let out;
if (z > 0) {
  out = new PNG({ width: w * z, height: h * z });
  for (let j = 0; j < h * z; j++) {
    for (let i = 0; i < w * z; i++) {
      const sx = x + ((i / z) | 0);
      const sy = y + ((j / z) | 0);
      const si = (sy * src.width + sx) * 4;
      const di = (j * w * z + i) * 4;
      out.data[di] = src.data[si];
      out.data[di + 1] = src.data[si + 1];
      out.data[di + 2] = src.data[si + 2];
      out.data[di + 3] = 255;
    }
  }
} else {
  const k = -z;
  const ow = Math.max(1, (w / k) | 0);
  const oh = Math.max(1, (h / k) | 0);
  out = new PNG({ width: ow, height: oh });
  for (let j = 0; j < oh; j++) {
    for (let i = 0; i < ow; i++) {
      let r = 0, g = 0, b = 0, n = 0;
      for (let dy = 0; dy < k; dy++) {
        for (let dx = 0; dx < k; dx++) {
          const sx = x + i * k + dx;
          const sy = y + j * k + dy;
          if (sx >= src.width || sy >= src.height) continue;
          const si = (sy * src.width + sx) * 4;
          r += src.data[si]; g += src.data[si + 1]; b += src.data[si + 2]; n++;
        }
      }
      const di = (j * ow + i) * 4;
      out.data[di] = r / n; out.data[di + 1] = g / n; out.data[di + 2] = b / n;
      out.data[di + 3] = 255;
    }
  }
}
writeFileSync(outPath, PNG.sync.write(out));
console.log('wrote', outPath, out.width, 'x', out.height);
