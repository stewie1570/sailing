import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { getHelm, jibSheetRoom, setControlDrag, updateHelm, useHelm, type Control } from '../scene/boat/helm'
import { JIB_STALL, jibAddedDrive, luffAmount, readRig } from '../scene/boat/sail'
import { telemetry } from '../scene/boat/telemetry'
import { compassPoint, getWind, useWindDisplay } from '../scene/boat/wind'

function clamp01(v: number) {
  return Math.min(1, Math.max(0, v))
}

function tightnessFromY(el: HTMLElement, clientY: number, max: number) {
  const r = el.getBoundingClientRect()
  const pad = 14
  const t = (clientY - r.top - pad) / Math.max(1, r.height - pad * 2)
  return Math.min(max, clamp01(t))
}

function tightReadout(tightness: number) {
  if (tightness < 0.04) return 'Eased'
  if (tightness > 0.96) return 'Tight'
  return `${Math.round(tightness * 100)}%`
}

/** One vertical sheet. Ease is at the top, tight is at the bottom. `max` caps a jib sheet. */
function SheetColumn({
  title,
  aria,
  tightness,
  max = 1,
  knob,
  control,
  onTightness,
}: {
  title: string
  aria: string
  tightness: number
  max?: number
  knob?: string
  control: Control
  onTightness: (tightness: number) => void
}) {
  const [dragging, setDragging] = useState(false)
  const limited = max < 0.995
  const place = tightness < 0.04 ? 'Eased' : tightness > 0.96 ? 'Tight' : `${Math.round(tightness * 100)}% tight`
  const text = limited ? `${place}, limited to ${Math.round(max * 100)}%` : place

  const apply = (el: HTMLElement, clientY: number) => onTightness(tightnessFromY(el, clientY, max))
  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    setDragging(true)
    setControlDrag(control, true)
    apply(e.currentTarget, e.clientY)
  }
  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    apply(e.currentTarget, e.clientY)
  }
  const onUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId) && !dragging) return
    apply(e.currentTarget, e.clientY)
    setDragging(false)
    setControlDrag(control, false)
  }

  return (
    <div className="sheet-col">
      <div className="sheet-label">
        <span>{title}</span>
        <span>{tightReadout(tightness)}</span>
      </div>
      <div
        className={`sheet-track${dragging ? ' dragging' : ''}`}
        role="slider"
        aria-orientation="vertical"
        aria-label={aria}
        aria-valuemin={0}
        aria-valuemax={Number(max.toFixed(2))}
        aria-valuenow={Number(Math.min(tightness, max).toFixed(2))}
        aria-valuetext={text}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onContextMenu={(e) => e.preventDefault()}
      >
        {limited && <div className="sheet-stop" style={{ top: `calc(14px + ${max} * (100% - 28px))` }} />}
        <div className={`sheet-knob${knob ? ` ${knob}` : ''}`} style={{ top: `calc(14px + ${tightness} * (100% - 28px))` }} />
      </div>
    </div>
  )
}

function windSide(awa: number) {
  const deg = Math.abs(awa) * (180 / Math.PI)
  if (deg < 8) return 'On the nose'
  if (deg > 172) return 'Dead aft'
  const side = awa > 0 ? 'port' : 'stbd'
  const rounded = Math.round(deg)
  if (deg < 50) return `${rounded}° ${side} bow`
  if (deg < 130) return `${rounded}° ${side} beam`
  return `${rounded}° ${side} quarter`
}

function trimWords(hoist: number, command: number, aoa: number, awa: number) {
  if (command > 0.5 && hoist < 0.98) return 'Hoisting'
  if (command < 0.5 && hoist > 0.02) return 'Furling'
  if (hoist < 0.08) return 'In the boom'
  if (luffAmount(aoa, awa, hoist) > 0.35) return 'Luffing'
  const deg = aoa * (180 / Math.PI)
  if (deg > 50) return 'Stalled'
  return 'Drawing'
}

