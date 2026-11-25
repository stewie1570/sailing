import type { CameraBox, CameraDisc, ColliderWorld } from './boat/collision'
import { CARGO_DECK, type BoatShape, type HullSlice, type Spar } from './boat/geometry'
import { FERRY_CARGO } from './boat/ferryGeometry'
import type { VesselKind } from './boat/vessel'

/**
 * The chase camera orbits a point on the boat, so a short zoom or a swing
 * toward the bow puts the lens inside the hull, and the same swing crosses a
 * parcel or a dock. The picture is held a short way outside those solids.
 * The aim the sailor set is left alone, so once the bow or the parcel is
 * out of the way the view returns to the distance they chose.
 *
 * The near plane starts at 1.5 m. That far in front of the lens, a surface
 * opens up while the camera is still outside it. {@link cameraNear} shrinks
 * the plane as the lens approaches, so the skin stays visible until the
 * camera actually reaches the shell.
 */

/** How far the lens stays from a hull, a parcel, a dock, or a tree. */
export const CAMERA_MARGIN = 0.42

/**
 * The mast and the boom are thin. A hull-sized shell around them would
 * shove the view off the deck.
 */
const SPAR_MARGIN = 0.2

/** Closest the near plane is allowed. Matches the chair view's close lens. */
export const CAMERA_NEAR_MIN = 0.08

/** The far-view near plane. Depth on the far shore stays put at this value. */
export const CAMERA_NEAR_MAX = 1.5

/** Terrain above this is a bank. The lakebed is below it and is not a wall. */
const SHORE = 0.15

interface Vec {
  x: number
  y: number
  z: number
}

interface Normal {
  gap: number
  nx: number
  ny: number
  nz: number
}

export interface ChaseHull {
  x: number
  z: number
  yaw: number
  /** World height of the waterline this frame. */
  y: number
  shape: BoatShape
}

export interface ChaseBody extends ChaseHull {
  kind: VesselKind
  world: ColliderWorld
}

export interface ChaseQuery {
  camera: Vec
  target: Vec
  hull?: ChaseHull | null
  /**
   * The ferry chair is reached by zooming onto the deck. While the aim is
   * already over that deck the hull must not push the lens back outside.
   */
  allowInsideHull?: boolean
  boxes?: readonly CameraBox[]
  discs?: readonly CameraDisc[]
  groundAt?: (x: number, z: number) => number
  margin?: number
}

export interface ChasePose extends Vec {
  /** Metres from the resolved lens to the nearest solid. Large when nothing is close. */
  clearance: number
}

const stored: ChaseBody = {
  x: 0,
  z: 0,
  yaw: 0,
  y: 0,
  kind: 'sail',
  shape: null as unknown as BoatShape,
  world: null as unknown as ColliderWorld,
}
let storedOn = false

/** The hull that is currently being driven. The guard reads it after the chase step. */
export function publishChaseBody(next: ChaseBody) {
  stored.x = next.x
  stored.z = next.z
  stored.yaw = next.yaw
  stored.y = next.y
  stored.kind = next.kind
  stored.shape = next.shape
  stored.world = next.world
  storedOn = true
}

export function chaseBody(): ChaseBody | null {
  return storedOn ? stored : null
}

export function clearChaseBody() {
  storedOn = false
}

/** Near plane for a lens this far from the nearest solid. */
export function cameraNear(clearance: number) {
  if (!Number.isFinite(clearance)) return CAMERA_NEAR_MAX
  const near = Math.max(0, clearance) * 0.55
  return Math.min(CAMERA_NEAR_MAX, Math.max(CAMERA_NEAR_MIN, near))
}

/**
 * Signed distance to the hull slices, negative when the point is inside one.
 * Outside, this is the distance to the skin. Inside, the bands meet, so the
 * magnitude is only the distance to the nearest band face, not to the outer
 * planking. Callers treat a negative value as "still inside" and walk out
 * until the positive distance clears the shell. The mast is not part of this.
 */
export function hullSkinGap(hull: ChaseHull, point: Vec) {
  const local = toLocal(hull, point)
  let best = Infinity
  const slices = hull.shape.slices
  for (let i = 0; i < slices.length; i++) {
    const gap = prismGap(slices[i], local.x, local.y, local.z)
    if (gap < best) best = gap
  }
  return best
}

interface CargoQuery {
  kind: VesselKind
  cargo: 'none' | 'dock' | 'deck'
  dock: { x: number; y: number; z: number; rotationY: number } | null
  pose: { x: number; z: number; yaw: number; y: number } | null
}

