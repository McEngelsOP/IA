/**
 * Throwaway: attribute a screen rect to a mesh, over the WHOLE scene, with a
 * restore that cannot accumulate — every mesh's visibility is snapshotted once
 * and rewritten from the snapshot before each trial.
 *
 *   node tools/capture/_sc_who2.mjs streambed 2050,1010,600,400
 */
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import { writeFileSync } from 'node:fs';

const POSE = process.argv[2] ?? 'streambed';
const [RX, RY, RW, RH] = (process.argv[3] ?? '2050,1010,600,400').split(',').map(Number);

const b = await chromium.launch({ headless: true, args: ['--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist'] });
const ctx = await b.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
const p = await ctx.newPage();
p.on('pageerror', (e) => console.log('ERR', e.message.slice(0, 300)));
p.on('framenavigated', (f) => { if (f === p.mainFrame()) console.log('NAVIGATED ->', f.url()); });
p.on('crash', () => console.log('PAGE CRASH'));
p.on('console', (m) => { const t = m.text(); if (/reload|hmr|lost/i.test(t)) console.log('[page]', t.slice(0,160)); });
await p.goto('http://127.0.0.1:5173/?capture=1&pr=2', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => !!window.__DESCENT__?.game?.race, null, { timeout: 300000 });
await p.evaluate(() => window.__DESCENT__.game.capture.takeControl());
await p.evaluate((pose) => {
  const g = window.__DESCENT__.game;
  g.capture.setPose(pose);
  for (let i = 0; i < 40; i++) g.capture.step(1 / 60);
}, POSE);

const names = await p.evaluate(() => {
  const g = window.__DESCENT__.game;
  const list = [];
  const walk = (o) => { if (o.isMesh) list.push(o); for (const c of o.children) walk(c); };
  walk(g.engine.scene);
  window.__MESHES__ = list;
  window.__SNAP__ = list.map((o) => o.visible);
  window.__RESTORE__ = () => { for (let i = 0; i < list.length; i++) list[i].visible = window.__SNAP__[i]; };
  window.__HIDE__ = (i) => { window.__RESTORE__(); list[i].visible = false; };
  return list.map((o, i) => ({ i, n: o.name || `(unnamed:${o.type})`, v: o.visible, c: o.count ?? 1 }));
});

const CLIP = { x: RX / 2, y: RY / 2, width: RW / 2, height: RH / 2 };
const shot = async () => PNG.sync.read(await p.screenshot({ clip: CLIP }));
await p.evaluate(() => { window.__RESTORE__(); const g = window.__DESCENT__.game; g.capture.step(1 / 60); g.capture.step(1 / 60); });
const base = await shot();


const diff = (a, c) => {
  let n = 0;
  for (let y = 0; y < a.height; y++) for (let x = 0; x < a.width; x++) {
    const i = (y * a.width + x) * 4;
    if (Math.abs(a.data[i] - c.data[i]) + Math.abs(a.data[i + 1] - c.data[i + 1]) + Math.abs(a.data[i + 2] - c.data[i + 2]) > 12) n++;
  }
  return n;
};

const rows = [];
for (const m of names) {
  if (!m.v || m.c === 0) continue;
  try {
    await p.evaluate((i) => { window.__HIDE__(i); const g = window.__DESCENT__.game; g.capture.step(1 / 60); g.capture.step(1 / 60); }, m.i);
  } catch (e) {
    console.log('DIED AT', m.i, m.n, '-', String(e).slice(0, 120));
    break;
  }
  const d = diff(base, await shot());
  if (d > 300) { rows.push({ ...m, d }); console.log(`  ${m.n.padEnd(34)} count=${String(m.c).padStart(5)} changedPx=${d}`); }
}
await p.evaluate(() => window.__RESTORE__());
rows.sort((a, c) => c.d - a.d);
for (const r of rows) console.log(`${r.n.padEnd(34)} count=${String(r.c).padStart(5)} changedPx=${r.d}`);
console.log(`(rect ${RW}x${RH} = ${RW * RH} px)`);
await b.close();
