import { useMemo } from 'react'
import * as THREE from 'three'
import type { MapData } from '../map/mapData'
import { QUALITY_PRESETS, useQuality } from './quality'
import { buildTreeGeometry } from './treeGeometry'
import { eachVisibleTree, treeFrame, treeOriginY } from './treeLayout'

export function Trees({ map }: { map: MapData }) {
  const quality = useQuality()
  const fraction = QUALITY_PRESETS[quality].treeFraction

  const mesh = useMemo(() => {
    const geometry = buildTreeGeometry()
    const material = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide })
    const count = Math.floor(map.trees.length * fraction)
    const inst = new THREE.InstancedMesh(geometry, material, count)
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const s = new THREE.Vector3()
    const p = new THREE.Vector3()
    const color = new THREE.Color()
    // Deterministic selection: stride through the list so thinning stays spatially uniform.
    eachVisibleTree(map, fraction, (i, x, z, scale) => {
      const y = map.heightAt(x, z)
      p.set(x, treeOriginY(y), z)
      q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, (i * 2.399) % (Math.PI * 2)) // golden-angle rotation
      const frame = treeFrame(i, scale)
      s.set(frame.sx, frame.sy, frame.sz)
      m.compose(p, q, s)
      inst.setMatrixAt(i, m)
      // Brightness only. The hue is on the vertices, so bark stays tan and fronds stay green.
      const t = ((i * 48271) % 1000) / 1000
      color.setRGB(0.88 + 0.12 * t, 0.9 + 0.1 * (1 - t), 0.82 + 0.1 * t)
      inst.setColorAt(i, color)
    })
    inst.instanceMatrix.needsUpdate = true
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true
    inst.frustumCulled = false
    return inst
  }, [map, fraction])

  return <primitive object={mesh} />
}
