import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { MapData } from '../../map/mapData'
import { QUALITY_PRESETS, useQuality } from '../quality'
import { blocked, colliderWorld } from './collision'
import {
  buildBoom,
  buildJib,
  buildMainsail,
  buildPropeller,
  buildPropStrut,
  buildRudder,
  buildSailboat,
  buildVane,
  buildWheel,
  helmHardware,
  jibFrame,
  poseJib,
  rigFrame,
  WHEEL_RADIUS,
} from './geometry'
import { getHelm, updateHelm } from './helm'
import {
  chaseYaw,
  CHASE_YAW_LAG,
  integrate,
  MOTION,
  rotateYaw,
  spawnPose,
  swell,
  type Pose,
} from './physics'
import { WHEEL_LOCK, RUDDER_LOCK } from './dynamics'
import { getBoom, getClew, getHoist, getJibHoist, luffAmount, readRig, stepHoist, stepJibHoist } from './sail'
import { getWind, getWindDebug, stepWind } from './wind'
import { publishTelemetry, publishWheel } from './telemetry'

type OrbitLike = { target: THREE.Vector3; update: () => void }

function disposeMesh(mesh: THREE.Mesh) {
  mesh.geometry.dispose()
  const material = mesh.material
  if (Array.isArray(material)) material.forEach((m) => m.dispose())
  else material.dispose()
}

/**
 * The player's sloop. Twin screws and a rudder, a main on the boom, and a jib
 * on the forestay. The wheel and the blade turn with the helm. Each sail swings
 * only as far as its sheet allows, and the wind pushes it out. The hull stops when it
 * meets the shore, a dock, or any other solid mesh. The camera rides along
 * and chases the heading about a second behind, finishing at the same angle
 * relative to the hull.
 */
