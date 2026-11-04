import { useSyncExternalStore } from 'react'

/**
 * A lake breeze, uniform across the water.
 *
 * Direction uses the hull's yaw sense: 0 blows toward +z (south). Meteorologists
 * name the opposite heading — where the air comes from — and that is what the
 * dial shows. Speed is drawn again on each update, anywhere from 6 to 30 knots:
 * light air through a near gale, enough to move a heavy cruiser.
 *
 * How long the breeze holds, which way it turns, and how hard it blows are
 * each chosen on their own. The hold is anywhere from thirty seconds to two
 * minutes. The veer is the tight one: at most twenty-five degrees, either
 * way, and often less. The new speed is then eased in over several seconds.
 * The breeze does not jump.
 */

/** Seconds the breeze may hold before the next update. */
export const WIND_HOLD_MIN_S = 30
export const WIND_HOLD_MAX_S = 120
export const WIND_SHIFT_S = 8
/** Longest veer on one update, either way. */
export const WIND_VEER_MAX_DEG = 25
export const MS_TO_KN = 1.943844
/** Metres per second. 6 knots. */
export const WIND_SPEED_MIN = 6 / MS_TO_KN
/** Metres per second. 30 knots. */
export const WIND_SPEED_MAX = 30 / MS_TO_KN

const POINTS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'] as const

export interface Wind {
  /** Radians. 0 blows toward +z (south). */
  blowYaw: number
  /** Metres per second. */
  speed: number
  /** True while the breeze is easing onto its next direction. */
  shifting: boolean
}

export interface WindDisplay {
  /** Compass degrees the wind comes from. 0 is north. */
  fromDeg: number
  /** Knots, to 0.1. */
  kn: number
  shifting: boolean
}

interface Clock {
  blowYaw: number
  speed: number
  fromYaw: number
  fromSpeed: number
  toYaw: number
  toSpeed: number
  age: number
  phase: 'steady' | 'shift'
  steadyFor: number
}

const START_YAW = 0
const START_SPEED = (WIND_SPEED_MIN + WIND_SPEED_MAX) / 2

let random = Math.random
let clock: Clock = fresh(START_YAW, START_SPEED)
let display: WindDisplay = quantize(clock)
const listeners = new Set<() => void>()

function fresh(blowYaw: number, speed: number): Clock {
  return {
    blowYaw,
    speed,
    fromYaw: blowYaw,
    fromSpeed: speed,
    toYaw: blowYaw,
    toSpeed: speed,
    age: 0,
    phase: 'steady',
    steadyFor: holdSeconds(),
  }
}

/** How long this spell lasts before the breeze is updated again. */
function holdSeconds() {
  return WIND_HOLD_MIN_S + random() * (WIND_HOLD_MAX_S - WIND_HOLD_MIN_S)
}

/** Degrees clockwise from north, naming where the air comes from. */
export function windFromDegrees(blowYaw: number): number {
  const deg = (Math.atan2(-Math.sin(blowYaw), Math.cos(blowYaw)) * 180) / Math.PI
  return (deg + 360) % 360
}

export function compassPoint(deg: number): string {
  const i = Math.round((((deg % 360) + 360) % 360) / 22.5) % 16
  return POINTS[i]
}

function quantize(c: Clock): WindDisplay {
  return {
    fromDeg: Math.round(windFromDegrees(c.blowYaw)),
    kn: Math.round(c.speed * MS_TO_KN * 10) / 10,
    shifting: c.phase === 'shift',
  }
}

function publish() {
  const next = quantize(clock)
  if (next.fromDeg === display.fromDeg && next.kn === display.kn && next.shifting === display.shifting) return
  display = next
  listeners.forEach((l) => l())
}

function wrapPi(a: number) {
  let d = a % (Math.PI * 2)
  if (d > Math.PI) d -= Math.PI * 2
  if (d < -Math.PI) d += Math.PI * 2
  return d
}

function smoothstep(t: number) {
  const x = Math.min(1, Math.max(0, t))
  return x * x * (3 - 2 * x)
}

