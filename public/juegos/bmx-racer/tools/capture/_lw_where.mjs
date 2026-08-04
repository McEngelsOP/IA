/**
 * Throwaway probe (line-work agent): unproject a pixel through the G-buffer
 * depth to a WORLD position, and report where that position sits relative to
 * every clipmap ring boundary — so a stray depth line can be proved to be, or
 * proved not to be, a LOD seam.
 *
 *   node tools/capture/_lw_where.mjs <pose> <x,y;x,y;...> [url]
 */
import { chromium } from 'playwright';

const pose = process.argv[2] ?? 'treeline-silhouette';
const pts = (process.argv[3] ?? '606,800;609,800').split(';').map((s) => s.split(',').map(Number));
const URL_BASE = process.argv[4] ?? 'http://127.0.0.1:5173';

const b = await chromium.launch({ args: ['--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist'] });
const c = await b.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
const p = await c.newPage();
p.on('pageerror', (e) => console.log('[exc]', e.message));
await p.goto(`${URL_BASE}/?capture=1&pr=2`, { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => !!window.__DESCENT__?.game?.capture, null, { timeout: 240000 });

const out = await p.evaluate(async ({ pose, pts }) => {
  const g = window.__DESCENT__.game;
  const eng = window.__DESCENT__.engine;
  const r = eng.renderer;
  g.capture.takeControl();
  g.capture.setPose(pose);
  for (let i = 0; i < 60; i++) g.capture.step(1 / 60);

  const half = (h) => {
    const s = (h & 0x8000) ? -1 : 1, e = (h >> 10) & 0x1f, f = h & 0x3ff;
    if (e === 0) return s * Math.pow(2, -14) * (f / 1024);
    if (e === 31) return f ? NaN : s * Infinity;
    return s * Math.pow(2, e - 15) * (1 + f / 1024);
  };

  const cam = eng.camera ?? g.camera;
  const rt = g.post.gbuffer.target;
  const W = rt.width, H = rt.height;
  const lines = [];
  lines.push(`camera pos ${cam.position.toArray().map((v) => v.toFixed(2)).join(', ')} fov ${cam.fov}`);

  // Ring bounds
  const rings = [];
  eng.scene.traverse((o) => {
    const m = /^terrain:L(\d+):q0$/.exec(o.name || '');
    if (!m) return;
    const uv = o.geometry.getAttribute('uv');
    rings.push({ L: Number(m[1]), spacing: uv.getX(0), half: uv.getY(0), x: o.position.x, z: o.position.z });
  });
  rings.sort((a, b2) => a.L - b2.L);
  for (const rg of rings) {
    lines.push(`ring L${rg.L} spacing=${rg.spacing} half=${rg.half} centre=(${rg.x.toFixed(2)}, ${rg.z.toFixed(2)}) ` +
      `x:[${(rg.x - rg.half).toFixed(2)},${(rg.x + rg.half).toFixed(2)}] z:[${(rg.z - rg.half).toFixed(2)},${(rg.z + rg.half).toFixed(2)}]`);
  }

  for (const [px, py] of pts) {
    const buf = new Uint16Array(W * 4);
    r.readRenderTargetPixels(rt, 0, H - 1 - py, W, 1, buf, 0, 0);
    const z = half(buf[px * 4 + 3]);
    // NDC → view ray → world
    const ndcX = ((px + 0.5) / W) * 2 - 1;
    const ndcY = 1 - ((py + 0.5) / H) * 2;
    const t = Math.tan((cam.fov * Math.PI) / 360);
    const vx = ndcX * t * cam.aspect * z;
    const vy = ndcY * t * z;
    const v = new (window.__DESCENT__.THREE?.Vector3 ?? Object)(vx, vy, -z);
    const world = { x: 0, y: 0, z: 0 };
    // Manual: world = cam.matrixWorld * (vx, vy, -z)
    const e = cam.matrixWorld.elements;
    world.x = e[0] * vx + e[4] * vy + e[8] * -z + e[12];
    world.y = e[1] * vx + e[5] * vy + e[9] * -z + e[13];
    world.z = e[2] * vx + e[6] * vy + e[10] * -z + e[14];
    let near = '';
    for (const rg of rings) {
      const dx = Math.min(Math.abs(Math.abs(world.x - rg.x) - rg.half), Math.abs(Math.abs(world.x - rg.x) - rg.half * 0.5));
      const dz = Math.min(Math.abs(Math.abs(world.z - rg.z) - rg.half), Math.abs(Math.abs(world.z - rg.z) - rg.half * 0.5));
      near += ` L${rg.L}:dx=${dx.toFixed(2)},dz=${dz.toFixed(2)}`;
    }
    lines.push(`px(${px},${py}) z=${z.toFixed(2)} world=(${world.x.toFixed(2)}, ${world.y.toFixed(2)}, ${world.z.toFixed(2)})`);
    lines.push(`   dist to ring edges:${near}`);
  }
  return lines;
}, { pose, pts });

console.log(out.join('\n'));
await c.close();
await b.close();
