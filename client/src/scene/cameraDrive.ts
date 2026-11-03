import { rotateYaw } from './boat/physics'

/**
 * Camera nudges from the controller, consumed once per chase frame.
 * Distance is a scale on the offset from the boat (1 leaves it). Yaw rotates
 * that offset: negative swings the camera toward the port side.
 */
interface Nudge {
  yaw: number
  height: number
  distance: number
}

let nudge: Nudge = { yaw: 0, height: 0, distance: 1 }

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

export function nudgeCamera(part: { yaw?: number; height?: number; distance?: number }) {
  if (part.yaw) nudge.yaw = clamp(nudge.yaw + part.yaw, -1.4, 1.4)
  if (part.height) nudge.height = clamp(nudge.height + part.height, -10, 10)
  if (part.distance && part.distance !== 1) nudge.distance = clamp(nudge.distance * part.distance, 0.45, 2.2)
}

interface Movable {
  position: { x: number; y: number; z: number; set: (x: number, y: number, z: number) => void }
}

/** Apply and clear the pending nudge. Orbit controls read the camera afterwards and keep their limits. */
export function applyCameraNudge(camera: Movable, target: { x: number; y: number; z: number }) {
  const next = nudge
  nudge = { yaw: 0, height: 0, distance: 1 }
  if (next.yaw === 0 && next.height === 0 && next.distance === 1) return

  if (next.yaw !== 0) {
    const spun = rotateYaw(camera.position.x - target.x, camera.position.z - target.z, next.yaw)
    camera.position.x = target.x + spun.x
    camera.position.z = target.z + spun.z
  }

  let dx = camera.position.x - target.x
  let dy = camera.position.y - target.y
  let dz = camera.position.z - target.z
  if (next.distance !== 1) {
    const dist = Math.hypot(dx, dy, dz) || 1
    const scaled = clamp(dist * next.distance, 4.5, 9000)
    const gain = scaled / dist
    dx *= gain
    dy *= gain
    dz *= gain
  }
  const y = clamp(target.y + dy + next.height, target.y + 0.2, target.y + 48)
  camera.position.set(target.x + dx, y, target.z + dz)
}
