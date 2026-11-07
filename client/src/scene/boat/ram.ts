/**
 * Two helms in one room. The hull that is going forward into the other keeps
 * the water. The hull it drove into sinks onto the lakebed and comes back at
 * the berth it spawned on.
 *
 * Each helm decides for its own boat. The one that was hit reads the claim on
 * the rammer's pose, because the rammer's speed has already been taken off by
 * the time that pose arrives.
 */

/** Forward way, metres per second, before a bow counts as driving into someone. */
const RAM_WAY = 0.7
/** Bow must face the other hull at least this squarely. 1 is dead ahead, 0 is abeam. */
const RAM_AIM = 0.42
/** A published pose this close still counts as the hit. The rammer stops just short of the skin, and the packet is a little late. */
export const RAM_TOUCH = 2.5
/** Without a claim, their bow has to actually be against us. */
const RAM_CLOSE = 0.5

export const SINK_SECONDS = 3.2
export const WRECK_REST_SECONDS = 0.6
export const RAM_CLAIM_MS = 2200
export const RESPAWN_SAFE_MS = 1800

export interface RamHull {
  x: number
  z: number
  yaw: number
  /** Surge, metres per second, positive ahead. */
  speed: number
}

/**
 * How hard this bow is driving into the other hull, in metres per second.
 * Zero when the boat is not going forward, or the bow is not the side facing them.
 */
export function bowInto(self: RamHull, other: RamHull): number {
  if (!(self.speed >= RAM_WAY)) return 0
  const dx = other.x - self.x
  const dz = other.z - self.z
  const dist = Math.hypot(dx, dz)
  if (!(dist > 0.05)) return 0
  const aim = Math.sin(self.yaw) * (dx / dist) + Math.cos(self.yaw) * (dz / dist)
  if (aim < RAM_AIM) return 0
  return self.speed * aim
}

export type RamWinner = 'self' | 'other' | 'both' | 'none'

/**
 * Who is crashing into whom. The boat going forward into the other wins, and
 * the other sinks. A dead-even bow-to-bow hit sinks both. A faster bow wins a
 * head-on crash that is not that close.
 */
export function ramWinner(self: RamHull, other: RamHull): RamWinner {
  const mine = bowInto(self, other)
  const theirs = bowInto(other, self)
  const iWin = mine > 0
  const theyWin = theirs > 0
  if (iWin && theyWin) {
    if (mine > theirs * 1.35 && mine > theirs + 0.45) return 'self'
    if (theirs > mine * 1.35 && theirs > mine + 0.45) return 'other'
    return 'both'
  }
  if (iWin) return 'self'
  if (theyWin) return 'other'
  return 'none'
}

export interface RamContact {
  id: string
  x: number
  z: number
  yaw: number
  speed: number
  /** Metres between the outlines. Zero when they overlap. */
  gap: number
  /** Our own step was refused because it entered this hull. */
  pushed: boolean
  /** Who they say they are ramming. Empty when they claim nobody. */
  ram: string
  /** Already going down, so this is not a new crash. */
  sinking: boolean
}

export interface RamDecision {
  sink: boolean
  /** Sailor to name on our pose, or null to leave the current claim alone. */
  claim: string | null
}

/**
 * What our helm should do about the boats it is touching.
 * `immune` is the short spell after we come back, so the same hit cannot sink us twice.
 */
export function decideRam(selfId: string, self: RamHull, contacts: readonly RamContact[], immune: boolean): RamDecision {
  let sink = false
  let claim: string | null = null
  let claimScore = 0
  for (const c of contacts) {
    if (c.sinking) continue
    const winner = ramWinner(self, { x: c.x, z: c.z, yaw: c.yaw, speed: c.speed })
    if (c.pushed && winner === 'self') {
      const score = bowInto(self, c)
      if (score > claimScore) {
        claimScore = score
        claim = c.id
      }
    }
    if (immune) continue
    if (c.pushed && (winner === 'other' || winner === 'both')) sink = true
    // Their claim is how a stopped hull learns it was hit. Ignore it when our own bow is the one driving in.
    if (winner !== 'self' && c.ram === selfId && c.gap <= RAM_TOUCH) sink = true
    if ((winner === 'other' || winner === 'both') && c.gap <= RAM_CLOSE) sink = true
  }
  if (sink) return { sink: true, claim: null }
  return { sink: false, claim }
}

