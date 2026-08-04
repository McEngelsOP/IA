/**
 * _mp.mjs — multi-pose still capture in ONE page load.
 *
 * capture.mjs --pose X reloads the page (and re-erodes the mountain) per pose.
 * This grabs a named list of poses from a single load, into a tagged directory.
 *
 *   node tools/capture/_mp.mjs <tag> pose1,pose2,...
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const TAG = process.argv[2] ?? 'x';
const POSES = (process.argv[3] ?? 'tabletop-air,bike-detail,streambed,rider-threequarter,crash')
  .split(',')
  .filter(Boolean);
const W = Number(process.argv[4] ?? 1600);
const H = Number(process.argv[5] ?? 900);

const dir = path.resolve(`captures/_${TAG}`);
await mkdir(dir, { recursive: true });

const b = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist', '--force-color-profile=srgb'],
});
const ctx = await b.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
const p = await ctx.newPage();
p.on('pageerror', (e) => console.log('PAGEERR', e.message.slice(0, 400)));
p.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text().slice(0, 300)); });

await p.goto('http://127.0.0.1:5173/?capture=1&pr=2', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => !!window.__DESCENT__?.game?.capture, null, { timeout: 240000 });
await p.evaluate(() => window.__DESCENT__.game.capture.takeControl());

for (const pose of POSES) {
  const ok = await p.evaluate((n) => window.__DESCENT__.game.capture.setPose(n), pose);
  if (!ok) { console.log(`  x unknown pose ${pose}`); continue; }
  await p.evaluate(() => { for (let i = 0; i < 12; i++) window.__DESCENT__.game.capture.step(1 / 60); });
  await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
  const out = path.join(dir, `${pose}.png`);
  await p.screenshot({ path: out, animations: 'disabled' });
  console.log(`  ok ${path.relative(process.cwd(), out)}`);
}

await b.close();
