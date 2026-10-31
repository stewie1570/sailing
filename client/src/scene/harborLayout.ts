import * as THREE from 'three'
import type { MapData } from '../map/mapData'

const MOLE = 34
const WALK = 14
const FINGER = 8.5

type Kind = 'mole' | 'deck' | 'finger'

interface Segment {
  x0: number
  y0: number
  x1: number
  y1: number
  thickness: number
  kind: Kind
}

interface Comb {
  x0: number
  y0: number
  x1: number
  y1: number
  spacing: number
  length: number
  inset: number
  sides: (1 | -1)[]
}

const MARINAS: { segments: Segment[]; combs: Comb[]; beacon: [number, number]; basin: [number, number] }[] = [
  {
    basin: [108, 246],
    beacon: [143, 232],
    segments: [
      { x0: 80, y0: 208, x1: 138, y1: 211, thickness: MOLE, kind: 'mole' },
      { x0: 138, y0: 211, x1: 144, y1: 232, thickness: MOLE, kind: 'mole' },
      { x0: 78, y0: 208, x1: 74, y1: 262, thickness: MOLE, kind: 'mole' },
      { x0: 74, y0: 262, x1: 120, y1: 284, thickness: MOLE, kind: 'mole' },
      { x0: 120, y0: 284, x1: 148, y1: 254, thickness: MOLE, kind: 'mole' },
    ],
    combs: [
      { x0: 100, y0: 230, x1: 134, y1: 224, spacing: 5.2, length: 7.6, inset: 3.2, sides: [1, -1] },
      { x0: 96, y0: 248, x1: 124, y1: 258, spacing: 5.4, length: 7.2, inset: 3, sides: [1, -1] },
      { x0: 124, y0: 258, x1: 130, y1: 268, spacing: 5, length: 6.4, inset: 2.4, sides: [1] },
    ],
  },
  {
    basin: [880, 538],
    beacon: [828, 522],
    segments: [
      { x0: 824, y0: 524, x1: 846, y1: 512, thickness: 42, kind: 'mole' },
      { x0: 846, y0: 512, x1: 912, y1: 498, thickness: MOLE, kind: 'mole' },
      { x0: 846, y0: 576, x1: 912, y1: 564, thickness: MOLE, kind: 'mole' },
      { x0: 912, y0: 500, x1: 918, y1: 570, thickness: MOLE, kind: 'mole' },
    ],
    combs: [
      { x0: 858, y0: 528, x1: 904, y1: 522, spacing: 5.4, length: 8.2, inset: 3, sides: [1, -1] },
      { x0: 856, y0: 550, x1: 906, y1: 546, spacing: 5.4, length: 8, inset: 3, sides: [1, -1] },
    ],
  },
]

function sideToward(comb: Comb, tx: number, ty: number): 1 | -1 {
  const dx = comb.x1 - comb.x0
  const dy = comb.y1 - comb.y0
  const mx = (comb.x0 + comb.x1) / 2
  const my = (comb.y0 + comb.y1) / 2
  const dot = -dy * (tx - mx) + dx * (ty - my)
  return dot >= 0 ? 1 : -1
}

export interface DockBox {
  /** Centre, in world metres. Local +X runs along the length. */
  x: number
  z: number
  y: number
  rotationY: number
  length: number
  height: number
  thickness: number
  kind: Kind
}

