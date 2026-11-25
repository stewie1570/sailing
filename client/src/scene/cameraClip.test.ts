import { describe, expect, it } from 'vitest'
import type { CameraBox } from './boat/collision'
import { boatShape, CARGO_DECK } from './boat/geometry'
import {
  CAMERA_MARGIN,
  CAMERA_NEAR_MAX,
  CAMERA_NEAR_MIN,
  cameraNear,
  cargoBoxes,
  hullSkinGap,
  resolveChaseCamera,
  type ChaseHull,
} from './cameraClip'

const shape = boatShape()
const hull: ChaseHull = { x: 0, z: 0, yaw: 0, y: 0, shape }
const target = { x: 0, y: 1.15, z: 0 }

function findInside() {
  for (let z = 5; z >= 0; z -= 0.25) {
    const point = { x: 0, y: 1.15, z }
    if (hullSkinGap(hull, point) < 0) return point
  }
  return null
}

describe('cameraNear', () => {
  it('stays at the far-view plane until the lens is close', () => {
    expect(cameraNear(12)).toBe(CAMERA_NEAR_MAX)
    expect(cameraNear(8)).toBe(CAMERA_NEAR_MAX)
  })

  it('shrinks as a surface approaches, and never clips that surface', () => {
    const near = cameraNear(CAMERA_MARGIN)
    expect(near).toBeGreaterThan(CAMERA_NEAR_MIN)
    expect(near).toBeLessThan(CAMERA_MARGIN)
  })

  it('bottoms out inside a solid', () => {
    expect(cameraNear(0)).toBe(CAMERA_NEAR_MIN)
    expect(cameraNear(Number.NaN)).toBe(CAMERA_NEAR_MAX)
  })
})

describe('resolveChaseCamera', () => {
  it('leaves the ordinary chase view where the sailor put it', () => {
    const camera = { x: 0, y: 5.2, z: -12 }
    const once = resolveChaseCamera({ camera, target, hull })
    const twice = resolveChaseCamera({ camera: once, target, hull })
    expect(once.x).toBeCloseTo(camera.x, 3)
    expect(once.y).toBeCloseTo(camera.y, 3)
    expect(once.z).toBeCloseTo(camera.z, 3)
    expect(twice.z).toBeCloseTo(once.z, 3)
    expect(cameraNear(once.clearance)).toBe(CAMERA_NEAR_MAX)
  })

  it('stops a lens that has swung into the bow on the outside of the stem', () => {
    const inside = findInside()
    expect(inside).not.toBeNull()
    if (!inside) return
    const once = resolveChaseCamera({ camera: inside, target, hull })
    const twice = resolveChaseCamera({ camera: once, target, hull })
    expect(Math.hypot(once.x, once.z)).toBeGreaterThan(Math.hypot(inside.x, inside.z))
    expect(Math.sign(once.z)).toBe(Math.sign(inside.z))
    expect(hullSkinGap(hull, once)).toBeGreaterThanOrEqual(CAMERA_MARGIN - 0.03)
    expect(twice.x).toBeCloseTo(once.x, 2)
    expect(twice.z).toBeCloseTo(once.z, 2)
  })

  it('follows the bow after the hull has yawed', () => {
    const yawed: ChaseHull = { x: 10, z: 20, yaw: Math.PI / 2, y: 0, shape }
    const camera = { x: 15, y: 1.15, z: 20 }
    const look = { x: 10, y: 1.15, z: 20 }
    expect(hullSkinGap(yawed, camera)).toBeLessThan(0)
    const result = resolveChaseCamera({ camera, target: look, hull: yawed })
    expect(result.x).toBeGreaterThan(camera.x)
    expect(Math.abs(result.z - 20)).toBeLessThan(0.6)
    expect(hullSkinGap(yawed, result)).toBeGreaterThanOrEqual(CAMERA_MARGIN - 0.03)
  })

  it('lets a ferry zoom stay over the deck on the way into the chair', () => {
    const inside = findInside()
    expect(inside).not.toBeNull()
    if (!inside) return
    const stayed = resolveChaseCamera({ camera: inside, target, hull, allowInsideHull: true })
    expect(stayed.x).toBeCloseTo(inside.x, 4)
    expect(stayed.z).toBeCloseTo(inside.z, 4)
  })

  it('slides a lens off the mast instead of running up the spar', () => {
    const mast = shape.spars.find((spar) => spar.y1 > spar.y0 + 8 && Math.abs(spar.x0) < 0.01)
    expect(mast).toBeTruthy()
    if (!mast) return
    const camera = { x: mast.x0, y: (mast.y0 + mast.y1) / 2, z: mast.z0 }
    const result = resolveChaseCamera({ camera, target, hull })
    expect(Math.hypot(result.x - camera.x, result.z - camera.z)).toBeGreaterThan(0.25)
    expect(result.y).toBeCloseTo(camera.y, 1)
  })

  it('nudges a lens that is just outside a parcel out to the shell', () => {
    const box: CameraBox = { x: 0, z: 0, y0: 0, y1: 2, cos: 1, sin: 0, halfX: 1, halfZ: 1 }
    const camera = { x: 1.1, y: 1, z: 0 }
    const result = resolveChaseCamera({
      camera,
      target: { x: 1.1, y: 1, z: 20 },
      boxes: [box],
    })
    expect(result.x).toBeCloseTo(1 + CAMERA_MARGIN, 2)
    expect(result.y).toBeCloseTo(1, 2)
    expect(result.z).toBeCloseTo(0, 2)
  })

  it('pulls a lens out of a parcel toward the boat, and stays there', () => {
    const box: CameraBox = { x: 0, z: 0, y0: 0, y1: 2, cos: 1, sin: 0, halfX: 0.6, halfZ: 0.6 }
    const camera = { x: 0, y: 1, z: 0.4 }
    const look = { x: 0, y: 1, z: 12 }
    const once = resolveChaseCamera({ camera, target: look, boxes: [box] })
    const twice = resolveChaseCamera({ camera: once, target: look, boxes: [box] })
    expect(once.z).toBeGreaterThan(0.6)
    expect(once.z).toBeLessThan(0.6 + CAMERA_MARGIN + 0.08)
    expect(twice.z).toBeCloseTo(once.z, 2)
  })

  it('lifts the lens off a bank and ignores the lakebed', () => {
    const bank = resolveChaseCamera({
      camera: { x: 0, y: 1, z: 0 },
      target: { x: 0, y: 1, z: 8 },
      groundAt: () => 3,
    })
    expect(bank.y).toBeCloseTo(3 + CAMERA_MARGIN, 3)
    const lake = resolveChaseCamera({
      camera: { x: 0, y: 2, z: 0 },
      target: { x: 0, y: 2, z: 8 },
      groundAt: () => -6,
    })
    expect(lake.y).toBeCloseTo(2, 3)
  })
})

