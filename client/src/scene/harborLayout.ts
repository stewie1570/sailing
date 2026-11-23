import * as THREE from 'three'
import type { MapData } from '../map/mapData'
import { FERRY_BEAM, FERRY_LOA, SAIL_BEAM, SAIL_LOA, type VesselKind } from './boat/vessel'

const WALK = 14
const FINGER = 8.5
/** Painted chart. Ferry landings are sized in metres and placed in these pixels. */
export const CHART_MPP = 7.766666666666667

type Kind = 'mole' | 'deck' | 'finger'

interface Segment {
  x0: number
  y0: number
  x1: number
  y1: number
  thickness: number
  kind: Kind
}

interface Comb {
  x0: number
  y0: number
  x1: number
  y1: number
  spacing: number
  length: number
  inset: number
  sides: (1 | -1)[]
}

const MARINAS: { segments: Segment[]; combs: Comb[]; beacon: [number, number]; basin: [number, number] }[] = [
  {
    basin: [110, 242],
    beacon: [132, 208],
    // Traced from the painted west basin. The north arm and its hook, then the
    // south breakwater, with the two finger rows sitting in the slips.
    segments: [
      { x0: 92, y0: 207, x1: 136, y1: 207, thickness: 34, kind: 'mole' },
      { x0: 132, y0: 207, x1: 134, y1: 224, thickness: 30, kind: 'mole' },
      { x0: 98, y0: 274, x1: 124, y1: 278, thickness: 30, kind: 'mole' },
      { x0: 124, y0: 278, x1: 150, y1: 266, thickness: 28, kind: 'mole' },
    ],
    combs: [
      { x0: 92, y0: 227, x1: 116, y1: 227, spacing: 4.4, length: 5.2, inset: 1.8, sides: [1, -1] },
      { x0: 92, y0: 253, x1: 112, y1: 255, spacing: 4.4, length: 5.6, inset: 1.8, sides: [1, -1] },
    ],
  },
  {
    basin: [876, 534],
    beacon: [820, 506],
    segments: [
      { x0: 816, y0: 498, x1: 828, y1: 516, thickness: 32, kind: 'mole' },
      { x0: 848, y0: 500, x1: 902, y1: 498, thickness: 26, kind: 'mole' },
      { x0: 904, y0: 502, x1: 908, y1: 556, thickness: 22, kind: 'mole' },
      { x0: 844, y0: 568, x1: 904, y1: 566, thickness: 30, kind: 'mole' },
    ],
    combs: [
      { x0: 860, y0: 523, x1: 894, y1: 523, spacing: 4.6, length: 5.4, inset: 2, sides: [1, -1] },
      { x0: 860, y0: 547, x1: 894, y1: 547, spacing: 4.6, length: 5.4, inset: 2, sides: [1, -1] },
    ],
  },
]

/** Water inside each basin, in chart pixels. The chart paints this before the docks. */
export const HARBOR_BASINS: [number, number][][] = [
  [[82, 214], [134, 214], [138, 232], [146, 252], [136, 268], [118, 276], [96, 270], [90, 248], [76, 242], [73, 234], [74, 220], [78, 216]],
  [[834, 512], [848, 504], [902, 502], [914, 508], [914, 532], [908, 556], [900, 566], [844, 564], [828, 520]],
]

function insidePolygon(x: number, y: number, poly: readonly (readonly [number, number])[]) {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0]
    const yi = poly[i][1]
    const xj = poly[j][0]
    const yj = poly[j][1]
    const cross = (yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi
    if (cross) inside = !inside
  }
  return inside
}

/** True when this world position is in a marina basin. The open lake is not a harbor. */
export function inHarbor(map: MapData, x: number, z: number) {
  const [px, py] = map.toPixel(x, z)
  for (const basin of HARBOR_BASINS) {
    if (insidePolygon(px, py, basin)) return true
  }
  return false
}

