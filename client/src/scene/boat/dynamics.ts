/**
 * Twin-screw, single-rudder dynamics for the 14 m hull.
 *
 * Body frame: +surge toward the bow, +sway toward local +x (port when the bow
 * is along +z), +yaw rate swings the bow to port. Starboard helm is a positive
 * rudder command and, with way on, a negative yaw rate.
 *
 * The rudder only bites when water is moving over it — boat speed plus the
 * ahead prop wash — so it does nothing at rest with the screws stopped.
 * Unequal screws yaw the boat even then, which is how a twin-screw yacht
 * turns inside a slip.
 */

export interface Drive {
  /** −1 full astern, 0 stop, +1 full ahead. */
  port: number
  starboard: number
  /** −1 hard to port, 0 parallel with the hull, +1 hard to starboard. */
  rudder: number
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
}

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v))
}

function engineThrust(throttle: number) {
  // Rpm follows the lever and thrust follows rpm squared, so the lower
  // orders (dead slow, slow) are gentle and full ahead is still full power.
  const shaped = Math.sign(throttle) * Math.abs(throttle) ** 1.4
  if (shaped >= 0) return shaped * HULL.ahead
  return shaped * HULL.ahead * HULL.astern
}

/**
 * One explicit step. `pose` is mutated. Collision is the caller's job —
 * this only integrates surge, sway, yaw and the world position.
 */
export function stepMotion(
  pose: { x: number; z: number; yaw: number; speed: number; sway: number; yawRate: number },
  drive: Drive,
  dt: number,
) {
  const port = clamp(drive.port, -1, 1)
  const stbd = clamp(drive.starboard, -1, 1)
  const rudder = clamp(drive.rudder, -1, 1)

  const fp = engineThrust(port)
  const fs = engineThrust(stbd)
  let fx = fp + fs
  let fy = 0
  // A forward push on the port side swings the bow to starboard.
  let n = -HULL.screwX * (fp - fs)

  // Outward-turning screws walk the stern inward when they run astern.
  const walkFy = (port < 0 ? port * HULL.walk : 0) + (stbd < 0 ? -stbd * HULL.walk : 0)
  fy += walkFy
  n += HULL.screwZ * walkFy

  const wash = HULL.wash * 0.5 * (Math.max(port, 0) + Math.max(stbd, 0))
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

  fx -= HULL.dragQuad * u * surgeAbs + HULL.dragLin * u
  fx -= u * (HULL.creep / (0.45 + surgeAbs))
  fx -= HULL.dragQuad * 0.35 * sinD * sinD * u * surgeAbs
  fy -= (HULL.swayLin + HULL.swaySpeed * surgeAbs) * v + HULL.swayQuad * v * Math.abs(v)
  n -= (HULL.yawLin + HULL.yawSpeed * surgeAbs) * r + HULL.yawQuad * Math.max(spd, 0.4) * r * Math.abs(r)

  let nu = u + (fx / HULL.mass + v * r) * dt
  let nv = v + (fy / HULL.mass - u * r) * dt
  let nr = r + (n / HULL.inertia) * dt
  nu = clamp(nu, -6, 12)
  nv = clamp(nv, -4, 4)
  nr = clamp(nr, -1.2, 1.2)
  // With both levers in the stop notch, kill the last of the way so the hull
  // actually settles instead of creeping for a minute.
  if (Math.abs(port) < 0.03 && Math.abs(stbd) < 0.03) {
    const cut = 0.18 * dt
    nu = Math.abs(nu) <= cut ? 0 : nu - Math.sign(nu) * cut
    nv = Math.abs(nv) <= cut ? 0 : nv - Math.sign(nv) * cut
    if (Math.abs(nr) < 0.04 * dt) nr = 0
  }
  if (Math.abs(nu) < 0.03 && Math.abs(nv) < 0.03 && Math.abs(nr) < 0.015 && Math.abs(fp) < 40 && Math.abs(fs) < 40) {
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
