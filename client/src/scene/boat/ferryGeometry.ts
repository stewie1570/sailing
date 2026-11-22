import * as THREE from 'three'
import type { BoatShape, HullSlice } from './geometry'
import { FERRY_BEAM, FERRY_LOA } from './vessel'
import { POD_Z } from './ferryDynamics'

export { POD_Z }

/**
 * A double-ended vehicle ferry. Blue hull, white wheelhouse offset to port
 * so a vehicle lane runs to starboard, ramps at both ends, one azimuth pod
 * under each end. Local space matches the sloop: +z bow, +x port, y = 0 at
 * the waterline. The hull is one Lambert mesh. Each pod is its own mesh so
 * the dial can yaw it and the screw can spin.
 *
 * The collision outline is a handful of boxes. A ferry this shape does not
 * need the sloop's dense loft, and a remote helm only tests this outline
 * against the pose it was sent.
 */

const HALF = FERRY_LOA / 2 - 1.4
const BEAM = FERRY_BEAM / 2 - 0.15
const DECK = 2.12

/** Parcel on the open lane, clear of the wheelhouse. */
export const FERRY_CARGO = { x: -2.4, y: DECK + 0.02, z: -2 }

const BLUE: RGB = [0.22, 0.55, 0.78]
const BLUE_DARK: RGB = [0.13, 0.38, 0.58]
const WHITE: RGB = [0.93, 0.94, 0.95]
const DECK_GREY: RGB = [0.55, 0.57, 0.6]
const WINDOW: RGB = [0.1, 0.16, 0.22]
const RAIL: RGB = [0.86, 0.88, 0.9]
const RED: RGB = [0.78, 0.16, 0.13]
const YELLOW: RGB = [0.9, 0.74, 0.16]
const METAL: RGB = [0.28, 0.3, 0.33]
const METAL_DARK: RGB = [0.16, 0.17, 0.19]

type RGB = readonly [number, number, number]

interface Geo {
  pos: number[]
  col: number[]
  idx: number[]
}

function vert(g: Geo, x: number, y: number, z: number, color: RGB) {
  const i = g.pos.length / 3
  g.pos.push(x, y, z)
  g.col.push(color[0], color[1], color[2])
  return i
}

function quad(g: Geo, a: number, b: number, c: number, d: number) {
  g.idx.push(a, b, c, a, c, d)
}

function smoothstep(e0: number, e1: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}

function addBox(g: Geo, cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, color: RGB) {
  const x0 = cx - sx / 2, x1 = cx + sx / 2
  const y0 = cy - sy / 2, y1 = cy + sy / 2
  const z0 = cz - sz / 2, z1 = cz + sz / 2
  const v = (x: number, y: number, z: number) => vert(g, x, y, z, color)
  const p = [
    v(x0, y0, z0), v(x1, y0, z0), v(x1, y1, z0), v(x0, y1, z0),
    v(x0, y0, z1), v(x1, y0, z1), v(x1, y1, z1), v(x0, y1, z1),
  ]
  quad(g, p[4], p[5], p[6], p[7])
  quad(g, p[1], p[0], p[3], p[2])
  quad(g, p[5], p[1], p[2], p[6])
  quad(g, p[0], p[4], p[7], p[3])
  quad(g, p[7], p[6], p[2], p[3])
  quad(g, p[0], p[1], p[5], p[4])
}

function addCylinderBetween(
  g: Geo,
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  radius: number,
  color: RGB,
) {
  const dx = bx - ax, dy = by - ay, dz = bz - az
  const len = Math.hypot(dx, dy, dz) || 1
  const dir = new THREE.Vector3(dx / len, dy / len, dz / len)
  const up = Math.abs(dir.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0)
  const side = new THREE.Vector3().crossVectors(dir, up).normalize()
  const bin = new THREE.Vector3().crossVectors(dir, side).normalize()
  const sides = 6
  const ring = (ox: number, oy: number, oz: number) => {
    const ids: number[] = []
    for (let i = 0; i < sides; i++) {
      const a = (i / sides) * Math.PI * 2
      const c = Math.cos(a) * radius
      const s = Math.sin(a) * radius
      ids.push(vert(g, ox + side.x * c + bin.x * s, oy + side.y * c + bin.y * s, oz + side.z * c + bin.z * s, color))
    }
    return ids
  }
  const a = ring(ax, ay, az)
  const b = ring(bx, by, bz)
  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides
    quad(g, a[i], b[i], b[j], a[j])
  }
}

