import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { remoteShip, shipIsFresh, useRemoteShipIds } from '../../net/session'
import { RUDDER_LOCK, WHEEL_LOCK } from './dynamics'
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
} from './geometry'
import { swell } from './physics'

/**
 * Someone else's hull. It is a ghost: the owner simulates it, and we only pose
 * what they published. These boats do not push the local hull around.
 */
export function RemoteBoat({ playerId }: { playerId: string }) {
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
  const nameTag = useMemo(() => makeNameSprite('Sailor'), [])
  const group = useRef<THREE.Group>(null)
  const wheelRef = useRef<THREE.Group>(null)
  const boomRef = useRef<THREE.Group>(null)
  const sailRef = useRef<THREE.Group>(null)
  const jibRef = useRef<THREE.Group>(null)
  const vaneRef = useRef<THREE.Group>(null)
  const rudderRef = useRef<THREE.Group>(null)
  const portSpinRef = useRef<THREE.Group>(null)
  const stbdSpinRef = useRef<THREE.Group>(null)
  const camberSide = useRef(1)
  const titled = useRef('Sailor')
  const view = useRef({ x: 0, z: 0, yaw: 0, ready: false })

  useEffect(() => {
    return () => {
      for (const mesh of [hull, wheel, boomMesh, sailMesh, jibMesh, vaneMesh, rudderMesh, portProp, stbdProp, portStrut, stbdStrut]) {
        disposeMesh(mesh)
      }
      const material = nameTag.material as THREE.SpriteMaterial
      material.map?.dispose()
      material.dispose()
    }
  }, [hull, wheel, boomMesh, sailMesh, jibMesh, vaneMesh, rudderMesh, portProp, stbdProp, portStrut, stbdStrut, nameTag])

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
    if (!pose.ready) {
      pose.x = ship.x
      pose.z = ship.z
      pose.yaw = ship.yaw
      pose.ready = true
    } else {
      const k = 1 - Math.exp(-step / 0.09)
      pose.x += (ship.x - pose.x) * k
      pose.z += (ship.z - pose.z) * k
      const turn = Math.atan2(Math.sin(ship.yaw - pose.yaw), Math.cos(ship.yaw - pose.yaw))
      pose.yaw += turn * k
    }

    const time = state.clock.elapsedTime
    g.position.set(pose.x, swell(pose.x, pose.z, time), pose.z)
    g.rotation.y = pose.yaw

    const spin = Math.min(step, 0.1)
    if (wheelRef.current) wheelRef.current.rotation.z = ship.rudder * WHEEL_LOCK
    if (rudderRef.current) rudderRef.current.rotation.y = ship.rudder * RUDDER_LOCK
    if (boomRef.current) boomRef.current.rotation.y = ship.boom
    if (sailRef.current) {
      if (Math.abs(ship.boom) > 0.08) camberSide.current = ship.boom > 0 ? -1 : 1
      const gust = 0.6
      const amp = ship.luff * (0.4 + 0.6 * gust)
      const wag = Math.sin(time * (7.2 + 5 * gust)) * 0.62 + Math.sin(time * (15.5 + 4 * gust) + 0.8) * 0.38
      sailRef.current.rotation.y = amp * wag * 0.22
      sailRef.current.rotation.x = amp * Math.sin(time * (11.4 + 3 * gust) + 0.3) * 0.07
      const belly = 1 - amp * 0.72
      sailRef.current.scale.set(camberSide.current * belly, Math.max(ship.hoist, 0.001), 1)
      sailRef.current.visible = ship.hoist > 0.02
    }
    if (jibRef.current) {
      poseJib(jibMesh, jibRig, ship.clew, ship.jibHoist, ship.jibLuff, time)
      jibRef.current.visible = ship.jibHoist > 0.02
    }
    if (vaneRef.current) vaneRef.current.rotation.y = ship.vane
    if (portSpinRef.current) portSpinRef.current.rotation.z += ship.port * 16 * spin
    if (stbdSpinRef.current) stbdSpinRef.current.rotation.z -= ship.starboard * 16 * spin
  })

  const wheelPos = hardware.wheel
  const rudderPos = hardware.rudder
  const portPos = hardware.portScrew
  const stbdPos = hardware.starboardScrew

  return (
    <group ref={group}>
      <primitive object={hull} />
      <primitive object={nameTag} />
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

export function RemoteFleet() {
  const ids = useRemoteShipIds()
  return (
    <>
      {ids.map((id) => (
        <RemoteBoat key={id} playerId={id} />
      ))}
    </>
  )
}

function disposeMesh(mesh: THREE.Mesh) {
  mesh.geometry.dispose()
  const material = mesh.material
  if (Array.isArray(material)) material.forEach((item) => item.dispose())
  else material.dispose()
}

function makeNameSprite(text: string) {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 64
  const ctx = canvas.getContext('2d')
  if (ctx) paintName(ctx, text)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false })
  const sprite = new THREE.Sprite(material)
  sprite.position.set(0, 17.2, 0.4)
  sprite.scale.set(7.2, 1.8, 1)
  sprite.renderOrder = 2
  return sprite
}

function retitle(sprite: THREE.Sprite, text: string) {
  const material = sprite.material as THREE.SpriteMaterial
  const canvas = material.map?.image as HTMLCanvasElement | undefined
  const ctx = canvas?.getContext('2d')
  if (!ctx) return
  paintName(ctx, text)
  if (material.map) material.map.needsUpdate = true
}

function paintName(ctx: CanvasRenderingContext2D, text: string) {
  ctx.clearRect(0, 0, 256, 64)
  ctx.font = '600 28px Segoe UI, sans-serif'
  const label = text.slice(0, 16) || 'Sailor'
  const width = Math.min(236, ctx.measureText(label).width + 28)
  const x = (256 - width) / 2
  ctx.fillStyle = 'rgba(8, 18, 30, 0.66)'
  fillRound(ctx, x, 12, width, 40, 10)
  ctx.fillStyle = '#e8eef4'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(label, 128, 32)
}

function fillRound(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
  ctx.fill()
}
