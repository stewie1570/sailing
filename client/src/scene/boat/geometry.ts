import * as THREE from 'three'

/**
 * A 14 m cruising sloop, sized to the marina: beam about half a finger-pontoon
 * width, so it fits a slip with room to spare and still reads next to the dock.
 * Local space: +z bow, +x starboard, y = 0 at the waterline. No sails; the mast,
 * boom and standing rigging are there.
 *
 * One Lambert mesh with vertex colours. The hull is a loft, not a stack of boxes,
 * and the triangle count stays in the low thousands.
 */
export const BOAT = {
  /**
   * Collision box in local space. The stem rakes forward of the keel, so the
   * box is centred a little ahead of the origin and stays just inside the sheer.
   */
  halfLength: 7.3,
  halfBeam: 2.13,
  originZ: 0.53,
}

const STERN = -6.55
const BOW = 6.85

const TOPSIDE: RGB = [0.93, 0.94, 0.95]
const BOOT: RGB = [0.07, 0.1, 0.16]
const BOTTOM: RGB = [0.16, 0.38, 0.48]
const TEAK: RGB = [0.62, 0.48, 0.32]
const TEAK_DARK: RGB = [0.5, 0.38, 0.24]
const CABIN: RGB = [0.9, 0.91, 0.92]
const WINDOW: RGB = [0.12, 0.18, 0.24]
const METAL: RGB = [0.72, 0.74, 0.76]
const METAL_DARK: RGB = [0.42, 0.44, 0.47]
const KEEL: RGB = [0.14, 0.15, 0.17]
const WOOD: RGB = [0.34, 0.22, 0.14]

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

function tri(g: Geo, a: number, b: number, c: number) {
  g.idx.push(a, b, c)
}

function smoothstep(e0: number, e1: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}

/**
 * Flat cruising transom: a broad foot just under the waterline, then topsides
 * out to the sheer. v = 0 is the centreline, v = 1 is the sheer.
 */
function transomSection(v: number): THREE.Vector3 {
  const z = STERN - 0.06 - 0.2 * v
  const chine = 0.3
  if (v < chine) {
    return new THREE.Vector3((v / chine) * 1.02, -0.06, z)
  }
  const t = (v - chine) / (1 - chine)
  return new THREE.Vector3(
    1.02 + 0.66 * Math.pow(t, 0.8),
    -0.06 + 1.46 * Math.pow(t, 0.85),
    z,
  )
}

/** Starboard hull point. u = 0 at the transom, 1 at the stem. v = 0 at the centreline bottom, 1 at the sheer. */
function hullPoint(u: number, v: number): THREE.Vector3 {
  const zKeel = STERN + (BOW - STERN) * u
  const rake = 1.05 * smoothstep(0.58, 1, u) - 0.22 * (1 - smoothstep(0, 0.16, u))
  const z = zKeel + rake * v

  const stem = smoothstep(0.8, 1, u)
  const rocker = Math.sin(Math.PI * Math.pow(Math.min(u, 0.94), 0.7))
  const keelY = (-0.22 - 0.52 * rocker) * (1 - stem) + 0.42 * stem
  const sheerY = 0.96 + 0.8 * Math.pow(u, 1.6) + 0.4 * Math.pow(1 - u, 2.15)
  const y = keelY + (sheerY - keelY) * Math.pow(v, 0.9)

  const entry = Math.sin(Math.PI * Math.pow(u, 0.72))
  const sternBeam = 0.7 + 0.3 * smoothstep(0.08, 0.32, u)
  const bowFine = 1 - 0.7 * smoothstep(0.84, 1, u)
  let half = 2.18 * entry * sternBeam * bowFine
  half = Math.max(half, 1.45 * (1 - smoothstep(0.05, 0.26, u)) * (1 - stem))

  let xShape = Math.pow(Math.sin(v * Math.PI * 0.5), 0.42)
  if (v > 0.78) {
    const t = (v - 0.78) / 0.22
    xShape *= 1 - 0.07 * t * t
  }
  const body = new THREE.Vector3(half * xShape, y, z)
  // The aft stations become the transom, so the stern is a face rather than a canoe point.
  const sternBlend = 1 - smoothstep(0.02, 0.22, u)
  if (sternBlend <= 0) return body
  const tr = transomSection(v)
  return new THREE.Vector3(
    body.x * (1 - sternBlend) + tr.x * sternBlend,
    body.y * (1 - sternBlend) + tr.y * sternBlend,
    body.z * (1 - sternBlend) + tr.z * sternBlend,
  )
}