/**
 * The parcel or the three cars, in the same place the meshes are drawn.
 * A dock parcel sits 2 cm above the pontoon: the marker group is 8 cm up
 * and the cargo itself is 6 cm below that. The sloop's crate is 4 cm off
 * the aft planks. The ferry's cars sit on the vehicle deck.
 */
export function cargoBoxes(query: CargoQuery): CameraBox[] {
  if (query.cargo === 'none') return []
  if (query.cargo === 'dock') {
    if (!query.dock) return []
    const y0 = query.dock.y + 0.02
    if (query.kind === 'ferry') return cars(query.dock.x, query.dock.z, query.dock.rotationY, 0, 0, y0, false)
    return [crate(query.dock.x, query.dock.z, query.dock.rotationY, 0, 0, y0)]
  }
  if (!query.pose) return []
  const pose = query.pose
  if (query.kind === 'ferry') {
    return cars(pose.x, pose.z, pose.yaw, FERRY_CARGO.x, FERRY_CARGO.z, pose.y + FERRY_CARGO.y, true)
  }
  return [crate(pose.x, pose.z, pose.yaw, CARGO_DECK.x, CARGO_DECK.z, pose.y + CARGO_DECK.y + 0.04)]
}

/** Move the lens out of the hull and the other solids. The aim is not modified. */
export function resolveChaseCamera(query: ChaseQuery): ChasePose {
  const margin = query.margin ?? CAMERA_MARGIN
  const boxes = query.boxes ?? []
  const discs = query.discs ?? []
  let point = { x: query.camera.x, y: query.camera.y, z: query.camera.z }
  const target = query.target
  const hull = query.hull ?? null
  const allow = query.allowInsideHull === true

  point = relaxWorld(point, target, boxes, discs, query.groundAt, margin)
  if (hull && !allow) {
    point = escapeHull(point, target, hull, margin)
    const outside = copy(point)
    point = relaxWorld(point, target, boxes, discs, query.groundAt, margin)
    if (hullSkinGap(hull, point) < margin - 1e-3) point = outside
  }
  if (hull) {
    const before = copy(point)
    point = nudgeSpars(point, hull)
    if (!allow && hullSkinGap(hull, point) < margin - 1e-3) point = before
  }

  return { x: point.x, y: point.y, z: point.z, clearance: measure(point, hull, boxes, discs, query.groundAt) }
}

function relaxWorld(
  point: Vec,
  target: Vec,
  boxes: readonly CameraBox[],
  discs: readonly CameraDisc[],
  groundAt: ((x: number, z: number) => number) | undefined,
  margin: number,
) {
  let p = point
  for (let pass = 0; pass < 6; pass++) {
    const interior = deepestInterior(p, boxes, discs)
    if (interior) {
      p = shortestEscape(p, target, interior.ok, interior.limit, UP)
      continue
    }
    const shell = nearestShell(p, boxes, discs, margin)
    if (shell) {
      p = {
        x: p.x + shell.nx * shell.need,
        y: p.y + shell.ny * shell.need,
        z: p.z + shell.nz * shell.need,
      }
      continue
    }
    const lifted = liftGround(p, groundAt, margin)
    if (lifted) {
      p = lifted
      continue
    }
    break
  }
  return p
}

const UP: Vec = { x: 0, y: 1, z: 0 }

interface Interior {
  ok: (point: Vec) => boolean
  limit: number
}

function deepestInterior(point: Vec, boxes: readonly CameraBox[], discs: readonly CameraDisc[]): Interior | null {
  let best = 0
  let found: Interior | null = null
  for (let i = 0; i < boxes.length; i++) {
    const box = boxes[i]
    const gap = boxMetrics(box, point).gap
    if (gap >= 0 || gap >= best) continue
    best = gap
    const halfY = (box.y1 - box.y0) / 2
    found = {
      ok: (q) => boxMetrics(box, q).gap >= 0,
      limit: 2 * Math.hypot(box.halfX, box.halfZ, halfY) + 1,
    }
  }
  for (let i = 0; i < discs.length; i++) {
    const disc = discs[i]
    const gap = discMetrics(disc, point).gap
    if (gap >= 0 || gap >= best) continue
    best = gap
    found = {
      ok: (q) => discMetrics(disc, q).gap >= 0,
      limit: disc.r * 2 + Math.abs(disc.y1 - disc.y0) + 1,
    }
  }
  return found
}

interface Shell {
  need: number
  nx: number
  ny: number
  nz: number
}

