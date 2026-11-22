import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { MapData } from '../../map/mapData'
import { remoteShip, shipIsFresh, useRemoteShipIds, useShipKind } from '../../net/session'
import { POD_Y, POD_Z, buildFerry, buildPod, buildPodScrew } from './ferryGeometry'
import { swell } from './physics'
import { sinkPitch } from './ram'
import { RemoteBoat, makeNameSprite, retitle } from './RemoteBoat'

function disposeMesh(mesh: THREE.Mesh) {
  mesh.geometry.dispose()
  const material = mesh.material
  if (Array.isArray(material)) material.forEach((item) => item.dispose())
  else material.dispose()
}

/**
 * Someone else's ferry, posed from the snapshot they publish.
 * The pods yaw and the screws spin from that snapshot. This mesh does not
 * step their dynamics.
 */
export function RemoteFerry({ playerId }: { playerId: string }) {
  const hull = useMemo(() => buildFerry(), [])
  const bowPod = useMemo(() => buildPod(), [])
  const sternPod = useMemo(() => buildPod(), [])
  const bowScrew = useMemo(() => buildPodScrew(), [])
  const sternScrew = useMemo(() => buildPodScrew(), [])
  const nameTag = useMemo(() => makeNameSprite('Sailor', 8.4, 11), [])
  const group = useRef<THREE.Group>(null)
  const bowRef = useRef<THREE.Group>(null)
  const sternRef = useRef<THREE.Group>(null)
  const bowSpinRef = useRef<THREE.Group>(null)
  const sternSpinRef = useRef<THREE.Group>(null)
  const titled = useRef('Sailor')
  const view = useRef({ x: 0, z: 0, yaw: 0, sink: 0, ready: false })

  useEffect(() => {
    return () => {
      for (const mesh of [hull, bowPod, sternPod, bowScrew, sternScrew]) disposeMesh(mesh)
      const material = nameTag.material as THREE.SpriteMaterial
      material.map?.dispose()
      material.dispose()
    }
  }, [hull, bowPod, sternPod, bowScrew, sternScrew, nameTag])

  useFrame((state, delta) => {
    const ship = remoteShip(playerId)
    const g = group.current
    if (!ship || !g) return
    const fresh = shipIsFresh(playerId)
    g.visible = fresh
    if (!fresh) return
    if (ship.name !== titled.current) {
      titled.current = ship.name
      retitle(nameTag, ship.name)
    }
    const step = Math.min(Math.max(delta, 0), 0.1)
    const pose = view.current
    const sink = ship.sink || 0
    const jump = Math.hypot(ship.x - pose.x, ship.z - pose.z)
    if (!pose.ready || jump > 12) {
      pose.x = ship.x
      pose.z = ship.z
      pose.yaw = ship.yaw
      pose.sink = sink
      pose.ready = true
    } else {
      const k = 1 - Math.exp(-step / 0.09)
      pose.x += (ship.x - pose.x) * k
      pose.z += (ship.z - pose.z) * k
      const turn = Math.atan2(Math.sin(ship.yaw - pose.yaw), Math.cos(ship.yaw - pose.yaw))
      pose.yaw += turn * k
      pose.sink += (sink - pose.sink) * k
    }
    const time = state.clock.elapsedTime
    g.position.set(pose.x, swell(pose.x, pose.z, time) - pose.sink, pose.z)
    g.rotation.x = sinkPitch(pose.sink)
    g.rotation.y = pose.yaw
    const bowAz = ship.bowAz || 0
    const sternAz = ship.sternAz || 0
    if (bowRef.current) bowRef.current.rotation.y = bowAz + Math.PI
    if (sternRef.current) sternRef.current.rotation.y = sternAz + Math.PI
    if (bowSpinRef.current) bowSpinRef.current.rotation.z += (ship.bowThrust || 0) * 14 * step
    if (sternSpinRef.current) sternSpinRef.current.rotation.z += (ship.sternThrust || 0) * 14 * step
  })

  return (
    <group ref={group}>
      <primitive object={hull} />
      <primitive object={nameTag} />
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

/** The mesh matches the kind on the packet. Until a packet arrives, nothing is drawn. */
export function RemoteFleet({ map }: { map: MapData }) {
  const ids = useRemoteShipIds()
  return (
    <>
      {ids.map((id) => (
        <RemoteHull key={id} playerId={id} map={map} />
      ))}
    </>
  )
}

function RemoteHull({ playerId, map }: { playerId: string; map: MapData }) {
  const kind = useShipKind(playerId)
  if (kind === 'ferry') return <RemoteFerry playerId={playerId} />
  if (kind === 'sail') return <RemoteBoat playerId={playerId} map={map} />
  return null
}
