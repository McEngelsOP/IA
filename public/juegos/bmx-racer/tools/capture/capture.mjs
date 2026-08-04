/**
 * capture.mjs — the review harness.
 *
 * Stills are not enough to judge this project. Animation quality, weight,
 * camera feel and whether speed reads as speed can only be seen in motion, so
 * this harness produces three things:
 *
 *   1. Retina stills at named poses (composition, line work, banding, palette)
 *   2. PNG frame sequences at a fixed timestep (motion, weight, timing)
 *   3. Contact sheets — a grid of a sequence's frames in one image, which is
 *      what a reviewing agent can actually read as motion
 *   4. A .webm clip for human review
 *
 * The simulation is stepped MANUALLY at a fixed dt, so a captured sequence is
 * bit-identical regardless of how fast the machine renders it. A harness that
 * captures whatever the renderer happened to produce cannot be used to compare
 * two builds, which is the entire point of having one.
 *
 * Usage:
 *   node tools/capture/capture.mjs --poses                 # all still poses
 *   node tools/capture/capture.mjs --seq launch --frames 48
 *   node tools/capture/capture.mjs --all                   # the full review set
 *   node tools/capture/capture.mjs --pose summit --out x.png
 *
 * Flags:
 *   --url <u>        default http://127.0.0.1:5173
 *   --width/--height  CSS pixels (default 1600x900)
 *   --pr <n>         device pixel ratio (default 2 — retina)
 *   --headed         run with a visible window (real GPU on macOS)
 *   --outdir <d>     default captures/
 *   --fps <n>        sequence timestep (default 60)
 *   --video          also record a .webm of each sequence
 */

import { chromium } from 'playwright';
import { mkdir, writeFile, rm, readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));

const URL_BASE = args.url ?? 'http://127.0.0.1:5173';
const WIDTH = Number(args.width ?? 1600);
const HEIGHT = Number(args.height ?? 900);
const PR = Number(args.pr ?? 2);
const FPS = Number(args.fps ?? 60);
const OUTDIR = path.resolve(args.outdir ?? 'captures');
const HEADED = Boolean(args.headed);
const WANT_VIDEO = Boolean(args.video);

/**
 * The still poses. Each is a camera + game-state setup the game exposes by
 * name. They are chosen to cover the failure modes a critic must be able to
 * see: wide composition, silhouette against sky, silhouette against tree line,
 * three-quarter rider close-up, high-speed, mid-air, and a crash.
 */
const DEFAULT_POSES = [
  'summit-wide',
  'summit-rider',
  'scree-speed',
  'switchback-lean',
  'treeline-silhouette',
  'rockgarden-low',
  'tabletop-air',
  'ravine-gap',
  'ridge-exposure',
  'streambed',
  'finish-sprint',
  'rider-closeup',
  'rider-threequarter',
  'bike-detail',
  'crash',
  'valley-vista',
];

/** Motion sequences: [name, seconds]. */
const DEFAULT_SEQUENCES = [
  ['launch', 1.6],
  ['switchback', 2.0],
  ['tabletop-air', 2.4],
  ['landing', 1.4],
  ['crash', 2.0],
  ['scree-speed', 1.8],
  ['trick-360', 2.2],
  ['pack-race', 3.0],
];

