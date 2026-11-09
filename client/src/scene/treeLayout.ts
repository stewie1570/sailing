import type { MapData } from '../map/mapData'

/**
 * Palm trunk and crown in the tree's local space, before the instance scale.
 * The mesh draws the fronds. Collision uses the crown envelope.
 */
export const TRUNK = { radiusBottom: 0.46, radiusTop: 0.22, height: 9 }
export const CROWN = { radius: 4.6, y0: 4.8, y1: 9.45, y: 8.65 }

/** Full crown inside this many metres. */
export const TREE_LOD_NEAR = 650
/** A full crown stays full out to here, so a tree on the line does not flicker. */
export const TREE_LOD_FAR = 800

/** True when this palm should use the full crown. */
export function treeIsNear(distance: number, wasNear: boolean) {
  return wasNear ? distance < TREE_LOD_FAR : distance < TREE_LOD_NEAR
}

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

/** Widest the crown gets. The fronds fill this radius between the drooping tips and the upright ones. */
export function maxFoliageRadius(localY0: number, localY1: number, xzScale: number) {
  const y0 = Math.min(localY0, localY1)
  const y1 = Math.max(localY0, localY1)
  if (y1 < CROWN.y0 || y0 > CROWN.y1) return 0
  return CROWN.radius * xzScale
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