function nextBreeze(fromYaw: number, fromSpeed: number) {
  const swing = (random() * WIND_VEER_MAX_DEG * Math.PI) / 180
  const sign = random() < 0.5 ? -1 : 1
  let speed = WIND_SPEED_MIN + random() * (WIND_SPEED_MAX - WIND_SPEED_MIN)
  if (Math.abs(speed - fromSpeed) < 0.8) {
    const bump = speed >= fromSpeed ? 1.4 : -1.4
    speed = Math.min(WIND_SPEED_MAX, Math.max(WIND_SPEED_MIN, fromSpeed + bump))
  }
  return { toYaw: fromYaw + sign * swing, toSpeed: speed }
}

export function getWind(): Wind {
  return { blowYaw: clock.blowYaw, speed: clock.speed, shifting: clock.phase === 'shift' }
}

export function getWindDisplay(): WindDisplay {
  return display
}

/** Age within the current steady spell or shift, for the dev console. */
export function getWindDebug() {
  return {
    ...getWind(),
    age: clock.age,
    phase: clock.phase,
    steadyFor: clock.steadyFor,
    toYaw: clock.toYaw,
    toSpeed: clock.toSpeed,
  }
}

export function resetWind(blowYaw = START_YAW, speed = START_SPEED) {
  clock = fresh(blowYaw, speed)
  publish()
}

/**
 * Guests do not roll their own forecast. The host's breeze is the room's breeze,
 * and between samples the needle eases toward the last one instead of jumping.
 * `snap` is for the sample that arrives before the hull is ticking.
 */
let followed: { yaw: number; speed: number; shifting: boolean } | null = null

export function followWind(blowYaw: number, speed: number, shifting: boolean, snap: boolean) {
  followed = { yaw: blowYaw, speed, shifting }
  if (!snap) return
  clock.blowYaw = blowYaw
  clock.speed = speed
  clock.toYaw = blowYaw
  clock.toSpeed = speed
  clock.fromYaw = blowYaw
  clock.fromSpeed = speed
  clock.phase = shifting ? 'shift' : 'steady'
  clock.age = 0
  publish()
}

/** Solo sailing and the host run the local breeze again. */
export function releaseWind() {
  followed = null
}

export function setWindRandom(fn: () => number) {
  random = fn
}

/**
 * Advance the breeze. `dt` should be the same clamped frame the hull uses,
 * so a stalled tab does not skip a whole shift.
 */
export function stepWind(dt: number) {
  const step = Math.min(Math.max(dt, 0), 0.5)
  if (step === 0) return
  if (followed) {
    const k = 1 - Math.exp(-step / 0.45)
    clock.blowYaw += wrapPi(followed.yaw - clock.blowYaw) * k
    clock.speed += (followed.speed - clock.speed) * k
    clock.toYaw = clock.blowYaw
    clock.toSpeed = clock.speed
    clock.fromYaw = clock.blowYaw
    clock.fromSpeed = clock.speed
    clock.phase = followed.shifting ? 'shift' : 'steady'
    publish()
    return
  }
  clock.age += step
  if (clock.phase === 'steady') {
    clock.blowYaw = clock.toYaw
    clock.speed = clock.toSpeed
    if (clock.age >= clock.steadyFor) {
      const next = nextBreeze(clock.toYaw, clock.toSpeed)
      clock.fromYaw = clock.toYaw
      clock.fromSpeed = clock.toSpeed
      clock.toYaw = next.toYaw
      clock.toSpeed = next.toSpeed
      clock.phase = 'shift'
      clock.age = 0
    }
  } else {
    const t = smoothstep(Math.min(1, clock.age / WIND_SHIFT_S))
    clock.blowYaw = clock.fromYaw + wrapPi(clock.toYaw - clock.fromYaw) * t
    clock.speed = clock.fromSpeed + (clock.toSpeed - clock.fromSpeed) * t
    if (clock.age >= WIND_SHIFT_S) {
      clock.blowYaw = clock.toYaw
      clock.speed = clock.toSpeed
      clock.fromYaw = clock.toYaw
      clock.fromSpeed = clock.toSpeed
      clock.phase = 'steady'
      clock.age = 0
      clock.steadyFor = holdSeconds()
    }
  }
  publish()
}

export function useWindDisplay(): WindDisplay {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => display,
  )
}
