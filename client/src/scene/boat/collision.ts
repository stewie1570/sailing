import type { MapData } from '../../map/mapData'
import {
  BEACON_COLUMN,
  BEACON_LAMP,
  BEACONS,
  BUILDING_SINK,
  ROOF_CONE_RADIUS,
  ROOF_PAD,
  chartToWorld,
  dockBoxes,
  roofHeight,
  townBuildings,
  type DockBox,
} from '../harborLayout'
import {
  CANOPY,
  TRUNK,
  eachVisibleTree,
  maxFoliageRadius,
  maxTrunkRadius,
  treeFrame,
  treeOriginY,
} from '../treeLayout'
import { boatShape, type BoatShape, type HullSlice, type Spar } from './geometry'

/**
 * The hull stops when its skin meets another mesh, not when a loose box around it
 * does. Docks, beacons, buoys, buildings and trees use the same dimensions as the
 * draw calls. The shore is the terrain mesh that is actually on screen (the coarse
 * grid), sampled only while the boat is near land. Open water is a handful of
 * height lookups; props are distance-rejected, and trees sit in a grid.
 */

interface Terrain {
  segX: number
  segZ: number
  nx: number
  worldWidth: number
  worldDepth: number
  heights: Float32Array
}

interface Box {
  x: number
  z: number
  y0: number
  y1: number
  cos: number
  sin: number
  halfX: number
  halfZ: number
}

interface Disc {
  x: number
  z: number
  y0: number
  y1: number
  r0: number
  r1: number
}

/** Buoy body cylinder. The topmark is narrower, so it never touches first. */
export const BUOY_BODY = { radiusBottom: 1.1, radiusTop: 0.9, height: 2.6, lift: 1 }

interface TreeCol {
  x: number
  z: number
  y: number
  h: number
  sx: number
}

interface TreeGrid {
  cell: number
  maxR: number
  buckets: Map<number, TreeCol[]>
}

export interface ColliderWorld {
  shape: BoatShape
  terrain: Terrain
  boxes: Box[]
  discs: Disc[]
  trees: TreeGrid
}

const CELL = 64
const scratch = new Float32Array(512)

function boxOf(d: DockBox): Box {
  return {
    x: d.x,
    z: d.z,
    y0: d.y,
    y1: d.y + d.height,
    cos: Math.cos(d.rotationY),
    sin: Math.sin(d.rotationY),
    halfX: d.length / 2,
    halfZ: d.thickness / 2,
  }
}

function buildTerrain(map: MapData, segX: number, segZ: number): Terrain {
  const nx = segX + 1
  const nz = segZ + 1
  const heights = new Float32Array(nx * nz)
  for (let j = 0; j < nz; j++) {
    const z = (j / segZ - 0.5) * map.worldDepth
    for (let i = 0; i < nx; i++) {
      const x = (i / segX - 0.5) * map.worldWidth
      heights[j * nx + i] = map.heightAt(x, z)
    }
  }
  return { segX, segZ, nx, worldWidth: map.worldWidth, worldDepth: map.worldDepth, heights }
}

function buildTrees(map: MapData, fraction: number): TreeGrid {
  const buckets = new Map<number, TreeCol[]>()
  let maxR = 0
  eachVisibleTree(map, fraction, (instance, x, z, scale) => {
    const frame = treeFrame(instance, scale)
    const wide = Math.max(frame.sx, frame.sz)
    const tree: TreeCol = {
      x,
      z,
      y: treeOriginY(map.heightAt(x, z)),
      h: frame.h,
      sx: wide,
    }
    maxR = Math.max(maxR, CANOPY[0].radius * wide)
    const ix = Math.floor(x / CELL)
    const iz = Math.floor(z / CELL)
    const key = (ix + 4096) * 8192 + (iz + 4096)
    const bucket = buckets.get(key)
    if (bucket) bucket.push(tree)
    else buckets.set(key, [tree])
  })
  return { cell: CELL, maxR, buckets }
}

