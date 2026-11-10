import type { MapData } from '../../map/mapData'
import { chartToWorld } from '../harborLayout'
import { stepMotion, type AirDrive, type Drive } from './dynamics'

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

/** Metres of beam between boats in a room, so the fleet does not spawn inside one hull. */
const FLEET_GAP = 22

export function spawnPose(map: MapData, slot = 0): Pose {
  const p = chartToWorld(map, SPAWN_CHART[0], SPAWN_CHART[1])
  let z = p.z
  // Line the room up along the beam, south of the harbor mouth, and step over any shore.
  for (let n = 0; n < slot; n++) {
    let guard = 0
    do {
      z += FLEET_GAP
      guard++
    } while (guard < 12 && map.isLand(p.x, z))
  }
  return { x: p.x, z, yaw: SPAWN_YAW, speed: 0, sway: 0, yawRate: 0 }
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

/** Share of the closing speed that comes back off a solid. A heavy hull, not a ball. */
const RESTITUTION = 0.42
/** Slower than this, the hull just stops on the normal so it can lie alongside. */
const BOUNCE_ABOVE = 0.5
/** Share of the along-wall speed kept after a hit. */
const TANGENT_KEEP = 0.78
/** Stand off the skin so the next step does not start inside it. */
const STANDOFF = 0.07
/** A bury deeper than this (metres of keel below the mesh) is pushed back out. */
const BURY_GROUND = 0.22
/** How far one resolution may carry a buried hull back to open water. */
const MAX_EXTRACT = 8
/** How far to look for that open water. A mole is wider than one extract step. */
const SEARCH = 20

export interface HullEmbed {
  /** Metres of skin below the terrain mesh. */
  ground: number
  /** Inside a dock, buoy, beacon, building, or tree. */
  prop: boolean
}

/**
 * Screws, rudder and hull resistance. On contact the hull is set back on the
 * skin and the closing speed rebounds. A glancing blow keeps sliding. A hull
 * that is already inside the ground or a dock — a hard hit that skipped the
 * skin — is pushed back out instead of being left there with no way on.
 *
 * `probe` on `hit` marks a clearance sample. The hull's own step does not set it,
 * so a ram is only counted for a pose the boat actually tried to reach.
 */
export function integrate(
  pose: Pose,
  drive: Drive,
  dt: number,
  hit: (x: number, z: number, yaw: number, probe?: boolean) => boolean,
  air?: AirDrive,
  embed?: (x: number, z: number, yaw: number) => HullEmbed,
) {
  let remaining = Math.min(Math.max(dt, 0), MOTION.maxFrame)
  let impacts = 0
  while (remaining > 1e-5) {
    const step = Math.min(MOTION.maxStep, remaining)
    remaining -= step
    const prevX = pose.x
    const prevZ = pose.z
    const prevYaw = pose.yaw
    stepMotion(pose, drive, step, air)
    if (!hit(pose.x, pose.z, pose.yaw)) continue
    const impact = { speed: pose.speed, sway: pose.sway, yawRate: pose.yawRate }
    const endX = pose.x
    const endZ = pose.z
    const endYaw = pose.yaw
    // A second hit in the same frame is a corner. Separate, but don't add another rebound on top.
    const soft = impacts > 0
    if (!settle(pose, prevX, prevZ, prevYaw, endX, endZ, endYaw, impact, hit, embed, soft)) return
    impacts++
    if (impacts >= 3) return
  }
}

function worldVelocity(yaw: number, speed: number, sway: number) {
  const c = Math.cos(yaw)
  const s = Math.sin(yaw)
  return { x: s * speed + c * sway, z: c * speed - s * sway }
}

function bodyVelocity(yaw: number, vx: number, vz: number) {
  const c = Math.cos(yaw)
  const s = Math.sin(yaw)
  return {
    speed: Math.min(12, Math.max(-6, s * vx + c * vz)),
    sway: Math.min(4, Math.max(-4, c * vx - s * vz)),
  }
}

/** First open distance along a unit direction, or null when the ray stays inside. */
function firstClear(
  x: number,
  z: number,
  yaw: number,
  dx: number,
  dz: number,
  hit: (x: number, z: number, yaw: number, probe?: boolean) => boolean,
) {
  const reach = SEARCH
  let prev = 0
  const stride = 1
  for (let d = stride; d <= reach + 1e-6; d += stride) {
    const at = Math.min(d, reach)
    if (!hit(x + dx * at, z + dz * at, yaw, true)) {
      let lo = prev
      let hi = at
      for (let i = 0; i < 8; i++) {
        const mid = (lo + hi) * 0.5
        if (hit(x + dx * mid, z + dz * mid, yaw, true)) lo = mid
        else hi = mid
      }
      return hi
    }
    prev = at
  }
  return null
}

/** Nearest open water from a pose that is already inside something. */
function nearestClear(
  x: number,
  z: number,
  yaw: number,
  hit: (x: number, z: number, yaw: number, probe?: boolean) => boolean,
) {
  let best: { dist: number; nx: number; nz: number } | null = null
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2
    const dx = Math.cos(a)
    const dz = Math.sin(a)
    const dist = firstClear(x, z, yaw, dx, dz, hit)
    if (dist == null) continue
    if (!best || dist < best.dist) best = { dist, nx: dx, nz: dz }
  }
  return best
}

