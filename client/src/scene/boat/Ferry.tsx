import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import type { MapData } from '../../map/mapData'
import { MAX_SAILORS } from '../../net/protocol'
import { eachFreshShip, myPlayerId, noteLocalShip } from '../../net/session'
import { applyCameraNudge } from '../cameraDrive'
import { QUALITY_PRESETS, useQuality } from '../quality'
import { blocked, colliderWorld, hullClearance, hullOverlap, hullPenetration } from './collision'
import { stepFerry } from './ferryDynamics'
import { POD_Y, POD_Z, FERRY_CARGO, buildFerry, buildPod, buildPodScrew, ferryShape } from './ferryGeometry'
import { useChallenge } from '../challenge'
import { Crate } from '../ChallengeView'
import { getPods, updatePods } from './pods'
import {
  chaseYaw,
  CHASE_YAW_LAG,
  integrate,
  rotateYaw,
  spawnPose,
  swell,
  type Pose,
} from './physics'
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
import { hullShape } from './shapes'
import { publishTelemetry } from './telemetry'
import { vesselView } from './vessel'

type OrbitLike = { target: THREE.Vector3; update: () => void }

function disposeMesh(mesh: THREE.Mesh) {
  mesh.geometry.dispose()
  const material = mesh.material
  if (Array.isArray(material)) material.forEach((item) => item.dispose())
  else material.dispose()
}

/**
 * The player's vehicle ferry. Two azimuth pods, nothing else. Sails, the
 * wheel and the twin screws are not on this hull, and this frame does not
 * step them. Another sailor is a published pose and a static outline.
 */