/** Docks, buildings, buoys, beacons and the trees the current quality actually draws. */
export function colliderWorld(map: MapData, segments: readonly [number, number], treeFraction: number): ColliderWorld {
  const boxes = dockBoxes(map).map(boxOf)
  const roofHalf = ROOF_CONE_RADIUS * Math.SQRT1_2
  for (const b of townBuildings(map)) {
    const rot = b.rotationY
    const base = b.ground - BUILDING_SINK
    boxes.push({
      x: b.x, z: b.z, y0: base, y1: base + b.h,
      cos: Math.cos(rot), sin: Math.sin(rot),
      halfX: b.w / 2, halfZ: b.d / 2,
    })
    const roofH = roofHeight(b.shed)
    const y0 = base + b.h
    boxes.push({
      x: b.x, z: b.z, y0, y1: y0 + roofH,
      cos: Math.cos(rot), sin: Math.sin(rot),
      halfX: roofHalf * b.w * ROOF_PAD,
      halfZ: roofHalf * b.d * ROOF_PAD,
    })
  }
  const discs: Disc[] = []
  const buoyHalf = BUOY_BODY.height / 2
  for (const b of map.buoys) {
    discs.push({
      x: b.x,
      z: b.z,
      y0: BUOY_BODY.lift - buoyHalf,
      y1: BUOY_BODY.lift + buoyHalf,
      r0: BUOY_BODY.radiusBottom,
      r1: BUOY_BODY.radiusTop,
    })
  }
  for (const [px, py] of BEACONS) {
    const p = chartToWorld(map, px, py)
    discs.push({
      x: p.x, z: p.z,
      y0: BEACON_COLUMN.baseY,
      y1: BEACON_COLUMN.baseY + BEACON_COLUMN.height,
      r0: BEACON_COLUMN.radiusBottom * BEACON_COLUMN.xz,
      r1: BEACON_COLUMN.radiusTop * BEACON_COLUMN.xz,
    })
    discs.push({
      x: p.x, z: p.z,
      y0: BEACON_LAMP.baseY,
      y1: BEACON_LAMP.baseY + BEACON_LAMP.height,
      r0: BEACON_LAMP.radiusBottom * BEACON_LAMP.xz,
      r1: BEACON_LAMP.radiusTop * BEACON_LAMP.xz,
    })
  }
  return {
    shape: boatShape(),
    terrain: buildTerrain(map, segments[0], segments[1]),
    boxes,
    discs,
    trees: buildTrees(map, treeFraction),
  }
}

function gridCoord(t: Terrain, x: number, z: number): [number, number] {
  const fx = Math.min(t.segX, Math.max(0, (x / t.worldWidth + 0.5) * t.segX))
  const fz = Math.min(t.segZ, Math.max(0, (z / t.worldDepth + 0.5) * t.segZ))
  return [fx, fz]
}

/** Height of the rendered terrain mesh. Matches PlaneGeometry's triangle split. */
export function terrainMeshHeight(t: Terrain, x: number, z: number): number {
  const [fx, fz] = gridCoord(t, x, z)
  let i = Math.floor(fx)
  let j = Math.floor(fz)
  if (i >= t.segX) i = t.segX - 1
  if (j >= t.segZ) j = t.segZ - 1
  const tx = fx - i
  const tz = fz - j
  const nx = t.nx
  const h = t.heights
  const a = h[j * nx + i]
  const d = h[j * nx + i + 1]
  const b = h[(j + 1) * nx + i]
  const c = h[(j + 1) * nx + i + 1]
  if (tx + tz <= 1) return a * (1 - tx - tz) + b * tz + d * tx
  return b * (1 - tx) + c * (tx + tz - 1) + d * (1 - tz)
}

function terrainMax(t: Terrain, x0: number, z0: number, x1: number, z1: number): number {
  const [fx0, fz0] = gridCoord(t, Math.min(x0, x1), Math.min(z0, z1))
  const [fx1, fz1] = gridCoord(t, Math.max(x0, x1), Math.max(z0, z1))
  const i0 = Math.floor(fx0)
  const j0 = Math.floor(fz0)
  const i1 = Math.ceil(fx1)
  const j1 = Math.ceil(fz1)
  let m = -1e9
  const nx = t.nx
  const h = t.heights
  for (let j = j0; j <= j1; j++) {
    const row = j * nx
    for (let i = i0; i <= i1; i++) {
      const v = h[row + i]
      if (v > m) m = v
    }
  }
  return m
}

function hitsTerrain(t: Terrain, shape: BoatShape, x: number, z: number, yaw: number, heave: number): boolean {
  const r = shape.radius
  // A triangle's max is at a vertex. If every vertex under the boat is below the
  // lowest skin sample, the shore mesh cannot be touching the hull.
  if (terrainMax(t, x - r, z - r, x + r, z + r) < shape.skinMinY + heave) return false
  const c = Math.cos(yaw)
  const s = Math.sin(yaw)
  const skin = shape.skin
  for (let i = 0; i < skin.length; i += 3) {
    const lx = skin[i]
    const ly = skin[i + 1]
    const lz = skin[i + 2]
    const wx = x + lx * c + lz * s
    const wz = z - lx * s + lz * c
    if (terrainMeshHeight(t, wx, wz) >= ly + heave) return true
  }
  return false
}

