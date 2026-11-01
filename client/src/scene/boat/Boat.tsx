import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { MapData } from '../../map/mapData'
import { QUALITY_PRESETS, useQuality } from '../quality'
import { blocked, colliderWorld } from './collision'
import { buildBoom, buildFurledMain, buildMainsail, buildSailboat, mainBoomPivot, setMainBoomYaw, setMainsailCamber } from './geometry'
import { clearHelmSource, helmInput, setHelm, type HelmDir } from './helm'
import { chaseYaw, CHASE_YAW_LAG, integrate, rotateYaw, spawnPose, swell, type Pose } from './physics'
import { boomYawFromSheet, getSail, setMainOut, setMainSheet } from './sail'

const KEYS: Record<string, HelmDir> = {
  ArrowUp: 'forward',
  ArrowDown: 'back',
  ArrowLeft: 'port',
  ArrowRight: 'starboard',
}

type OrbitLike = { target: THREE.Vector3; update: () => void }

/**
 * Pose the boom and mainsail from the sailing controls. `delta` ≤ 0 snaps the hoist,
 * which is what the first frame wants; later frames ease the sail up or down.
 */
function applySail(
  boom: THREE.Group | null,
  sail: THREE.Group | null,
  furled: THREE.Group | null,
  sailMesh: THREE.Mesh,
  hoist: { current: number },
  delta: number,
) {
  const { mainOut, mainSheet } = getSail()
  const yaw = boomYawFromSheet(mainSheet)
  setMainBoomYaw(yaw)
  if (boom) boom.rotation.y = yaw
  const target = mainOut ? 1 : 0
  if (delta <= 0) hoist.current = target
  else hoist.current += (target - hoist.current) * (1 - Math.exp(-delta * 2.4))
  hoist.current = Math.min(1, Math.max(0, hoist.current))
  const raised = hoist.current
  if (sail) {
    setMainsailCamber(sailMesh, mainSheet)
    sail.scale.y = Math.max(raised, 0.0001)
    sail.visible = raised > 0.015
  }
  if (furled) {
    const down = 1 - raised
    furled.scale.y = Math.max(down, 0.0001)
    furled.visible = down > 0.015
  }
}

/**
 * The player's sloop. Arrows (and the engine pad) accelerate and yaw.
 * The sailing tab hoists the main and sheets the boom; the boom spar moves
 * with that angle, so it stops the hull the same way the mast does.
 * The camera rides along and chases the heading about a second behind,
 * finishing at the same angle relative to the hull.
 */
export function Boat({ map }: { map: MapData }) {
  const mesh = useMemo(() => buildSailboat(), [])
  const boomMesh = useMemo(() => buildBoom(), [])
  const sailMesh = useMemo(() => buildMainsail(), [])
  const furledMesh = useMemo(() => buildFurledMain(), [])
  const pivot = useMemo(() => mainBoomPivot(), [])
  const quality = useQuality()
  const preset = QUALITY_PRESETS[quality]
  const world = useMemo(
    () => colliderWorld(map, preset.terrainSegments, preset.treeFraction),
    [map, preset.terrainSegments, preset.treeFraction],
  )
  const pose = useMemo<Pose>(() => spawnPose(map), [map])
  const group = useRef<THREE.Group>(null)
  const boomPivot = useRef<THREE.Group>(null)
  const sailPivot = useRef<THREE.Group>(null)
  const furledPivot = useRef<THREE.Group>(null)
  const hoist = useRef(getSail().mainOut ? 1 : 0)
  const follow = useRef({ x: pose.x, y: 0, z: pose.z, yaw: pose.yaw })
  const camera = useThree((s) => s.camera)
  const controls = useThree((s) => s.controls)

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const dir = KEYS[e.key]
      if (!dir) return
      e.preventDefault()
      if (e.repeat) return
      setHelm('keys', dir, true)
    }
    const up = (e: KeyboardEvent) => {
      const dir = KEYS[e.key]
      if (!dir) return
      e.preventDefault()
      setHelm('keys', dir, false)
    }
    const blur = () => clearHelmSource('keys')
    window.addEventListener('keydown', down, true)
    window.addEventListener('keyup', up, true)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', down, true)
      window.removeEventListener('keyup', up, true)
      window.removeEventListener('blur', blur)
      clearHelmSource('keys')
    }
  }, [])

  useLayoutEffect(() => {
    applySail(boomPivot.current, sailPivot.current, furledPivot.current, sailMesh, hoist, 0)
  }, [sailMesh])

  useEffect(() => {
    const meshes = [mesh, boomMesh, sailMesh, furledMesh]
    return () => {
      for (const m of meshes) {
        m.geometry.dispose()
        const material = m.material
        if (Array.isArray(material)) material.forEach((mat) => mat.dispose())
        else material.dispose()
      }
    }
  }, [mesh, boomMesh, sailMesh, furledMesh])

  useEffect(() => {
    if (!import.meta.env.DEV) return
    const w = window as unknown as { __sailing?: Record<string, unknown> }
    const sailing = (w.__sailing ??= {})
    const api = {
      get x() { return pose.x },
      get z() { return pose.z },
      get yaw() { return pose.yaw },
      get speed() { return pose.speed },
      place(x: number, z: number, yaw?: number) {
        const dx = x - pose.x
        const dz = z - pose.z
        pose.x = x
        pose.z = z
        if (yaw != null) pose.yaw = yaw
        pose.speed = 0
        camera.position.x += dx
        camera.position.z += dz
        follow.current.x = pose.x
        follow.current.z = pose.z
        follow.current.yaw = pose.yaw
        const orbit = controls as OrbitLike | null
        orbit?.target.set(pose.x, follow.current.y + 1.15, pose.z)
      },
      get mainOut() { return getSail().mainOut },
      get mainSheet() { return getSail().mainSheet },
      get hoist() { return hoist.current },
      get boomYaw() { return boomPivot.current?.rotation.y ?? 0 },
      setMainOut,
      setMainSheet,
    }
    sailing.boat = api
    return () => {
      if (w.__sailing) delete w.__sailing.boat
    }
  }, [pose, camera, controls])

  useFrame((state, delta) => {
    applySail(boomPivot.current, sailPivot.current, furledPivot.current, sailMesh, hoist, delta)
    const { throttle, turn } = helmInput()
    const time = state.clock.elapsedTime
    integrate(pose, throttle, turn, delta, (x, z, yaw) => blocked(world, x, z, yaw, swell(x, z, time)))

    const y = swell(pose.x, pose.z, time)
    const g = group.current
    if (g) {
      g.position.set(pose.x, y, pose.z)
      g.rotation.y = pose.yaw
    }

    const orbit = controls as OrbitLike | null
    if (!orbit?.target) return
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
  })

  return (
    <group ref={group} position={[pose.x, 0, pose.z]} rotation={[0, pose.yaw, 0]}>
      <primitive object={mesh} />
      <group ref={boomPivot} name="boom" position={[0, pivot.y, pivot.z]}>
        <primitive object={boomMesh} />
        <group ref={furledPivot} name="furled-main">
          <primitive object={furledMesh} />
        </group>
        <group ref={sailPivot} name="mainsail">
          <primitive object={sailMesh} />
        </group>
      </group>
    </group>
  )
}
