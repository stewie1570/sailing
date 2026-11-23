import { useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import type { ShipMessage } from '../net/protocol'
import { eachFreshShip, useSession } from '../net/session'
import { openAis, setAisChartWide, useAisMail } from '../net/aisMail'
import { formatKnots, propulsionLabel, telemetry } from '../scene/boat/telemetry'
import { berthEnds, getChallenge, packageWorld } from '../scene/challenge'
import { HARBOR_BASINS, harborPieces, type HarborPiece } from '../scene/harborLayout'
import { compassPoint, getWind, MS_TO_KN, windFromDegrees } from '../scene/boat/wind'

interface ChartMeta {
  name: string
  metersPerPixel: number
  image: { width: number; height: number }
  worldSize: [number, number]
  buoys: { type: 'port' | 'starboard'; x: number; z: number }[]
  harbors: { name: string; x: number; z: number }[]
}

/** Close chart window. A third of the old 1.8 km, matching the scaled lake. */
const NEAR_METRES = 600

type ChartSpan = 'lake' | 'mid' | 'near'

/** Boat-centred width halfway in scale between the whole chart and Near. */
function midMetres(worldW: number) {
  return Math.sqrt(worldW * NEAR_METRES)
}

function buoyRadius(span: ChartSpan) {
  if (span === 'near') return 3
  if (span === 'mid') return 2.5
  return 2
}

/** How close the pointer must be, in CSS pixels, to count as over another boat. */
const SHIP_HIT = 18

/** Same phone cutoff as the helm layout in index.css and WheelSlider.tsx. */
const PHONE_HELM = '(max-width: 500px), (max-height: 500px) and (max-width: 950px)'

function usePhoneHelm() {
  const [phone, setPhone] = useState(() => window.matchMedia(PHONE_HELM).matches)
  useEffect(() => {
    const media = window.matchMedia(PHONE_HELM)
    const sync = () => setPhone(media.matches)
    sync()
    media.addEventListener('change', sync)
    return () => media.removeEventListener('change', sync)
  }, [])
  return phone
}

interface ChartShip {
  ship: ShipMessage
  x: number
  y: number
}

/**
 * North-up aerial chart. Lake shows the whole of Windermere. Mid and Near stay
 * centred on the boat; Mid is the scale step between the lake and the close shore.
 * A shared room also plots the other boats. Hover one for her speed and whether
 * she is under engine, sail, or both. Expand grows the chart to a little under
 * half the screen in both width and height.
 */
export function NavMap() {
  const session = useSession()
  const shared = session.role === 'host' || session.role === 'guest'
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const titleRef = useRef<HTMLSpanElement>(null)
  const readRef = useRef<HTMLSpanElement>(null)
  const tipRef = useRef<HTMLDivElement>(null)
  const tipNameRef = useRef<HTMLElement>(null)
  const tipSpeedRef = useRef<HTMLElement>(null)
  const tipDriveRef = useRef<HTMLElement>(null)
  const [span, setSpan] = useState<ChartSpan>('lake')
  const [wide, setWide] = useState(false)
  const [open, setOpen] = useState(true)
  const phone = usePhoneHelm()
  const chartOn = !phone || open
  const spanRef = useRef<ChartSpan>('lake')
  const sharedRef = useRef(false)
  const pointerRef = useRef<{ x: number; y: number } | null>(null)
  const heldRef = useRef<ChartShip | null>(null)
  const stickRef = useRef(false)
  const mail = useAisMail()

  useEffect(() => {
    spanRef.current = span
    sharedRef.current = shared
  }, [span, shared])

  useEffect(() => {
    setAisChartWide(shared && wide && chartOn)
    return () => setAisChartWide(false)
  }, [shared, wide, chartOn])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let dead = false
    let meta: ChartMeta | null = null
    const img = new Image()
    img.src = '/map/landcolor.jpg'
    fetch('/map/mapdata.json')
      .then((r) => r.json() as Promise<ChartMeta>)
      .then((j) => {
        if (!dead) meta = j
      })
      .catch(() => {})

    const pieces = harborPieces()
    let raf = 0
    const draw = () => {
      raf = requestAnimationFrame(draw)
      const cssW = canvas.clientWidth
      const cssH = canvas.clientHeight
      if (cssW < 2 || cssH < 2) {
        if (tipRef.current) tipRef.current.hidden = true
        return
      }
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      const bw = Math.floor(cssW * dpr)
      const bh = Math.floor(cssH * dpr)
      if (canvas.width !== bw || canvas.height !== bh) {
        canvas.width = bw
        canvas.height = bh
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, cssW, cssH)
      ctx.fillStyle = '#16324a'
      ctx.fillRect(0, 0, cssW, cssH)
      if (!img.complete || img.naturalWidth === 0 || !meta) {
        if (tipRef.current) tipRef.current.hidden = true
        return
      }

      const mpp = meta.metersPerPixel
      const worldW = meta.worldSize[0]
      const aspect = cssW / cssH
      let viewW = worldW
      let viewH = viewW / aspect
      let cx = 0
      let cz = 0
      const chartSpan = spanRef.current
      if (chartSpan !== 'lake' && telemetry.ready) {
        viewW = chartSpan === 'near' ? NEAR_METRES : midMetres(worldW)
        viewH = viewW / aspect
        cx = telemetry.x
        cz = telemetry.z
      }
      // Source pixels. Image row 0 is north, matching toPixel.
      const px = (x: number) => x / mpp + meta!.image.width / 2
      const py = (z: number) => z / mpp + meta!.image.height / 2
      let sw = viewW / mpp
      let sh = viewH / mpp
      let sx = px(cx) - sw / 2
      let sy = py(cz) - sh / 2
      if (sw > img.naturalWidth) {
        sw = img.naturalWidth
        viewW = sw * mpp
      }
      if (sh > img.naturalHeight) {
        sh = img.naturalHeight
        viewH = sh * mpp
      }
      if (sx < 0) sx = 0
      if (sy < 0) sy = 0
      if (sx + sw > img.naturalWidth) sx = img.naturalWidth - sw
      if (sy + sh > img.naturalHeight) sy = img.naturalHeight - sh
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, cssW, cssH)

      const toScreen = (x: number, z: number) => ({
        x: ((px(x) - sx) / sw) * cssW,
        y: ((py(z) - sy) / sh) * cssH,
      })
      const chartTo = (cx: number, cy: number) => toScreen((cx - meta!.image.width / 2) * mpp, (cy - meta!.image.height / 2) * mpp)

      ctx.fillStyle = '#1b6486'
      for (const basin of HARBOR_BASINS) {
        ctx.beginPath()
        basin.forEach(([bx, by], i) => {
          const p = chartTo(bx, by)
          if (i === 0) ctx.moveTo(p.x, p.y)
          else ctx.lineTo(p.x, p.y)
        })
        ctx.closePath()
        ctx.fill()
      }

      const kindColor: Record<HarborPiece['kind'], string> = {
        mole: '#c6b496',
        deck: '#efe6d2',
        finger: '#f7f3ea',
      }
      for (const piece of pieces) {
        const a = chartTo(piece.x0, piece.y0)
        const b = chartTo(piece.x1, piece.y1)
        const dx = b.x - a.x
        const dy = b.y - a.y
        const len = Math.hypot(dx, dy)
        const thick = Math.max(piece.kind === 'mole' ? 2.2 : 1.7, (piece.thickness / viewW) * cssW)
        if (len < (piece.kind === 'mole' ? 1 : 2)) continue
        ctx.save()
        ctx.translate((a.x + b.x) / 2, (a.y + b.y) / 2)
        ctx.rotate(Math.atan2(dy, dx))
        ctx.fillStyle = kindColor[piece.kind]
        ctx.fillRect(-len / 2 - 0.6, -thick / 2, len + 1.2, thick)
        ctx.restore()
      }

      for (const b of meta.buoys) {
        const p = toScreen(b.x, b.z)
        if (p.x < -4 || p.y < -4 || p.x > cssW + 4 || p.y > cssH + 4) continue
        ctx.beginPath()
        ctx.arc(p.x, p.y, buoyRadius(chartSpan), 0, Math.PI * 2)
        ctx.fillStyle = b.type === 'port' ? '#e5484d' : '#3ddc84'
        ctx.fill()
      }

      ctx.font = '600 11px Segoe UI, sans-serif'
      ctx.textAlign = 'center'
      ctx.lineWidth = 3
      // Near mode already names the harbor in the title. Lake and Mid keep the name
      // just above the basin so it does not cover the slips.
      if (chartSpan !== 'near') {
        HARBOR_BASINS.forEach((basin, index) => {
          const name = meta!.harbors[index]?.name
          if (!name) return
          let top = Number.POSITIVE_INFINITY
          let mid = 0
          for (const [bx, by] of basin) {
            const p = chartTo(bx, by)
            mid += p.x
            if (p.y < top) top = p.y
          }
          const x = mid / basin.length
          const y = top - 8
          if (x < 8 || y < 16 || x > cssW - 8 || y > cssH - 8) return
          ctx.strokeStyle = 'rgba(8, 16, 28, 0.8)'
          ctx.strokeText(name, x, y)
          ctx.fillStyle = '#f4f7fb'
          ctx.fillText(name, x, y)
        })
      }

      if (telemetry.ready) {
        const p = toScreen(telemetry.x, telemetry.z)
        const heading = Math.atan2(Math.sin(telemetry.yaw), -Math.cos(telemetry.yaw))
        ctx.save()
        ctx.translate(p.x, p.y)
        ctx.rotate(heading)
        ctx.beginPath()
        ctx.moveTo(0, -12)
        ctx.lineTo(6.5, 8)
        ctx.lineTo(0, 4)
        ctx.lineTo(-6.5, 8)
        ctx.closePath()
        ctx.fillStyle = '#f7fbff'
        ctx.strokeStyle = '#102033'
        ctx.lineWidth = 1.6
        ctx.fill()
        ctx.stroke()
        const reach = 10 + Math.min(26, Math.abs(telemetry.speed) * 3.2)
        ctx.beginPath()
        ctx.moveTo(0, -8)
        ctx.lineTo(0, -reach)
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)'
        ctx.lineWidth = 1.5
        ctx.stroke()
        ctx.restore()

        drawChallenge(ctx, toScreen, cssW, cssH)

        const deg = (heading * 180) / Math.PI
        const hdg = `${(Math.round((deg + 360) % 360) % 360).toString().padStart(3, '0')}°`
        const spd = formatKnots(telemetry.speed, telemetry.sway)
        if (readRef.current) readRef.current.textContent = `${hdg}  ${spd}`

        let place = 'Windermere'
        let best = 850
        for (const h of meta.harbors) {
          const d = Math.hypot(h.x - telemetry.x, h.z - telemetry.z)
          if (d < best) {
            best = d
            place = h.name
          }
        }
        if (titleRef.current) titleRef.current.textContent = place
      }

      const others: ChartShip[] = []
      if (sharedRef.current) {
        eachFreshShip((ship) => {
          const p = toScreen(ship.x, ship.z)
          if (p.x < -24 || p.y < -24 || p.x > cssW + 24 || p.y > cssH + 24) return
          others.push({ ship, x: p.x, y: p.y })
        })
      }
      const pointer = sharedRef.current ? pointerRef.current : null
      let hot = -1
      if (pointer) {
        let best = Number.POSITIVE_INFINITY
        others.forEach((other, index) => {
          if (!overShip(pointer, other)) return
          const dist = (pointer.x - other.x) ** 2 + (pointer.y - other.y) ** 2
          if (dist < best) {
            best = dist
            hot = index
          }
        })
      }
      let shown: ChartShip | null = hot >= 0 ? others[hot] : null
      if (shown) heldRef.current = shown
      else if (heldRef.current && (stickRef.current || (pointer && overTip(pointer, tipRef.current, canvas)))) {
        const id = heldRef.current.ship.playerId
        shown = others.find((other) => other.ship.playerId === id) ?? heldRef.current
      } else heldRef.current = null
      const shownId = shown?.ship.playerId
      for (let i = 0; i < others.length; i++) {
        drawOtherBoat(ctx, others[i], others[i].ship.playerId === shownId)
      }
      placeTip(tipRef.current, tipNameRef.current, tipSpeedRef.current, tipDriveRef.current, canvas, shown)

      ctx.fillStyle = 'rgba(255,255,255,0.92)'
      ctx.font = '700 12px Segoe UI, sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText('N', cssW / 2, 14)

      const wind = getWind()
      const going = (windFromDegrees(wind.blowYaw) * Math.PI) / 180 + Math.PI
      const roseX = cssW - 24
      const roseY = 22
      ctx.save()
      ctx.translate(roseX, roseY)
      ctx.beginPath()
      ctx.arc(0, 0, 12, 0, Math.PI * 2)
      ctx.fillStyle = 'rgba(8, 16, 28, 0.55)'
      ctx.fill()
      ctx.rotate(going)
      ctx.beginPath()
      ctx.moveTo(0, -8)
      ctx.lineTo(3.2, -1)
      ctx.lineTo(1.3, -1)
      ctx.lineTo(1.3, 7)
      ctx.lineTo(-1.3, 7)
      ctx.lineTo(-1.3, -1)
      ctx.lineTo(-3.2, -1)
      ctx.closePath()
      ctx.fillStyle = '#9fd4ff'
      ctx.fill()
      ctx.restore()
      const windLabel = `${compassPoint(windFromDegrees(wind.blowYaw))} ${(wind.speed * MS_TO_KN).toFixed(0)} kn`
      ctx.font = '10px Segoe UI, sans-serif'
      ctx.textAlign = 'center'
      const windW = ctx.measureText(windLabel).width
      ctx.fillStyle = 'rgba(8, 16, 28, 0.55)'
      ctx.fillRect(roseX - windW / 2 - 4, roseY + 14, windW + 8, 13)
      ctx.fillStyle = '#f4f7fb'
      ctx.fillText(windLabel, roseX, roseY + 24)

      const metresPerPx = viewW / cssW
      const target = metresPerPx > 40 ? 5000 : metresPerPx > 12 ? 1000 : 500
      const bar = Math.min(cssW * 0.42, target / metresPerPx)
      const label = target >= 1000 ? `${target / 1000} km` : `${target} m`
      ctx.font = '10px Segoe UI, sans-serif'
      ctx.textAlign = 'left'
      const labelW = ctx.measureText(label).width
      ctx.fillStyle = 'rgba(8, 16, 28, 0.55)'
      ctx.fillRect(6, cssH - 18, bar + labelW + 14, 14)
      ctx.fillStyle = '#f4f7fb'
      ctx.fillRect(10, cssH - 12, bar, 2)
      ctx.fillText(label, 14 + bar, cssH - 8)
    }
    const pointFrom = (ev: PointerEvent) => {
      const rect = canvas.getBoundingClientRect()
      return { x: ev.clientX - rect.left, y: ev.clientY - rect.top }
    }
    const onMove = (ev: PointerEvent) => {
      if (ev.pointerType === 'touch') return
      pointerRef.current = pointFrom(ev)
    }
    const onLeave = (ev: PointerEvent) => {
      if (ev.pointerType === 'touch') return
      const next = ev.relatedTarget
      if (tipRef.current && next instanceof Node && tipRef.current.contains(next)) {
        stickRef.current = true
        return
      }
      stickRef.current = false
      pointerRef.current = null
    }
    const onDown = (ev: PointerEvent) => {
      if (ev.pointerType === 'mouse') return
      const next = pointFrom(ev)
      const prev = pointerRef.current
      if (prev && Math.hypot(prev.x - next.x, prev.y - next.y) < 8) pointerRef.current = null
      else pointerRef.current = next
    }
    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerleave', onLeave)
    canvas.addEventListener('pointerdown', onDown)
    raf = requestAnimationFrame(draw)
    return () => {
      dead = true
      cancelAnimationFrame(raf)
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerleave', onLeave)
      canvas.removeEventListener('pointerdown', onDown)
    }
  }, [])

  const banner = shared ? mail.banner : null
  const lit = (next: ChartSpan) => chartOn && span === next
  // On a phone the scale buttons are a radio that can be turned off. The lit
  // one hides the chart; any other one brings that scale back. Tablet and
  // desktop keep the chart up.
  const chooseSpan = (next: ChartSpan) => {
    if (phone && open && span === next) {
      setOpen(false)
      return
    }
    setSpan(next)
    setOpen(true)
  }

  return (
    <div className={['hud', 'navmap', chartOn && wide ? 'wide' : '', chartOn ? '' : 'off'].filter(Boolean).join(' ')}>
      {banner && (
        <button
          type="button"
          className="ais-banner"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => {
            flushSync(() => openAis(banner.fromId, banner.fromName))
            document.getElementById('ais-draft')?.focus({ preventScroll: true })
          }}
        >
          <span className="ais-banner-name">{banner.fromName}</span>
          <span className="ais-banner-text">{banner.text}</span>
        </button>
      )}
      <div className="navmap-head">
        <span ref={titleRef}>Chart</span>
        <span ref={readRef} className="navmap-read">—</span>
      </div>
      <canvas ref={canvasRef} />
      <div
        ref={tipRef}
        className="navmap-tip"
        role="tooltip"
        hidden
        onPointerEnter={() => { stickRef.current = true }}
        onPointerLeave={(ev) => {
          const next = ev.relatedTarget
          if (canvasRef.current && next instanceof Node && canvasRef.current.contains(next)) {
            stickRef.current = false
            return
          }
          stickRef.current = false
          pointerRef.current = null
          heldRef.current = null
        }}
      >
        <strong ref={tipNameRef} />
        <span ref={tipSpeedRef} />
        <span ref={tipDriveRef} />
        <button
          type="button"
          onClick={() => {
            const ship = heldRef.current?.ship
            if (!ship) return
            // Mount the field inside this tap. iOS only opens the keyboard for
            // a focus call that happens in the gesture, not in an effect later.
            flushSync(() => openAis(ship.playerId, ship.name || 'Sailor'))
            document.getElementById('ais-draft')?.focus({ preventScroll: true })
            stickRef.current = false
            pointerRef.current = null
            heldRef.current = null
          }}
        >
          Message
        </button>
      </div>
      <div className="navmap-zoom" role="group" aria-label="Chart scale">
        <button type="button" className={lit('lake') ? 'active' : ''} aria-pressed={lit('lake')} onClick={() => chooseSpan('lake')}>
          Lake
        </button>
        <button type="button" className={lit('mid') ? 'active' : ''} aria-pressed={lit('mid')} onClick={() => chooseSpan('mid')}>
          Mid
        </button>
        <button type="button" className={lit('near') ? 'active' : ''} aria-pressed={lit('near')} onClick={() => chooseSpan('near')}>
          Near
        </button>
        <button
          type="button"
          className={chartOn && wide ? 'active' : ''}
          aria-pressed={chartOn && wide}
          onClick={() => {
            if (phone && !open) {
              setOpen(true)
              return
            }
            setWide((on) => !on)
          }}
        >
          {chartOn && wide ? 'Shrink' : 'Expand'}
        </button>
      </div>
    </div>
  )
}

