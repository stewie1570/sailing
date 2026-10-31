import { OrbitControls } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Suspense, use, useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { loadMapData, type MapData } from '../map/mapData'
import { Buoys } from './Buoys'
import { environment } from './environment'
import { Harbors } from './Harbors'
import { MAX_FPS, perf, QUALITY_PRESETS, getQuality, setQuality, useQuality } from './quality'
import { Sky } from './Sky'
import { Terrain } from './Terrain'
import { Trees } from './Trees'
import { Water } from './Water'

/** Samples frame time and renderer stats for the HUD; steps quality down if the device cannot keep up. */
function PerfMonitor() {
  const { gl } = useThree()
  const acc = useMemo(() => ({ frames: 0, time: 0, slowSeconds: 0 }), [])
  useFrame((_, delta) => {
    acc.frames++
    acc.time += delta
    if (acc.time >= 0.5) {
      perf.fps = acc.frames / acc.time
      perf.frameMs = (acc.time / acc.frames) * 1000
      perf.drawCalls = gl.info.render.calls
      perf.triangles = gl.info.render.triangles
      // Sustained < 24 fps for ~4 s drops one quality level (never below low).
      acc.slowSeconds = perf.fps < 24 ? acc.slowSeconds + acc.time : 0
      if (acc.slowSeconds > 4) {
        acc.slowSeconds = 0
        const q = getQuality()
        if (q === 'high') setQuality('medium')
        else if (q === 'medium') setQuality('low')
      }
      acc.frames = 0
      acc.time = 0
    }
  })
  return null
}

/**
 * Draws at most {@link MAX_FPS}. The canvas is `frameloop="never"`, so this loop is the only
 * one that renders — orbit-control invalidations cannot slip extra frames through.
 *
 * r3f reads `clock.getDelta()` before it applies the timestamp passed to `advance`, and that
 * read would fight a manual clock. Elapsed time comes only from the timestamp, in seconds.
 */
function FrameCap() {
  const advance = useThree((s) => s.advance)
  const clock = useThree((s) => s.clock)
  useEffect(() => {
    const minDeltaMs = 1000 / MAX_FPS
    const origin = performance.now()
    let last = origin - minDeltaMs
    let raf = 0
    const previousGetDelta = clock.getDelta.bind(clock)
    clock.getDelta = () => 0
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick)
      if (now - last < minDeltaMs) return
      last = now
      advance((now - origin) / 1000)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      clock.getDelta = previousGetDelta
    }
  }, [advance, clock])
  return null
}

/** Applies the DPR cap of the active quality preset to the renderer. */
function QualityApplier() {
  const quality = useQuality()
  const setDpr = useThree((s) => s.setDpr)
  useEffect(() => {
    setDpr(Math.min(window.devicePixelRatio || 1, QUALITY_PRESETS[quality].maxDpr))
  }, [quality, setDpr])
  return null
}

function Lighting() {
  const sunPos = useMemo(() => environment.sunDirection.clone().multiplyScalar(5000), [])
  return (
    <>
      <hemisphereLight color={environment.hemiSky} groundColor={environment.hemiGround} intensity={1.0} />
      <directionalLight position={sunPos} color={environment.sunColor} intensity={environment.sunIntensity} />
    </>
  )
}

function World({ mapPromise }: { mapPromise: Promise<MapData> }) {
  const map = use(mapPromise)

  // Just outside West Harbor's east-facing entrance, high enough to read the basin.
  const { cameraPos, target } = useMemo(() => {
    const m = map.metersPerPixel
    const at = (px: number, py: number, y: number) =>
      new THREE.Vector3((px - map.width / 2) * m, y, (py - map.height / 2) * m)
    return { cameraPos: at(186, 298, 96), target: at(112, 240, 3) }
  }, [map])

  const camera = useThree((s) => s.camera)
  const controls = useThree((s) => s.controls)
  useEffect(() => {
    camera.position.copy(cameraPos)
    camera.lookAt(target)
  }, [camera, cameraPos, target])

  // Dev-only handle for inspecting the scene from the browser console / automation.
  useEffect(() => {
    if (!import.meta.env.DEV) return
    const w = window as unknown as Record<string, unknown>
    w.__sailing = {
      map,
      camera,
      controls,
      lookAt(cx: number, cy: number, cz: number, tx: number, ty: number, tz: number) {
        camera.position.set(cx, cy, cz)
        const c = controls as unknown as { target?: THREE.Vector3; update?: () => void } | null
        if (c?.target) { c.target.set(tx, ty, tz); c.update?.() } else camera.lookAt(tx, ty, tz)
      },
    }
    return () => { delete w.__sailing }
  }, [map, camera, controls])

  return (
    <>
      <Sky cloudMap={map.textures.detail} />
      <Lighting />
      <Terrain map={map} />
      <Water map={map} />
      <Trees map={map} />
      <Buoys map={map} />
      <Harbors map={map} />
      <OrbitControls
        makeDefault
        target={target}
        enableDamping
        dampingFactor={0.08}
        rotateSpeed={0.6}
        zoomSpeed={0.8}
        minDistance={6}
        maxDistance={9000}
        // keep the camera above the surface
        maxPolarAngle={Math.PI / 2 - 0.015}
        screenSpacePanning={false}
        touches={{ ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN }}
      />
    </>
  )
}

export function Scene({ onReady }: { onReady?: () => void }) {
  const quality = useQuality()
  const mapPromise = useMemo(() => loadMapData(QUALITY_PRESETS[quality].anisotropy), [quality])

  useEffect(() => {
    let cancelled = false
    mapPromise.then(() => { if (!cancelled) onReady?.() })
    return () => { cancelled = true }
  }, [mapPromise, onReady])

  return (
    <Canvas
      frameloop="never"
      // MSAA is expensive on tile-based mobile GPUs; DPR is capped per quality level instead.
      gl={{
        antialias: false,
        powerPreference: 'high-performance',
        alpha: false,
        stencil: false,
        logarithmicDepthBuffer: false,
      }}
      dpr={[1, QUALITY_PRESETS[quality].maxDpr]}
      camera={{ fov: 55, near: 1.5, far: 45000 }}
      onCreated={({ gl, scene }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping
        gl.toneMappingExposure = 1.0
        gl.setClearColor(environment.fogColor)
        scene.fog = new THREE.FogExp2(environment.fogColor, environment.fogDensity)
      }}
      style={{ touchAction: 'none' }}
    >
      <QualityApplier />
      <FrameCap />
      <PerfMonitor />
      <Suspense fallback={null}>
        <World mapPromise={mapPromise} />
      </Suspense>
    </Canvas>
  )
}
