/**
 * NprGlobals — one shared uniform block for the entire render.
 *
 * Every cel material in the game holds a *reference* to the same uniform
 * objects declared here. That means the per-frame update writes the sun
 * direction (or the time, or the shadow matrices) exactly once, no matter how
 * many hundreds of materials exist. It also makes it structurally impossible
 * for two materials to disagree about the lighting — which is the usual way a
 * hand-rolled NPR pipeline starts to look incoherent.
 */

import {
  Camera,
  Color,
  IUniform,
  Matrix4,
  Texture,
  Vector2,
  Vector3,
} from 'three';
import { FOG_BANDS, GRADE, SKY, SUN_COLOR, SUN_DIRECTION, SKY_BOUNCE, GROUND_BOUNCE } from './Palette';

export interface GlobalUniforms {
  uSunDir: IUniform<Vector3>;
  uSunColor: IUniform<Color>;
  uSkyBounce: IUniform<Color>;
  uGroundBounce: IUniform<Color>;
  uAmbient: IUniform<number>;
  uTime: IUniform<number>;
  uResolution: IUniform<Vector2>;
  uCameraPos: IUniform<Vector3>;

  uFogColors: IUniform<Color[]>;
  uFogStrengths: IUniform<number[]>;
  uFogNear: IUniform<number>;
  uFogFar: IUniform<number>;
  uFogSunTint: IUniform<Color>;
  uFogSunTintStrength: IUniform<number>;

  uHatchTex: IUniform<Texture | null>;
  uHatchGlobal: IUniform<number>;
  uMatcapMetal: IUniform<Texture | null>;
  uMatcapSkin: IUniform<Texture | null>;

  uShadowMap0: IUniform<Texture | null>;
  uShadowMap1: IUniform<Texture | null>;
  uShadowMat0: IUniform<Matrix4>;
  uShadowMat1: IUniform<Matrix4>;
  uShadowSplit: IUniform<number>;
  uShadowTexel: IUniform<Vector2>;
  /** World size of one shadow texel in each cascade, metres. */
  uShadowTexelWorld: IUniform<Vector2>;
  uShadowStrength: IUniform<number>;
  uShadowBias: IUniform<number>;
}

/**
 * The singleton. Constructed eagerly — the values are all cheap, and having it
 * available at module scope means material factories never need an init order.
 */
export const NPR: GlobalUniforms = {
  uSunDir: { value: SUN_DIRECTION.clone() },
  uSunColor: { value: SUN_COLOR.clone() },
  uSkyBounce: { value: SKY_BOUNCE.clone() },
  uGroundBounce: { value: GROUND_BOUNCE.clone() },
  uAmbient: { value: 0.38 },
  uTime: { value: 0 },
  uResolution: { value: new Vector2(1920, 1080) },
  uCameraPos: { value: new Vector3() },

  uFogColors: { value: FOG_BANDS.colors.map((c) => c.clone()) },
  uFogStrengths: { value: [...FOG_BANDS.strengths] },
  uFogNear: { value: FOG_BANDS.near },
  uFogFar: { value: FOG_BANDS.far },
  uFogSunTint: { value: FOG_BANDS.sunTint.clone() },
  uFogSunTintStrength: { value: FOG_BANDS.sunTintStrength },

  uHatchTex: { value: null },
  uHatchGlobal: { value: 1.0 },
  uMatcapMetal: { value: null },
  uMatcapSkin: { value: null },

  uShadowMap0: { value: null },
  uShadowMap1: { value: null },
  uShadowMat0: { value: new Matrix4() },
  uShadowMat1: { value: new Matrix4() },
  uShadowSplit: { value: 70 },
  uShadowTexel: { value: new Vector2(1 / 2048, 1 / 2048) },
  uShadowTexelWorld: { value: new Vector2(0.25, 1.2) },
  uShadowStrength: { value: 0.9 },
  uShadowBias: { value: 0.0016 },
};

/** Call once per frame, before rendering. */
export function updateNprGlobals(time: number, camera: Camera, width: number, height: number): void {
  NPR.uTime.value = time;
  NPR.uResolution.value.set(width, height);
  camera.getWorldPosition(NPR.uCameraPos.value);
}

/**
 * The subset of `NPR` that a cel material must splice into its uniform map.
 * Returned as a fresh object each call (so three can own the map) but the
 * IUniform values inside are the shared references — that's the whole point.
 */
export function globalUniformBlock(): Record<string, IUniform> {
  return {
    uSunDir: NPR.uSunDir,
    uSunColor: NPR.uSunColor,
    uSkyBounce: NPR.uSkyBounce,
    uGroundBounce: NPR.uGroundBounce,
    uAmbient: NPR.uAmbient,
    uTime: NPR.uTime,
    uResolution: NPR.uResolution,
    uCameraPos: NPR.uCameraPos,
    uFogColors: NPR.uFogColors,
    uFogStrengths: NPR.uFogStrengths,
    uFogNear: NPR.uFogNear,
    uFogFar: NPR.uFogFar,
    uFogSunTint: NPR.uFogSunTint,
    uFogSunTintStrength: NPR.uFogSunTintStrength,
    uHatchTex: NPR.uHatchTex,
    uHatchGlobal: NPR.uHatchGlobal,
    uMatcapMetal: NPR.uMatcapMetal,
    uMatcapSkin: NPR.uMatcapSkin,
    uShadowMap0: NPR.uShadowMap0,
    uShadowMap1: NPR.uShadowMap1,
    uShadowMat0: NPR.uShadowMat0,
    uShadowMat1: NPR.uShadowMat1,
    uShadowSplit: NPR.uShadowSplit,
    uShadowTexel: NPR.uShadowTexel,
    uShadowTexelWorld: NPR.uShadowTexelWorld,
    uShadowStrength: NPR.uShadowStrength,
    uShadowBias: NPR.uShadowBias,
  } as Record<string, IUniform>;
}

/** Sky uniforms are separate — only the dome and the fog-tint pass read them. */
export const SKY_UNIFORMS = {
  uZenith: { value: SKY.zenith.clone() },
  uUpper: { value: SKY.upper.clone() },
  uHorizon: { value: SKY.horizon.clone() },
  uBelow: { value: SKY.belowHorizon.clone() },
  uSunDisc: { value: SKY.sunDisc.clone() },
  uSunGlow: { value: SKY.sunGlow.clone() },
  uCloudLit: { value: SKY.cloudLit.clone() },
  uCloudMid: { value: SKY.cloudMid.clone() },
  uCloudShadow: { value: SKY.cloudShadow.clone() },
};

/** Global post-processing dials the game drives at runtime (impact, boost, slow-mo). */
export const POST_STATE = {
  speedLineIntensity: 0,
  speedLineFocus: new Vector2(0.5, 0.52),
  impactFlash: 0,
  impactTint: new Color(0xffffff),
  chromaticAberration: 0,
  radialBlur: 0,
  desaturate: 0,
  bloomIntensity: GRADE.bloomIntensity,
  vignette: GRADE.vignetteStrength,
  /** Set to >0 on a crash to punch the whole frame toward the ink colour. */
  inkFlood: 0,
  /**
   * Master dial on the SCREEN-SPACE interior line pass. 0 leaves only the
   * inverted-hull silhouettes, which is a legitimate look for a replay or a
   * results screen; 1 is the normal drawn read. Does not touch the hulls.
   */
  lineOpacity: 1,
  /** Paper grain amplitude in the final composite. A whisper — 0.016 default. */
  grainStrength: 0.016,
};
