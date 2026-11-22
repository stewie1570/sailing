import { describe, expect, it } from 'vitest'
import type { MapData } from '../map/mapData'
import { FERRY_BEAM, FERRY_LOA, SAIL_BEAM, SAIL_LOA } from './boat/vessel'
import {
  CHART_MPP,
  berthFits,
  berthsFor,
  dockBoxes,
  inHarbor,
  randomBerth,
  type Berth,
} from './harborLayout'

const map = {
  width: 1024,
  height: 768,
  metersPerPixel: CHART_MPP,
  toPixel(x: number, z: number): [number, number] {
    return [x / CHART_MPP + 512, z / CHART_MPP + 384]
  },
} as MapData

function worldOf(px: number, py: number) {
  return { x: (px - map.width / 2) * CHART_MPP, z: (py - map.height / 2) * CHART_MPP }
}

function insideDock(x: number, z: number) {
  for (const box of dockBoxes(map)) {
    const dx = x - box.x
    const dz = z - box.z
    const c = Math.cos(box.rotationY)
    const s = Math.sin(box.rotationY)
    const lx = dx * c - dz * s
    const lz = dx * s + dz * c
    if (Math.abs(lx) <= box.length / 2 - 0.05 && Math.abs(lz) <= box.thickness / 2 - 0.05) return true
  }
  return false
}

/** Inset corners of the hull that should be lying in clear water. */
function samples(berth: Berth) {
  const loa = berth.kind === 'ferry' ? FERRY_LOA : SAIL_LOA
  const beam = berth.kind === 'ferry' ? FERRY_BEAM : SAIL_BEAM
  const halfL = loa / 2 - 1
  const halfB = beam / 2 - 0.7
  const c = Math.cos(berth.yaw)
  const s = Math.sin(berth.yaw)
  const origin = worldOf(berth.px, berth.py)
  const out: { x: number; z: number }[] = []
  for (const lx of [-halfB, 0, halfB]) {
    for (const lz of [-halfL, 0, halfL]) {
      out.push({
        x: origin.x + lx * c + lz * s,
        z: origin.z - lx * s + lz * c,
      })
    }
  }
  return out
}

describe('berths', () => {
  it('keeps a pool of sail slips and a smaller set of ferry linkspans', () => {
    const sail = berthsFor('sail')
    const ferry = berthsFor('ferry')
    expect(sail.length).toBeGreaterThanOrEqual(20)
    expect(ferry.length).toBeGreaterThanOrEqual(4)
    expect(sail.every(berthFits)).toBe(true)
    expect(ferry.every(berthFits)).toBe(true)
  })

  it('draws a challenge from one class only', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 12; i++) {
      const berth = randomBerth('sail', () => i / 12)
      expect(berth.kind).toBe('sail')
      seen.add(berth.id)
    }
    expect(seen.size).toBeGreaterThan(1)
    expect(randomBerth('ferry', () => 0).kind).toBe('ferry')
    expect(randomBerth('sail', () => 0).id).toBe(randomBerth('sail', () => 0).id)
  })

  it('puts each hull in clear water inside a basin', () => {
    for (const berth of [...berthsFor('sail'), ...berthsFor('ferry')]) {
      for (const sample of samples(berth)) {
        expect(inHarbor(map, sample.x, sample.z), berth.id).toBe(true)
        expect(insideDock(sample.x, sample.z), berth.id).toBe(false)
      }
    }
  })
})
