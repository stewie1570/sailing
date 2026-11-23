// Opens the water in front of the ferry linkspans just enough for the hull.
// The keel reaches 1.7 m under the water, so a shoal stops the boat the same
// way dry land does. The cut stops at that depth. Sail docks and moles stay.

import sharp from 'sharp'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const MPP = 7.766666666666667
const HEIGHT_MIN = -64
const HEIGHT_MAX = 400
/** Dredged bottom. Just under the keel, with a little room for the swell. */
const FLOOR = -2.4
/** The coarse shore mesh under the hull has to stay below this. */
const CLEAR = -2.0
const PITCH = 26

const TERMINALS = [
  { id: 'west', x: 77, y: 227, ax: 0.9554, ay: 0.2953, bx: -0.2953, by: 0.9554, count: 7, seed: [110, 242] },
  { id: 'east', x: 905, y: 529, ax: -0.9973, ay: 0.0739, bx: 0.0739, by: 0.9973, count: 15, seed: [876, 534] },
]

const LIPS = [
  { id: 'west', from: -80, to: -22, extra: 10 },
  { id: 'east', from: 132, to: 156, extra: 10 },
]

/** Sail walkways and the breakwaters. The cut goes around these. */
const KEEP = [
  { x0: 92, y0: 207, x1: 136, y1: 207, thick: 34 },
  { x0: 132, y0: 207, x1: 134, y1: 224, thick: 30 },
  { x0: 98, y0: 274, x1: 124, y1: 278, thick: 30 },
  { x0: 124, y0: 278, x1: 150, y1: 266, thick: 28 },
  { x0: 816, y0: 498, x1: 828, y1: 516, thick: 32 },
  { x0: 848, y0: 500, x1: 902, y1: 498, thick: 26 },
  // The east shore mole is the beach the ferry quay sits on. That beach is cut
  // back with the berths, so it is not kept out of the dredge.
  { x0: 844, y0: 568, x1: 904, y1: 566, thick: 30 },
  { x0: 92, y0: 227, x1: 116, y1: 227, thick: 14 },
  { x0: 92, y0: 253, x1: 112, y1: 255, thick: 14 },
  { x0: 860, y0: 523, x1: 894, y1: 523, thick: 14 },
  { x0: 860, y0: 547, x1: 894, y1: 547, thick: 14 },
]

function lipOf(id, along) {
  let extra = 0
  for (const lip of LIPS) {
    if (lip.id === id && along >= lip.from - 8 && along <= lip.to + 8) extra = Math.max(extra, lip.extra)
  }
  return extra
}

function frameOf(t, px, py) {
  const dx = px - t.x
  const dy = py - t.y
  return {
    along: (dx * t.bx + dy * t.by) * MPP,
    across: (dx * t.ax + dy * t.ay) * MPP,
  }
}

function pixelOf(t, along, across) {
  return {
    x: t.x + t.bx * (along / MPP) + t.ax * (across / MPP),
    y: t.y + t.by * (along / MPP) + t.ay * (across / MPP),
  }
}

function distToSeg(px, py, seg) {
  const vx = seg.x1 - seg.x0
  const vy = seg.y1 - seg.y0
  const len2 = vx * vx + vy * vy || 1
  const u = Math.min(1, Math.max(0, ((px - seg.x0) * vx + (py - seg.y0) * vy) / len2))
  const x = seg.x0 + vx * u
  const y = seg.y0 + vy * u
  return Math.hypot(px - x, py - y) * MPP
}

function keepOut(px, py) {
  for (const seg of KEEP) {
    if (distToSeg(px, py, seg) < seg.thick / 2 + 3) return true
  }
  return false
}

function decodeHeight(rgb, i) {
  const v = (rgb[i * 3] << 8) | rgb[i * 3 + 1]
  return HEIGHT_MIN + (v / 65535) * (HEIGHT_MAX - HEIGHT_MIN)
}

function encodeHeight(metres) {
  const t = Math.min(1, Math.max(0, (metres - HEIGHT_MIN) / (HEIGHT_MAX - HEIGHT_MIN)))
  return Math.round(t * 65535)
}