function edgeCross(ox: number, oz: number, ax: number, az: number, bx: number, bz: number) {
  return (ax - ox) * (bz - oz) - (az - oz) * (bx - ox)
}

function pointInConvex(xz: Float32Array, x: number, z: number): boolean {
  const n = xz.length
  for (let i = 0; i < n; i += 2) {
    const j = (i + 2) % n
    if (edgeCross(xz[i], xz[i + 1], xz[j], xz[j + 1], x, z) < -1e-6) return false
  }
  return n >= 6
}

function distPointSeg(px: number, pz: number, ax: number, az: number, bx: number, bz: number) {
  const abx = bx - ax
  const abz = bz - az
  const len2 = abx * abx + abz * abz
  let t = 0
  if (len2 > 1e-12) t = Math.min(1, Math.max(0, ((px - ax) * abx + (pz - az) * abz) / len2))
  const dx = ax + abx * t - px
  const dz = az + abz * t - pz
  return Math.hypot(dx, dz)
}

function polyHitsCircle(xz: Float32Array, lx: number, lz: number, r: number): boolean {
  if (pointInConvex(xz, lx, lz)) return true
  const n = xz.length
  for (let i = 0; i < n; i += 2) {
    const j = (i + 2) % n
    if (distPointSeg(lx, lz, xz[i], xz[i + 1], xz[j], xz[j + 1]) <= r) return true
  }
  return false
}

function toBoat(x: number, z: number, c: number, s: number, wx: number, wz: number): [number, number] {
  const dx = wx - x
  const dz = wz - z
  return [dx * c - dz * s, dx * s + dz * c]
}

function overlap(a0: number, a1: number, b0: number, b1: number): [number, number] | null {
  const lo = Math.max(Math.min(a0, a1), Math.min(b0, b1))
  const hi = Math.min(Math.max(a0, a1), Math.max(b0, b1))
  return hi < lo ? null : [lo, hi]
}

function discRadius(d: Disc, y0: number, y1: number) {
  const span = d.y1 - d.y0 || 1
  const at = (y: number) => {
    const t = Math.min(1, Math.max(0, (y - d.y0) / span))
    return d.r0 + (d.r1 - d.r0) * t
  }
  return Math.max(at(y0), at(y1))
}

function circleHitsSlice(slice: HullSlice, x: number, z: number, c: number, s: number, cx: number, cz: number, r: number) {
  const [lx, lz] = toBoat(x, z, c, s, cx, cz)
  return polyHitsCircle(slice.xz, lx, lz, r)
}

function boxGap(box: Box, x: number, z: number) {
  const dx = x - box.x
  const dz = z - box.z
  const lx = dx * box.cos - dz * box.sin
  const lz = dx * box.sin + dz * box.cos
  const cx = Math.min(box.halfX, Math.max(-box.halfX, lx))
  const cz = Math.min(box.halfZ, Math.max(-box.halfZ, lz))
  return Math.hypot(lx - cx, lz - cz)
}

function polyHitsAabb(n: number, hx: number, hz: number): boolean {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
  for (let i = 0; i < n; i += 2) {
    const x = scratch[i]
    const z = scratch[i + 1]
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (z < minZ) minZ = z
    if (z > maxZ) maxZ = z
  }
  if (maxX < -hx || minX > hx || maxZ < -hz || minZ > hz) return false
  for (let i = 0; i < n; i += 2) {
    const j = (i + 2) % n
    const ex = scratch[j] - scratch[i]
    const ez = scratch[j + 1] - scratch[i + 1]
    const len = Math.hypot(ex, ez)
    if (len < 1e-8) continue
    const ax = -ez / len
    const az = ex / len
    let pmin = Infinity
    let pmax = -Infinity
    for (let k = 0; k < n; k += 2) {
      const p = scratch[k] * ax + scratch[k + 1] * az
      if (p < pmin) pmin = p
      if (p > pmax) pmax = p
    }
    const limit = hx * Math.abs(ax) + hz * Math.abs(az)
    if (pmin > limit || pmax < -limit) return false
  }
  return true
}