export interface Wreck {
  phase: 'sail' | 'down' | 'rest'
  age: number
  /** Metres from the swell down to the bed. */
  bed: number
  /** Metres the hull is under the swell right now. */
  depth: number
  safeUntil: number
  claimId: string
  claimUntil: number
}

export function freshWreck(): Wreck {
  return { phase: 'sail', age: 0, bed: 0, depth: 0, safeUntil: 0, claimId: '', claimUntil: 0 }
}

/** How far to drop the waterline. `bed` is terrain height, negative under the lake. */
export function sinkDepthAt(bed: number): number {
  const down = -bed
  if (!Number.isFinite(down)) return 8
  return Math.min(64, Math.max(down, 0.5))
}

/** Ease-out, so the hull leaves the surface quickly and then settles on the bed. */
export function sinkDrop(age: number, target: number, seconds = SINK_SECONDS): number {
  if (!(target > 0)) return 0
  const u = Math.min(1, Math.max(0, age / seconds))
  const eased = 1 - (1 - u) * (1 - u)
  return target * eased
}

/** Bow-down pitch in radians while the hull is under. Zero when it is afloat. */
export function sinkPitch(metresDown: number): number {
  const t = Math.min(1, Math.max(0, metresDown) / 8)
  return -0.42 * t
}

export function beginSink(wreck: Wreck, bedHeight: number) {
  wreck.phase = 'down'
  wreck.age = 0
  wreck.bed = sinkDepthAt(bedHeight)
  wreck.depth = 0
  wreck.claimId = ''
  wreck.claimUntil = 0
}

export function noteClaim(wreck: Wreck, id: string, now: number) {
  wreck.claimId = id
  wreck.claimUntil = now + RAM_CLAIM_MS
}

export function activeClaim(wreck: Wreck, now: number): string {
  if (!(now < wreck.claimUntil)) return ''
  return wreck.claimId
}

export function clearWreck(wreck: Wreck) {
  wreck.phase = 'sail'
  wreck.age = 0
  wreck.bed = 0
  wreck.depth = 0
}

/** Take the way off. The hull is either sinking or has just been put back on its berth. */
export function holdStill(pose: { speed: number; sway: number; yawRate: number }) {
  pose.speed = 0
  pose.sway = 0
  pose.yawRate = 0
}

/** Put the hull back on the pose it spawned with, dead in the water. */
export function resumeBerth(
  pose: { x: number; z: number; yaw: number; speed: number; sway: number; yawRate: number },
  origin: { x: number; z: number; yaw: number },
) {
  pose.x = origin.x
  pose.z = origin.z
  pose.yaw = origin.yaw
  holdStill(pose)
}

/**
 * Advance a sinking hull. True on the frame it should reappear at its berth.
 * The caller moves the pose and clears the wreck.
 */
export function stepWreck(wreck: Wreck, dt: number): boolean {
  if (wreck.phase === 'sail') return false
  const frame = Math.min(Math.max(dt, 0), 0.1)
  if (wreck.phase === 'down') {
    wreck.age += frame
    wreck.depth = sinkDrop(wreck.age, wreck.bed)
    if (wreck.age >= SINK_SECONDS) {
      wreck.phase = 'rest'
      wreck.age = 0
      wreck.depth = wreck.bed
    }
    return false
  }
  wreck.age += frame
  wreck.depth = wreck.bed
  return wreck.age >= WRECK_REST_SECONDS
}