function buildMesh(heightAt, segX, segZ, worldW, worldD) {
  const nx = segX + 1
  const h = new Float32Array(nx * (segZ + 1))
  for (let j = 0; j <= segZ; j++) {
    const z = (j / segZ - 0.5) * worldD
    for (let i = 0; i <= segX; i++) {
      const x = (i / segX - 0.5) * worldW
      h[j * nx + i] = heightAt(x, z)
    }
  }
  return { segX, segZ, nx, h, worldW, worldD }
}

function meshHeight(mesh, x, z) {
  const fx = Math.min(mesh.segX, Math.max(0, (x / mesh.worldW + 0.5) * mesh.segX))
  const fz = Math.min(mesh.segZ, Math.max(0, (z / mesh.worldD + 0.5) * mesh.segZ))
  let i = Math.floor(fx)
  let j = Math.floor(fz)
  if (i >= mesh.segX) i = mesh.segX - 1
  if (j >= mesh.segZ) j = mesh.segZ - 1
  const tx = fx - i
  const tz = fz - j
  const a = mesh.h[j * mesh.nx + i]
  const d = mesh.h[j * mesh.nx + i + 1]
  const b = mesh.h[(j + 1) * mesh.nx + i]
  const c = mesh.h[(j + 1) * mesh.nx + i + 1]
  if (tx + tz <= 1) return a * (1 - tx - tz) + b * tz + d * tx
  return b * (1 - tx) + c * (tx + tz - 1) + d * (1 - tz)
}

function worldOf(px, py, W, H) {
  return { x: (px - W / 2) * MPP, z: (py - H / 2) * MPP }
}

/**
 * Pixels to take down to the floor. Each slip gets its berth, then a lane
 * straight out until the water is already deep and joins the basin.
 */
function cutMask(W, H, height, mesh) {
  const mask = new Uint8Array(W * H)
  const open = floodOpen(W, H, height)
  const mark = (t, along0, along1, across0, across1) => {
    const samples = [
      pixelOf(t, along0, across0), pixelOf(t, along0, across1),
      pixelOf(t, along1, across0), pixelOf(t, along1, across1),
    ]
    let x0 = W, y0 = H, x1 = 0, y1 = 0
    for (const p of samples) {
      x0 = Math.min(x0, Math.floor(p.x) - 1)
      y0 = Math.min(y0, Math.floor(p.y) - 1)
      x1 = Math.max(x1, Math.ceil(p.x) + 1)
      y1 = Math.max(y1, Math.ceil(p.y) + 1)
    }
    for (let y = Math.max(0, y0); y <= Math.min(H - 1, y1); y++) {
      for (let x = Math.max(0, x0); x <= Math.min(W - 1, x1); x++) {
        if (keepOut(x + 0.5, y + 0.5)) continue
        const f = frameOf(t, x + 0.5, y + 0.5)
        if (f.along < along0 || f.along > along1 || f.across < across0 || f.across > across1) continue
        mask[y * W + x] = 1
      }
    }
  }
  const stripClear = (t, along0, along1, across) => {
    for (let along = along0 + 2; along <= along1 - 2; along += 4) {
      const p = pixelOf(t, along, across)
      const w = worldOf(p.x, p.y, W, H)
      if (meshHeight(mesh, w.x, w.z) > CLEAR) return false
    }
    return true
  }
  const stripOpen = (t, along0, along1, across) => {
    for (let along = along0; along <= along1; along += 6) {
      const p = pixelOf(t, along, across)
      const x = Math.min(W - 1, Math.max(0, Math.round(p.x)))
      const y = Math.min(H - 1, Math.max(0, Math.round(p.y)))
      if (open[y * W + x]) return true
    }
    return false
  }

  for (const t of TERMINALS) {
    for (let i = 0; i < t.count; i++) {
      const metres = (i - (t.count - 1) / 2) * PITCH
      const reach = 32 + lipOf(t.id, metres)
      const along0 = metres - 8
      const along1 = metres + 8
      // The bow sits a few metres off the quay face. The stern is the outer end.
      const bow = Math.max(6, reach - 22)
      const stern = reach + 24
      mark(t, along0, along1, bow, stern)
      let run = 0
      for (let across = stern; across < stern + 180; across += 4) {
        mark(t, along0, along1, across, across + 4)
        if (stripClear(t, along0, along1, across) && stripOpen(t, along0, along1, across)) run += 4
        else run = 0
        if (run >= 24) break
      }
    }
  }
  return mask
}

