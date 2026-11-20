import { describe, expect, it } from 'vitest'
import { RUDDER_LOCK } from './dynamics'
import { washMotion } from './wash'

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
