import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { useCancelSliderTouch } from './sliderTouch'
import { HEADSAIL_OUT, getHelm, jibSheetRoom, setControlDrag, updateHelm, useHelm, type Control } from '../scene/boat/helm'
import { JIB_STALL, luffAmount, readRig, spinTrim as kiteTrim } from '../scene/boat/sail'
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

function furlerFromX(el: HTMLElement, clientX: number) {
  const r = el.getBoundingClientRect()
  const pad = 14
  return clamp01((clientX - r.left - pad) / Math.max(1, r.width - pad * 2))
}

function furlerReadout(out: number) {
  if (out < 0.04) return 'Furled'
  if (out > 0.96) return 'Out'
  return `${Math.round(out * 100)}% out`
}

function ClothFurler({
  label,
  value,
  control,
  disabled = false,
  lockedText,
  onValue,
}: {
  label: string
  value: number
  control: Control
  disabled?: boolean
  lockedText?: string
  onValue: (value: number) => void
}) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)
  useCancelSliderTouch(trackRef)
  const at = `calc(14px + ${value} * (100% - 28px))`
  const shownDragging = dragging && !disabled

  const apply = (el: HTMLElement, clientX: number) => onValue(furlerFromX(el, clientX))
  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled) return
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    setDragging(true)
    setControlDrag(control, true)
    apply(e.currentTarget, e.clientX)
  }
  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled || !e.currentTarget.hasPointerCapture(e.pointerId)) return
    e.preventDefault()
    apply(e.currentTarget, e.clientX)
  }
  const onUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled) {
      setDragging(false)
      setControlDrag(control, false)
      return
    }
    if (!e.currentTarget.hasPointerCapture(e.pointerId) && !dragging) return
    apply(e.currentTarget, e.clientX)
    setDragging(false)
    setControlDrag(control, false)
  }

  return (
    <div className="furler-line">
      <span className="furler-end">In</span>
      <div
        ref={trackRef}
        className={`furler${shownDragging ? ' dragging' : ''}${disabled ? ' locked' : ''}`}
        role="slider"
        aria-orientation="horizontal"
        aria-label={label}
        aria-disabled={disabled}
        aria-valuemin={0}
        aria-valuemax={1}
        aria-valuenow={Number(value.toFixed(2))}
        aria-valuetext={disabled && lockedText ? lockedText : furlerReadout(value)}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onContextMenu={(e) => e.preventDefault()}
      >
        <div className="furler-fill" style={{ width: value < 0.02 ? 0 : at }} />
        <div className="furler-knob" style={{ left: at }} />
      </div>
      <span className="furler-end out">Out</span>
    </div>
  )
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
  const trackRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)
  useCancelSliderTouch(trackRef)
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
    e.preventDefault()
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
        ref={trackRef}
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

function trimWords(hoist: number, aoa: number, awa: number) {
  if (hoist < 0.04) return 'In the boom'
  const amount = hoist > 0.96 ? '' : `${Math.round(hoist * 100)}% out · `
  if (luffAmount(aoa, awa, hoist) > 0.35) return `${amount}Luffing`
  const deg = aoa * (180 / Math.PI)
  if (deg > 50) return `${amount}Stalled`
  return `${amount}Drawing`
}

/** The sheets keep the jib names until the spinnaker furler leaves the furled stop. */
const SPIN_SET = HEADSAIL_OUT

