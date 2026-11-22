import { describe, expect, it } from 'vitest'
import { boatShape } from './geometry'
import { stepFerry, type FerryPose } from './ferryDynamics'
import { buildFerry, ferryShape } from './ferryGeometry'
import { azimuthFromPointer, formatAzimuth, resetPods, updatePods, getPods } from './pods'

function rest(): FerryPose {
  return { x: 0, z: 0, yaw: 0, speed: 0, sway: 0, yawRate: 0 }
}

function run(pose: FerryPose, command: Parameters<typeof stepFerry>[1], seconds: number) {
  const dt = 0.05
  for (let i = 0; i < Math.round(seconds / dt); i++) stepFerry(pose, command, dt)
  return pose
}

const stopped = { bowAz: 0, sternAz: 0, bowThrust: 0, sternThrust: 0 }

describe('azimuth pods', () => {
  it('reads ahead as up and port as left on the dial', () => {
    expect(azimuthFromPointer(0, -1)).toBeCloseTo(0, 5)
    expect(azimuthFromPointer(-1, 0)).toBeCloseTo(Math.PI / 2, 5)
    expect(azimuthFromPointer(1, 0)).toBeCloseTo(-Math.PI / 2, 5)
    expect(Math.abs(azimuthFromPointer(0, 1))).toBeCloseTo(Math.PI, 5)
  })

  it('names the ship-relative heading', () => {
    expect(formatAzimuth(0)).toBe('Ahead')
    expect(formatAzimuth(Math.PI / 2)).toBe('Port 90°')
    expect(formatAzimuth(-Math.PI / 4)).toBe('Stbd 45°')
  })

  it('keeps thrust on the current azimuth and wraps the dial', () => {
    resetPods()
    updatePods({ bowAz: Math.PI * 3, bowThrust: 2, sternThrust: -2 })
    const pods = getPods()
    expect(Math.abs(Math.abs(pods.bowAz) - Math.PI)).toBeLessThan(1e-9)
    expect(pods.bowThrust).toBe(1)
    expect(pods.sternThrust).toBe(-1)
    expect(pods.sternAz).toBe(0)
  })
})

describe('ferry dynamics', () => {
  it('drives ahead and astern without yawing when both pods point ahead', () => {
    const ahead = run(rest(), { ...stopped, bowThrust: 1, sternThrust: 1 }, 8)
    expect(ahead.speed).toBeGreaterThan(2)
    expect(Math.abs(ahead.sway)).toBeLessThan(0.05)
    expect(Math.abs(ahead.yaw)).toBeLessThan(0.02)

    const back = run(rest(), { ...stopped, bowThrust: -1, sternThrust: -1 }, 8)
    expect(back.speed).toBeLessThan(-1.2)
    expect(Math.abs(back.yaw)).toBeLessThan(0.02)
  })

  it('reverses the push at a fixed azimuth', () => {
    const port = rest()
    stepFerry(port, { bowAz: Math.PI / 2, sternAz: Math.PI / 2, bowThrust: 1, sternThrust: 1 }, 0.05)
    const stbd = rest()
    stepFerry(stbd, { bowAz: Math.PI / 2, sternAz: Math.PI / 2, bowThrust: -1, sternThrust: -1 }, 0.05)
    expect(port.sway).toBeGreaterThan(0)
    expect(stbd.sway).toBeLessThan(0)
    expect(Math.abs(port.speed)).toBeLessThan(0.02)
    expect(Math.abs(stbd.speed)).toBeLessThan(0.02)
  })

  it('crabs when both pods push the same way and rotates when they oppose', () => {
    const crab = run(rest(), { bowAz: Math.PI / 2, sternAz: Math.PI / 2, bowThrust: 1, sternThrust: 1 }, 3)
    expect(crab.sway).toBeGreaterThan(0.35)
    expect(Math.abs(crab.yawRate)).toBeLessThan(0.05)

    const spin = run(rest(), { bowAz: Math.PI / 2, sternAz: -Math.PI / 2, bowThrust: 1, sternThrust: 1 }, 3)
    expect(spin.yawRate).toBeGreaterThan(0.05)
    expect(Math.abs(spin.sway)).toBeLessThan(0.35)
  })

  it('settles in the stop notch and holds a ferry cruise', () => {
    const moving = rest()
    moving.speed = 1.4
    moving.sway = 0.4
    moving.yawRate = 0.1
    run(moving, stopped, 14)
    expect(moving.speed).toBe(0)
    expect(moving.sway).toBe(0)
    expect(moving.yawRate).toBe(0)

    const cruise = run(rest(), { ...stopped, bowThrust: 1, sternThrust: 1 }, 40)
    expect(cruise.speed).toBeGreaterThan(3.5)
    expect(cruise.speed).toBeLessThan(6.5)
  })
})

describe('ferry deck', () => {
  it('faces upward so the water does not show through', () => {
    const mesh = buildFerry()
    const pos = mesh.geometry.getAttribute('position')
    const col = mesh.geometry.getAttribute('color')
    const index = mesh.geometry.getIndex()
    expect(index).not.toBeNull()
    let faces = 0
    let upward = 0
    for (let i = 0; i < index!.count; i += 3) {
      const ia = index!.getX(i)
      const ib = index!.getX(i + 1)
      const ic = index!.getX(i + 2)
      const grey = [ia, ib, ic].every((v) => Math.abs(col.getX(v) - 0.55) < 0.02 && col.getY(v) > 0.5)
      if (!grey) continue
      faces++
      const abx = pos.getX(ib) - pos.getX(ia)
      const abz = pos.getZ(ib) - pos.getZ(ia)
      const acx = pos.getX(ic) - pos.getX(ia)
      const acz = pos.getZ(ic) - pos.getZ(ia)
      if (abz * acx - abx * acz > 0) upward++
    }
    expect(faces).toBeGreaterThan(0)
    expect(upward).toBe(faces)
    mesh.geometry.dispose()
    const material = mesh.material
    if (Array.isArray(material)) material.forEach((item) => item.dispose())
    else material.dispose()
  })
})

describe('ferry outline', () => {
  it('is a coarse box, much larger than the sloop', () => {
    const ferry = ferryShape()
    const sail = boatShape()
    expect(ferry.slices.length).toBeLessThanOrEqual(4)
    expect(ferry.radius).toBeGreaterThan(sail.radius * 2)
    expect(ferry.spars).toHaveLength(0)
  })
})
