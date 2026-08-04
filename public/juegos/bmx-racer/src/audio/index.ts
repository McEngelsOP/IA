/**
 * The audio subsystem. Everything you hear is synthesised here at runtime —
 * there is not one sample file in the project.
 */

export { AudioEngine } from './AudioEngine';
export type { AudioOptions } from './AudioEngine';

export {
  MasterBus,
  NoiseBank,
  WindVoice,
  TyreVoice,
  DrivetrainVoice,
  SuspensionPool,
  ImpactPool,
  HornVoice,
  BoostVoice,
  UiPool,
  Smooth,
  strike,
  swell,
  pitchDrop,
} from './Synths';
export type { SurfaceTone, UiKind, NoiseKind } from './Synths';