function nearestShell(point: Vec, boxes: readonly CameraBox[], discs: readonly CameraDisc[], margin: number): Shell | null {
  let found: Shell | null = null
  const consider = (gap: number, nx: number, ny: number, nz: number) => {
    if (gap < 0 || gap >= margin) return
    const need = margin - gap
    if (found && need <= found.need) return
    found = { need, nx, ny, nz }
  }
  for (let i = 0; i < boxes.length; i++) {
    const m = boxMetrics(boxes[i], point)
    consider(m.gap, m.nx, m.ny, m.nz)
  }
  for (let i = 0; i < discs.length; i++) {
    const m = discMetrics(discs[i], point)
    consider(m.gap, m.nx, m.ny, m.nz)
  }
  return found
}

function liftGround(point: Vec, groundAt: ((x: number, z: number) => number) | undefined, margin: number): Vec | null {
  if (!groundAt) return null
  const ground = groundAt(point.x, point.z)
  if (!(ground > SHORE) || point.y >= ground + margin) return null
  return { x: point.x, y: ground + margin, z: point.z }
}

function escapeHull(point: Vec, target: Vec, hull: ChaseHull, margin: number) {
  if (hullSkinGap(hull, point) >= margin) return point
  const limit = hull.shape.radius + margin + 8
  return shortestEscape(point, target, (q) => hullSkinGap(hull, q) >= margin, limit, astern(hull))
}

function nudgeSpars(point: Vec, hull: ChaseHull) {
  let p = point
  const spars = hull.shape.spars
  for (let pass = 0; pass < 2; pass++) {
    let worst: Shell | null = null
    let worstGap = SPAR_MARGIN
    for (let i = 0; i < spars.length; i++) {
      const m = sparMetrics(hull, spars[i], p)
      if (m.gap >= worstGap) continue
      worstGap = m.gap
      worst = { need: SPAR_MARGIN - m.gap, nx: m.nx, ny: m.ny, nz: m.nz }
    }
    if (!worst) break
    p = {
      x: p.x + worst.nx * worst.need,
      y: p.y + worst.ny * worst.need,
      z: p.z + worst.nz * worst.need,
    }
  }
  return p
}

function measure(
  point: Vec,
  hull: ChaseHull | null,
  boxes: readonly CameraBox[],
  discs: readonly CameraDisc[],
  groundAt: ((x: number, z: number) => number) | undefined,
) {
  let best = 40
  if (hull) {
    const skin = hullSkinGap(hull, point)
    if (skin < best) best = skin
    const spars = hull.shape.spars
    for (let i = 0; i < spars.length; i++) {
      const gap = sparMetrics(hull, spars[i], point).gap
      if (gap < best) best = gap
    }
  }
  for (let i = 0; i < boxes.length; i++) {
    const gap = boxMetrics(boxes[i], point).gap
    if (gap < best) best = gap
  }
  for (let i = 0; i < discs.length; i++) {
    const gap = discMetrics(discs[i], point).gap
    if (gap < best) best = gap
  }
  if (groundAt) {
    const ground = groundAt(point.x, point.z)
    if (ground > SHORE) {
      const gap = point.y - ground
      if (gap < best) best = gap
    }
  }
  return best
}

function shortestEscape(point: Vec, target: Vec, ok: (q: Vec) => boolean, limit: number, fallback: Vec) {
  if (ok(point)) return point
  const awayDir = direction(point, target, fallback)
  const away = march(point, awayDir, ok, limit)
  const towardLen = Math.hypot(target.x - point.x, target.y - point.y, target.z - point.z)
  const toward = towardLen > 0.05
    ? march(point, { x: (target.x - point.x) / towardLen, y: (target.y - point.y) / towardLen, z: (target.z - point.z) / towardLen }, ok, towardLen)
    : null
  if (away && toward) return dist2(away, point) <= dist2(toward, point) ? away : toward
  return away ?? toward ?? point
}

function march(origin: Vec, dir: Vec, ok: (q: Vec) => boolean, limit: number): Vec | null {
  if (!(limit > 0.02)) return null
  const at = (t: number): Vec => ({
    x: origin.x + dir.x * t,
    y: origin.y + dir.y * t,
    z: origin.z + dir.z * t,
  })
  if (ok(origin)) return origin
  let hi = 0.25
  let steps = 0
  while (!ok(at(hi)) && hi < limit && steps < 100) {
    hi = Math.min(limit, hi + 0.4)
    steps++
  }
  if (!ok(at(hi))) return null
  let lo = Math.max(0, hi - 0.4)
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2
    if (ok(at(mid))) hi = mid
    else lo = mid
  }
  return at(hi)
}

