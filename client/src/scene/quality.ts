/** The view never redraws faster than this. Thirty is enough for the water and the camera. */
export const MAX_FPS = 30

export type QualityLevel = 'low' | 'medium' | 'high'

export interface QualityPreset {
  /** Max device pixel ratio. The single biggest lever on fill-rate bound tablets. */
  maxDpr: number
  /** Terrain grid resolution (quads along x / z). */
  terrainSegments: [number, number]
  /** Water surface grid resolution; only drives the large swell displacement. */
  waterSegments: [number, number]
  /** Fraction of generated trees to draw. */
  treeFraction: number
  anisotropy: number
  /** Second, finer detail texture tap on the terrain. */
  fineDetail: boolean
}

export const QUALITY_PRESETS: Record<QualityLevel, QualityPreset> = {
  low: { maxDpr: 1, terrainSegments: [256, 192], waterSegments: [96, 72], treeFraction: 0.45, anisotropy: 1, fineDetail: false },
  medium: { maxDpr: 1.5, terrainSegments: [384, 288], waterSegments: [160, 120], treeFraction: 1, anisotropy: 2, fineDetail: true },
  high: { maxDpr: 2, terrainSegments: [512, 384], waterSegments: [224, 168], treeFraction: 1, anisotropy: 4, fineDetail: true },
}

// A previous build remembered a shrunken drawing buffer, and a chosen quality level.
// The picture is fixed at low now.
if (typeof localStorage !== 'undefined') {
  localStorage.removeItem('sailing.pixels')
  localStorage.removeItem('sailing.quality')
}

/** The picture is fixed at low. */
const quality: QualityLevel = 'low'

export function useQuality(): QualityLevel {
  return quality
}

/** Frame statistics written from inside the render loop and polled by the HUD. */
export const perf = { fps: 0, frameMs: 0, drawCalls: 0, triangles: 0 }
