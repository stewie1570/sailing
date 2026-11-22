import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import {
  NEUTRAL_GRAB,
  NEUTRAL_RELEASE,
  detent,
} from '../scene/boat/helm'
import {
  azimuthFromPointer,
  formatAzimuth,
  formatOrder,
  setPodDrag,
  updatePods,
  usePods,
  wrapAzimuth,
  type PodEnd,
  type Pods,
} from '../scene/boat/pods'
import { useCancelSliderTouch } from './sliderTouch'

/** Fraction of the dome the ball can travel. Matches the stem in the stylesheet. */
const TRAVEL = 0.32

function Dome({ end, azimuth, thrust, heading }: { end: PodEnd; azimuth: number; thrust: number; heading: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const notch = useRef(false)
  const [dragging, setDragging] = useState(false)
  useCancelSliderTouch(ref)
  const azKey = end === 'bow' ? 'bowAz' : 'sternAz'
  const thrustKey = end === 'bow' ? 'bowThrust' : 'sternThrust'
  const name = end === 'bow' ? 'Bow pod' : 'Stern pod'

  const place = (clientX: number, clientY: number, release: boolean) => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const dx = clientX - (r.left + r.width / 2)
    const dy = clientY - (r.top + r.height / 2)
    const travel = Math.min(r.width, r.height) * TRAVEL
    const reach = Math.min(1, Math.hypot(dx, dy) / Math.max(1, travel))
    const held = detent(reach, notch.current, NEUTRAL_GRAB, NEUTRAL_RELEASE)
    notch.current = release ? false : held.held
    const next = release && held.value <= NEUTRAL_RELEASE ? 0 : held.value
    if (next === 0) updatePods({ [thrustKey]: 0 })
    else updatePods({ [azKey]: azimuthFromPointer(dx, dy), [thrustKey]: next })
  }
  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    setPodDrag(end, true)
    setDragging(true)
    place(e.clientX, e.clientY, false)
  }
  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    e.preventDefault()
    place(e.clientX, e.clientY, false)
  }
  const onUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) place(e.clientX, e.clientY, true)
    setPodDrag(end, false)
    setDragging(false)
  }

  useEffect(() => () => setPodDrag(end, false), [end])

  const mag = Math.min(1, Math.abs(thrust))
  const aim = thrust < 0 ? wrapAzimuth(azimuth + Math.PI) : azimuth
  const x = -Math.sin(aim) * mag
  const y = -Math.cos(aim) * mag
  const deg = (-aim * 180) / Math.PI
  const headDeg = (-heading * 180) / Math.PI
  const order = formatOrder(thrust)
  const catching = Math.abs(wrapAzimuth(heading - azimuth)) > 0.04

  return (
    <div
      ref={ref}
      className={`pod-dome${dragging ? ' dragging' : ''}${mag < 0.02 ? ' in-stop' : ''}`}
      role="slider"
      aria-label={name}
      aria-valuemin={0}
      aria-valuemax={1}
      aria-valuenow={Number(mag.toFixed(2))}
      aria-valuetext={
        mag < 0.02
          ? `Stop. Pod ${formatAzimuth(heading)}`
          : `${formatAzimuth(aim)}, ${order}. Pod ${formatAzimuth(heading)}`
      }
      tabIndex={-1}
      onContextMenu={(e) => e.preventDefault()}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onDoubleClick={(e) => {
        e.preventDefault()
        notch.current = false
        updatePods({ [azKey]: 0, [thrustKey]: 0 })
      }}
    >
      <span className="pod-card ahead">Ahead</span>
      <span className="pod-card port">Port</span>
      <span className="pod-card stbd">Stbd</span>
      <span className="pod-card astern">Astern</span>
      <span className="pod-cup" />
      <span className={`pod-head${catching ? ' catching' : ''}`} style={{ transform: `rotate(${headDeg}deg)` }} aria-hidden="true">
        <span className="pod-head-mark" />
      </span>
      <span className="pod-stem" style={{ height: `${mag * TRAVEL * 100}%`, transform: `rotate(${deg}deg)` }} />
      <span className="pod-ball" style={{ left: `calc(50% + ${x * TRAVEL * 100}%)`, top: `calc(50% + ${y * TRAVEL * 100}%)` }} />
    </div>
  )
}

function Unit({ end, pods }: { end: PodEnd; pods: Pods }) {
  const azimuth = end === 'bow' ? pods.bowAz : pods.sternAz
  const thrust = end === 'bow' ? pods.bowThrust : pods.sternThrust
  const heading = end === 'bow' ? (pods.bowAim ?? azimuth) : (pods.sternAim ?? azimuth)
  const aim = thrust < 0 ? wrapAzimuth(azimuth + Math.PI) : azimuth
  return (
    <section className="pod-unit" aria-label={end === 'bow' ? 'Bow pod' : 'Stern pod'}>
      <header className="pod-name">{end === 'bow' ? 'Bow' : 'Stern'}</header>
      <Dome end={end} azimuth={azimuth} thrust={thrust} heading={heading} />
      <p className="pod-read">
        <span>{formatAzimuth(aim)}</span>
        <span>{formatOrder(thrust)}</span>
      </p>
      <p className="pod-lag">Pod {formatAzimuth(heading)}</p>
    </section>
  )
}

/** One bridge panel. Each pod is a single lever on a dome. */
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
