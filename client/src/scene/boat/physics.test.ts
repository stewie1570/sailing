import { describe, expect, it } from 'vitest'
import { SPEED_GUARD, stepMotion, type Drive } from './dynamics'
import {
  JIB_SHEET_MAX,
  SHADOW_CORE,
  SHADOW_SPREAD,
  SHEET_MAX,
  SPIN_SHEET_MAX,
  aftBlanket,
  apparentWind,
  getBoom,
  getClew,
  headsailShadow,
  pointShadow,
  resetSail,
  rigForce,
  sailTrimTarget,
  shadowForceFactor,
  slotFactor,
  spanShadow,
  stepHoist,
  stepJibHoist,
  stepSpinHoist,
  windCrossedSail,
  windOffStern,
  type Air,
  type BodyMotion,
  type SailCommand,
} from './sail'
import { MS_TO_KN } from './wind'

const DEG = Math.PI / 180
const deg = (d: number) => d * DEG

function wrap(angle: number) {
  const turn = (angle + Math.PI) % (2 * Math.PI)
  return (turn < 0 ? turn + 2 * Math.PI : turn) - Math.PI
}

/** Stopped hull, so the apparent wind is the true wind. `awa` is where it comes from. */
function air(awa: number, kn = 14): Air {
  return { blowYaw: windOffStern(awa), speed: kn / MS_TO_KN }
}

function stopped(): BodyMotion {
  return { yaw: 0, speed: 0, sway: 0 }
}

const IDLE: Drive = { port: 0, starboard: 0, rudder: 0, bow: 0, stern: 0 }

function mainOnly(sheet = 1): SailCommand {
  return { hoist: 1, sheet, jibHoist: 0, jibPort: 0, jibStarboard: 0, spinHoist: 0 }
}

/** Hold `awa` and let the boom finish moving. */
function settleBoom(awa: number, sheet = 1, frames = 50) {
  const pose = stopped()
  const wind = air(awa)
  const sail = mainOnly(sheet)
  for (let i = 0; i < frames; i++) rigForce(pose, wind, sail, 0.05)
  return getBoom()
}

describe('apparent wind', () => {
  it('is the true wind when the hull is stopped', () => {
    const wind = air(deg(50), 12)
    const aw = apparentWind(stopped(), wind)
    expect(aw.awa).toBeCloseTo(deg(50), 5)
    expect(aw.aws).toBeCloseTo(12 / MS_TO_KN, 5)
  })

  it('adds the headwind when the boat sails upwind and subtracts it on a run', () => {
    const kn = 10
    const up = apparentWind({ yaw: 0, speed: 3, sway: 0 }, air(0, kn))
    const down = apparentWind({ yaw: 0, speed: 3, sway: 0 }, air(Math.PI, kn))
    expect(up.aws).toBeGreaterThan(kn / MS_TO_KN)
    expect(down.aws).toBeLessThan(kn / MS_TO_KN)
    expect(up.aws).toBeCloseTo(kn / MS_TO_KN + 3, 5)
    expect(down.aws).toBeCloseTo(kn / MS_TO_KN - 3, 5)
  })

  it('measures the wind off the stern without a side at dead aft', () => {
    expect(windOffStern(Math.PI)).toBeCloseTo(0, 6)
    expect(windOffStern(-Math.PI)).toBeCloseTo(0, 6)
    expect(windOffStern(deg(140))).toBeLessThan(0)
    expect(windOffStern(deg(-140))).toBeGreaterThan(0)
    // A couple of degrees either side of the branch cut must not flip a large angle.
    expect(windOffStern(deg(179))).toBeCloseTo(deg(-1), 4)
    expect(windOffStern(deg(-179))).toBeCloseTo(deg(1), 4)
  })
})

