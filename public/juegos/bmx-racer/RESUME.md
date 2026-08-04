# DESCENT — resume state

Updated 2026-08-01. Everything here is verified against the running build.
**Read this first, then jump to "Next actions".**

Standing instruction: **quality at the highest possible end, cost is not a
constraint.** "Working is the floor, not the goal."

---

## State at this moment

`tsc` 0 errors · `npm run check:glsl` clean · renders at 49 programs with no GL
errors · 13 commits, last is the salvage of the interrupted eight-agent round.

```bash
npm run dev                                   # http://127.0.0.1:5173
node tools/capture/capture.mjs --poses        # 16 retina stills
node tools/capture/capture.mjs --seq all      # 8 sequences + contact sheets
npm run check:glsl                            # backtick guard, also in `npm run build`
```

**Eight agents died mid-edit on a session limit and their partial work was
kept** (it typechecks, the guard passes, it renders). Two repairs were needed:
two backticks in GLSL comments in `CompositePass.ts` (the guard caught them),
and `TyreConfig` had gained `mechanicalTrail` / `pneumaticTrail` without the
presets being populated — completed from the interface's own documentation
(front trail = wheelRadius / tan(head angle) = 0.0766 m).

Each of the eight had been briefed to read its own `git diff` first, then
re-capture and look, before changing anything. **Anything they did not finish
is still open** — see the defect list below.

---

## THE HARNESS HAS BEEN THE BIGGEST SOURCE OF FALSE DEFECTS

Five times a critic reported a defect that was an artefact of the review tooling
rather than the game. **Check the harness first when something looks
impossible.**

1. **The preroll consumed the jump.** Takeoff is 127 physics steps after the
   preroll finishes; a still shutters 24 steps after it. Every air pose and
   sequence showed a rider on a ramp. THREE critic passes reviewed footage of
   an event that had already happened off-camera.
2. **Five of eight sequences captured the same run twice** (mean absolute pixel
   difference 1.18 on 0–255). They shared situations and differed only by an
   `input` field that was inert because the rider was never airborne.
3. **`--poses` shoots all 16 in ONE page**, so a latching effect leaks between
   review frames. The smear was pinned at 0.821 by `crash` and dissolved the
   rider in `rider-closeup`, a pose that asks for 0.0. `applySituation` now
   calls `effects.reset()` — anything stateful added later must be wiped there.
4. **Contact sheets were a 3.33x downsample** (960×540 cells of a 3200×1800
   frame). A critic measured a 150 px rider where a probe measured 254 px —
   both right, about different images. Now 4 columns at 1400×788.
5. **Rivals spawned 3.5 m behind while the chase boom sits at 4.8 m**, so the
   harness parked a rival exactly where the camera lives. Moving them to 12 m
   created the opposite failure — `pack-race` with no rival in a single frame.
   They now spawn AHEAD for that sequence.

Also fixed: the capture clock read `0:00.19` at 96% of the descent because
teleporting never advanced time. Now derived from distance at a nominal pace.

---

## THE BUGS THAT MATTERED, AND WHAT EACH TEACHES

Every one was invisible to typechecking, invisible to "does it run", and only
fell out of MEASURING something.

1. **`Game.render` fed a dimensionless multiplier where a frame delta was
   expected.** The entire visual half of the game advanced ONE SECOND per
   rendered frame (`uFxTime` read 92 after 90 frames). Three agents found it
   independently. Dust was emitted, pooled and killed before surviving a draw.
2. **`applyTrackCarve` used `if (w > weight[k])` against a weight saturating at
   1.0**, points 3.5 m apart. Consecutive points tied at exactly 1.0 and the
   strict `>` kept whichever came first — every texel took its height from up
   to 5 m back UP the course.
3. **`carveTabletop` added the mound height twice at one index** — two loops
   sharing endpoint `iTake`. 4.2 m of rise in a 0.5 m plan step (83°), which
   arc-length resampling smeared into a centreline MULTIVALUED IN XZ.
4. **`TileableNoise` never tiled.** `fbm01` wrapped on grid size while no
   octave frequency divided it. Every "tileable" texture had a seam.
5. **The sky seam was the view ray's DERIVATIVE**, not the ray. `vDir` was
   interpolated across dome triangles; the GPU picks the cloud mip level from
   exactly that derivative, and a dome meridian projects to a straight line.
6. **`applyQuantizedFog` multiplied the discrete plateau by continuous `t`** AND
   its boundaries sat at 560/1175/1855 m while shots occupy 200–900 m. Fixing
   only the first would have changed nothing.
7. **Net roll stiffness was ~zero** — the balance loop's 2368 N·m/rad was
   cancelled by m·g·h = 2415. Roll was a free integrator.
8. **Capture poses spawned the bike origin at the trail SURFACE**, burying both
   wheels 0.27 m; the suspension answered with 14 kN. No wheel ever touched
   ground, so no tyre force solved and no dust emitted.
9. **`FOG_BANDS.strengths[0]` was 0.16** — haze at point blank, since band 0
   covers everything from lens to first boundary. This was the palette rotation
   that survived FOUR critic passes. Fog off vs on: hue 359/24% → hue 20/47%,
   against an authored 27/45%.
10. **Rider names came from `personality.name`, chips from
    `RIDER_COLORS[1 + aiIndex]`** — two independent lists. The leaderboard drew
    MAGS in blue and KESTREL in yellow in every frame.

