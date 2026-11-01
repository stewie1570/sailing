/**
 * Twin-screw, single-rudder dynamics for the 14 m hull, plus the main and the jib.
 *
 * Body frame: +surge toward the bow, +sway toward local +x (port when the bow
 * is along +z), +yaw rate swings the bow to port. Starboard helm is a positive
 * rudder command and, with way on, a negative yaw rate.
 *
 * The rudder only bites when water is moving over it — boat speed plus the
 * ahead prop wash — so it does nothing at rest with the screws stopped.
 * Unequal screws yaw the boat even then, which is how a twin-screw yacht
 * turns inside a slip. Bow and stern thrusters push sideways with no way on,
 * so she can walk and spin in a berth. A hoisted main or jib adds drive; with
 * both furled, that drive is left out of the low-speed braking that settles
 * the hull in a slip.
 *
 * The jib sits forward, so its lateral force is a yaw on the sail plan. The
 * hull only takes up a little of that yaw. Flow over the keel and rudder is
 * what steers, and the same flow keeps the bow from being hauled around by
 * the jib: about four fifths rudder when the boat is barely moving, and
 * nearly all rudder once she is doing five knots. The sail's drive is not
 * part of that limit.
 */

import { rigForce, type SailCommand, type Air } from './sail'
import { MS_TO_KN } from './wind'

export interface Drive {
  /** −1 full astern, 0 stop, +1 full ahead. */
  port: number
  starboard: number
  /** −1 hard to port, 0 parallel with the hull, +1 hard to starboard. */
  rudder: number
  /** −1 shoves that end to port, 0 off, +1 shoves it to starboard. */
  bow: number
  stern: number
}

export const RUDDER_LOCK = (35 * Math.PI) / 180
/** Helm wheel travel at full rudder. More than the blade, like a real reduction. */
export const WHEEL_LOCK = (110 * Math.PI) / 180

const HULL = {
  mass: 11000,
  inertia: 145000,
  /** Newtons from one screw at full ahead. Astern is a fraction of that. */
  ahead: 3900,
  astern: 0.3,
  /** Port screw sits on local +x; starboard is the mirror. Both are aft of midships. */
  screwX: 0.72,
  screwZ: -4.55,
  /** Centre of pressure of the rudder, aft of the origin. */
  rudderZ: -5.7,
  /** Lateral newtons per (m/s)² at 90° of blade, scaled by sin(angle). */
  lift: 30,
  /** Metres per second of wash over the rudder from one screw at full ahead. */
  wash: 3.4,
  dragQuad: 68,
  dragLin: 420,
  /** Extra surge damping that matters once the boat has slowed. */
  creep: 900,
  swayLin: 2200,
  swaySpeed: 6500,
  swayQuad: 9000,
  yawLin: 5200,
  yawSpeed: 3600,
  yawQuad: 18000,
  /** Inward stern walk, newtons, at full astern on one screw. */
  walk: 250,
  /** Sideways newtons from one thruster at full. Enough to walk and spin at rest. */
  thruster: 1400,
  /** Thruster stations, metres from midships. Equal arms so both to one side walks straight. */
  bowZ: 5.5,
  sternZ: -5.5,
}

/**
 * Share of calm-water resistance kept while a sail is drawing.
 * Surge eases so the boat gathers way. Sway eases further so the breeze
 * can push her off the heading, which is most of what "the wind has hold
 * of the boat" feels like. Yaw damping stays put so she does not spin.
 */
const SAILING_SURGE = 0.5
const SAILING_SWAY = 0.3

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v))
}

/**
 * Jib's share of the steering when there is no way on. The rest is the rudder.
 * It fades with through-water speed: at five knots the share is about two
 * percent, so the rudder is doing nearly all of the steering.
 */
const JIB_YAW_SHARE_STOPPED = 0.2
const JIB_YAW_FADE_KN = 2.2
/** The capped jib yaw, scaled so the jib is felt a little more in the helm. */
const JIB_HELM = 1.15

/**
 * Yaw from the jib that the hull will actually accept. `JIB_HELM` lets a
 * little more of that yaw through, so the jib steers more than the cap alone.
 * `wash` is the ahead prop stream over the rudder, same one the blade uses.
 * With neither way nor wash there is nothing for a rudder to push, and the
 * jib does not yaw the boat either.
 */
function jibHelmMoment(jibN: number, speed: number, sway: number, wash: number) {
  const kn = Math.hypot(speed, sway) * MS_TO_KN
  const rudderShare = 1 - JIB_YAW_SHARE_STOPPED * Math.exp(-kn / JIB_YAW_FADE_KN)
  const flow = speed + wash
  const authority = Math.abs(HULL.rudderZ) * Math.sin(RUDDER_LOCK) * HULL.lift * flow * flow
  const cap = (authority * (1 - rudderShare)) / rudderShare
  if (!(cap > 0) || !Number.isFinite(jibN)) return 0
  return JIB_HELM * Math.min(cap, Math.max(-cap, jibN))
}

function engineThrust(throttle: number) {
  // Rpm follows the lever and thrust follows rpm squared, so the lower
  // orders (dead slow, slow) are gentle and full ahead is still full power.
  const shaped = Math.sign(throttle) * Math.abs(throttle) ** 1.4
  if (shaped >= 0) return shaped * HULL.ahead
  return shaped * HULL.ahead * HULL.astern
}

/** Sideways newtons. Positive command is to starboard, positive force is to port. */
function thrusterForce(command: number) {
  const shaped = Math.sign(command) * Math.abs(command) ** 1.35
  return -shaped * HULL.thruster
}

