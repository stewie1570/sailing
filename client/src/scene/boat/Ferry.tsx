import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import type { MapData } from '../../map/mapData'
import { MAX_SAILORS } from '../../net/protocol'
import { eachFreshShip, myPlayerId, noteLocalShip } from '../../net/session'
import { applyNudge, consumeCameraNudge } from '../cameraDrive'
import { QUALITY_PRESETS, useQuality } from '../quality'
import { blocked, colliderWorld, hullClearance, hullOverlap, hullPenetration } from './collision'
import { stepFerry } from './ferryDynamics'
import { POD_Y, POD_Z, BRIDGE_EYE, FERRY_CARGO, buildFerry, buildPod, buildPodScrew, buildWheelhouse, ferryShape } from './ferryGeometry'
import { bridgeExitLocal, bridgeLookDir, overFerryDeck, shipToWorld, worldToShip } from './ferryBridge'
import { useChallenge } from '../challenge'
import { Cars } from '../ChallengeView'
import { getPods, stepPods, updatePods } from './pods'
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

type OrbitLike = {
  target: THREE.Vector3
  update: () => void
  enabled?: boolean
  sphericalDelta?: { set: (x: number, y: number, z: number) => void }
}

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
  const house = useMemo(() => buildWheelhouse(), [])
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
  const gl = useThree((s) => s.gl)
  const bridge = useRef(false)
  const look = useRef({ yaw: 0, pitch: -0.08 })
  const leaveBridge = useRef(false)
  const outsideNear = useRef(1.5)

  useEffect(() => {
    return () => {
      for (const mesh of [hull, house, bowPod, sternPod, bowScrew, sternScrew]) disposeMesh(mesh)
    }
  }, [hull, house, bowPod, sternPod, bowScrew, sternScrew])

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

  useEffect(() => {
    const el = gl.domElement
    const pointers = new Map<number, { x: number; y: number }>()
    let drag: number | null = null
    let pinch: number | null = null
    const span = () => {
      const pts = [...pointers.values()]
      if (pts.length < 2) return 0
      return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)
    }
    const onDown = (event: PointerEvent) => {
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
      if (!bridge.current) return
      if (event.pointerType === 'mouse' && event.button !== 0) return
      drag = event.pointerId
      el.setPointerCapture(event.pointerId)
    }
    const onMove = (event: PointerEvent) => {
      const prev = pointers.get(event.pointerId)
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
      if (!bridge.current) return
      if (pointers.size >= 2) {
        const next = span()
        if (pinch != null && pinch > 0 && next > pinch * 1.08) leaveBridge.current = true
        pinch = next
        return
      }
      pinch = null
      if (drag !== event.pointerId || !prev) return
      // Drag left looks left, drag down looks down.
      look.current.yaw -= (event.clientX - prev.x) * 0.0032
      look.current.pitch = Math.min(1.15, Math.max(-1.2, look.current.pitch - (event.clientY - prev.y) * 0.0032))
    }
    const onUp = (event: PointerEvent) => {
      pointers.delete(event.pointerId)
      if (drag === event.pointerId) drag = null
      pinch = pointers.size >= 2 ? span() : null
    }
    const onWheel = (event: WheelEvent) => {
      if (!bridge.current) return
      event.preventDefault()
      if (event.deltaY > 0) leaveBridge.current = true
    }
    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
    el.addEventListener('pointercancel', onUp)
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
      el.removeEventListener('pointercancel', onUp)
      el.removeEventListener('wheel', onWheel)
      bridge.current = false
      const orbit = controls as OrbitLike | null
      if (orbit) orbit.enabled = true
      const cam = camera as THREE.PerspectiveCamera
      if (cam.isPerspectiveCamera && cam.near < 0.4) {
        cam.near = outsideNear.current
        cam.updateProjectionMatrix()
      }
    }
  }, [camera, controls, gl])

  useFrame((state, delta) => {
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
        stepPods(step)
        stepFerry(body, getPods(), step)
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
    const command = getPods()
    const bowAim = command.bowAim ?? command.bowAz
    const sternAim = command.sternAim ?? command.sternAz
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
      bowAz: bowAim,
      sternAz: sternAim,
      bowThrust: command.bowThrust,
      sternThrust: command.sternThrust,
    })

    const spin = Math.min(Math.max(delta, 0), 0.1)
    // The screw faces opposite the push, so ahead thrust drives the hull forward.
    if (bowRef.current) bowRef.current.rotation.y = bowAim + Math.PI
    if (sternRef.current) sternRef.current.rotation.y = sternAim + Math.PI
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
      const nudged = consumeCameraNudge()
      const cam = camera as THREE.PerspectiveCamera
      const prev = follow.current
      if (bridge.current) {
        look.current.yaw -= nudged.yaw
        look.current.pitch = Math.min(1.15, Math.max(-1.2, look.current.pitch + nudged.height * 0.06))
        const zoomOut = leaveBridge.current || nudged.distance > 1.001
        leaveBridge.current = false
        if (zoomOut) {
          bridge.current = false
          orbit.enabled = true
          orbit.sphericalDelta?.set(0, 0, 0)
          if (cam.isPerspectiveCamera) {
            cam.near = outsideNear.current
            cam.updateProjectionMatrix()
          }
          const spot = shipToWorld(pose, y, bridgeExitLocal(look.current.yaw))
          camera.position.set(spot.x, spot.y, spot.z)
          orbit.target.set(pose.x, y + view.look, pose.z)
          camera.lookAt(orbit.target)
          prev.yaw = pose.yaw
        } else {
          orbit.enabled = false
          if (cam.isPerspectiveCamera && cam.near > 0.4) {
            outsideNear.current = cam.near
            cam.near = 0.15
            cam.updateProjectionMatrix()
          }
          const eye = shipToWorld(pose, y, BRIDGE_EYE)
          const dir = bridgeLookDir(pose.yaw, look.current.yaw, look.current.pitch)
          camera.position.set(eye.x, eye.y, eye.z)
          orbit.target.set(eye.x + dir.x * 3, eye.y + dir.y * 3, eye.z + dir.z * 3)
          camera.lookAt(orbit.target)
        }
      } else {
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
        applyNudge(camera, orbit.target, nudged)
        camera.lookAt(orbit.target)
        const local = worldToShip(pose, y, camera.position.x, camera.position.y, camera.position.z)
        if (overFerryDeck(local.x, local.y, local.z)) {
          bridge.current = true
          look.current.yaw = 0
          look.current.pitch = 0
          orbit.enabled = false
          if (cam.isPerspectiveCamera && cam.near > 0.4) {
            outsideNear.current = cam.near
            cam.near = 0.15
            cam.updateProjectionMatrix()
          }
          const eye = shipToWorld(pose, y, BRIDGE_EYE)
          const dir = bridgeLookDir(pose.yaw, look.current.yaw, look.current.pitch)
          camera.position.set(eye.x, eye.y, eye.z)
          orbit.target.set(eye.x + dir.x * 3, eye.y + dir.y * 3, eye.z + dir.z * 3)
          camera.lookAt(orbit.target)
        }
      }
      prev.x = pose.x
      prev.y = y
      prev.z = pose.z
    }
    // The cabin is only the outside shell. From the chair it is left off,
    // so the view is the deck and the lake.
    house.visible = !bridge.current
  })

  return (
    <group ref={group} position={[pose.x, 0, pose.z]} rotation={[0, pose.yaw, 0]}>
      <primitive object={hull} />
      <primitive object={house} />
      {cargoOnDeck && (
        <group position={[FERRY_CARGO.x, FERRY_CARGO.y, FERRY_CARGO.z]}>
          <Cars file />
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