/** Outward normal at a pose that has just cleared a solid. */
function contactNormal(
  x: number,
  z: number,
  yaw: number,
  intoX: number,
  intoZ: number,
  hit: (x: number, z: number, yaw: number, probe?: boolean) => boolean,
) {
  let sx = 0
  let sz = 0
  const probe = 0.24
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2
    if (hit(x + Math.cos(a) * probe, z + Math.sin(a) * probe, yaw, true)) {
      sx += Math.cos(a)
      sz += Math.sin(a)
    }
  }
  const len = Math.hypot(sx, sz)
  if (len > 0.2) return { nx: -sx / len, nz: -sz / len }
  const into = Math.hypot(intoX, intoZ)
  if (into > 1e-4) return { nx: -intoX / into, nz: -intoZ / into }
  return { nx: 0, nz: -1 }
}

function standOff(
  pose: Pose,
  nx: number,
  nz: number,
  hit: (x: number, z: number, yaw: number, probe?: boolean) => boolean,
) {
  const x = pose.x + nx * STANDOFF
  const z = pose.z + nz * STANDOFF
  if (!hit(x, z, pose.yaw, true)) {
    pose.x = x
    pose.z = z
  }
}

/** Reflect the closing speed off an outward normal. A light touch only sheds the inward part. */
function rebound(yaw: number, speed: number, sway: number, nx: number, nz: number, soft: boolean) {
  const v = worldVelocity(yaw, speed, sway)
  const vn = v.x * nx + v.z * nz
  const into = vn < 0 ? vn : 0
  const hard = !soft && -into >= BOUNCE_ABOVE
  const e = hard ? RESTITUTION : 0
  let vx = v.x - (1 + e) * into * nx
  let vz = v.z - (1 + e) * into * nz
  const kept = vx * nx + vz * nz
  const tx = (vx - kept * nx) * TANGENT_KEEP
  const tz = (vz - kept * nz) * TANGENT_KEEP
  vx = kept * nx + tx
  vz = kept * nz + tz
  return { ...bodyVelocity(yaw, vx, vz), hard }
}

function applyRebound(pose: Pose, speed: number, sway: number, yawRate: number, nx: number, nz: number, soft: boolean) {
  const bounced = rebound(pose.yaw, speed, sway, nx, nz, soft)
  pose.speed = bounced.speed
  pose.sway = bounced.sway
  if (bounced.hard) pose.yawRate = yawRate * 0.5
}

/**
 * Put the hull back in clear water and set the rebound. False when no clear
 * pose could be found; the hull is left where the step started, with the way off.
 */
