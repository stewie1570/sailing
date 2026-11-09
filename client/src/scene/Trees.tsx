import { useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import type { MapData } from '../map/mapData'
import { QUALITY_PRESETS, useQuality } from './quality'
import { buildFarTreeGeometry, buildTreeGeometry } from './treeGeometry'
import { eachVisibleTree, treeFrame, treeIsNear, treeOriginY } from './treeLayout'

/** Camera movement, in metres, before the near and far sets are rebuilt. */
const LOD_MOVE = 25

type TreeRec = {
  x: number
  y: number
  z: number
  near: boolean
  matrix: THREE.Matrix4
  color: THREE.Color
}

type TreeLod = {
  group: THREE.Group
  near: THREE.InstancedMesh
  far: THREE.InstancedMesh
  trees: TreeRec[]
}

export function Trees({ map }: { map: MapData }) {
  const quality = useQuality()
  const fraction = QUALITY_PRESETS[quality].treeFraction
  const camera = useThree((s) => s.camera)
  const lod = useMemo(() => buildLod(map, fraction), [map, fraction])
  const anchor = useRef(new THREE.Vector3(Number.NaN, Number.NaN, Number.NaN))
  const lodRef = useRef(lod)

  useFrame(() => {
    if (lodRef.current !== lod) {
      lodRef.current = lod
      anchor.current.set(Number.NaN, Number.NaN, Number.NaN)
    }
    const cam = camera.position
    const moved = anchor.current.distanceToSquared(cam)
    if (moved < LOD_MOVE * LOD_MOVE) return
    anchor.current.copy(cam)
    retarget(lod, cam)
  })

  return <primitive object={lod.group} />
}

function buildLod(map: MapData, fraction: number): TreeLod {
  const count = Math.max(Math.floor(map.trees.length * fraction), 1)
  const material = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide })
  const near = new THREE.InstancedMesh(buildTreeGeometry(), material, count)
  const far = new THREE.InstancedMesh(buildFarTreeGeometry(), material, count)
  near.count = 0
  far.count = 0
  const trees: TreeRec[] = []
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const s = new THREE.Vector3()
  const color = new THREE.Color()
  // Deterministic selection: stride through the list so thinning stays spatially uniform.
  eachVisibleTree(map, fraction, (i, x, z, scale) => {
    const y = treeOriginY(map.heightAt(x, z))
    q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, (i * 2.399) % (Math.PI * 2)) // golden-angle rotation
    const frame = treeFrame(i, scale)
    s.set(frame.sx, frame.sy, frame.sz)
    m.compose(new THREE.Vector3(x, y, z), q, s)
    const t = ((i * 48271) % 1000) / 1000
    color.setRGB(0.88 + 0.12 * t, 0.9 + 0.1 * (1 - t), 0.82 + 0.1 * t)
    trees.push({ x, y, z, near: false, matrix: m.clone(), color: color.clone() })
  })
  const group = new THREE.Group()
  group.add(near, far)
  return { group, near, far, trees }
}

/** Put each palm on the full mesh or the far mesh. The band between the two distances stops flicker. */
function retarget(lod: TreeLod, cam: THREE.Vector3) {
  let nearCount = 0
  let farCount = 0
  for (const tree of lod.trees) {
    const distance = Math.hypot(tree.x - cam.x, tree.y - cam.y, tree.z - cam.z)
    tree.near = treeIsNear(distance, tree.near)
    const mesh = tree.near ? lod.near : lod.far
    const slot = tree.near ? nearCount++ : farCount++
    mesh.setMatrixAt(slot, tree.matrix)
    mesh.setColorAt(slot, tree.color)
  }
  lod.near.count = nearCount
  lod.far.count = farCount
  lod.near.visible = nearCount > 0
  lod.far.visible = farCount > 0
  lod.near.instanceMatrix.needsUpdate = true
  lod.far.instanceMatrix.needsUpdate = true
  if (lod.near.instanceColor) lod.near.instanceColor.needsUpdate = true
  if (lod.far.instanceColor) lod.far.instanceColor.needsUpdate = true
  // The bounds cover every instance. Drop them so the next draw measures the new set.
  lod.near.boundingSphere = null
  lod.far.boundingSphere = null
}
