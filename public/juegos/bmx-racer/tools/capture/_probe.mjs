import { chromium } from 'playwright';
import { PNG } from 'pngjs';
const b = await chromium.launch({ headless: true, args: ['--use-angle=default','--enable-gpu','--ignore-gpu-blocklist'] });
const ctx = await b.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
const p = await ctx.newPage();
p.on('pageerror', e => console.log('ERR', e.message.slice(0,200)));
await p.goto('http://127.0.0.1:5173/?capture=1&pr=2', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => !!window.__DESCENT__?.game?.race, null, { timeout: 300000 });
await p.evaluate(() => window.__DESCENT__.game.capture.takeControl());
const rgb2hsv=(r,g,bl)=>{r/=255;g/=255;bl/=255;const mx=Math.max(r,g,bl),d=mx-Math.min(r,g,bl);
  let h=0; if(d){h=mx===r?((g-bl)/d+(g<bl?6:0)):mx===g?((bl-r)/d+2):((r-g)/d+4);h*=60;}
  return [Math.round(h), Math.round(mx?d/mx*100:0)];};
async function sample(label, toggle) {
  await p.evaluate(() => { const g=window.__DESCENT__.game;
    g.post.setDebugView('off');
    g.terrain.materials.main.uniforms.uFogStrengths.value = [0.16,0.44,0.72,0.94];
    g.capture.setPose('bike-detail'); });
  await p.evaluate(toggle);
  await p.evaluate(()=>{for(let i=0;i<12;i++)window.__DESCENT__.game.capture.step(1/60);});
  const png = PNG.sync.read(await p.screenshot());
  let R=0,G=0,B=0,n=0;
  for(let dy=-10;dy<10;dy++)for(let dx=-10;dx<10;dx++){
    const i=((1350+dy)*png.width+(1800+dx))*4; R+=png.data[i];G+=png.data[i+1];B+=png.data[i+2];n++;}
  const [h,s]=rgb2hsv(R/n,G/n,B/n);
  console.log(`${label.padEnd(26)} rgb(${Math.round(R/n)},${Math.round(G/n)},${Math.round(B/n)})  hue ${String(h).padStart(3)}  sat ${String(s).padStart(2)}%`);
}
console.log('AUTHORED lit dirt: hue 27 sat 45   (identical pose + settle per sample)');
await sample('baseline', () => {});
await sample('fog OFF', () => { window.__DESCENT__.game.terrain.materials.main.uniforms.uFogStrengths.value = [0,0,0,0]; });
await sample('ungraded', () => window.__DESCENT__.game.post.setDebugView('ungraded'));
await sample('fog OFF + ungraded', () => { const g=window.__DESCENT__.game;
  g.terrain.materials.main.uniforms.uFogStrengths.value = [0,0,0,0]; g.post.setDebugView('ungraded'); });
await b.close();
