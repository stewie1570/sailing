import { useSyncExternalStore } from 'react'

/**
 * Two azimuth pods. Azimuth is the direction a positive thrust pushes the
 * hull: 0 is ahead, positive rotates that push toward port. Thrust is
 * signed along that heading, so astern does not require spinning the pod
 * through half a turn.
 */
export interface Pods {
  bowAz: number
  sternAz: number
  /** −1 full astern, 0 stop, +1 full ahead, along the current azimuth. */
  bowThrust: number
  sternThrust: number
}

const ZERO: Pods = { bowAz: 0, sternAz: 0, bowThrust: 0, sternThrust: 0 }

let pods: Pods = ZERO
const listeners = new Set<() => void>()

function clampThrust(v: number) {
  return Math.min(1, Math.max(-1, v))
}

/** Wrap into (−π, π]. */
export function wrapAzimuth(angle: number) {
  const turn = (angle + Math.PI) % (2 * Math.PI)
  return (turn < 0 ? turn + 2 * Math.PI : turn) - Math.PI
}

export function getPods(): Pods {
  return pods
}

export function resetPods() {
  pods = { ...ZERO }
  listeners.forEach((listener) => listener())
}

export function updatePods(patch: Partial<Pods>) {
  const next: Pods = {
    bowAz: wrapAzimuth(patch.bowAz ?? pods.bowAz),
    sternAz: wrapAzimuth(patch.sternAz ?? pods.sternAz),
    bowThrust: clampThrust(patch.bowThrust ?? pods.bowThrust),
    sternThrust: clampThrust(patch.sternThrust ?? pods.sternThrust),
  }
  if (
    next.bowAz === pods.bowAz &&
    next.sternAz === pods.sternAz &&
    next.bowThrust === pods.bowThrust &&
    next.sternThrust === pods.sternThrust
  ) {
    return
  }
  pods = next
  listeners.forEach((listener) => listener())
}

export function usePods(): Pods {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => pods,
  )
}

/**
 * Azimuth from a pointer dragged on the dial.
 * `dx` is to the right, `dy` is down, both from the dial centre.
 * Up is ahead. Left is port, which is the positive azimuth.
 */
export function azimuthFromPointer(dx: number, dy: number) {
  if (dx * dx + dy * dy < 1e-6) return 0
  return wrapAzimuth(-Math.atan2(dx, -dy))
}

/** Ship-relative heading of a pod, for the readout under the dial. */
export function formatAzimuth(angle: number) {
  const deg = Math.round((wrapAzimuth(angle) * 180) / Math.PI)
  const turn = (deg + 360) % 360
  if (turn === 0) return 'Ahead'
  if (turn === 180) return 'Astern'
  if (turn < 180) return `Port ${turn}°`
  return `Stbd ${360 - turn}°`
}

export function formatThrust(value: number) {
  if (Math.abs(value) < 0.125) return 'Stop'
  const mag = Math.abs(value)
  const step = mag >= 0.875 ? 'Full' : mag >= 0.625 ? 'Half' : mag >= 0.375 ? 'Slow' : 'Dead slow'
  return `${step} ${value > 0 ? 'ahead' : 'astern'}`
}