describe('gybe from the sail, not the boat', () => {
  it('does not treat wind on the stern as a gybe while the boom is still to leeward', () => {
    const eased = SHEET_MAX
    // Twenty degrees by the lee used to gybe, because that test watched the boat.
    expect(windCrossedSail(eased, wrap(Math.PI + deg(20)))).toBe(false)
    expect(windCrossedSail(eased, wrap(Math.PI + deg(70)))).toBe(false)
    // The breeze passes the chord itself.
    expect(windCrossedSail(eased, wrap(Math.PI + eased + deg(8)))).toBe(true)
    // On the proper tack the wind is the other side of the stern.
    expect(windCrossedSail(eased, deg(120))).toBe(false)
  })

  it('keeps an eased sail out through a dead run, including the branch cut', () => {
    expect(sailTrimTarget(SHEET_MAX, deg(179), SHEET_MAX, 1)).toBeCloseTo(SHEET_MAX, 5)
    expect(sailTrimTarget(SHEET_MAX, deg(-179), SHEET_MAX, 1)).toBeCloseTo(SHEET_MAX, 5)
    expect(sailTrimTarget(SHEET_MAX, Math.PI, SHEET_MAX, 1)).toBeGreaterThan(1)
    expect(sailTrimTarget(SHEET_MAX, -Math.PI, SHEET_MAX, 1)).toBeGreaterThan(1)
  })

  it('holds the port sail the same way, mirrored', () => {
    const byTheLee = deg(170)
    expect(windCrossedSail(-SHEET_MAX, byTheLee)).toBe(false)
    expect(sailTrimTarget(-SHEET_MAX, byTheLee, SHEET_MAX, -1)).toBeCloseTo(-SHEET_MAX, 5)
    const passed = wrap(Math.PI - SHEET_MAX - deg(10))
    expect(windCrossedSail(-SHEET_MAX, passed)).toBe(true)
    expect(sailTrimTarget(-SHEET_MAX, passed, SHEET_MAX, -1)).toBeGreaterThan(0)
  })

  it('gybes only after the wind has passed the boom, then trims on the new side', () => {
    const byTheLee = wrap(Math.PI + deg(40))
    expect(sailTrimTarget(SHEET_MAX, byTheLee, SHEET_MAX, 1)).toBeCloseTo(SHEET_MAX, 5)
    const passed = wrap(Math.PI + SHEET_MAX + deg(12))
    const across = sailTrimTarget(SHEET_MAX, passed, SHEET_MAX, 1)
    expect(across).toBeLessThan(0)
    // A tight sheet on the new side stops on the sheet, not on the wind.
    const tight = sailTrimTarget(SHEET_MAX, passed, deg(30), 1)
    expect(tight).toBeCloseTo(-deg(30), 4)
  })

  it('sheets in to the wind on a reach and luffs when the sheet is eased past it', () => {
    const awa = deg(42)
    expect(sailTrimTarget(deg(20), awa, deg(25), 1)).toBeCloseTo(deg(25), 4)
    expect(sailTrimTarget(deg(20), awa, SHEET_MAX, 1)).toBeCloseTo(awa, 4)
  })

  it('walks the boat toward an eased sail and gybes at the chord, not at twenty degrees by the lee', () => {
    resetSail(1, SHEET_MAX, 0, 0, 0)
    const wind = { blowYaw: 0, speed: 8 }
    const sail = mainOnly(1)
    // Bow to starboard brings a stern wind onto the sail's side. Positive yaw is the other way.
    let gybedAt: number | null = null
    for (let yaw = 0; yaw > -deg(130); yaw -= deg(2)) {
      const pose = { yaw, speed: 4, sway: 0 }
      for (let i = 0; i < 30; i++) rigForce(pose, wind, sail, 0.05)
      const off = windOffStern(apparentWind(pose, wind).awa)
      const boom = getBoom()
      if (off < SHEET_MAX - deg(12)) expect(boom).toBeGreaterThan(deg(70))
      if (gybedAt == null && boom < 0) gybedAt = off
    }
    expect(gybedAt).not.toBeNull()
    // The old rule flipped near 0.35 rad. The chord is out near the shrouds.
    expect(gybedAt!).toBeGreaterThan(deg(60))
    expect(gybedAt!).toBeGreaterThan(SHEET_MAX - deg(15))
    expect(gybedAt!).toBeLessThan(SHEET_MAX + deg(20))
  })

  it('does not flicker across a dead run when the stern wind swaps sign each step', () => {
    resetSail(1, SHEET_MAX, 0, 0, 0)
    const pose = stopped()
    const sail = mainOnly(1)
    for (let i = 0; i < 40; i++) {
      const awa = i % 2 === 0 ? deg(179.2) : deg(-179.2)
      rigForce(pose, air(awa), sail, 0.05)
      expect(getBoom()).toBeGreaterThan(deg(70))
    }
  })

  it('gybes when the sheet is hauled in past a by-the-lee wind', () => {
    const awa = wrap(Math.PI + deg(48))
    resetSail(1, deg(80), 0, 0, 0)
    expect(settleBoom(awa, 1)).toBeGreaterThan(deg(70))
    // Hauling the sheet inside the breeze backwinds the cloth and it crosses.
    const sheet = deg(30) / SHEET_MAX
    expect(settleBoom(awa, sheet, 80)).toBeLessThan(0)
  })

  it('gybes the jib on the same rule, and still wings it when the sheet is hauled across', () => {
    resetSail(1, SHEET_MAX, 1, JIB_SHEET_MAX, 0)
    const pose = stopped()
    const eased: SailCommand = { hoist: 1, sheet: 1, jibHoist: 1, jibPort: 0, jibStarboard: 0, spinHoist: 0 }
    const byTheLee = wrap(Math.PI + deg(35))
    for (let i = 0; i < 40; i++) rigForce(pose, air(byTheLee), eased, 0.05)
    expect(getClew()).toBeGreaterThan(deg(60))
    expect(getBoom()).toBeGreaterThan(deg(60))

    const passed = wrap(Math.PI + JIB_SHEET_MAX + deg(10))
    for (let i = 0; i < 60; i++) rigForce(pose, air(passed), eased, 0.05)
    expect(getClew()).toBeLessThan(0)
    expect(getBoom()).toBeLessThan(0)

    // Wing-and-wing: port sheet hauled, wind still on the starboard-boom side.
    resetSail(1, SHEET_MAX, 1, 0, 0)
    const winged: SailCommand = { hoist: 1, sheet: 1, jibHoist: 1, jibPort: 1, jibStarboard: 0, spinHoist: 0 }
    const run = deg(165)
    for (let i = 0; i < 60; i++) rigForce(pose, air(run), winged, 0.05)
    expect(getBoom()).toBeGreaterThan(deg(60))
    expect(getClew()).toBeLessThan(-deg(60))
  })
})

