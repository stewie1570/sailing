import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import type { MapData } from '../../map/mapData'
import { applyCameraNudge } from '../cameraDrive'
import { QUALITY_PRESETS, useQuality } from '../quality'
import { inHarbor } from '../harborLayout'
import { blocked, colliderWorld, hullClearance, hullOverlap, hullPenetration } from './collision'
import {
  buildBoom,
  buildFenders,
  buildJib,
  buildMainsail,
  buildSpin,
  buildPropeller,
  buildPropStrut,
  buildRudder,
  buildSailboat,
  buildVane,
  buildWheel,
  helmHardware,
  jibFrame,
  poseJib,
  poseSpin,
  rigFrame,
  spinFrame,
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
import { getBoom, getClew, getHoist, getJibHoist, getSpinHalf, getSpinHoist, luffAmount, readRig, stepHoist, stepJibHoist, stepSpinHoist } from './sail'
import { getWind, getWindDebug, stepWind } from './wind'
import { MAX_SAILORS } from '../../net/protocol'
import { eachFreshShip, myPlayerId, noteLocalShip } from '../../net/session'
import {
  activeClaim,
  beginSink,
  clearWreck,
  decideRam,
  freshWreck,
  holdStill,
  noteClaim,
  RAM_TOUCH,
  RESPAWN_SAFE_MS,
  resumeBerth,
  sinkPitch,
  stepWreck,
  type RamContact,
} from './ram'
import { publishTelemetry, publishWheel } from './telemetry'

type OrbitLike = { target: THREE.Vector3; update: () => void }

function disposeMesh(mesh: THREE.Mesh) {
  mesh.geometry.dispose()
  const material = mesh.material
  if (Array.isArray(material)) material.forEach((m) => m.dispose())
  else material.dispose()
}

/**
 * The player's sloop. Twin screws and a rudder, a main on the boom, a jib
 * on the forestay, and an asymmetric spinnaker. The wheel and the blade turn with the helm. Each sail swings
 * only as far as its sheet allows, and the wind pushes it out. The hull stops when it
 * meets the shore, a dock, or any other solid mesh. Fenders hung in a harbor are
 * only drawn, so the dock still meets the topsides and the fenders look squeezed.
 * Another sailor is solid too.
 * The boat going forward into that hull wins, and the one it drove into sinks
 * to the lakebed, then comes back at the berth it started on. The camera rides along
 * and chases the heading about a second behind, finishing at the same angle
 * relative to the hull.
 */
export function Boat({ map, slot = 0 }: { map: MapData; slot?: number }) {
  const hull = useMemo(() => buildSailboat(), [])
  const fenders = useMemo(() => buildFenders(), [])
  const [fendersHung, setFendersHung] = useState(false)
  const wheel = useMemo(() => buildWheel(), [])
  const boomMesh = useMemo(() => buildBoom(), [])
  const sailMesh = useMemo(() => buildMainsail(), [])
  const jibMesh = useMemo(() => buildJib(), [])
  const spinMesh = useMemo(() => buildSpin(), [])
  const vaneMesh = useMemo(() => buildVane(), [])
  const rig = useMemo(() => rigFrame(), [])
  const jibRig = useMemo(() => jibFrame(), [])
  const spinRig = useMemo(() => spinFrame(), [])
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
  // The slot is the berth assigned when we entered. Later roster edits must not move the hull.
  const [berth] = useState(slot)
  const origin = useMemo(() => spawnPose(map, berth), [map, berth])
  const pose = useMemo<Pose>(() => ({ ...origin }), [origin])
  const wreckRef = useRef(freshWreck())
  const fleetRef = useRef<{
    id: string
    x: number
    z: number
    yaw: number
    speed: number
    heave: number
    sink: number
    ram: string
    sunk: number
    pushed: boolean
  }[] | null>(null)
  const group = useRef<THREE.Group>(null)
  const wheelRef = useRef<THREE.Group>(null)
  const boomRef = useRef<THREE.Group>(null)
  const sailRef = useRef<THREE.Group>(null)
  const jibRef = useRef<THREE.Group>(null)
  const spinSailRef = useRef<THREE.Group>(null)
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
      for (const mesh of [hull, fenders, wheel, boomMesh, sailMesh, jibMesh, spinMesh, vaneMesh, rudderMesh, portProp, stbdProp, portStrut, stbdStrut]) disposeMesh(mesh)
    }
  }, [hull, fenders, wheel, boomMesh, sailMesh, jibMesh, spinMesh, vaneMesh, rudderMesh, portProp, stbdProp, portStrut, stbdStrut])

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
      get spin() { return getHelm().spin },
      get jibPort() { return getHelm().jibPort },
      get jibStarboard() { return getHelm().jibStarboard },
      get jibHoist() { return getJibHoist() },
      get spinHoist() { return getSpinHoist() },
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
      setSpin(spin: number) {
        updateHelm({ spin })
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
        clearWreck(wreckRef.current)
        wreckRef.current.safeUntil = 0
        wreckRef.current.claimId = ''
        wreckRef.current.claimUntil = 0
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
    stepSpinHoist(drive.spin, frame)
    const wind = getWind()
    const wreck = wreckRef.current
    if (wreck.phase !== 'sail') {
      if (stepWreck(wreck, delta)) {
        resumeBerth(pose, origin)
        clearWreck(wreck)
        wreck.safeUntil = performance.now() + RESPAWN_SAFE_MS
        follow.current.yaw = origin.yaw
      }
    } else {
      // Other sailors are the authority for their own boats. This hull stops against
      // the pose they published, the way it stops against a dock. If a late packet
      // left us inside them, a move that climbs back out is still allowed. A bow
      // that drives into them names them; the named hull sinks and respawns.
      const fleet = fleetRef.current ??= Array.from({ length: MAX_SAILORS }, () => ({
        id: '', x: 0, z: 0, yaw: 0, speed: 0, heave: 0, sink: 0, ram: '', sunk: 0, pushed: false,
      }))
      let fleetCount = 0
      eachFreshShip((ship) => {
        if (fleetCount >= fleet.length) return
        const other = fleet[fleetCount++]
        other.id = ship.playerId
        other.x = ship.x
        other.z = ship.z
        other.yaw = ship.yaw
        other.speed = ship.speed || 0
        other.sink = ship.sink || 0
        other.ram = ship.ram || ''
        other.heave = swell(ship.x, ship.z, time) - other.sink
        other.pushed = false
      })
      const started = swell(pose.x, pose.z, time)
      for (let i = 0; i < fleetCount; i++) {
        const other = fleet[i]
        other.sunk = hullPenetration(
          world.shape, pose.x, pose.z, pose.yaw, started,
          other.x, other.z, other.yaw, other.heave,
        )
      }
      let boatHit = false
      let ramSpeed = pose.speed
      integrate(pose, drive, delta, (x, z, yaw, probe) => {
        const heave = swell(x, z, time)
        if (blocked(world, x, z, yaw, heave)) return true
        for (let i = 0; i < fleetCount; i++) {
          const other = fleet[i]
          const pen = hullPenetration(
            world.shape, x, z, yaw, heave,
            other.x, other.z, other.yaw, other.heave,
            Math.max(other.sunk, 1e-4),
          )
          if (pen > 0 && pen > other.sunk - 0.001) {
            // Clearance samples must not count as driving into someone.
            if (!probe) {
              if (!boatHit) ramSpeed = pose.speed
              boatHit = true
              other.pushed = true
            }
            return true
          }
        }
        return false
      }, {
        wind,
        sail: {
          hoist: getHoist(),
          sheet: drive.sheet,
          jibHoist: getJibHoist(),
          jibPort: drive.jibPort,
          jibStarboard: drive.jibStarboard,
          spinHoist: getSpinHoist(),
        },
      }, (x, z, yaw) => hullOverlap(world, x, z, yaw, swell(x, z, time)))
      const here = swell(pose.x, pose.z, time)
      const reach = world.shape.radius * 2 + RAM_TOUCH + 1.5
      const contacts: RamContact[] = []
      for (let i = 0; i < fleetCount; i++) {
        const other = fleet[i]
        let gap = Infinity
        if (!other.pushed) {
          const dx = other.x - pose.x
          const dz = other.z - pose.z
          if (dx * dx + dz * dz <= reach * reach) {
            gap = hullClearance(
              world.shape, pose.x, pose.z, pose.yaw, here,
              other.x, other.z, other.yaw, other.heave,
            )
          }
        }
        contacts.push({
          id: other.id,
          x: other.x,
          z: other.z,
          yaw: other.yaw,
          speed: other.speed,
          gap: other.pushed ? 0 : gap,
          pushed: other.pushed,
          ram: other.ram,
          sinking: other.sink > 0.35,
        })
      }
      const decision = decideRam(
        myPlayerId(),
        { x: pose.x, z: pose.z, yaw: pose.yaw, speed: boatHit ? ramSpeed : pose.speed },
        contacts,
        performance.now() < wreck.safeUntil,
      )
      if (decision.sink) {
        beginSink(wreck, map.heightAt(pose.x, pose.z))
        holdStill(pose)
      } else if (decision.claim) {
        noteClaim(wreck, decision.claim, performance.now())
      }
    }
    publishTelemetry(pose)

    const spin = Math.min(Math.max(delta, 0), 0.1)
    if (wheelRef.current) wheelRef.current.rotation.z = drive.rudder * WHEEL_LOCK
    if (rudderRef.current) rudderRef.current.rotation.y = drive.rudder * RUDDER_LOCK
    const boomAngle = getBoom()
    const trim = readRig(pose, wind)
    const hoistNow = getHoist()
    const flap = luffAmount(trim.main.aoa, trim.main.awa, hoistNow)
    noteLocalShip(
      pose.x,
      pose.z,
      pose.yaw,
      drive.rudder,
      drive.port,
      drive.starboard,
      hoistNow,
      boomAngle,
      getJibHoist(),
      getClew(),
      trim.main.awa,
      flap,
      trim.jib.luff,
      getSpinHoist(),
      trim.spin.luff,
      pose.speed,
      pose.sway,
      drive.bow,
      drive.stern,
      wreck.depth,
      activeClaim(wreck, performance.now()),
    )
    if (boomRef.current) boomRef.current.rotation.y = boomAngle
    if (sailRef.current) {
      const h = hoistNow
      if (Math.abs(boomAngle) > 0.08) camberSide.current = boomAngle > 0 ? -1 : 1
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
    if (spinSailRef.current) {
      poseSpin(spinMesh, spinRig, getClew(), getSpinHalf(), getSpinHoist(), trim.spin.luff, time)
      spinSailRef.current.visible = getSpinHoist() > 0.02
    }
    if (vaneRef.current) vaneRef.current.rotation.y = trim.main.awa
    if (portSpinRef.current) portSpinRef.current.rotation.z += drive.port * 16 * spin
    if (stbdSpinRef.current) stbdSpinRef.current.rotation.z -= drive.starboard * 16 * spin

    const y = swell(pose.x, pose.z, time) - wreck.depth
    const g = group.current
    if (g) {
      g.position.set(pose.x, y, pose.z)
      g.rotation.x = sinkPitch(wreck.depth)
      g.rotation.y = pose.yaw
      g.updateWorldMatrix(true, false)
    }
    // Hung only inside a basin. The mesh is not part of the collider, so this is only a draw flag.
    const hung = inHarbor(map, pose.x, pose.z)
    if (hung !== fendersHung) setFendersHung(hung)

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
      applyCameraNudge(camera, orbit.target)
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
      <primitive object={fenders} visible={fendersHung} />
      <group ref={boomRef} position={[rig.boomX, rig.boomY, rig.boomZ]}>
        <primitive object={boomMesh} />
        <group ref={sailRef} visible={false}>
          <primitive object={sailMesh} />
        </group>
      </group>
      <group ref={jibRef} visible={false}>
        <primitive object={jibMesh} />
      </group>
      <group ref={spinSailRef} visible={false}>
        <primitive object={spinMesh} />
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
