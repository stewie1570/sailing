import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { useVessel } from '../scene/boat/vessel'
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

/** Same cutoff as the phone-only helm layout in index.css. Tablets stay on the compact rules. */
const PHONE_HELM = '(max-width: 500px), (max-height: 500px) and (max-width: 950px)'

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

function boxOf(sel: string): DOMRect | null {
  const rect = document.querySelector(sel)?.getBoundingClientRect()
  return rect && rect.width > 2 && rect.height > 2 ? rect : null
}

/**
 * On a phone the levers own the side edges, so the rudder takes the gap between
 * them. It stays off the mode tabs and the chart buttons, and it may cross the
 * chart. The bar itself is centred on the wheel: the box around it is not.
 */
function placePhoneRudder(el: HTMLDivElement, w: typeof wheelScreen, vw: number, vh: number) {
  const slots = [...document.querySelectorAll('.throttle-slot')]
    .map((node) => node.getBoundingClientRect())
    .filter((rect) => rect.width > 2 && rect.height > 2)
  let leftLimit = 8
  let rightLimit = vw - 8
  for (const rect of slots) {
    if (rect.left + rect.width / 2 < vw / 2) leftLimit = Math.max(leftLimit, rect.right + 18)
    else rightLimit = Math.min(rightLimit, rect.left - 18)
  }
  const sailing = boxOf('.throttles.mode-sailing')
  if (sailing) rightLimit = Math.min(rightLimit, sailing.left - 16)
  const gap = Math.max(0, rightLimit - leftLimit)
  const wheelHere = w.visible && Number.isFinite(w.x) && Number.isFinite(w.y) && w.x > -80 && w.x < vw + 80
  // Wider than the old phone slider, and short of the levers. A full-gap bar
  // covered the chart and was too easy to grab while looking around.
  let width = Math.min(gap, Math.max(200, Math.min(340, vw * 0.48)))
  if (gap < 200) width = Math.max(140, gap)
  let x = wheelHere ? w.x : (leftLimit + rightLimit) / 2
  const half = width / 2
  const lo = leftLimit + half
  const hi = rightLimit - half
  x = lo <= hi ? Math.min(hi, Math.max(lo, x)) : (leftLimit + rightLimit) / 2

  const overlapsX = (rect: DOMRect) => rect.right > x - half + 6 && rect.left < x + half - 6
  const above = [boxOf('.hud-speed'), boxOf('.helm-tabs'), boxOf('.hud-status')]
    .filter((rect): rect is DOMRect => !!rect && overlapsX(rect))
  const below = [boxOf('.navmap-zoom'), sailing].filter(
    (rect): rect is DOMRect => !!rect && overlapsX(rect),
  )
  let minY = 36
  let maxY = vh - 26
  for (const rect of above) minY = Math.max(minY, rect.bottom + 38)
  for (const rect of below) maxY = Math.min(maxY, rect.top - 24)
  let y = w.visible && Number.isFinite(w.y) ? w.y : vh * 0.46
  if (!w.visible || y < -120 || y > vh + 120) y = vh * 0.46
  y = minY <= maxY ? Math.min(maxY, Math.max(minY, y)) : maxY

  const onWheel = w.visible && Number.isFinite(w.x) && Number.isFinite(w.y)
  el.style.width = `${Math.round(width)}px`
  el.style.transform = `translate3d(${x - half}px, ${y - trackMid(el)}px, 0)`
  el.style.opacity = onWheel ? '1' : '0.92'
}

/** Centre of the visible bar, not of the box around it. */
function trackMid(el: HTMLElement) {
  const track = el.querySelector('.wheel-track')
  if (!(track instanceof HTMLElement)) return el.offsetHeight / 2 || 22
  return track.offsetTop + track.offsetHeight / 2
}

/**
 * Semi-transparent slider across the steering wheel. Centre is amidships:
 * the rudder lies parallel with the hull. Dragging left is port helm.
 */
export function WheelSlider() {
  const ferry = useVessel() === 'ferry'
  const helm = useHelm()
  const rootRef = useRef<HTMLDivElement>(null)
  const notch = useRef(false)
  const [dragging, setDragging] = useState(false)
  useCancelSliderTouch(rootRef)

  useEffect(() => {
    if (ferry) return
    let raf = 0
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const el = rootRef.current
      if (!el) return
      const w = wheelScreen
      const vw = window.innerWidth
      const vh = window.innerHeight
      if (window.matchMedia(PHONE_HELM).matches) {
        placePhoneRudder(el, w, vw, vh)
        return
      }
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
        const rectOf = (sel: string) => {
          const rect = document.querySelector(sel)?.getBoundingClientRect()
          return rect && rect.width > 2 && rect.height > 2 ? rect : null
        }
        const obstacles = ['.throttles', '.navmap'].map(rectOf).filter((rect): rect is DOMRect => !!rect)
        // Phone speed sits over the wheel. Dodge it here, and only here, so a tablet keeps its wheel.
        const phone = vw <= 500 || (vh <= 500 && vw <= 950)
        const speed = phone ? rectOf('.hud-speed') : null
        const blocked = speed ? [...obstacles, speed] : obstacles
        const hits = (cx: number, cy: number, rect: DOMRect) => {
          const top = cy - 22
          const bottom = top + 48
          const left = cx - half
          const right = cx + half
          return right > rect.left + 2 && left < rect.right - 2 && bottom > rect.top + 2 && top < rect.bottom - 2
        }
        const hitsAny = (cx: number, cy: number) => blocked.some((rect) => hits(cx, cy, rect))
        const clamp = (cx: number, cy: number) => ({
          x: Math.min(vw - half - 8, Math.max(half + 8, cx)),
          y: Math.min(vh - 28, Math.max(36, cy)),
        })
        if (hitsAny(x, y)) {
          const spots: [number, number][] = []
          if (speed) spots.push([x, speed.top - 28], [speed.left - 8 - half, y], [speed.right + 8 + half, y])
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
      el.style.transform = `translate3d(${x - half}px, ${y - trackMid(el)}px, 0)`
      el.style.opacity = onWheel ? '1' : '0.92'
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [ferry])

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
  if (ferry) return null

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