function overTip(pointer: { x: number; y: number }, tip: HTMLElement | null, canvas: HTMLCanvasElement) {
  if (!tip || tip.hidden) return false
  const box = tip.getBoundingClientRect()
  const host = canvas.getBoundingClientRect()
  const x = host.left + pointer.x
  const y = host.top + pointer.y
  const pad = 16
  return x >= box.left - pad && x <= box.right + pad && y >= box.top - pad && y <= box.bottom + pad
}

function overShip(pointer: { x: number; y: number }, other: ChartShip) {
  const dx = pointer.x - other.x
  const dy = pointer.y - other.y
  if (dx * dx + dy * dy <= SHIP_HIT * SHIP_HIT) return true
  const half = Math.min(72, 8 + other.ship.name.length * 3.2)
  return Math.abs(dx) <= half && dy < -2 && dy > -30
}

/** Gold ring on the target dock, and an edge arrow when that dock is off the chart. */
function drawChallenge(
  ctx: CanvasRenderingContext2D,
  toScreen: (x: number, z: number) => { x: number; y: number },
  cssW: number,
  cssH: number,
) {
  const challenge = getChallenge()
  const berth = challenge.target
  if (!berth || challenge.phase === 'idle') return
  const ends = berthEnds(berth)
  const a = toScreen(ends.x0, ends.z0)
  const b = toScreen(ends.x1, ends.z1)
  ctx.save()
  ctx.strokeStyle = '#f5c242'
  ctx.lineWidth = 3
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(a.x, a.y)
  ctx.lineTo(b.x, b.y)
  ctx.stroke()

  const spot = packageWorld(berth)
  const p = toScreen(spot.x, spot.z)
  const margin = 14
  const inside = p.x >= margin && p.y >= margin && p.x <= cssW - margin && p.y <= cssH - margin
  if (inside) {
    ctx.beginPath()
    ctx.arc(p.x, p.y, 7, 0, Math.PI * 2)
    ctx.lineWidth = 2
    ctx.stroke()
    if (challenge.cargo === 'dock') {
      ctx.beginPath()
      ctx.arc(p.x, p.y, 3.4, 0, Math.PI * 2)
      ctx.fillStyle = '#e25b2a'
      ctx.fill()
    }
  } else {
    const cx = cssW / 2
    const cy = cssH / 2
    const vx = p.x - cx
    const vy = p.y - cy
    const sx = (cssW / 2 - margin) / Math.max(Math.abs(vx), 0.001)
    const sy = (cssH / 2 - margin) / Math.max(Math.abs(vy), 0.001)
    const t = Math.min(sx, sy)
    ctx.translate(cx + vx * t, cy + vy * t)
    ctx.rotate(Math.atan2(vy, vx))
    ctx.beginPath()
    ctx.moveTo(8, 0)
    ctx.lineTo(-6, 5)
    ctx.lineTo(-6, -5)
    ctx.closePath()
    ctx.fillStyle = '#f5c242'
    ctx.fill()
  }
  ctx.restore()
}

