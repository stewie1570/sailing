import { useMemo } from 'react'
import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { MapData } from '../map/mapData'
import { QUALITY_PRESETS, useQuality } from './quality'
import { CANOPY, TRUNK, eachVisibleTree, treeFrame, treeOriginY } from './treeLayout'

/**
 * Trunk + two stacked canopy cones, 28 triangles. Faces that can never be seen (trunk ends, the upper
 * cone's base inside the lower cone) are omitted. Vertex colours separate bark from foliage.
 */
function buildTreeGeometry(): THREE.BufferGeometry {
  const trunk = new THREE.CylinderGeometry(TRUNK.radiusTop, TRUNK.radiusBottom, TRUNK.height, 5, 1, true)
  trunk.translate(0, TRUNK.height / 2, 0)
  const cones = CANOPY.map((cone) => {
    const height = cone.y1 - cone.y0
    const geo = new THREE.ConeGeometry(cone.radius, height, 6, 1, cone.open)
    geo.translate(0, (cone.y0 + cone.y1) / 2, 0)
    return geo
  })
  const [lower, upper] = cones

  const paint = (geo: THREE.BufferGeometry, color: THREE.Color) => {
    const n = geo.attributes.position.count
    const colors = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) colors.set([color.r, color.g, color.b], i * 3)
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  }
  paint(trunk, new THREE.Color(0.22, 0.14, 0.08))
  paint(lower, new THREE.Color(0.9, 1.0, 0.9))
  paint(upper, new THREE.Color(1.0, 1.0, 1.0))

  const merged = mergeGeometries([trunk, lower, upper], false)!
  merged.computeBoundingSphere()
  return merged
}

export function Trees({ map }: { map: MapData }) {
  const quality = useQuality()
  const fraction = QUALITY_PRESETS[quality].treeFraction

  const mesh = useMemo(() => {
    const geometry = buildTreeGeometry()
    const material = new THREE.MeshLambertMaterial({ vertexColors: true })
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
      // foliage variation: olive to deep green
      const t = ((i * 48271) % 1000) / 1000
      color.setRGB(0.10 + 0.14 * t, 0.26 + 0.16 * (1 - t), 0.07 + 0.05 * t)
      inst.setColorAt(i, color)
    })
    inst.instanceMatrix.needsUpdate = true
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true
    inst.frustumCulled = false
    return inst
  }, [map, fraction])

  return <primitive object={mesh} />
}
