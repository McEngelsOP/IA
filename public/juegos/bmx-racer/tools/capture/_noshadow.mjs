import { chromium } from 'playwright';
const [,,pose,out,mode] = process.argv;
const b = await chromium.launch({args:['--use-angle=default','--enable-gpu','--ignore-gpu-blocklist','--enable-unsafe-swiftshader']});
const c = await b.newContext({ viewport:{width:1600,height:900}, deviceScaleFactor:2 });
const p = await c.newPage();
await p.goto('http://127.0.0.1:5173/?capture=1&pr=2',{waitUntil:'domcontentloaded'});
await p.waitForFunction(()=>!!window.__DESCENT__?.game?.capture,null,{timeout:240000});
await p.evaluate(([pose,mode])=>{
  const g=window.__DESCENT__.game;
  g.capture.takeControl(); g.capture.setPose(pose);
  if (mode==='off') g.post.shadows.enabled=false;
  if (mode==='only') g.post.shadows.setStrength(1.0);
  for(let i=0;i<12;i++) g.capture.step(1/60);
},[pose,mode]);
await p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>r())));
await p.screenshot({path:out,animations:'disabled'});
console.log('wrote',out);
await b.close();