function drawOtherBoat(ctx: CanvasRenderingContext2D, other: ChartShip, hot: boolean) {
  const { ship, x, y } = other
  const heading = Math.atan2(Math.sin(ship.yaw), -Math.cos(ship.yaw))
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(heading)
  ctx.beginPath()
  ctx.moveTo(0, -10)
  ctx.lineTo(5.5, 7)
  ctx.lineTo(0, 3)
  ctx.lineTo(-5.5, 7)
  ctx.closePath()
  ctx.fillStyle = hot ? '#ffe7ad' : '#f6c453'
  ctx.strokeStyle = '#2a1c08'
  ctx.lineWidth = hot ? 2.2 : 1.4
  ctx.fill()
  ctx.stroke()
  const surge = Number.isFinite(ship.speed) ? ship.speed : 0
  const reach = 8 + Math.min(20, Math.abs(surge) * 3.2)
  ctx.beginPath()
  ctx.moveTo(0, -6)
  ctx.lineTo(0, -reach)
  ctx.strokeStyle = 'rgba(246, 196, 83, 0.95)'
  ctx.lineWidth = 1.4
  ctx.stroke()
  ctx.restore()

  const name = ship.name || 'Sailor'
  ctx.font = '600 10px Segoe UI, sans-serif'
  ctx.textAlign = 'center'
  ctx.lineWidth = 3
  ctx.strokeStyle = 'rgba(8, 16, 28, 0.82)'
  ctx.strokeText(name, x, y - 14)
  ctx.fillStyle = hot ? '#fff6df' : '#ffe3a3'
  ctx.fillText(name, x, y - 14)
}

