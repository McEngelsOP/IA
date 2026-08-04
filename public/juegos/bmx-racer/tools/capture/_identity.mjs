/**
 * _identity.mjs — measure whether a rider still carries its committed jersey
 * hue at range.
 *
 * For each pose it projects every racer to screen, reads back the framebuffer
 * patch over the torso, and reports:
 *   px    apparent rider height in CSS pixels
 *   mC    MEAN chroma over the patch (max-min channel, 0..255)
 *   onID  fraction of patch pixels within 30 deg of the committed jersey hue
 *         AND carrying at least 45 chroma — i.e. pixels that actually say
 *         "this is that rider"
 *   mL    mean luma (how much of the figure has collapsed to ink)
 *   pk    the single most saturated pixel found, and its hue error
 *
 *   node tools/capture/_identity.mjs pose1,pose2,...
 */
import { chromium } from 'playwright';

const POSES = (process.argv[2] ?? 'ridge-exposure,summit-wide,crash,valley-vista').split(',').filter(Boolean);
const W = Number(process.argv[3] ?? 1600);
const H = Number(process.argv[4] ?? 900);

const b = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist', '--force-color-profile=srgb'],
});
const ctx = await b.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
const p = await ctx.newPage();
p.on('pageerror', (e) => console.log('PAGEERR', e.message.slice(0, 300)));
await p.goto('http://127.0.0.1:5173/?capture=1&pr=2', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => !!window.__DESCENT__?.game?.capture, null, { timeout: 240000 });
await p.evaluate(() => window.__DESCENT__.game.capture.takeControl());

/** RIDER_COLORS jersey hexes, in colorIndex order (Palette.ts). */
const RIDER_HEX = [0xe0574c, 0x3f9ad9, 0xf2c14e, 0x74c96b];

for (const pose of POSES) {
  const ok = await p.evaluate((n) => window.__DESCENT__.game.capture.setPose(n), pose);
  if (!ok) { console.log('unknown', pose); continue; }
  await p.evaluate(() => { for (let i = 0; i < 12; i++) window.__DESCENT__.game.capture.step(1 / 60); });
  await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));

  const spots = await p.evaluate(() => {
    const g = window.__DESCENT__.game;
    const cam = window.__DESCENT__.engine.camera;
    const out = [];
    for (const r of g.race.racers) {
      const st = r.bike.state;
      const v = st.position.clone();
      v.y += 1.0;
      const d = v.distanceTo(cam.position);
      const c = v.clone().project(cam);
      const fovScale = 1 / Math.tan((cam.fov * Math.PI) / 360);
      const px = (1.7 * (window.innerHeight * 0.5) * fovScale) / Math.max(d, 0.01);
      out.push({
        id: r.id ?? '?',
        ci: ({ player: 0, ai0: 1, ai1: 2, ai2: 3 })[r.id] ?? 0,
        dist: d,
        x: (c.x * 0.5 + 0.5) * window.innerWidth,
        y: (1 - (c.y * 0.5 + 0.5)) * window.innerHeight,
        px,
        infront: c.z < 1 && Math.abs(c.x) < 1.1 && Math.abs(c.y) < 1.1,
      });
    }
    return out;
  });

  const shot = await p.screenshot({ animations: 'disabled' });
  const res = await p.evaluate(
    async ([b64, spots, hexes]) => {
      const img = new Image();
      img.src = 'data:image/png;base64,' + b64;
      await img.decode();
      const cv = document.createElement('canvas');
      cv.width = img.width; cv.height = img.height;
      const g2 = cv.getContext('2d');
      g2.drawImage(img, 0, 0);
      const sx = img.width / window.innerWidth;
      const hueOf = (r, gg, bb) => {
        const mx = Math.max(r, gg, bb), mn = Math.min(r, gg, bb), d = mx - mn;
        if (d === 0) return -1;
        let h;
        if (mx === r) h = ((gg - bb) / d + 6) % 6;
        else if (mx === gg) h = (bb - r) / d + 2;
        else h = (r - gg) / d + 4;
        h *= 60; if (h < 0) h += 360;
        return h;
      };
      const dh = (a, t) => { if (a < 0 || t < 0) return 999; let d = Math.abs(a - t); return d > 180 ? 360 - d : d; };
      return spots.map((s) => {
        if (!s.infront) return { ...s, skip: true };
        const cx = Math.round(s.x * sx), cy = Math.round(s.y * sx);
        const R = Math.max(4, Math.round(s.px * sx * 0.34));
        const x0 = Math.max(0, cx - R), y0 = Math.max(0, cy - R);
        const w = Math.min(img.width - x0, R * 2), h = Math.min(img.height - y0, R * 2);
        if (w <= 0 || h <= 0) return { ...s, skip: true };
        const d = g2.getImageData(x0, y0, w, h).data;
        const hex = hexes[s.ci] ?? 0;
        const th = hueOf((hex >> 16) & 255, (hex >> 8) & 255, hex & 255);
        let sumC = 0, sumL = 0, on = 0, n = 0, best = -1, bh = -1, brgb = [0, 0, 0];
        for (let i = 0; i < d.length; i += 4) {
          const r = d[i], gg = d[i + 1], bb = d[i + 2];
          const c = Math.max(r, gg, bb) - Math.min(r, gg, bb);
          const l = 0.2126 * r + 0.7152 * gg + 0.0722 * bb;
          const hh = hueOf(r, gg, bb);
          sumC += c; sumL += l; n++;
          if (c >= 45 && dh(hh, th) <= 30) on++;
          if (c > best) { best = c; bh = hh; brgb = [r, gg, bb]; }
        }
        return {
          ...s, mC: sumC / n, mL: sumL / n, onID: on / n,
          pk: best, pkHue: bh, pkErr: dh(bh, th), target: th, rgb: brgb, patch: `${w}x${h}`,
        };
      });
    },
    [shot.toString('base64'), spots, RIDER_HEX],
  );

  console.log(`\n== ${pose}`);
  for (const r of res) {
    if (r.skip) { console.log(`   ${String(r.id).padEnd(7)} off-screen`); continue; }
    console.log(
      `   ${String(r.id).padEnd(7)} d=${r.dist.toFixed(0).padStart(4)}m px=${r.px.toFixed(0).padStart(4)}` +
      `  mC=${r.mC.toFixed(1).padStart(5)} onID=${(r.onID * 100).toFixed(0).padStart(3)}%` +
      `  mL=${r.mL.toFixed(0).padStart(3)}  pk=${String(r.pk).padStart(3)} pkHue=${r.pkHue < 0 ? ' --' : r.pkHue.toFixed(0).padStart(3)}` +
      ` tgt=${r.target.toFixed(0)} err=${r.pkErr.toFixed(0)} rgb=${JSON.stringify(r.rgb)}`,
    );
  }
}
await b.close();
