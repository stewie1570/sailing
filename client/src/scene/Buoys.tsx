import { useFrame } from '@react-three/fiber'
import { useMemo } from 'react'
import * as THREE from 'three'
import type { MapData } from '../map/mapData'

const RED = new THREE.Color(0.75, 0.05, 0.04)
const GREEN = new THREE.Color(0.05, 0.5, 0.12)

/**
 * IALA lateral marks: starboard (red) with a pointed cone topmark, port (green) with a can topmark.
 * Slightly oversized relative to reality so they stay readable at sailing distances.
 */
export function Buoys({ map }: { map: MapData }) {
  const { bodies, topmarks } = useMemo(() => {
    const n = map.buoys.length
    const bodyGeo = new THREE.CylinderGeometry(0.9, 1.1, 2.6, 10, 1)
    bodyGeo.translate(0, 1.0, 0)
    const bodies = new THREE.InstancedMesh(bodyGeo, new THREE.MeshLambertMaterial(), n)
    const topGeo = new THREE.CylinderGeometry(0.3, 0.3, 1.4, 6, 1)
    topGeo.translate(0, 3.0, 0)
    const topmarks = new THREE.InstancedMesh(topGeo, new THREE.MeshLambertMaterial(), n)
    const m = new THREE.Matrix4()
    map.buoys.forEach((b, i) => {
      const color = b.type === 'starboard' ? RED : GREEN
      m.makeTranslation(b.x, map.waterLevel, b.z)
      bodies.setMatrixAt(i, m)
      bodies.setColorAt(i, color)
      // cone for starboard, can for port
      m.compose(new THREE.Vector3(b.x, map.waterLevel, b.z), new THREE.Quaternion(), new THREE.Vector3(b.type === 'starboard' ? 1.6 : 1.3, 1, b.type === 'starboard' ? 1.6 : 1.3))
      topmarks.setMatrixAt(i, m)
      topmarks.setColorAt(i, color)
    })
    bodies.frustumCulled = topmarks.frustumCulled = false
    return { bodies, topmarks }
  }, [map])

  // Bob and roll with the swell. 26 matrices per frame is negligible.
  useFrame((state) => {
    const t = state.clock.elapsedTime
    const m = new THREE.Matrix4()
    const p = new THREE.Vector3()
    const q = new THREE.Quaternion()
    const e = new THREE.Euler()
    const s = new THREE.Vector3()
    map.buoys.forEach((b, i) => {
      const phase = b.x * 0.013 + b.z * 0.007
      const y = map.waterLevel + 0.12 * Math.sin(t * 0.9 + phase) + 0.06 * Math.sin(t * 1.7 + phase * 2.0)
      e.set(0.05 * Math.sin(t * 1.1 + phase), 0, 0.05 * Math.cos(t * 0.8 + phase))
      q.setFromEuler(e)
      p.set(b.x, y, b.z)
      const topScale = b.type === 'starboard' ? 1.6 : 1.3
      s.set(1, 1, 1)
      m.compose(p, q, s)
      bodies.setMatrixAt(i, m)
      s.set(topScale, 1, topScale)
      m.compose(p, q, s)
      topmarks.setMatrixAt(i, m)
    })
    bodies.instanceMatrix.needsUpdate = true
    topmarks.instanceMatrix.needsUpdate = true
  })

  return (
    <>
      <primitive object={bodies} />
      <primitive object={topmarks} />
    </>
  )
}
