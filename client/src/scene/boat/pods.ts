import { useSyncExternalStore } from 'react'

/**
 * Two azimuth pods. Azimuth is the direction a positive thrust pushes the
 * hull: 0 is ahead, positive rotates that push toward port.
 *
 * The bridge lever sits on a hemisphere. Where it is placed is the whole
 * command: the direction from the centre is the azimuth, and the distance
 * from the centre is the thrust, from stop to full. Astern is the lever
 * (or the stick) pulled back, which is azimuth π and a positive thrust.
 * The dynamics still accept a negative thrust along a held azimuth.
 */
export interface Pods {
  bowAz: number
  sternAz: number
  /** −1 full astern, 0 stop, +1 full ahead, along the current azimuth. */
  bowThrust: number
  sternThrust: number
  /**
   * Where the pod is actually pointing. It chases the lever.
   * Missing means the pod is already on the commanded azimuth.
   */
  bowAim?: number
  sternAim?: number
}

const ZERO: Pods = { bowAz: 0, sternAz: 0, bowThrust: 0, sternThrust: 0, bowAim: 0, sternAim: 0 }

/**
 * How fast a pod can yaw, in radians per second.
 * A half turn takes a little over two seconds, so the mark on the dome
 * is visibly chasing the lever.
 */
export const POD_SLEW = Math.PI / 2.2

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
    bowAim: wrapAzimuth(patch.bowAim ?? pods.bowAim ?? pods.bowAz),
    sternAim: wrapAzimuth(patch.sternAim ?? pods.sternAim ?? pods.sternAz),
  }
  if (
    next.bowAz === pods.bowAz &&
    next.sternAz === pods.sternAz &&
    next.bowThrust === pods.bowThrust &&
    next.sternThrust === pods.sternThrust &&
    next.bowAim === pods.bowAim &&
    next.sternAim === pods.sternAim
  ) {
    return
  }
  pods = next
  listeners.forEach((listener) => listener())
}

/** Shortest-path step from `from` toward `to`, limited by `rate` radians per second. */
export function slewAzimuth(from: number, to: number, dt: number, rate = POD_SLEW) {
  const step = Math.min(Math.max(dt, 0), 0.1) * rate
  const delta = wrapAzimuth(to - from)
  if (Math.abs(delta) <= step) return wrapAzimuth(to)
  return wrapAzimuth(from + Math.sign(delta) * step)
}

/** Turn each pod toward its lever. The lever itself does not move. */
export function stepPods(dt: number) {
  const bowAim = slewAzimuth(pods.bowAim ?? pods.bowAz, pods.bowAz, dt)
  const sternAim = slewAzimuth(pods.sternAim ?? pods.sternAz, pods.sternAz, dt)
  if (bowAim === pods.bowAim && sternAim === pods.sternAim) return
  pods = { ...pods, bowAim, sternAim }
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

/** Power of a hemisphere lever, without a direction. Direction is the azimuth. */
export function formatOrder(value: number) {
  const mag = Math.abs(value)
  if (mag < 0.125) return 'Stop'
  if (mag >= 0.875) return 'Full'
  if (mag >= 0.625) return 'Half'
  if (mag >= 0.375) return 'Slow'
  return 'Dead slow'
}

/**
 * How far a stick must move before it is a command. Same band as the
 * sailboat sticks, so a resting thumb does not creep.
 */
export const POD_DEAD = 0.18

/** How fast a stick walks a lever across the dome, in radii per second at full deflection. */
export const POD_NUDGE = 0.9

export type PodEnd = 'bow' | 'stern'

/**
 * A stick, or a point dragged on the dome.
 * `x` is to the right, `y` is down. Up is ahead, left is port.
 * Null means the stick is inside the deadzone: stop, and leave the azimuth.
 */
export function podFromStick(x: number, y: number, dead = POD_DEAD) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null
  const mag = Math.hypot(x, y)
  if (mag <= dead) return null
  const thrust = Math.min(1, (mag - dead) / (1 - dead))
  return { az: azimuthFromPointer(x, y), thrust }
}

/** True while a finger is on that dome, so a stick does not fight the drag. */
const dragged: Record<PodEnd, boolean> = { bow: false, stern: false }

