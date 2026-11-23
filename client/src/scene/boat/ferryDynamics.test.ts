import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { bridgeExitLocal, overFerryDeck, shipToWorld, worldToShip } from './ferryBridge'
import { BRIDGE_EYE } from './ferryGeometry'
import { boatShape } from './geometry'
import { stepFerry, type FerryPose } from './ferryDynamics'
import { buildFerry, ferryShape } from './ferryGeometry'
import { azimuthFromPointer, ferryStickPatch, formatAzimuth, formatOrder, getPods, nudgePod, podFromStick, resetPods, stepPods, updatePods, type StickMemory } from './pods'

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

  it('reads a stick as a point on the dome', () => {
    const ahead = podFromStick(0, -1)
    expect(ahead?.az).toBeCloseTo(0, 5)
    expect(ahead?.thrust).toBeCloseTo(1, 5)
    expect(podFromStick(-1, 0)?.az).toBeCloseTo(Math.PI / 2, 5)
    expect(podFromStick(1, 0)?.az).toBeCloseTo(-Math.PI / 2, 5)
    expect(Math.abs(podFromStick(0, 1)?.az ?? 0)).toBeCloseTo(Math.PI, 5)
    expect(podFromStick(0, 0)).toBeNull()
    expect(podFromStick(0.1, -0.1)).toBeNull()
    expect(formatOrder(0)).toBe('Stop')
    expect(formatOrder(1)).toBe('Full')
    expect(formatOrder(0.5)).toBe('Slow')
  })

  it('puts the left stick on the bow pod and the right stick on the stern', () => {
    const memory: StickMemory = { bow: false, stern: false }
    const idle = { bow: false, stern: false }
    const fullAhead = ferryStickPatch([0, -1, 0, 0], memory, idle)
    expect(fullAhead.bowAz).toBeCloseTo(0, 5)
    expect(fullAhead.bowThrust).toBeCloseTo(1, 5)
    expect(fullAhead.sternThrust).toBeUndefined()

    const port = ferryStickPatch([-1, 0, 0.7, 0], memory, idle)
    expect(port.bowAz).toBeCloseTo(Math.PI / 2, 5)
    expect(port.bowThrust).toBeCloseTo(1, 5)
    expect(port.sternAz).toBeCloseTo(-Math.PI / 2, 5)
    expect(port.sternThrust).toBeGreaterThan(0.5)

    const released = ferryStickPatch([0, 0, 0, 0], memory, idle)
    expect(released.bowThrust).toBe(0)
    expect(released.sternThrust).toBe(0)
    expect(released.bowAz).toBeUndefined()

    const resting = ferryStickPatch([0, 0, 0, 0], memory, idle)
    expect(resting).toEqual({})

    memory.bow = true
    const held = ferryStickPatch([0, -1, 0, 0], memory, { bow: true, stern: false })
    expect(held.bowThrust).toBeUndefined()
    expect(memory.bow).toBe(true)
  })

  it('walks a pod lever with the stick and leaves it when the stick centres', () => {
    const ahead = nudgePod(0, 0, 0, -1, 0.5)
    expect(ahead?.az).toBeCloseTo(0, 5)
    expect(ahead?.thrust).toBeCloseTo(0.45, 2)
    expect(nudgePod(0, 0.45, 0, 0, 0.5)).toBeNull()

    const held = ferryStickPatch([0, -1, 0, 0], { bow: false, stern: false }, { bow: false, stern: false }, false, 0.5, {
      bowAz: 0, sternAz: 0, bowThrust: 0, sternThrust: 0,
    })
    expect(held.bowThrust).toBeGreaterThan(0.4)
    expect(held.bowAz).toBeCloseTo(0, 5)

    const released = ferryStickPatch([0, 0, 0, 0], { bow: true, stern: false }, { bow: false, stern: false }, false, 0.5, {
      bowAz: 0, sternAz: 0, bowThrust: 0.5, sternThrust: 0,
    })
    expect(released).toEqual({})

    const rim = nudgePod(0, 1, 0, -1, 1)
    expect(rim?.thrust).toBeLessThanOrEqual(1)
    const port = nudgePod(0, 1, -1, 0, 0.4)
    expect(port?.az).toBeGreaterThan(0.2)
  })

  it('keeps thrust on the current azimuth and wraps the dial', () => {
    resetPods()
    updatePods({ bowAz: Math.PI * 3, bowThrust: 2, sternThrust: -2 })
    const pods = getPods()
    expect(Math.abs(Math.abs(pods.bowAz) - Math.PI)).toBeLessThan(1e-9)
    expect(pods.bowThrust).toBe(1)
    expect(pods.sternThrust).toBe(-1)
    expect(pods.sternAz).toBe(0)
    expect(pods.bowAim).toBe(0)
  })

  it('slews the pod toward the lever the short way', () => {
    resetPods()
    updatePods({ bowAz: Math.PI / 2, sternAz: -Math.PI / 2 })
    stepPods(0.1)
    stepPods(0.1)
    const moved = getPods()
    expect(moved.bowAim ?? 0).toBeGreaterThan(0.2)
    expect(moved.bowAim ?? 0).toBeLessThan(Math.PI / 2)
    expect(moved.sternAim ?? 0).toBeLessThan(-0.2)
    expect(moved.sternAim ?? 0).toBeGreaterThan(-Math.PI / 2)

    const before = Math.PI - 0.1
    updatePods({ bowAim: before, bowAz: -Math.PI + 0.1 })
    stepPods(0.05)
    expect(getPods().bowAim ?? 0).toBeGreaterThan(before)

    for (let i = 0; i < 30; i++) stepPods(0.1)
    expect(getPods().bowAim).toBeCloseTo(-Math.PI + 0.1, 5)
    expect(getPods().sternAim).toBeCloseTo(-Math.PI / 2, 5)
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

  it('pushes along the pod until the pod has caught the lever', () => {
    const pose = rest()
    stepFerry(pose, {
      bowAz: Math.PI / 2,
      sternAz: Math.PI / 2,
      bowThrust: 1,
      sternThrust: 1,
      bowAim: 0,
      sternAim: 0,
    }, 0.05)
    expect(pose.speed).toBeGreaterThan(0)
    expect(Math.abs(pose.sway)).toBeLessThan(0.02)
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
    expect(cruise.speed).toBeGreaterThan(7)
    expect(cruise.speed).toBeLessThan(9.5)
  })
})