function sideToward(comb: Comb, tx: number, ty: number): 1 | -1 {
  const dx = comb.x1 - comb.x0
  const dy = comb.y1 - comb.y0
  const mx = (comb.x0 + comb.x1) / 2
  const my = (comb.y0 + comb.y1) / 2
  const dot = -dy * (tx - mx) + dx * (ty - my)
  return dot >= 0 ? 1 : -1
}

export interface HarborPiece {
  /** Chart pixels. Row 0 is north. */
  x0: number
  y0: number
  x1: number
  y1: number
  /** Metres across the piece. */
  thickness: number
  kind: Kind
  /** Index into the marina list. 0 is west, 1 is east, matching the chart harbors. */
  harbor: number
  /** A sail finger a sloop can lie against. Linkspan wings are not slips. */
  slip?: 'sail'
}

interface FingerSpot {
  /** Walkway end of the finger, chart pixels. */
  bx: number
  by: number
  /** Tip, chart pixels. */
  tx: number
  ty: number
  /** Unit normal from the walkway toward the tip, chart axes. */
  nx: number
  ny: number
  side: 1 | -1
}

interface CombFrame {
  ux: number
  uy: number
  nx: number
  ny: number
  len: number
  sides: (1 | -1)[]
  along: number[]
}

function combFrame(comb: Comb, basin: [number, number]): CombFrame {
  const dx = comb.x1 - comb.x0
  const dy = comb.y1 - comb.y0
  const len = Math.hypot(dx, dy) || 1
  const ux = dx / len
  const uy = dy / len
  const sides = comb.sides.length === 1 ? [sideToward(comb, basin[0], basin[1])] : comb.sides
  const along: number[] = []
  for (let d = comb.inset; d <= len - comb.inset + 0.01; d += comb.spacing) along.push(d)
  return { ux, uy, nx: -uy, ny: ux, len, sides, along }
}

function combFingers(comb: Comb, basin: [number, number]): FingerSpot[] {
  const frame = combFrame(comb, basin)
  const out: FingerSpot[] = []
  for (const d of frame.along) {
    const bx = comb.x0 + frame.ux * d
    const by = comb.y0 + frame.uy * d
    for (const side of frame.sides) {
      out.push({
        bx,
        by,
        tx: bx + frame.nx * side * comb.length,
        ty: by + frame.ny * side * comb.length,
        nx: frame.nx * side,
        ny: frame.ny * side,
        side,
      })
    }
  }
  return out
}

/**
 * End-on linkspan. `ax, ay` is the direction a ferry approaches from, in chart
 * pixels (unit). Slips sit in a row along `bx, by`. Sizes are metres.
 */
interface Terminal {
  id: string
  /** Same index as the marina this landing sits in. */
  harbor: number
  x: number
  y: number
  ax: number
  ay: number
  bx: number
  by: number
  count: number
  clearWidth: number
  clearLength: number
  wall: number
}

const FERRY_CLEAR_W = 18
const FERRY_CLEAR_L = 56
const FERRY_WALL = 8

/**
 * The quay runs along the shore opposite the inlet: the town shore on the
 * west side of West Harbor, and the town shore on the east side of East
 * Harbor. The ferry approaches from the water inside the basin.
 */
const TERMINALS: Terminal[] = [
  {
    id: 'west',
    harbor: 0,
    x: 77,
    y: 227,
    ax: 0.9554,
    ay: 0.2953,
    bx: -0.2953,
    by: 0.9554,
    count: 7,
    clearWidth: FERRY_CLEAR_W,
    clearLength: FERRY_CLEAR_L,
    wall: FERRY_WALL,
  },
  {
    id: 'east',
    harbor: 1,
    x: 905,
    y: 529,
    ax: -0.9973,
    ay: 0.0739,
    bx: 0.0739,
    by: 0.9973,
    count: 15,
    clearWidth: FERRY_CLEAR_W,
    clearLength: FERRY_CLEAR_L,
    wall: FERRY_WALL,
  },
]