function floodOpen(W, H, height) {
  const open = new Uint8Array(W * H)
  const stack = []
  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return
    const i = y * W + x
    if (open[i] || height[i] > CLEAR) return
    open[i] = 1
    stack.push(i)
  }
  for (const t of TERMINALS) push(t.seed[0], t.seed[1])
  while (stack.length) {
    const i = stack.pop()
    const x = i % W
    const y = (i - x) / W
    push(x + 1, y)
    push(x - 1, y)
    push(x, y + 1)
    push(x, y - 1)
  }
  return open
}

/** One coarse cell past the cut, so a bank vertex cannot lift the mesh under the hull. Not inland of the quay. */
function dilate(W, H, mask, radius) {
  if (radius <= 0) return mask
  const next = new Uint8Array(mask)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (mask[y * W + x] || keepOut(x + 0.5, y + 0.5)) continue
      let near = false
      for (let dy = -radius; dy <= radius && !near; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (dx * dx + dy * dy > radius * radius) continue
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
          if (mask[ny * W + nx]) { near = true; break }
        }
      }
      if (!near) continue
      // Stay on the water side of every quay. The town behind the dock stays.
      let waterSide = false
      for (const t of TERMINALS) {
        const f = frameOf(t, x + 0.5, y + 0.5)
        const span = ((t.count - 1) / 2) * PITCH + 30
        if (Math.abs(f.along) < span && f.across > -2 && f.across < 220) waterSide = true
      }
      if (waterSide) next[y * W + x] = 1
    }
  }
  return next
}

function lakebed(h, x, y) {
  const wet = [142, 132, 98]
  const mud = [70, 76, 56]
  const t = Math.min(1, Math.max(0, -h) / 14)
  const grain = ((((x * 17) ^ (y * 43)) & 255) / 255 - 0.5) * 16
  return [
    wet[0] + (mud[0] - wet[0]) * t + grain,
    wet[1] + (mud[1] - wet[1]) * t + grain,
    wet[2] + (mud[2] - wet[2]) * t + grain * 0.5,
  ]
}

function fieldAt(field, W, x, z) {
  const px = x / MPP + W / 2
  const py = z / MPP + (field.length / W) / 2
  const fx = Math.min(Math.max(px - 0.5, 0), W - 1.001)
  const fy = Math.min(Math.max(py - 0.5, 0), field.length / W - 1.001)
  const x0 = Math.floor(fx)
  const y0 = Math.floor(fy)
  const tx = fx - x0
  const ty = fy - y0
  const i = y0 * W + x0
  return (field[i] * (1 - tx) + field[i + 1] * tx) * (1 - ty)
    + (field[i + W] * (1 - tx) + field[i + W + 1] * tx) * ty
}

/** Coarse-mesh triangles that still reach the keel, and the bank vertex to lower. */
function meshVerts(mesh, x, z) {
  const fx = Math.min(mesh.segX, Math.max(0, (x / mesh.worldW + 0.5) * mesh.segX))
  const fz = Math.min(mesh.segZ, Math.max(0, (z / mesh.worldD + 0.5) * mesh.segZ))
  let i = Math.floor(fx)
  let j = Math.floor(fz)
  if (i >= mesh.segX) i = mesh.segX - 1
  if (j >= mesh.segZ) j = mesh.segZ - 1
  const tx = fx - i
  const tz = fz - j
  const at = (ii, jj) => ({
    h: mesh.h[jj * mesh.nx + ii],
    x: (ii / mesh.segX - 0.5) * mesh.worldW,
    z: (jj / mesh.segZ - 0.5) * mesh.worldD,
  })
  const height = tx + tz <= 1
    ? at(i, j).h * (1 - tx - tz) + at(i, j + 1).h * tz + at(i + 1, j).h * tx
    : at(i, j + 1).h * (1 - tx) + at(i + 1, j + 1).h * (tx + tz - 1) + at(i + 1, j).h * (1 - tz)
  const verts = tx + tz <= 1
    ? [at(i, j), at(i + 1, j), at(i, j + 1)]
    : [at(i, j + 1), at(i + 1, j + 1), at(i + 1, j)]
  return { height, verts }
}

