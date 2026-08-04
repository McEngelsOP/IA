/**
 * The course.
 *
 * `createTrack(terrain)` builds everything: the centreline, the carve handed
 * back to the terrain, the ribbon mesh, the checkpoints and all the furniture.
 *
 * The build order matters and is enforced here rather than left to the caller:
 *
 *   1. Fit the spline to the FINAL eroded terrain.
 *   2. Hand the carve to the terrain so it flattens a corridor under the trail.
 *   3. Only THEN build the ribbon and the furniture, because both sample the
 *      terrain again for their skirts and post bases and want the flattened
 *      corridor, not the pre-carve hillside.
 *
 * Getting that order wrong produces a trail that floats over its own carve at
 * the edges, which shows up as a hairline of sky under the ribbon on a low
 * camera and is very hard to diagnose after the fact.
 */

import { Group, Object3D, Vector3 } from 'three';

import {
  Checkpoint,
  ITerrain,
  ITrack,
  TrackCarve,
  TrackSampleResult,
  TrackSectionKind,
} from '../game/Contracts';
import { RACER_COUNT, RACE_LENGTH, START_SPACING } from '../game/WorldConstants';
import { TrackSpline, TrackProjection, SectionRange, createTrackSample } from './TrackSpline';
import { TrackRibbon } from './TrackRibbon';
import { Furniture } from './Furniture';
import { Checkpoints, CornerPreview, CheckpointEvent, RacerTracker } from './Checkpoints';

export { TrackSpline, createTrackSample } from './TrackSpline';
export type { TrackProjection, SectionRange, TrackGap } from './TrackSpline';
export { TrackRibbon } from './TrackRibbon';
export { Furniture } from './Furniture';
export { Checkpoints, RacerTracker } from './Checkpoints';
export type { CornerPreview, CheckpointEvent } from './Checkpoints';

export interface CreateTrackOptions {
  /** Set false if the caller wants to apply the carve itself. Default true. */
  applyCarve?: boolean;
  /** Skip the ribbon and furniture meshes — for headless AI/physics tests. */
  geometry?: boolean;
}

/**
 * The concrete course. Implements ITrack and adds the handful of extras the
 * race director, the AI and the HUD need that the frozen interface does not
 * cover: per-racer trackers, the corner preview, and the start grid.
 */
export class Track implements ITrack {
  readonly object: Object3D = new Group();
  readonly spline: TrackSpline;
  readonly checkpointSystem: Checkpoints;
  readonly ribbon: TrackRibbon | null = null;
  readonly furniture: Furniture | null = null;

  constructor(terrain: ITerrain, options: CreateTrackOptions = {}) {
    this.object.name = 'track';

    this.spline = new TrackSpline(terrain, { maxLength: RACE_LENGTH });

    if (options.applyCarve !== false) {
      terrain.applyTrackCarve(this.spline.getCarve());
    }

    if (options.geometry !== false) {
      this.ribbon = new TrackRibbon(this.spline, terrain);
      this.object.add(this.ribbon.object);
      this.furniture = new Furniture(this.spline, terrain);
      this.object.add(this.furniture.object);
    }

    this.checkpointSystem = new Checkpoints(this.spline);
  }

  // ── ITrack ─────────────────────────────────────────────────────────────────

  get length(): number {
    return this.spline.length;
  }

  get checkpoints(): Checkpoint[] {
    return this.checkpointSystem.gates;
  }

  sampleAtDistance(d: number, out?: TrackSampleResult): TrackSampleResult {
    return this.spline.sampleAtDistance(d, out);
  }

  sampleAtT(t: number, out?: TrackSampleResult): TrackSampleResult {
    return this.spline.sampleAtT(t, out);
  }

  project(position: Vector3, hintDistance?: number): TrackProjection {
    return this.spline.project(position, hintDistance);
  }

  getCarve(): TrackCarve {
    return this.spline.getCarve();
  }

  // ── Extras ─────────────────────────────────────────────────────────────────

  get sectionRanges(): SectionRange[] {
    return this.spline.sectionRanges;
  }

  sectionAt(distance: number): TrackSectionKind {
    return this.spline.sectionAt(distance);
  }

  /** True where there is no ground under the centreline — the ravine. */
  isGap(distance: number): boolean {
    return this.spline.isGap(distance);
  }

  createTracker(id: string): RacerTracker {
    return this.checkpointSystem.createTracker(id);
  }

  /** Advance one racer's progress. Returns the gate event fired, or null. */
  updateRacer(
    tracker: RacerTracker,
    position: Vector3,
    velocity: Vector3,
    raceTime: number,
    dt: number,
  ): CheckpointEvent | null {
    return this.checkpointSystem.update(tracker, position, velocity, raceTime, dt);
  }

  cornerPreview(distance: number, out?: CornerPreview): CornerPreview | null {
    return this.checkpointSystem.cornerPreview(distance, out);
  }

  /** Elevation samples for the HUD route profile, in world metres. */
  elevationProfile(samples = 256): Float32Array {
    return this.spline.elevationProfile(samples);
  }

  /**
   * Start grid. Riders line up abreast just behind the start gate, centred on
   * the trail, with the outer two pulled in if the trail is narrower than the
   * grid would like.
   */
  startTransform(
    index: number,
    outPosition: Vector3,
    outForward: Vector3,
    count = RACER_COUNT,
  ): void {
    const d = 1.0;
    const s = this.spline.sampleAtDistance(d);
    const spread = Math.min(START_SPACING, (s.halfWidth * 1.7) / Math.max(1, count - 1));
    const lateral = (index - (count - 1) * 0.5) * spread;
    this.spline.surfaceLeftAt(d, outPosition);
    outPosition.multiplyScalar(lateral).add(s.position);
    outForward.copy(s.tangent);
  }

  dispose(): void {
    this.ribbon?.dispose();
    this.furniture?.dispose();
    this.spline.dispose();
    this.object.clear();
  }
}

export function createTrack(terrain: ITerrain, options: CreateTrackOptions = {}): Track {
  return new Track(terrain, options);
}
