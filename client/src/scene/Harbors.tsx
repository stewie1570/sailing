import { useMemo } from 'react'
import * as THREE from 'three'
import type { MapData } from '../map/mapData'

const DECK = new THREE.Color(0.55, 0.47, 0.36)
const PONTOON = new THREE.Color(0.78, 0.78, 0.74)
const ROCK = new THREE.Color(0.38, 0.37, 0.34)
const WALLS = [new THREE.Color(0.85, 0.82, 0.74), new THREE.Color(0.7, 0.68, 0.6), new THREE.Color(0.6, 0.35, 0.25)]
const ROOFS = [new THREE.Color(0.55, 0.18, 0.12), new THREE.Color(0.3, 0.32, 0.36), new THREE.Color(0.45, 0.25, 0.15)]

interface Placement { position: THREE.Vector3; rotationY: number; scale: THREE.Vector3; color: THREE.Color }

function instanced(geometry: THREE.BufferGeometry, placements: Placement[]): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geometry, new THREE.MeshLambertMaterial(), placements.length)
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  placements.forEach((p, i) => {
    q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, p.rotationY)
    m.compose(p.position, q, p.scale)
    mesh.setMatrixAt(i, m)
    mesh.setColorAt(i, p.color)
  })
  mesh.frustumCulled = false
  return mesh
}

/**
 * Procedural harbour furniture derived from the chart's harbour positions: a main pier with finger
 * pontoons, a rock breakwater with a beacon, and a cluster of buildings on the shore behind.
 */
export function Harbors({ map }: { map: MapData }) {
  const meshes = useMemo(() => {
    const boxes: Placement[] = []      // unit cube instances (piers, pontoons, breakwaters, walls)
    const roofs: Placement[] = []      // hip roofs
    const beacons: Placement[] = []

    const unitBox = new THREE.BoxGeometry(1, 1, 1)
    unitBox.translate(0, 0.5, 0)
    const roofGeo = new THREE.ConeGeometry(0.72, 1, 4, 1)
    roofGeo.rotateY(Math.PI / 4)
    roofGeo.translate(0, 0.5, 0)
    const beaconGeo = new THREE.CylinderGeometry(0.7, 1.0, 1, 10, 1)
    beaconGeo.translate(0, 0.5, 0)

    for (const h of map.harbors) {
      const s = new THREE.Vector2(h.seaward[0], h.seaward[1]).normalize()
      const l = new THREE.Vector2(-s.y, s.x)
      const yaw = Math.atan2(s.x, s.y) // rotation so local +z points seaward
      const at = (base: THREE.Vector2, along: number, across: number) => new THREE.Vector2(base.x + s.x * along + l.x * across, base.y + s.y * along + l.y * across)

      // Walk to the shoreline along the seaward axis.
      const shore = new THREE.Vector2(h.x, h.z)
      const startsOnLand = map.heightAt(shore.x, shore.y) > 0
      for (let i = 0; i < 400; i++) {
        const hgt = map.heightAt(shore.x, shore.y)
        if (startsOnLand ? hgt <= 0 : hgt > 0.15) break
        shore.addScaledVector(s, startsOnLand ? 5 : -5)
      }

      // Main pier
      const pierLen = 190
      const pierC = at(shore, pierLen / 2 - 12, 0)
      boxes.push({ position: new THREE.Vector3(pierC.x, 0.3, pierC.y), rotationY: yaw, scale: new THREE.Vector3(5, 1.1, pierLen), color: DECK })
      // Finger pontoons on both sides
      for (let d = 45; d < pierLen - 20; d += 24) {
        for (const side of [-1, 1]) {
          const c = at(shore, d - 12, side * (2.5 + 15))
          boxes.push({ position: new THREE.Vector3(c.x, 0.15, c.y), rotationY: yaw + Math.PI / 2, scale: new THREE.Vector3(30, 0.5, 2.2), color: PONTOON })
        }
      }
      // Breakwater parallel to the shore, with a beacon at one end
      const bwC = at(shore, pierLen + 60, 40)
      boxes.push({ position: new THREE.Vector3(bwC.x, -1.5, bwC.y), rotationY: yaw + Math.PI / 2, scale: new THREE.Vector3(360, 4.2, 9), color: ROCK })
      const bEnd = at(shore, pierLen + 60, 40 - 175)
      beacons.push({ position: new THREE.Vector3(bEnd.x, 2.5, bEnd.y), rotationY: 0, scale: new THREE.Vector3(2.4, 9, 2.4), color: new THREE.Color(0.95, 0.95, 0.92) })
      beacons.push({ position: new THREE.Vector3(bEnd.x, 11.5, bEnd.y), rotationY: 0, scale: new THREE.Vector3(2.0, 1.6, 2.0), color: new THREE.Color(0.8, 0.08, 0.05) })

      // Buildings on the land behind the pier
      let k = 0
      for (let row = 0; row < 3; row++) {
        for (let col = -3; col <= 3; col++) {
          const c = at(shore, -(35 + row * 26), col * 30 + (row % 2) * 12)
          const y = map.heightAt(c.x, c.y)
          if (y < 0.4 || !map.isLand(c.x, c.y)) continue
          const w = 11 + (k % 3) * 3, d = 7 + ((k * 7) % 4) * 2, hgt = 4.5 + (k % 2) * 2.5
          const rot = yaw + ((k * 37) % 7 - 3) * 0.06
          boxes.push({ position: new THREE.Vector3(c.x, y - 0.4, c.y), rotationY: rot, scale: new THREE.Vector3(w, hgt, d), color: WALLS[k % WALLS.length] })
          roofs.push({ position: new THREE.Vector3(c.x, y - 0.4 + hgt, c.y), rotationY: rot, scale: new THREE.Vector3(w * 1.05, 3.2, d * 1.05), color: ROOFS[k % ROOFS.length] })
          k++
        }
      }
    }

    return [instanced(unitBox, boxes), instanced(roofGeo, roofs), instanced(beaconGeo, beacons)]
  }, [map])

  return <>{meshes.map((m, i) => <primitive key={i} object={m} />)}</>
}
