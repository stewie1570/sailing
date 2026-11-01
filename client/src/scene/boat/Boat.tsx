import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { MapData } from '../../map/mapData'
import { QUALITY_PRESETS, useQuality } from '../quality'
import { blocked, colliderWorld } from './collision'
import {
  buildPropeller,
  buildPropStrut,
  buildRudder,
  buildSailboat,
  buildWheel,
  helmHardware,
  WHEEL_RADIUS,
} from './geometry'
import { getHelm, updateHelm } from './helm'
import { integrate, spawnPose, swell, type Pose } from './physics'
import { WHEEL_LOCK, RUDDER_LOCK } from './dynamics'
import { publishTelemetry, publishWheel } from './telemetry'

type OrbitLike = { target: THREE.Vector3; update: () => void }

function disposeMesh(mesh: THREE.Mesh) {
  mesh.geometry.dispose()
  const material = mesh.material
  if (Array.isArray(material)) material.forEach((m) => m.dispose())
  else material.dispose()
}

/**
 * The player's sloop, driven by twin screws and a rudder.
 * The wheel and the blade turn with the helm. The hull stops when it meets
 * the shore, a dock, or any other solid mesh. The camera keeps its angle.
 */
export function Boat({ map }: { map: MapData }) {
  const hull = useMemo(() => buildSailboat(), [])
  const wheel = useMemo(() => buildWheel(), [])
  const rudderMesh = useMemo(() => buildRudder(), [])
  const portProp = useMemo(() => buildPropeller(), [])
  const stbdProp = useMemo(() => buildPropeller(), [])
  const portStrut = useMemo(() => buildPropStrut(), [])
  const stbdStrut = useMemo(() => buildPropStrut(), [])
  const hardware = useMemo(() => helmHardware(), [])
  const quality = useQuality()
  const preset = QUALITY_PRESETS[quality]
  const world = useMemo(
    () => colliderWorld(map, preset.terrainSegments, preset.treeFraction),
    [map, preset.terrainSegments, preset.treeFraction],
  )
  const pose = useMemo<Pose>(() => spawnPose(map), [map])
  const group = useRef<THREE.Group>(null)
  const wheelRef = useRef<THREE.Group>(null)
  const rudderRef = useRef<THREE.Group>(null)
  const portSpinRef = useRef<THREE.Group>(null)
  const stbdSpinRef = useRef<THREE.Group>(null)
  const follow = useRef({ x: pose.x, y: 0, z: pose.z })
  const scratch = useMemo(
    () => ({ hub: new THREE.Vector3(), rim: new THREE.Vector3(), toHub: new THREE.Vector3(), cam: new THREE.Vector3() }),
    [],
  )
  const camera = useThree((s) => s.camera)
  const controls = useThree((s) => s.controls)
  const gl = useThree((s) => s.gl)

  useEffect(() => {
    return () => {
      for (const mesh of [hull, wheel, rudderMesh, portProp, stbdProp, portStrut, stbdStrut]) disposeMesh(mesh)
    }
  }, [hull, wheel, rudderMesh, portProp, stbdProp, portStrut, stbdStrut])

  useEffect(() => {
    if (!import.meta.env.DEV) return
    const w = window as unknown as { __sailing?: Record<string, unknown> }
    const sailing = (w.__sailing ??= {})
    const api = {
      get x() { return pose.x },
      get z() { return pose.z },
      get yaw() { return pose.yaw },
      get speed() { return pose.speed },
      get sway() { return pose.sway },
      get yawRate() { return pose.yawRate },
      get port() { return getHelm().port },
      get starboard() { return getHelm().starboard },
      get rudder() { return getHelm().rudder },
      drive(port: number, starboard: number, rudder: number) {
        updateHelm({ port, starboard, rudder })
      },
      place(x: number, z: number, yaw?: number) {
        const dx = x - pose.x
        const dz = z - pose.z
        pose.x = x
        pose.z = z
        if (yaw != null) pose.yaw = yaw
        pose.speed = 0
        pose.sway = 0
        pose.yawRate = 0
        camera.position.x += dx
        camera.position.z += dz
        follow.current.x = pose.x
        follow.current.z = pose.z
        const orbit = controls as OrbitLike | null
        orbit?.target.set(pose.x, follow.current.y + 1.15, pose.z)
      },
    }
    sailing.boat = api
    return () => {
      if (w.__sailing) delete w.__sailing.boat
    }
  }, [pose, camera, controls])

  useFrame((state, delta) => {
    const drive = getHelm()
    const time = state.clock.elapsedTime
    integrate(pose, drive, delta, (x, z, yaw) => blocked(world, x, z, yaw, swell(x, z, time)))
    publishTelemetry(pose)

    const spin = Math.min(Math.max(delta, 0), 0.1)
    if (wheelRef.current) wheelRef.current.rotation.z = drive.rudder * WHEEL_LOCK
    if (rudderRef.current) rudderRef.current.rotation.y = drive.rudder * RUDDER_LOCK
    if (portSpinRef.current) portSpinRef.current.rotation.z += drive.port * 16 * spin
    if (stbdSpinRef.current) stbdSpinRef.current.rotation.z -= drive.starboard * 16 * spin

    const y = swell(pose.x, pose.z, time)
    const g = group.current
    if (g) {
      g.position.set(pose.x, y, pose.z)
      g.rotation.y = pose.yaw
      g.updateWorldMatrix(true, false)
    }

    const orbit = controls as OrbitLike | null
    if (orbit?.target) {
      const prev = follow.current
      camera.position.x += pose.x - prev.x
      camera.position.y += y - prev.y
      camera.position.z += pose.z - prev.z
      orbit.target.set(pose.x, y + 1.15, pose.z)
      prev.x = pose.x
      prev.y = y
      prev.z = pose.z
    }

    if (!g) return
    scratch.hub.set(hardware.wheel.x, hardware.wheel.y, hardware.wheel.z).applyMatrix4(g.matrixWorld)
    scratch.rim.set(hardware.wheel.x + WHEEL_RADIUS, hardware.wheel.y, hardware.wheel.z).applyMatrix4(g.matrixWorld)
    scratch.toHub.copy(scratch.hub).sub(camera.position)
    const ahead = scratch.toHub.dot(camera.getWorldDirection(scratch.cam)) > 0.2
    const hx = scratch.hub.x
    const hy = scratch.hub.y
    const hz = scratch.hub.z
    const rx = scratch.rim.x
    const ry = scratch.rim.y
    const rz = scratch.rim.z
    scratch.hub.set(hx, hy, hz).project(camera)
    scratch.rim.set(rx, ry, rz).project(camera)
    const rect = gl.domElement.getBoundingClientRect()
    const sx = rect.left + (scratch.hub.x * 0.5 + 0.5) * rect.width
    const sy = rect.top + (-scratch.hub.y * 0.5 + 0.5) * rect.height
    const rsx = rect.left + (scratch.rim.x * 0.5 + 0.5) * rect.width
    const rsy = rect.top + (-scratch.rim.y * 0.5 + 0.5) * rect.height
    publishWheel(sx, sy, Math.hypot(rsx - sx, rsy - sy), ahead)
  })

  const wheelPos = hardware.wheel
  const rudderPos = hardware.rudder
  const portPos = hardware.portScrew
  const stbdPos = hardware.starboardScrew

  return (
    <group ref={group} position={[pose.x, 0, pose.z]} rotation={[0, pose.yaw, 0]}>
      <primitive object={hull} />
      <group ref={wheelRef} position={[wheelPos.x, wheelPos.y, wheelPos.z]}>
        <primitive object={wheel} />
      </group>
      <group ref={rudderRef} position={[rudderPos.x, rudderPos.y, rudderPos.z]}>
        <primitive object={rudderMesh} />
      </group>
      <group position={[portPos.x, portPos.y, portPos.z]}>
        <primitive object={portStrut} />
        <group ref={portSpinRef}>
          <primitive object={portProp} />
        </group>
      </group>
      <group position={[stbdPos.x, stbdPos.y, stbdPos.z]}>
        <primitive object={stbdStrut} />
        <group ref={stbdSpinRef}>
          <primitive object={stbdProp} />
        </group>
      </group>
    </group>
  )
}
