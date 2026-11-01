/**
 * Mainsail aerodynamics for the 14 m sloop.
 *
 * The halyard is a hoist: out, the main is set; in, it is rolled back into
 * the boom and the wind has almost nothing to push on. The sheet does not
 * place the boom. It only limits how far the boom may swing. The apparent
 * wind weathercocks the sail out until the sheet is taut, which is why an
 * eased sheet on a close-hauled heading luffs instead of driving.
 *
 * Force is the usual wind-axis split. Drag follows the apparent wind, lift
 * is perpendicular to it, and the angle of attack is the angle between that
 * wind and the boom. Coefficients peak near 26°, then stall, so sheeting
 * in too far or leaving the sail square to a beam wind both lose drive.
 * A furled main keeps a sliver of rig windage and nothing more.
 */

export const SHEET_MAX = (85 * Math.PI) / 180
/** Square metres. Generous for a main alone — see the note in sailForce. */
export const SAIL_AREA = 74
const AIR_RHO = 1.225
/** Seconds to hoist or to roll the main away. */
export const HOIST_TIME = 2.4
/** Boom follows the sheet and the wind with this time constant. */
const BOOM_TAU = 0.45
/** Bare mast and a furled sail, as a fraction of the full main. */
export const FURL_FRACTION = 0.012

export interface SailCommand {
  /** 0 furled into the boom, 1 fully hoisted. This is the animated hoist. */
  hoist: number
  /** 0 pinned on the centreline, 1 free out to the shrouds. */
  sheet: number
}

export interface Air {
  blowYaw: number
  speed: number
}

export interface BodyMotion {
  yaw: number
  speed: number
  sway: number
}

export interface SailForce {
  hoist: number
  /** Radians. Positive swings the boom to starboard. */
  boom: number
  /** Apparent wind angle. 0 on the nose, positive from port, ±π from astern. */
  awa: number
  aws: number
  /** Radians between the apparent wind and the sail, 0 to π/2. */
  aoa: number
  /** Surge newtons, positive ahead. */
  fx: number
  /** Sway newtons, positive to port. */
  fy: number
  /** Yaw newton-metres, positive bow to port. */
  n: number
}

let hoist = 0
let boom = 0
/** Which side the boom is on. Held through dead astern so ±π does not gybe every frame. */
let boomSide = 1

export function getHoist() {
  return hoist
}

export function getBoom() {
  return boom
}

export function resetSail(nextHoist = 0, nextBoom = 0) {
  hoist = nextHoist
  boom = nextBoom
  boomSide = nextBoom === 0 ? 1 : Math.sign(nextBoom)
}

export function stepHoist(command: number, dt: number) {
  const target = command >= 0.5 ? 1 : 0
  const step = (1 / HOIST_TIME) * Math.min(Math.max(dt, 0), 0.5)
  if (step === 0 || hoist === target) return
  hoist = hoist < target ? Math.min(target, hoist + step) : Math.max(target, hoist - step)
}

/** Apparent wind in the hull frame. `awa` is where the wind comes from. */
export function apparentWind(pose: BodyMotion, wind: Air) {
  const s = Math.sin(pose.yaw)
  const c = Math.cos(pose.yaw)
  const bx = s * pose.speed + c * pose.sway
  const bz = c * pose.speed - s * pose.sway
  const ax = Math.sin(wind.blowYaw) * wind.speed - bx
  const az = Math.cos(wind.blowYaw) * wind.speed - bz
  const airBow = ax * s + az * c
  const airPort = ax * c - az * s
  const aws = Math.hypot(airBow, airPort)
  const awa = aws < 1e-4 ? 0 : Math.atan2(-airPort, -airBow)
  return { awa, aws, airBow, airPort }
}

function clcd(aoa: number) {
  const a = Math.min(Math.abs(aoa), Math.PI / 2)
  const peak = (26 * Math.PI) / 180
  let cl = 0
  if (a <= peak) cl = 1.35 * Math.sin((a / peak) * (Math.PI / 2))
  else {
    const stall = (a - peak) / (Math.PI / 2 - peak)
    cl = 1.35 * (1 - stall) * (1 - 0.45 * stall)
  }
  const cd = 0.06 + 1.05 * Math.sin(a) ** 2
  return { cl, cd }
}

/** Angle between the airflow and the boom, folded into 0..π/2. */
export function angleOfAttack(airBow: number, airPort: number, aws: number, boomAngle: number) {
  if (aws < 1e-4) return 0
  const dot = (airBow * -Math.cos(boomAngle) + airPort * -Math.sin(boomAngle)) / aws
  const between = Math.acos(Math.min(1, Math.max(-1, dot)))
  return between > Math.PI / 2 ? Math.PI - between : between
}

