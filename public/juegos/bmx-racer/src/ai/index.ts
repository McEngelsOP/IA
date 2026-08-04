/**
 * The race subsystem's public face.
 *
 * The orchestrator builds one of these and then only ever calls four methods on
 * it: fixedUpdate, updateVisual, getHudModel, and one of the phase transitions.
 * Everything else — the AI, the ghost, the replay, positions, gaps, contacts —
 * is internal.
 *
 * Note the factory-injection shape. This subsystem constructs IBike and
 * IRiderRig instances but owns neither implementation, so it takes functions
 * that make them. That is what lets it compile and run against whatever the
 * physics and rig agents have landed at any given moment, including stubs.
 */

export { RaceDirector, RUBBER_BAND, trickLabel } from './RaceDirector';
export type { RaceDeps, RacerSpec, BikeFactory, RigFactory } from './RaceDirector';

export { AIRider, RacerBase, TrackTracker, TrickDriver, zeroInput } from './AIRider';
export type { AIRiderInit, RacerInit } from './AIRider';

export { PlayerRacer } from './PlayerRacer';
export type { PlayerRacerInit } from './PlayerRacer';

export {
  PERSONALITIES,
  PersonalityKind,
  DEFAULT_GRID,
  rollRunForm,
  cautionScalar,
} from './Personality';
export type { Personality, RunForm } from './Personality';

export { Ghost, GHOST_HZ, encodeGhost, decodeGhost } from './Ghost';
export type { GhostData, GhostOptions, GhostVisual } from './Ghost';

export {
  Replay,
  REPLAY_HZ,
  TRICK_IDS,
  trickId,
  trickFromId,
  packFlags,
  RF_GROUNDED,
  RF_AIRBORNE,
  RF_CRASHING,
  RF_BOOSTING,
  RF_LANDED,
  RF_MANUAL,
  RF_FINISHED,
} from './Replay';
export type { AirWindow } from './Replay';

import { RaceDirector, RaceDeps } from './RaceDirector';

/**
 * Build the race. Deterministic for a given seed: the same seed produces the
 * same grid, the same personalities, the same per-run form and the same mistake
 * schedule, which is what the capture harness depends on.
 */
export function createRace(deps: RaceDeps): RaceDirector {
  return new RaceDirector(deps);
}