export function setPodDrag(end: PodEnd, down: boolean) {
  dragged[end] = down
}

export function podDrag(end: PodEnd) {
  return dragged[end]
}

export interface StickMemory {
  bow: boolean
  stern: boolean
}

/** Where the lever sits on the dome. x is right, y is down, and the rim is full thrust. */
export function leverPoint(az: number, thrust: number) {
  const mag = Math.min(1, Math.abs(thrust))
  const aim = thrust < 0 ? wrapAzimuth(az + Math.PI) : az
  return { x: -Math.sin(aim) * mag, y: -Math.cos(aim) * mag }
}

/**
 * Walk the lever in the stick's direction and leave it there.
 * A centred stick returns null, so the lever stays put.
 */
export function nudgePod(
  az: number,
  thrust: number,
  stickX: number,
  stickY: number,
  dt: number,
  rate = POD_NUDGE,
) {
  const mag = Math.hypot(stickX, stickY)
  if (mag <= POD_DEAD || !(dt > 0)) return null
  const gain = Math.min(1, (mag - POD_DEAD) / (1 - POD_DEAD))
  const step = gain * rate * dt
  const point = leverPoint(az, thrust)
  let x = point.x + (stickX / mag) * step
  let y = point.y + (stickY / mag) * step
  let reach = Math.hypot(x, y)
  if (reach > 1) {
    x /= reach
    y /= reach
    reach = 1
  }
  // Landing on the centre is stop. A step that leaves the centre is kept:
  // one frame from stop is shorter than this radius, and snapping it put the
  // lever straight back.
  const previous = Math.hypot(point.x, point.y)
  if (reach < 0.02 && reach <= previous) return { thrust: 0 }
  return { az: azimuthFromPointer(x, y), thrust: reach }
}

/**
 * Left stick (axes 0 and 1) is the bow pod. Right stick (axes 2 and 3) is
 * the stern. With active sticks, a point outside the deadzone places that
 * lever, and letting it spring back stops the thrust and leaves the azimuth.
 * Without them, the stick walks the lever and a centred stick leaves it.
 * A stick that has not moved does not clear a lever set with the pointer.
 */
export function ferryStickPatch(
  axes: ArrayLike<number>,
  memory: StickMemory,
  dragging: Record<PodEnd, boolean> = dragged,
  active = true,
  dt = 0,
  current: Pods = getPods(),
): Partial<Pods> {
  const patch: Partial<Pods> = {}
  if (active) {
    take(patch, memory, 'bow', dragging.bow, podFromStick(axes[0] ?? 0, axes[1] ?? 0))
    take(patch, memory, 'stern', dragging.stern, podFromStick(axes[2] ?? 0, axes[3] ?? 0))
    return patch
  }
  walk(patch, 'bow', dragging.bow, axes[0] ?? 0, axes[1] ?? 0, dt, current)
  walk(patch, 'stern', dragging.stern, axes[2] ?? 0, axes[3] ?? 0, dt, current)
  return patch
}

function walk(
  patch: Partial<Pods>,
  end: PodEnd,
  skip: boolean,
  stickX: number,
  stickY: number,
  dt: number,
  current: Pods,
) {
  if (skip) return
  const az = end === 'bow' ? current.bowAz : current.sternAz
  const thrust = end === 'bow' ? current.bowThrust : current.sternThrust
  const moved = nudgePod(az, thrust, stickX, stickY, dt)
  if (!moved) return
  const azKey = end === 'bow' ? 'bowAz' : 'sternAz'
  const thrustKey = end === 'bow' ? 'bowThrust' : 'sternThrust'
  if (moved.az != null) patch[azKey] = moved.az
  patch[thrustKey] = moved.thrust
}

function take(
  patch: Partial<Pods>,
  memory: StickMemory,
  end: PodEnd,
  skip: boolean,
  command: { az: number; thrust: number } | null,
) {
  if (skip) return
  const azKey = end === 'bow' ? 'bowAz' : 'sternAz'
  const thrustKey = end === 'bow' ? 'bowThrust' : 'sternThrust'
  if (command) {
    memory[end] = true
    patch[azKey] = command.az
    patch[thrustKey] = command.thrust
    return
  }
  if (!memory[end]) return
  memory[end] = false
  patch[thrustKey] = 0
}