/** u = 0 at the stern, 1 at the bow. v = 0 at the keel, 1 at the deck edge. */
function hullPoint(u: number, v: number) {
  const z = -HALF + u * 2 * HALF
  const zAbs = Math.abs(z)
  const taper = 1 - 0.34 * smoothstep(13.5, HALF, zAbs)
  const bottom = -1.48 + 1.05 * smoothstep(14, HALF, zAbs)
  const sheer = DECK + 0.28 * smoothstep(16, HALF, zAbs)
  const y = bottom + (sheer - bottom) * Math.pow(v, 0.72)
  const shape = Math.pow(Math.sin(v * Math.PI * 0.5), 0.48)
  return { x: BEAM * taper * shape, y, z }
}

function hullColor(y: number): RGB {
  if (y < 0.08) return BLUE_DARK
  if (y < 1.15) return BLUE
  return WHITE
}

function addHull(g: Geo) {
  const U = 16
  const V = 6
  const grid: number[][] = []
  for (let i = 0; i <= U; i++) {
    const row: number[] = []
    const u = i / U
    for (let j = 0; j <= V; j++) {
      const p = hullPoint(u, j / V)
      row.push(vert(g, p.x, p.y, p.z, hullColor(p.y)))
    }
    grid.push(row)
  }
  const port: number[][] = []
  for (let i = 0; i <= U; i++) {
    const row: number[] = []
    const u = i / U
    for (let j = 0; j <= V; j++) {
      const p = hullPoint(u, j / V)
      row.push(vert(g, -p.x, p.y, p.z, hullColor(p.y)))
    }
    port.push(row)
  }
  for (let i = 0; i < U; i++) {
    for (let j = 0; j < V; j++) {
      // +x is port, so that side faces +x. The mirror faces −x.
      quad(g, grid[i][j], grid[i][j + 1], grid[i + 1][j + 1], grid[i + 1][j])
      quad(g, port[i][j], port[i + 1][j], port[i + 1][j + 1], port[i][j + 1])
    }
  }
  // Stern face (−z) and bow face (+z).
  for (let j = 0; j < V; j++) {
    quad(g, port[0][j], port[0][j + 1], grid[0][j + 1], grid[0][j])
    quad(g, grid[U][j], grid[U][j + 1], port[U][j + 1], port[U][j])
  }
}

function addDeck(g: Geo) {
  const U = 16
  for (let i = 0; i < U; i++) {
    const a = hullPoint(i / U, 1)
    const b = hullPoint((i + 1) / U, 1)
    const y = Math.max(a.y, b.y) + 0.02
    const c0 = vert(g, 0, y, a.z, DECK_GREY)
    const c1 = vert(g, 0, y, b.z, DECK_GREY)
    const s0 = vert(g, a.x, y, a.z, DECK_GREY)
    const s1 = vert(g, b.x, y, b.z, DECK_GREY)
    const p0 = vert(g, -a.x, y, a.z, DECK_GREY)
    const p1 = vert(g, -b.x, y, b.z, DECK_GREY)
    // Front faces point up. The other order is culled, so the water shows through the hull.
    quad(g, c0, c1, s1, s0)
    quad(g, p0, p1, c1, c0)
  }
}

function addRamps(g: Geo) {
  for (const end of [1, -1]) {
    const z0 = end * (HALF - 1.6)
    const z1 = end * (HALF + 1.55)
    const y = DECK + 0.08
    const lip = y - 0.35
    const x = 5.15
    const a = vert(g, -x, y, z0, BLUE)
    const b = vert(g, x, y, z0, BLUE)
    const c = vert(g, x * 0.92, lip, z1, BLUE)
    const d = vert(g, -x * 0.92, lip, z1, BLUE)
    if (end > 0) quad(g, a, d, c, b)
    else quad(g, a, b, c, d)
    // Wing gates, the blue cheeks beside each ramp.
    for (const side of [1, -1]) {
      const x0 = side * 4.7
      const x1 = side * 5.45
      const g0 = vert(g, x0, y, z0, BLUE_DARK)
      const g1 = vert(g, x1, y + 1.35, z0 + end * 0.4, BLUE_DARK)
      const g2 = vert(g, x1, lip + 0.9, z1, BLUE_DARK)
      const g3 = vert(g, x0, lip, z1, BLUE_DARK)
      if (side > 0) quad(g, g0, g1, g2, g3)
      else quad(g, g0, g3, g2, g1)
    }
  }
}

