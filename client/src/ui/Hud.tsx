import { useEffect, useRef, useState } from 'react'
import { useConnection } from '../net/gameConnection'
import { speedKnots, telemetry } from '../scene/boat/telemetry'
import { HelmDock } from './HelmDock'
import { NavMap } from './NavMap'
import { WheelSlider } from './WheelSlider'
import { perf, setQuality, useQuality, type QualityLevel } from '../scene/quality'

const LEVELS: QualityLevel[] = ['low', 'medium', 'high']

type FullscreenDoc = Document & {
  webkitFullscreenElement?: Element | null
  webkitExitFullscreen?: () => Promise<void> | void
}

type FullscreenEl = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void
}

function fullscreenElement() {
  const doc = document as FullscreenDoc
  return document.fullscreenElement ?? doc.webkitFullscreenElement ?? null
}

function canFullscreen() {
  const el = document.documentElement as FullscreenEl
  return typeof el.requestFullscreen === 'function' || typeof el.webkitRequestFullscreen === 'function'
}

async function enterFullscreen() {
  const el = document.documentElement as FullscreenEl
  if (el.requestFullscreen) await el.requestFullscreen()
  else el.webkitRequestFullscreen?.()
}

async function exitFullscreen() {
  const doc = document as FullscreenDoc
  if (document.exitFullscreen) await document.exitFullscreen()
  else doc.webkitExitFullscreen?.()
}

function FullscreenButton() {
  const [active, setActive] = useState(() => !!fullscreenElement())
  const [supported] = useState(canFullscreen)

  useEffect(() => {
    const sync = () => setActive(!!fullscreenElement())
    document.addEventListener('fullscreenchange', sync)
    document.addEventListener('webkitfullscreenchange', sync)
    return () => {
      document.removeEventListener('fullscreenchange', sync)
      document.removeEventListener('webkitfullscreenchange', sync)
    }
  }, [])

  if (!supported) return null

  return (
    <button
      type="button"
      className={active ? 'active' : ''}
      aria-pressed={active}
      aria-label={active ? 'Exit full screen' : 'Enter full screen'}
      title={active ? 'Exit full screen' : 'Full screen'}
      onClick={() => {
        void (active ? exitFullscreen() : enterFullscreen())
      }}
    >
      {active ? 'Exit' : 'Full'}
    </button>
  )
}

function BoatSpeed() {
  const valueRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    let raf = 0
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const node = valueRef.current
      if (!node) return
      const kn = speedKnots(telemetry.speed, telemetry.sway)
      node.textContent = `${kn < -0.05 ? '−' : ''}${Math.abs(kn).toFixed(1)}`
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <div className="hud hud-speed">
      <div className="hud-speed-label">Speed</div>
      <div className="hud-speed-value">
        <span ref={valueRef}>0.0</span>
        <span className="hud-speed-unit">kn</span>
      </div>
    </div>
  )
}

export function Hud({ loading }: { loading: boolean }) {
  const conn = useConnection()
  const quality = useQuality()
  const [stats, setStats] = useState({ fps: 0, drawCalls: 0, triangles: 0 })

  useEffect(() => {
    const id = setInterval(() => setStats({ fps: perf.fps, drawCalls: perf.drawCalls, triangles: perf.triangles }), 500)
    return () => clearInterval(id)
  }, [])

  return (
    <>
      <div className="hud hud-top-left">
        <div className="hud-title">Lake Windermere</div>
        <div className="hud-sub">
          {loading
            ? 'Loading chart…'
            : 'Engine tab runs the screws · Sailing tab sets the main and the jib · center the wheel to straighten the rudder'}
        </div>
      </div>

      <div className="hud hud-top-right">
        <div className="hud-row">
          <span className={`dot dot-${conn.status}`} />
          <span className="hud-label">{statusLabel(conn)}</span>
        </div>
        <div className="hud-row hud-dim">
          {stats.fps > 0 ? `${stats.fps.toFixed(0)} fps` : '— fps'} · {stats.drawCalls} draws · {(stats.triangles / 1000).toFixed(0)}k tris
        </div>
        <div className="hud-row quality">
          {LEVELS.map((l) => (
            <button key={l} className={l === quality ? 'active' : ''} onClick={() => setQuality(l)}>
              {l}
            </button>
          ))}
          <FullscreenButton />
        </div>
      </div>

      <BoatSpeed />

      <div className="hud hud-bottom">
        {loading
          ? 'Loading chart…'
          : 'Drag to look · pinch or scroll to zoom · arrows trim the engines, or the sheet while sailing'}
      </div>

      <NavMap />
      <HelmDock />
      <WheelSlider />
    </>
  )
}

function statusLabel(c: ReturnType<typeof useConnection>): string {
  switch (c.status) {
    case 'connected':
      return `Online · ${c.online} sailor${c.online === 1 ? '' : 's'}${c.latencyMs != null ? ` · ${c.latencyMs} ms` : ''}`
    case 'connecting':
      return 'Connecting…'
    case 'reconnecting':
      return 'Reconnecting…'
    default:
      return 'Offline'
  }
}
