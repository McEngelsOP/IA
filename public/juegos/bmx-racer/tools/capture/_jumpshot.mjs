// Side-on and three-quarter views of the tabletop, so the ramp profile reads.
import { chromium } from 'playwright';
const b = await chromium.launch({
  args: ['--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'],
});
const ctx = await b.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
const p = await ctx.newPage();
p.on('pageerror', (e) => console.log('ERR ' + e.message));
await p.goto('http://127.0.0.1:5173/?capture=1&pr=2', { waitUntil: 'load' });
await p.waitForFunction(() => window.__DESCENT__?.game?.capture, null, { timeout: 300000 });

const shots = [
  ['approach', 2382, 18, 0, 1.57, 0.06, 34],   // side-on, whole jump
  ['lip', 2401, 18, 0, 1.90, 0.10, 20],        // rider on the face
  ['air', 2406, 20, 6.0, 1.57, 0.12, 26],      // launched, side-on
];
for (const [name, d, speed, launch, yaw, pitch, dist] of shots) {
  await p.evaluate(async ([d, speed, launch, yaw, pitch, dist]) => {
    const C = await import('/src/game/Contracts.ts');
    const W = await import('/src/game/WorldConstants.ts');
    const g = window.__DESCENT__.game;
    const s = g.track.spline ?? g.track;
    g.capture.takeControl();
    const sm = s.sampleAtDistance(d);
    const pos = sm.position.clone();
    pos.y = Math.max(pos.y, g.terrain.heightAt(pos.x, pos.z)) + W.BIKE.wheelRadius - 0.03;
    const bike = g.race.player.bike;
    bike.reset(pos, sm.tangent.clone());
    bike.state.velocity.copy(sm.tangent).multiplyScalar(speed);
    if (launch) bike.state.velocity.y += launch;
    g.race.player.scripted = {
      steer: 0, pedal: 0, brakeRear: 0, brakeFront: 0, crouch: 0, pitchLean: 0,
      airPitch: 0, airYaw: 0, airRoll: 0, wantBoost: false, wantHop: false,
    };
    const dir = g.effects.cameraDirector;
    dir.mode = C.CameraMode.Orbit;
    dir.setOrbit(yaw, pitch, dist, 0);
    dir.resetTo(bike.state);
  }, [d, speed, launch, yaw, pitch, dist]);
  for (let i = 0; i < 10; i++) {
    await p.evaluate(() => window.__DESCENT__.game.capture.step(1 / 60));
  }
  await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
  await p.screenshot({ path: `captures/_jump_${name}.png`, animations: 'disabled' });
  console.log('shot ' + name);
}
await b.close();
