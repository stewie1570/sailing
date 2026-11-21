import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { alongsidePose, packageAlong, getChallenge, startChallenge, stepChallenge, dismissChallenge, useChallenge } from './challenge'
import { telemetry } from './boat/telemetry'

/** Cardboard parcel with a tape cross. Origin is the bottom centre. */
export function Crate() {
  return (
    <group>
      <mesh position={[0, 0.48, 0]}>
        <boxGeometry args={[1.25, 0.96, 1.15]} />
        <meshLambertMaterial color="#c9863a" />
      </mesh>
      <mesh position={[0, 0.48, 0]}>
        <boxGeometry args={[0.16, 0.98, 1.18]} />
        <meshLambertMaterial color="#f4f1ea" />
      </mesh>
      <mesh position={[0, 0.48, 0]} rotation={[0, Math.PI / 2, 0]}>
        <boxGeometry args={[0.16, 0.98, 1.28]} />
        <meshLambertMaterial color="#f4f1ea" />
      </mesh>
    </group>
  )
}

function DockMarker({ showPackage }: { showPackage: boolean }) {
  const challenge = useChallenge()
  const berth = challenge.target
  const gold = useMemo(() => new THREE.MeshBasicMaterial({ color: 0xf5c242 }), [])
  useEffect(() => () => gold.dispose(), [gold])
  if (!berth) return null
  const edge = 0.55
  const along = packageAlong(berth)
  return (
    <group position={[berth.x, berth.y + berth.height + 0.08, berth.z]} rotation={[0, berth.rotationY, 0]}>
      <mesh position={[0, 0.16, berth.thickness / 2]} material={gold}>
        <boxGeometry args={[berth.length, 0.22, edge]} />
      </mesh>
      <mesh position={[0, 0.16, -berth.thickness / 2]} material={gold}>
        <boxGeometry args={[berth.length, 0.22, edge]} />
      </mesh>
      <mesh position={[berth.length / 2, 0.16, 0]} material={gold}>
        <boxGeometry args={[edge, 0.22, berth.thickness]} />
      </mesh>
      <mesh position={[-berth.length / 2, 0.16, 0]} material={gold}>
        <boxGeometry args={[edge, 0.22, berth.thickness]} />
      </mesh>
      <group position={[berth.length * 0.38, 0, 0]}>
        <mesh position={[0, 4, 0]} material={gold}>
          <cylinderGeometry args={[0.12, 0.12, 8, 8]} />
        </mesh>
        <mesh position={[0, 8.4, 0]}>
          <octahedronGeometry args={[0.62, 0]} />
          <meshBasicMaterial color="#ffe08a" />
        </mesh>
      </group>
      {showPackage && (
        <group position={[along, -0.06, 0]}>
          <Crate />
        </group>
      )}
    </group>
  )
}

/** Gold outline, flag pole, and the parcel while it is sitting on a finger. */
export function ChallengeMarkers() {
  const challenge = useChallenge()
  if (!challenge.target) return null
  return <DockMarker showPackage={challenge.cargo === 'dock'} />
}

/** Watches the hull and advances the run. Dev builds also expose the run on `window.__sailing`. */
export function ChallengeDirector() {
  const devApi = useRef<Record<string, unknown> | null>(null)

  useFrame((_, dt) => {
    if (import.meta.env.DEV) {
      if (!devApi.current) {
        devApi.current = {
          get phase() { return getChallenge().phase },
          get harbor() { return getChallenge().harborName },
          get target() { return getChallenge().target },
          get cargo() { return getChallenge().cargo },
          get dockCargo() { return getChallenge().dockCargo },
          get startedAt() { return getChallenge().startedAt },
          get finishedAt() { return getChallenge().finishedAt },
          alongside(side: 1 | -1 = 1) {
            const berth = getChallenge().target
            return berth ? alongsidePose(berth, side) : null
          },
          start: () => startChallenge(),
          dismiss: () => dismissChallenge(),
        }
      }
      const w = window as unknown as { __sailing?: Record<string, unknown> }
      const sailing = (w.__sailing ??= {})
      if (sailing.challenge !== devApi.current) sailing.challenge = devApi.current
    }
    const phase = getChallenge().phase
    if (phase !== 'pickup' && phase !== 'carry') return
    if (!telemetry.ready) return
    stepChallenge(telemetry, dt, performance.now())
  })

  useEffect(() => {
    if (!import.meta.env.DEV) return
    return () => {
      const w = window as unknown as { __sailing?: Record<string, unknown> }
      if (w.__sailing?.challenge === devApi.current) delete w.__sailing.challenge
    }
  }, [])

  return null
}
