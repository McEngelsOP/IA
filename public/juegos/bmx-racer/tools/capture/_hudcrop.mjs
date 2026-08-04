/**
 * Throwaway batch cropper for HUD stills review.
 *
 *   node tools/capture/_hudcrop.mjs <spec.json>
 *
 * spec: [{ in, out, x, y, w, h, scale }, ...]  (source px, nearest-neighbour up)
 */
import { chromium } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';

const spec = JSON.parse(await readFile(process.argv[2], 'utf8'));
const browser = await chromium.launch();
const page = await browser.newPage();

for (const s of spec) {
  const b64 = (await readFile(s.in)).toString('base64');
  const out = await page.evaluate(
    async ({ b64, x, y, w, h, scale }) => {
      const img = new Image();
      img.src = 'data:image/png;base64,' + b64;
      await img.decode();
      const cv = document.createElement('canvas');
      cv.width = Math.round(w * scale);
      cv.height = Math.round(h * scale);
      const g = cv.getContext('2d');
      g.imageSmoothingEnabled = scale < 1;
      g.drawImage(img, x, y, w, h, 0, 0, cv.width, cv.height);
      return cv.toDataURL('image/png').split(',')[1];
    },
    { b64, x: s.x, y: s.y, w: s.w, h: s.h, scale: s.scale ?? 3 },
  );
  await writeFile(s.out, Buffer.from(out, 'base64'));
  console.log('wrote', s.out, Math.round(s.w * (s.scale ?? 3)), 'x', Math.round(s.h * (s.scale ?? 3)));
}
await browser.close();
