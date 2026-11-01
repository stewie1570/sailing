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
