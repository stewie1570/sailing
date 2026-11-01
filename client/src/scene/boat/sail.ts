/**
 * Sails for the 14 m sloop: a mainsail on the boom, and a jib on the forestay.
 *
 * The halyard is a hoist: out, the main is set; in, it is rolled away. The jib
 * furler is a slider. However far it is out is how much cloth the wind has to
 * push on. A sheet does not
 * place a sail. It only limits how far that sail may swing. The apparent wind
 * weathercocks the cloth out until the sheet is taut, which is why an eased
 * sheet on a close-hauled heading luffs instead of driving.
 *
 * The jib has two sheets, one each side, and they share a single haul. How
 * tight one is, is allowance the other does not get. The wind blows the clew
 * to the leeward limit of that window. If the window still reaches the wind,
 * the jib lines up with it and luffs. If the leeward sheet holds it inside
 * the wind, the cloth takes an angle and drives.
 *
 * Force is the usual wind-axis split. Drag follows the apparent wind, lift
 * is perpendicular to it, and the angle of attack is the angle between that
 * wind and the sail. Coefficients peak, then stall, so sheeting in too far
 * or leaving the sail square to a beam wind both lose drive.
 *
 * A jib that is drawing just to leeward of the main speeds the air through
 * the slot and the main drives harder than it would alone. A jib sheeted
 * across the main, or stalled onto it, dirties that air and the main loses
 * drive. The rig is not the sum of two separate sails.
 */

export const SHEET_MAX = (85 * Math.PI) / 180
/** How far a fully eased jib sheet lets the clew swing off the centreline. */
export const JIB_SHEET_MAX = (78 * Math.PI) / 180
/** Square metres. Generous for a main alone — see the note in sailForce. */
export const SAIL_AREA = 86
/** Working jib. Smaller than the main, and part of its value is the slot. */
export const JIB_AREA = 46
const AIR_RHO = 1.225
/**
 * How hard the apparent wind is allowed to push on the cloth. The areas above
 * already stand in for a heavy hull; this extra share lets a fresh breeze
 * drive and shove the boat instead of merely tugging at it.
 */
export const WIND_ON_SAIL = 1.75
/** Seconds to hoist or to roll the main away. */
export const HOIST_TIME = 2.4
/** Boom follows the sheet and the wind with this time constant. */
const BOOM_TAU = 0.45
/** The jib clew is lighter than the boom, so it follows a little quicker. */
const JIB_TAU = 0.32
/** Bare mast and a furled sail, as a fraction of the full main. */
export const FURL_FRACTION = 0.012
/** A furled jib is a thin roll on the stay. */
const JIB_FURL_FRACTION = 0.008

