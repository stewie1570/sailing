import { useMemo } from 'react'
import * as THREE from 'three'
import type { MapData } from '../map/mapData'
import { BEACON_COLUMN, BEACON_LAMP, BEACONS, BUILDING_SINK, ROOF_CONE_RADIUS, ROOF_PAD, chartToWorld, dockBoxes, roofHeight, townBuildings } from './harborLayout'

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
    const roofGeo = new THREE.ConeGeometry(ROOF_CONE_RADIUS, 1, 4, 1)
    roofGeo.rotateY(Math.PI / 4)
    roofGeo.translate(0, 0.5, 0)
    const beaconGeo = new THREE.CylinderGeometry(BEACON_COLUMN.radiusTop, BEACON_COLUMN.radiusBottom, 1, 10, 1)
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
      beacons.push({
        position: chartToWorld(map, bx, by, BEACON_COLUMN.baseY),
        rotationY: 0,
        scale: new THREE.Vector3(BEACON_COLUMN.xz, BEACON_COLUMN.height, BEACON_COLUMN.xz),
        color: new THREE.Color(0.95, 0.95, 0.92),
      })
      beacons.push({
        position: chartToWorld(map, bx, by, BEACON_LAMP.baseY),
        rotationY: 0,
        scale: new THREE.Vector3(BEACON_LAMP.xz, BEACON_LAMP.height, BEACON_LAMP.xz),
        color: new THREE.Color(0.8, 0.08, 0.05),
      })
    }

    for (const b of townBuildings(map)) {
      const roofH = roofHeight(b.shed)
      boxes.push({
        position: new THREE.Vector3(b.x, b.ground - BUILDING_SINK, b.z),
        rotationY: b.rotationY,
        scale: new THREE.Vector3(b.w, b.h, b.d),
        color: WALLS[b.k % WALLS.length],
      })
      roofs.push({
        position: new THREE.Vector3(b.x, b.ground - BUILDING_SINK + b.h, b.z),
        rotationY: b.rotationY,
        scale: new THREE.Vector3(b.w * ROOF_PAD, roofH, b.d * ROOF_PAD),
        color: ROOFS[b.k % ROOFS.length],
      })
    }

    return [instanced(unitBox, boxes), instanced(roofGeo, roofs), instanced(beaconGeo, beacons)].filter((m): m is THREE.InstancedMesh => m !== null)
  }, [map])

  return <>{meshes.map((m, i) => <primitive key={i} object={m} />)}</>
}
