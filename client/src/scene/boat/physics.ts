import type { MapData } from '../../map/mapData'
import { chartToWorld } from '../harborLayout'
import { stepMotion, type Drive } from './dynamics'

/** Open water just outside West Harbor, bow pointing at the entrance. */
export const SPAWN_CHART: readonly [number, number] = [178, 268]
export const SPAWN_YAW = -Math.PI / 2

export interface Pose {
  x: number
  z: number
  yaw: number
  /** Surge, metres per second, positive ahead. */
  speed: number
  /** Sway, metres per second, positive to port (local +x). */
  sway: number
  /** Yaw rate, radians per second, positive bow to port. */
  yawRate: number
}

export const MOTION = {
  /** Short steps so a slow frame cannot skip through an 8 m finger. */
  maxStep: 0.05,
  maxFrame: 0.1,
}

export function spawnPose(map: MapData): Pose {
  const p = chartToWorld(map, SPAWN_CHART[0], SPAWN_CHART[1])
  return { x: p.x, z: p.z, yaw: SPAWN_YAW, speed: 0, sway: 0, yawRate: 0 }
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
 * Screws, rudder and hull resistance. On contact the hull is walked back to
 * the last clear pose along that step and the way comes off — no slide, no bounce.
 */
export function integrate(
  pose: Pose,
  drive: Drive,
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
    stepMotion(pose, drive, step)
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
    pose.sway = 0
    pose.yawRate = 0
    return
  }
}

/** Same swell as the water surface, so the hull rides the wave instead of slicing a flat plane. */
export function swell(x: number, z: number, t: number): number {
  return 0.1 * Math.sin(x * 0.021 + z * 0.013 + t * 0.55)
    + 0.07 * Math.sin(-x * 0.011 + z * 0.027 + t * 0.41)
}
