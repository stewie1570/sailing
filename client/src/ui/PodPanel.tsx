import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import {
  NEUTRAL_GRAB,
  NEUTRAL_RELEASE,
  detent,
} from '../scene/boat/helm'
import {
  azimuthFromPointer,
  formatAzimuth,
  formatThrust,
  updatePods,
  usePods,
  type Pods,
} from '../scene/boat/pods'
import { useCancelSliderTouch } from './sliderTouch'

type End = 'bow' | 'stern'

const TICKS = [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330]

function clamp01(v: number) {
  return Math.min(1, Math.max(0, v))
}

function travelTop(value: number) {
  const t = (1 - value) / 2
  return `calc(12px + ${t} * (100% - 24px))`
}

function valueFromY(el: HTMLElement, clientY: number) {
  const r = el.getBoundingClientRect()
  const pad = 12
  const t = (clientY - r.top - pad) / Math.max(1, r.height - pad * 2)
  return 1 - 2 * clamp01(t)
}

function Dial({ end, azimuth, thrust }: { end: End; azimuth: number; thrust: number }) {
  const ref = useRef<HTMLDivElement>(null)
  useCancelSliderTouch(ref)
  const key = end === 'bow' ? 'bowAz' : 'sternAz'
  const set = (clientX: number, clientY: number) => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const dx = clientX - (r.left + r.width / 2)
    const dy = clientY - (r.top + r.height / 2)
    updatePods({ [key]: azimuthFromPointer(dx, dy) })
  }
  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    set(e.clientX, e.clientY)
  }
  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    e.preventDefault()
    set(e.clientX, e.clientY)
  }
  const deg = (-azimuth * 180) / Math.PI
  const astern = thrust < -0.02

  return (
    <div
      ref={ref}
      className="pod-dial"
      role="slider"
      aria-label={end === 'bow' ? 'Bow pod direction' : 'Stern pod direction'}
      aria-valuemin={0}
      aria-valuemax={359}
      aria-valuenow={(Math.round((azimuth * 180) / Math.PI) + 360) % 360}
      aria-valuetext={formatAzimuth(azimuth)}
      tabIndex={-1}
      onContextMenu={(e) => e.preventDefault()}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onMove}
      onDoubleClick={(e) => {
        e.preventDefault()
        updatePods({ [key]: 0 })
      }}
    >
      {TICKS.map((tick) => (
        <span key={tick} className={`pod-tick${tick % 90 === 0 ? ' cardinal' : ''}`} style={{ transform: `rotate(${tick}deg)` }} />
      ))}
      <span className="pod-card ahead">Ahead</span>
      <span className="pod-card port">Port</span>
      <span className="pod-card stbd">Stbd</span>
      <span className="pod-ship" aria-hidden="true" />
      <div className="pod-azimuth" style={{ transform: `rotate(${deg}deg)` }}>
        <span className="pod-arm" />
        <span className={`pod-wedge${astern ? ' astern' : ''}`} />
      </div>
    </div>
  )
}

function Lever({ end, value }: { end: End; value: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const notch = useRef(false)
  const [dragging, setDragging] = useState(false)
  useCancelSliderTouch(ref)
  const key = end === 'bow' ? 'bowThrust' : 'sternThrust'

  const apply = (raw: number, release: boolean) => {
    const held = detent(raw, notch.current, NEUTRAL_GRAB, NEUTRAL_RELEASE)
    notch.current = release ? false : held.held
    const next = release && Math.abs(held.value) <= NEUTRAL_RELEASE ? 0 : held.value
    updatePods({ [key]: next })
  }
  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    setDragging(true)
    apply(valueFromY(e.currentTarget, e.clientY), false)
  }
  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    e.preventDefault()
    apply(valueFromY(e.currentTarget, e.clientY), false)
  }
  const onUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId) && !dragging) return
    apply(valueFromY(e.currentTarget, e.clientY), true)
    setDragging(false)
  }

  return (
    <div
      ref={ref}
      className={`pod-lever${dragging ? ' dragging' : ''}${value === 0 ? ' in-stop' : ''}`}
      role="slider"
      aria-label={end === 'bow' ? 'Bow pod thrust' : 'Stern pod thrust'}
      aria-valuemin={-1}
      aria-valuemax={1}
      aria-valuenow={Number(value.toFixed(2))}
      aria-valuetext={formatThrust(value)}
      tabIndex={-1}
      onContextMenu={(e) => e.preventDefault()}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onDoubleClick={(e) => {
        e.preventDefault()
        notch.current = false
        updatePods({ [key]: 0 })
      }}
    >
      <div className="pod-lever-gate" />
      <div className="pod-knob" style={{ top: travelTop(value) }} />
    </div>
  )
}

function Unit({ end, pods }: { end: End; pods: Pods }) {
  const azimuth = end === 'bow' ? pods.bowAz : pods.sternAz
  const thrust = end === 'bow' ? pods.bowThrust : pods.sternThrust
  return (
    <section className="pod-unit" aria-label={end === 'bow' ? 'Bow pod' : 'Stern pod'}>
      <header className="pod-name">{end === 'bow' ? 'Bow' : 'Stern'}</header>
      <div className="pod-row">
        <Dial end={end} azimuth={azimuth} thrust={thrust} />
        <div className="pod-thrust">
          <span>Ahead</span>
          <Lever end={end} value={thrust} />
          <span>Astern</span>
        </div>
      </div>
      <p className="pod-read">
        <span>{formatAzimuth(azimuth)}</span>
        <span>{formatThrust(thrust)}</span>
      </p>
    </section>
  )
}

/** One bridge panel for both pods. No engine tab and no sailing tab. */
export function PodPanel() {
  const pods = usePods()
  return (
    <div className="pod-panel" aria-label="Azimuth pods">
      <div className="pod-units">
        <Unit end="bow" pods={pods} />
        <Unit end="stern" pods={pods} />
      </div>
    </div>
  )
}