function slipReport(W, H, heightAt, label) {
  const mesh = buildMesh(heightAt, 256, 192, W * MPP, H * MPP)
  let blocked = 0
  const names = []
  for (const t of TERMINALS) {
    const yaw = Math.atan2(-t.ax, -t.ay)
    const c = Math.cos(yaw)
    const s = Math.sin(yaw)
    for (let i = 0; i < t.count; i++) {
      const metres = (i - (t.count - 1) / 2) * PITCH
      const reach = (32 + lipOf(t.id, metres)) / MPP
      const px = t.x + t.bx * (metres / MPP) + t.ax * reach
      const py = t.y + t.by * (metres / MPP) + t.ay * reach
      const origin = worldOf(px, py, W, H)
      let worst = -99
      // The berth, and a short way astern of it, where she has to arrive.
      for (let lx = -6; lx <= 6; lx += 3) {
        for (let lz = -40; lz <= 22; lz += 4) {
          const h = meshHeight(mesh, origin.x + lx * c + lz * s, origin.z - lx * s + lz * c)
          if (h > worst) worst = h
        }
      }
      if (worst > CLEAR) {
        blocked++
        names.push(`${t.id} ${i} ${worst.toFixed(2)}`)
      }
    }
  }
  console.log(`${label}: ${blocked} slips still above ${CLEAR}${names.length ? ` (${names.join('; ')})` : ''}`)
  return blocked
}

/**
 * A bank vertex just inland of the quay still lifts the bow. Drop only those
 * vertices, and only where they actually hold a hull sample up.
 */
function dropBank(W, H, cut, mask) {
  const mesh = buildMesh((x, z) => fieldAt(cut, W, x, z), 256, 192, W * MPP, H * MPP)
  let lowered = 0
  const sink = (vert) => {
    const px = vert.x / MPP + W / 2
    const py = vert.z / MPP + H / 2
    let quay = false
    for (const t of TERMINALS) {
      const f = frameOf(t, px, py)
      const span = ((t.count - 1) / 2) * PITCH + 36
      if (Math.abs(f.along) <= span && f.across > -16 && f.across < 120) quay = true
    }
    if (!quay) return
    const x0 = Math.floor(px - 0.5)
    const y0 = Math.floor(py - 0.5)
    for (let y = y0; y <= y0 + 1; y++) {
      for (let x = x0; x <= x0 + 1; x++) {
        if (x < 0 || y < 0 || x >= W || y >= H) continue
        if (keepOut(x + 0.5, y + 0.5)) continue
        const i = y * W + x
        if (cut[i] <= FLOOR) continue
        cut[i] = FLOOR
        mask[i] = 1
        lowered++
      }
    }
  }
  for (const t of TERMINALS) {
    const yaw = Math.atan2(-t.ax, -t.ay)
    const c = Math.cos(yaw)
    const s = Math.sin(yaw)
    for (let i = 0; i < t.count; i++) {
      const metres = (i - (t.count - 1) / 2) * PITCH
      const reach = (32 + lipOf(t.id, metres)) / MPP
      const px = t.x + t.bx * (metres / MPP) + t.ax * reach
      const py = t.y + t.by * (metres / MPP) + t.ay * reach
      const origin = worldOf(px, py, W, H)
      for (let lx = -6; lx <= 6; lx += 3) {
        for (let lz = -40; lz <= 22; lz += 4) {
          const hit = meshVerts(mesh, origin.x + lx * c + lz * s, origin.z - lx * s + lz * c)
          if (hit.height <= CLEAR) continue
          for (const vert of hit.verts) if (vert.h > CLEAR) sink(vert)
        }
      }
    }
  }
  return lowered
}

