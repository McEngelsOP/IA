/**
 * Throwaway: at a named pose, screenshot with whole subtrees toggled, so the
 * shard cluster can be attributed to a subtree rather than guessed at.
 *
 * The reset is explicit: a scatter mesh's live visibility is `count > 0`, and
 * a pool only rewrites it on a refill, so restoring by "set it back to true"
 * silently accumulates. Every mesh is reset from count every time.
 *
 *   node tools/capture/_sc_iso.mjs streambed
 */
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const POSE = process.argv[2] ?? 'streambed';
const TAGS = (process.argv[3] ?? 'all,noScatter,noFoliage,noHulls,noRocks,noCards,noGrass,noConifer').split(',');

const b = await chromium.launch({ headless: true, args: ['--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist'] });
const ctx = await b.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
const p = await ctx.newPage();
p.on('pageerror', (e) => console.log('ERR', e.message.slice(0, 300)));
await p.goto('http://127.0.0.1:5173/?capture=1&pr=2', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => !!window.__DESCENT__?.game?.race, null, { timeout: 300000 });
await p.evaluate(() => window.__DESCENT__.game.capture.takeControl());

await p.evaluate(() => {
  const g = window.__DESCENT__.game;
  window.__APPLY_HIDE__ = (tag) => {
    const t = g.terrain;
    const roots = [t.scatter?.object, t.foliage?.object].filter(Boolean);
    const all = [];
    const walk = (o) => { all.push(o); for (const c of o.children) walk(c); };
    for (const r of roots) walk(r);
    for (const r of roots) r.visible = true;
    for (const o of all) if (o.isMesh) o.visible = (o.count ?? 1) > 0;

    const hide = (f) => { for (const o of all) if (o.isMesh && f(o)) o.visible = false; };
    if (tag === 'noScatter') t.scatter.object.visible = false;
    if (tag === 'noFoliage') t.foliage.object.visible = false;
    if (tag === 'noHulls') hide((o) => o.userData?.isHull);
    if (tag === 'noRocks') hide((o) => o.name.startsWith('rock-'));
    if (tag === 'noCards') hide((o) => o.name.includes(':card'));
    if (tag === 'noGrass') hide((o) => o.name.includes('grass') || o.name.includes('wildflower'));
    if (tag === 'noConifer') hide((o) => o.name.startsWith('conifer'));
  };
});

for (const tag of TAGS) {
  await p.evaluate((pose) => {
    const g = window.__DESCENT__.game;
    g.capture.setPose(pose);
    for (let i = 0; i < 8; i++) g.capture.step(1 / 60);
  }, POSE);
  await p.evaluate((t) => window.__APPLY_HIDE__(t), tag);
  writeFileSync(`captures/sc/iso_${tag}.png`, await p.screenshot());
  console.log('wrote', tag);
}

await b.close();