export function SailingControls() {
  const helm = useHelm()
  const jibOut = helm.jib >= HEADSAIL_OUT
  const spinOut = helm.spin >= HEADSAIL_OUT
  const jibLocked = spinOut && !jibOut
  const spinLocked = jibOut && !spinOut
  const spinSet = helm.spin >= SPIN_SET
  const wind = useWindDisplay()
  const arrow = useRef<HTMLDivElement>(null)
  const detail = useRef<HTMLDivElement>(null)
  const trim = useRef<HTMLDivElement>(null)
  const jibTrim = useRef<HTMLDivElement>(null)
  const spinTrim = useRef<HTMLDivElement>(null)

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
        trim.current.textContent = `${boom} · ${trimWords(sail.hoist, sail.aoa, sail.awa)}`
      }
      const now = getHelm()
      const jibIsOut = now.jib >= HEADSAIL_OUT
      const spinIsOut = now.spin >= HEADSAIL_OUT
      if (jibTrim.current) jibTrim.current.textContent = spinIsOut && !jibIsOut ? 'Furl the spin' : jibLine(rig)
      if (spinTrim.current) spinTrim.current.textContent = jibIsOut && !spinIsOut ? 'Furl the jib' : spinLine(rig)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

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

      <div className={`furler-block furler-jib${jibLocked ? ' locked' : ''}`}>
        <div className="furler-head">
          <span className="sail-toggle-name">Jib</span>
          <span className="sail-toggle-state" ref={jibTrim}>
            Furled
          </span>
        </div>
        <ClothFurler
          label="Jib furler"
          value={helm.jib}
          control="jib"
          disabled={jibLocked}
          lockedText="Furl the spin"
          onValue={(jib) => updateHelm({ jib })}
        />
      </div>

      <div className={`furler-block furler-spin${spinLocked ? ' locked' : ''}`}>
        <div className="furler-head">
          <span className="sail-toggle-name">Spin</span>
          <span className="sail-toggle-state" ref={spinTrim}>
            Furled
          </span>
        </div>
        <ClothFurler
          label="Spinnaker furler"
          value={helm.spin}
          control="spin"
          disabled={spinLocked}
          lockedText="Furl the jib"
          onValue={(spin) => updateHelm({ spin })}
        />
      </div>

      <div className="furler-block furler-main">
        <div className="furler-head">
          <span className="sail-toggle-name">Main</span>
          <span className="sail-toggle-state" ref={trim}>
            In the boom
          </span>
        </div>
        <ClothFurler label="Main halyard" value={helm.halyard} control="halyard" onValue={(halyard) => updateHelm({ halyard })} />
      </div>

      <div className="sheet-row">
        <SheetColumn
          title={spinSet ? 'Port spin' : 'Port jib'}
          aria={spinSet ? 'Port spinnaker sheet' : 'Port jib sheet'}
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
          title={spinSet ? 'Stbd spin' : 'Stbd jib'}
          aria={spinSet ? 'Starboard spinnaker sheet' : 'Starboard jib sheet'}
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

function clothLine(hoist: number, clew: number, luff: number, aoa: number, stall: number) {
  if (hoist < 0.04) return 'Furled'
  const deg = Math.abs(clew) * (180 / Math.PI)
  const side = clew > 0.04 ? 'stbd' : clew < -0.04 ? 'port' : ''
  const where = deg < 2 ? 'Amidships' : `${deg.toFixed(0)}° ${side}`.trim()
  let state = 'Drawing'
  if (luff > 0.35) state = 'Luffing'
  else if (aoa > stall) state = 'Stalled'
  return `${where} · ${state}`
}

function jibLine(rig: ReturnType<typeof readRig>) {
  const jib = rig.jib
  return clothLine(jib.hoist, jib.clew, jib.luff, jib.aoa, JIB_STALL)
}

function spinLine(rig: ReturnType<typeof readRig>) {
  const spin = rig.spin
  if (spin.hoist < 0.04) return 'Furled'
  const helm = getHelm()
  const set = kiteTrim(helm.jibPort, helm.jibStarboard)
  const center = spin.clew
  const portEdge = center - set.half
  const stbdEdge = center + set.half
  const both = portEdge < -0.15 && stbdEdge > 0.15
  let where = 'Both sides'
  if (!both) where = center >= 0 ? 'Stbd' : 'Port'
  else if (center > 0.22) where = 'Both, favoring stbd'
  else if (center < -0.22) where = 'Both, favoring port'
  const state = spin.luff > 0.6 ? 'Luffing' : 'Drawing'
  return `${where} · ${state}`
}
