import { chromium } from 'playwright';
const b = await chromium.launch({ headless: true, args: ['--use-angle=default','--enable-gpu','--ignore-gpu-blocklist','--enable-unsafe-swiftshader'] });
const p = await b.newPage();
p.on('pageerror', e => console.log('ERR', e.message.slice(0,300)));
p.on('console', m => { if (m.type()==='error') console.log('CONSOLE', m.text().slice(0,200)); });
await p.goto('http://127.0.0.1:5173/?capture=1&pr=1', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => !!window.__DESCENT__?.game?.capture, null, { timeout: 240000 });

const out = await p.evaluate(() => {
  const g = window.__DESCENT__.game;
  g.capture.takeControl();
  const r = g.race.player;
  const rig = r.rig;
  const bike = r.bike;
  const st = bike.state;

  const res = {};

  // ---- structural: is the rig attached? do bones/meshes exist? ----
  res.rigKeys = Object.keys(rig);
  res.hasAnchors = !!rig.anchors;
  res.anchorNames = rig.anchors ? Object.keys(rig.anchors) : null;
  res.meshNames = [];
  rig.object.traverse(o => { if (o.isMesh || o.isSkinnedMesh) res.meshNames.push(`${o.name}|${o.type}|vis=${o.visible}|frustumCulled=${o.frustumCulled}`); });
  res.boneCount = rig.skel?.bones?.length;
  res.boneNames = rig.skel?.bones?.map(b => b.name);

  // ---- crash sequence ----
  g.capture.setSequence('crash');
  const rows = [];
  const THREE = window.__DESCENT__.THREE;
  for (let f = 0; f < 40; f++) {
    g.capture.step(1/60);
    const bones = rig.skel.bones;
    const bi = window.__DESCENT__.BONE_INDEX ?? null;
    const nameIdx = {};
    bones.forEach((bn,i)=>nameIdx[bn.name]=i);
    const getW = (n) => { const bn = bones[nameIdx[n]]; if(!bn) return null; bn.updateWorldMatrix(true,false); const v = {x:bn.matrixWorld.elements[12], y:bn.matrixWorld.elements[13], z:bn.matrixWorld.elements[14]}; return v; };
    const head = getW('head'); const hl = getW('handL'); const hr = getW('handR');
    const fl = getW('footL'); const fr = getW('footR');
    rows.push({
      f,
      mode: st.mode,
      crashed: st.crashedThisStep,
      sev: +st.crashSeverity.toFixed(3),
      cw: +rig.crashWeight.toFixed(4),
      ct: +rig.crashTime.toFixed(3),
      crashPoseIsTumble: rig.crashPose === undefined ? null : true,
      bikePos: [+st.position.x.toFixed(3), +st.position.y.toFixed(3), +st.position.z.toFixed(3)],
      head: head ? [+head.x.toFixed(3), +head.y.toFixed(3), +head.z.toFixed(3)] : null,
      handL: hl ? [+hl.x.toFixed(3), +hl.y.toFixed(3), +hl.z.toFixed(3)] : null,
      footL: fl ? [+fl.x.toFixed(3), +fl.y.toFixed(3), +fl.z.toFixed(3)] : null,
      footR: fr ? [+fr.x.toFixed(3), +fr.y.toFixed(3), +fr.z.toFixed(3)] : null,
    });
  }
  res.crash = rows;
  return res;
});
console.log(JSON.stringify(out, null, 1));
await b.close();
