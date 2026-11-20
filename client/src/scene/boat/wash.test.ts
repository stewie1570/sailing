import { describe, expect, it } from 'vitest'
import { RUDDER_LOCK } from './dynamics'
import { createHullWake, disposeHullWake, hullWakeMotion, poseHullWake, washMotion } from './wash'
import { MS_TO_KN } from './wind'

describe('prop wash', () => {
  it('hides a screw that is in the stop notch', () => {
    const idle = washMotion(0, 0.4)
    expect(idle.on).toBe(false)
    expect(idle.strength).toBe(0)
    expect(idle.kick).toBe(0)
    expect(washMotion(0.02, 1).on).toBe(false)
    expect(washMotion(-0.02, -1).on).toBe(false)
  })

  it('gives each screw its own strength', () => {
    const port = washMotion(0.5, 0)
    const stbd = washMotion(1, 0)
    expect(port.on).toBe(true)
    expect(port.strength).toBeCloseTo(0.5)
    expect(stbd.strength).toBeCloseTo(1)
    expect(port.scrollSign).toBe(1)
    expect(washMotion(-0.75, 0).scrollSign).toBe(-1)
  })

  it('bends ahead wash to starboard on starboard helm, and reverses that astern', () => {
    const ahead = washMotion(1, 1)
    const astern = washMotion(-1, 1)
    expect(ahead.kick).toBeCloseTo(RUDDER_LOCK)
    expect(astern.kick).toBeCloseTo(-RUDDER_LOCK)
    expect(washMotion(1, -1).kick).toBeCloseTo(-RUDDER_LOCK)
  })

  it('ignores a nonsense lever', () => {
    const broken = washMotion(Number.NaN, Number.POSITIVE_INFINITY)
    expect(broken.on).toBe(false)
    expect(broken.kick).toBe(0)
  })
})

describe('stern wake', () => {
  it('stays off with no way on, and when she is going astern', () => {
    const idle = hullWakeMotion(0, 0.6)
    expect(idle.on).toBe(false)
    expect(idle.strength).toBe(0)
    expect(idle.bend).toBe(0)
    expect(hullWakeMotion(1.2, 1).on).toBe(false)
    expect(hullWakeMotion(-4, -1).on).toBe(false)
  })

  it('grows brighter and longer as she sails faster', () => {
    const making = hullWakeMotion(5 / MS_TO_KN, 0)
    const fast = hullWakeMotion(12 / MS_TO_KN, 0)
    const flying = hullWakeMotion(18 / MS_TO_KN, 0)
    expect(making.on).toBe(true)
    expect(fast.strength).toBeGreaterThan(making.strength)
    expect(fast.reach).toBeGreaterThan(making.reach)
    expect(fast.scrollRate).toBeGreaterThan(making.scrollRate)
    expect(flying.strength).toBeCloseTo(1)
    expect(flying.reach).toBeGreaterThan(fast.reach)
  })

  it('bends the trail back toward the path just sailed', () => {
    const stbd = hullWakeMotion(8 / MS_TO_KN, 1)
    const port = hullWakeMotion(8 / MS_TO_KN, -1)
    expect(stbd.bend).toBeLessThan(0)
    expect(port.bend).toBeGreaterThan(0)
    expect(hullWakeMotion(8 / MS_TO_KN, 0).bend).toBe(0)
    expect(Math.abs(stbd.bend)).toBeLessThan(RUDDER_LOCK)
  })

  it('ignores a nonsense speed', () => {
    const broken = hullWakeMotion(Number.NaN, Number.POSITIVE_INFINITY)
    expect(broken.on).toBe(false)
    expect(broken.bend).toBe(0)
    expect(broken.scrollRate).toBe(0)
  })

  it('shows the sheet only once there is way on ahead', () => {
    const wake = createHullWake()
    poseHullWake(wake, 0, 0.4, 1)
    expect(wake.mesh.visible).toBe(false)
    poseHullWake(wake, -3, 0.4, 1)
    expect(wake.mesh.visible).toBe(false)
    poseHullWake(wake, 8, 0.4, 2)
    expect(wake.mesh.visible).toBe(true)
    expect(wake.mesh.name).toBe('hull-wake')
    expect(wake.material.uniforms.uStrength.value).toBeGreaterThan(0.5)
    expect(wake.material.uniforms.uReach.value).toBeGreaterThan(0.5)
    expect(wake.material.uniforms.uBend.value).toBeLessThan(0)
    expect(wake.material.uniforms.uScroll.value).toBeGreaterThan(0)
    disposeHullWake(wake)
  })
})