/** World-space dock, walkway and finger boxes. Shared by the harbour meshes and the boat collision. */
export function dockBoxes(map: MapData): DockBox[] {
  const out: DockBox[] = []
  const m = map.metersPerPixel
  const push = (seg: Segment) => {
    const dx = seg.x1 - seg.x0
    const dy = seg.y1 - seg.y0
    const lenPx = Math.hypot(dx, dy)
    if (lenPx < 0.4) return
    const length = lenPx * m + (seg.kind === 'finger' ? 1.5 : 6)
    const mole = seg.kind === 'mole'
    const cx = (seg.x0 + seg.x1) / 2
    const cy = (seg.y0 + seg.y1) / 2
    out.push({
      x: (cx - map.width / 2) * m,
      z: (cy - map.height / 2) * m,
      y: mole ? -1.5 : 0.2,
      rotationY: -Math.atan2(dy, dx),
      length,
      height: mole ? 4.3 : 0.7,
      thickness: seg.thickness,
      kind: seg.kind,
    })
  }

  for (const marina of MARINAS) {
    for (const seg of marina.segments) push(seg)
    for (const comb of marina.combs) {
      push({ ...comb, thickness: WALK, kind: 'deck' })
      const dx = comb.x1 - comb.x0
      const dy = comb.y1 - comb.y0
      const len = Math.hypot(dx, dy)
      const ux = dx / len
      const uy = dy / len
      const nx = -uy
      const ny = ux
      const sides = comb.sides.length === 1 ? [sideToward(comb, marina.basin[0], marina.basin[1])] : comb.sides
      for (let d = comb.inset; d <= len - comb.inset + 0.01; d += comb.spacing) {
        const cx = comb.x0 + ux * d
        const cy = comb.y0 + uy * d
        for (const s of sides) {
          push({
            x0: cx,
            y0: cy,
            x1: cx + nx * s * comb.length,
            y1: cy + ny * s * comb.length,
            thickness: FINGER,
            kind: 'finger',
          })
        }
      }
    }
  }
  return out
}

export function chartToWorld(map: MapData, px: number, py: number, y = 0) {
  const m = map.metersPerPixel
  return new THREE.Vector3((px - map.width / 2) * m, y, (py - map.height / 2) * m)
}

/** Beacon bases, in chart pixels. The column stands on the mole head. */
export const BEACONS: [number, number][] = MARINAS.map((h) => h.beacon)

/**
 * Unit cylinder (radius 1 at the base, 0.7 at the top, height 1) scaled into the column and the lamp.
 * World radius is the unit radius times `xz`.
 */
export const BEACON_COLUMN = { radiusBottom: 1, radiusTop: 0.7, baseY: 2.6, height: 11, xz: 3.2 }
export const BEACON_LAMP = { radiusBottom: 1, radiusTop: 0.7, baseY: 13.6, height: 2.2, xz: 2.4 }

const TOWNS = [
  { x0: 46, y0: 176, x1: 80, y1: 238, step: 9 },
  { x0: 926, y0: 508, x1: 972, y1: 570, step: 9.5 },
]

export interface TownBuilding {
  k: number
  x: number
  z: number
  ground: number
  rotationY: number
  w: number
  d: number
  h: number
  shed: boolean
}

/** How far the wall mesh is sunk into the ground so the foundation doesn't float. */
export const BUILDING_SINK = 0.3
/** ConeGeometry radius of the hip roof, in the unscaled mesh. */
export const ROOF_CONE_RADIUS = 0.72
export const ROOF_PAD = 1.08

export function roofHeight(shed: boolean) {
  return shed ? 3.6 : 2.8
}

/** Shore buildings. The same list drives the meshes and the collision boxes. */
export function townBuildings(map: MapData): TownBuilding[] {
  const out: TownBuilding[] = []
  let k = 0
  for (const town of TOWNS) {
    for (let py = town.y0; py <= town.y1; py += town.step) {
      for (let px = town.x0; px <= town.x1; px += town.step) {
        const jx = px + ((k * 5) % 4) * 0.45
        const jz = py + ((k * 3) % 5) * 0.35
        const c = chartToWorld(map, jx, jz, 0)
        const ground = map.heightAt(c.x, c.z)
        if (ground < 0.5 || !map.isLand(c.x, c.z)) { k++; continue }
        const shed = k % 8 === 0
        out.push({
          k,
          x: c.x,
          z: c.z,
          ground,
          rotationY: ((k * 37) % 9 - 4) * 0.08,
          w: (shed ? 22 : 12) + (k % 3) * 3,
          d: (shed ? 14 : 8) + ((k * 7) % 4) * 2,
          h: (shed ? 7 : 4.5) + (k % 3) * 1.4,
          shed,
        })
        k++
      }
    }
  }
  return out
}