function direction(point: Vec, target: Vec, fallback: Vec): Vec {
  const x = point.x - target.x
  const y = point.y - target.y
  const z = point.z - target.z
  const len = Math.hypot(x, y, z)
  if (len < 0.05) return fallback
  return { x: x / len, y: y / len, z: z / len }
}

function astern(hull: ChaseHull): Vec {
  const c = Math.cos(hull.yaw)
  const s = Math.sin(hull.yaw)
  // A little up as well, so a lens parked on the look point climbs off the deck.
  const x = -s
  const y = 0.35
  const z = -c
  const len = Math.hypot(x, y, z)
  return { x: x / len, y: y / len, z: z / len }
}

function boxMetrics(box: CameraBox, point: Vec): Normal {
  const dx = point.x - box.x
  const dz = point.z - box.z
  const lx = dx * box.cos - dz * box.sin
  const lz = dx * box.sin + dz * box.cos
  const cy = (box.y0 + box.y1) / 2
  const hy = (box.y1 - box.y0) / 2
  const ly = point.y - cy
  const ax = Math.abs(lx)
  const ay = Math.abs(ly)
  const az = Math.abs(lz)
  const ox = ax - box.halfX
  const oy = ay - hy
  const oz = az - box.halfZ
  if (ox > 0 || oy > 0 || oz > 0) {
    const qx = Math.max(ox, 0)
    const qy = Math.max(oy, 0)
    const qz = Math.max(oz, 0)
    return unitNormal(box, sign(lx) * qx, sign(ly) * qy, sign(lz) * qz, Math.hypot(qx, qy, qz))
  }
  const penX = box.halfX - ax
  const penY = hy - ay
  const penZ = box.halfZ - az
  let pen = penX
  let nlx = sign(lx)
  let nly = 0
  let nlz = 0
  if (penY < pen) {
    pen = penY
    nlx = 0
    nly = sign(ly)
    nlz = 0
  }
  if (penZ < pen) {
    pen = penZ
    nlx = 0
    nly = 0
    nlz = sign(lz)
  }
  return unitNormal(box, nlx, nly, nlz, -pen)
}

function unitNormal(box: CameraBox, lx: number, ly: number, lz: number, gap: number): Normal {
  const len = Math.hypot(lx, ly, lz)
  const nx = len > 1e-8 ? lx / len : 0
  const ny = len > 1e-8 ? ly / len : 1
  const nz = len > 1e-8 ? lz / len : 0
  return {
    gap,
    nx: nx * box.cos + nz * box.sin,
    ny,
    nz: -nx * box.sin + nz * box.cos,
  }
}

function discMetrics(disc: CameraDisc, point: Vec): Normal {
  const dx = point.x - disc.x
  const dz = point.z - disc.z
  const horiz = Math.hypot(dx, dz)
  const radial = horiz - disc.r
  const below = disc.y0 - point.y
  const above = point.y - disc.y1
  const yOut = below > 0 ? below : above > 0 ? above : 0
  if (radial < 0 && yOut === 0) {
    const penR = -radial
    const penY = Math.min(point.y - disc.y0, disc.y1 - point.y)
    if (penY < penR) {
      return { gap: -penY, nx: 0, ny: point.y >= (disc.y0 + disc.y1) / 2 ? 1 : -1, nz: 0 }
    }
    const inv = horiz > 1e-5 ? 1 / horiz : 0
    return { gap: -penR, nx: inv ? dx * inv : 1, ny: 0, nz: inv ? dz * inv : 0 }
  }
  const hd = Math.max(radial, 0)
  const gap = Math.hypot(hd, yOut)
  let nx = 0
  let ny = 0
  let nz = 0
  if (hd > 0 && horiz > 1e-5) {
    nx = (dx / horiz) * hd
    nz = (dz / horiz) * hd
  }
  if (below > 0) ny = -below
  else if (above > 0) ny = above
  const len = Math.hypot(nx, ny, nz) || 1
  return { gap, nx: nx / len, ny: ny / len, nz: nz / len }
}

