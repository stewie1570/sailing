import { addAfterEffect, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { cameraGround, solidsNear } from './boat/collision'
import { overFerryDeck, worldToShip } from './boat/ferryBridge'
import { publishWheel, wheelScreen, wheelWorld } from './boat/telemetry'
import {
  cameraNear,
  cargoBoxes,
  chaseBody,
  resolveChaseCamera,
} from './cameraClip'
import { getChallenge } from './challenge'

const hub = new THREE.Vector3()
const rim = new THREE.Vector3()
const toHub = new THREE.Vector3()
const camDir = new THREE.Vector3()

type Orbit = {
  enabled?: boolean
  target: THREE.Vector3
}

/**
 * Runs before the chase and the orbit. Both of those read the camera, and
 * they have to see the aim the sailor set. drei's OrbitControls updates at
 * priority -1, and a drag calls that update between frames. The picture is
 * put back to the aim after the render, and again here if a frame still
 * starts on the picture. A positive priority would turn rendering off.
 */
const RESTORE = -2

/**
 * Keeps the picture outside the hull, the cargo and the harbour solids, and
 * closes the near plane when the lens gets close to one of them. Mounted
 * after the orbit so it sees this frame's aim. The wheel slider is projected
 * from that same picture, or it would sit on the aim rather than the view.
 */
export function CameraGuard() {
  const camera = useThree((s) => s.camera)
  const controls = useThree((s) => s.controls)
  const gl = useThree((s) => s.gl)
  const aim = useRef(new THREE.Vector3())
  const shown = useRef(new THREE.Vector3())
  const tracking = useRef(false)

  useFrame(() => {
    const orbit = readOrbit(controls)
    if (!orbit || orbit.enabled === false || !tracking.current) return
    // Already back on the aim, or a look-at landed since the picture was drawn.
    if (camera.position.distanceToSquared(shown.current) > 1e-4) return
    camera.position.copy(aim.current)
  }, RESTORE)

  // The render has already used the pushed picture. Put the aim back so a
  // drag or the next orbit reads the distance the sailor chose, not the
  // distance the hull pushed the lens out to.
  useEffect(() => {
    return addAfterEffect(() => {
      if (!tracking.current) return
      if (camera.position.distanceToSquared(shown.current) > 1e-4) return
      camera.position.copy(aim.current)
    })
  }, [camera])

  useFrame(() => {
    const orbit = readOrbit(controls)
    if (!orbit || orbit.enabled === false) {
      tracking.current = false
      return
    }
    const body = chaseBody()
    if (!body) {
      tracking.current = false
      return
    }

    aim.current.copy(camera.position)
    const around = solidsNear(body.world, camera.position.x, camera.position.z)
    const challenge = getChallenge()
    const cargo = cargoBoxes({
      kind: challenge.cargo === 'deck' ? body.kind : challenge.kind,
      cargo: challenge.cargo,
      dock: challenge.dockCargo,
      pose: { x: body.x, z: body.z, yaw: body.yaw, y: body.y },
    })
    const boxes = cargo.length === 0 ? around.boxes : around.boxes.concat(cargo)
    const local = worldToShip(body, body.y, camera.position.x, camera.position.y, camera.position.z)
    // Over the ferry deck the next frame sits the sailor in the chair.
    // Pushing the lens back outside would stop that zoom on the hull.
    const allowInsideHull = body.kind === 'ferry' && overFerryDeck(local.x, local.y, local.z)
    const resolved = resolveChaseCamera({
      camera: camera.position,
      target: orbit.target,
      hull: body,
      allowInsideHull,
      boxes,
      discs: around.discs,
      groundAt: (x, z) => cameraGround(body.world, x, z),
    })
    camera.position.set(resolved.x, resolved.y, resolved.z)
    camera.lookAt(orbit.target)
    shown.current.copy(camera.position)
    tracking.current = true

    const persp = camera as THREE.PerspectiveCamera
    if (persp.isPerspectiveCamera) {
      const next = cameraNear(resolved.clearance)
      if (Math.abs(persp.near - next) > 0.02) {
        persp.near = next
        persp.updateProjectionMatrix()
      }
    }
    projectWheel(camera, gl)
  })

  return null
}

function readOrbit(controls: unknown): Orbit | null {
  if (!controls || typeof controls !== 'object') return null
  const orbit = controls as { enabled?: boolean; target?: THREE.Vector3 }
  if (!orbit.target) return null
  return orbit as Orbit
}

function projectWheel(camera: THREE.Camera, gl: THREE.WebGLRenderer) {
  if (!wheelWorld.on) {
    if (wheelScreen.visible) publishWheel(0, 0, 0, false)
    return
  }
  hub.set(wheelWorld.hx, wheelWorld.hy, wheelWorld.hz)
  rim.set(wheelWorld.rx, wheelWorld.ry, wheelWorld.rz)
  toHub.copy(hub).sub(camera.position)
  const ahead = toHub.dot(camera.getWorldDirection(camDir)) > 0.2
  const hx = hub.x
  const hy = hub.y
  const hz = hub.z
  const rx = rim.x
  const ry = rim.y
  const rz = rim.z
  hub.set(hx, hy, hz).project(camera)
  rim.set(rx, ry, rz).project(camera)
  const rect = gl.domElement.getBoundingClientRect()
  const sx = rect.left + (hub.x * 0.5 + 0.5) * rect.width
  const sy = rect.top + (-hub.y * 0.5 + 0.5) * rect.height
  const rsx = rect.left + (rim.x * 0.5 + 0.5) * rect.width
  const rsy = rect.top + (-rim.y * 0.5 + 0.5) * rect.height
  publishWheel(sx, sy, Math.hypot(rsx - sx, rsy - sy), ahead)
}
