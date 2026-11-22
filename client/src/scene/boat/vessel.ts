import { useSyncExternalStore } from 'react'

/** Which hull this helm is driving. Each sailor picks their own. */
export type VesselKind = 'sail' | 'ferry'

const KEY = 'sailing.vessel'

/** 14 m cruising sloop. The slip catalogue uses these, not the loft. */
export const SAIL_LOA = 14
export const SAIL_BEAM = 4.4

/**
 * Double-ended vehicle ferry, about three times the sloop and a little
 * under three times the beam, so it still reads against the same marina.
 */
export const FERRY_LOA = 46
export const FERRY_BEAM = 12

export interface VesselView {
  /** Metres the chase camera sits astern. */
  back: number
  /** Metres above the water. */
  height: number
  /** Look-at height above the water, on the hull. */
  look: number
  minDistance: number
}

const SAIL_VIEW: VesselView = { back: 12, height: 5.2, look: 1.15, minDistance: 4.5 }
const FERRY_VIEW: VesselView = { back: 38, height: 16, look: 3.6, minDistance: 12 }

export function vesselView(kind: VesselKind): VesselView {
  return kind === 'ferry' ? FERRY_VIEW : SAIL_VIEW
}

export function vesselKind(raw: unknown): VesselKind {
  return raw === 'ferry' ? 'ferry' : 'sail'
}

function loadKind(): VesselKind {
  try {
    return vesselKind(localStorage.getItem(KEY))
  } catch {
    return 'sail'
  }
}

let kind: VesselKind = loadKind()
const listeners = new Set<() => void>()

export function getVessel(): VesselKind {
  return kind
}

/** Remembered on this device. The outing reads it when the lake mounts. */
export function setVessel(next: VesselKind) {
  if (next === kind) return
  kind = next
  try {
    localStorage.setItem(KEY, next)
  } catch {
    /* private mode */
  }
  listeners.forEach((listener) => listener())
}

export function useVessel(): VesselKind {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => kind,
  )
}