export function Boat({ map }: { map: MapData }) {
  const hull = useMemo(() => buildSailboat(), [])
  const wheel = useMemo(() => buildWheel(), [])
  const boomMesh = useMemo(() => buildBoom(), [])
  const sailMesh = useMemo(() => buildMainsail(), [])
  const jibMesh = useMemo(() => buildJib(), [])
  const vaneMesh = useMemo(() => buildVane(), [])
  const rig = useMemo(() => rigFrame(), [])
  const jibRig = useMemo(() => jibFrame(), [])
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
  const boomRef = useRef<THREE.Group>(null)
  const sailRef = useRef<THREE.Group>(null)
  const jibRef = useRef<THREE.Group>(null)
  const vaneRef = useRef<THREE.Group>(null)
  const camberSide = useRef(1)
  const rudderRef = useRef<THREE.Group>(null)
  const portSpinRef = useRef<THREE.Group>(null)
  const stbdSpinRef = useRef<THREE.Group>(null)
  const follow = useRef({ x: pose.x, y: 0, z: pose.z, yaw: pose.yaw })
  const scratch = useMemo(
    () => ({ hub: new THREE.Vector3(), rim: new THREE.Vector3(), toHub: new THREE.Vector3(), cam: new THREE.Vector3() }),
    [],
  )
  const camera = useThree((s) => s.camera)
  const controls = useThree((s) => s.controls)
  const gl = useThree((s) => s.gl)

  useEffect(() => {
    return () => {
      for (const mesh of [hull, wheel, boomMesh, sailMesh, jibMesh, vaneMesh, rudderMesh, portProp, stbdProp, portStrut, stbdStrut]) disposeMesh(mesh)
    }
  }, [hull, wheel, boomMesh, sailMesh, jibMesh, vaneMesh, rudderMesh, portProp, stbdProp, portStrut, stbdStrut])

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
      get halyard() { return getHelm().halyard },
      get sheet() { return getHelm().sheet },
      get hoist() { return getHoist() },
      get boom() { return getBoom() },
      get jib() { return getHelm().jib },
      get jibPort() { return getHelm().jibPort },
      get jibStarboard() { return getHelm().jibStarboard },
      get jibHoist() { return getJibHoist() },
      get clew() { return getClew() },
      drive(port: number, starboard: number, rudder: number) {
        updateHelm({ port, starboard, rudder })
      },
      sail(halyard: number, sheet: number) {
        updateHelm({ halyard, sheet })
      },
      setJib(jib: number, jibPort: number, jibStarboard: number) {
        updateHelm({ jib, jibPort, jibStarboard })
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
        follow.current.yaw = pose.yaw
        const orbit = controls as OrbitLike | null
        orbit?.target.set(pose.x, follow.current.y + 1.15, pose.z)
      },
    }
    sailing.boat = api
    sailing.wind = {
      get blowYaw() { return getWind().blowYaw },
      get speed() { return getWind().speed },
      get shifting() { return getWind().shifting },
      get age() { return getWindDebug().age },
      get phase() { return getWindDebug().phase },
    }
    return () => {
      if (!w.__sailing) return
      delete w.__sailing.boat
      delete w.__sailing.wind
    }
  }, [pose, camera, controls])

  useFrame((state, delta) => {
    const drive = getHelm()
    const time = state.clock.elapsedTime
    const frame = Math.min(Math.max(delta, 0), MOTION.maxFrame)
    stepWind(frame)
    stepHoist(drive.halyard, frame)
    stepJibHoist(drive.jib, frame)
    const wind = getWind()
    integrate(pose, drive, delta, (x, z, yaw) => blocked(world, x, z, yaw, swell(x, z, time)), {
      wind,
      sail: {
        hoist: getHoist(),
        sheet: drive.sheet,
        jibHoist: getJibHoist(),
        jibPort: drive.jibPort,
        jibStarboard: drive.jibStarboard,
      },
    })
    publishTelemetry(pose)

    const spin = Math.min(Math.max(delta, 0), 0.1)
    if (wheelRef.current) wheelRef.current.rotation.z = drive.rudder * WHEEL_LOCK
    if (rudderRef.current) rudderRef.current.rotation.y = drive.rudder * RUDDER_LOCK
    const boomAngle = getBoom()
    const trim = readRig(pose, wind)
    if (boomRef.current) boomRef.current.rotation.y = boomAngle
    if (sailRef.current) {
      const h = getHoist()
      if (Math.abs(boomAngle) > 0.08) camberSide.current = boomAngle > 0 ? -1 : 1
      const flap = luffAmount(trim.main.aoa, trim.main.awa, h)
      const gust = Math.min(1, trim.main.aws / 3.5)
      const amp = flap * (0.4 + 0.6 * gust)
      // Two rates, so a luffing main slats instead of wagging on a clock.
      const wag = Math.sin(time * (7.2 + 5 * gust)) * 0.62 + Math.sin(time * (15.5 + 4 * gust) + 0.8) * 0.38
      sailRef.current.rotation.y = amp * wag * 0.22
      sailRef.current.rotation.x = amp * Math.sin(time * (11.4 + 3 * gust) + 0.3) * 0.07
      const belly = 1 - amp * 0.72
      sailRef.current.scale.set(camberSide.current * belly, Math.max(h, 0.001), 1)
      sailRef.current.visible = h > 0.02
    }
    if (jibRef.current) {
      poseJib(jibMesh, jibRig, getClew(), getJibHoist(), trim.jib.luff, time)
      jibRef.current.visible = getJibHoist() > 0.02
    }
    if (vaneRef.current) vaneRef.current.rotation.y = trim.main.awa
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
      // Trail the heading by about a second, then sit at the same angle relative to the boat.
      const lagged = chaseYaw(prev.yaw, pose.yaw, delta, CHASE_YAW_LAG)
      const dYaw = lagged - prev.yaw
      prev.yaw = lagged
      camera.position.x += pose.x - prev.x
      camera.position.y += y - prev.y
      camera.position.z += pose.z - prev.z
      if (dYaw !== 0) {
        const off = rotateYaw(camera.position.x - pose.x, camera.position.z - pose.z, dYaw)
        camera.position.x = pose.x + off.x
        camera.position.z = pose.z + off.z
      }
      orbit.target.set(pose.x, y + 1.15, pose.z)
      camera.lookAt(orbit.target)
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
      <group ref={boomRef} position={[rig.boomX, rig.boomY, rig.boomZ]}>
        <primitive object={boomMesh} />
        <group ref={sailRef} visible={false}>
          <primitive object={sailMesh} />
        </group>
      </group>
      <group ref={jibRef} visible={false}>
        <primitive object={jibMesh} />
      </group>
      <group ref={vaneRef} position={[0, rig.vaneY, rig.vaneZ]}>
        <primitive object={vaneMesh} />
      </group>
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