function terminalPieces(terminal: Terminal, mpp: number): HarborPiece[] {
  const pitch = terminal.clearWidth + terminal.wall
  const span = terminal.count * pitch + terminal.wall
  const headMetres = span - 6
  const wingMetres = terminal.clearLength - 1.5
  const px = (metres: number) => metres / mpp
  const headHalf = px(headMetres) / 2
  const out: HarborPiece[] = [{
    x0: terminal.x - terminal.bx * headHalf,
    y0: terminal.y - terminal.by * headHalf,
    x1: terminal.x + terminal.bx * headHalf,
    y1: terminal.y + terminal.by * headHalf,
    thickness: terminal.wall,
    kind: 'deck',
    harbor: terminal.harbor,
  }]
  const along = px(terminal.wall / 2 + terminal.clearLength / 2)
  const wingHalf = px(wingMetres) / 2
  for (let i = 0; i <= terminal.count; i++) {
    const offset = (i - terminal.count / 2) * pitch
    const cx = terminal.x + terminal.bx * px(offset) + terminal.ax * along
    const cy = terminal.y + terminal.by * px(offset) + terminal.ay * along
    out.push({
      x0: cx - terminal.ax * wingHalf,
      y0: cy - terminal.ay * wingHalf,
      x1: cx + terminal.ax * wingHalf,
      y1: cy + terminal.ay * wingHalf,
      thickness: terminal.wall,
      kind: 'finger',
      harbor: terminal.harbor,
    })
  }
  return out
}

/** Moles, walkways, sail fingers and ferry linkspans. The meshes, the collision and the chart share this list. */
export function harborPieces(metersPerPixel = CHART_MPP): HarborPiece[] {
  const out: HarborPiece[] = []
  MARINAS.forEach((marina, harbor) => {
    for (const seg of marina.segments) out.push({ ...seg, harbor })
    for (const comb of marina.combs) {
      out.push({ x0: comb.x0, y0: comb.y0, x1: comb.x1, y1: comb.y1, thickness: WALK, kind: 'deck', harbor })
      for (const finger of combFingers(comb, marina.basin)) {
        out.push({
          x0: finger.bx,
          y0: finger.by,
          x1: finger.tx,
          y1: finger.ty,
          thickness: FINGER,
          kind: 'finger',
          harbor,
          slip: 'sail',
        })
      }
    }
  })
  for (const terminal of TERMINALS) out.push(...terminalPieces(terminal, metersPerPixel))
  return out
}

export interface Slip {
  id: string
  kind: VesselKind
  /** Chart-pixel centre of the hull when it is lying in the slip. */
  px: number
  py: number
  /** World yaw. The bow points out of a sail slip, and into a ferry linkspan. */
  yaw: number
  /** Clear water, metres. Long enough and wide enough for that hull. */
  length: number
  width: number
}

function bowYaw(nx: number, ny: number) {
  // Bow world (sin yaw, cos yaw) follows a chart direction: +x east, +y south.
  return Math.atan2(nx, ny)
}

/** Sail slips are the water between adjacent fingers. Ferry slips are the linkspan pockets. */
export function berths(metersPerPixel = CHART_MPP): Slip[] {
  const out: Slip[] = []
  for (const marina of MARINAS) {
    marina.combs.forEach((comb, combIndex) => {
      const frame = combFrame(comb, marina.basin)
      const width = comb.spacing * metersPerPixel - FINGER
      const length = comb.length * metersPerPixel
      frame.sides.forEach((side, sideIndex) => {
        const spots = frame.along
        for (let i = 0; i < spots.length - 1; i++) {
          const d = (spots[i] + spots[i + 1]) / 2
          const bx = comb.x0 + frame.ux * d
          const by = comb.y0 + frame.uy * d
          const reach = comb.length * 0.55
          const nx = frame.nx * side
          const ny = frame.ny * side
          out.push({
            id: `sail-${comb.x0}-${comb.y0}-${sideIndex}-${i}-${combIndex}`,
            kind: 'sail',
            px: bx + nx * reach,
            py: by + ny * reach,
            yaw: bowYaw(nx, ny),
            length,
            width,
          })
        }
      })
    })
  }
  const pitch = FERRY_CLEAR_W + FERRY_WALL
  for (const terminal of TERMINALS) {
    const along = (terminal.wall / 2 + terminal.clearLength / 2) / metersPerPixel
    for (let i = 0; i < terminal.count; i++) {
      const offset = (i - (terminal.count - 1) / 2) * pitch / metersPerPixel
      out.push({
        id: `ferry-${terminal.id}-${i}`,
        kind: 'ferry',
        px: terminal.x + terminal.bx * offset + terminal.ax * along,
        py: terminal.y + terminal.by * offset + terminal.ay * along,
        // Made fast bow-in: the bow points at the linkspan, opposite the approach.
        yaw: bowYaw(-terminal.ax, -terminal.ay),
        length: terminal.clearLength,
        width: terminal.clearWidth,
      })
    }
  }
  return out
}

