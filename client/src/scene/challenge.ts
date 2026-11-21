import { useSyncExternalStore } from 'react'
import { telemetry } from './boat/telemetry'
import { fingerBerths, type Berth } from './harborLayout'

/**
 * A delivery run between the two harbours. The pickup is a finger in whichever
 * harbour the boat is nearer. Stopping beside the parcel, with the engines at
 * stop and the sails furled, puts it on the aft deck. The run then points at a
 * finger in the other harbour. Stopping there the same way sets the parcel
 * down and freezes the clock. Fingers buried in the shore, or with no open
 * side, are left out of the draw.
 */

export interface BoatSample {
  x: number
  z: number
  yaw: number
  speed: number
  sway: number
  yawRate: number
  /** Screws are out of the stop notch. */
  engines: boolean
  /** Main, jib, or spinnaker still has cloth out. */
  sails: boolean
}

export interface DockCargo {
  x: number
  y: number
  z: number
  rotationY: number
}

export interface ChallengeView {
  phase: 'idle' | 'pickup' | 'carry' | 'done'
  harborName: string
  startedAt: number
  finishedAt: number | null
  /** Finger to paint. The pickup while collecting, then the delivery. */
  target: Berth | null
  /** Where the parcel is drawn. */
  cargo: 'none' | 'dock' | 'deck'
  dockCargo: DockCargo | null
}

interface ChartSize {
  metersPerPixel: number
  width: number
  height: number
  harbors?: readonly { name: string; x?: number; z?: number }[]
  isLand?: (x: number, z: number) => boolean
  heightAt?: (x: number, z: number) => number
}

interface Ground {
  isLand(x: number, z: number): boolean
  heightAt(x: number, z: number): number
}

interface ChallengeRun {
  phase: 'pickup' | 'carry' | 'done'
  startedAt: number
  finishedAt: number | null
  pickup: Berth
  delivery: Berth | null
  dwell: number
  berths: readonly Berth[]
  rng: () => number
}

/** How long the hull must stay stopped beside the parcel. */
const DWELL = 0.5
/** Metres per second. About 0.4 kn, so a creep along the pontoon does not count. */
const STOP_SPEED = 0.22
const STOP_YAW = 0.12
/** Outboard of the dock face and still "right next to" it. */
const FACE_OUT = 2.4
/** A sample may sit slightly inside the pontoon box. The skin stops on the face. */
const FACE_IN = 1.4
/** Along the finger, how close a hull sample must be to the parcel. */
const ALONG_REACH = 2.8
/** Fraction of the finger length from the centre toward the tip. Clears the walkway. */
const PACKAGE_FRAC = 0.18

const STATIONS = [-6.2, -3, 0, 3, 6.2]
const BEAMS = [-1.8, 0, 1.8]

const IDLE: ChallengeView = {
  phase: 'idle',
  harborName: '',
  startedAt: 0,
  finishedAt: null,
  target: null,
  cargo: 'none',
  dockCargo: null,
}

let chartBerths: readonly Berth[] | null = null
let harborMarks: readonly { x?: number; z?: number }[] = []
let run: ChallengeRun | null = null
let view: ChallengeView = IDLE
const listeners = new Set<() => void>()

/** Ground above this, in metres, is shore or a bank. The pontoon deck is only 0.9 m tall. */
const SHORE = 0.15

function onShore(ground: Ground, x: number, z: number) {
  return ground.isLand(x, z) || ground.heightAt(x, z) > SHORE
}

/**
 * A finger the boat can use. The pontoon where she would lie is in the water,
 * and at least one side has open water out to the fairway. Land or a bank on
 * the dock, or on both approaches, leaves it out of the draw.
 */
