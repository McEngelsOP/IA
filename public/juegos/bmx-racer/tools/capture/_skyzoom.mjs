/**
 * Throwaway: magnify a rectangle of a PNG so a seam can be judged at pixel level.
 * usage: node tools/capture/_skyzoom.mjs <file> <x> <y> <w> <h> [scale]
 */
import { chromium } from 'playwright';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const [file, x, y, w, h, scaleArg] = process.argv.slice(2);
const scale = Number(scaleArg ?? 4);
const buf = await readFile(path.resolve(file));
const b64 = buf.toString('base64');
const OUT = path.resolve('tools/capture/_out');
await mkdir(OUT, { recursive: true });

const W = Math.round(Number(w) * scale);
const H = Math.round(Number(h) * scale);

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: W, height: H } });
await page.setContent(`<body style="margin:0"><canvas id="c"></canvas><script>
window.done = new Promise((res) => {
  const img = new Image();
  img.onload = () => {
    const c = document.getElementById('c');
    c.width = ${W}; c.height = ${H};
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.drawImage(img, ${x}, ${y}, ${w}, ${h}, 0, 0, c.width, c.height);
    res(true);
  };
  img.src = 'data:image/png;base64,${b64}';
});
</script></body>`);
await page.waitForFunction(() => window.done);
const out = path.join(OUT, `zoom-${path.basename(file)}`);
await page.screenshot({ path: out });
console.log('  ok', out);
await browser.close();
