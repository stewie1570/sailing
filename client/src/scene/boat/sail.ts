import { useSyncExternalStore } from 'react'

/**
 * Main sheet, in degrees, across the boom's aft semicircle.
 * 0 is perpendicular to port, 90 is the boom on the centreline pointing aft,
 * 180 is perpendicular to starboard — the travel a mainsheet actually allows.
 */
export const MAIN_SHEET_MIN = 0
export const MAIN_SHEET_MAX = 180
export const MAIN_SHEET_CENTER = 90

export interface SailState {
  /** True when the main is hoisted (out); false when it is lowered (in). */
  mainOut: boolean
  /** Sheet angle in degrees. See {@link MAIN_SHEET_MIN}. */
  mainSheet: number
}

let state: SailState = { mainOut: false, mainSheet: MAIN_SHEET_CENTER }
const listeners = new Set<() => void>()

function emit() {
  listeners.forEach((l) => l())
}

export function getSail(): SailState {
  return state
}

export function setMainOut(out: boolean) {
  if (state.mainOut === out) return
  state = { ...state, mainOut: out }
  emit()
}

export function setMainSheet(deg: number) {
  const mainSheet = Math.min(MAIN_SHEET_MAX, Math.max(MAIN_SHEET_MIN, deg))
  if (mainSheet === state.mainSheet) return
  state = { ...state, mainSheet }
  emit()
}

/** Boom yaw in radians. Positive swings the boom to port; 0 keeps it on the centreline. */
export function boomYawFromSheet(sheetDeg: number): number {
  return ((MAIN_SHEET_CENTER - sheetDeg) * Math.PI) / 180
}

function subscribe(cb: () => void) {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export function useSail(): SailState {
  return useSyncExternalStore(subscribe, getSail, getSail)
}