function hullColor(y: number): RGB {
  if (y < -0.04) return BOTTOM
  if (y < 0.09) return BOOT
  return TOPSIDE
}

function addHull(g: Geo) {
  const U = 36
  const V = 14
  const grid: number[][] = []
  for (let i = 0; i <= U; i++) {
    const row: number[] = []
    const u = i / U
    for (let j = 0; j <= V; j++) {
      const p = hullPoint(u, j / V)
      // The transom face is one panel; keep the boot stripe from painting the whole stern grey.
      const c = u < 0.03 && p.y > -0.02 ? TOPSIDE : hullColor(p.y)
      if (p.x < 0.015) row.push(vert(g, 0, p.y, p.z, c))
      else row.push(vert(g, p.x, p.y, p.z, c))
    }
    grid.push(row)
  }
  const port: number[][] = []
  for (let i = 0; i <= U; i++) {
    const row: number[] = []
    const u = i / U
    for (let j = 0; j <= V; j++) {
      const p = hullPoint(u, j / V)
      if (p.x < 0.015) row.push(grid[i][j])
      else row.push(vert(g, -p.x, p.y, p.z, hullColor(p.y)))
    }
    port.push(row)
  }
  for (let i = 0; i < U; i++) {
    for (let j = 0; j < V; j++) {
      // Outward: starboard +x, port −x. u runs aft to bow, v runs keel to sheer.
      quad(g, grid[i][j], grid[i][j + 1], grid[i + 1][j + 1], grid[i + 1][j])
      quad(g, port[i][j], port[i + 1][j], port[i + 1][j + 1], port[i][j + 1])
    }
  }
  // Transom panel between the port and starboard stern stations. Outward is −z.
  for (let j = 0; j < V; j++) {
    quad(g, port[0][j], port[0][j + 1], grid[0][j + 1], grid[0][j])
  }
}

function addDeck(g: Geo) {
  const U = 28
  for (let i = 0; i < U; i++) {
    const u0 = i / U
    const u1 = (i + 1) / U
    const a = hullPoint(u0, 1)
    const b = hullPoint(u1, 1)
    const crown = 0.045 * Math.sin(Math.PI * ((u0 + u1) / 2))
    const plank = ((i % 2) === 0 ? TEAK : TEAK_DARK)
    const c0 = vert(g, 0, a.y + crown, a.z, plank)
    const c1 = vert(g, 0, b.y + crown, b.z, plank)
    const s0 = vert(g, a.x * 0.96, a.y + 0.01, a.z, plank)
    const s1 = vert(g, b.x * 0.96, b.y + 0.01, b.z, plank)
    const p0 = vert(g, -a.x * 0.96, a.y + 0.01, a.z, plank)
    const p1 = vert(g, -b.x * 0.96, b.y + 0.01, b.z, plank)
    quad(g, c0, c1, s1, s0)
    quad(g, p0, p1, c1, c0)
  }
  // Toe rail, a low lip just outside the sheer.
  for (let i = 0; i < U; i++) {
    const u0 = i / U
    const u1 = (i + 1) / U
    for (const side of [1, -1]) {
      const a = hullPoint(u0, 1)
      const b = hullPoint(u1, 1)
      const o = 0.035
      const h = 0.07
      const a0 = vert(g, side * a.x, a.y, a.z, WOOD)
      const a1 = vert(g, side * (a.x + o), a.y + h, a.z, WOOD)
      const b0 = vert(g, side * b.x, b.y, b.z, WOOD)
      const b1 = vert(g, side * (b.x + o), b.y + h, b.z, WOOD)
      // Lip faces outboard.
      if (side > 0) quad(g, a0, a1, b1, b0)
      else quad(g, a0, b0, b1, a1)
    }
  }
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

/** Cylinder along +y, base at y=0, then moved. */
function addMast(g: Geo, x: number, y0: number, z: number, height: number, r0: number, r1: number, sides: number, color: RGB) {
  const ring = (y: number, r: number) => {
    const ids: number[] = []
    for (let i = 0; i < sides; i++) {
      const a = (i / sides) * Math.PI * 2
      ids.push(vert(g, x + Math.cos(a) * r, y0 + y, z + Math.sin(a) * r, color))
    }
    return ids
  }
  const bottom = ring(0, r0)
  const top = ring(height, r1)
  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides
    quad(g, bottom[i], top[i], top[j], bottom[j])
  }
  const tip = vert(g, x, y0 + height, z, color)
  for (let i = 0; i < sides; i++) tri(g, tip, top[i], top[(i + 1) % sides])
}

