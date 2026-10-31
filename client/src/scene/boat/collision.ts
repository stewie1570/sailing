import type { MapData } from '../../map/mapData'
import { BEACONS, chartToWorld, type DockBox, dockBoxes } from '../harborLayout'
import { BOAT } from './geometry'

export interface Circle {
  x: number
  z: number
  r: number
}

export interface ColliderWorld {
  docks: DockBox[]
  circles: Circle[]
}

/** Docks, buoys, and the beacon columns. Land is sampled from the chart at query time. */
export function colliderWorld(map: MapData): ColliderWorld {
  const circles: Circle[] = map.buoys.map((b) => ({ x: b.x, z: b.z, r: 2.4 }))
  for (const [px, py] of BEACONS) {
    const p = chartToWorld(map, px, py)
    // The painted column is about 3.2 m across; keep the circle on the lamp, not the whole mole.
    circles.push({ x: p.x, z: p.z, r: 3.4 })
  }
  return { docks: dockBoxes(map), circles }
}

function boatCentre(x: number, z: number, yaw: number) {
  return {
    x: x + Math.sin(yaw) * BOAT.originZ,
    z: z + Math.cos(yaw) * BOAT.originZ,
  }
}

/** Separating-axis test. yaw is the three.js Y rotation: local +x → (cos, −sin), local +z → (sin, cos). */
function obbOverlap(
  ax: number, az: number, ayaw: number, ahx: number, ahz: number,
  bx: number, bz: number, byaw: number, bhx: number, bhz: number,
): boolean {
  const axes: [number, number][] = [
    [Math.cos(ayaw), -Math.sin(ayaw)],
    [Math.sin(ayaw), Math.cos(ayaw)],
    [Math.cos(byaw), -Math.sin(byaw)],
    [Math.sin(byaw), Math.cos(byaw)],
  ]
  const dx = bx - ax
  const dz = bz - az
  for (const [ux, uz] of axes) {
    const dist = Math.abs(dx * ux + dz * uz)
    const ra = ahx * Math.abs(Math.cos(ayaw) * ux - Math.sin(ayaw) * uz)
      + ahz * Math.abs(Math.sin(ayaw) * ux + Math.cos(ayaw) * uz)
    const rb = bhx * Math.abs(Math.cos(byaw) * ux - Math.sin(byaw) * uz)
      + bhz * Math.abs(Math.sin(byaw) * ux + Math.cos(byaw) * uz)
    if (dist > ra + rb) return false
  }
  return true
}

function circleHitsBoat(cx: number, cz: number, r: number, x: number, z: number, yaw: number): boolean {
  const dx = cx - x
  const dz = cz - z
  const c = Math.cos(yaw)
  const s = Math.sin(yaw)
  const lx = dx * c - dz * s
  const lz = dx * s + dz * c - BOAT.originZ
  const clampedX = Math.min(BOAT.halfBeam, Math.max(-BOAT.halfBeam, lx))
  const clampedZ = Math.min(BOAT.halfLength, Math.max(-BOAT.halfLength, lz))
  const ex = lx - clampedX
  const ez = lz - clampedZ
  return ex * ex + ez * ez < r * r
}

const LAND = 0.15
/** Painted docks are marked as land on the chart, a pixel or two wider than the mesh. */
const DOCK_HALO = 110
const HILL = 16

function dockClearance(dock: DockBox, x: number, z: number): number {
  const dx = x - dock.x
  const dz = z - dock.z
  const c = Math.cos(dock.rotationY)
  const s = Math.sin(dock.rotationY)
  const lx = dx * c - dz * s
  const lz = dx * s + dz * c
  const hx = dock.length / 2
  const hz = dock.thickness / 2
  const cx = Math.min(hx, Math.max(-hx, lx))
  const cz = Math.min(hz, Math.max(-hz, lz))
  return Math.hypot(lx - cx, lz - cz)
}

function paintedDock(world: ColliderWorld, map: MapData, x: number, z: number): boolean {
  if (map.heightAt(x, z) > HILL) return false
  for (const dock of world.docks) {
    if (dockClearance(dock, x, z) < DOCK_HALO) return true
  }
  return false
}

function hitsLand(map: MapData, world: ColliderWorld, x: number, z: number, yaw: number): boolean {
  const c = Math.cos(yaw)
  const s = Math.sin(yaw)
  const hx = BOAT.halfBeam
  const hz = BOAT.halfLength
  const zc = BOAT.originZ
  for (const lz of [zc - hz, zc - hz * 0.5, zc, zc + hz * 0.5, zc + hz]) {
    for (const lx of [-hx, 0, hx]) {
      const wx = x + lx * c + lz * s
      const wz = z - lx * s + lz * c
      const shore = map.isLand(wx, wz) || map.heightAt(wx, wz) > LAND
      if (shore && !paintedDock(world, map, wx, wz)) return true
    }
  }
  return false
}

/** True when the hull box overlaps a dock, a buoy, a beacon, or the shore. */
export function blocked(map: MapData, world: ColliderWorld, x: number, z: number, yaw: number): boolean {
  if (hitsLand(map, world, x, z, yaw)) return true
  const centre = boatCentre(x, z, yaw)
  for (const dock of world.docks) {
    if (obbOverlap(
      centre.x, centre.z, yaw, BOAT.halfBeam, BOAT.halfLength,
      dock.x, dock.z, dock.rotationY, dock.length / 2, dock.thickness / 2,
    )) return true
  }
  for (const circle of world.circles) {
    if (circleHitsBoat(circle.x, circle.z, circle.r, x, z, yaw)) return true
  }
  return false
}