function addHouse(g: Geo) {
  const x0 = 0.15
  const x1 = 5.15
  const z0 = -6.2
  const z1 = 7.4
  const y0 = DECK + 0.04
  const y1 = DECK + 3.15
  addBox(g, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, x1 - x0, y1 - y0, z1 - z0, WHITE)
  // Blue fascia under the roof, and the roof itself.
  addBox(g, (x0 + x1) / 2, y1 - 0.16, (z0 + z1) / 2, x1 - x0 + 0.28, 0.22, z1 - z0 + 0.45, BLUE)
  addBox(g, (x0 + x1) / 2, y1 + 0.08, (z0 + z1) / 2, x1 - x0 + 0.5, 0.12, z1 - z0 + 0.7, WHITE)
  // Window band on the port side, the forward face, and the lane side.
  for (let i = 0; i < 4; i++) {
    const z = z0 + 1.5 + i * 2.7
    addBox(g, x1 + 0.04, y0 + 1.7, z, 0.06, 0.72, 1.7, WINDOW)
  }
  addBox(g, (x0 + x1) / 2, y0 + 1.7, z1 + 0.04, 3.3, 0.7, 0.06, WINDOW)
  addBox(g, x0 - 0.04, y0 + 1.55, 1.2, 0.06, 0.85, 2.4, WINDOW)
  // Life ring on the forward face of the house.
  addCylinderBetween(g, 3.6, y0 + 1.15, z1 + 0.08, 3.6, y0 + 1.15, z1 + 0.2, 0.38, RED)
  addCylinderBetween(g, 3.6, y0 + 1.15, z1 + 0.12, 3.6, y0 + 1.15, z1 + 0.22, 0.2, WHITE)
  // Short mast and a pair of aerials.
  addCylinderBetween(g, 2.6, y1 + 0.1, 0.4, 2.6, y1 + 3.4, 0.4, 0.08, METAL)
  addCylinderBetween(g, 2.2, y1 + 0.15, -2.2, 2.2, y1 + 2.1, -2.2, 0.035, METAL_DARK)
  addCylinderBetween(g, 3.4, y1 + 0.15, 3.1, 3.4, y1 + 1.7, 3.1, 0.03, METAL_DARK)
}

function addRails(g: Geo) {
  const posts = [-15, -11, -7, -3, 1, 5, 9, 13]
  for (const side of [1, -1]) {
    const pts: { x: number; y: number; z: number }[] = []
    for (const z of posts) {
      const u = (z + HALF) / (2 * HALF)
      const p = hullPoint(Math.min(0.98, Math.max(0.02, u)), 1)
      const x = side * (p.x - 0.12)
      const y0 = p.y + 0.02
      const y1 = y0 + 1.05
      addCylinderBetween(g, x, y0, z, x, y1, z, 0.045, RAIL)
      pts.push({ x, y: y1, z })
    }
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i]
      const b = pts[i + 1]
      addCylinderBetween(g, a.x, a.y, a.z, b.x, b.y, b.z, 0.028, RAIL)
    }
  }
  // A few rings along the starboard lane, where the photo shows them.
  for (const z of [-8, 0, 8]) {
    addCylinderBetween(g, -5.35, DECK + 1.15, z, -5.35, DECK + 1.15, z + 0.08, 0.28, RED)
  }
}

function addFender(g: Geo) {
  // The yellow quarter fender in the reference, hung at the starboard stern.
  addCylinderBetween(g, -4.6, 0.7, -HALF + 1.3, -4.6, 1.7, -HALF + 0.7, 0.42, YELLOW)
}

function addStruts(g: Geo) {
  for (const z of [POD_Z, -POD_Z]) {
    addCylinderBetween(g, 0, -0.55, z, 0, -1.15, z, 0.16, METAL_DARK)
  }
}