function addCylinderBetween(g: Geo, ax: number, ay: number, az: number, bx: number, by: number, bz: number, radius: number, color: RGB) {
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

function addCabin(g: Geo) {
  const deckY = hullPoint(0.62, 1).y
  const y0 = deckY + 0.02
  const y1 = deckY + 1.05
  const x = 1.22
  const zFront = 4.15
  const zBack = 0.55
  const slope = 3.35
  // Sides
  for (const s of [1, -1]) {
    const a = vert(g, s * x, y0, zBack, CABIN)
    const b = vert(g, s * x, y0, zFront, CABIN)
    const c = vert(g, s * x, y1, slope, CABIN)
    const d = vert(g, s * x, y1, zBack, CABIN)
    const e = vert(g, s * x * 0.72, y0 + 0.15, zFront + 0.05, CABIN)
    if (s > 0) {
      quad(g, a, d, c, b)
      tri(g, b, c, e)
    } else {
      quad(g, a, b, c, d)
      tri(g, b, e, c)
    }
  }
  // Roof
  const rf = [
    vert(g, -x, y1, zBack, CABIN), vert(g, x, y1, zBack, CABIN),
    vert(g, x, y1, slope, CABIN), vert(g, -x, y1, slope, CABIN),
  ]
  quad(g, rf[0], rf[3], rf[2], rf[1])
  // Windshield slope
  const ws = [
    vert(g, -x, y1, slope, CABIN), vert(g, x, y1, slope, CABIN),
    vert(g, x * 0.72, y0 + 0.15, zFront + 0.05, CABIN), vert(g, -x * 0.72, y0 + 0.15, zFront + 0.05, CABIN),
  ]
  // Faces forward and up, toward anyone standing on the foredeck.
  quad(g, ws[0], ws[1], ws[2], ws[3])
  // Aft face, with a companionway cut suggested by a darker door
  const af = [
    vert(g, -x, y0, zBack, CABIN), vert(g, x, y0, zBack, CABIN),
    vert(g, x, y1, zBack, CABIN), vert(g, -x, y1, zBack, CABIN),
  ]
  quad(g, af[1], af[0], af[3], af[2])
  addBox(g, 0, y0 + 0.42, zBack + 0.02, 0.62, 0.78, 0.06, WOOD)

  // Side windows and the dark windshield band.
  for (const s of [1, -1]) {
    for (let k = 0; k < 3; k++) {
      const zc = zBack + 0.7 + k * 0.85
      addBox(g, s * (x + 0.012), y0 + 0.62, zc, 0.03, 0.32, 0.55, WINDOW)
    }
  }
  addBox(g, 0, y0 + 0.72, slope + 0.28, 1.7, 0.08, 0.5, WINDOW)
}

function addCockpit(g: Geo) {
  const deckY = hullPoint(0.38, 1).y
  const y0 = deckY - 0.42
  const y1 = deckY + 0.28
  const x = 1.05
  const z0 = -3.15
  const z1 = 0.15
  // Floor and four walls.
  addBox(g, 0, y0 + 0.04, (z0 + z1) / 2, x * 2 - 0.08, 0.08, z1 - z0 - 0.08, TEAK_DARK)
  addBox(g, 0, (y0 + y1) / 2, z1, x * 2, y1 - y0, 0.08, WOOD)
  addBox(g, 0, (y0 + y1) / 2, z0, x * 2, y1 - y0, 0.08, WOOD)
  addBox(g, x, (y0 + y1) / 2, (z0 + z1) / 2, 0.08, y1 - y0, z1 - z0, WOOD)
  addBox(g, -x, (y0 + y1) / 2, (z0 + z1) / 2, 0.08, y1 - y0, z1 - z0, WOOD)
  // Benches
  addBox(g, 0.62, y0 + 0.28, (z0 + z1) / 2, 0.55, 0.22, z1 - z0 - 0.5, TEAK)
  addBox(g, -0.62, y0 + 0.28, (z0 + z1) / 2, 0.55, 0.22, z1 - z0 - 0.5, TEAK)
  // Wheel pedestal and a simple wheel
  addBox(g, 0, y0 + 0.55, z0 + 0.85, 0.16, 0.7, 0.16, METAL_DARK)
  const wheelZ = z0 + 0.85
  const wheelY = y0 + 0.95
  const hub = vert(g, 0, wheelY, wheelZ + 0.12, METAL)
  const n = 10
  const prev: number[] = []
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2
    prev.push(vert(g, Math.cos(a) * 0.32, wheelY + Math.sin(a) * 0.32, wheelZ + 0.12, METAL))
  }
  // Face aft, toward the helm. A second disk just behind it so the rim reads from the bow too.
  const hubAft = vert(g, 0, wheelY, wheelZ + 0.08, METAL)
  const aft: number[] = []
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2
    aft.push(vert(g, Math.cos(a) * 0.32, wheelY + Math.sin(a) * 0.32, wheelZ + 0.08, METAL))
  }
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    tri(g, hub, prev[j], prev[i])
    tri(g, hubAft, aft[i], aft[j])
  }
}