describe('cargoBoxes', () => {
  it('puts the dock parcel on the pontoon', () => {
    const boxes = cargoBoxes({
      kind: 'sail',
      cargo: 'dock',
      dock: { x: 10, y: 1, z: 20, rotationY: 0 },
      pose: null,
    })
    expect(boxes).toHaveLength(1)
    expect(boxes[0].x).toBeCloseTo(10, 4)
    expect(boxes[0].z).toBeCloseTo(20, 4)
    expect(boxes[0].y0).toBeCloseTo(1.02, 4)
    expect(boxes[0].y1 - boxes[0].y0).toBeCloseTo(0.96, 4)
  })

  it('turns the aft-deck crate with the sloop', () => {
    const boxes = cargoBoxes({
      kind: 'sail',
      cargo: 'deck',
      dock: null,
      pose: { x: 100, z: 200, yaw: Math.PI / 2, y: 1 },
    })
    expect(boxes).toHaveLength(1)
    expect(boxes[0].x).toBeCloseTo(100 + CARGO_DECK.z, 3)
    expect(boxes[0].z).toBeCloseTo(200, 3)
    expect(boxes[0].y0).toBeCloseTo(1 + CARGO_DECK.y + 0.04, 3)
  })

  it('lines three cars up for a ferry and leaves an idle run empty', () => {
    const dock = cargoBoxes({
      kind: 'ferry',
      cargo: 'dock',
      dock: { x: 0, y: 0, z: 0, rotationY: 0 },
      pose: null,
    })
    expect(dock).toHaveLength(3)
    const xs = dock.map((box) => box.x).sort((a, b) => a - b)
    expect(xs[1]).toBeCloseTo(0, 3)
    expect(xs[0]).toBeLessThan(-2)
    expect(xs[2]).toBeGreaterThan(2)
    expect(cargoBoxes({ kind: 'sail', cargo: 'none', dock: null, pose: null })).toHaveLength(0)
  })
})