export async function cutFerryApproaches(dir) {
  const heightPath = resolve(dir, 'heightmap.png')
  const depthPath = resolve(dir, 'waterdepth.png')
  const colorPath = resolve(dir, 'landcolor.jpg')
  const treePath = resolve(dir, 'trees.json')

  const heightPng = await sharp(heightPath).raw().toBuffer({ resolveWithObject: true })
  const depthPng = await sharp(depthPath).raw().toBuffer({ resolveWithObject: true })
  const colorJpg = await sharp(colorPath).raw().toBuffer({ resolveWithObject: true })
  const W = heightPng.info.width
  const H = heightPng.info.height
  const N = W * H
  const height = new Float32Array(N)
  const cls = new Uint8Array(N)
  for (let i = 0; i < N; i++) {
    height[i] = decodeHeight(heightPng.data, i)
    cls[i] = heightPng.data[i * 3 + 2]
  }
  const heightAt = (x, z) => {
    const px = x / MPP + W / 2
    const py = z / MPP + H / 2
    const fx = Math.min(Math.max(px - 0.5, 0), W - 1.001)
    const fy = Math.min(Math.max(py - 0.5, 0), H - 1.001)
    const x0 = Math.floor(fx)
    const y0 = Math.floor(fy)
    const tx = fx - x0
    const ty = fy - y0
    const i = y0 * W + x0
    return (height[i] * (1 - tx) + height[i + 1] * tx) * (1 - ty)
      + (height[i + W] * (1 - tx) + height[i + W + 1] * tx) * ty
  }

  const before = slipReport(W, H, heightAt, 'before')
  if (before === 0) return { lowered: 0, landToWater: 0, trees: 0 }
  const mesh = buildMesh(heightAt, 256, 192, W * MPP, H * MPP)
  const base = cutMask(W, H, height, mesh)
  const applyMask = (source, bits) => {
    const next = Float32Array.from(source)
    for (let i = 0; i < N; i++) if (bits[i] && next[i] > FLOOR) next[i] = FLOOR
    return next
  }
  // One pixel of the coarse shore is about 8 m here, and 31 m on the low mesh.
  // Grow the cut only while that actually clears another slip.
  let mask = base
  let cut = height
  let blocked = before
  let prev = Infinity
  let used = 0
  for (let radius = 0; radius <= 1; radius++) {
    const bits = dilate(W, H, base, radius)
    const trial = applyMask(height, bits)
    const n = slipReport(W, H, (x, z) => fieldAt(trial, W, x, z), `dilate ${radius}px`)
    if (n < blocked) {
      mask = bits
      cut = trial
      blocked = n
      used = radius
    }
    if (n === 0 || n >= prev) break
    prev = n
  }
  for (let pass = 0; pass < 4 && blocked > 0; pass++) {
    const sunk = dropBank(W, H, cut, mask)
    blocked = slipReport(W, H, (x, z) => fieldAt(cut, W, x, z), `bank ${pass} (${sunk} px)`)
    if (sunk === 0) break
  }

  // Ease the rim over about 12 m so the bank slopes into the berth.
  const rim = new Float32Array(cut)
  const RIM = 1.6
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x
      if (mask[i] || keepOut(x + 0.5, y + 0.5)) continue
      let nearest = RIM
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
          if (!mask[ny * W + nx]) continue
          nearest = Math.min(nearest, Math.hypot(dx, dy))
        }
      }
      if (nearest >= RIM) continue
      let byQuay = false
      for (const t of TERMINALS) {
        const f = frameOf(t, x + 0.5, y + 0.5)
        const span = ((t.count - 1) / 2) * PITCH + 40
        if (Math.abs(f.along) < span && f.across > -24 && f.across < 220) byQuay = true
      }
      if (!byQuay) continue
      const u = nearest / RIM
      const target = FLOOR + (height[i] - FLOOR) * u * u
      if (target < rim[i]) rim[i] = target
    }
  }

  let lowered = 0
  let landToWater = 0
  for (let i = 0; i < N; i++) if (rim[i] < height[i] - 0.05) {
    lowered++
    if (cls[i] === 255 && rim[i] < 0) landToWater++
  }
  console.log(`lowered ${lowered} px, ${landToWater} of them were dry land, dilate ${used}px, still blocked ${blocked}`)
  if (lowered === 0) return { lowered: 0, landToWater: 0, trees: 0 }

  const rgb = Buffer.from(heightPng.data)
  const depth = Buffer.from(depthPng.data)
  const color = Buffer.from(colorJpg.data)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x
      if (rim[i] >= height[i] - 0.02) continue
      const v = encodeHeight(rim[i])
      rgb[i * 3] = v >> 8
      rgb[i * 3 + 1] = v & 255
      if (rim[i] < -0.15) rgb[i * 3 + 2] = 0
      const encoded = Math.round(Math.min(1, Math.max(0, (8 - rim[i]) / 48)) * 255)
      const dc = depthPng.info.channels
      for (let c = 0; c < dc; c++) depth[i * dc + c] = encoded
      if (rim[i] < -0.1) {
        const bed = lakebed(rim[i], x, y)
        const wasLand = cls[i] === 255
        const mix = wasLand ? 1 : 0.55
        color[i * 3] = Math.max(0, Math.min(255, Math.round(color[i * 3] * (1 - mix) + bed[0] * mix)))
        color[i * 3 + 1] = Math.max(0, Math.min(255, Math.round(color[i * 3 + 1] * (1 - mix) + bed[1] * mix)))
        color[i * 3 + 2] = Math.max(0, Math.min(255, Math.round(color[i * 3 + 2] * (1 - mix) + bed[2] * mix)))
      }
    }
  }

  const trees = JSON.parse(readFileSync(treePath, 'utf8'))
  const kept = []
  for (const tree of trees) {
    const px = tree[0] / MPP + W / 2
    const py = tree[1] / MPP + H / 2
    const ix = Math.min(W - 1, Math.max(0, Math.floor(px)))
    const iy = Math.min(H - 1, Math.max(0, Math.floor(py)))
    if (rim[iy * W + ix] < 0.4) continue
    kept.push(tree)
  }
  console.log(`trees ${trees.length} -> ${kept.length}`)

  await sharp(rgb, { raw: { width: W, height: H, channels: 3 } }).png({ compressionLevel: 9 }).toFile(heightPath)
  await sharp(depth, { raw: { width: W, height: H, channels: depthPng.info.channels } }).png({ compressionLevel: 9 }).toFile(depthPath)
  // Quality 100 keeps the rest of the painted chart from shifting when the file is rewritten.
  await sharp(color, { raw: { width: W, height: H, channels: 3 } }).jpeg({ quality: 100, chromaSubsampling: '4:4:4' }).toFile(colorPath)
  writeFileSync(treePath, JSON.stringify(kept))

  // Confirm the written heightmap, not the buffer we meant to write.
  const checkPng = await sharp(heightPath).raw().toBuffer({ resolveWithObject: true })
  const checkH = new Float32Array(N)
  for (let i = 0; i < N; i++) checkH[i] = decodeHeight(checkPng.data, i)
  const checkAt = (x, z) => {
    const px = x / MPP + W / 2
    const py = z / MPP + H / 2
    const fx = Math.min(Math.max(px - 0.5, 0), W - 1.001)
    const fy = Math.min(Math.max(py - 0.5, 0), H - 1.001)
    const x0 = Math.floor(fx)
    const y0 = Math.floor(fy)
    const tx = fx - x0
    const ty = fy - y0
    const i = y0 * W + x0
    return (checkH[i] * (1 - tx) + checkH[i + 1] * tx) * (1 - ty)
      + (checkH[i + W] * (1 - tx) + checkH[i + W + 1] * tx) * ty
  }
  const after = slipReport(W, H, checkAt, 'written')
  if (after !== 0) throw new Error(`${after} ferry slips are still blocked`)
  return { lowered, landToWater, trees: trees.length - kept.length }
}

const direct = process.argv[1] && process.argv[1].endsWith('ferryCut.mjs')
if (direct) {
  const dir = process.argv[2] ?? resolve(import.meta.dirname, '../../client/public/map')
  const result = await cutFerryApproaches(dir)
  console.log(result)
}
