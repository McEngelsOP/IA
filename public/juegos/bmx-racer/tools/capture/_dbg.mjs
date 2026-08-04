import { chromium } from 'playwright';
const b = await chromium.launch({ headless: true, args:['--enable-gpu','--ignore-gpu-blocklist'] });
const p = await b.newPage();
const seen = new Set();
p.on('console', m => { const t=m.text(); if(seen.has(t.slice(0,120)))return; seen.add(t.slice(0,120)); if(/ERROR|error|Program Info|THREE/i.test(t)) console.log('>>>', t.slice(0, 4000)); });
p.on('pageerror', e => console.log('EXC', e.message));
await p.goto('http://127.0.0.1:5173/?capture=1', { waitUntil:'domcontentloaded' });
await p.waitForTimeout(9000);
await b.close();