export function SailingControls() {
  const helm = useHelm()
  const wind = useWindDisplay()
  const arrow = useRef<HTMLDivElement>(null)
  const detail = useRef<HTMLDivElement>(null)
  const trim = useRef<HTMLDivElement>(null)
  const jibTrim = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let raf = 0
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const w = getWind()
      const rig = readRig({ yaw: telemetry.yaw, speed: telemetry.speed, sway: telemetry.sway }, w)
      const sail = rig.main
      if (arrow.current) arrow.current.style.transform = `rotate(${-sail.awa}rad)`
      if (detail.current) detail.current.textContent = windSide(sail.awa)
      if (trim.current) {
        const boomDeg = Math.abs(sail.boom) * (180 / Math.PI)
        const boom = boomDeg < 2 ? 'Boom amidships' : `Boom ${boomDeg.toFixed(0)}° off`
        trim.current.textContent = `${boom} · ${trimWords(sail.hoist, getHelm().halyard, sail.aoa, sail.awa)}`
      }
      if (jibTrim.current) jibTrim.current.textContent = jibLine(rig)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  const out = helm.halyard > 0.5
  const jibOut = helm.jib > 0.5

  return (
    <div id="panel-sailing" className="sail-panel" role="tabpanel" aria-label="Sailing" aria-labelledby="tab-sailing">
      <div className="wind-row">
        <div className="wind-dial" aria-hidden="true">
          <div className="wind-boat" />
          <div className="wind-arrow" ref={arrow} />
        </div>
        <div className="wind-copy">
          <div className="wind-kicker">Wind from</div>
          <div className="wind-true">
            {compassPoint(wind.fromDeg)} · {wind.kn.toFixed(1)} kn
          </div>
          <div className="wind-app" ref={detail}>
            —
          </div>
          <div className="wind-shift">{wind.shifting ? 'Shifting' : ''}</div>
        </div>
      </div>

      <div className="sail-toggle">
        <div className="sail-toggle-copy">
          <span className="sail-toggle-name">Jib</span>
          <span className="sail-toggle-state" ref={jibTrim}>
            Furled
          </span>
        </div>
        <div className="halyard" role="group" aria-label="Jib furling">
          <button type="button" className={jibOut ? '' : 'active'} aria-pressed={!jibOut} onClick={() => updateHelm({ jib: 0 })}>
            In
          </button>
          <button type="button" className={jibOut ? 'active' : ''} aria-pressed={jibOut} onClick={() => updateHelm({ jib: 1 })}>
            Out
          </button>
        </div>
      </div>

      <div className="sail-toggle">
        <div className="sail-toggle-copy">
          <span className="sail-toggle-name">Main</span>
          <span className="sail-toggle-state" ref={trim}>
            In the boom
          </span>
        </div>
        <div className="halyard" role="group" aria-label="Mainsail">
          <button type="button" className={out ? '' : 'active'} aria-pressed={!out} onClick={() => updateHelm({ halyard: 0 })}>
            In
          </button>
          <button type="button" className={out ? 'active' : ''} aria-pressed={out} onClick={() => updateHelm({ halyard: 1 })}>
            Out
          </button>
        </div>
      </div>

      <div className="sheet-row">
        <SheetColumn
          title="Port jib"
          aria="Port jib sheet"
          tightness={helm.jibPort}
          max={jibSheetRoom(helm.jibStarboard)}
          knob="port"
          control="jibPort"
          onTightness={(jibPort) => updateHelm({ jibPort })}
        />
        <SheetColumn
          title="Main"
          aria="Main sheet"
          tightness={1 - helm.sheet}
          control="sheet"
          onTightness={(tight) => updateHelm({ sheet: 1 - tight })}
        />
        <SheetColumn
          title="Stbd jib"
          aria="Starboard jib sheet"
          tightness={helm.jibStarboard}
          max={jibSheetRoom(helm.jibPort)}
          knob="starboard"
          control="jibStarboard"
          onTightness={(jibStarboard) => updateHelm({ jibStarboard })}
        />
      </div>
    </div>
  )
}

function jibLine(rig: ReturnType<typeof readRig>) {
  const helm = getHelm()
  const jib = rig.jib
  if (helm.jib > 0.5 && jib.hoist < 0.98) return 'Jib unfurling'
  if (helm.jib < 0.5 && jib.hoist > 0.02) return 'Jib furling'
  if (jib.hoist < 0.08) return 'Jib furled'
  const deg = Math.abs(jib.clew) * (180 / Math.PI)
  const side = jib.clew > 0.04 ? 'stbd' : jib.clew < -0.04 ? 'port' : ''
  const where = deg < 2 ? 'Clew amidships' : `Clew ${deg.toFixed(0)}° ${side}`.trim()
  let state = 'Drawing'
  if (jib.luff > 0.35) state = 'Luffing'
  else if (jib.aoa > JIB_STALL) state = 'Stalled'
  if (rig.main.hoist < 0.35 || rig.main.fx < 200) return `${where} · ${state}`
  const added = jibAddedDrive(rig.main.fx, jib.fx, rig.slot)
  const pct = Math.round((added / rig.main.fx) * 100)
  const share = Math.abs(pct) < 3 ? 'no extra drive' : pct > 0 ? `+${pct}% drive` : `${pct}% drive`
  return `${where} · ${state} · ${share}`
}
