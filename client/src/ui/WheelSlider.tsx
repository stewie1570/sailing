import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { RUDDER_LOCK } from '../scene/boat/dynamics'
import {
  RUDDER_GRAB,
  RUDDER_RELEASE,
  detent,
  setControlDrag,
  updateHelm,
  useHelm,
} from '../scene/boat/helm'
import { wheelScreen } from '../scene/boat/telemetry'
import { useCancelSliderTouch } from './sliderTouch'

function clamp01(v: number) {
  return Math.min(1, Math.max(0, v))
}

function rudderFromX(el: HTMLElement, clientX: number) {
  const r = el.getBoundingClientRect()
  const t = (clientX - r.left) / Math.max(1, r.width)
  return 2 * clamp01(t) - 1
}

function rudderText(value: number) {
  const deg = Math.abs(value) * RUDDER_LOCK * (180 / Math.PI)
  if (deg < 0.8) return 'Straight'
  return `${deg.toFixed(0)}° ${value < 0 ? 'port' : 'stbd'}`
}

/**
 * Semi-transparent slider across the steering wheel. Centre is amidships:
 * the rudder lies parallel with the hull. Dragging left is port helm.
 */
export function WheelSlider() {
  const helm = useHelm()
  const rootRef = useRef<HTMLDivElement>(null)
  const notch = useRef(false)
  const [dragging, setDragging] = useState(false)
  useCancelSliderTouch(rootRef)

  useEffect(() => {
    let raf = 0
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const el = rootRef.current
      if (!el) return
      const w = wheelScreen
      const vw = window.innerWidth
      const vh = window.innerHeight
      const compact = vw <= 720 || vh <= 520
      const radius = w.radius > 4 ? w.radius : compact ? 28 : 36
      const cap = compact ? Math.min(136, vw * 0.38) : 460
      const floor = compact ? Math.min(92, cap) : 168
      const diameter = Math.max(floor, Math.min(cap, radius * (compact ? 1.35 : 2.05)))
      let x = w.x
      let y = w.y
      let onWheel = w.visible && Number.isFinite(x) && Number.isFinite(y)
      if (!onWheel || x < -120 || y < -120 || x > vw + 120 || y > vh + 120) {
        onWheel = false
        x = vw * (compact ? 0.34 : 0.5)
        y = vh - (compact ? 118 : 78)
      }
      const half = diameter / 2
      x = Math.min(vw - half - 10, Math.max(half + 10, x))
      y = Math.min(vh - 28, Math.max(28, y))
      if (compact) {
        const obstacles = ['.throttles', '.navmap']
          .map((sel) => document.querySelector(sel)?.getBoundingClientRect())
          .filter((rect): rect is DOMRect => !!rect && rect.width > 2 && rect.height > 2)
        const hits = (cx: number, cy: number, rect: DOMRect) => {
          const top = cy - 22
          const bottom = top + 48
          const left = cx - half
          const right = cx + half
          return right > rect.left + 2 && left < rect.right - 2 && bottom > rect.top + 2 && top < rect.bottom - 2
        }
        const hitsAny = (cx: number, cy: number) => obstacles.some((rect) => hits(cx, cy, rect))
        const clamp = (cx: number, cy: number) => ({
          x: Math.min(vw - half - 8, Math.max(half + 8, cx)),
          y: Math.min(vh - 28, Math.max(36, cy)),
        })
        if (hitsAny(x, y)) {
          const spots: [number, number][] = []
          for (const rect of obstacles) {
            spots.push([rect.left - 8 - half, y], [rect.right + 8 + half, y], [x, rect.top - 28])
            spots.push([rect.left - 8 - half, rect.top - 28], [rect.right + 8 + half, rect.top - 28])
          }
          for (const [cx, cy] of spots) {
            const next = clamp(cx, cy)
            if (!hitsAny(next.x, next.y)) {
              x = next.x
              y = next.y
              break
            }
          }
        }
        const parked = clamp(x, y)
        x = parked.x
        y = parked.y
      }
      el.style.width = `${diameter}px`
      el.style.transform = `translate3d(${x - half}px, ${y - 22}px, 0)`
      el.style.opacity = onWheel ? '1' : '0.92'
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  const apply = (raw: number, release: boolean) => {
    const d = detent(raw, notch.current, RUDDER_GRAB, RUDDER_RELEASE)
    notch.current = release ? false : d.held
    const next = release && Math.abs(d.value) <= RUDDER_RELEASE ? 0 : d.value
    updateHelm({ rudder: next })
  }

  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    setDragging(true)
    setControlDrag('rudder', true)
    apply(rudderFromX(e.currentTarget, e.clientX), false)
  }
  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    e.preventDefault()
    apply(rudderFromX(e.currentTarget, e.clientX), false)
  }
  const onUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging && !e.currentTarget.hasPointerCapture(e.pointerId)) return
    apply(rudderFromX(e.currentTarget, e.clientX), true)
    setDragging(false)
    setControlDrag('rudder', false)
  }

  const left = `${((helm.rudder + 1) / 2) * 100}%`

  return (
    <div
      ref={rootRef}
      className={`wheel-slider${dragging ? ' dragging' : ''}`}
      role="slider"
      aria-label="Rudder"
      aria-valuemin={-1}
      aria-valuemax={1}
      aria-valuenow={Number(helm.rudder.toFixed(2))}
      aria-valuetext={rudderText(helm.rudder)}
      tabIndex={-1}
      onContextMenu={(e) => e.preventDefault()}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    >
      <div className="wheel-readout">{rudderText(helm.rudder)}</div>
      <div className="wheel-track">
        <span className="wheel-end">Port</span>
        <span className="wheel-zero" />
        <span className="wheel-end wheel-end-stbd">Stbd</span>
        <div className="wheel-thumb" style={{ left }} />
      </div>
    </div>
  )
}