function addKeelAndRudder(g: Geo) {
  // Fin keel with a small bulb, under the midship section.
  const top = -0.62
  const fin = [
    vert(g, -0.07, top, 1.15, KEEL), vert(g, 0.07, top, 1.15, KEEL),
    vert(g, 0.07, top, -1.35, KEEL), vert(g, -0.07, top, -1.35, KEEL),
    vert(g, -0.05, -1.85, 0.55, KEEL), vert(g, 0.05, -1.85, 0.55, KEEL),
    vert(g, 0.05, -1.85, -0.85, KEEL), vert(g, -0.05, -1.85, -0.85, KEEL),
  ]
  quad(g, fin[0], fin[1], fin[5], fin[4])
  quad(g, fin[3], fin[7], fin[6], fin[2])
  quad(g, fin[1], fin[2], fin[6], fin[5])
  quad(g, fin[3], fin[0], fin[4], fin[7])
  quad(g, fin[4], fin[5], fin[6], fin[7])
  addBox(g, 0, -2.02, -0.15, 0.42, 0.28, 1.7, KEEL)
  // Rudder, hung under the stern.
  const r = [
    vert(g, -0.035, -0.15, -5.15, KEEL), vert(g, 0.035, -0.15, -5.15, KEEL),
    vert(g, 0.035, -0.15, -6.15, KEEL), vert(g, -0.035, -0.15, -6.15, KEEL),
    vert(g, -0.025, -1.35, -5.35, KEEL), vert(g, 0.025, -1.35, -5.35, KEEL),
    vert(g, 0.025, -1.35, -6.25, KEEL), vert(g, -0.025, -1.35, -6.25, KEEL),
  ]
  quad(g, r[0], r[1], r[5], r[4])
  quad(g, r[3], r[7], r[6], r[2])
  quad(g, r[1], r[2], r[6], r[5])
  quad(g, r[3], r[0], r[4], r[7])
  quad(g, r[4], r[5], r[6], r[7])
}