function sliceToBox(slice: HullSlice, x: number, z: number, c: number, s: number, box: Box): number {
  const xz = slice.xz
  const n = xz.length
  for (let i = 0; i < n; i += 2) {
    const wx = x + xz[i] * c + xz[i + 1] * s
    const wz = z - xz[i] * s + xz[i + 1] * c
    const dx = wx - box.x
    const dz = wz - box.z
    scratch[i] = dx * box.cos - dz * box.sin
    scratch[i + 1] = dx * box.sin + dz * box.cos
  }
  return n
}

function distPointAabb(px: number, pz: number, hx: number, hz: number) {
  const dx = Math.max(Math.abs(px) - hx, 0)
  const dz = Math.max(Math.abs(pz) - hz, 0)
  return Math.hypot(dx, dz)
}

function clipSlab(p: number, d: number, min: number, max: number, t0: number, t1: number): [number, number] | null {
  if (Math.abs(d) < 1e-12) return p < min || p > max ? null : [t0, t1]
  let tn = (min - p) / d
  let tf = (max - p) / d
  if (tn > tf) { const swap = tn; tn = tf; tf = swap }
  const a = tn > t0 ? tn : t0
  const b = tf < t1 ? tf : t1
  return a > b ? null : [a, b]
}

function segIntersectsAabb(x0: number, z0: number, x1: number, z1: number, hx: number, hz: number) {
  const x = clipSlab(x0, x1 - x0, -hx, hx, 0, 1)
  if (!x) return false
  return clipSlab(z0, z1 - z0, -hz, hz, x[0], x[1]) !== null
}

function segHitsAabb(ax: number, az: number, bx: number, bz: number, hx: number, hz: number, rad: number) {
  if (segIntersectsAabb(ax, az, bx, bz, hx, hz)) return true
  let d = Math.min(distPointAabb(ax, az, hx, hz), distPointAabb(bx, bz, hx, hz))
  d = Math.min(d, distPointSeg(hx, hz, ax, az, bx, bz))
  d = Math.min(d, distPointSeg(hx, -hz, ax, az, bx, bz))
  d = Math.min(d, distPointSeg(-hx, hz, ax, az, bx, bz))
  d = Math.min(d, distPointSeg(-hx, -hz, ax, az, bx, bz))
  return d <= rad
}

function sparSegment(spar: Spar, x: number, z: number, c: number, s: number, heave: number, y0: number, y1: number) {
  const ay = spar.y0 + heave
  const by = spar.y1 + heave
  const span = overlap(ay, by, y0, y1)
  if (!span) return null
  const dy = by - ay
  let t0 = 0
  let t1 = 1
  if (Math.abs(dy) > 1e-8) {
    t0 = (span[0] - ay) / dy
    t1 = (span[1] - ay) / dy
    if (t0 > t1) { const swap = t0; t0 = t1; t1 = swap }
  }
  const at = (t: number) => {
    const lx = spar.x0 + (spar.x1 - spar.x0) * t
    const lz = spar.z0 + (spar.z1 - spar.z0) * t
    return [x + lx * c + lz * s, z - lx * s + lz * c] as const
  }
  const a = at(t0)
  const b = at(t1)
  return { ax: a[0], az: a[1], bx: b[0], bz: b[1], y0: span[0], y1: span[1] }
}

function hitsBox(box: Box, shape: BoatShape, x: number, z: number, yaw: number, heave: number) {
  if (boxGap(box, x, z) > shape.radius) return false
  const c = Math.cos(yaw)
  const s = Math.sin(yaw)
  for (const slice of shape.slices) {
    if (slice.y1 + heave < box.y0 || slice.y0 + heave > box.y1) continue
    const n = sliceToBox(slice, x, z, c, s, box)
    if (polyHitsAabb(n, box.halfX, box.halfZ)) return true
  }
  for (const spar of shape.spars) {
    const seg = sparSegment(spar, x, z, c, s, heave, box.y0, box.y1)
    if (!seg) continue
    const ax = (seg.ax - box.x) * box.cos - (seg.az - box.z) * box.sin
    const az = (seg.ax - box.x) * box.sin + (seg.az - box.z) * box.cos
    const bx = (seg.bx - box.x) * box.cos - (seg.bz - box.z) * box.sin
    const bz = (seg.bx - box.x) * box.sin + (seg.bz - box.z) * box.cos
    if (segHitsAabb(ax, az, bx, bz, box.halfX, box.halfZ, spar.r)) return true
  }
  return false
}