export function berthsFor(kind: VesselKind, metersPerPixel = CHART_MPP): Slip[] {
  return berths(metersPerPixel).filter((berth) => berth.kind === kind)
}

/**
 * One slip of this class. Challenges draw from this so a sloop is not sent to
 * a linkspan, and a ferry is not sent into a finger gap.
 */
export function randomBerth(kind: VesselKind, random: () => number = Math.random, metersPerPixel = CHART_MPP): Slip {
  const list = berthsFor(kind, metersPerPixel)
  const index = Math.min(list.length - 1, Math.max(0, Math.floor(random() * list.length)))
  return list[index]
}

/** The slip is big enough for that hull, with water left on every side. */
export function berthFits(berth: Slip) {
  if (berth.kind === 'ferry') return berth.length >= FERRY_LOA + 4 && berth.width >= FERRY_BEAM + 4
  return berth.length >= SAIL_LOA + 4 && berth.width >= SAIL_BEAM + 4
}

/**
 * A dock a hull stops against. Local +X runs along the piece. Fingers run
 * from the walkway toward the tip. A linkspan head runs along the row of slips.
 */
export interface Berth {
  harbor: number
  name: string
  x: number
  z: number
  y: number
  rotationY: number
  length: number
  height: number
  thickness: number
}

interface ChartSize {
  metersPerPixel: number
  width: number
  height: number
  harbors?: readonly { name: string }[]
}

function pieceBerth(seg: HarborPiece, map: ChartSize, lengthBonus: number): Berth | null {
  const dx = seg.x1 - seg.x0
  const dy = seg.y1 - seg.y0
  const lenPx = Math.hypot(dx, dy)
  if (lenPx < 0.4) return null
  const m = map.metersPerPixel
  const cx = (seg.x0 + seg.x1) / 2
  const cy = (seg.y0 + seg.y1) / 2
  return {
    harbor: seg.harbor,
    name: map.harbors?.[seg.harbor]?.name ?? 'Harbor',
    x: (cx - map.width / 2) * m,
    z: (cy - map.height / 2) * m,
    y: 0.2,
    rotationY: -Math.atan2(dy, dx),
    length: lenPx * m + lengthBonus,
    height: 0.7,
    thickness: seg.thickness,
  }
}

/** Finger pontoons a sloop can lie alongside. Same world box as the finger meshes. */
export function fingerBerths(map: ChartSize): Berth[] {
  const out: Berth[] = []
  for (const seg of harborPieces(map.metersPerPixel)) {
    if (seg.slip !== 'sail') continue
    const berth = pieceBerth(seg, map, 1.5)
    if (berth) out.push(berth)
  }
  return out
}

/**
 * The linkspan head of each ferry slip. The hull noses up to this face.
 * One per pocket, so a challenge can pick a single berth in either basin.
 */