function sparMetrics(hull: ChaseHull, spar: Spar, point: Vec): Normal {
  const local = toLocal(hull, point)
  const abx = spar.x1 - spar.x0
  const aby = spar.y1 - spar.y0
  const abz = spar.z1 - spar.z0
  const len2 = abx * abx + aby * aby + abz * abz
  let t = 0
  if (len2 > 1e-8) {
    t = ((local.x - spar.x0) * abx + (local.y - spar.y0) * aby + (local.z - spar.z0) * abz) / len2
    t = Math.min(1, Math.max(0, t))
  }
  const cx = spar.x0 + abx * t
  const cy = spar.y0 + aby * t
  const cz = spar.z0 + abz * t
  let nx = local.x - cx
  let ny = local.y - cy
  let nz = local.z - cz
  const dist = Math.hypot(nx, ny, nz)
  if (dist < 1e-5) {
    nx = 1
    ny = 0
    nz = 0
  } else {
    nx /= dist
    ny /= dist
    nz /= dist
  }
  const world = localDir(hull.yaw, nx, ny, nz)
  return { gap: dist - spar.r, nx: world.x, ny: world.y, nz: world.z }
}

function prismGap(slice: HullSlice, x: number, y: number, z: number) {
  const hd = polyGap(slice.xz, x, z)
  if (!Number.isFinite(hd)) return Infinity
  const below = slice.y0 - y
  const above = y - slice.y1
  const yOut = below > 0 ? below : above > 0 ? above : 0
  if (hd < 0 && yOut === 0) {
    const yPen = Math.min(y - slice.y0, slice.y1 - y)
    return -Math.min(-hd, yPen)
  }
  if (hd < 0) return yOut
  if (yOut === 0) return hd
  return Math.hypot(hd, yOut)
}

function polyGap(xz: Float32Array, x: number, z: number) {
  const n = xz.length
  if (n < 6) return Infinity
  let inside = true
  let edge = Infinity
  for (let i = 0; i < n; i += 2) {
    const j = (i + 2) % n
    const ax = xz[i]
    const az = xz[i + 1]
    const bx = xz[j]
    const bz = xz[j + 1]
    if (edgeCross(ax, az, bx, bz, x, z) < -1e-6) inside = false
    const d = distPointSeg(x, z, ax, az, bx, bz)
    if (d < edge) edge = d
  }
  return inside ? -edge : edge
}

function edgeCross(ox: number, oz: number, ax: number, az: number, bx: number, bz: number) {
  return (ax - ox) * (bz - oz) - (az - oz) * (bx - ox)
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

function toLocal(hull: ChaseHull, point: Vec): Vec {
  const dx = point.x - hull.x
  const dz = point.z - hull.z
  const c = Math.cos(hull.yaw)
  const s = Math.sin(hull.yaw)
  return { x: dx * c - dz * s, y: point.y - hull.y, z: dx * s + dz * c }
}

function localDir(yaw: number, lx: number, ly: number, lz: number): Vec {
  const c = Math.cos(yaw)
  const s = Math.sin(yaw)
  return { x: lx * c + lz * s, y: ly, z: -lx * s + lz * c }
}

function sign(value: number) {
  return value < 0 ? -1 : 1
}

function dist2(a: Vec, b: Vec) {
  const dx = a.x - b.x
  const dy = a.y - b.y
  const dz = a.z - b.z
  return dx * dx + dy * dy + dz * dz
}

function copy(point: Vec): Vec {
  return { x: point.x, y: point.y, z: point.z }
}

/** Cardboard parcel. Origin is the bottom centre, matching the mesh. */
function crate(x: number, z: number, yaw: number, lx: number, lz: number, y0: number): CameraBox {
  return placeBox(x, z, yaw, lx, lz, y0, y0 + 0.96, 0.625, 0.575)
}

/** Three cars. `file` lines them up along the ship; otherwise they sit side by side. */
function cars(x: number, z: number, yaw: number, lx: number, lz: number, y0: number, file: boolean): CameraBox[] {
  const gap = file ? 5.05 : 2.35
  const boxes: CameraBox[] = []
  for (let i = 0; i < 3; i++) {
    const at = (i - 1) * gap
    // The body is centred 15 cm forward of the group's origin.
    const ox = lx + (file ? 0 : at)
    const oz = lz + (file ? at : 0) + 0.15
    boxes.push(placeBox(x, z, yaw, ox, oz, y0, y0 + 1.11, 0.86, 2.025))
  }
  return boxes
}

function placeBox(
  x: number,
  z: number,
  yaw: number,
  lx: number,
  lz: number,
  y0: number,
  y1: number,
  halfX: number,
  halfZ: number,
): CameraBox {
  const c = Math.cos(yaw)
  const s = Math.sin(yaw)
  return {
    x: x + lx * c + lz * s,
    z: z - lx * s + lz * c,
    y0,
    y1,
    cos: c,
    sin: s,
    halfX,
    halfZ,
  }
}
