import { useSyncExternalStore } from 'react'

/**
 * A lake breeze, uniform across the water.
 *
 * Direction uses the hull's yaw sense: 0 blows toward +z (south). Meteorologists
 * name the opposite heading — where the air comes from — and that is what the
 * dial shows. Speed stays inside a working inland range, about Beaufort 3 to 4
 * (roughly 7 to 17 knots): enough to sail a heavy cruiser, short of a gale.
 *
 * The breeze holds steady for about two minutes, then eases onto a new
 * heading and speed over several seconds. It does not jump. A veer is a
 * modest one, about eighteen to seventy-two degrees.
 */

export const WIND_STEADY_S = 120
export const WIND_SHIFT_S = 8
/** Metres per second. About 7 to 17 knots. */
export const WIND_SPEED_MIN = 3.4
export const WIND_SPEED_MAX = 9
export const MS_TO_KN = 1.943844

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
    steadyFor: WIND_STEADY_S,
  }
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
  const swing = ((17.5 + random() * 55) * Math.PI) / 180
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
      clock.steadyFor = WIND_STEADY_S + (random() - 0.5) * 32
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