export function linkspanBerths(map: ChartSize): Berth[] {
  const out: Berth[] = []
  const m = map.metersPerPixel
  const pitch = FERRY_CLEAR_W + FERRY_WALL
  for (const terminal of TERMINALS) {
    for (let i = 0; i < terminal.count; i++) {
      const offset = (i - (terminal.count - 1) / 2) * pitch
      const hx = terminal.x + terminal.bx * (offset / m)
      const hy = terminal.y + terminal.by * (offset / m)
      out.push({
        harbor: terminal.harbor,
        name: map.harbors?.[terminal.harbor]?.name ?? 'Harbor',
        x: (hx - map.width / 2) * m,
        z: (hy - map.height / 2) * m,
        y: 0.2,
        rotationY: -Math.atan2(terminal.by, terminal.bx),
        length: terminal.clearWidth,
        height: 0.7,
        thickness: terminal.wall,
      })
    }
  }
  return out
}

export interface DockBox {
  /** Centre, in world metres. Local +X runs along the length. */
  x: number
  z: number
  y: number
  rotationY: number
  length: number
  height: number
  thickness: number
  kind: Kind
}

/** World-space dock, walkway and finger boxes. Shared by the harbour meshes and the boat collision. */
export function dockBoxes(map: MapData): DockBox[] {
  const out: DockBox[] = []
  const m = map.metersPerPixel
  for (const seg of harborPieces(map.metersPerPixel)) {
    const dx = seg.x1 - seg.x0
    const dy = seg.y1 - seg.y0
    const lenPx = Math.hypot(dx, dy)
    if (lenPx < 0.4) continue
    const length = lenPx * m + (seg.kind === 'finger' ? 1.5 : 6)
    const mole = seg.kind === 'mole'
    const cx = (seg.x0 + seg.x1) / 2
    const cy = (seg.y0 + seg.y1) / 2
    out.push({
      x: (cx - map.width / 2) * m,
      z: (cy - map.height / 2) * m,
      y: mole ? -1.5 : 0.2,
      rotationY: -Math.atan2(dy, dx),
      length,
      height: mole ? 4.3 : 0.7,
      thickness: seg.thickness,
      kind: seg.kind,
    })
  }
  return out
}

export function chartToWorld(map: MapData, px: number, py: number, y = 0) {
  const m = map.metersPerPixel
  return new THREE.Vector3((px - map.width / 2) * m, y, (py - map.height / 2) * m)
}

/** Beacon bases, in chart pixels. The column stands on the mole head. */
export const BEACONS: [number, number][] = MARINAS.map((h) => h.beacon)

/**
 * Unit cylinder (radius 1 at the base, 0.7 at the top, height 1) scaled into the column and the lamp.
 * World radius is the unit radius times `xz`.
 */
export const BEACON_COLUMN = { radiusBottom: 1, radiusTop: 0.7, baseY: 2.6, height: 11, xz: 3.2 }
export const BEACON_LAMP = { radiusBottom: 1, radiusTop: 0.7, baseY: 13.6, height: 2.2, xz: 2.4 }

const TOWNS = [
  { x0: 46, y0: 176, x1: 80, y1: 238, step: 9 },
  { x0: 926, y0: 508, x1: 972, y1: 570, step: 9.5 },
]

export interface TownBuilding {
  k: number
  x: number
  z: number
  ground: number
  rotationY: number
  w: number
  d: number
  h: number
  shed: boolean
}

/** How far the wall mesh is sunk into the ground so the foundation doesn't float. */
export const BUILDING_SINK = 0.3
/** ConeGeometry radius of the hip roof, in the unscaled mesh. */
export const ROOF_CONE_RADIUS = 0.72
export const ROOF_PAD = 1.08

export function roofHeight(shed: boolean) {
  return shed ? 3.6 : 2.8
}

/** Shore buildings. The same list drives the meshes and the collision boxes. */
export function townBuildings(map: MapData): TownBuilding[] {
  const out: TownBuilding[] = []
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
        out.push({
          k,
          x: c.x,
          z: c.z,
          ground,
          rotationY: ((k * 37) % 9 - 4) * 0.08,
          w: (shed ? 22 : 12) + (k % 3) * 3,
          d: (shed ? 14 : 8) + ((k * 7) % 4) * 2,
          h: (shed ? 7 : 4.5) + (k % 3) * 1.4,
          shed,
        })
        k++
      }
    }
  }
  return out
}
