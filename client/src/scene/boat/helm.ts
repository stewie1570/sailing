import { useEffect, useSyncExternalStore } from 'react'

export interface Helm {
  /** −1 full astern, 0 stop, +1 full ahead. */
  port: number
  starboard: number
  /** −1 hard to port, 0 rudder parallel with the hull, +1 hard to starboard. */
  rudder: number
  /** 0 rolls the main into the boom, 1 hoists it. */
  halyard: number
  /** 0 sheets the boom to the centreline, 1 eases it out to the shrouds. */
  sheet: number
  /** Jib furler. 0 is rolled onto the forestay, 1 is fully out. */
  jib: number
  /**
   * Jib sheet tightness, 0 fully eased and 1 hauled hard.
   * The two sheets share one haul: their sum never exceeds 1, so 70% tight
   * on port leaves at most 30% for starboard.
   */
  jibPort: number
  jibStarboard: number
}

export type Control = 'port' | 'starboard' | 'rudder' | 'sheet' | 'jib' | 'jibPort' | 'jibStarboard'

/** How close a released throttle must be to sit in the stop notch. */
export const NEUTRAL_GRAB = 0.07
export const NEUTRAL_RELEASE = 0.13
/** Amidships notch, narrower than the throttle stop. */
export const RUDDER_GRAB = 0.045
export const RUDDER_RELEASE = 0.08

const ZERO: Helm = { port: 0, starboard: 0, rudder: 0, halyard: 0, sheet: 0.5, jib: 0, jibPort: 0, jibStarboard: 0 }
let helm: Helm = ZERO
const listeners = new Set<() => void>()
const drag: Record<Control, boolean> = {
  port: false,
  starboard: false,
  rudder: false,
  sheet: false,
  jib: false,
  jibPort: false,
  jibStarboard: false,
}

function clamp(v: number) {
  return Math.min(1, Math.max(-1, v))
}

function clamp01(v: number) {
  return Math.min(1, Math.max(0, v))
}

export function getHelm(): Helm {
  return helm
}

/**
 * Keep the jib sheets inside a shared haul. The sheet the sailor is moving
 * stops at whatever the other one has not already taken. If both move in the
 * same update, they are scaled down together.
 */
export function limitJibSheets(
  port: number,
  starboard: number,
  portSet: boolean,
  stbdSet: boolean,
): { jibPort: number; jibStarboard: number } {
  port = clamp01(port)
  starboard = clamp01(starboard)
  if (port + starboard <= 1) return { jibPort: port, jibStarboard: starboard }
  if (portSet && !stbdSet) return { jibPort: Math.min(port, 1 - starboard), jibStarboard: starboard }
  if (stbdSet && !portSet) return { jibPort: port, jibStarboard: Math.min(starboard, 1 - port) }
  const scale = 1 / (port + starboard)
  return { jibPort: port * scale, jibStarboard: starboard * scale }
}

/** How tight this jib sheet may go, given the other sheet. */
export function jibSheetRoom(other: number) {
  return Math.min(1, Math.max(0, 1 - other))
}

export function updateHelm(patch: Partial<Helm>) {
  const sheets = limitJibSheets(
    patch.jibPort ?? helm.jibPort,
    patch.jibStarboard ?? helm.jibStarboard,
    patch.jibPort != null,
    patch.jibStarboard != null,
  )
  const next: Helm = {
    port: clamp(patch.port ?? helm.port),
    starboard: clamp(patch.starboard ?? helm.starboard),
    rudder: clamp(patch.rudder ?? helm.rudder),
    halyard: patch.halyard == null ? helm.halyard : patch.halyard >= 0.5 ? 1 : 0,
    sheet: clamp01(patch.sheet ?? helm.sheet),
    jib: clamp01(patch.jib ?? helm.jib),
    jibPort: sheets.jibPort,
    jibStarboard: sheets.jibStarboard,
  }
  if (
    next.port === helm.port &&
    next.starboard === helm.starboard &&
    next.rudder === helm.rudder &&
    next.halyard === helm.halyard &&
    next.sheet === helm.sheet &&
    next.jib === helm.jib &&
    next.jibPort === helm.jibPort &&
    next.jibStarboard === helm.jibStarboard
  ) {
    return
  }
  helm = next
  listeners.forEach((l) => l())
}

export function setControlDrag(which: Control, down: boolean) {
  drag[which] = down
}

export function controlDrag(which: Control) {
  return drag[which]
}

/** Magnetic notch. `held` widens the band so the lever stays put until it is pushed clear. */
export function detent(raw: number, held: boolean, grab: number, release: number) {
  const band = held ? release : grab
  if (Math.abs(raw) <= band) return { value: 0, held: true }
  return { value: clamp(raw), held: false }
}

