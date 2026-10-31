import { useMemo } from 'react'
import * as THREE from 'three'
import type { MapData } from '../map/mapData'

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

/** Chart pixel (image x east, image y south) to world metres. */
function chart(map: MapData, px: number, py: number, y: number) {
  const m = map.metersPerPixel
  return new THREE.Vector3((px - map.width / 2) * m, y, (py - map.height / 2) * m)
}

type Kind = 'mole' | 'deck' | 'finger'

interface Segment {
  x0: number
  y0: number
  x1: number
  y1: number
  /** Thickness across the segment, in metres. Length follows the chart. */
  thickness: number
  kind: Kind
}

/**
 * Marina plans traced from tools/mapgen/source-map.jpg, in chart pixels.
 * Each harbour is a sheltered basin: a concrete mole around an entrance, and two
 * banks of finger pontoons rather than a single pier running straight offshore.
 * Lengths are the painted ones (the chart draws the docks large); thickness is
 * tightened so a finger reads as a dock up close.
 */
const MOLE = 34
const WALK = 14
const FINGER = 8.5

const MARINAS: { segments: Segment[]; combs: Comb[]; beacon: [number, number]; basin: [number, number] }[] = [
  {
    // West Harbor — entrance faces east, toward the channel buoys.
    basin: [108, 246],
    beacon: [143, 232],
    segments: [
      { x0: 80, y0: 208, x1: 138, y1: 211, thickness: MOLE, kind: 'mole' },
      { x0: 138, y0: 211, x1: 144, y1: 232, thickness: MOLE, kind: 'mole' },
      { x0: 78, y0: 208, x1: 74, y1: 262, thickness: MOLE, kind: 'mole' },
      { x0: 74, y0: 262, x1: 120, y1: 284, thickness: MOLE, kind: 'mole' },
      { x0: 120, y0: 284, x1: 148, y1: 254, thickness: MOLE, kind: 'mole' },
    ],
    combs: [
      { x0: 100, y0: 230, x1: 134, y1: 224, spacing: 5.2, length: 7.6, inset: 3.2, sides: [1, -1] },
      { x0: 96, y0: 248, x1: 124, y1: 258, spacing: 5.4, length: 7.2, inset: 3, sides: [1, -1] },
      { x0: 124, y0: 258, x1: 130, y1: 268, spacing: 5, length: 6.4, inset: 2.4, sides: [1] },
    ],
  },
  {
    // East Harbor — entrance faces west, between the two mole heads.
    basin: [880, 538],
    beacon: [828, 522],
    segments: [
      { x0: 824, y0: 524, x1: 846, y1: 512, thickness: 42, kind: 'mole' },
      { x0: 846, y0: 512, x1: 912, y1: 498, thickness: MOLE, kind: 'mole' },
      { x0: 846, y0: 576, x1: 912, y1: 564, thickness: MOLE, kind: 'mole' },
      { x0: 912, y0: 500, x1: 918, y1: 570, thickness: MOLE, kind: 'mole' },
    ],
    combs: [
      { x0: 858, y0: 528, x1: 904, y1: 522, spacing: 5.4, length: 8.2, inset: 3, sides: [1, -1] },
      { x0: 856, y0: 550, x1: 906, y1: 546, spacing: 5.4, length: 8, inset: 3, sides: [1, -1] },
    ],
  },
]

interface Comb {
  x0: number
  y0: number
  x1: number
  y1: number
  /** Centre-to-centre spacing along the walkway, in chart pixels. */
  spacing: number
  /** How far each finger runs out from the walkway, in chart pixels. */
  length: number
  inset: number
  /** +1 is the left normal of the walkway (image y-down), -1 the other side. */
  sides: (1 | -1)[]
}

/** Which way a one-sided comb should point so its fingers stay inside the basin. */
function sideToward(comb: Comb, tx: number, ty: number): 1 | -1 {
  const dx = comb.x1 - comb.x0
  const dy = comb.y1 - comb.y0
  const mx = (comb.x0 + comb.x1) / 2
  const my = (comb.y0 + comb.y1) / 2
  const dot = -dy * (tx - mx) + dx * (ty - my)
  return dot >= 0 ? 1 : -1
}

const TOWNS = [
  { x0: 46, y0: 176, x1: 80, y1: 238, step: 9 },
  { x0: 926, y0: 508, x1: 972, y1: 570, step: 9.5 },
]

/**
 * Harbours taken from the painted chart: an enclosed mole, two (or, at West Harbor,
 * an upper bank plus a lower L) of finger pontoons, and the shore town beside the basin.
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

    const push = (seg: Segment) => {
      const dx = seg.x1 - seg.x0
      const dy = seg.y1 - seg.y0
      const lenPx = Math.hypot(dx, dy)
      if (lenPx < 0.4) return
      // Overlap the joints so mole corners and finger roots don't show a gap.
      const lenM = lenPx * map.metersPerPixel + (seg.kind === 'finger' ? 1.5 : 6)
      const mole = seg.kind === 'mole'
      boxes.push({
        position: chart(map, (seg.x0 + seg.x1) / 2, (seg.y0 + seg.y1) / 2, mole ? -1.5 : 0.2),
        rotationY: -Math.atan2(dy, dx),
        scale: new THREE.Vector3(lenM, mole ? 4.3 : 0.7, seg.thickness),
        color: mole ? ROCK : seg.kind === 'deck' ? DECK : PONTOON,
      })
    }

    for (const marina of MARINAS) {
      for (const seg of marina.segments) push(seg)
      for (const comb of marina.combs) {
        push({ ...comb, thickness: WALK, kind: 'deck' })
        const dx = comb.x1 - comb.x0
        const dy = comb.y1 - comb.y0
        const len = Math.hypot(dx, dy)
        const ux = dx / len
        const uy = dy / len
        const nx = -uy
        const ny = ux
        const sides = comb.sides.length === 1 ? [sideToward(comb, marina.basin[0], marina.basin[1])] : comb.sides
        for (let d = comb.inset; d <= len - comb.inset + 0.01; d += comb.spacing) {
          const cx = comb.x0 + ux * d
          const cy = comb.y0 + uy * d
          for (const s of sides) {
            push({
              x0: cx,
              y0: cy,
              x1: cx + nx * s * comb.length,
              y1: cy + ny * s * comb.length,
              thickness: FINGER,
              kind: 'finger',
            })
          }
        }
      }
      const [bx, by] = marina.beacon
      beacons.push({ position: chart(map, bx, by, 2.6), rotationY: 0, scale: new THREE.Vector3(3.2, 11, 3.2), color: new THREE.Color(0.95, 0.95, 0.92) })
      beacons.push({ position: chart(map, bx, by, 13.6), rotationY: 0, scale: new THREE.Vector3(2.4, 2.2, 2.4), color: new THREE.Color(0.8, 0.08, 0.05) })
    }

    let k = 0
    for (const town of TOWNS) {
      for (let py = town.y0; py <= town.y1; py += town.step) {
        for (let px = town.x0; px <= town.x1; px += town.step) {
          const jx = px + ((k * 5) % 4) * 0.45
          const jz = py + ((k * 3) % 5) * 0.35
          const c = chart(map, jx, jz, 0)
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
