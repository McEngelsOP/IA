/** Print a luma scanline across a crop, to tell a banded shape from a gradient. */
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
const files = process.argv.slice(2, -1);
const [ys] = process.argv.slice(-1);
const y = Number(ys);
const b = await chromium.launch();
const p = await b.newPage();
await p.setContent('<body></body>');
for (const f of files) {
  const b64 = (await readFile(f)).toString('base64');
  const row = await p.evaluate(async ([src, yy]) => {
    const img = new Image(); img.src = src; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    const d = g.getImageData(0, yy, img.width, 1).data;
    const out = [];
    for (let i = 0; i < d.length; i += 4) out.push(Math.round(0.2126*d[i]+0.7152*d[i+1]+0.0722*d[i+2]));
    return out;
  }, [`data:image/png;base64,${b64}`, y]);
  console.log(f.split('/').pop().padEnd(18), row.slice(60, 200).join(' '));
}
await b.close();
