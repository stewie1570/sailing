import { rotateYaw } from './boat/physics'
import { vesselView } from './boat/vessel'

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

/** Take this frame's nudge. The chase camera and the bridge look both read it once. */
export function consumeCameraNudge(): Nudge {
  const next = nudge
  nudge = { yaw: 0, height: 0, distance: 1 }
  return next
}

/** Move the chase camera by a nudge that has already been taken off the queue. */
export function applyNudge(camera: Movable, target: { x: number; y: number; z: number }, next: Nudge) {
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

/** Apply and clear the pending nudge. Orbit controls read the camera afterwards and keep their limits. */
export function applyCameraNudge(camera: Movable, target: { x: number; y: number; z: number }) {
  applyNudge(camera, target, consumeCameraNudge())
}

/** Where the chase picture is centred, in ship-local metres. */
export interface ChaseLook {
  x: number
  y: number
  z: number
}

/** Desktop and tablet. Midships, just above the deck. */
export const DECK_LOOK: ChaseLook = { x: 0, y: 1.15, z: 0 }

/** Same cutoff as the phone helm layout. Tablets stay on the deck aim. */
export const PHONE_HELM = '(max-width: 500px), (max-height: 500px) and (max-width: 950px)'

/**
 * Gap above the wheel rim. The phone picture stays centred in that air,
 * so the helm sits just under the middle of the view.
 */
export const HELM_LOOK_CLEARANCE = 0.22

/** Phone chase aim: just above the steering wheel, on the centreline. */
export function helmLookLocal(wheel: { x: number; y: number; z: number }, rim: number): ChaseLook {
  return { x: wheel.x, y: wheel.y + rim + HELM_LOOK_CLEARANCE, z: wheel.z }
}

/**
 * Closest a phone may dolly while the picture stays centred on the helm.
 * The orbit limit is still the deck minimum, 4.5 m from midships. From the
 * wheel that same spot is on the aft deck, just behind the helm.
 */
export function helmMinDistance(helm: ChaseLook) {
  const view = vesselView('sail')
  const dy = view.height - view.look
  const dz = -view.back
  const len = Math.hypot(dy, dz) || 1
  const closeY = view.look + (dy / len) * view.minDistance
  const closeZ = (dz / len) * view.minDistance
  return Math.hypot(closeY - helm.y, closeZ - helm.z)
}

/** World point the chase picture is centred on. */
export function chaseAim(
  pose: { x: number; z: number },
  y: number,
  yaw: number,
  look: ChaseLook,
): { x: number; y: number; z: number } {
  const off = rotateYaw(look.x, look.z, yaw)
  return { x: pose.x + off.x, y: y + look.y, z: pose.z + off.z }
}

interface ChasePoint {
  x: number
  y: number
  z: number
}

/**
 * Carry the chase camera with the hull and aim it.
 * `prevLook` is the aim used last frame, so a switch (deck centre to the
 * helm) retargets without sliding the lens. While the aim stays put, the
 * lens keeps its offset and yaws with `yaw`, the lagged heading.
 */
export function stepChaseCamera(
  camera: ChasePoint,
  prev: { x: number; y: number; z: number; yaw: number },
  pose: { x: number; z: number },
  y: number,
  yaw: number,
  prevLook: ChaseLook,
  look: ChaseLook,
): ChasePoint {
  const dYaw = yaw - prev.yaw
  const motionBefore = rotateYaw(prevLook.x, prevLook.z, prev.yaw)
  const motionAfter = rotateYaw(prevLook.x, prevLook.z, yaw)
  let cx = camera.x + (pose.x - prev.x) + (motionAfter.x - motionBefore.x)
  let cy = camera.y + (y - prev.y)
  let cz = camera.z + (pose.z - prev.z) + (motionAfter.z - motionBefore.z)
  const aim = chaseAim(pose, y, yaw, look)
  if (dYaw !== 0) {
    const off = rotateYaw(cx - aim.x, cz - aim.z, dYaw)
    cx = aim.x + off.x
    cz = aim.z + off.z
  }
  camera.x = cx
  camera.y = cy
  camera.z = cz
  return aim
}
