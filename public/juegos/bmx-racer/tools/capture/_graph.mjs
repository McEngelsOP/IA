import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader', '--use-angle=default'] });
const page = await (await browser.newContext({ viewport: { width: 800, height: 450 } })).newPage();
await page.goto('http://127.0.0.1:5173/?capture=1&pr=1', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!window.__DESCENT__?.game?.capture, null, { timeout: 240000 });
const r = await page.evaluate(() => {
  const g = window.__DESCENT__.game;
  const scene = g.terrain.object.parent;
  const lines = [];
  const walk = (o, d) => {
    if (d > 3) return;
    lines.push('  '.repeat(d) + (o.name || '<' + o.type + '>') + ' [' + o.type + '] kids=' + o.children.length);
    if (d < 3) for (const c of o.children) walk(c, d + 1);
  };
  walk(scene, 0);
  const st = g.race.player.bike.state;
  return {
    tree: lines.join('\n'),
    sceneName: scene.name, sceneType: scene.type,
    racers: g.race.racers.map((x) => ({ id: x.id, isPlayer: x === g.race.player, objName: x.object.name, bikeObjName: x.bike.object.name, rigObjName: x.rig.object.name })),
    playerStateKeys: Object.keys(st),
    camParent: g.effects.cameraDirector.camera.parent ? g.effects.cameraDirector.camera.parent.name || g.effects.cameraDirector.camera.parent.type : null,
  };
});
console.log(r.tree);
console.log('scene:', r.sceneName, r.sceneType, ' camParent:', r.camParent);
console.log(JSON.stringify(r.racers, null, 1));
await browser.close();