describe('ferry bridge camera', () => {
  it('snaps onto the deck and steps back outside the hull', () => {
    expect(overFerryDeck(BRIDGE_EYE.x, BRIDGE_EYE.y, BRIDGE_EYE.z)).toBe(true)
    expect(overFerryDeck(0, 16, -38)).toBe(false)
    expect(overFerryDeck(0, 4, -40)).toBe(false)

    const ahead = bridgeExitLocal(0)
    expect(overFerryDeck(ahead.x, ahead.y, ahead.z)).toBe(false)
    expect(ahead.z).toBeLessThan(-20)

    const toPort = bridgeExitLocal(Math.PI / 2)
    expect(overFerryDeck(toPort.x, toPort.y, toPort.z)).toBe(false)
    expect(toPort.x).toBeLessThan(-6)

    const pose = { x: 10, z: -4, yaw: 0.4 }
    const world = shipToWorld(pose, 1.2, BRIDGE_EYE)
    const back = worldToShip(pose, 1.2, world.x, world.y, world.z)
    expect(back.x).toBeCloseTo(BRIDGE_EYE.x, 5)
    expect(back.y).toBeCloseTo(BRIDGE_EYE.y, 5)
    expect(back.z).toBeCloseTo(BRIDGE_EYE.z, 5)
  })
})

function disposeFerry(mesh: THREE.Mesh) {
  mesh.geometry.dispose()
  const material = mesh.material
  if (Array.isArray(material)) material.forEach((item) => item.dispose())
  else material.dispose()
}

describe('ferry deck', () => {
  it('faces upward so the water does not show through', () => {
    const mesh = buildFerry()
    const pos = mesh.geometry.getAttribute('position')
    const col = mesh.geometry.getAttribute('color')
    const index = mesh.geometry.getIndex()
    expect(index).not.toBeNull()
    let faces = 0
    let upward = 0
    const plate: number[] = []
    for (let i = 0; i < index!.count; i += 3) {
      const ia = index!.getX(i)
      const ib = index!.getX(i + 1)
      const ic = index!.getX(i + 2)
      const grey = [ia, ib, ic].every((v) => Math.abs(col.getX(v) - 0.55) < 0.02 && col.getY(v) > 0.5)
      if (!grey) continue
      faces++
      plate.push(pos.getY(ia), pos.getY(ib), pos.getY(ic))
      const abx = pos.getX(ib) - pos.getX(ia)
      const abz = pos.getZ(ib) - pos.getZ(ia)
      const acx = pos.getX(ic) - pos.getX(ia)
      const acz = pos.getZ(ic) - pos.getZ(ia)
      if (abz * acx - abx * acz > 0) upward++
    }
    expect(faces).toBeGreaterThan(0)
    expect(upward).toBe(faces)
    expect(Math.max(...plate) - Math.min(...plate)).toBeLessThan(1e-4)
    disposeFerry(mesh)
  })

  it('is one plate from the chair, including the bow and the stern', () => {
    const mesh = buildFerry()
    mesh.updateMatrixWorld(true)
    const pos = mesh.geometry.getAttribute('position')
    const col = mesh.geometry.getAttribute('color')
    let plateY = 0
    for (let i = 0; i < pos.count; i++) {
      if (Math.abs(col.getX(i) - 0.55) < 0.02 && col.getY(i) > 0.5) {
        plateY = pos.getY(i)
        break
      }
    }
    const ray = new THREE.Raycaster()
    const from = new THREE.Vector3(BRIDGE_EYE.x, BRIDGE_EYE.y, BRIDGE_EYE.z)
    for (const z of [17.2, 18.6, 19.4, -17.2, -18.6, -19.4]) {
      for (const x of [-2.2, 0, 1.4]) {
        const below = new THREE.Vector3(x, plateY - 0.4, z)
        const dir = below.clone().sub(from)
        const reach = dir.length()
        ray.set(from, dir.normalize())
        const hits = ray.intersectObject(mesh, false).filter((hit) => hit.distance <= reach + 0.05)
        expect(hits.length, `deck at ${x}, ${z}`).toBeGreaterThan(0)
        expect(hits[0].point.y, `plate at ${x}, ${z}`).toBeCloseTo(plateY, 2)
      }
    }
    // A look out through the raised gunwale meets the lip, not the lake.
    for (const z of [19.2, -19.2]) {
      const origin = new THREE.Vector3(0, plateY + 0.08, z)
      ray.set(origin, new THREE.Vector3(1, 0, 0))
      const hit = ray.intersectObject(mesh, false)[0]
      expect(hit, `starboard lip at ${z}`).toBeTruthy()
      expect(hit.point.x).toBeGreaterThan(3)
      expect(hit.point.x).toBeLessThan(6.2)
    }
    disposeFerry(mesh)
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