function boomTarget(awa: number, sheet: number, sailHoist: number) {
  if (sailHoist < 0.05) return 0
  const cap = Math.min(SHEET_MAX, Math.max(0, sheet) * SHEET_MAX)
  // A run sits on the ±π branch cut. Keep the boom where it is until the
  // breeze is clearly on the other quarter, instead of gybing every step.
  const astern = Math.PI - Math.abs(awa)
  let angle = awa
  if (astern < 0.35) angle = boomSide * Math.abs(awa)
  else if (Math.abs(awa) > 0.15) boomSide = Math.sign(awa) || boomSide
  return Math.min(cap, Math.max(-cap, angle))
}

/**
 * Drive and the yaw moment of the main.
 *
 * The hull's linear drag was tuned so the screws stop the boat smartly, and
 * it is heavier than a real 14 m yacht's resistance at sailing speeds. The
 * area above is a large cruising main chosen so a beam reach in ten knots
 * still makes way against that drag. With the sail furled the area collapses
 * and the force falls to a few tens of newtons.
 *
 * The centre of effort is almost over the keel, with a slight weather helm
 * so the bow eases toward the wind and a few degrees of rudder holds it.
 */
export function sailForce(pose: BodyMotion, wind: Air, command: SailCommand, dt: number): SailForce {
  const aw = apparentWind(pose, wind)
  const target = boomTarget(aw.awa, command.sheet, command.hoist)
  if (dt > 0) {
    const k = 1 - Math.exp(-Math.min(dt, 0.5) / BOOM_TAU)
    boom += (target - boom) * k
  }

  const aoa = angleOfAttack(aw.airBow, aw.airPort, aw.aws, boom)
  const { cl, cd } = clcd(aoa)
  const exposed = FURL_FRACTION + (1 - FURL_FRACTION) * Math.min(1, Math.max(0, command.hoist))
  const q = 0.5 * AIR_RHO * aw.aws * aw.aws
  const scale = q * SAIL_AREA * exposed

  let fx = 0
  let fy = 0
  if (aw.aws > 1e-3 && scale > 0) {
    const flowBow = aw.airBow / aw.aws
    const flowPort = aw.airPort / aw.aws
    const lift = liftDirection(flowBow, flowPort, boom)
    fx = (cd * flowBow + cl * lift.bow) * scale
    fy = (cd * flowPort + cl * lift.port) * scale
  }

  // A few centimetres aft and to leeward. Enough for a slow round-up,
  // not enough to pull the bow through the wind before the rudder can answer.
  const zCe = -0.02
  const xCe = -Math.sin(boom) * 0.01
  const n = zCe * fy - xCe * fx
  return { hoist: command.hoist, boom, awa: aw.awa, aws: aw.aws, aoa, fx, fy, n }
}

function liftDirection(flowBow: number, flowPort: number, boomAngle: number) {
  const a = { bow: -flowPort, port: flowBow }
  const b = { bow: flowPort, port: -flowBow }
  if (Math.abs(a.bow - b.bow) > 0.08) return a.bow > b.bow ? a : b
  const leeward = boomAngle === 0 ? -Math.sign(flowPort || 1) : -Math.sign(boomAngle)
  return Math.sign(a.port) === leeward || a.port === 0 ? a : b
}

/** Below this angle of attack the cloth is lined up with the wind and slats. */
export const LUFF_AOA = (14 * Math.PI) / 180
/**
 * A cruising main will not stay full closer than this to the apparent wind.
 * Inside it the luff breaks even if the sheet is tight.
 */
export const NO_GO = (42 * Math.PI) / 180

/**
 * 0 when the main is quiet and drawing, 1 when it should flap.
 * That is either the sail itself lying along the wind, or the bow pointed
 * too close to it for the cloth to stay full.
 */
export function luffAmount(aoa: number, awa: number, hoist: number) {
  if (hoist < 0.18) return 0
  const aligned = Math.max(0, 1 - Math.abs(aoa) / LUFF_AOA)
  // Inside the no-go zone the luff breaks, but a sail that still has a working
  // angle on the wind only shivers. A full sail stays quiet.
  const headed = Math.max(0, 1 - Math.abs(awa) / NO_GO)
  const soft = Math.max(0, 1 - Math.abs(aoa) / (LUFF_AOA * 2.2))
  return Math.min(1, Math.max(aligned, headed * soft))
}

/** Current boom and hoist, plus the wind the sail sees. Does not advance the boom. */
export function readSail(pose: BodyMotion, wind: Air) {
  const aw = apparentWind(pose, wind)
  const aoa = angleOfAttack(aw.airBow, aw.airPort, aw.aws, boom)
  return { ...aw, aoa, boom, hoist }
}