describe('wind on the sails', () => {
  it('drives hardest at a working angle of attack, not luffing and not stalled', () => {
    const wind = air(Math.PI / 2, 16)
    const pose = stopped()
    const samples = [deg(88), deg(64), deg(25)].map((boom) => {
      resetSail(1, boom, 0, 0, 0)
      const rig = rigForce(pose, wind, mainOnly(1), 0)
      return { aoa: rig.main.aoa, fx: rig.main.fx }
    })
    const [luffing, drawing, stalled] = samples
    expect(luffing.aoa).toBeLessThan(deg(8))
    expect(drawing.aoa).toBeGreaterThan(deg(15))
    expect(drawing.aoa).toBeLessThan(deg(40))
    expect(stalled.aoa).toBeGreaterThan(deg(55))
    expect(drawing.fx).toBeGreaterThan(luffing.fx * 2)
    expect(drawing.fx).toBeGreaterThan(stalled.fx * 1.25)
    expect(drawing.fx).toBeGreaterThan(0)
  })

  it('gives a furled main almost no drive and a hoisted one a real push', () => {
    const wind = air(deg(80), 16)
    const pose = stopped()
    resetSail(0, deg(40), 0, 0, 0)
    const furled = rigForce(pose, wind, { ...mainOnly(0.5), hoist: 0 }, 0)
    resetSail(1, deg(40), 0, 0, 0)
    const set = rigForce(pose, wind, mainOnly(0.5), 0)
    expect(set.main.fx).toBeGreaterThan(800)
    expect(Math.abs(furled.main.fx)).toBeLessThan(set.main.fx * 0.05)
  })

  it('opens the slot for a drawing jib and backwinds the main when the jib is across it', () => {
    const awa = deg(50)
    const open = slotFactor(
      { hoist: 1, boom: deg(28), aoa: deg(22), awa },
      { hoist: 1, clew: deg(14), aoa: deg(24), luff: 0 },
    )
    const across = slotFactor(
      { hoist: 1, boom: deg(28), aoa: deg(22), awa },
      { hoist: 1, clew: deg(-20), aoa: deg(30), luff: 0 },
    )
    const rolled = slotFactor(
      { hoist: 1, boom: deg(28), aoa: deg(22), awa },
      { hoist: 0, clew: deg(14), aoa: deg(24), luff: 0 },
    )
    expect(open).toBeGreaterThan(1.05)
    expect(across).toBeLessThan(1)
    expect(rolled).toBe(1)
  })
})

