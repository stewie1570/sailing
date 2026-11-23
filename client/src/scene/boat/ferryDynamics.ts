import type { Pods } from './pods'

/**
 * Azimuth-pod dynamics for the vehicle ferry.
 *
 * Body frame matches the sloop: +surge toward the bow, +sway toward port,
 * +yaw rate swings the bow to port. Each pod pushes along its azimuth.
 * Positive thrust at azimuth 0 drives the hull ahead. Positive azimuth
 * swings that push toward port. Negative thrust reverses it without
 * turning the pod around.
 *
 * There is no rudder and no sail. The pods are on the centreline, one
 * forward and one aft, so equal athwartship thrusts crab, and opposite
 * ones rotate the hull in place.
 */

export interface FerryPose {
  x: number
  z: number
  yaw: number
  speed: number
  sway: number
  yawRate: number
}

/** Centreline pods, metres forward of midships. The stern pod is the negative. */
export const POD_Z = 16.2

const HULL = {
  mass: 240000,
  inertia: 3.2e7,
  /** Newtons from one pod at full ahead. Astern is a large fraction of that. */
  ahead: 78000,
  astern: 0.82,
  // Tuned so full ahead settles near 8.4 m/s, about three quarters faster than before.
  dragLin: 5630,
  dragQuad: 1530,
  swayLin: 85000,
  swayQuad: 26000,
  yawLin: 7.5e6,
  yawQuad: 1.1e7,
  /** Extra surge damping once both levers are in stop, so she settles. */
  creep: 28000,
}

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v))
}

function podNewtons(thrust: number) {
  const command = clamp(thrust, -1, 1)
  const shaped = Math.sign(command) * Math.abs(command) ** 1.35
  if (shaped >= 0) return shaped * HULL.ahead
  return shaped * HULL.ahead * HULL.astern
}

/** Surge (+bow) and sway (+port) from one pod. */
function podPush(azimuth: number, thrust: number) {
  const force = podNewtons(thrust)
  return {
    surge: Math.cos(azimuth) * force,
    sway: Math.sin(azimuth) * force,
  }
}

/** The pod's heading when it has one, otherwise the lever. */
function podHeading(azimuth: number, aim: number | undefined) {
  return aim == null || !Number.isFinite(aim) ? azimuth : aim
}

/**
 * One explicit step. `pose` is mutated. Collision is the caller's job.
 * Thrust follows the pod's current heading. A lever that has moved ahead
 * of the pod does not push until the pod has turned to meet it.
 */
export function stepFerry(pose: FerryPose, command: Pods, dt: number) {
  const step = Math.min(Math.max(dt, 0), 0.1)
  if (step === 0) return
  const bow = podPush(podHeading(command.bowAz, command.bowAim), command.bowThrust)
  const stern = podPush(podHeading(command.sternAz, command.sternAim), command.sternThrust)
  let surge = bow.surge + stern.surge
  let sway = bow.sway + stern.sway
  // A push to port on the bow swings the bow to port. The same push on the stern swings it back.
  let yaw = POD_Z * bow.sway - POD_Z * stern.sway

  const u = pose.speed
  const v = pose.sway
  const r = pose.yawRate
  const surgeAbs = Math.abs(u)
  surge -= HULL.dragQuad * u * surgeAbs + HULL.dragLin * u
  sway -= HULL.swayLin * v + HULL.swayQuad * v * Math.abs(v)
  const spd = Math.max(Math.hypot(u, v), 0.35)
  yaw -= HULL.yawLin * r + HULL.yawQuad * spd * r * Math.abs(r)

  const idle = Math.abs(command.bowThrust) < 0.03 && Math.abs(command.sternThrust) < 0.03
  if (idle) surge -= u * (HULL.creep / (0.55 + surgeAbs))

  let nu = u + (surge / HULL.mass + v * r) * step
  let nv = v + (sway / HULL.mass - u * r) * step
  let nr = r + (yaw / HULL.inertia) * step
  nu = clamp(nu, -7, 14)
  nv = clamp(nv, -2.2, 2.2)
  nr = clamp(nr, -0.5, 0.5)
  if (idle) {
    const cut = 0.16 * step
    nu = Math.abs(nu) <= cut ? 0 : nu - Math.sign(nu) * cut
    nv = Math.abs(nv) <= cut ? 0 : nv - Math.sign(nv) * cut
    if (Math.abs(nr) < 0.04 * step) nr = 0
    if (Math.abs(nu) < 0.04 && Math.abs(nv) < 0.04 && Math.abs(nr) < 0.02) {
      nu = 0
      nv = 0
      nr = 0
    }
  }

  pose.speed = nu
  pose.sway = nv
  pose.yawRate = nr
  const yawMid = pose.yaw + nr * step * 0.5
  const c = Math.cos(yawMid)
  const s = Math.sin(yawMid)
  pose.yaw += nr * step
  pose.x += (s * nu + c * nv) * step
  pose.z += (c * nu - s * nv) * step
}
