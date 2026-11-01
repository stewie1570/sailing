import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { MapData } from '../../map/mapData'
import { QUALITY_PRESETS, useQuality } from '../quality'
import { blocked, colliderWorld } from './collision'
import { buildSailboat } from './geometry'
import { clearHelmSource, helmInput, setHelm, type HelmDir } from './helm'
import { chaseYaw, CHASE_YAW_LAG, integrate, rotateYaw, spawnPose, swell, type Pose } from './physics'

const KEYS: Record<string, HelmDir> = {
  ArrowUp: 'forward',
  ArrowDown: 'back',
  ArrowLeft: 'port',
  ArrowRight: 'starboard',
}

type OrbitLike = { target: THREE.Vector3; update: () => void }

/**
 * The player's sloop. Arrows (and the on-screen pad) accelerate and yaw.
 * The hull stops when it meets the shore, a dock, or any other solid mesh,
 * and not before those meshes touch. The camera rides along and chases the
 * heading about a second behind, finishing at the same angle relative to the hull.
 */
export function Boat({ map }: { map: MapData }) {
  const mesh = useMemo(() => buildSailboat(), [])
  const quality = useQuality()
  const preset = QUALITY_PRESETS[quality]
  const world = useMemo(
    () => colliderWorld(map, preset.terrainSegments, preset.treeFraction),
    [map, preset.terrainSegments, preset.treeFraction],
  )
  const pose = useMemo<Pose>(() => spawnPose(map), [map])
  const group = useRef<THREE.Group>(null)
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

  useEffect(() => {
    return () => {
      mesh.geometry.dispose()
      const material = mesh.material
      if (Array.isArray(material)) material.forEach((m) => m.dispose())
      else material.dispose()
    }
  }, [mesh])

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
    }
    sailing.boat = api
    return () => {
      if (w.__sailing) delete w.__sailing.boat
    }
  }, [pose, camera, controls])

  useFrame((state, delta) => {
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
    </group>
  )
}
