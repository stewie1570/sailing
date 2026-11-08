/**
 * Sails for the 14 m sloop: a mainsail on the boom, a jib on the forestay,
 * and a symmetric spinnaker.
 *
 * The halyard and the jib furler are sliders. However far each is out is how
 * much cloth the wind has to push on. A sheet does not
 * place a sail. It only limits how far that sail may swing. The apparent wind
 * weathercocks the cloth out until the sheet is taut, which is why an eased
 * sheet on a close-hauled heading luffs instead of driving.
 *
 * The jib has two sheets, one each side, and they share a single haul.
 * Hauling the starboard sheet pulls the clew to starboard, and hauling the
 * port sheet pulls it to port. Run from eased to tight, a sheet sweeps the
 * clew from full travel on the far side to full travel on its own side.
 * Slack left in the haul is play the wind uses to blow the clew to the
 * leeward edge of that window. If the window still reaches the wind, the
 * jib lines up with it and luffs. If the sheet holds it inside the wind,
 * the cloth takes an angle and drives.
 *
 * Wing-and-wing is the exception on a run. Hauling one sheet until the
 * window sits wholly on that side takes the clew across, opposite the main.
 * The breeze is from astern, so it blows the cloth out to the far end of
 * that window instead of leaving it pinched on the inboard edge, edge-on
 * to the wind. Out there the main is not in front of the jib, so the jib
 * keeps its full drive.
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
 *
 * The spinnaker is the other headsail, and it is not a jib. A jib lives on
 * one side. A symmetric kite is a balloon ahead of the boat: with both sheets
 * eased it stands open across the bow, cloth to port and to starboard at
 * once. Hauling the port sheet pulls that balloon toward port, hauling the
 * starboard sheet pulls it toward starboard, and a hard haul takes the whole
 * sail onto that one side. While either headsail is out, the other furler
 * stays locked. The main can stay set with either.
 *
 * Downwind the kite is a parachute. Squared on a run, or rotated to leeward
 * on a broad reach, the wind blows into the belly and the drive is mostly
 * drag, several times what the jib can manage on the same heading. Sheeted
 * to weather, or carried upwind, the luff collapses and the pull dies. It is
 * not the close-hauled or beam-reach sail. That is still the jib and main.
 */

export const SHEET_MAX = (85 * Math.PI) / 180
/** Full clew travel off the centreline, to port or to starboard. */
export const JIB_SHEET_MAX = (78 * Math.PI) / 180
/** Square metres. Generous for a main alone — see the note in sailForce. */
export const SAIL_AREA = 86
/** Working jib. Smaller than the main, and part of its value is the slot. */
export const JIB_AREA = 46
/**
 * Symmetric spinnaker. Larger than the main. The area is the cloth, not the
 * projected parachute; the drive coefficients below already describe a full
 * kite, in the same ballpark as the ORC offwind sail coefficients.
 */
export const SPIN_AREA = 150
/**
 * How far a full haul of one sheet, with the other eased, shifts the belly
 * off the centreline. Positive is starboard.
 */
export const SPIN_SHEET_MAX = (74 * Math.PI) / 180
/** Foot half-width with both sheets eased. The sail then covers both sides. */
const SPIN_HALF_EASED = (64 * Math.PI) / 180
/** Foot half-width with one sheet hauled hard. The sail is then all on that side. */
const SPIN_HALF_HAULED = (20 * Math.PI) / 180
const AIR_RHO = 1.225
/**
 * How hard the apparent wind is allowed to push on the cloth. The areas above
 * already stand in for a heavy hull; this extra share lets a fresh breeze
 * drive and shove the boat instead of merely tugging at it.
 */
export const WIND_ON_SAIL = 1.12
/** Boom follows the sheet and the wind with this time constant. */
const BOOM_TAU = 0.45
/** The jib clew is lighter than the boom, so it follows a little quicker. */
const JIB_TAU = 0.32
/** The spinnaker is more cloth than the jib, so the clew follows a little slower. */
const SPIN_TAU = 0.4
/** Bare mast and a furled sail, as a fraction of the full main. */
export const FURL_FRACTION = 0.012
/** A furled jib is a thin roll on the stay. */
const JIB_FURL_FRACTION = 0.008
/** A furled spinnaker is a sock at the bow. */
const SPIN_FURL_FRACTION = 0.006

