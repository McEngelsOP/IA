/**
 * Throwaway: at a named pose, hide each scatter mesh in turn and report how
 * many pixels changed inside a rect. Identifies which mesh draws the shards.
 */
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import { writeFileSync } from 'node:fs';

const POSE = process.argv[2] ?? 'streambed';
const RECT = (process.argv[3] ?? '2050,1010,600,400').split(',').map(Number);

const b = await chromium.launch({ headless: true, args: ['--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist'] });
const ctx = await b.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
const p = await ctx.newPage();
p.on('pageerror', (e) => console.log('ERR', e.message.slice(0, 300)));
await p.goto('http://127.0.0.1:5173/?capture=1&pr=2', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => !!window.__DESCENT__?.game?.race, null, { timeout: 300000 });
await p.evaluate(() => window.__DESCENT__.game.capture.takeControl());
await p.evaluate((pose) => window.__DESCENT__.game.capture.setPose(pose), POSE);
await p.evaluate(() => { for (let i = 0; i < 8; i++) window.__DESCENT__.game.capture.step(1 / 60); });

const names = await p.evaluate(() => {
  const g = window.__DESCENT__.game;
  const out = [];
  const walk = (o) => { if (o.isMesh) out.push({ n: o.name, c: o.count, v: o.visible }); for (const c of o.children) walk(c); };
  walk(g.terrain.scatter.object);
  if (g.terrain.foliage) walk(g.terrain.foliage.object);
  return out;
});
console.log('meshes at pose:', names.filter((x) => x.c !== 0).map((x) => `${x.n}(${x.c})`).join(' '));

const settle = async () => {
  await p.evaluate((pose) => {
    const g = window.__DESCENT__.game;
    g.capture.setPose(pose);
    for (let i = 0; i < 8; i++) g.capture.step(1 / 60);
  }, POSE);
};
const shot = async () => { await settle(); return PNG.sync.read(await p.screenshot()); };
const base = await shot();
writeFileSync('captures/w0/who_base.png', PNG.sync.write(base));

const [rx, ry, rw, rh] = RECT;
const diff = (a, c) => {
  let n = 0;
  for (let y = ry; y < ry + rh; y++) for (let x = rx; x < rx + rw; x++) {
    const i = (y * a.width + x) * 4;
    if (Math.abs(a.data[i] - c.data[i]) + Math.abs(a.data[i + 1] - c.data[i + 1]) + Math.abs(a.data[i + 2] - c.data[i + 2]) > 12) n++;
  }
  return n;
};

for (const m of names) {
  if (m.c === 0) continue;
  await p.evaluate((nm) => {
    const g = window.__DESCENT__.game;
    const walk = (o) => { if (o.isMesh && o.name === nm) o.visible = false; for (const c of o.children) walk(c); };
    walk(g.terrain.scatter.object); if (g.terrain.foliage) walk(g.terrain.foliage.object);
  }, m.n);
  const s = await shot();
  const d = diff(base, s);
  console.log(`${m.n.padEnd(28)} count=${String(m.c).padStart(4)}  changedPx=${d}`);
  if (d > 200) writeFileSync(`captures/w0/who_off_${m.n.replace(/[:]/g, '_')}.png`, PNG.sync.write(s));
  await p.evaluate((nm) => {
    const g = window.__DESCENT__.game;
    const walk = (o) => { if (o.isMesh && o.name === nm) o.visible = true; for (const c of o.children) walk(c); };
    walk(g.terrain.scatter.object); if (g.terrain.foliage) walk(g.terrain.foliage.object);
  }, m.n);
}
await b.close();