function toMesh(g: Geo, name: string) {
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(g.pos, 3))
  geo.setAttribute('color', new THREE.Float32BufferAttribute(g.col, 3))
  geo.setIndex(g.idx)
  geo.computeVertexNormals()
  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshLambertMaterial({ vertexColors: true }),
  )
  mesh.frustumCulled = false
  mesh.name = name
  return mesh
}

export function buildFerry(): THREE.Mesh {
  const g: Geo = { pos: [], col: [], idx: [] }
  addHull(g)
  addDeck(g)
  addRamps(g)
  addHouse(g)
  addRails(g)
  addFender(g)
  addStruts(g)
  return toMesh(g, 'ferry')
}

/** Nacelle along +z, so a yaw of azimuth + π aims the screw opposite the push. */
export function buildPod(): THREE.Mesh {
  const g: Geo = { pos: [], col: [], idx: [] }
  addCylinderBetween(g, 0, 0, -1.15, 0, 0, 0.85, 0.42, METAL)
  addCylinderBetween(g, 0, 0, 0.72, 0, 0, 1.15, 0.5, METAL_DARK)
  addBox(g, 0, 0.28, -0.1, 0.16, 0.35, 1.1, BLUE_DARK)
  return toMesh(g, 'pod')
}

/** Four-blade screw in the XY plane, at the origin. Positive spin is ahead thrust. */
export function buildPodScrew(): THREE.Mesh {
  const g: Geo = { pos: [], col: [], idx: [] }
  addCylinderBetween(g, 0, 0, -0.08, 0, 0, 0.1, 0.08, METAL_DARK)
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2
    addCylinderBetween(g, 0, 0, 0.02, Math.cos(a) * 0.62, Math.sin(a) * 0.62, 0.08, 0.045, METAL)
  }
  return toMesh(g, 'pod-screw')
}

/** Where the pod group sits, in ferry-local metres. The screw is at the group's origin. */
export const POD_Y = -1.32

function rect(halfX: number, halfZ: number): Float32Array {
  return new Float32Array([
    -halfX, -halfZ,
    halfX, -halfZ,
    halfX, halfZ,
    -halfX, halfZ,
  ])
}

let cached: BoatShape | null = null

/**
 * Four bands: the bottom (including the pods, which sit inside the footprint),
 * the topsides, the rail, and the wheelhouse. Remote helms test this static
 * outline. They do not integrate the pods.
 */
export function ferryShape(): BoatShape {
  if (cached) return cached
  const slices: HullSlice[] = [
    { y0: -1.7, y1: 0.15, xz: rect(5.3, 19.5) },
    { y0: 0.15, y1: DECK, xz: rect(BEAM, HALF) },
    { y0: DECK, y1: DECK + 1.15, xz: rect(BEAM + 0.1, HALF + 0.4) },
    { y0: DECK + 1.15, y1: DECK + 3.4, xz: new Float32Array([0.1, -6.4, 5.3, -6.4, 5.3, 7.6, 0.1, 7.6]) },
  ]
  const skin: number[] = []
  const push = (x: number, y: number, z: number) => { skin.push(x, y, z) }
  for (const z of [-18, -10, 0, 10, 18]) {
    for (const x of [-4.5, 0, 4.5]) push(x, -1.48, z)
  }
  push(0, -1.7, POD_Z)
  push(0, -1.7, -POD_Z)
  for (const z of [-HALF, 0, HALF]) {
    push(BEAM, DECK, z)
    push(-BEAM, DECK, z)
    push(BEAM, 0.4, z)
    push(-BEAM, 0.4, z)
  }
  push(5.2, DECK + 3.2, 0)
  push(0.2, DECK + 3.2, -6)
  push(0.2, DECK + 3.2, 7)
  let radius = 0
  for (let i = 0; i < skin.length; i += 3) radius = Math.max(radius, Math.hypot(skin[i], skin[i + 2]))
  radius = Math.max(radius, Math.hypot(BEAM + 0.2, HALF + 1.6))
  cached = {
    slices,
    skin: new Float32Array(skin),
    skinMinY: -1.7,
    radius,
    spars: [],
  }
  return cached
}