function hitsDisc(d: Disc, shape: BoatShape, x: number, z: number, yaw: number, heave: number) {
  const dx = d.x - x
  const dz = d.z - z
  const reach = shape.radius + Math.max(d.r0, d.r1)
  if (dx * dx + dz * dz > reach * reach) return false
  const c = Math.cos(yaw)
  const s = Math.sin(yaw)
  for (const slice of shape.slices) {
    const span = overlap(slice.y0 + heave, slice.y1 + heave, d.y0, d.y1)
    if (!span) continue
    if (circleHitsSlice(slice, x, z, c, s, d.x, d.z, discRadius(d, span[0], span[1]))) return true
  }
  for (const spar of shape.spars) {
    const seg = sparSegment(spar, x, z, c, s, heave, d.y0, d.y1)
    if (!seg) continue
    const r = discRadius(d, seg.y0, seg.y1) + spar.r
    if (distPointSeg(d.x, d.z, seg.ax, seg.az, seg.bx, seg.bz) <= r) return true
  }
  return false
}

function hitsTree(tree: TreeCol, shape: BoatShape, x: number, z: number, yaw: number, heave: number) {
  const dx = tree.x - x
  const dz = tree.z - z
  const reach = shape.radius + CANOPY[0].radius * tree.sx
  if (dx * dx + dz * dz > reach * reach) return false
  const c = Math.cos(yaw)
  const s = Math.sin(yaw)
  const local = (worldY: number) => (worldY - tree.y) / tree.h
  for (const slice of shape.slices) {
    const span = overlap(slice.y0 + heave, slice.y1 + heave, tree.y, tree.y + TRUNK.height * tree.h)
    if (span) {
      const r = maxTrunkRadius(local(span[0]), local(span[1]), tree.sx)
      if (r > 0 && circleHitsSlice(slice, x, z, c, s, tree.x, tree.z, r)) return true
    }
    const leaves = overlap(slice.y0 + heave, slice.y1 + heave, tree.y + CANOPY[0].y0 * tree.h, tree.y + CANOPY[1].y1 * tree.h)
    if (leaves) {
      const r = maxFoliageRadius(local(leaves[0]), local(leaves[1]), tree.sx)
      if (r > 0 && circleHitsSlice(slice, x, z, c, s, tree.x, tree.z, r)) return true
    }
  }
  for (const spar of shape.spars) {
    const trunkTop = tree.y + TRUNK.height * tree.h
    const segT = sparSegment(spar, x, z, c, s, heave, tree.y, trunkTop)
    if (segT) {
      const r = maxTrunkRadius(local(segT.y0), local(segT.y1), tree.sx) + spar.r
      if (r > spar.r && distPointSeg(tree.x, tree.z, segT.ax, segT.az, segT.bx, segT.bz) <= r) return true
    }
    const segL = sparSegment(spar, x, z, c, s, heave, tree.y + CANOPY[0].y0 * tree.h, tree.y + CANOPY[1].y1 * tree.h)
    if (segL) {
      const r = maxFoliageRadius(local(segL.y0), local(segL.y1), tree.sx) + spar.r
      if (r > spar.r && distPointSeg(tree.x, tree.z, segL.ax, segL.az, segL.bx, segL.bz) <= r) return true
    }
  }
  return false
}

function hitsTrees(grid: TreeGrid, shape: BoatShape, x: number, z: number, yaw: number, heave: number) {
  const reach = shape.radius + grid.maxR
  const i0 = Math.floor((x - reach) / grid.cell)
  const i1 = Math.floor((x + reach) / grid.cell)
  const j0 = Math.floor((z - reach) / grid.cell)
  const j1 = Math.floor((z + reach) / grid.cell)
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const bucket = grid.buckets.get((i + 4096) * 8192 + (j + 4096))
      if (!bucket) continue
      for (const tree of bucket) {
        if (hitsTree(tree, shape, x, z, yaw, heave)) return true
      }
    }
  }
  return false
}

/** True when the sailboat mesh touches the shore, a dock, or any other solid. */
export function blocked(world: ColliderWorld, x: number, z: number, yaw: number, heave = 0): boolean {
  if (hitsTerrain(world.terrain, world.shape, x, z, yaw, heave)) return true
  for (const box of world.boxes) {
    if (hitsBox(box, world.shape, x, z, yaw, heave)) return true
  }
  for (const disc of world.discs) {
    if (hitsDisc(disc, world.shape, x, z, yaw, heave)) return true
  }
  return hitsTrees(world.trees, world.shape, x, z, yaw, heave)
}
