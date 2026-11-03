import * as THREE from 'three'
import type { MapData } from '../map/mapData'

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
    basin: [110, 242],
    beacon: [132, 208],
    // Traced from the painted west basin. The north arm and its hook, then the
    // south breakwater, with the two finger rows sitting in the slips.
    segments: [
      { x0: 92, y0: 207, x1: 136, y1: 207, thickness: 34, kind: 'mole' },
      { x0: 132, y0: 207, x1: 134, y1: 224, thickness: 30, kind: 'mole' },
      { x0: 98, y0: 274, x1: 124, y1: 278, thickness: 30, kind: 'mole' },
      { x0: 124, y0: 278, x1: 150, y1: 266, thickness: 28, kind: 'mole' },
    ],
    combs: [
      { x0: 92, y0: 227, x1: 116, y1: 227, spacing: 4.4, length: 5.2, inset: 1.8, sides: [1, -1] },
      { x0: 92, y0: 253, x1: 112, y1: 255, spacing: 4.4, length: 5.6, inset: 1.8, sides: [1, -1] },
    ],
  },
  {
    basin: [876, 534],
    beacon: [820, 506],
    segments: [
      { x0: 816, y0: 498, x1: 828, y1: 516, thickness: 32, kind: 'mole' },
      { x0: 848, y0: 500, x1: 902, y1: 498, thickness: 26, kind: 'mole' },
      { x0: 904, y0: 502, x1: 908, y1: 556, thickness: 22, kind: 'mole' },
      { x0: 844, y0: 568, x1: 904, y1: 566, thickness: 30, kind: 'mole' },
    ],
    combs: [
      { x0: 860, y0: 523, x1: 894, y1: 523, spacing: 4.6, length: 5.4, inset: 2, sides: [1, -1] },
      { x0: 860, y0: 547, x1: 894, y1: 547, spacing: 4.6, length: 5.4, inset: 2, sides: [1, -1] },
    ],
  },
]

/** Water inside each basin, in chart pixels. The chart paints this before the docks. */
export const HARBOR_BASINS: [number, number][][] = [
  [[90, 214], [134, 214], [138, 232], [146, 252], [136, 268], [118, 276], [96, 270], [90, 248]],
  [[834, 512], [848, 504], [902, 502], [906, 558], [900, 566], [844, 564], [828, 520]],
]

function sideToward(comb: Comb, tx: number, ty: number): 1 | -1 {
  const dx = comb.x1 - comb.x0
  const dy = comb.y1 - comb.y0
  const mx = (comb.x0 + comb.x1) / 2
  const my = (comb.y0 + comb.y1) / 2
  const dot = -dy * (tx - mx) + dx * (ty - my)
  return dot >= 0 ? 1 : -1
}

export interface HarborPiece {
  /** Chart pixels. Row 0 is north. */
  x0: number
  y0: number
  x1: number
  y1: number
  /** Metres across the piece. */
  thickness: number
  kind: Kind
}

/** Moles, walkways and fingers in chart pixels. The meshes, the collision and the chart share this list. */
export function harborPieces(): HarborPiece[] {
  const out: HarborPiece[] = []
  for (const marina of MARINAS) {
    for (const seg of marina.segments) out.push(seg)
    for (const comb of marina.combs) {
      out.push({ x0: comb.x0, y0: comb.y0, x1: comb.x1, y1: comb.y1, thickness: WALK, kind: 'deck' })
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
          out.push({
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
  for (const seg of harborPieces()) {
    const dx = seg.x1 - seg.x0
    const dy = seg.y1 - seg.y0
    const lenPx = Math.hypot(dx, dy)
    if (lenPx < 0.4) continue
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
