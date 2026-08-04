import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 600, height: 400 } })).newPage();
p.on('console', (m) => { if (m.text().includes('[tabletop]')) console.log(m.text()); });
p.on('pageerror', (e) => console.log('ERR ' + e.message));
await p.goto('http://127.0.0.1:5173/?capture=1&pr=1', { waitUntil: 'load' });
await p.waitForFunction(() => window.__DESCENT__?.game?.track, null, { timeout: 300000 });
await b.close();
