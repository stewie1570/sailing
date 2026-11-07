import type { Pose } from './physics'

/** Latest hull state, written from the sim frame and read by the chart. */
export const telemetry = {
  ready: false,
  x: 0,
  z: 0,
  yaw: 0,
  speed: 0,
  sway: 0,
  yawRate: 0,
}

const MS_TO_KN = 1.943844

/** Knots through the water. Negative when the hull is making way astern. */
export function speedKnots(speed: number, sway: number) {
  const through = Math.hypot(speed, sway)
  if (through < 0.04) return 0
  return (speed < -0.04 ? -through : through) * MS_TO_KN
}

/** Knots through the water, with a leading minus when she is making way astern. */
export function formatKnots(speed: number, sway: number) {
  const surge = Number.isFinite(speed) ? speed : 0
  const drift = Number.isFinite(sway) ? sway : 0
  const kn = speedKnots(surge, drift)
  return `${kn < -0.05 ? '−' : ''}${Math.abs(kn).toFixed(1)} kn`
}

/**
 * Screws or thrusters count as engine once they are out of stop.
 * A sail counts once enough cloth is out to see it.
 */
const DRIVE_ON = 0.02

/** Screws or thrusters are out of the stop notch. */
export function enginesRunning(port: number, starboard: number, bow: number, stern: number) {
  return [port, starboard, bow, stern].some((value) => Number.isFinite(value) && Math.abs(value) > DRIVE_ON)
}

/** Engine, sail, both, or neither. The chart hover uses this wording. */
export function propulsionLabel(
  port: number,
  starboard: number,
  bow: number,
  stern: number,
  hoist: number,
  jibHoist: number,
  spinHoist = 0,
) {
  const powered = enginesRunning(port, starboard, bow, stern)
  const sailing = [hoist, jibHoist, spinHoist].some((value) => Number.isFinite(value) && value > DRIVE_ON)
  if (powered && sailing) return 'Engine and sail'
  if (powered) return 'Under engine'
  if (sailing) return 'Under sail'
  return 'Idle'
}

export function publishTelemetry(pose: Pose) {
  telemetry.ready = true
  telemetry.x = pose.x
  telemetry.z = pose.z
  telemetry.yaw = pose.yaw
  telemetry.speed = pose.speed
  telemetry.sway = pose.sway
  telemetry.yawRate = pose.yawRate
}

/** Steering-wheel hub in viewport pixels, so the rudder slider can sit across it. */
export const wheelScreen = {
  x: 0,
  y: 0,
  radius: 80,
  visible: false,
}

export function publishWheel(x: number, y: number, radius: number, visible: boolean) {
  wheelScreen.x = x
  wheelScreen.y = y
  wheelScreen.radius = radius
  wheelScreen.visible = visible
}
