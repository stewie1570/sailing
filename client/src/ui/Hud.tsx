import { useEffect, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { useConnection } from '../net/gameConnection'
import { clearHelmSource, setHelm, type HelmDir } from '../scene/boat/helm'
import { perf, setQuality, useQuality, type QualityLevel } from '../scene/quality'

const LEVELS: QualityLevel[] = ['low', 'medium', 'high']

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
        <div className="hud-sub">Sailing &amp; Docking Simulator</div>
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
        </div>
      </div>

      <div className="hud hud-bottom">
        {loading ? 'Loading chart…' : 'Arrows or the pad to sail · drag to look around · pinch or scroll to zoom'}
      </div>

      <HelmPad />
    </>
  )
}

const PAD: { dir: HelmDir; className: string; label: string }[] = [
  { dir: 'forward', className: 'dpad-forward', label: 'Ahead' },
  { dir: 'port', className: 'dpad-port', label: 'Port' },
  { dir: 'starboard', className: 'dpad-starboard', label: 'Starboard' },
  { dir: 'back', className: 'dpad-back', label: 'Astern' },
]

function HelmPad() {
  useEffect(() => () => clearHelmSource('pad'), [])
  return (
    <div className="dpad">
      {PAD.map(({ dir, className, label }) => (
        <button
          key={dir}
          type="button"
          className={className}
          aria-label={label}
          tabIndex={-1}
          onContextMenu={(e) => e.preventDefault()}
          onPointerDown={(e) => holdPad(e, dir, true)}
          onPointerUp={(e) => holdPad(e, dir, false)}
          onPointerCancel={(e) => holdPad(e, dir, false)}
        >
          {label === 'Ahead' ? '▲' : label === 'Astern' ? '▼' : label === 'Port' ? '◀' : '▶'}
        </button>
      ))}
    </div>
  )
}

function holdPad(e: ReactPointerEvent<HTMLButtonElement>, dir: HelmDir, down: boolean) {
  e.preventDefault()
  e.stopPropagation()
  if (down) e.currentTarget.setPointerCapture(e.pointerId)
  setHelm('pad', dir, down)
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