async function main() {
  await mkdir(OUTDIR, { recursive: true });

  const browser = await chromium.launch({
    headless: !HEADED,
    args: [
      '--enable-unsafe-swiftshader',
      '--use-angle=default',
      '--enable-gpu',
      '--ignore-gpu-blocklist',
      '--enable-webgl',
      '--disable-frame-rate-limit',
      '--disable-gpu-vsync',
      '--force-color-profile=srgb',
      '--disable-lcd-text',
    ],
  });

  const context = await browser.newContext({
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: PR,
    ...(WANT_VIDEO
      ? { recordVideo: { dir: path.join(OUTDIR, 'video'), size: { width: WIDTH, height: HEIGHT } } }
      : {}),
  });

  const page = await context.newPage();

  page.on('console', (msg) => {
    const t = msg.type();
    if (t === 'error' || t === 'warning') console.log(`  [page:${t}] ${msg.text()}`);
  });
  page.on('pageerror', (err) => console.log(`  [page:exception] ${err.message}`));

  const url = `${URL_BASE}/?capture=1&pr=${PR}`;
  console.log(`→ loading ${url}`);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });

  // Wait for the game to publish its handle.
  await page.waitForFunction(() => !!window.__DESCENT__?.game?.capture, null, { timeout: 180_000 });

  const info = await page.evaluate(() => {
    const gl = document.querySelector('canvas')?.getContext('webgl2');
    const dbg = gl?.getExtension('WEBGL_debug_renderer_info');
    return {
      renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'unknown',
      poses: window.__DESCENT__.game.capture.listPoses?.() ?? [],
      sequences: window.__DESCENT__.game.capture.listSequences?.() ?? [],
    };
  });
  console.log(`  GPU: ${info.renderer}`);
  if (/swiftshader|software/i.test(info.renderer)) {
    console.log('  ⚠ software rasteriser — timings are meaningless, pixels are still valid');
  }

  // Take the manual clock. From here nothing advances unless we say so.
  await page.evaluate(() => window.__DESCENT__.game.capture.takeControl());

  const posesAvailable = info.poses.length ? info.poses : DEFAULT_POSES;
  const seqsAvailable = info.sequences.length ? info.sequences : DEFAULT_SEQUENCES.map(([n]) => n);

  const doPoses = args.all || args.poses || args.pose;
  const doSeq = args.all || args.seq;

  if (doPoses) {
    const list = args.pose ? [args.pose] : posesAvailable;
    const dir = path.join(OUTDIR, 'stills');
    await mkdir(dir, { recursive: true });
    for (const pose of list) {
      const ok = await setPose(page, pose);
      if (!ok) {
        console.log(`  ✗ unknown pose: ${pose}`);
        continue;
      }
      // Settle: run a handful of frames so springs, LOD fades and streaming
      // all reach steady state before the shutter opens.
      await stepFrames(page, 12, 1 / FPS);
      const out = args.out ? path.resolve(args.out) : path.join(dir, `${pose}.png`);
      await page.screenshot({ path: out, animations: 'disabled' });
      console.log(`  ✓ still  ${path.relative(process.cwd(), out)}`);
    }
  }

  if (doSeq) {
    const list = args.seq && args.seq !== 'all'
      ? [[args.seq, Number(args.seconds ?? 2.0)]]
      : DEFAULT_SEQUENCES.filter(([n]) => seqsAvailable.includes(n) || !info.sequences.length);

    for (const [name, seconds] of list) {
      const frames = Number(args.frames ?? Math.round(seconds * FPS));
      const dir = path.join(OUTDIR, 'seq', name);
      if (existsSync(dir)) await rm(dir, { recursive: true, force: true });
      await mkdir(dir, { recursive: true });

      const ok = await setSequence(page, name);
      if (!ok) {
        console.log(`  ✗ unknown sequence: ${name}`);
        continue;
      }
      await stepFrames(page, 4, 1 / FPS);

      console.log(`→ sequence ${name}: ${frames} frames @ ${FPS}fps`);
      for (let f = 0; f < frames; f++) {
        await stepFrames(page, 1, 1 / FPS);
        await page.screenshot({
          path: path.join(dir, `f${String(f).padStart(4, '0')}.png`),
          animations: 'disabled',
        });
      }
      console.log(`  ✓ frames ${path.relative(process.cwd(), dir)}`);

      // Contact sheet — the artefact a reviewing agent can actually read.
      // Never fatal: the frames are already on disk and are the real output,
      // so a sheet failure must not cost us the remaining sequences.
      try {
        await buildContactSheet(page, dir, path.join(OUTDIR, 'sheets', `${name}.png`), name, FPS);
      } catch (e) {
        console.log(`  ⚠ sheet failed for ${name}: ${e.message.split('\n')[0]}`);
      }
    }
  }

  if (!doPoses && !doSeq) {
    console.log('Nothing requested. Try --all, --poses, or --seq <name>.');
  }

  await context.close();
  await browser.close();
  console.log(`\nOutput → ${OUTDIR}`);
}

async function setPose(page, pose) {
  return page.evaluate((p) => window.__DESCENT__.game.capture.setPose(p), pose);
}

async function setSequence(page, name) {
  return page.evaluate((n) => window.__DESCENT__.game.capture.setSequence(n), name);
}

/** Advance the simulation by exactly n * dt seconds and render each step. */
async function stepFrames(page, n, dt) {
  await page.evaluate(
    ([count, step]) => {
      for (let i = 0; i < count; i++) window.__DESCENT__.game.capture.step(step);
    },
    [n, dt],
  );
  // One rAF so the compositor has the newly drawn buffer before we screenshot.
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
}

