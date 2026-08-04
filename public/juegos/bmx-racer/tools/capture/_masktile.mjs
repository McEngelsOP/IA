/**
 * _masktile.mjs — does celCloudMask actually tile?
 *
 * Imports the real module through the vite dev server (so it is the SAME code
 * the game runs), reads the generated canvas back, and measures the wrap
 * discontinuity: |row 0 - row N-1| and |col 0 - col N-1| against the typical
 * neighbour difference inside the tile. If the texture tiles, the wrap
 * difference is the same size as an ordinary neighbour difference. If it does
 * not, it is an order of magnitude larger.
 *
 * Usage: node tools/capture/_masktile.mjs [url]
 */
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://127.0.0.1:5176';
const browser = await chromium.launch();
const page = await browser.newPage();
page.on('console', (m) => { if (m.type() === 'error') console.log('  [err]', m.text()); });
await page.goto(`${url}/?capture=1`, { waitUntil: 'domcontentloaded' });

const result = await page.evaluate(async () => {
  const mod = await import('/src/npr/GeneratedTextures.ts');
  const out = {};
  for (const [name, cov] of [['clouds-near', 0.40], ['clouds-far', 0.46]]) {
    const tex = mod.celCloudMask(512, name, cov);
    const cv = tex.image;
    const ctx = cv.getContext('2d');
    const n = cv.width;
    const d = ctx.getImageData(0, 0, n, n).data;
    const A = (x, y) => d[((y % n) * n + (x % n)) * 4 + 3];

    let wrapX = 0, wrapY = 0, innerX = 0, innerY = 0;
    for (let i = 0; i < n; i++) {
      wrapX += Math.abs(A(n - 1, i) - A(0, i));
      wrapY += Math.abs(A(i, n - 1) - A(i, 0));
      innerX += Math.abs(A((n >> 1) - 1, i) - A(n >> 1, i));
      innerY += Math.abs(A(i, (n >> 1) - 1) - A(i, n >> 1));
    }
    out[name] = {
      wrapSeamX: +(wrapX / n).toFixed(2),
      wrapSeamY: +(wrapY / n).toFixed(2),
      innerX: +(innerX / n).toFixed(2),
      innerY: +(innerY / n).toFixed(2),
    };
  }
  return out;
});

console.log(JSON.stringify(result, null, 2));
await browser.close();
