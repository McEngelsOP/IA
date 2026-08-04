/**
 * Print the zone field as a character map over a world rectangle, one glyph
 * per heightfield texel, so the SHAPE of a material boundary can be read
 * instead of guessed at.
 *
 *   node tools/capture/_zonemap.mjs <x0> <z0> <cols> <rows> [step]
 */
import { chromium } from 'playwright';

const [, , x0S, z0S, colsS, rowsS, stepS] = process.argv;
const X0 = Number(x0S), Z0 = Number(z0S);
const COLS = Number(colsS ?? 100), ROWS = Number(rowsS ?? 50), STEP = Number(stepS ?? 2);

const b = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });
const p = await b.newPage();
p.on('pageerror', (e) => console.log('PAGEERR', e.message.slice(0, 200)));
await p.goto('http://127.0.0.1:5173/?capture=1&pr=1', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => !!window.__DESCENT__?.game?.terrain, null, { timeout: 240000 });
const out = await p.evaluate(({ X0, Z0, COLS, ROWS, STEP }) => {
  const T = window.__DESCENT__.game.terrain;
  const glyph = ['R', 'd', 'g', 's', 'S', 'w', 't'];   // rock dirt grass scree Snow water trail
  const lines = [];
  const counts = {};
  for (let j = 0; j < ROWS; j++) {
    let s = '';
    for (let i = 0; i < COLS; i++) {
      const k = T.zoneAt(X0 + i * STEP, Z0 + j * STEP);
      counts[k] = (counts[k] || 0) + 1;
      s += glyph[k] ?? '?';
    }
    lines.push(s);
  }
  return { lines, counts };
}, { X0, Z0, COLS, ROWS, STEP });
await b.close();
for (const l of out.lines) console.log(l);
console.log('counts', JSON.stringify(out.counts));
