/**
 * RenderLists — one traversal, three render lists, zero per-frame allocation.
 *
 * The shadow cascades and the G-buffer prepass both need to draw a SUBSET of
 * the scene with a DIFFERENT material per mesh. three has exactly one clean
 * mechanism for "draw a subset" — layers — and exactly one for "draw with a
 * different material" — assigning `mesh.material`. This module is the bridge.
 *
 * Two things worth stating, because both are easy to get wrong:
 *
 *  • Layers are assigned once, at refresh time, and then cost nothing. The
 *    alternative (toggling `visible` on every non-caster before each of the
 *    three geometry passes) is thousands of property writes per frame for the
 *    same result. Layers 29 and 30 are used because the low layers belong to
 *    gameplay code and nobody reaches that high.
 *
 *  • The material swap is done over a cached array and restored in a `finally`,
 *    so an exception inside a pass cannot leave the scene rendering as depth.
 *    A pipeline that leaves the world flat-shaded after one bad frame is the
 *    kind of bug that costs an afternoon.
 *
 * Refresh is NOT free (it is a full scene traversal), so it runs on an interval
 * and on demand rather than every frame. A mesh added to the scene starts
 * casting shadows within `refreshInterval` frames; for anything that appears
 * mid-race that is well under a tenth of a second, and FX — the only things
 * that spawn continuously — are excluded from both lists anyway.
 */

import { DoubleSide, Material, Mesh, Object3D, Scene, Side } from 'three';

/** Meshes visible to the sun cascades. */
export const LAYER_SHADOW = 29;
/** Meshes visible to the G-buffer prepass. */
export const LAYER_PREPASS = 30;

export class SceneRegistry {
  readonly casters: Mesh[] = [];
  readonly prepass: Mesh[] = [];

  /** Set to force a rebuild on the next `maybeRefresh`. */
  private dirty = true;
  private sinceRefresh = 1e9;
  private lastRootCount = -1;

  /** Frames between automatic rebuilds. Raise it if traversal shows up hot. */
  refreshInterval = 4;

  private savedCasterMaterials: (Material | Material[])[] = [];
  private savedPrepassMaterials: (Material | Material[])[] = [];

  readonly stats = { casters: 0, prepass: 0, traversals: 0 };

  invalidate(): void {
    this.dirty = true;
  }

  maybeRefresh(scene: Scene): void {
    this.sinceRefresh++;
    // A change in the number of top-level children is the cheapest possible
    // signal that a subsystem has attached or detached something.
    if (scene.children.length !== this.lastRootCount) this.dirty = true;
    if (!this.dirty && this.sinceRefresh < this.refreshInterval) return;
    this.refresh(scene);
  }

  refresh(scene: Scene): void {
    this.casters.length = 0;
    this.prepass.length = 0;
    scene.traverse(this.visit);
    this.dirty = false;
    this.sinceRefresh = 0;
    this.lastRootCount = scene.children.length;
    this.stats.casters = this.casters.length;
    this.stats.prepass = this.prepass.length;
    this.stats.traversals++;
  }

  private visit = (o: Object3D): void => {
    const mesh = o as Mesh;
    if ((mesh as { isMesh?: boolean }).isMesh !== true) return;
    const ud = mesh.userData;

    // Hulls are ink, not geometry. They must never appear in the G-buffer (the
    // interior-line pass reads it as though the hull did not exist — that is
    // precisely what makes the hull-suppression test work) and never in the
    // shadow map (a hull casts a shadow 2px larger than its mesh, which shows
    // up as a dark fringe around every contact shadow).
    if (ud.isHull === true) {
      mesh.layers.disable(LAYER_SHADOW);
      mesh.layers.disable(LAYER_PREPASS);
      return;
    }

    const shadowMat = ud.shadowMaterial as Material | undefined;
    if (shadowMat && ud.skipShadow !== true) {
      // Per-mesh caster face selection. The default shadow material culls front
      // faces, which is right for closed solids (it removes acne without any
      // bias at all) and catastrophically wrong for an open sheet like a
      // heightfield — every triangle faces the sun, every triangle is culled,
      // and the mountain casts nothing. Subsystems that own open geometry
      // declare it and we honour it here.
      const side = resolveShadowSide(mesh, ud);
      if (side !== undefined && shadowMat.side !== side) shadowMat.side = side;
      mesh.layers.enable(LAYER_SHADOW);
      this.casters.push(mesh);
    } else {
      mesh.layers.disable(LAYER_SHADOW);
    }

    const prepassMat = ud.prepassMaterial as Material | undefined;
    if (prepassMat && ud.skipPrepass !== true) {
      mesh.layers.enable(LAYER_PREPASS);
      this.prepass.push(mesh);
    } else {
      mesh.layers.disable(LAYER_PREPASS);
    }
  };

  swapToShadow(): void {
    const list = this.casters;
    const saved = this.savedCasterMaterials;
    saved.length = list.length;
    for (let i = 0; i < list.length; i++) {
      const m = list[i];
      saved[i] = m.material;
      m.material = m.userData.shadowMaterial as Material;
    }
  }

  restoreFromShadow(): void {
    const list = this.casters;
    const saved = this.savedCasterMaterials;
    for (let i = 0; i < list.length; i++) list[i].material = saved[i];
  }

  swapToPrepass(): void {
    const list = this.prepass;
    const saved = this.savedPrepassMaterials;
    saved.length = list.length;
    for (let i = 0; i < list.length; i++) {
      const m = list[i];
      saved[i] = m.material;
      m.material = m.userData.prepassMaterial as Material;
    }
  }

  restoreFromPrepass(): void {
    const list = this.prepass;
    const saved = this.savedPrepassMaterials;
    for (let i = 0; i < list.length; i++) list[i].material = saved[i];
  }
}

function resolveShadowSide(mesh: Mesh, ud: Record<string, unknown>): Side | undefined {
  if (typeof ud.shadowSide === 'number') return ud.shadowSide as Side;
  if (ud.shadowDoubleSided === true) return DoubleSide;
  const mat = mesh.material as Material | Material[];
  const first = Array.isArray(mat) ? mat[0] : mat;
  // A surface authored double-sided in the main pass is, by definition, an
  // open sheet — canopy cards, cloth panels, water. Cast it double-sided too.
  if (first && first.side === DoubleSide) return DoubleSide;
  return undefined;
}
