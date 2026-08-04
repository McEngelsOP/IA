import { chromium } from 'playwright';
const b = await chromium.launch({args:['--use-angle=default','--enable-gpu','--ignore-gpu-blocklist','--enable-unsafe-swiftshader']});
const c = await b.newContext({ viewport:{width:1600,height:900}, deviceScaleFactor:2 });
const p = await c.newPage();
await p.goto('http://127.0.0.1:5173/?capture=1&pr=2',{waitUntil:'domcontentloaded'});
await p.waitForFunction(()=>!!window.__DESCENT__?.game?.capture,null,{timeout:240000});
console.log(await p.evaluate(()=>{
  const s=window.__DESCENT__.game.post.shadows;
  return JSON.stringify({size:[s.targets[0].width,s.targets[1].width], texelWorld:s.texelWorldSize(), split:window.__DESCENT__.game.post.shadows.opts?.nearRange ?? null});
}));
await b.close();
