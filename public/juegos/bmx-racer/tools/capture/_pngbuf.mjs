/** PNG decode from a Buffer (the file-based reader in _pngread.mjs takes a path). */
import zlib from 'node:zlib';
export function readPngBuf(buf) {
  let off = 8, w = 0, h = 0, bitDepth = 0, colorType = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); bitDepth = data[8]; colorType = data[9]; }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (bitDepth !== 8) throw new Error(`bit depth ${bitDepth}`);
  const ch = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  if (!ch) throw new Error(`color type ${colorType}`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const out = Buffer.alloc(h * stride);
  let p = 0;
  for (let y = 0; y < h; y++) {
    const filter = raw[p++];
    const line = raw.subarray(p, p + stride); p += stride;
    const cur = out.subarray(y * stride, y * stride + stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, (y - 1) * stride + stride) : null;
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? cur[i - ch] : 0;
      const b2 = prev ? prev[i] : 0;
      const c2 = prev && i >= ch ? prev[i - ch] : 0;
      const x = line[i];
      let v;
      switch (filter) {
        case 0: v = x; break;
        case 1: v = x + a; break;
        case 2: v = x + b2; break;
        case 3: v = x + ((a + b2) >> 1); break;
        case 4: {
          const pp = a + b2 - c2, pa = Math.abs(pp - a), pb = Math.abs(pp - b2), pc = Math.abs(pp - c2);
          v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b2 : c2); break;
        }
        default: throw new Error(`filter ${filter}`);
      }
      cur[i] = v & 255;
    }
  }
  return { width: w, height: h, channels: ch, data: out };
}
