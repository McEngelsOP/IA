/** Minimal PNG writer (8-bit RGB) + crop/scale helper for capture probes. */
import { writeFileSync } from 'node:fs';
import zlib from 'node:zlib';
import { readPng } from './_pngread.mjs';

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

export function writePng(file, width, height, rgb) {
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgb.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  writeFileSync(file, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ]));
}

/** node _pngwrite.mjs <in> <out> [x y w h] [outW] */
if (process.argv[1] && process.argv[1].endsWith('_pngwrite.mjs')) {
  const [, , inf, outf, xs, ys, ws, hs, ows] = process.argv;
  const img = readPng(inf);
  const x0 = Number(xs ?? 0), y0 = Number(ys ?? 0);
  const cw = Number(ws ?? img.width), chh = Number(hs ?? img.height);
  const ow = Number(ows ?? cw);
  const oh = Math.max(1, Math.round((chh * ow) / cw));
  const out = Buffer.alloc(ow * oh * 3);
  const sx = cw / ow, sy = chh / oh;
  for (let y = 0; y < oh; y++) {
    for (let x = 0; x < ow; x++) {
      // Box filter so downscales stay honest about high-frequency content.
      let r = 0, g = 0, b = 0, n = 0;
      const ax = Math.floor(x * sx), bx = Math.max(ax + 1, Math.floor((x + 1) * sx));
      const ay = Math.floor(y * sy), by = Math.max(ay + 1, Math.floor((y + 1) * sy));
      for (let j = ay; j < by; j++) {
        for (let i = ax; i < bx; i++) {
          const px = Math.min(img.width - 1, x0 + i), py = Math.min(img.height - 1, y0 + j);
          const k = (py * img.width + px) * img.channels;
          r += img.data[k]; g += img.data[k + 1]; b += img.data[k + 2]; n++;
        }
      }
      const k = (y * ow + x) * 3;
      out[k] = r / n; out[k + 1] = g / n; out[k + 2] = b / n;
    }
  }
  writePng(outf, ow, oh, out);
  console.log(`${outf} ${ow}x${oh} from ${inf} crop(${x0},${y0},${cw},${chh})`);
}
