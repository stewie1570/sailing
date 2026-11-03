import { useSyncExternalStore } from 'react'

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
  // Low is aimed at a Mali tablet. The water shader is the simple one, the grid is coarser,
  // and a sustained miss can also shrink the drawing buffer (see pixelScale).
  low: { maxDpr: 1, terrainSegments: [192, 144], waterSegments: [96, 72], treeFraction: 0.3, anisotropy: 1, fineDetail: false },
  medium: { maxDpr: 1.5, terrainSegments: [384, 288], waterSegments: [160, 120], treeFraction: 1, anisotropy: 2, fineDetail: true },
  high: { maxDpr: 2, terrainSegments: [512, 384], waterSegments: [224, 168], treeFraction: 1, anisotropy: 4, fineDetail: true },
}

const STORAGE_KEY = 'sailing.quality'
const PIXEL_KEY = 'sailing.pixels'

/** Drawing-buffer scale used on the low preset when the GPU is still missing frames. */
export const PIXEL_STEPS = [1, 0.8, 0.67] as const
export type PixelScale = (typeof PIXEL_STEPS)[number]

function initialPixelScale(): PixelScale {
  const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(PIXEL_KEY) : null
  if (saved === '0.8' || saved === '0.67') return saved === '0.8' ? 0.8 : 0.67
  return 1
}

function initialQuality(): QualityLevel {
  const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null
  if (saved === 'low' || saved === 'medium' || saved === 'high') return saved
  // Older tablets: fewer cores and a coarse DPR usually means a weaker GPU. Start low and let adaptive
  // quality stay there if it is needed; users can override from the HUD.
  const cores = navigator.hardwareConcurrency ?? 4
  const isTouchTablet = navigator.maxTouchPoints > 1
  return cores <= 4 && isTouchTablet ? 'low' : 'medium'
}

let quality: QualityLevel = initialQuality()
let pixelScale: PixelScale = initialPixelScale()
const listeners = new Set<() => void>()

function publish() {
  listeners.forEach((l) => l())
}

export function getPixelScale() {
  return pixelScale
}

export function usePixelScale(): PixelScale {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb) },
    () => pixelScale,
  )
}

/**
 * One step smaller than the current low-preset buffer. Stops at the last step.
 * Remembered so the next launch does not spend several seconds at the slow size.
 */
export function tightenPixels() {
  const index = PIXEL_STEPS.indexOf(pixelScale)
  const next = PIXEL_STEPS[index + 1]
  if (!next) return false
  pixelScale = next
  localStorage.setItem(PIXEL_KEY, String(pixelScale))
  publish()
  return true
}

export function setQuality(level: QualityLevel) {
  // Choosing low again clears a remembered shrink, so the picture can come back.
  if (level === quality) {
    if (level !== 'low' || pixelScale === 1) return
    pixelScale = 1
    localStorage.removeItem(PIXEL_KEY)
    publish()
    return
  }
  quality = level
  localStorage.setItem(STORAGE_KEY, level)
  if (level !== 'low' && pixelScale !== 1) {
    pixelScale = 1
    localStorage.removeItem(PIXEL_KEY)
  }
  publish()
}

export function useQuality(): QualityLevel {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb) },
    () => quality,
  )
}

export function getQuality() { return quality }

/** Frame statistics written from inside the render loop and polled by the HUD. */
export const perf = { fps: 0, frameMs: 0, drawCalls: 0, triangles: 0 }
