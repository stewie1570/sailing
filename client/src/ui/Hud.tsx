import { useEffect, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { useConnection } from '../net/gameConnection'
import { clearHelmSource, setHelm, type HelmDir } from '../scene/boat/helm'
import { MAIN_SHEET_MAX, setMainOut, setMainSheet, useSail } from '../scene/boat/sail'
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
        {loading ? 'Loading chart…' : 'Arrows or Engine to motor · Sailing tab for the main · drag to look · scroll to zoom'}
      </div>

      <HelmPanel />
    </>
  )
}

type HelmTab = 'engine' | 'sailing'

function HelmPanel() {
  const [tab, setTab] = useState<HelmTab>('engine')
  return (
    <div className="helm-panel" onContextMenu={(e) => e.preventDefault()}>
      <div className="helm-tabs" role="tablist" aria-label="Boat controls">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'engine'}
          className={tab === 'engine' ? 'active' : ''}
          onClick={() => setTab('engine')}
        >
          Engine
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'sailing'}
          className={tab === 'sailing' ? 'active' : ''}
          onClick={() => setTab('sailing')}
        >
          Sailing
        </button>
      </div>
      <div className="helm-body" role="tabpanel">
        {tab === 'engine' ? <HelmPad /> : <SailControls />}
      </div>
    </div>
  )
}

function SailControls() {
  const sail = useSail()
  const sheetPct = `${(sail.mainSheet / MAIN_SHEET_MAX) * 100}%`
  return (
    <div className="sail-controls">
      <div className="sail-row">
        <span className="sail-label" id="main-sail-label">Main sail</span>
        <div className="sail-toggle" role="group" aria-labelledby="main-sail-label">
          <button
            type="button"
            className={sail.mainOut ? '' : 'active'}
            aria-pressed={!sail.mainOut}
            onClick={() => setMainOut(false)}
          >
            In
          </button>
          <button
            type="button"
            className={sail.mainOut ? 'active' : ''}
            aria-pressed={sail.mainOut}
            onClick={() => setMainOut(true)}
          >
            Out
          </button>
        </div>
      </div>

      <label className="sail-sheet">
        <span className="sail-row">
          <span className="sail-label">Main sheet</span>
          <span className="sail-value">{Math.round(sail.mainSheet)}°</span>
        </span>
        <input
          type="range"
          min={0}
          max={MAIN_SHEET_MAX}
          step={1}
          value={sail.mainSheet}
          aria-label="Main sheet angle"
          aria-valuetext={`${Math.round(sail.mainSheet)} degrees, 0 port to 180 starboard`}
          style={{ '--sheet': sheetPct } as CSSProperties}
          onChange={(e) => setMainSheet(Number(e.target.value))}
        />
      </label>
    </div>
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