describe('one sail blanketing another', () => {
  const run = deg(168)

  it('falls off smoothly from a dead wake to clear air', () => {
    expect(pointShadow(0)).toBeCloseTo(1, 5)
    expect(pointShadow(SHADOW_SPREAD)).toBeCloseTo(0, 5)
    expect(pointShadow(SHADOW_SPREAD / 2)).toBeGreaterThan(0.4)
    expect(pointShadow(SHADOW_SPREAD / 2)).toBeLessThan(0.7)
    expect(shadowForceFactor(1)).toBeCloseTo(SHADOW_CORE * SHADOW_CORE, 5)
    expect(shadowForceFactor(0)).toBe(1)
    expect(shadowForceFactor(1)).toBeLessThan(0.2)

    const covered = spanShadow(deg(20), deg(80), deg(50), deg(40))
    const clear = spanShadow(deg(-80), deg(-20), deg(50), deg(40))
    const partial = spanShadow(deg(20), deg(80), deg(70), deg(20))
    expect(covered).toBeCloseTo(1, 5)
    expect(clear).toBe(0)
    expect(partial).toBeGreaterThan(0.2)
    expect(partial).toBeLessThan(0.8)
  })

  it('blankets only once the main is upwind of the headsail', () => {
    expect(aftBlanket(deg(70))).toBe(0)
    expect(aftBlanket(deg(-70))).toBe(0)
    expect(aftBlanket(deg(140))).toBe(1)
    expect(aftBlanket(deg(105))).toBeGreaterThan(0.1)
    expect(aftBlanket(deg(105))).toBeLessThan(0.7)

    const same = headsailShadow(deg(70), 0, deg(74), 1, run)
    const half = headsailShadow(deg(70), 0, deg(70) + SHADOW_SPREAD / 2, 1, run)
    const winged = headsailShadow(deg(-70), 0, deg(74), 1, run)
    const beat = headsailShadow(deg(70), 0, deg(74), 1, deg(40))
    const furled = headsailShadow(deg(70), 0, deg(74), 0, run)
    expect(same).toBeLessThan(0.2)
    expect(half).toBeGreaterThan(same + 0.15)
    expect(half).toBeLessThan(0.75)
    expect(winged).toBeGreaterThan(0.95)
    expect(beat).toBe(1)
    expect(furled).toBe(1)
  })

  it('kills a jib left behind the main on a run and leaves a winged jib alone', () => {
    const pose = stopped()
    const wind = air(run, 18)
    resetSail(1, deg(75), 1, deg(70), 0)
    const blanketed = rigForce(pose, wind, mainOnly(1), 0)
    resetSail(1, deg(75), 1, deg(-70), 0)
    const winged = rigForce(
      pose,
      wind,
      { hoist: 1, sheet: 1, jibHoist: 1, jibPort: 0, jibStarboard: 0, spinHoist: 0 },
      0,
    )
    resetSail(0, 0, 1, deg(70), 0)
    const noMain = rigForce(
      pose,
      wind,
      { hoist: 0, sheet: 1, jibHoist: 1, jibPort: 0, jibStarboard: 0, spinHoist: 0 },
      0,
    )
    expect(winged.jib.fx).toBeGreaterThan(blanketed.jib.fx * 4)
    expect(blanketed.jib.fx).toBeGreaterThan(0)
    expect(noMain.jib.fx).toBeGreaterThan(blanketed.jib.fx * 4)
    // Forward of the beam the main is not in front of the jib.
    const close = air(deg(45), 18)
    resetSail(1, deg(20), 1, deg(18), 0)
    const withMain = rigForce(pose, close, { ...mainOnly(), jibHoist: 1 }, 0)
    resetSail(0, 0, 1, deg(18), 0)
    const bare = rigForce(pose, close, { hoist: 0, sheet: 1, jibHoist: 1, jibPort: 0, jibStarboard: 0, spinHoist: 0 }, 0)
    expect(withMain.jib.fx).toBeCloseTo(bare.jib.fx, 0)
  })

  it('lets the main keep its air on a run and blankets the kite that sits in its wake', () => {
    const pose = stopped()
    const wind = air(run, 18)
    const starboard = {
      hoist: 1,
      sheet: 1,
      jibHoist: 0,
      jibPort: 0,
      jibStarboard: 1,
      spinHoist: 1,
    }
    const port = { ...starboard, jibPort: 1, jibStarboard: 0 }
    resetSail(1, deg(70), 0, SPIN_SHEET_MAX, 1)
    const behind = rigForce(pose, wind, starboard, 0)
    resetSail(1, deg(70), 0, -SPIN_SHEET_MAX, 1)
    const clear = rigForce(pose, wind, port, 0)
    expect(clear.spin.fx).toBeGreaterThan(behind.spin.fx * 3)
    // The main is upwind on this heading, so the kite does not steal its drive.
    const felt = (rig: ReturnType<typeof rigForce>) => rig.fx - rig.jib.fx - rig.spin.fx
    expect(felt(behind)).toBeCloseTo(behind.main.fx * behind.slot, -1)
    expect(felt(clear)).toBeCloseTo(clear.main.fx * clear.slot, -1)
  })

  it('lets a drawing kite in front of the main take the main\'s wind on a reach', () => {
    // Far enough aft for the kite to fill, far enough forward that the kite is upwind.
    const reach = deg(100)
    const pose = stopped()
    const wind = air(reach, 16)
    const set = {
      hoist: 1,
      sheet: 1,
      jibHoist: 0,
      jibPort: 0,
      jibStarboard: 0,
      spinHoist: 1,
    }
    resetSail(1, deg(40), 0, 0, 1)
    const covered = rigForce(pose, wind, set, 0)
    const felt = covered.fx - covered.jib.fx - covered.spin.fx
    const own = covered.main.fx * covered.slot
    expect(covered.spin.luff).toBeLessThan(0.5)
    expect(felt).toBeLessThan(own * 0.75)

    const deep = air(deg(170), 16)
    resetSail(1, deg(70), 0, 0, 1)
    const run = rigForce(pose, deep, set, 0)
    const runFelt = run.fx - run.jib.fx - run.spin.fx
    expect(runFelt).toBeGreaterThan(run.main.fx * run.slot * 0.9)
  })
})

