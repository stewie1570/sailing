import { beforeEach, describe, expect, it } from 'vitest'
import { CARGO_DECK } from './boat/geometry'
import {
  alongsidePose,
  berthEnds,
  besidePackage,
  bindChallengeChart,
  dismissChallenge,
  dockPoint,
  formatDuration,
  getChallenge,
  packageAlong,
  packageWorld,
  resetChallenge,
  startChallenge,
  stepChallenge,
  type BoatSample,
} from './challenge'
import { fingerBerths, type Berth } from './harborLayout'

const CHART = {
  metersPerPixel: 7.766666666666667,
  width: 1024,
  height: 768,
  harbors: [{ name: 'West Harbor' }, { name: 'East Harbor' }],
}

function stopped(pose: { x: number; z: number; yaw: number }, speed = 0): BoatSample {
  return { ...pose, speed, sway: 0, yawRate: 0 }
}

function bowOn(berth: Berth, side: 1 | -1): BoatSample {
  const bow = 6.2
  const across = side * (berth.thickness / 2 + 0.4 + bow)
  const p = dockPoint(berth, packageAlong(berth), across)
  const yaw = side > 0 ? berth.rotationY + Math.PI : berth.rotationY
  return stopped({ x: p.x, z: p.z, yaw })
}

describe('finger berths', () => {
  const berths = fingerBerths(CHART)

  it('has slips in both harbours', () => {
    expect(berths.filter((berth) => berth.harbor === 0).length).toBeGreaterThan(4)
    expect(berths.filter((berth) => berth.harbor === 1).length).toBeGreaterThan(4)
    expect(berths[0]?.name).toBe('West Harbor')
    expect(berths.find((berth) => berth.harbor === 1)?.name).toBe('East Harbor')
  })

  it('puts the parcel on the pontoon, toward the tip', () => {
    for (const berth of berths) {
      const along = packageAlong(berth)
      expect(along).toBeGreaterThan(0)
      expect(along).toBeLessThan(berth.length / 2 - 1)
      const spot = packageWorld(berth)
      expect(spot.y).toBeCloseTo(berth.y + berth.height)
      const back = dockPoint(berth, along)
      expect(spot.x).toBeCloseTo(back.x)
      expect(spot.z).toBeCloseTo(back.z)
      const ends = berthEnds(berth)
      expect(Math.hypot(ends.x1 - ends.x0, ends.z1 - ends.z0)).toBeCloseTo(berth.length, 5)
    }
  })
})

describe('beside the parcel', () => {
  const berth: Berth = {
    harbor: 0,
    name: 'West Harbor',
    x: 120,
    z: -40,
    y: 0.2,
    rotationY: 0.4,
    length: 42,
    height: 0.7,
    thickness: 8.5,
  }

  it('accepts a hull lying on either side', () => {
    expect(besidePackage(berth, stopped(alongsidePose(berth, 1)))).toBe(true)
    expect(besidePackage(berth, stopped(alongsidePose(berth, -1)))).toBe(true)
  })

  it('accepts a bow laid against the parcel', () => {
    expect(besidePackage(berth, bowOn(berth, 1))).toBe(true)
    expect(besidePackage(berth, bowOn(berth, -1))).toBe(true)
  })

  it('rejects way on, the wrong end of the finger, and open water', () => {
    expect(besidePackage(berth, stopped(alongsidePose(berth, 1), 1.2))).toBe(false)
    const root = dockPoint(berth, -berth.length / 2 + 2, berth.thickness / 2 + 2.6)
    expect(besidePackage(berth, stopped({ x: root.x, z: root.z, yaw: berth.rotationY + Math.PI / 2 }))).toBe(false)
    expect(besidePackage(berth, stopped({ x: berth.x + 80, z: berth.z, yaw: 0 }))).toBe(false)
  })
})

describe('challenge run', () => {
  beforeEach(() => {
    resetChallenge()
    bindChallengeChart(CHART)
  })

  it('formats the clock', () => {
    expect(formatDuration(0)).toBe('0 seconds')
    expect(formatDuration(1000)).toBe('1 second')
    expect(formatDuration(90_000)).toBe('1 minute 30 seconds')
    expect(formatDuration(3_723_000)).toBe('1 hour 2 minutes 3 seconds')
  })

  it('moves the parcel from one harbour to the other once the hull stops', () => {
    expect(startChallenge(5_000, () => 0)).toBe(true)
    const pickup = getChallenge()
    expect(pickup.phase).toBe('pickup')
    expect(pickup.target?.harbor).toBe(0)
    expect(pickup.cargo).toBe('dock')
    expect(pickup.dockCargo).not.toBeNull()

    const pose = stopped(alongsidePose(pickup.target!, 1))
    stepChallenge(pose, 0.1, 5_100)
    expect(getChallenge().phase).toBe('pickup')
    for (let i = 0; i < 12; i++) stepChallenge(pose, 0.1, 5_200 + i * 100)
    const carry = getChallenge()
    expect(carry.phase).toBe('carry')
    expect(carry.target?.harbor).toBe(1)
    expect(carry.cargo).toBe('deck')
    expect(carry.dockCargo).toBeNull()

    const drop = stopped(alongsidePose(carry.target!, -1))
    stepChallenge({ ...drop, speed: 2 }, 1, 8_000)
    expect(getChallenge().phase).toBe('carry')
    for (let i = 0; i < 12; i++) stepChallenge(drop, 0.1, 9_000)
    const done = getChallenge()
    expect(done.phase).toBe('done')
    expect(done.cargo).toBe('dock')
    expect(done.finishedAt).toBe(9_000)
    expect(done.finishedAt! - done.startedAt).toBe(4_000)
    expect(formatDuration(done.finishedAt! - done.startedAt)).toBe('4 seconds')

    dismissChallenge()
    expect(getChallenge().phase).toBe('idle')
    expect(getChallenge().target).toBeNull()
  })

  it('picks the opposite harbour when the first draw is east', () => {
    startChallenge(0, () => 0.9)
    const pose = stopped(alongsidePose(getChallenge().target!, 1))
    for (let i = 0; i < 12; i++) stepChallenge(pose, 0.1, 1_000)
    expect(getChallenge().phase).toBe('carry')
    expect(getChallenge().target?.harbor).toBe(0)
  })

  it('does nothing before the chart is bound', () => {
    bindChallengeChart(null)
    expect(startChallenge(0, () => 0)).toBe(false)
    expect(getChallenge().phase).toBe('idle')
  })
})

describe('aft deck', () => {
  it('is behind the cockpit and short of the transom', () => {
    expect(CARGO_DECK.z).toBeLessThan(-3.6)
    expect(CARGO_DECK.z).toBeGreaterThan(-5.8)
    expect(CARGO_DECK.y).toBeGreaterThan(0.8)
    expect(CARGO_DECK.y).toBeLessThan(2)
    expect(CARGO_DECK.x).toBe(0)
  })
})
