import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { helmHardware, WHEEL_RADIUS } from './boat/geometry'
import { chaseOffset, rotateYaw } from './boat/physics'
import {
  DECK_LOOK,
  HELM_LOOK_CLEARANCE,
  chaseAim,
  helmLookLocal,
  helmMinDistance,
  stepChaseCamera,
} from './cameraDrive'
import { vesselView } from './boat/vessel'

describe('helmLookLocal', () => {
  it('sits just above the wheel rim on the centreline', () => {
    const wheel = { x: 0, y: 1.8, z: -2.18 }
    const rim = 0.33
    const look = helmLookLocal(wheel, rim)
    expect(look.x).toBe(0)
    expect(look.z).toBe(wheel.z)
    expect(look.y).toBeCloseTo(wheel.y + rim + HELM_LOOK_CLEARANCE)
    expect(look.y).toBeGreaterThan(wheel.y + rim)
  })
})

describe('stepChaseCamera', () => {
  it('keeps a desktop chase on the deck centre', () => {
    const camera = { x: 10, y: 5.2, z: -8 }
    const prev = { x: 10, y: 1, z: 4, yaw: 0.4 }
    const pose = { x: 12, z: 7 }
    const y = 1.4
    const yaw = 0.7
    const aim = stepChaseCamera(camera, prev, pose, y, yaw, DECK_LOOK, DECK_LOOK)
    expect(aim).toEqual({ x: pose.x, y: y + DECK_LOOK.y, z: pose.z })
    // Same move the deck chase used before the phone aim: translate, then yaw around the hull.
    const dYaw = yaw - prev.yaw
    const translatedX = 10 + (pose.x - prev.x)
    const translatedZ = -8 + (pose.z - prev.z)
    const off = rotateYaw(translatedX - pose.x, translatedZ - pose.z, dYaw)
    expect(camera.x).toBeCloseTo(pose.x + off.x)
    expect(camera.z).toBeCloseTo(pose.z + off.z)
    expect(camera.y).toBeCloseTo(5.2 + (y - prev.y))
  })

  it('retargets a phone to just above the helm without moving the lens', () => {
    const camera = { x: 0, y: 5.2, z: -12 }
    const prev = { x: 0, y: 0, z: 0, yaw: 0 }
    const look = helmLookLocal({ x: 0, y: 1.8, z: -2.18 }, 0.33)
    const aim = stepChaseCamera(camera, prev, { x: 0, z: 0 }, 0, 0, DECK_LOOK, look)
    expect(aim).toEqual(chaseAim({ x: 0, z: 0 }, 0, 0, look))
    expect(aim.z).toBeCloseTo(-2.18)
    expect(camera).toEqual({ x: 0, y: 5.2, z: -12 })
  })

  it('centres a phone picture just above the wheel', () => {
    const hardware = helmHardware()
    const look = helmLookLocal(hardware.wheel, WHEEL_RADIUS)
    const camera = new THREE.PerspectiveCamera(55, 9 / 16, 1.5, 45000)
    const parked = chaseOffset(0, 12, 5.2)
    camera.position.set(parked.x, parked.y, parked.z)
    camera.lookAt(look.x, look.y, look.z)
    camera.updateMatrixWorld(true)
    const hub = hardware.wheel.clone().project(camera)
    const rim = hardware.wheel.clone()
    rim.y += WHEEL_RADIUS
    rim.project(camera)
    expect(Math.abs(hub.x)).toBeLessThan(0.02)
    expect(rim.y).toBeLessThan(0.02)
    expect(rim.y).toBeGreaterThan(-0.08)
    expect(hub.y).toBeLessThan(rim.y)
  })

  it('holds that helm aim at the centre while the hull yaws', () => {
    const look = helmLookLocal({ x: 0, y: 1.8, z: -2.18 }, 0.33)
    const camera = { x: 0, y: 5.2, z: -12 }
    const yaw = Math.PI / 2
    const aim = stepChaseCamera(camera, { x: 0, y: 0, z: 0, yaw: 0 }, { x: 0, z: 0 }, 0, yaw, look, look)
    const expected = chaseAim({ x: 0, z: 0 }, 0, yaw, look)
    expect(aim.x).toBeCloseTo(expected.x)
    expect(aim.z).toBeCloseTo(expected.z)
    const offset = rotateYaw(0 - look.x, -12 - look.z, yaw)
    expect(camera.x).toBeCloseTo(expected.x + offset.x)
    expect(camera.z).toBeCloseTo(expected.z + offset.z)
  })
})

describe('helmMinDistance', () => {
  it('reaches the aft deck just behind the wheel', () => {
    const view = vesselView('sail')
    const helm = helmLookLocal(helmHardware().wheel, WHEEL_RADIUS)
    const min = helmMinDistance(helm)
    expect(min).toBeGreaterThan(1)
    expect(min).toBeLessThan(view.minDistance)

    const dy = view.height - helm.y
    const dz = -view.back - helm.z
    const len = Math.hypot(dy, dz)
    const z = helm.z + (dz / len) * min
    expect(z).toBeLessThan(helm.z)
    expect(z).toBeGreaterThan(-6)
  })
})