export function berthReachable(berth: Berth, ground: Ground) {
  const parcel = packageAlong(berth)
  const limit = berth.length / 2 - 1
  const clamp = (along: number) => Math.min(limit, Math.max(-limit, along))
  for (let along = parcel - 7; along <= parcel + 7; along += 3.5) {
    const p = dockPoint(berth, clamp(along))
    if (onShore(ground, p.x, p.z)) return false
  }
  const face = berth.thickness / 2
  const sideClear = (side: 1 | -1) => {
    for (const along of [parcel - 5, parcel, parcel + 5]) {
      for (const off of [face + 4, face + 12, face + 20]) {
        const p = dockPoint(berth, clamp(along), side * off)
        if (onShore(ground, p.x, p.z)) return false
      }
    }
    return true
  }
  return sideClear(1) || sideClear(-1)
}

export function bindChallengeChart(map: ChartSize | null) {
  if (!map) {
    chartBerths = null
    harborMarks = []
    return
  }
  const berths = fingerBerths(map)
  const ground = map.isLand && map.heightAt
    ? { isLand: map.isLand.bind(map), heightAt: map.heightAt.bind(map) }
    : null
  chartBerths = ground ? berths.filter((berth) => berthReachable(berth, ground)) : berths
  harborMarks = map.harbors ?? []
}

/** Harbour whose marked centre, or the middle of its slips, is nearer the boat. */
export function nearestHarbor(berths: readonly Berth[], x: number, z: number, harbors: readonly { x?: number; z?: number }[] = []) {
  const ids = [...new Set(berths.map((berth) => berth.harbor))].sort((a, b) => a - b)
  let best = ids[0] ?? 0
  let bestD = Infinity
  for (const id of ids) {
    const named = harbors[id]
    let cx = named?.x
    let cz = named?.z
    if (typeof cx !== 'number' || typeof cz !== 'number') {
      const group = berths.filter((berth) => berth.harbor === id)
      cx = group.reduce((sum, berth) => sum + berth.x, 0) / group.length
      cz = group.reduce((sum, berth) => sum + berth.z, 0) / group.length
    }
    const d = Math.hypot(cx - x, cz - z)
    if (d < bestD) {
      bestD = d
      best = id
    }
  }
  return best
}

export function packageAlong(berth: Berth) {
  return berth.length * PACKAGE_FRAC
}

/** World point on the finger. `along` is toward the tip, `across` is to the finger's side. */
export function dockPoint(berth: Berth, along: number, across = 0) {
  const c = Math.cos(berth.rotationY)
  const s = Math.sin(berth.rotationY)
  return {
    x: berth.x + along * c + across * s,
    z: berth.z - along * s + across * c,
  }
}

export function packageWorld(berth: Berth): DockCargo {
  const p = dockPoint(berth, packageAlong(berth))
  return { x: p.x, y: berth.y + berth.height, z: p.z, rotationY: berth.rotationY }
}

export function berthEnds(berth: Berth) {
  const half = berth.length / 2
  const a = dockPoint(berth, -half)
  const b = dockPoint(berth, half)
  return { x0: a.x, z0: a.z, x1: b.x, z1: b.z }
}

/** A stopped hull lying parallel to the finger, just clear of the face, abreast of the parcel. */
export function alongsidePose(berth: Berth, side: 1 | -1 = 1) {
  const across = side * (berth.thickness / 2 + 2.6)
  const p = dockPoint(berth, packageAlong(berth), across)
  return { x: p.x, z: p.z, yaw: berth.rotationY + Math.PI / 2 }
}

function dockFrame(berth: Berth, x: number, z: number) {
  const dx = x - berth.x
  const dz = z - berth.z
  const c = Math.cos(berth.rotationY)
  const s = Math.sin(berth.rotationY)
  return { along: dx * c - dz * s, across: dx * s + dz * c }
}

