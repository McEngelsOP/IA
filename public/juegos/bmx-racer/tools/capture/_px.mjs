import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
const [file, ...pts] = process.argv.slice(2);
const b64 = (await readFile(path.resolve(file))).toString('base64');
const b = await chromium.launch({ headless: true });
const p = await b.newPage();
await p.setContent('<body></body>');
const out = await p.evaluate(async ([src, coords]) => {
  const img = new Image();
  await new Promise((r) => { img.onload = r; img.src = src; });
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
  const g = c.getContext('2d'); g.drawImage(img, 0, 0);
  return coords.map((s) => {
    const [x, y] = s.split(',').map(Number);
    const d = g.getImageData(x, y, 1, 1).data;
    return `${x},${y} -> rgb(${d[0]},${d[1]},${d[2]})  chroma=${Math.max(d[0],d[1],d[2])-Math.min(d[0],d[1],d[2])}`;
  });
}, [`data:image/png;base64,${b64}`, pts]);
console.log(out.join('\n'));
await b.close();
