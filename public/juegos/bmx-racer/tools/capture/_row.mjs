import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
const [f, ys, x0s, x1s] = process.argv.slice(2);
const b = await chromium.launch(); const p = await b.newPage(); await p.setContent('<body></body>');
const b64 = (await readFile(f)).toString('base64');
const row = await p.evaluate(async ([src, y, x0, x1]) => {
  const img = new Image(); img.src = src; await img.decode();
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
  const g = c.getContext('2d'); g.drawImage(img, 0, 0);
  const d = g.getImageData(x0, y, x1 - x0, 1).data; const out = [];
  for (let i = 0; i < d.length; i += 4) out.push(Math.round(0.2126*d[i]+0.7152*d[i+1]+0.0722*d[i+2]));
  return { w: img.width, h: img.height, out };
}, [`data:image/png;base64,${b64}`, Number(ys), Number(x0s), Number(x1s)]);
console.log(f, `${row.w}x${row.h}`, 'y=' + ys); console.log(row.out.join(' '));
await b.close();
