import { useEffect, useState } from 'react'
import { useConnection } from '../net/gameConnection'
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
        {loading ? 'Loading chart…' : 'Drag to look around · pinch or scroll to zoom · two-finger drag to pan'}
      </div>
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