export interface SailCommand {
  /** 0 furled into the boom, 1 fully hoisted. This is the animated hoist. */
  hoist: number
  /** 0 pinned on the centreline, 1 free out to the shrouds. */
  sheet: number
  /** 0 rolled onto the forestay, 1 fully set. This is the furler slider. */
  jibHoist: number
  /** 0 eased, 1 tight. Port plus starboard is at most 1. */
  jibPort: number
  jibStarboard: number
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
let jibHoist = 0
/** Radians. Positive swings the clew to starboard, same sense as the boom. */
let clew = 0
let jibSide = 1

export function getHoist() {
  return hoist
}

export function getBoom() {
  return boom
}

export function getJibHoist() {
  return jibHoist
}

export function getClew() {
  return clew
}

export function resetSail(nextHoist = 0, nextBoom = 0, nextJib = 0, nextClew = 0) {
  hoist = nextHoist
  boom = nextBoom
  boomSide = nextBoom === 0 ? 1 : Math.sign(nextBoom)
  jibHoist = nextJib
  clew = nextClew
  jibSide = nextClew === 0 ? 1 : Math.sign(nextClew)
}

function approach(current: number, command: number, dt: number, seconds: number) {
  const target = command >= 0.5 ? 1 : 0
  const step = (1 / seconds) * Math.min(Math.max(dt, 0), 0.5)
  if (step === 0 || current === target) return current
  return current < target ? Math.min(target, current + step) : Math.max(target, current - step)
}

export function stepHoist(command: number, dt: number) {
  hoist = approach(hoist, command, dt, HOIST_TIME)
}

/** The furler slider is the cloth. More out is more sail in the wind. */
export function stepJibHoist(command: number, dt: number) {
  if (dt < 0) return
  jibHoist = Math.min(1, Math.max(0, command))
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

function clcd(aoa: number, peakDeg = 26, clMax = 1.35) {
  const a = Math.min(Math.abs(aoa), Math.PI / 2)
  const peak = (peakDeg * Math.PI) / 180
  let cl = 0
  if (a <= peak) cl = clMax * Math.sin((a / peak) * (Math.PI / 2))
  else {
    const stall = (a - peak) / (Math.PI / 2 - peak)
    cl = clMax * (1 - stall) * (1 - 0.45 * stall)
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
 * area above, with WIND_ON_SAIL, is what lets a fresh breeze gather way
 * against that drag. With the sail furled the area collapses and the force
 * falls to a few tens of newtons.
 *
 * The centre of effort is almost over the keel, with a slight weather helm
 * so the bow eases toward the wind and a few degrees of rudder holds it.
 */
function evaluateMain(pose: BodyMotion, wind: Air, boomAngle: number, sailHoist: number): SailForce {
  const aw = apparentWind(pose, wind)
  const exposed = FURL_FRACTION + (1 - FURL_FRACTION) * Math.min(1, Math.max(0, sailHoist))
  const loads = aeroLoads(aw, boomAngle, SAIL_AREA, exposed, 26, 1.35)
  // A few centimetres aft and to leeward. Enough for a slow round-up,
  // not enough to pull the bow through the wind before the rudder can answer.
  const zCe = -0.02
  const xCe = -Math.sin(boomAngle) * 0.01
  const n = zCe * loads.fy - xCe * loads.fx
  return { hoist: sailHoist, boom: boomAngle, awa: aw.awa, aws: aw.aws, aoa: loads.aoa, fx: loads.fx, fy: loads.fy, n }
}

export function sailForce(pose: BodyMotion, wind: Air, command: SailCommand, dt: number): SailForce {
  const aw = apparentWind(pose, wind)
  const target = boomTarget(aw.awa, command.sheet, command.hoist)
  if (dt > 0) {
    const k = 1 - Math.exp(-Math.min(dt, 0.5) / BOOM_TAU)
    boom += (target - boom) * k
  }
  return evaluateMain(pose, wind, boom, command.hoist)
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
export function luffAmount(
  aoa: number,
  awa: number,
  hoistAmount: number,
  luffAoa = LUFF_AOA,
  noGo = NO_GO,
) {
  if (hoistAmount < 0.18) return 0
  const aligned = Math.max(0, 1 - Math.abs(aoa) / luffAoa)
  // Inside the no-go zone the luff breaks, but a sail that still has a working
  // angle on the wind only shivers. A full sail stays quiet.
  const headed = Math.max(0, 1 - Math.abs(awa) / noGo)
  const soft = Math.max(0, 1 - Math.abs(aoa) / (luffAoa * 2.2))
  return Math.min(1, Math.max(aligned, headed * soft))
}

/** Current boom and hoist, plus the wind the sail sees. Does not advance the boom. */
export function readSail(pose: BodyMotion, wind: Air) {
  const aw = apparentWind(pose, wind)
  const aoa = angleOfAttack(aw.airBow, aw.airPort, aw.aws, boom)
  return { ...aw, aoa, boom, hoist }
}

/** A jib will still fill a little closer to the wind than the main. */
export const JIB_LUFF_AOA = (12 * Math.PI) / 180
export const JIB_NO_GO = (32 * Math.PI) / 180
/** Past this, the jib is called stalled rather than drawing. */
export const JIB_STALL = (50 * Math.PI) / 180
/** Broad enough that the main blankets a jib left on the same side. */
const RUN_AWA = (140 * Math.PI) / 180

export interface JibForce {
  hoist: number
  /** Radians. Positive swings the clew to starboard. */
  clew: number
  awa: number
  aws: number
  aoa: number
  /** 0 quiet and drawing, 1 slatting. */
  luff: number
  fx: number
  fy: number
  n: number
}

export interface RigForce {
  fx: number
  fy: number
  n: number
  /** 1 leaves the main alone. Above 1 the slot helps. Below 1 the jib hurts it. */
  slot: number
  main: SailForce
  jib: JibForce
}

/** How far the clew may swing each way. Tightness on one side is slack on that side. */
export function jibAllowances(portTight: number, stbdTight: number) {
  let port = Math.min(1, Math.max(0, portTight))
  let stbd = Math.min(1, Math.max(0, stbdTight))
  const sum = port + stbd
  if (sum > 1) {
    port /= sum
    stbd /= sum
  }
  return {
    /** Radians the clew may go to port (a negative angle). */
    port: (1 - port) * JIB_SHEET_MAX,
    /** Radians the clew may go to starboard. */
    starboard: (1 - stbd) * JIB_SHEET_MAX,
  }
}

function jibTarget(awa: number, portTight: number, stbdTight: number, sailHoist: number) {
  if (sailHoist < 0.05) return 0
  const allow = jibAllowances(portTight, stbdTight)
  // Same branch-cut hold as the boom, so a dead run does not gybe every step.
  const astern = Math.PI - Math.abs(awa)
  let angle = awa
  if (astern < 0.35) angle = jibSide * Math.abs(awa)
  else if (Math.abs(awa) > 0.15) jibSide = Math.sign(awa) || jibSide
  return Math.min(allow.starboard, Math.max(-allow.port, angle))
}

function aeroLoads(
  aw: { airBow: number; airPort: number; aws: number },
  angle: number,
  area: number,
  exposed: number,
  peakDeg: number,
  clMax: number,
) {
  const aoa = angleOfAttack(aw.airBow, aw.airPort, aw.aws, angle)
  const { cl, cd } = clcd(aoa, peakDeg, clMax)
  const q = 0.5 * AIR_RHO * aw.aws * aw.aws
  const scale = q * area * exposed * WIND_ON_SAIL
  let fx = 0
  let fy = 0
  if (aw.aws > 1e-3 && scale > 0) {
    const flowBow = aw.airBow / aw.aws
    const flowPort = aw.airPort / aw.aws
    const lift = liftDirection(flowBow, flowPort, angle)
    fx = (cd * flowBow + cl * lift.bow) * scale
    fy = (cd * flowPort + cl * lift.port) * scale
  }
  return { aoa, fx, fy }
}

/**
 * The jib's own drive, from where the sheets allow it to sit relative to the wind.
 * On a run, a jib left on the mainsail's side is in its shadow and loses most of that drive.
 */
function evaluateJib(
  pose: BodyMotion,
  wind: Air,
  clewAngle: number,
  sailHoist: number,
  mainBoom: number,
  mainHoist: number,
): JibForce {
  const aw = apparentWind(pose, wind)
  const exposed = JIB_FURL_FRACTION + (1 - JIB_FURL_FRACTION) * Math.min(1, Math.max(0, sailHoist))
  // A touch more lift than the main, and it peaks a little earlier.
  const loads = aeroLoads(aw, clewAngle, JIB_AREA, exposed, 24, 1.55)
  let { fx, fy } = loads
  const blanketed =
    sailHoist > 0.4 &&
    mainHoist > 0.4 &&
    Math.abs(aw.awa) > RUN_AWA &&
    (Math.sign(clewAngle) === Math.sign(mainBoom) || Math.abs(clewAngle) < 0.15 || Math.abs(mainBoom) < 0.15)
  if (blanketed) {
    fx *= 0.35
    fy *= 0.35
  }
  // Geometric centre of the jib, forward of the mast. This is the sail-plan
  // yaw. Flow over the keel and rudder decides how much of it the hull takes
  // up; that limit is applied with the rest of the hull forces.
  const zCe = 3.5
  const xCe = -Math.sin(clewAngle) * 0.45
  const n = zCe * fy - xCe * fx
  const luff = luffAmount(loads.aoa, aw.awa, sailHoist, JIB_LUFF_AOA, JIB_NO_GO)
  return { hoist: sailHoist, clew: clewAngle, awa: aw.awa, aws: aw.aws, aoa: loads.aoa, luff, fx, fy, n }
}

function band(x: number, lo: number, hi: number, knee: number) {
  if (x < lo) return Math.max(0, 1 - (lo - x) / knee)
  if (x > hi) return Math.max(0, 1 - (x - hi) / knee)
  return 1
}

/**
 * How the jib changes the main. 1 is no interaction.
 * A drawing jib sheeted a little inside the main opens the slot and adds up
 * to about a quarter more drive on the main. A jib across the main on a
 * beat backwinds it. A jib stalled hard dumps dirty air onto the luff.
 */
export function slotFactor(
  main: { hoist: number; boom: number; aoa: number; awa: number },
  jib: { hoist: number; clew: number; aoa: number; luff: number },
) {
  // A partly rolled jib only partly changes the air over the main.
  const set = Math.min(1, Math.max(0, jib.hoist))
  if (main.hoist < 0.5 || set < 0.12) return 1
  const same =
    Math.sign(main.boom) === Math.sign(jib.clew) || Math.abs(main.boom) < 0.14 || Math.abs(jib.clew) < 0.14
  if (!same) {
    if (Math.abs(main.awa) > RUN_AWA) return 1
    return 1 - 0.2 * set
  }
  if (jib.luff > 0.5) return 1
  const deg = Math.PI / 180
  const gap = Math.abs(main.boom) - Math.abs(jib.clew)
  const gapScore = band(gap, 0, 22 * deg, 12 * deg)
  const jibDraw = band(jib.aoa, 10 * deg, 42 * deg, 10 * deg) * (1 - jib.luff)
  const mainDraw = band(main.aoa, 8 * deg, 48 * deg, 10 * deg)
  let factor = 1 + 0.28 * gapScore * jibDraw * mainDraw * set
  // A jib sheeted in hard while the breeze is on the beam stalls and
  // dumps onto the main. Squared off on a run, a large angle is the trim.
  if (Math.abs(main.awa) < RUN_AWA && jib.aoa > 55 * deg && jib.luff < 0.25) {
    const dirt = Math.min(1, (jib.aoa - 55 * deg) / (25 * deg))
    factor = Math.min(factor, 1 - 0.16 * dirt * set)
  }
  return factor
}

/** Surge the jib contributes, counting the change it makes to the main. */
export function jibAddedDrive(mainFx: number, jibFx: number, slot: number) {
  return jibFx + mainFx * (slot - 1)
}

function stepJib(pose: BodyMotion, wind: Air, command: SailCommand, dt: number, mainBoom: number) {
  const aw = apparentWind(pose, wind)
  const target = jibTarget(aw.awa, command.jibPort, command.jibStarboard, command.jibHoist)
  if (dt > 0) {
    const k = 1 - Math.exp(-Math.min(dt, 0.5) / JIB_TAU)
    clew += (target - clew) * k
  }
  return evaluateJib(pose, wind, clew, command.jibHoist, mainBoom, command.hoist)
}

/**
 * Main plus jib, with the slot applied to the main.
 * The returned main force is the sail on its own. `fx` is what the hull feels.
 */
export function rigForce(pose: BodyMotion, wind: Air, command: SailCommand, dt: number): RigForce {
  const main = sailForce(pose, wind, command, dt)
  const jib = stepJib(pose, wind, command, dt, main.boom)
  const slot = slotFactor(main, jib)
  return {
    fx: main.fx * slot + jib.fx,
    fy: main.fy * slot + jib.fy,
    n: main.n * slot + jib.n,
    slot,
    main,
    jib,
  }
}

/** Settled sails and the slot, without moving the boom or the clew. */
export function readRig(pose: BodyMotion, wind: Air): RigForce {
  const main = evaluateMain(pose, wind, boom, hoist)
  const jib = evaluateJib(pose, wind, clew, jibHoist, main.boom, main.hoist)
  const slot = slotFactor(main, jib)
  return {
    fx: main.fx * slot + jib.fx,
    fy: main.fy * slot + jib.fy,
    n: main.n * slot + jib.n,
    slot,
    main,
    jib,
  }
}
