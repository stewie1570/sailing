import { FERRY_BEAM, FERRY_LOA } from './vessel'
import { BRIDGE_EYE, FERRY_DECK_Y, FERRY_HALF_BEAM, FERRY_HALF_LEN } from './ferryGeometry'

/** The camera counts as over the ferry when it is inside this plan and this low. */
const PLAN_X = FERRY_HALF_BEAM + 0.35
const PLAN_Z = FERRY_HALF_LEN + 1.1
const LOW = 0.6
const HIGH = FERRY_DECK_Y + 6.8

/**
 * True when the chase camera has come down onto the ferry.
 * A high view that happens to be centred on the hull stays outside.
 */
export function overFerryDeck(localX: number, localY: number, localZ: number) {
  return Math.abs(localX) < PLAN_X && Math.abs(localZ) < PLAN_Z && localY > LOW && localY < HIGH
}

/**
 * A point just outside the hull, behind the way the captain is looking,
 * at about eye height. Zooming out of the chair lands here.
 */
export function bridgeExitLocal(lookYaw: number) {
  let hx = -Math.sin(lookYaw)
  let hz = -Math.cos(lookYaw)
  const span = Math.hypot(hx, hz)
  if (span < 1e-4) {
    hx = -1
    hz = 0
  } else {
    hx /= span
    hz /= span
  }
  const limitX = FERRY_BEAM / 2 + 1.1
  const limitZ = FERRY_LOA / 2 + 0.4
  let x = BRIDGE_EYE.x
  let z = BRIDGE_EYE.z
  for (let i = 0; i < 90; i++) {
    if (Math.abs(x) > limitX || Math.abs(z) > limitZ) break
    x += hx * 0.5
    z += hz * 0.5
  }
  return {
    x: x + hx * 2.4,
    y: Math.max(BRIDGE_EYE.y, FERRY_DECK_Y + 1.6),
    z: z + hz * 2.4,
  }
}

/** Ship local metres to world. `originY` is the hull's waterline height this frame. */
export function shipToWorld(
  pose: { x: number; z: number; yaw: number },
  originY: number,
  local: { x: number; y: number; z: number },
) {
  const c = Math.cos(pose.yaw)
  const s = Math.sin(pose.yaw)
  return {
    x: pose.x + local.x * c + local.z * s,
    y: originY + local.y,
    z: pose.z - local.x * s + local.z * c,
  }
}

/** World metres to ship local. */
export function worldToShip(
  pose: { x: number; z: number; yaw: number },
  originY: number,
  wx: number,
  wy: number,
  wz: number,
) {
  const dx = wx - pose.x
  const dz = wz - pose.z
  const c = Math.cos(pose.yaw)
  const s = Math.sin(pose.yaw)
  return {
    x: dx * c - dz * s,
    y: wy - originY,
    z: dx * s + dz * c,
  }
}

/** Look direction in world space. Yaw 0 faces the bow, positive yaw faces port. */
export function bridgeLookDir(shipYaw: number, lookYaw: number, pitch: number) {
  const local = {
    x: Math.sin(lookYaw) * Math.cos(pitch),
    y: Math.sin(pitch),
    z: Math.cos(lookYaw) * Math.cos(pitch),
  }
  const c = Math.cos(shipYaw)
  const s = Math.sin(shipYaw)
  return {
    x: local.x * c + local.z * s,
    y: local.y,
    z: -local.x * s + local.z * c,
  }
}