### Standing rules
- **NEVER put a backtick inside a GLSL template-literal comment.** Cost three
  cycles. `npm run check:glsl` enforces it. **The first version of that guard
  contained the bug it exists to catch** — it treated the first backtick at
  depth zero as the close, exactly as the TS parser does, so it agreed with the
  bug and reported clean. Rewritten to scan line by line; tested against six
  cases; it caught a real one on its first outing.
- Three.js GLSL3 emits NO `pc_fragColor` and NO `gl_FragColor` alias.
- **Critics find defects reliably and attribute them unreliably.** Every agent
  that dug in disproved part of its brief: the sky seam was not the shafts, the
  camera collapse was an opponent in the lens, the trail sawtooth was ink not
  geometry, the "LOD seam" was the ribbon edge, the ridgeline detector was
  innocent and two downstream multipliers were eating it.
- **Agents measure in isolation and can be wrong about the shipped build.**
  Verify through the real capture path.

---

## OPEN DEFECTS (critic pass 4 — neither critic has ever passed a frame)

The eight interrupted agents were working these. Re-verify each before acting:
some may be partly fixed by the work that was salvaged.

**Rider** (`src/rider/*`) — feet never on the pedals, in any frame (both feet
simultaneously at the bottom of the stroke, impossible on opposed cranks); the
rider does not inherit the bike's roll (bike 40°, spine 0–5°) or yaw (70–90°
mismatch); no pedalling animation (knee frozen 233 ms under `pedal: 1`); legs
end mid-shin in chase view; a hand leaves the bars outside a crash; the BACK of
the helmet renders as a face at >120 px; the crash is a 167 ms pose swap and
both riders play the same mirrored canned splay.

**Physics** (`src/bike/*`) — full steer lock for 2 s produces ZERO heading
change; the lean is cosmetic and decoupled from yaw rate. −7.97 m/s² coasting
downhill and +16.7 m/s² (1.7 g) accelerating. The crash tail creeps 1→7 km/h.
**The ravine gap is not clearable** — the rider launches off a natural rollover
before it, peaks at 7.7 m, falls past the far lip and accelerates to 150 km/h
inside the mountain. (The tabletop was fixed the same way and now gives 8.4 m
of flight; the ravine needs the equivalent.) An interrupted agent had added
`mechanicalTrail`/`pneumaticTrail` — the self-aligning-torque terms that couple
lean to yaw — which is the right shape of fix for the steering defect.

**Camera** (`src/fx/CameraDirector.ts`) — frame-to-frame pixel delta is FLAT at
3.1–3.8 as speed rises 19%; the picture changes *less* as the rider goes
faster. No whip, FOV kick, swing-around or slow-mo visible in any sequence.
`switchback` boom now too tight (subject clipped off the bottom). `crash` loses
the player outright from f0056.

**FX** (`src/fx/DustSystem.ts` etc.) — dust emits ~1.5 m above the contact
patch, never dissipates, and none at all on the crash impact frames. Impact
flash fires 267–433 ms after the impact it should punctuate, and brightens only
the left half of frame. (Wheel smear now works — onset raised from 14 rad/s,
which was 13 km/h, to 37; at 70 km/h the tyre is a solid band.)

**Terrain** (`src/terrain/TerrainMaterial.ts`, `Zones.ts`) — the banding fix
"fixed the column that was measured": it holds on `treeline-silhouette` x=1100
and NOT on `rockgarden-low` x=2400 (zero steps >10 across 350 rows) or `crash`
x=2400. Must hold on six columns across four frames including untuned ones.
Water still reads as cold slate (14–30% saturation vs authored 48%). Residual
snow stipple in `finish-sprint` (11.4% vs 1.8–6.1% elsewhere).

**Scatter** (`src/terrain/Scatter.ts`) — streambed boulders are EXPLODED MESH:
interpenetrating flat triangles with no shared hull, strokes terminating in
open air, solid violet wedges up to 112 px shooting into space. Rocks elsewhere
read as wireframe. Both likely one cause: the outline weld not running on
carved instances, so `aCurvature` is absent and every edge gets full weight.

**Lines** (`src/npr/passes/LinesPass.ts`) — stray needle strokes and closed
polygons inked on flat ground (chunk seams and the new world-space tonal octave
boundaries are being outlined); concentric rings on the helmet dome.

**Sky** (`src/npr/Sky.ts`) — shafts/radial wash are the largest smooth gradient
in the build (55 luminance units, zero steps >6, across 1050 px). A 285–475 px
orange slab floats above the terrain horizon. Cloud confetti (14 sub-20 px
fragments in one crop).

**HUD** — the profile marker collides with itself at 76%. NOBODY IS ASSIGNED.

**Closest to the bar:** `bike-detail` and `ridge-exposure`.
**Confirmed fixed, do not touch again:** ridgeline contour ink, distance
identity, motion smear state leak, cloud form, snow stipple, trail carve,
ribbon normals, sky vertical seams, HUD text collisions, corner preview.

---

## NOT STARTED
- **Performance pass.** Target is locked 60 fps at retina on an M5 Pro. Only
  measurement so far: the MAIN PASS costs 22 ms (187 casters, 195 prepass
  meshes) against 0.025 ms for lines and 3.77 ms for shadows. That is ~45 fps
  and the cost is the main pass, not the effects. Shadow VRAM ~168 MB after the
  4096 cascade change.
- **Audio has never been listened to.**
- **Replay / biggest-air cinematic** wired, never exercised.

---

## Next actions, in order

1. Relaunch the eight agents (briefs are in the conversation; each needs to be
   told where its predecessor stopped and to read its own diff first).
2. Re-run both critics on a fresh full capture.
3. HUD profile marker collision — unassigned.
4. **The performance pass.** Never measured in a real session and the main pass
   is already over budget.