export interface AirDrive {
  wind: Air
  sail: SailCommand
}

/**
 * One explicit step. `pose` is mutated. Collision is the caller's job —
 * this only integrates surge, sway, yaw and the world position.
 * Pass `air` to let the sails push; without it the hull is screws and rudder only.
 */
export function stepMotion(
  pose: { x: number; z: number; yaw: number; speed: number; sway: number; yawRate: number },
  drive: Drive,
  dt: number,
  air?: AirDrive,
) {
  const port = clamp(drive.port, -1, 1)
  const stbd = clamp(drive.starboard, -1, 1)
  const rudder = clamp(drive.rudder, -1, 1)
  const bow = clamp(drive.bow, -1, 1)
  const stern = clamp(drive.stern, -1, 1)

  const fp = engineThrust(port)
  const fs = engineThrust(stbd)
  let fx = fp + fs
  let fy = 0
  // A forward push on the port side swings the bow to starboard.
  let n = -HULL.screwX * (fp - fs)

  // Ahead wash only. Computed before the rig so the jib's yaw sees the same
  // flow the rudder is about to use.
  const wash = HULL.wash * 0.5 * (Math.max(port, 0) + Math.max(stbd, 0))

  const rig = air ? rigForce(pose, air.wind, air.sail, dt) : null
  if (rig) {
    fx += rig.fx
    fy += rig.fy
    // Keep the main's weather helm. Swap the jib's geometric yaw for the
    // share the hull will take up at this flow.
    n += rig.n - rig.jib.n + jibHelmMoment(rig.jib.n, pose.speed, pose.sway, wash)
  }
  // The extra low-speed drag and the stop-notch brake exist so a motorboat
  // settles in a slip. A set sail is propulsion, so they stay out of the way.
  const sailing = (air?.sail.hoist ?? 0) > 0.18 || (air?.sail.jibHoist ?? 0) > 0.18

  // Outward-turning screws walk the stern inward when they run astern.
  const walkFy = (port < 0 ? port * HULL.walk : 0) + (stbd < 0 ? -stbd * HULL.walk : 0)
  fy += walkFy
  n += HULL.screwZ * walkFy

  // Thrusters shove sideways at rest. A push to port on the bow swings the
  // bow to port; the same push on the stern swings the bow to starboard.
  const bowFy = thrusterForce(bow)
  const sternFy = thrusterForce(stern)
  fy += bowFy + sternFy
  n += HULL.bowZ * bowFy + HULL.sternZ * sternFy
  const thrusting = Math.abs(bow) > 0.02 || Math.abs(stern) > 0.02

  const flow = pose.speed + wash
  const delta = rudder * RUDDER_LOCK
  const sinD = Math.sin(delta)
  // Positive side force is to port. Starboard blade with ahead flow kicks the stern to port.
  const rudderFy = sinD * HULL.lift * flow * Math.abs(flow)
  fy += rudderFy
  n += HULL.rudderZ * rudderFy

  const u = pose.speed
  const v = pose.sway
  const r = pose.yawRate
  const surgeAbs = Math.abs(u)
  const spd = Math.hypot(u, v)

  // The linear term is what makes the hull feel reluctant to gather way.
  // A drawing sail eases surge and sway, so the breeze can both gather way
  // and push the hull sideways. Quad surge drag stays, which keeps a top speed.
  const surgeLin = sailing ? HULL.dragLin * SAILING_SURGE : HULL.dragLin
  const swayGive = sailing ? SAILING_SWAY : 1
  fx -= HULL.dragQuad * u * surgeAbs + surgeLin * u
  if (!sailing) fx -= u * (HULL.creep / (0.45 + surgeAbs))
  fx -= HULL.dragQuad * 0.35 * sinD * sinD * u * surgeAbs
  fy -= swayGive * ((HULL.swayLin + HULL.swaySpeed * surgeAbs) * v + HULL.swayQuad * v * Math.abs(v))
  n -= (HULL.yawLin + HULL.yawSpeed * surgeAbs) * r + HULL.yawQuad * Math.max(spd, 0.4) * r * Math.abs(r)

  let nu = u + (fx / HULL.mass + v * r) * dt
  let nv = v + (fy / HULL.mass - u * r) * dt
  let nr = r + (n / HULL.inertia) * dt
  nu = clamp(nu, -6, 12)
  nv = clamp(nv, -4, 4)
  nr = clamp(nr, -1.2, 1.2)
  // With both levers in the stop notch, the sails furled, and the thrusters
  // off, kill the last of the way so the hull settles instead of creeping.
  if (!sailing && Math.abs(port) < 0.03 && Math.abs(stbd) < 0.03) {
    const cut = 0.18 * dt
    nu = Math.abs(nu) <= cut ? 0 : nu - Math.sign(nu) * cut
    if (!thrusting) {
      nv = Math.abs(nv) <= cut ? 0 : nv - Math.sign(nv) * cut
      if (Math.abs(nr) < 0.04 * dt) nr = 0
    }
  }
  if (!sailing && !thrusting && Math.abs(nu) < 0.03 && Math.abs(nv) < 0.03 && Math.abs(nr) < 0.015 && Math.abs(fp) < 40 && Math.abs(fs) < 40) {
    nu = 0
    nv = 0
    nr = 0
  }

  pose.speed = nu
  pose.sway = nv
  pose.yawRate = nr
  const yawMid = pose.yaw + nr * dt * 0.5
  const c = Math.cos(yawMid)
  const s = Math.sin(yawMid)
  pose.yaw += nr * dt
  pose.x += (s * nu + c * nv) * dt
  pose.z += (c * nu - s * nv) * dt
}
