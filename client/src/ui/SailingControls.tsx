import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { getHelm, jibSheetRoom, setControlDrag, updateHelm, useHelm, type Control } from '../scene/boat/helm'
import { JIB_STALL, jibAddedDrive, luffAmount, readRig } from '../scene/boat/sail'
import { telemetry } from '../scene/boat/telemetry'
import { compassPoint, getWind, useWindDisplay } from '../scene/boat/wind'

function clamp01(v: number) {
  return Math.min(1, Math.max(0, v))
}

function sheetFromY(el: HTMLElement, clientY: number) {
  const r = el.getBoundingClientRect()
  const pad = 14
  const t = (clientY - r.top - pad) / Math.max(1, r.height - pad * 2)
  return 1 - clamp01(t)
}

function Sheet({ value }: { value: number }) {
  const [dragging, setDragging] = useState(false)

  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    setDragging(true)
    setControlDrag('sheet', true)
    updateHelm({ sheet: sheetFromY(e.currentTarget, e.clientY) })
  }
  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    updateHelm({ sheet: sheetFromY(e.currentTarget, e.clientY) })
  }
  const onUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId) && !dragging) return
    updateHelm({ sheet: sheetFromY(e.currentTarget, e.clientY) })
    setDragging(false)
    setControlDrag('sheet', false)
  }

  const eased = value < 0.08 ? 'Tight' : value > 0.92 ? 'Fully eased' : `${Math.round(value * 100)}% eased`

  return (
    <div className="sheet">
      <div className="sheet-label">
        <span>Main sheet</span>
        <span>{eased}</span>
      </div>
      <div className="sheet-body">
        <div className="sheet-scale" aria-hidden="true">
          <span>Ease</span>
          <span>Tight</span>
        </div>
        <div
          className={`sheet-track${dragging ? ' dragging' : ''}`}
          role="slider"
          aria-orientation="vertical"
          aria-label="Main sheet"
          aria-valuemin={0}
          aria-valuemax={1}
          aria-valuenow={Number(value.toFixed(2))}
          aria-valuetext={eased}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          onContextMenu={(e) => e.preventDefault()}
        >
          <div className="sheet-knob" style={{ top: `calc(14px + ${1 - value} * (100% - 28px))` }} />
        </div>
      </div>
    </div>
  )
}

function tightnessFromY(el: HTMLElement, clientY: number, max: number) {
  const r = el.getBoundingClientRect()
  const pad = 14
  const t = (clientY - r.top - pad) / Math.max(1, r.height - pad * 2)
  return Math.min(max, clamp01(t))
}

function tightLabel(value: number) {
  if (value < 0.04) return 'Eased'
  if (value > 0.96) return 'Hard'
  return `${Math.round(value * 100)}% tight`
}

function JibSheet({
  side,
  value,
  max,
}: {
  side: 'port' | 'starboard'
  value: number
  max: number
}) {
  const [dragging, setDragging] = useState(false)
  const control: Control = side === 'port' ? 'jibPort' : 'jibStarboard'
  const name = side === 'port' ? 'Port jib sheet' : 'Starboard jib sheet'

  const apply = (el: HTMLElement, clientY: number) => {
    const next = tightnessFromY(el, clientY, max)
    updateHelm(side === 'port' ? { jibPort: next } : { jibStarboard: next })
  }
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

  const limited = max < 0.995
  const text = limited ? `${tightLabel(value)}, limited to ${Math.round(max * 100)}%` : tightLabel(value)

  return (
    <div className="jib-col">
      <div className="sheet-label">
        <span>{side === 'port' ? 'Port' : 'Stbd'}</span>
        <span>{value < 0.04 ? 'Eased' : value > 0.96 ? 'Hard' : `${Math.round(value * 100)}%`}</span>
      </div>
      <div
        className={`sheet-track jib-track${dragging ? ' dragging' : ''}`}
        role="slider"
        aria-orientation="vertical"
        aria-label={name}
        aria-valuemin={0}
        aria-valuemax={Number(max.toFixed(2))}
        aria-valuenow={Number(value.toFixed(2))}
        aria-valuetext={text}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onContextMenu={(e) => e.preventDefault()}
      >
        {limited && <div className="sheet-stop" style={{ top: `calc(14px + ${max} * (100% - 28px))` }} />}
        <div className={`sheet-knob ${side}`} style={{ top: `calc(14px + ${value} * (100% - 28px))` }} />
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

      <div className="halyard-block">
        <div className="sheet-label">
          <span>Halyard</span>
        </div>
        <div className="halyard" role="group" aria-label="Halyard">
          <button type="button" className={out ? '' : 'active'} aria-pressed={!out} onClick={() => updateHelm({ halyard: 0 })}>
            In
          </button>
          <button type="button" className={out ? 'active' : ''} aria-pressed={out} onClick={() => updateHelm({ halyard: 1 })}>
            Out
          </button>
        </div>
        <p className="sail-note">Out sets the main. In rolls it back into the boom.</p>
      </div>

      <Sheet value={helm.sheet} />
      <p className="sail-note">The wind swings the boom out until the sheet is taut.</p>
      <div className="sail-trim" ref={trim}>
        Boom amidships
      </div>

      <div className="jib-block">
        <div className="sheet-label">
          <span>Jib</span>
          <span>{Math.round((helm.jibPort + helm.jibStarboard) * 100)}% of the haul</span>
        </div>
        <div className="halyard" role="group" aria-label="Jib furling">
          <button
            type="button"
            className={jibOut ? '' : 'active'}
            aria-pressed={!jibOut}
            onClick={() => updateHelm({ jib: 0 })}
          >
            In
          </button>
          <button
            type="button"
            className={jibOut ? 'active' : ''}
            aria-pressed={jibOut}
            onClick={() => updateHelm({ jib: 1 })}
          >
            Out
          </button>
        </div>
        <p className="sail-note">Out sets the jib. In rolls it onto the forestay.</p>
        <div className="jib-sheets">
          <JibSheet side="port" value={helm.jibPort} max={jibSheetRoom(helm.jibStarboard)} />
          <JibSheet side="starboard" value={helm.jibStarboard} max={jibSheetRoom(helm.jibPort)} />
        </div>
        <p className="sail-note">Ease is up and tight is down. The two sheets share the haul, so 70% tight on one leaves 30% for the other. The hatch is the part the other sheet is holding.</p>
        <div className="sail-trim" ref={jibTrim}>
          Jib furled
        </div>
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
