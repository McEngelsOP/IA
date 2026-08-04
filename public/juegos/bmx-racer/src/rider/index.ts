/**
 * The rider rig, assembled.
 *
 * `createRiderRig` matches `RigFactory = (spec: RacerSpec) => IRiderRig` in
 * ai/RaceDirector, so the orchestrator wires a whole grid of riders with:
 *
 *     new RaceDirector({ ..., makeRig: createRiderRig, makeBike: ... });
 *
 * The rig deliberately does not require the bike at construction — RaceDirector
 * builds both from the same spec and has no ordering guarantee between them.
 * If nothing ever attaches the bike's anchors the rig falls back to deriving the
 * grips and pedals from BIKE_GEOM, which keeps the rider rideable in isolation
 * (the capture harness poses a rider with no bike at all). Wire the real anchors
 * whenever you have them — one call, any time:
 *
 *     const rig = createRiderRig(spec);
 *     attachRigToBike(rig, bike);
 */

import type { IBike, IRiderRig } from '../game/Contracts';
import type { RacerSpec } from '../ai/RaceDirector';
import { RiderRig, type RiderRigOptions } from './RiderRig';

export { RiderRig, type RiderRigOptions } from './RiderRig';
export { RiderSkeleton, REST, LIMB, RIDER_DIMS, BONE_NAMES, BONE_INDEX, type BoneName } from './Skeleton';
export {
  buildRiderMeshes,
  getRiderGeometries,
  applyRiderColors,
  type RiderMeshSet,
  type RiderMeshOptions,
  type RiderPart,
} from './RiderMesh';
export * from './Poses';
export * from './IK';

/** Deterministic per-rider phase so four riders never breathe in unison. */
function phaseFor(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) / 0xffffffff) * Math.PI * 2;
}

/** The `RigFactory` the race director takes. */
export function createRiderRig(spec: RacerSpec): IRiderRig {
  return new RiderRig({
    jersey: spec.jersey,
    accent: spec.accent,
    name: `rider:${spec.id}`,
    phase: phaseFor(spec.id),
  });
}

/** Build a rig outside a race — the capture harness and the model viewer. */
export function makeRiderRig(opts: RiderRigOptions = {}): RiderRig {
  return new RiderRig(opts);
}

/**
 * Point a rig at a bike's contact anchors. Safe to call at any time, including
 * on a rig that has already been updating against the fallback anchors.
 */
export function attachRigToBike(rig: IRiderRig, bike: IBike): void {
  (rig as RiderRig).attach?.(bike.anchors);
}