/**
 * Composite a frame sequence into a single labelled grid image.
 *
 * A critic reviewing motion needs to see the frames adjacent to each other —
 * scrubbing 90 separate PNGs tells you nothing about timing. The sheet samples
 * evenly across the sequence, labels each cell with its frame index and time,
 * and renders at a size where a compression arc or a foot slipping off a pedal
 * is still visible.
 */
async function buildContactSheet(page, frameDir, outPath, title, fps) {
  const files = (await readdir(frameDir)).filter((f) => f.endsWith('.png')).sort();
  if (!files.length) return;

  // 4 wide, not 6. A shipped frame is 3200x1800 device px; at COLS=6 a cell was
  // 960x540, a 3.33x downsample — and a motion critic reviewing the sheet was
  // therefore judging "is the subject legible" on a third of the resolution the
  // player sees. That is how one reviewer measured a 150 px rider while a probe
  // measured 254 px for the same frame: both were right about different images.
  // At COLS=4 a cell is 1400x788, a 2.3x downsample, and the sheet still fits a
  // readable grid.
  const COLS = 4;
  const MAX_CELLS = 24;
  const stride = Math.max(1, Math.ceil(files.length / MAX_CELLS));
  const picked = files.filter((_, i) => i % stride === 0).slice(0, MAX_CELLS);

  const CELL_W = 700;
  const CELL_H = Math.round((CELL_W * HEIGHT) / WIDTH);
  const LABEL_H = 22;

  const sheetPage = await page.context().newPage();

  // Downscale EACH frame on its own, in the browser, before any of them go
  // into the sheet. Embedding 30 retina PNGs as base64 and letting the page
  // decode them all at once is ~120 MB of decoded bitmap and it kills the
  // renderer — which then takes the rest of the capture run down with it.
  // One image in flight at a time, re-encoded to a cell-sized JPEG, is ~40x
  // smaller and never holds more than one full-res bitmap in memory.
  await sheetPage.setViewportSize({ width: CELL_W, height: CELL_H + LABEL_H });
  const images = [];
  for (const f of picked) {
    const buf = await readFile(path.join(frameDir, f));
    const src = await sheetPage.evaluate(
      async ([dataUrl, w, h]) => {
        const img = new Image();
        img.src = dataUrl;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        c.getContext('2d').drawImage(img, 0, 0, w, h);
        img.src = '';
        return c.toDataURL('image/jpeg', 0.86);
      },
      [`data:image/png;base64,${buf.toString('base64')}`, CELL_W, CELL_H],
    );
    images.push({
      src,
      label: `${f.replace(/\D/g, '')}  ·  ${(Number(f.replace(/\D/g, '')) / fps).toFixed(3)}s`,
    });
  }

  const rows = Math.ceil(images.length / COLS);
  await sheetPage.setViewportSize({
    width: COLS * CELL_W,
    height: rows * (CELL_H + LABEL_H) + 46,
  });
  await sheetPage.setContent(`
    <style>
      body { margin:0; background:#14101c; font:600 12px/1 ui-monospace,Menlo,monospace; color:#f2d69b; }
      h1 { margin:0; padding:14px 12px 10px; font-size:13px; letter-spacing:.22em; text-transform:uppercase; }
      .grid { display:grid; grid-template-columns: repeat(${COLS}, ${CELL_W}px); }
      .cell img { display:block; width:${CELL_W}px; height:${CELL_H}px; object-fit:cover; }
      .cell div { height:${LABEL_H}px; line-height:${LABEL_H}px; padding-left:6px; color:#8d7fa8; }
    </style>
    <h1>${title} — ${images.length} of ${files.length} frames @ ${fps}fps</h1>
    <div class="grid">
      ${images.map((i) => `<div class="cell"><img src="${i.src}"><div>${i.label}</div></div>`).join('')}
    </div>
  `);
  await mkdir(path.dirname(outPath), { recursive: true });
  await sheetPage.screenshot({ path: outPath, fullPage: true });
  await sheetPage.close();
  console.log(`  ✓ sheet  ${path.relative(process.cwd(), outPath)}`);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      out[key] = next;
      i++;
    } else {
      out[key] = true;
    }
  }
  return out;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
