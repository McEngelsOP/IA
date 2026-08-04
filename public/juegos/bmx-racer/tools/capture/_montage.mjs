/**
 * Tile a crop region out of many PNGs into one contact sheet.
 *   node tools/capture/_montage.mjs out.png cols cellW x y w h  in1.png in2.png ...
 */
import { chromium } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const [, , outPath, colsS, cellWS, xs, ys, ws, hs, ...ins] = process.argv;
const cols = Number(colsS), cellW = Number(cellWS);
const x = Number(xs), y = Number(ys), w = Number(ws), h = Number(hs);
const cellH = Math.round((cellW * h) / w);

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setViewportSize({ width: cellW, height: cellH });

const cells = [];
for (const f of ins) {
  const b64 = (await readFile(f)).toString('base64');
  const src = await page.evaluate(
    async ({ b64, x, y, w, h, cw, ch }) => {
      const img = new Image();
      img.src = 'data:image/png;base64,' + b64;
      await img.decode();
      const cv = document.createElement('canvas');
      cv.width = cw; cv.height = ch;
      const g = cv.getContext('2d');
      g.imageSmoothingEnabled = true;
      g.imageSmoothingQuality = 'high';
      g.drawImage(img, x, y, w, h, 0, 0, cw, ch);
      return cv.toDataURL('image/jpeg', 0.9);
    },
    { b64, x, y, w, h, cw: cellW, ch: cellH },
  );
  cells.push({ src, label: path.basename(f, '.png') });
}

const rows = Math.ceil(cells.length / cols);
const LAB = 18;
await page.setViewportSize({ width: cols * cellW, height: rows * (cellH + LAB) });
await page.setContent(`
<style>body{margin:0;background:#111;font:600 11px/1 monospace;color:#f2d69b}
.g{display:grid;grid-template-columns:repeat(${cols},${cellW}px)}
img{display:block;width:${cellW}px;height:${cellH}px}
div.l{height:${LAB}px;line-height:${LAB}px;padding-left:4px}</style>
<div class="g">${cells.map((c) => `<div><img src="${c.src}"><div class="l">${c.label}</div></div>`).join('')}</div>`);
await page.screenshot({ path: outPath, fullPage: true });
await browser.close();
console.log('wrote', outPath, cols * cellW, 'x', rows * (cellH + LAB));