function placeTip(
  tip: HTMLDivElement | null,
  nameNode: HTMLElement | null,
  speedNode: HTMLElement | null,
  driveNode: HTMLElement | null,
  canvas: HTMLCanvasElement,
  other: ChartShip | null,
) {
  if (!tip || !nameNode || !speedNode || !driveNode) return
  if (!other) {
    tip.hidden = true
    return
  }
  const { ship } = other
  nameNode.textContent = ship.name || 'Sailor'
  speedNode.textContent = formatKnots(ship.speed, ship.sway)
  driveNode.textContent = propulsionLabel(ship.port, ship.starboard, ship.hoist, ship.jibHoist, ship.spinHoist)
  tip.hidden = false
  const parentW = canvas.parentElement?.clientWidth ?? canvas.clientWidth
  const left = canvas.offsetLeft + other.x
  const top = canvas.offsetTop + other.y
  tip.style.left = `${left}px`
  tip.style.top = `${top}px`
  const tipW = tip.offsetWidth
  const min = tipW / 2 + 4
  const max = Math.max(min, parentW - tipW / 2 - 4)
  tip.style.left = `${Math.min(max, Math.max(min, left))}px`
  const above = top - tip.offsetHeight - 12
  if (above < 4) tip.dataset.place = 'below'
  else delete tip.dataset.place
}
