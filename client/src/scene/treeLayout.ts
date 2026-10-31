import type { MapData } from '../map/mapData'

/** Trunk and canopy in the tree's local space, before the instance scale. Shared with the mesh. */
export const TRUNK = { radiusBottom: 0.5, radiusTop: 0.35, height: 3.2 }
export const CANOPY = [
  { radius: 3.6, y0: 2.7, y1: 9.7, open: false },
  { radius: 2.4, y0: 7.5, y1: 13.5, open: true },
] as const

export function visibleTreeCount(total: number, fraction: number) {
  return Math.floor(total * fraction)
}

/** Same stride Trees.tsx uses, so a hidden quality level is not a solid tree. */
export function visibleTreeIndex(i: number, total: number, count: number) {
  return Math.floor(i * (total / Math.max(count, 1)))
}

export function treeFrame(instance: number, scale: number) {
  const h = scale * 1.4
  const sx = h * (0.9 + ((instance * 7919) % 100) / 500)
  const sz = h * (0.9 + ((instance * 104729) % 100) / 500)
  return { h, sx, sy: h, sz }
}

export function treeOriginY(ground: number) {
  return Math.max(ground, 0) - 0.3
}

function coneRadius(localY: number, radius: number, y0: number, y1: number) {
  if (localY < y0 || localY > y1) return 0
  const t = (localY - y0) / (y1 - y0)
  return radius * (1 - t)
}

/** Widest foliage in a local-y span. Each cone is fattest at its base. */
export function maxFoliageRadius(localY0: number, localY1: number, xzScale: number) {
  const y0 = Math.min(localY0, localY1)
  const y1 = Math.max(localY0, localY1)
  let r = 0
  const at = (y: number) => {
    let m = 0
    for (const cone of CANOPY) m = Math.max(m, coneRadius(y, cone.radius, cone.y0, cone.y1))
    return m
  }
  r = Math.max(at(y0), at(y1))
  for (const cone of CANOPY) {
    if (cone.y0 > y0 && cone.y0 < y1) r = Math.max(r, cone.radius)
  }
  return r * xzScale
}

/** Trunk tapers upward, so the overlap's low end is the widest. */
export function maxTrunkRadius(localY0: number, localY1: number, xzScale: number) {
  const y0 = Math.max(0, Math.min(localY0, localY1))
  const y1 = Math.min(TRUNK.height, Math.max(localY0, localY1))
  if (y1 < y0) return 0
  const t = y0 / TRUNK.height
  return (TRUNK.radiusBottom + (TRUNK.radiusTop - TRUNK.radiusBottom) * t) * xzScale
}

export function eachVisibleTree(map: MapData, fraction: number, fn: (instance: number, x: number, z: number, scale: number) => void) {
  const total = map.trees.length
  const count = visibleTreeCount(total, fraction)
  for (let i = 0; i < count; i++) {
    const [x, z, scale] = map.trees[visibleTreeIndex(i, total, count)]
    fn(i, x, z, scale)
  }
}