export interface SailCommand {
  /** 0 furled into the boom, 1 fully hoisted. The halyard slider sets this. */
  hoist: number
  /** 0 pinned on the centreline, 1 free out to the shrouds. */
  sheet: number
  /** 0 rolled onto the forestay, 1 fully set. This is the furler slider. */
  jibHoist: number
  /** 0 eased, 1 tight. Port plus starboard is at most 1. Hauling one pulls the clew to that side. */
  jibPort: number
  jibStarboard: number
  /** 0 rolled up, 1 fully set. The spinnaker furler. Mutually exclusive with the jib. */
  spinHoist: number
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
let spinHoist = 0
/** Radians. Positive swings the clew to starboard, same sense as the boom. */
let clew = 0
let jibSide = 1
/** Half the spinnaker's foot, radians. Wide when the sheets are eased. */
let spinHalf = SPIN_HALF_EASED

export function getHoist() {
  return hoist
}

export function getBoom() {
  return boom
}

export function getJibHoist() {
  return jibHoist
}

export function getSpinHoist() {
  return spinHoist
}

export function getClew() {
  return clew
}

/** How far the spinnaker currently spreads each side of its belly. */
export function getSpinHalf() {
  return spinHalf
}

export function resetSail(nextHoist = 0, nextBoom = 0, nextJib = 0, nextClew = 0, nextSpin = 0) {
  hoist = nextHoist
  boom = nextBoom
  boomSide = nextBoom === 0 ? 1 : Math.sign(nextBoom)
  jibHoist = nextJib
  spinHoist = nextSpin
  clew = nextClew
  jibSide = nextClew === 0 ? 1 : Math.sign(nextClew)
  spinHalf = SPIN_HALF_EASED
}

/** The halyard slider is the cloth. More out is more of the main in the wind. */
export function stepHoist(command: number, dt: number) {
  if (dt < 0) return
  hoist = Math.min(1, Math.max(0, command))
}

/** The furler slider is the cloth. More out is more sail in the wind. */
export function stepJibHoist(command: number, dt: number) {
  if (dt < 0) return
  jibHoist = Math.min(1, Math.max(0, command))
}

/** The spinnaker furler is the cloth, the same way the jib furler is. */
export function stepSpinHoist(command: number, dt: number) {
  if (dt < 0) return
  spinHoist = Math.min(1, Math.max(0, command))
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
  spin: JibForce
}

/**
 * Clew window in radians. Positive is starboard.
 *
 * Hauling the starboard sheet raises the portward limit, so a hard haul and
 * a loose port sheet hold the clew at full starboard travel. The port sheet
 * does the same toward port. With both sheets eased the window is the whole
 * arc, and the wind sets the clew inside whatever play is left.
 */
function sheetWindow(portTight: number, stbdTight: number, travel: number) {
  let port = Math.min(1, Math.max(0, portTight))
  let stbd = Math.min(1, Math.max(0, stbdTight))
  const sum = port + stbd
  if (sum > 1) {
    port /= sum
    stbd /= sum
  }
  return {
    /** Most portly angle. Rises toward starboard as that sheet is hauled. */
    min: (2 * stbd - 1) * travel,
    /** Most starboard angle. Falls toward port as the port sheet is hauled. */
    max: (1 - 2 * port) * travel,
  }
}

export function jibAllowances(portTight: number, stbdTight: number) {
  return sheetWindow(portTight, stbdTight, JIB_SHEET_MAX)
}

/**
 * Side a winged jib should fill on, or 0 when the sheets have not taken it across.
 *
 * `weatherAngle` is where a free clew would weathercock, which on a run is the
 * main's side. A window hauled wholly onto the other side cannot reach it. The
 * following wind then presses the clew out to the far sheet — square, and clear
 * of the main — instead of holding the cloth on the inboard edge, where it
 * stands edge-on and adds almost no drive.
 */
function wingedSide(allow: { min: number; max: number }, weatherAngle: number) {
  if (weatherAngle > 0 && allow.max <= 0 && allow.min < 0) return -1
  if (weatherAngle < 0 && allow.min >= 0 && allow.max > 0) return 1
  return 0
}

function jibTarget(awa: number, portTight: number, stbdTight: number, sailHoist: number) {
  if (sailHoist < 0.05) return 0
  const allow = jibAllowances(portTight, stbdTight)
  // Same branch-cut hold as the boom, so a dead run does not gybe every step.
  const astern = Math.PI - Math.abs(awa)
  let angle = awa
  if (astern < 0.35) angle = jibSide * Math.abs(awa)
  else if (Math.abs(awa) > 0.15) jibSide = Math.sign(awa) || jibSide
  // Only on a run. Closer to the wind, sheeting across backwinds the jib
  // and the ordinary clamp (the inboard edge) is the trim the sailor set.
  if (Math.abs(awa) > RUN_AWA) {
    const side = wingedSide(allow, angle)
    if (side !== 0) angle = side * Math.abs(awa)
  }
  return Math.min(allow.max, Math.max(allow.min, angle))
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
 * Winged to the other side it stands in clear air, so that loss is not applied.
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

function clamp01(v: number) {
  return Math.min(1, Math.max(0, v))
}

function wrapPi(angle: number) {
  const turn = (angle + Math.PI) % (2 * Math.PI)
  return (turn < 0 ? turn + 2 * Math.PI : turn) - Math.PI
}

/** Piecewise linear sample. `x` is radians, the knots are degrees. */
function sampleDeg(x: number, knots: readonly (readonly [number, number])[]) {
  const deg = Math.abs(x) * (180 / Math.PI)
  if (deg <= knots[0][0]) return knots[0][1]
  for (let i = 1; i < knots.length; i++) {
    if (deg <= knots[i][0]) {
      const [d0, v0] = knots[i - 1]
      const [d1, v1] = knots[i]
      return v0 + ((v1 - v0) * (deg - d0)) / (d1 - d0)
    }
  }
  return knots[knots.length - 1][1]
}

/**
 * Drive and side-force coefficients for a well trimmed kite, per q·area.
 * The shape follows the ORC offwind sail: little drive upwind, a strong
 * broad reach, and a run that is still powerful but not quite the reach.
 * Side force grows as the wind draws forward and fades when the sail is square.
 */
const SPIN_CX: readonly (readonly [number, number])[] = [
  [50, 0.02],
  [75, 0.22],
  [95, 0.78],
  [115, 1.35],
  [135, 1.62],
  [155, 1.7],
  [180, 1.58],
]
const SPIN_CY: readonly (readonly [number, number])[] = [
  [50, 0.2],
  [80, 0.72],
  [110, 0.8],
  [140, 0.42],
  [165, 0.12],
  [180, 0.02],
]

export interface SpinTrim {
  /** Belly off the centreline. Positive is starboard. */
  center: number
  /** Half the foot, so the cloth runs from center−half to center+half. */
  half: number
  portEdge: number
  stbdEdge: number
}

/**
 * Where the two sheets hold the kite.
 *
 * Both eased: the belly is on the centreline and the foot reaches well out
 * to port and to starboard, so the sail covers both sides at once. Hauling
 * one sheet pulls the belly to that side and narrows the foot. A full haul,
 * with the other sheet eased, puts the whole sail on that one side.
 */
export function spinTrim(portTight: number, stbdTight: number): SpinTrim {
  let port = clamp01(portTight)
  let stbd = clamp01(stbdTight)
  const sum = port + stbd
  if (sum > 1) {
    port /= sum
    stbd /= sum
  }
  const haul = Math.max(port, stbd)
  const half = SPIN_HALF_EASED + (SPIN_HALF_HAULED - SPIN_HALF_EASED) * haul
  const center = (stbd - port) * SPIN_SHEET_MAX
  return { center, half, portEdge: center - half, stbdEdge: center + half }
}

/**
 * Foot half-width implied by a belly angle, for a boat that only publishes
 * the belly. A centred kite is spread across both sides; one hauled across
 * is narrower and all on that side.
 */
export function spinHalfFromCenter(center: number) {
  const haul = Math.min(1, Math.abs(center) / SPIN_SHEET_MAX)
  return SPIN_HALF_EASED + (SPIN_HALF_HAULED - SPIN_HALF_EASED) * haul
}

/** Belly angle the wind wants. Dead aft that is the centreline; a reach rotates it to leeward. */
function idealSpinCenter(awa: number) {
  const fromAft = Math.PI - Math.abs(awa)
  const rotate = Math.min(SPIN_SHEET_MAX, fromAft * 0.9)
  const side = Math.abs(awa) > Math.PI - 0.2 ? 0 : Math.sign(awa)
  return side * rotate
}

/**
 * Share of the kite that is actually working.
 * Cloth that contains the leeward angle pulls. Cloth hauled to weather, or
 * squared off when the wind is on the quarter, pulls less. A dead run wants
 * the sail centred; a broad reach wants it favored to leeward.
 */
function spinWork(center: number, half: number, awa: number) {
  const ideal = idealSpinCenter(awa)
  const portEdge = center - half
  const stbdEdge = center + half
  const inside = ideal >= portEdge && ideal <= stbdEdge
  const bellyErr = Math.abs(wrapPi(center - ideal))
  let work: number
  if (inside) {
    const onBelly = Math.max(0, 1 - bellyErr / (half + 0.2))
    // Any set that still holds the leeward angle draws. Hauling the belly
    // onto that angle draws more than leaving it amidships.
    work = 0.72 + 0.28 * onBelly
  } else {
    const outside = ideal < portEdge ? portEdge - ideal : ideal - stbdEdge
    const fade = Math.exp(-outside / ((28 * Math.PI) / 180))
    work = 0.18 + 0.5 * fade
  }
  // Pulled onto the weather side of a reach, the luff collapses.
  const fromAft = Math.PI - Math.abs(awa)
  const lee = fromAft < 0.35 ? 0 : Math.sign(awa)
  if (lee !== 0 && Math.sign(center) === -lee && Math.abs(center) > 0.3) work *= 0.32
  return work
}

/** A kite collapses once the apparent wind is forward of a beam reach. */
function spinFill(awa: number) {
  const off = Math.abs(awa)
  const gone = (58 * Math.PI) / 180
  const full = (102 * Math.PI) / 180
  if (off >= full) return 1
  if (off <= gone) return 0.04
  const t = (off - gone) / (full - gone)
  return 0.04 + 0.96 * t * t
}

/**
 * The spinnaker's own drive. The sheets set the belly; the wind does not
 * weathercock it onto one edge the way it does a jib. Upwind the cloth
 * collapses. Square, or eased out to leeward, it pulls.
 */
function evaluateSpin(pose: BodyMotion, wind: Air, center: number, sailHoist: number): JibForce {
  const aw = apparentWind(pose, wind)
  const set = clamp01(sailHoist)
  const exposed = SPIN_FURL_FRACTION + (1 - SPIN_FURL_FRACTION) * set
  const fill = spinFill(aw.awa)
  const work = spinWork(center, spinHalf, aw.awa)
  const span = 0.8 + 0.2 * (spinHalf / SPIN_HALF_EASED)
  const q = 0.5 * AIR_RHO * aw.aws * aw.aws
  const scale = q * SPIN_AREA * exposed * WIND_ON_SAIL * span * work * fill
  const fx = sampleDeg(aw.awa, SPIN_CX) * scale
  const fromAft = Math.PI - Math.abs(aw.awa)
  const lee = fromAft < 0.28 ? 0 : Math.sign(aw.awa)
  // Leeward push from the breeze, plus the pull of a belly hauled off centre.
  const fy = (-lee * sampleDeg(aw.awa, SPIN_CY) - center / SPIN_SHEET_MAX * 0.18) * scale
  const zCe = 4.4
  const xCe = -Math.sin(center) * 1.1
  const n = zCe * fy - xCe * fx
  const into = wrapPi(aw.awa - center - Math.PI)
  const aoa = Math.PI / 2 - Math.min(Math.PI / 2, Math.abs(into))
  const luff = Math.min(1, Math.max(1 - fill, (1 - work) * 0.9))
  return { hoist: sailHoist, clew: center, awa: aw.awa, aws: aw.aws, aoa, luff, fx, fy, n }
}

/** One headsail at a time. If both commands arrive, the larger hoist wins and an equal pair keeps the jib. */
function resolveHeadsails(command: SailCommand) {
  let jibH = Math.min(1, Math.max(0, command.jibHoist))
  let spinH = Math.min(1, Math.max(0, command.spinHoist))
  if (jibH > 0 && spinH > 0) {
    if (spinH > jibH) jibH = 0
    else spinH = 0
  }
  return { jibH, spinH }
}

function stepHeadsails(pose: BodyMotion, wind: Air, command: SailCommand, dt: number, mainBoom: number) {
  const { jibH, spinH } = resolveHeadsails(command)
  const flyingSpin = spinH >= 0.05
  const shape = spinTrim(command.jibPort, command.jibStarboard)
  spinHalf = shape.half
  const target = flyingSpin
    ? shape.center
    : jibTarget(apparentWind(pose, wind).awa, command.jibPort, command.jibStarboard, jibH)
  if (dt > 0) {
    const k = 1 - Math.exp(-Math.min(dt, 0.5) / (flyingSpin ? SPIN_TAU : JIB_TAU))
    clew += (target - clew) * k
  }
  return {
    jib: evaluateJib(pose, wind, clew, jibH, mainBoom, command.hoist),
    spin: evaluateSpin(pose, wind, flyingSpin ? clew : 0, spinH),
  }
}

/**
 * A drawing kite sits in front of the main. On a run it steals a good part
 * of the main's air. On a reach the main is still out to leeward and keeps
 * more of its drive. The returned main force stays the sail on its own.
 */
function mainKeptWithSpin(spin: JibForce) {
  if (spin.hoist < 0.3 || spin.luff > 0.55) return 1
  const deep = Math.min(1, Math.max(0, (Math.abs(spin.awa) - (105 * Math.PI) / 180) / ((75 * Math.PI) / 180)))
  return 1 - 0.5 * deep * Math.min(1, spin.hoist) * (1 - spin.luff)
}

/**
 * Main plus the headsail that is set, with the jib's slot applied to the main.
 * A spinnaker adds its own drive and does not change the slot. Deep, it
 * blankets part of the main. The returned main force is the sail on its own.
 * `fx` is what the hull feels.
 */
export function rigForce(pose: BodyMotion, wind: Air, command: SailCommand, dt: number): RigForce {
  const main = sailForce(pose, wind, command, dt)
  const heads = stepHeadsails(pose, wind, command, dt, main.boom)
  const slot = slotFactor(main, heads.jib)
  const keep = mainKeptWithSpin(heads.spin)
  return {
    fx: main.fx * slot * keep + heads.jib.fx + heads.spin.fx,
    fy: main.fy * slot * keep + heads.jib.fy + heads.spin.fy,
    n: main.n * slot * keep + heads.jib.n + heads.spin.n,
    slot,
    main,
    jib: heads.jib,
    spin: heads.spin,
  }
}

/** Settled sails and the slot, without moving the boom or the clew. */
export function readRig(pose: BodyMotion, wind: Air): RigForce {
  const main = evaluateMain(pose, wind, boom, hoist)
  const jib = evaluateJib(pose, wind, clew, jibHoist, main.boom, main.hoist)
  const spin = evaluateSpin(pose, wind, spinHoist >= 0.05 ? clew : 0, spinHoist)
  const slot = slotFactor(main, jib)
  const keep = mainKeptWithSpin(spin)
  return {
    fx: main.fx * slot * keep + jib.fx + spin.fx,
    fy: main.fy * slot * keep + jib.fy + spin.fy,
    n: main.n * slot * keep + jib.n + spin.n,
    slot,
    main,
    jib,
    spin,
  }
}