export function Ferry({ map, slot = 0 }: { map: MapData; slot?: number }) {
  const cargoOnDeck = useChallenge().cargo === 'deck'
  const hull = useMemo(() => buildFerry(), [])
  const bowPod = useMemo(() => buildPod(), [])
  const sternPod = useMemo(() => buildPod(), [])
  const bowScrew = useMemo(() => buildPodScrew(), [])
  const sternScrew = useMemo(() => buildPodScrew(), [])
  const shape = useMemo(() => ferryShape(), [])
  const view = vesselView('ferry')
  const quality = useQuality()
  const preset = QUALITY_PRESETS[quality]
  const world = useMemo(
    () => colliderWorld(map, preset.terrainSegments, preset.treeFraction, shape),
    [map, preset.terrainSegments, preset.treeFraction, shape],
  )
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
    kind: string
    sunk: number
    pushed: boolean
  }[] | null>(null)
  const group = useRef<THREE.Group>(null)
  const bowRef = useRef<THREE.Group>(null)
  const sternRef = useRef<THREE.Group>(null)
  const bowSpinRef = useRef<THREE.Group>(null)
  const sternSpinRef = useRef<THREE.Group>(null)
  const follow = useRef({ x: pose.x, y: 0, z: pose.z, yaw: pose.yaw })
  const camera = useThree((s) => s.camera)
  const controls = useThree((s) => s.controls)

  useEffect(() => {
    return () => {
      for (const mesh of [hull, bowPod, sternPod, bowScrew, sternScrew]) disposeMesh(mesh)
    }
  }, [hull, bowPod, sternPod, bowScrew, sternScrew])

  useEffect(() => {
    if (!import.meta.env.DEV) return
    const w = window as unknown as { __sailing?: Record<string, unknown> }
    const sailing = (w.__sailing ??= {})
    sailing.boat = {
      get x() { return pose.x },
      get z() { return pose.z },
      get yaw() { return pose.yaw },
      get speed() { return pose.speed },
      get sway() { return pose.sway },
      get yawRate() { return pose.yawRate },
      get pods() { return getPods() },
      drive(bowAz: number, bowThrust: number, sternAz: number, sternThrust: number) {
        updatePods({ bowAz, bowThrust, sternAz, sternThrust })
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
        camera.position.x += dx
        camera.position.z += dz
        follow.current.x = pose.x
        follow.current.z = pose.z
        follow.current.yaw = pose.yaw
        const orbit = controls as OrbitLike | null
        orbit?.target.set(pose.x, follow.current.y + view.look, pose.z)
      },
    }
    return () => {
      if (w.__sailing) delete w.__sailing.boat
    }
  }, [pose, camera, controls, view.look])

  useFrame((state, delta) => {
    const command = getPods()
    const time = state.clock.elapsedTime
    const wreck = wreckRef.current
    if (wreck.phase !== 'sail') {
      if (stepWreck(wreck, delta)) {
        resumeBerth(pose, origin)
        clearWreck(wreck)
        wreck.safeUntil = performance.now() + RESPAWN_SAFE_MS
        follow.current.yaw = origin.yaw
      }
    } else {
      const fleet = fleetRef.current ??= Array.from({ length: MAX_SAILORS }, () => ({
        id: '', x: 0, z: 0, yaw: 0, speed: 0, heave: 0, sink: 0, ram: '', kind: 'sail', sunk: 0, pushed: false,
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
        other.kind = ship.kind === 'ferry' ? 'ferry' : 'sail'
        other.heave = swell(ship.x, ship.z, time) - other.sink
        other.pushed = false
      })
      const started = swell(pose.x, pose.z, time)
      for (let i = 0; i < fleetCount; i++) {
        const other = fleet[i]
        other.sunk = hullPenetration(
          shape, pose.x, pose.z, pose.yaw, started,
          other.x, other.z, other.yaw, other.heave,
          Infinity,
          hullShape(other.kind),
        )
      }
      let boatHit = false
      let ramSpeed = pose.speed
      integrate(pose, delta, (x, z, yaw, probe) => {
        const heave = swell(x, z, time)
        if (blocked(world, x, z, yaw, heave, shape)) return true
        for (let i = 0; i < fleetCount; i++) {
          const other = fleet[i]
          const pen = hullPenetration(
            shape, x, z, yaw, heave,
            other.x, other.z, other.yaw, other.heave,
            Math.max(other.sunk, 1e-4),
            hullShape(other.kind),
          )
          if (pen > 0 && pen > other.sunk - 0.001) {
            if (!probe) {
              if (!boatHit) ramSpeed = pose.speed
              boatHit = true
              other.pushed = true
            }
            return true
          }
        }
        return false
      }, (body, step) => {
        stepFerry(body, command, step)
      }, (x, z, yaw) => hullOverlap(world, x, z, yaw, swell(x, z, time), shape))
      const here = swell(pose.x, pose.z, time)
      const contacts: RamContact[] = []
      for (let i = 0; i < fleetCount; i++) {
        const other = fleet[i]
        const theirs = hullShape(other.kind)
        const reach = shape.radius + theirs.radius + RAM_TOUCH + 1.5
        let gap = Infinity
        if (!other.pushed) {
          const dx = other.x - pose.x
          const dz = other.z - pose.z
          if (dx * dx + dz * dz <= reach * reach) {
            gap = hullClearance(
              shape, pose.x, pose.z, pose.yaw, here,
              other.x, other.z, other.yaw, other.heave,
              theirs,
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
    noteLocalShip({
      kind: 'ferry',
      x: pose.x,
      z: pose.z,
      yaw: pose.yaw,
      rudder: 0,
      port: 0,
      starboard: 0,
      hoist: 0,
      boom: 0,
      jibHoist: 0,
      clew: 0,
      vane: 0,
      luff: 0,
      jibLuff: 0,
      spinHoist: 0,
      spinLuff: 0,
      speed: pose.speed,
      sway: pose.sway,
      sink: wreck.depth,
      ram: activeClaim(wreck, performance.now()),
      bowAz: command.bowAz,
      sternAz: command.sternAz,
      bowThrust: command.bowThrust,
      sternThrust: command.sternThrust,
    })

    const spin = Math.min(Math.max(delta, 0), 0.1)
    // The screw faces opposite the push, so ahead thrust drives the hull forward.
    if (bowRef.current) bowRef.current.rotation.y = command.bowAz + Math.PI
    if (sternRef.current) sternRef.current.rotation.y = command.sternAz + Math.PI
    if (bowSpinRef.current) bowSpinRef.current.rotation.z += command.bowThrust * 14 * spin
    if (sternSpinRef.current) sternSpinRef.current.rotation.z += command.sternThrust * 14 * spin

    const y = swell(pose.x, pose.z, time) - wreck.depth
    const g = group.current
    if (g) {
      g.position.set(pose.x, y, pose.z)
      g.rotation.x = sinkPitch(wreck.depth)
      g.rotation.y = pose.yaw
    }
    const orbit = controls as OrbitLike | null
    if (orbit?.target) {
      const prev = follow.current
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
      orbit.target.set(pose.x, y + view.look, pose.z)
      applyCameraNudge(camera, orbit.target)
      camera.lookAt(orbit.target)
      prev.x = pose.x
      prev.y = y
      prev.z = pose.z
    }
  })

  return (
    <group ref={group} position={[pose.x, 0, pose.z]} rotation={[0, pose.yaw, 0]}>
      <primitive object={hull} />
      {cargoOnDeck && (
        <group position={[FERRY_CARGO.x, FERRY_CARGO.y, FERRY_CARGO.z]}>
          <Crate />
        </group>
      )}
      <group ref={bowRef} position={[0, POD_Y, POD_Z]}>
        <primitive object={bowPod} />
        <group ref={bowSpinRef} position={[0, 0, 1.05]}>
          <primitive object={bowScrew} />
        </group>
      </group>
      <group ref={sternRef} position={[0, POD_Y, -POD_Z]}>
        <primitive object={sternPod} />
        <group ref={sternSpinRef} position={[0, 0, 1.05]}>
          <primitive object={sternScrew} />
        </group>
      </group>
    </group>
  )
}