export function useHelm(): Helm {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => helm,
  )
}

const THROTTLE_RATE = 0.85
const RUDDER_RATE = 1.05
const SHEET_RATE = 0.5
const KEY_HOLD_MS = 180

export type HelmMode = 'engine' | 'sailing'

function nudge(value: number, delta: number, heldUntil: number, now: number): { value: number; heldUntil: number } {
  if (delta === 0) return { value, heldUntil }
  if (value === 0 && heldUntil > now) return { value: 0, heldUntil }
  const next = clamp(value + delta)
  if ((value > 0 && next < 0) || (value < 0 && next > 0)) return { value: 0, heldUntil: now + KEY_HOLD_MS }
  return { value: next, heldUntil }
}

/**
 * On the engine tab, up and down trim both screws. On the sailing tab those
 * keys ease and harden the sheet instead. Left and right always steer.
 * Q/A and E/D still move one screw, so a keyboard can split the engines.
 */
export function useHelmKeyboard(mode: HelmMode) {
  useEffect(() => {
    const held = new Set<string>()
    const pause = { port: 0, starboard: 0, rudder: 0 }
    let raf = 0
    let last = performance.now()

    const arrowsDriveEngines = mode === 'engine'
    const drivesPort = () => (arrowsDriveEngines && (held.has('ArrowUp') || held.has('ArrowDown'))) || held.has('KeyQ') || held.has('KeyA')
    const drivesStbd = () => (arrowsDriveEngines && (held.has('ArrowUp') || held.has('ArrowDown'))) || held.has('KeyE') || held.has('KeyD')
    const drivesRudder = () => held.has('ArrowLeft') || held.has('ArrowRight')

    const release = () => {
      const h = getHelm()
      const port = !drivesPort() && !drag.port && Math.abs(h.port) <= NEUTRAL_RELEASE ? 0 : h.port
      const starboard = !drivesStbd() && !drag.starboard && Math.abs(h.starboard) <= NEUTRAL_RELEASE ? 0 : h.starboard
      const rudder = !drivesRudder() && !drag.rudder && Math.abs(h.rudder) <= RUDDER_RELEASE ? 0 : h.rudder
      updateHelm({ port, starboard, rudder })
    }

    const down = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyQ', 'KeyA', 'KeyE', 'KeyD'].includes(e.code)) return
      e.preventDefault()
      held.add(e.code)
    }
    const up = (e: KeyboardEvent) => {
      if (!held.has(e.code)) return
      held.delete(e.code)
      release()
    }
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick)
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      if (held.size === 0) return
      const h = getHelm()
      let port = h.port
      let starboard = h.starboard
      let rudder = h.rudder
      let sheet = h.sheet
      const both = arrowsDriveEngines ? (held.has('ArrowUp') ? 1 : 0) - (held.has('ArrowDown') ? 1 : 0) : 0
      const portDelta = both + (held.has('KeyQ') ? 1 : 0) - (held.has('KeyA') ? 1 : 0)
      const stbdDelta = both + (held.has('KeyE') ? 1 : 0) - (held.has('KeyD') ? 1 : 0)
      const rudderDelta = (held.has('ArrowRight') ? 1 : 0) - (held.has('ArrowLeft') ? 1 : 0)
      const sheetDelta = arrowsDriveEngines ? 0 : (held.has('ArrowUp') ? 1 : 0) - (held.has('ArrowDown') ? 1 : 0)
      if (!drag.port && portDelta !== 0) {
        const step = nudge(port, portDelta * THROTTLE_RATE * dt, pause.port, now)
        port = step.value
        pause.port = step.heldUntil
      }
      if (!drag.starboard && stbdDelta !== 0) {
        const step = nudge(starboard, stbdDelta * THROTTLE_RATE * dt, pause.starboard, now)
        starboard = step.value
        pause.starboard = step.heldUntil
      }
      if (!drag.rudder && rudderDelta !== 0) {
        const step = nudge(rudder, rudderDelta * RUDDER_RATE * dt, pause.rudder, now)
        rudder = step.value
        pause.rudder = step.heldUntil
      }
      if (!drag.sheet && sheetDelta !== 0) sheet = clamp01(sheet + sheetDelta * SHEET_RATE * dt)
      updateHelm({ port, starboard, rudder, sheet })
    }

    const blur = () => {
      held.clear()
      release()
    }
    window.addEventListener('keydown', down, true)
    window.addEventListener('keyup', up, true)
    window.addEventListener('blur', blur)
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('keydown', down, true)
      window.removeEventListener('keyup', up, true)
      window.removeEventListener('blur', blur)
    }
  }, [mode])
}