/** True when the hull is against the parcel, stopped, with the screws at stop and the sails furled. */
export function besidePackage(berth: Berth, pose: BoatSample) {
  const moving = Math.hypot(pose.speed, pose.sway) > STOP_SPEED || Math.abs(pose.yawRate) > STOP_YAW
  if (moving || pose.engines || pose.sails) return false
  const c = Math.cos(pose.yaw)
  const s = Math.sin(pose.yaw)
  const face = berth.thickness / 2
  const parcel = packageAlong(berth)
  for (const lz of STATIONS) {
    for (const lx of BEAMS) {
      const x = pose.x + lx * c + lz * s
      const z = pose.z - lx * s + lz * c
      const local = dockFrame(berth, x, z)
      const off = Math.abs(local.across) - face
      if (off > FACE_OUT || off < -FACE_IN) continue
      if (Math.abs(local.along - parcel) > ALONG_REACH) continue
      return true
    }
  }
  return false
}

function pickBerth(berths: readonly Berth[], harbor: number, rng: () => number) {
  const pool = berths.filter((berth) => berth.harbor === harbor)
  if (pool.length === 0) return null
  const i = Math.min(pool.length - 1, Math.max(0, Math.floor(rng() * pool.length)))
  return pool[i]
}

function toView(current: ChallengeRun | null): ChallengeView {
  if (!current) return IDLE
  const target = current.phase === 'pickup' ? current.pickup : current.delivery
  return {
    phase: current.phase,
    harborName: target?.name ?? '',
    startedAt: current.startedAt,
    finishedAt: current.finishedAt,
    target,
    cargo: current.phase === 'carry' ? 'deck' : 'dock',
    dockCargo: target && current.phase !== 'carry' ? packageWorld(target) : null,
  }
}

function publish() {
  view = toView(run)
  for (const listener of listeners) listener()
}

export function getChallenge() {
  return view
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useChallenge() {
  return useSyncExternalStore(subscribe, getChallenge)
}

export function startChallenge(
  now = performance.now(),
  rng: () => number = Math.random,
  at: { x: number; z: number } = telemetry,
) {
  if (!chartBerths || chartBerths.length === 0) return false
  let harbor = nearestHarbor(chartBerths, at.x, at.z, harborMarks)
  let pickup = pickBerth(chartBerths, harbor, rng)
  if (!pickup) {
    const other = chartBerths.find((berth) => berth.harbor !== harbor)
    if (!other) return false
    harbor = other.harbor
    pickup = pickBerth(chartBerths, harbor, rng)
  }
  if (!pickup) return false
  run = {
    phase: 'pickup',
    startedAt: now,
    finishedAt: null,
    pickup,
    delivery: null,
    dwell: 0,
    berths: chartBerths,
    rng,
  }
  publish()
  return true
}

export function stepChallenge(pose: BoatSample, dt: number, now = performance.now()) {
  if (!run || run.phase === 'done') return
  const step = Math.min(Math.max(dt, 0), 0.1)
  const berth = run.phase === 'pickup' ? run.pickup : run.delivery
  if (berth && besidePackage(berth, pose)) run.dwell = Math.min(DWELL, run.dwell + step)
  else run.dwell = Math.max(0, run.dwell - step * 3)
  if (run.dwell < DWELL) return
  run.dwell = 0
  if (run.phase === 'pickup') {
    const delivery = pickBerth(run.berths, 1 - run.pickup.harbor, run.rng)
    if (!delivery) return
    run.delivery = delivery
    run.phase = 'carry'
  } else {
    run.phase = 'done'
    run.finishedAt = now
  }
  publish()
}

export function dismissChallenge() {
  if (!run) return
  run = null
  publish()
}

export function resetChallenge() {
  if (!run && view === IDLE) return
  run = null
  publish()
}

export function formatDuration(ms: number) {
  const total = Math.max(0, Math.round(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  const parts: string[] = []
  if (hours > 0) parts.push(unit(hours, 'hour'))
  if (minutes > 0) parts.push(unit(minutes, 'minute'))
  if (seconds > 0 || parts.length === 0) parts.push(unit(seconds, 'second'))
  return parts.join(' ')
}

function unit(n: number, word: string) {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}
