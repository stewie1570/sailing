import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import {
  NEUTRAL_GRAB,
  NEUTRAL_RELEASE,
  detent,
  setControlDrag,
  updateHelm,
  useHelm,
} from '../scene/boat/helm'

const MARKS: { value: number; label: string; kind: 'ahead' | 'stop' | 'astern' }[] = [
  { value: 1, label: 'FULL', kind: 'ahead' },
  { value: 0.75, label: 'HALF', kind: 'ahead' },
  { value: 0.5, label: 'SLOW', kind: 'ahead' },
  { value: 0.25, label: 'D.SLOW', kind: 'ahead' },
  { value: 0, label: 'STOP', kind: 'stop' },
  { value: -0.25, label: 'D.SLOW', kind: 'astern' },
  { value: -0.5, label: 'SLOW', kind: 'astern' },
  { value: -0.75, label: 'HALF', kind: 'astern' },
  { value: -1, label: 'FULL', kind: 'astern' },
]

function clamp01(v: number) {
  return Math.min(1, Math.max(0, v))
}

/** Knob and tick position. Inset so the handle stays inside the groove at full travel. */
function travelTop(value: number) {
  const t = (1 - value) / 2
  return `calc(14px + ${t} * (100% - 28px))`
}

function valueFromY(el: HTMLElement, clientY: number) {
  const r = el.getBoundingClientRect()
  const pad = 14
  const t = (clientY - r.top - pad) / Math.max(1, r.height - pad * 2)
  return 1 - 2 * clamp01(t)
}

function engineOrder(value: number) {
  if (Math.abs(value) < 0.125) return 'STOP'
  const mag = Math.abs(value)
  const step = mag >= 0.875 ? 'FULL' : mag >= 0.625 ? 'HALF' : mag >= 0.375 ? 'SLOW' : 'D.SLOW'
  return `${step} ${value > 0 ? 'AHEAD' : 'ASTERN'}`
}

function travelLeft(value: number) {
  const t = (value + 1) / 2
  return `calc(14px + ${t} * (100% - 28px))`
}

function valueFromX(el: HTMLElement, clientX: number) {
  const r = el.getBoundingClientRect()
  const pad = 14
  const t = (clientX - r.left - pad) / Math.max(1, r.width - pad * 2)
  return 2 * clamp01(t) - 1
}

function thrusterOrder(value: number) {
  const mag = Math.abs(value)
  if (mag < 0.04) return 'Off'
  const side = value < 0 ? 'port' : 'stbd'
  if (mag > 0.96) return `Full ${side}`
  return `${Math.round(mag * 100)}% ${side}`
}

function Thruster({ end, value }: { end: 'bow' | 'stern'; value: number }) {
  const notch = useRef(false)
  const [dragging, setDragging] = useState(false)

  const apply = (raw: number, release: boolean) => {
    const d = detent(raw, notch.current, NEUTRAL_GRAB, NEUTRAL_RELEASE)
    notch.current = release ? false : d.held
    const next = release && Math.abs(d.value) <= NEUTRAL_RELEASE ? 0 : d.value
    updateHelm({ [end]: next })
  }

  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    setDragging(true)
    setControlDrag(end, true)
    apply(valueFromX(e.currentTarget, e.clientX), false)
  }
  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    apply(valueFromX(e.currentTarget, e.clientX), false)
  }
  const onUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId) && !dragging) return
    apply(valueFromX(e.currentTarget, e.clientX), true)
    setDragging(false)
    setControlDrag(end, false)
  }

  const name = end === 'bow' ? 'Bow thruster' : 'Stern thruster'

  return (
    <div className={`thruster thruster-${end}`}>
      <div className="thruster-head">
        <span>{end === 'bow' ? 'Bow' : 'Stern'}</span>
        <span>{thrusterOrder(value)}</span>
      </div>
      <div className="thruster-line">
        <span className="furler-end">Port</span>
        <div
          className={`thruster-track${dragging ? ' dragging' : ''}${value === 0 ? ' in-stop' : ''}`}
          role="slider"
          aria-label={name}
          aria-orientation="horizontal"
          aria-valuemin={-1}
          aria-valuemax={1}
          aria-valuenow={Number(value.toFixed(2))}
          aria-valuetext={thrusterOrder(value)}
          tabIndex={-1}
          onContextMenu={(e) => e.preventDefault()}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          onDoubleClick={(e) => {
            e.preventDefault()
            notch.current = false
            updateHelm({ [end]: 0 })
          }}
        >
          <div className="thruster-zero" />
          <div className="thruster-knob" style={{ left: travelLeft(value) }} />
        </div>
        <span className="furler-end out">Stbd</span>
      </div>
    </div>
  )
}

function Slot({ side, value }: { side: 'port' | 'starboard'; value: number }) {
  const slotRef = useRef<HTMLDivElement>(null)
  const notch = useRef(false)
  const [dragging, setDragging] = useState(false)

  const apply = (raw: number, release: boolean) => {
    const d = detent(raw, notch.current, NEUTRAL_GRAB, NEUTRAL_RELEASE)
    notch.current = release ? false : d.held
    const next = release && Math.abs(d.value) <= NEUTRAL_RELEASE ? 0 : d.value
    updateHelm({ [side]: next })
  }

  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    setDragging(true)
    setControlDrag(side, true)
    apply(valueFromY(e.currentTarget, e.clientY), false)
  }
  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    apply(valueFromY(e.currentTarget, e.clientY), false)
  }
  const onUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId) && !dragging) return
    apply(valueFromY(e.currentTarget, e.clientY), true)
    setDragging(false)
    setControlDrag(side, false)
  }

  const label = side === 'port' ? 'Port engine' : 'Starboard engine'

  return (
    <div
      ref={slotRef}
      className={`throttle-slot${dragging ? ' dragging' : ''}${value === 0 ? ' in-stop' : ''}`}
      role="slider"
      aria-label={label}
      aria-valuemin={-1}
      aria-valuemax={1}
      aria-valuenow={Number(value.toFixed(2))}
      aria-valuetext={engineOrder(value)}
      tabIndex={-1}
      onContextMenu={(e) => e.preventDefault()}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onDoubleClick={(e) => {
        e.preventDefault()
        notch.current = false
        updateHelm({ [side]: 0 })
      }}
    >
      <div className="throttle-gate" />
      <div className={`throttle-knob ${side}`} style={{ top: travelTop(value) }} />
    </div>
  )
}

export function Throttles() {
  const helm = useHelm()

  return (
    <div id="panel-engine" role="tabpanel" aria-label="Engine" aria-labelledby="tab-engine">
      <Thruster end="bow" value={helm.bow} />
      <div className="throttle-dir">Ahead</div>
      <div className="throttle-body">
        <Slot side="port" value={helm.port} />
        <div className="throttle-scale" aria-hidden="true">
          {MARKS.map((m) => (
            <div key={`${m.kind}-${m.value}`} className={`tick tick-${m.kind}`} style={{ top: travelTop(m.value) }}>
              <span>{m.label}</span>
            </div>
          ))}
        </div>
        <Slot side="starboard" value={helm.starboard} />
      </div>
      <div className="throttle-dir">Astern</div>
      <div className="throttle-foot">
        <div className="throttle-name">Port</div>
        <div className="throttle-name">Stbd</div>
      </div>
      <Thruster end="stern" value={helm.stern} />
    </div>
  )
}