describe('trim sets the speed', () => {
  function settle(sheet: number, windKn: number, trueFromDeg: number, jib = true) {
    resetSail(0, 0, 0, 0, 0)
    const pose = { x: 0, z: 0, yaw: 0, speed: 2, sway: 0, yawRate: 0 }
    const wind = { blowYaw: windOffStern(deg(trueFromDeg)), speed: windKn / MS_TO_KN }
    const sail: SailCommand = {
      hoist: 1,
      sheet,
      jibHoist: jib ? 1 : 0,
      jibPort: jib ? 0.35 : 0,
      jibStarboard: 0,
      spinHoist: 0,
    }
    const dt = 0.05
    let speed = pose.speed
    for (let i = 0; i < 4000; i++) {
      stepHoist(sail.hoist, dt)
      stepJibHoist(sail.jibHoist, dt)
      stepSpinHoist(0, dt)
      stepMotion(pose, IDLE, dt, { wind, sail })
      // Hold the point of sail. Weather helm would otherwise round her up and
      // the speed would be the round-up, not the trim.
      pose.yaw = 0
      pose.yawRate = 0
      if (i % 200 === 199) {
        // Ten seconds with almost no change means the hull has settled.
        if (Math.abs(pose.speed - speed) < 0.02) break
        speed = pose.speed
      }
    }
    return pose.speed
  }

  it('does not pin every trim at the old 12 m/s ceiling', () => {
    // Broad reach, 25 knots. This is the breeze that used to put a wide
    // range of sheets on exactly 12 m/s, which is 23.3 knots.
    // Beam reach, 25 knots. Sheeted a little tight and sheeted about right
    // both used to sit on the 12 m/s clamp, so the knot log read 23.3 either way.
    const tight = settle(0.2, 25, 100)
    const best = settle(0.35, 25, 100)
    const eased = settle(0.5, 25, 100)
    const luffing = settle(0.85, 25, 100)
    expect(best).toBeGreaterThan(13)
    expect(best).toBeLessThan(SPEED_GUARD - 10)
    expect(tight).toBeGreaterThan(12)
    expect(eased).toBeGreaterThan(12)
    // Same wind, three trims that the clamp had made the same speed.
    expect(best).toBeGreaterThan(tight + 0.5)
    expect(best).toBeGreaterThan(eased + 0.5)
    expect(best).toBeGreaterThan(luffing + 2)
    expect(eased).toBeGreaterThan(luffing + 1)
  })

  it('still rewards trim in a moderate breeze, where the old ceiling was not binding', () => {
    const tight = settle(0.2, 16, 90, false)
    const eased = settle(0.9, 16, 90, false)
    const both = settle(0.2, 16, 90, true)
    expect(tight).toBeGreaterThan(eased + 3)
    expect(both).toBeGreaterThan(tight + 0.5)
    expect(tight).toBeLessThan(12)
  })

  it('keeps full-ahead motoring well clear of the sailing guard', () => {
    const pose = { x: 0, z: 0, yaw: 0, speed: 0, sway: 0, yawRate: 0 }
    const drive = { ...IDLE, port: 1, starboard: 1 }
    for (let i = 0; i < 800; i++) stepMotion(pose, drive, 0.05)
    expect(pose.speed).toBeGreaterThan(6)
    expect(pose.speed).toBeLessThan(11)
  })
})
