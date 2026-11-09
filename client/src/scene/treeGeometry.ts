import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { CROWN, TRUNK } from './treeLayout'

/** How far the crown leans, in local metres. The boat hits the lower trunk, which stays put. */
const LEAN = 0.55
const FRONDS = 10
const TRUNK_SIDES = 6

const BARK_BASE = [0.42, 0.28, 0.14]
const BARK_TOP = [0.62, 0.44, 0.24]
const FROND_BASE = [0.15, 0.36, 0.1]
const FROND_MID = [0.28, 0.58, 0.15]
const FROND_TIP = [0.62, 0.74, 0.24]

/**
 * A palm: a tapered trunk and ten fronds that rise a little, then droop.
 * Each frond is two quads, 58 triangles for the whole tree. The material draws
 * both sides, so each leaf is stored once.
 */
export function buildTreeGeometry(): THREE.BufferGeometry {
  const merged = mergeGeometries([leaningTrunk(TRUNK_SIDES), trunkCap(), fronds()], false)!
  merged.computeBoundingSphere()
  return merged
}

/**
 * The palm drawn past a few hundred metres. Same height and spread as the full
 * one, with a plainer trunk and six straight fronds, so the outline stays put
 * when the detail drops.
 */
export function buildFarTreeGeometry(): THREE.BufferGeometry {
  const FAR_SIDES = 5
  const FAR_FRONDS = 6
  const trunk = leaningTrunk(FAR_SIDES)
  const positions: number[] = []
  const colors: number[] = []
  const indices: number[] = []
  for (let i = 0; i < FAR_FRONDS; i++) {
    const angle = (i / FAR_FRONDS) * Math.PI * 2 + 0.4
    const dirX = Math.cos(angle)
    const dirZ = Math.sin(angle)
    const sideX = -dirZ
    const sideZ = dirX
    const tipHalf = 0.3
    const room = Math.sqrt(Math.max(0, CROWN.radius * CROWN.radius - tipHalf * tipHalf)) - LEAN
    const reach = room * (0.9 + (i % 3) * 0.05)
    const yTip = CROWN.y0 + (i % 3) * 0.35
    const along = [0.06, reach]
    const y = [CROWN.y, yTip]
    const half = [0.36, tipHalf]
    const tint = [FROND_BASE, FROND_TIP]
    const v = positions.length / 3
    for (let s = 0; s < 2; s++) {
      const cx = LEAN + dirX * along[s]
      const cz = dirZ * along[s]
      positions.push(cx + sideX * half[s], y[s], cz + sideZ * half[s])
      positions.push(cx - sideX * half[s], y[s], cz - sideZ * half[s])
      colors.push(...tint[s], ...tint[s])
    }
    indices.push(v, v + 3, v + 1, v, v + 2, v + 3)
  }
  const leaves = new THREE.BufferGeometry()
  leaves.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  leaves.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  leaves.setIndex(indices)
  leaves.computeVertexNormals()
  const merged = mergeGeometries([trunk, leaves], false)!
  merged.computeBoundingSphere()
  return merged
}

function leaningTrunk(sides: number) {
  const trunk = new THREE.CylinderGeometry(TRUNK.radiusTop, TRUNK.radiusBottom, TRUNK.height, sides, 1, true)
  trunk.translate(0, TRUNK.height / 2, 0)
  const pos = trunk.attributes.position
  for (let i = 0; i < pos.count; i++) {
    const t = Math.min(1, Math.max(0, pos.getY(i) / TRUNK.height))
    pos.setX(i, pos.getX(i) + LEAN * t * t)
  }
  trunk.deleteAttribute('uv')
  trunk.computeVertexNormals()
  paintGradient(trunk, BARK_BASE, BARK_TOP)
  return trunk
}

function paintGradient(geo: THREE.BufferGeometry, bottom: number[], top: number[]) {
  const pos = geo.attributes.position
  const colors = new Float32Array(pos.count * 3)
  for (let i = 0; i < pos.count; i++) {
    const t = Math.min(1, Math.max(0, pos.getY(i) / TRUNK.height))
    colors[i * 3] = bottom[0] + (top[0] - bottom[0]) * t
    colors[i * 3 + 1] = bottom[1] + (top[1] - bottom[1]) * t
    colors[i * 3 + 2] = bottom[2] + (top[2] - bottom[2]) * t
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
}

/** Disc on the leaned crown so the hollow trunk does not show from above. */
function trunkCap(): THREE.BufferGeometry {
  const positions = [LEAN, TRUNK.height, 0]
  const normals = [0, 1, 0]
  const color = [...BARK_TOP]
  for (let i = 0; i < TRUNK_SIDES; i++) {
    const a = (i / TRUNK_SIDES) * Math.PI * 2
    positions.push(LEAN + Math.cos(a) * TRUNK.radiusTop, TRUNK.height, Math.sin(a) * TRUNK.radiusTop)
    normals.push(0, 1, 0)
    color.push(...BARK_TOP)
  }
  const indices: number[] = []
  for (let i = 0; i < TRUNK_SIDES; i++) indices.push(0, i + 1, ((i + 1) % TRUNK_SIDES) + 1)
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  geo.setAttribute('color', new THREE.Float32BufferAttribute(color, 3))
  geo.setIndex(indices)
  return geo
}

/** Ten arched fronds. The mid of each leaf is the widest part, and the tip hangs. */
function fronds(): THREE.BufferGeometry {
  const positions: number[] = []
  const colors: number[] = []
  const indices: number[] = []
  for (let i = 0; i < FRONDS; i++) {
    const angle = (i / FRONDS) * Math.PI * 2 + 0.2
    const dirX = Math.cos(angle)
    const dirZ = Math.sin(angle)
    const sideX = -dirZ
    const sideZ = dirX
    const tipHalf = 0.16
    const room = Math.sqrt(Math.max(0, CROWN.radius * CROWN.radius - tipHalf * tipHalf)) - LEAN
    const reach = room * (0.84 + (i % 5) * 0.04)
    const yBase = CROWN.y
    const yMid = Math.min(CROWN.y1, CROWN.y + 0.45 - (i % 3) * 0.1)
    const yTip = CROWN.y0 + (i % 4) * 0.32
    const along = [0.06, reach * 0.46, reach]
    const y = [yBase, yMid, yTip]
    const half = [0.2, 0.62, tipHalf]
    const tint = [FROND_BASE, FROND_MID, FROND_TIP]
    const v = positions.length / 3
    for (let s = 0; s < 3; s++) {
      const cx = LEAN + dirX * along[s]
      const cz = dirZ * along[s]
      positions.push(cx + sideX * half[s], y[s], cz + sideZ * half[s])
      positions.push(cx - sideX * half[s], y[s], cz - sideZ * half[s])
      colors.push(...tint[s], ...tint[s])
    }
    // Two quads, wound so the normal points at the sky. Left, right, next right, next left.
    for (let s = 0; s < 2; s++) {
      const a = v + s * 2
      indices.push(a, a + 3, a + 1, a, a + 2, a + 3)
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  geo.setIndex(indices)
  geo.computeVertexNormals()
  return geo
}
