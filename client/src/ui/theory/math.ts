/** Screen angles are clockwise radians from up. Boom 0 points aft; positive is starboard. */

export const PI = Math.PI
export const TAU = Math.PI * 2
export const BEAM = PI / 2

export function wrap(angle: number) {
  return Math.atan2(Math.sin(angle), Math.cos(angle))
}

export function clamp(value: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, value))
}

export function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t
}

export function smooth(t: number) {
  const x = clamp(t, 0, 1)
  return x * x * (3 - 2 * x)
}

/** Stays put, then flicks across. Used for a boom gybing. */
export function snap(t: number) {
  const x = clamp(t, 0, 1)
  return x * x * x
}

export type Ease = 'smooth' | 'snap' | 'linear'

export function track(time: number, keys: readonly { t: number; v: number; ease?: Ease }[]) {
  const first = keys[0]
  if (!first || time <= first.t) return first?.v ?? 0
  for (let i = 1; i < keys.length; i++) {
    const next = keys[i]
    if (!next || time > next.t) continue
    const prev = keys[i - 1]
    if (!prev || next.t <= prev.t) return next.v
    const u = (time - prev.t) / (next.t - prev.t)
    const ease = next.ease ?? 'smooth'
    const shaped = ease === 'snap' ? snap(u) : ease === 'linear' ? clamp(u, 0, 1) : smooth(u)
    return lerp(prev.v, next.v, shaped)
  }
  return keys[keys.length - 1]?.v ?? 0
}

/** Where the wind comes from, relative to the bow. + is starboard, 0 is ahead, ±π is astern. */
export function relativeWind(windFrom: number, heading: number) {
  return wrap(windFrom - heading)
}

/** Full opacity until the loop is about to jump, then a short fade. */
export function loopFade(time: number, duration: number, edge = 0.32) {
  return clamp((duration - time) / edge, 0, 1)
}

export type SailLook = {
  aoa: number
  luff: number
  stall: number
  /** 0 drifting, 1 driving hard. */
  speed: number
}

/**
 * How the mainsail looks for a wind angle and a boom angle.
 * `luff` is 1 when the cloth is lined up with the wind and luffing.
 * `stall` is 1 when it is sheeted so tight the air has stopped pulling.
 */
export function sailLook(rel: number, boom: number): SailLook {
  const offBow = Math.abs(rel)
  if (offBow > 2.15) return { aoa: 0.4, luff: 0, stall: 0, speed: 0.72 }
  const aligned = clamp(-rel, -BEAM, BEAM)
  const aoa = Math.abs(aligned - boom)
  const luff = aoa >= 0.28 ? 0 : 1 - aoa / 0.28
  const stall = clamp((aoa - 0.6) / 0.36, 0, 1)
  const peak = 0.46
  let lift: number
  if (aoa <= peak) lift = Math.sin((aoa / peak) * BEAM)
  else {
    const stalled = (aoa - peak) / (BEAM - peak)
    lift = Math.max(0, (1 - stalled) * (1 - 0.75 * stalled))
  }
  return { aoa, luff, stall, speed: lift * (1 - luff * 0.86) }
}

export function knotsOf(speed: number) {
  return 1.05 + speed * 5.7
}

export function rudderFrom(sample: (time: number) => number, time: number) {
  return clamp((sample(time + 0.06) - sample(time - 0.06)) * 6, -0.6, 0.6)
}

/** Ghost boom angles trailing a move from `from` to `to`. `u` is 0..1 through the move. */
export function trail(u: number, from: number, to: number) {
  const ghosts: number[] = []
  for (const lag of [0.16, 0.32, 0.48]) {
    const g = u - lag
    if (g > 0.03 && g < 1) ghosts.push(lerp(from, to, snap(g)))
  }
  return ghosts
}
