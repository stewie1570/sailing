import { useMemo } from 'react'
import * as THREE from 'three'
import type { MapData } from '../map/mapData'
import { BEACONS, chartToWorld, dockBoxes } from './harborLayout'

const DECK = new THREE.Color(0.73, 0.69, 0.6)
const PONTOON = new THREE.Color(0.9, 0.9, 0.86)
const ROCK = new THREE.Color(0.62, 0.55, 0.45)
const WALLS = [new THREE.Color(0.85, 0.82, 0.74), new THREE.Color(0.7, 0.68, 0.6), new THREE.Color(0.6, 0.35, 0.25)]
const ROOFS = [new THREE.Color(0.55, 0.18, 0.12), new THREE.Color(0.3, 0.32, 0.36), new THREE.Color(0.45, 0.25, 0.15)]

interface Placement { position: THREE.Vector3; rotationY: number; scale: THREE.Vector3; color: THREE.Color }

function instanced(geometry: THREE.BufferGeometry, placements: Placement[]): THREE.InstancedMesh | null {
  if (placements.length === 0) return null
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

const TOWNS = [
  { x0: 46, y0: 176, x1: 80, y1: 238, step: 9 },
  { x0: 926, y0: 508, x1: 972, y1: 570, step: 9.5 },
]

/**
 * Harbours taken from the painted chart: an enclosed mole, finger pontoons,
 * and the shore town beside the basin.
 */
export function Harbors({ map }: { map: MapData }) {
  const meshes = useMemo(() => {
    const boxes: Placement[] = []
    const roofs: Placement[] = []
    const beacons: Placement[] = []

    const unitBox = new THREE.BoxGeometry(1, 1, 1)
    unitBox.translate(0, 0.5, 0)
    const roofGeo = new THREE.ConeGeometry(0.72, 1, 4, 1)
    roofGeo.rotateY(Math.PI / 4)
    roofGeo.translate(0, 0.5, 0)
    const beaconGeo = new THREE.CylinderGeometry(0.7, 1.0, 1, 10, 1)
    beaconGeo.translate(0, 0.5, 0)

    for (const box of dockBoxes(map)) {
      const color = box.kind === 'mole' ? ROCK : box.kind === 'deck' ? DECK : PONTOON
      boxes.push({
        position: new THREE.Vector3(box.x, box.y, box.z),
        rotationY: box.rotationY,
        scale: new THREE.Vector3(box.length, box.height, box.thickness),
        color,
      })
    }

    for (const [bx, by] of BEACONS) {
      beacons.push({ position: chartToWorld(map, bx, by, 2.6), rotationY: 0, scale: new THREE.Vector3(3.2, 11, 3.2), color: new THREE.Color(0.95, 0.95, 0.92) })
      beacons.push({ position: chartToWorld(map, bx, by, 13.6), rotationY: 0, scale: new THREE.Vector3(2.4, 2.2, 2.4), color: new THREE.Color(0.8, 0.08, 0.05) })
    }

    let k = 0
    for (const town of TOWNS) {
      for (let py = town.y0; py <= town.y1; py += town.step) {
        for (let px = town.x0; px <= town.x1; px += town.step) {
          const jx = px + ((k * 5) % 4) * 0.45
          const jz = py + ((k * 3) % 5) * 0.35
          const c = chartToWorld(map, jx, jz, 0)
          const ground = map.heightAt(c.x, c.z)
          if (ground < 0.5 || !map.isLand(c.x, c.z)) { k++; continue }
          const shed = k % 8 === 0
          const w = (shed ? 22 : 12) + (k % 3) * 3
          const d = (shed ? 14 : 8) + ((k * 7) % 4) * 2
          const h = (shed ? 7 : 4.5) + (k % 3) * 1.4
          const rot = ((k * 37) % 9 - 4) * 0.08
          boxes.push({ position: new THREE.Vector3(c.x, ground - 0.3, c.z), rotationY: rot, scale: new THREE.Vector3(w, h, d), color: WALLS[k % WALLS.length] })
          roofs.push({ position: new THREE.Vector3(c.x, ground - 0.3 + h, c.z), rotationY: rot, scale: new THREE.Vector3(w * 1.08, shed ? 3.6 : 2.8, d * 1.08), color: ROOFS[k % ROOFS.length] })
          k++
        }
      }
    }

    return [instanced(unitBox, boxes), instanced(roofGeo, roofs), instanced(beaconGeo, beacons)].filter((m): m is THREE.InstancedMesh => m !== null)
  }, [map])

  return <>{meshes.map((m, i) => <primitive key={i} object={m} />)}</>
}
