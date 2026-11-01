import { useEffect, useRef, useState } from 'react'
import { speedKnots, telemetry } from '../scene/boat/telemetry'
import { compassPoint, getWind, MS_TO_KN, windFromDegrees } from '../scene/boat/wind'

interface ChartMeta {
  name: string
  metersPerPixel: number
  image: { width: number; height: number }
  worldSize: [number, number]
  buoys: { type: 'port' | 'starboard'; x: number; z: number }[]
  harbors: { name: string; x: number; z: number }[]
}

const NEAR_METRES = 1800

/**
 * North-up aerial chart. Lake shows the whole of Windermere; Near stays centred
 * on the boat so the shoreline you are following stays readable.
 */
export function NavMap() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const titleRef = useRef<HTMLSpanElement>(null)
  const readRef = useRef<HTMLSpanElement>(null)
  const [local, setLocal] = useState(false)
  const localRef = useRef(false)

  useEffect(() => {
    localRef.current = local
  }, [local])

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

    let raf = 0
    const draw = () => {
      raf = requestAnimationFrame(draw)
      const cssW = canvas.clientWidth
      const cssH = canvas.clientHeight
      if (cssW < 2 || cssH < 2) return
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
      if (!img.complete || img.naturalWidth === 0 || !meta) return

      const mpp = meta.metersPerPixel
      const worldW = meta.worldSize[0]
      const aspect = cssW / cssH
      let viewW = worldW
      let viewH = viewW / aspect
      let cx = 0
      let cz = 0
      if (localRef.current && telemetry.ready) {
        viewW = NEAR_METRES
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

      for (const b of meta.buoys) {
        const p = toScreen(b.x, b.z)
        if (p.x < -4 || p.y < -4 || p.x > cssW + 4 || p.y > cssH + 4) continue
        ctx.beginPath()
        ctx.arc(p.x, p.y, localRef.current ? 3 : 2, 0, Math.PI * 2)
        ctx.fillStyle = b.type === 'port' ? '#e5484d' : '#3ddc84'
        ctx.fill()
      }

      ctx.font = '600 11px Segoe UI, sans-serif'
      ctx.textAlign = 'center'
      ctx.lineWidth = 3
      for (const h of meta.harbors) {
        const p = toScreen(h.x, h.z)
        if (p.x < 8 || p.y < 14 || p.x > cssW - 8 || p.y > cssH - 8) continue
        ctx.strokeStyle = 'rgba(8, 16, 28, 0.8)'
        ctx.strokeText(h.name, p.x, p.y)
        ctx.fillStyle = '#f4f7fb'
        ctx.fillText(h.name, p.x, p.y)
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

        const deg = (heading * 180) / Math.PI
        const hdg = `${(Math.round((deg + 360) % 360) % 360).toString().padStart(3, '0')}°`
        const kn = speedKnots(telemetry.speed, telemetry.sway)
        const spd = `${kn < -0.05 ? '−' : ''}${Math.abs(kn).toFixed(1)} kn`
        if (readRef.current) readRef.current.textContent = `${hdg}  ${spd}`

        let place = 'Windermere'
        let best = 2500
        for (const h of meta.harbors) {
          const d = Math.hypot(h.x - telemetry.x, h.z - telemetry.z)
          if (d < best) {
            best = d
            place = h.name
          }
        }
        if (titleRef.current) titleRef.current.textContent = place
      }

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
    raf = requestAnimationFrame(draw)
    return () => {
      dead = true
      cancelAnimationFrame(raf)
    }
  }, [])

  return (
    <div className="hud navmap">
      <div className="navmap-head">
        <span ref={titleRef}>Chart</span>
        <span ref={readRef} className="navmap-read">—</span>
      </div>
      <canvas ref={canvasRef} />
      <div className="navmap-zoom">
        <button type="button" className={local ? '' : 'active'} onClick={() => setLocal(false)}>
          Lake
        </button>
        <button type="button" className={local ? 'active' : ''} onClick={() => setLocal(true)}>
          Near
        </button>
      </div>
    </div>
  )
}