function addRig(g: Geo) {
  const deckY = hullPoint(0.7, 1).y
  const mastZ = 2.15
  const mastH = 16.4
  addMast(g, 0, deckY, mastZ, mastH, 0.13, 0.055, 8, METAL)
  // Spreaders
  for (const [t, reach] of [[0.38, 1.15], [0.62, 0.72]] as const) {
    const y = deckY + mastH * t
    addBox(g, 0, y, mastZ, reach * 2, 0.04, 0.06, METAL_DARK)
  }
  // Boom, parked on the centreline. No sail.
  const boomY = deckY + 1.45
  addCylinderBetween(g, 0, boomY, mastZ, 0, boomY, mastZ - 5.6, 0.055, METAL)
  addBox(g, 0, boomY, mastZ, 0.12, 0.1, 0.18, METAL_DARK)
  // Standing rigging.
  const tipY = deckY + mastH
  const bow = hullPoint(0.98, 1)
  const stern = hullPoint(0.04, 1)
  addCylinderBetween(g, 0, tipY - 0.05, mastZ, 0, bow.y + 0.15, bow.z - 0.15, 0.018, METAL_DARK)
  addCylinderBetween(g, 0, tipY - 0.05, mastZ, 0, stern.y + 0.2, stern.z + 0.2, 0.018, METAL_DARK)
  // Cap shrouds to the chainplates, plus one lower.
  for (const s of [1, -1]) {
    const chain = hullPoint(0.68, 1)
    addCylinderBetween(g, 0, tipY - 0.3, mastZ, s * (chain.x - 0.05), chain.y + 0.05, chain.z, 0.016, METAL_DARK)
    const low = hullPoint(0.6, 1)
    addCylinderBetween(g, 0, deckY + mastH * 0.38, mastZ, s * (low.x - 0.05), low.y + 0.05, low.z + 0.4, 0.014, METAL_DARK)
  }
}

function addRails(g: Geo) {
  const stations = [0.06, 0.16, 0.28, 0.4, 0.52, 0.64, 0.76, 0.88]
  for (const s of [1, -1]) {
    const posts: THREE.Vector3[] = []
    for (const u of stations) {
      const p = hullPoint(u, 1)
      const x = s * (p.x - 0.02)
      addCylinderBetween(g, x, p.y, p.z, x, p.y + 0.62, p.z, 0.02, METAL)
      posts.push(new THREE.Vector3(x, p.y + 0.62, p.z))
    }
    for (let i = 0; i < posts.length - 1; i++) {
      const a = posts[i]
      const b = posts[i + 1]
      addCylinderBetween(g, a.x, a.y, a.z, b.x, b.y, b.z, 0.012, METAL_DARK)
    }
  }
  // Pulpit
  const bow = hullPoint(0.97, 1)
  for (const s of [1, -1]) {
    const x = s * 0.28
    addCylinderBetween(g, x, bow.y, bow.z - 0.35, x, bow.y + 0.7, bow.z - 0.15, 0.02, METAL)
    addCylinderBetween(g, x, bow.y + 0.7, bow.z - 0.15, 0, bow.y + 0.72, bow.z + 0.15, 0.018, METAL)
  }
  // Pushpit
  const stern = hullPoint(0.03, 1)
  for (const s of [1, -1]) {
    const x = s * 0.7
    addCylinderBetween(g, x, stern.y, stern.z, x, stern.y + 0.65, stern.z, 0.02, METAL)
  }
  addCylinderBetween(g, -0.7, stern.y + 0.65, stern.z, 0.7, stern.y + 0.65, stern.z, 0.016, METAL)
}

function toMesh(g: Geo) {
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(g.pos, 3))
  geo.setAttribute('color', new THREE.Float32BufferAttribute(g.col, 3))
  geo.setIndex(g.idx)
  geo.computeVertexNormals()
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }))
  mesh.frustumCulled = false
  mesh.name = 'sailboat'
  return mesh
}

export function buildSailboat(): THREE.Mesh {
  const g: Geo = { pos: [], col: [], idx: [] }
  addHull(g)
  addDeck(g)
  addCabin(g)
  addCockpit(g)
  addKeelAndRudder(g)
  addRig(g)
  addRails(g)
  return toMesh(g)
}
