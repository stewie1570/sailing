import type { MapData } from '../../map/mapData'
import { chartToWorld } from '../harborLayout'

/** Open water just outside West Harbor, bow pointing at the entrance. */
export const SPAWN_CHART: readonly [number, number] = [178, 268]
export const SPAWN_YAW = -Math.PI / 2

export interface Pose {
  x: number
  z: number
  yaw: number
  speed: number
}

export const MOTION = {
  /** Metres per second squared while an arrow is held. */
  accel: 6,
  /** Per-second speed bleed, so the hull carries way and then settles. */
  drag: 0.4,
  maxForward: 9,
  maxReverse: 3.5,
  /** Radians per second. Applied even at rest, so the boat can be lined up in a slip. */
  turnRate: 0.85,
  /** Short steps so a slow frame cannot skip through an 8 m finger. */
  maxStep: 0.05,
  maxFrame: 0.1,
}

export function spawnPose(map: MapData): Pose {
  const p = chartToWorld(map, SPAWN_CHART[0], SPAWN_CHART[1])
  return { x: p.x, z: p.z, yaw: SPAWN_YAW, speed: 0 }
}

/** Camera offset behind the bow, in world metres, for a given yaw. */
export function chaseOffset(yaw: number, back = 12, height = 5.2): { x: number; y: number; z: number } {
  return {
    x: Math.sin(yaw) * -back,
    y: height,
    z: Math.cos(yaw) * -back,
  }
}

/**
 * How far the chase camera trails the heading, in seconds.
 * A steady turn sits this far behind; once the helm is released the view
 * settles on the same angle relative to the boat.
 */
export const CHASE_YAW_LAG = 1

/** First-order lag of a heading toward `target`. `tau` is the time constant in seconds. */
export function chaseYaw(current: number, target: number, dt: number, tau = CHASE_YAW_LAG): number {
  if (!(dt > 0)) return current
  if (!(tau > 0)) return target
  return current + (target - current) * (1 - Math.exp(-dt / tau))
}

/** Rotate a world XZ offset by the same yaw sense as {@link chaseOffset}. */
export function rotateYaw(x: number, z: number, yaw: number): { x: number; z: number } {
  const c = Math.cos(yaw)
  const s = Math.sin(yaw)
  return { x: x * c + z * s, z: -x * s + z * c }
}

/**
 * Accelerate, coast, and yaw. On contact the hull is walked back to the last
 * clear pose along that step and the speed goes to zero — no slide, no bounce.
 * The walk keeps the stop on the mesh instead of a full step short of it.
 */
export function integrate(
  pose: Pose,
  throttle: number,
  turn: number,
  dt: number,
  hit: (x: number, z: number, yaw: number) => boolean,
) {
  let remaining = Math.min(Math.max(dt, 0), MOTION.maxFrame)
  while (remaining > 1e-5) {
    const step = Math.min(MOTION.maxStep, remaining)
    remaining -= step
    const prevX = pose.x
    const prevZ = pose.z
    const prevYaw = pose.yaw
    pose.speed += throttle * MOTION.accel * step
    pose.speed -= pose.speed * MOTION.drag * step
    if (pose.speed > MOTION.maxForward) pose.speed = MOTION.maxForward
    if (pose.speed < -MOTION.maxReverse) pose.speed = -MOTION.maxReverse
    pose.yaw += turn * MOTION.turnRate * step
    pose.x += Math.sin(pose.yaw) * pose.speed * step
    pose.z += Math.cos(pose.yaw) * pose.speed * step
    if (!hit(pose.x, pose.z, pose.yaw)) continue
    const endX = pose.x
    const endZ = pose.z
    const endYaw = pose.yaw
    let lo = 0
    let hi = 1
    for (let i = 0; i < 8; i++) {
      const mid = (lo + hi) * 0.5
      if (hit(prevX + (endX - prevX) * mid, prevZ + (endZ - prevZ) * mid, prevYaw + (endYaw - prevYaw) * mid)) hi = mid
      else lo = mid
    }
    pose.x = prevX + (endX - prevX) * lo
    pose.z = prevZ + (endZ - prevZ) * lo
    pose.yaw = prevYaw + (endYaw - prevYaw) * lo
    pose.speed = 0
    return
  }
}

/** Same swell as the water surface, so the hull rides the wave instead of slicing a flat plane. */
export function swell(x: number, z: number, t: number): number {
  return 0.1 * Math.sin(x * 0.021 + z * 0.013 + t * 0.55)
    + 0.07 * Math.sin(-x * 0.011 + z * 0.027 + t * 0.41)
}