function settle(
  pose: Pose,
  prevX: number,
  prevZ: number,
  prevYaw: number,
  endX: number,
  endZ: number,
  endYaw: number,
  impact: { speed: number; sway: number; yawRate: number },
  hit: (x: number, z: number, yaw: number, probe?: boolean) => boolean,
  embed: ((x: number, z: number, yaw: number) => HullEmbed) | undefined,
  soft: boolean,
) {
  if (!hit(prevX, prevZ, prevYaw, true)) {
    let lo = 0
    let hi = 1
    for (let i = 0; i < 12; i++) {
      const mid = (lo + hi) * 0.5
      const x = prevX + (endX - prevX) * mid
      const z = prevZ + (endZ - prevZ) * mid
      const yaw = prevYaw + (endYaw - prevYaw) * mid
      if (hit(x, z, yaw)) hi = mid
      else lo = mid
    }
    pose.x = prevX + (endX - prevX) * lo
    pose.z = prevZ + (endZ - prevZ) * lo
    pose.yaw = prevYaw + (endYaw - prevYaw) * lo
    if (!hit(pose.x, pose.z, pose.yaw, true)) {
      const normal = contactNormal(pose.x, pose.z, pose.yaw, endX - pose.x, endZ - pose.z, hit)
      standOff(pose, normal.nx, normal.nz, hit)
      applyRebound(pose, impact.speed, impact.sway, impact.yawRate, normal.nx, normal.nz, soft)
      return true
    }
  }

  // The step began inside a solid, or the sweep never found a clear sample.
  const overlap = embed?.(prevX, prevZ, prevYaw) ?? { ground: 0, prop: false }
  // A shoal kiss: the keel is in the mud, but not driven through the bank.
  // Moves that don't bury it further are allowed, so the boat can motor back
  // to deep water. Moves that dig in are refused.
  const kiss = overlap.ground > 0 && overlap.ground < BURY_GROUND && !overlap.prop
  if (kiss && embed) {
    const dug = embed(endX, endZ, endYaw)
    if (dug.ground <= overlap.ground + 1e-4 && !dug.prop) {
      pose.x = endX
      pose.z = endZ
      pose.yaw = endYaw
      return true
    }
    pose.x = prevX
    pose.z = prevZ
    pose.yaw = prevYaw
    pose.speed = 0
    pose.sway = 0
    return true
  }

  const exit = nearestClear(prevX, prevZ, prevYaw, hit)
  if (!exit) {
    pose.x = prevX
    pose.z = prevZ
    pose.yaw = prevYaw
    pose.speed = 0
    pose.sway = 0
    pose.yawRate = 0
    return false
  }
  const step = Math.min(exit.dist, MAX_EXTRACT)
  pose.x = prevX + exit.nx * step
  pose.z = prevZ + exit.nz * step
  pose.yaw = prevYaw
  const clear = !hit(pose.x, pose.z, pose.yaw, true)
  if (clear) standOff(pose, exit.nx, exit.nz, hit)
  applyRebound(pose, impact.speed, impact.sway, impact.yawRate, exit.nx, exit.nz, soft || !clear)
  return true
}

/**
 * Same standing swell as the water vertex shader, so the hull heaves with the
 * wave under it. Crests stay put. A slow spatial clock keeps one part of the
 * lake from rising with the rest. Keep the constants identical to `swell` in
 * Water.tsx.
 */
export function swell(x: number, z: number, t: number): number {
  const a = Math.sin(x * 0.0031 + z * 0.0022)
  const b = Math.sin(-x * 0.0017 + z * 0.0026)
  const phase = a * 1.15 + b * 0.8
  const rate = 0.55 + 0.45 * (a * 0.5 + 0.5)
  return 0.07 * Math.sin(x * 0.021 + z * 0.013) * Math.sin(t * 0.26 * rate + phase)
    + 0.05 * Math.sin(-x * 0.011 + z * 0.027) * Math.sin(t * 0.18 * rate + phase * 0.67 + 1.7)
}
