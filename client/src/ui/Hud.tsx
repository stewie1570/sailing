import { useEffect, useRef, useState } from 'react'
import { leaveGame, useSession } from '../net/session'
import { resetChallenge, startChallenge } from '../scene/challenge'
import { ChallengeBanner, ChallengeResult } from './ChallengeHud'
import { speedKnots, telemetry } from '../scene/boat/telemetry'
import { HelmDock } from './HelmDock'
import { AisNote } from './AisNote'
import { NavMap } from './NavMap'
import { WheelSlider } from './WheelSlider'
import { perf } from '../scene/quality'
import { canFullscreen, enterFullscreen, exitFullscreen, fullscreenElement } from './fullscreen'

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

function SimMenu() {
  const [open, setOpen] = useState(false)
  const [fullscreen, setFullscreen] = useState(() => !!fullscreenElement())
  const [fullscreenOk] = useState(canFullscreen)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const sync = () => setFullscreen(!!fullscreenElement())
    document.addEventListener('fullscreenchange', sync)
    document.addEventListener('webkitfullscreenchange', sync)
    return () => {
      document.removeEventListener('fullscreenchange', sync)
      document.removeEventListener('webkitfullscreenchange', sync)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointer)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="sim-menu" ref={rootRef}>
      <button
        type="button"
        className="hamburger"
        aria-label="Menu"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls="sim-menu-list"
        onClick={() => setOpen((value) => !value)}
      >
        <span />
        <span />
        <span />
      </button>
      {open && (
        <div className="sim-menu-list" id="sim-menu-list" role="menu">
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false)
              resetChallenge()
              void leaveGame()
            }}
          >
            Exit
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false)
              startChallenge()
            }}
          >
            Challenge
          </button>
          {fullscreenOk && (
            <button
              type="button"
              role="menuitem"
              aria-pressed={fullscreen}
              onClick={() => {
                setOpen(false)
                void (fullscreen ? exitFullscreen() : enterFullscreen())
              }}
            >
              {fullscreen ? 'Exit full screen' : 'Full screen'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function RoomChip() {
  const session = useSession()
  const [copied, setCopied] = useState(false)
  if (session.role === 'solo' || !session.code) return null

  return (
    <div className="room-chip">
      <div>
        <div className="room-kicker">{session.role === 'host' ? 'Hosting' : 'Aboard'}</div>
        <div className="room-code">{session.code}</div>
      </div>
      <button
        type="button"
        onClick={() => {
          const code = session.code
          if (!code || !navigator.clipboard) return
          void navigator.clipboard.writeText(code).then(() => {
            setCopied(true)
            window.setTimeout(() => setCopied(false), 1500)
          }).catch(() => {})
        }}
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  )
}

export function Hud({ loading }: { loading: boolean }) {
  const session = useSession()
  const [stats, setStats] = useState({ fps: 0, drawCalls: 0, triangles: 0 })

  useEffect(() => {
    const id = setInterval(() => setStats({ fps: perf.fps, drawCalls: perf.drawCalls, triangles: perf.triangles }), 500)
    return () => clearInterval(id)
  }, [])

  useEffect(() => () => resetChallenge(), [])

  const inRoom = session.role !== 'solo' && (!!session.code || session.roster.length > 0)

  return (
    <>
      <div className="hud-stack">
        <div className="hud hud-status">
          <div className="hud-row">
            <span className={`dot ${linkDot(session)}`} />
            <span className="hud-label">{linkLabel(session)}</span>
          </div>
          <div className="hud-row hud-dim">
            {stats.fps > 0 ? `${stats.fps.toFixed(0)} fps` : '— fps'} · {stats.drawCalls} draws · {(stats.triangles / 1000).toFixed(0)}k tris
          </div>
          <div className="hud-row quality">
            <SimMenu />
          </div>
        </div>

        <ChallengeBanner />

        {inRoom && (
          <div className="hud hud-room">
            <RoomChip />
            {session.roster.length > 0 && (
              <div className="room-names">
                {session.roster.map((seat) => (
                  <span key={seat.playerId}>
                    {seat.name}
                    {seat.playerId === session.playerId ? ' (you)' : ''}
                    {seat.host ? ' · host' : ''}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <BoatSpeed />

      <div className="hud hud-bottom">
        {loading
          ? 'Loading chart…'
          : 'Drag to look · pinch or scroll to zoom · the gear sets a controller'}
      </div>

      <ChallengeResult />
      <NavMap />
      {session.role === 'host' || session.role === 'guest' ? <AisNote /> : null}
      <HelmDock />
      <WheelSlider />
    </>
  )
}

function linkDot(session: ReturnType<typeof useSession>): string {
  if (session.role === 'solo') return 'dot-solo'
  if (session.link === 'up') return 'dot-connected'
  if (session.link === 'down' || session.link === 'connecting') return 'dot-connecting'
  return 'dot-disconnected'
}

function linkLabel(session: ReturnType<typeof useSession>): string {
  if (session.role === 'solo') return 'Solo'
  const count = session.roster.length
  const sailors = `${count} sailor${count === 1 ? '' : 's'}`
  if (session.link === 'down') return `Reconnecting · ${sailors}`
  if (session.link === 'connecting') return 'Connecting…'
  const lag = session.latencyMs != null ? ` · ${session.latencyMs} ms` : ''
  return `${sailors}${lag}`
}
