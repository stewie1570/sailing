import { useEffect, useId, useState, type ReactNode } from 'react'
import { BEAM, clamp } from './math'

const PI = Math.PI

/** Aerial diagram. +x starboard and +y aft in boat space; screen y grows downward. */
export const VW = 640
export const VH = 460
export const BOAT_X = 320
export const BOAT_Y = 214

/**
 * Phone portrait crop. The full 640×460 frame leaves the boat tiny once the
 * stage can only be as wide as the screen. This window keeps the hull, the
 * tack/gybe ring, and the wind vane, and matches `.theory-stage.is-tight`.
 */
const TIGHT_VIEW = '140 6 360 408'
const TIGHT_QUERY = '(max-width: 720px) and (min-height: 540px)'

function useTightDiagram() {
  const [tight, setTight] = useState(() => window.matchMedia(TIGHT_QUERY).matches)
  useEffect(() => {
    const mq = window.matchMedia(TIGHT_QUERY)
    const sync = () => setTight(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])
  return tight
}
const SAIL = 70
const ARC = 98

export type BadgeTone = 'tack' | 'gybe' | 'warn' | 'ok'

export type BoatProps = {
  x?: number
  y?: number
  heading: number
  boom: number
  luff?: number
  stall?: number
  speed?: number
  rudder?: number
  time: number
  opacity?: number
  showArc?: boolean
  /** Half-angle, radians, of the arc the sheet still allows. */
  allowed?: number | null
  /** A marker walking the 180° arc, radians from the centreline. */
  mark?: number | null
  showZone?: boolean
  windFrom?: number
  lock?: boolean
  ghosts?: readonly number[]
  ghostArc?: boolean
  showTurn?: boolean
  /** 'follow' draws the small jib on the main's boom. 'sheets' draws a jib and a spinnaker, each with a sheet on both sides. */
  headsail?: 'follow' | 'sheets'
  /** 0 hidden, 1 fully set. Used when headsail is 'sheets'. */
  jibSet?: number
  spinSet?: number
  /** Jib clew, radians off the centreline. Positive is starboard. */
  clew?: number
  /** Spinnaker belly, radians. Positive is starboard. */
  spinCenter?: number
  /** How far the spinnaker reaches each side of its belly, radians. */
  spinHalf?: number
  /** 0 eased, 1 hauled. */
  jibPort?: number
  jibStbd?: number
  spinPort?: number
  spinStbd?: number
  /** 0 quiet, 1 flapping. The headsail, separate from the main. */
  headsailLuff?: number
  /** Drawn size. 1 is the close-up the other lessons use. */
  scale?: number
}

function boomPoint(angle: number, radius: number): [number, number] {
  return [Math.sin(angle) * radius, Math.cos(angle) * radius]
}

function bowPoint(angle: number, radius: number): [number, number] {
  return [Math.sin(angle) * radius, -Math.cos(angle) * radius]
}

function poly(points: readonly (readonly [number, number])[], close = false) {
  const d = points
    .map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`)
    .join(' ')
  return close ? `${d} Z` : d
}

function arcPoints(radius: number, from: number, to: number, steps: number) {
  const points: [number, number][] = []
  for (let i = 0; i <= steps; i++) points.push(boomPoint(from + ((to - from) * i) / steps, radius))
  return points
}

function zonePoints(radius: number, from: number, to: number, steps: number) {
  const points: [number, number][] = []
  for (let i = 0; i <= steps; i++) points.push(bowPoint(from + ((to - from) * i) / steps, radius))
  return points
}

function clothOffset(t: number, phase: number, luff: number, stall: number) {
  const camber = 16 * (1 - stall * 0.72) * (luff > 0.5 ? 0.62 : 1)
  const belly = Math.sin(Math.PI * t) * camber
  const body = Math.sin(Math.PI * t)
  const aftFade = t < 0.5 ? 1 : Math.max(0, 1 - (t - 0.5) / (0.18 + luff * 0.7))
  const env = body * (luff > 0.72 ? 1 : aftFade)
  const breathe = 0.42 + 0.58 * (0.5 + 0.5 * Math.sin(phase * 26 + t * 15))
  const wiggle = Math.sin(phase * 41 - t * 22) * 0.28
  const amp = luff * 24 * env
  return belly + amp * breathe + amp * wiggle
}

function sailNormal(boom: number): [number, number] {
  let nx = Math.cos(boom)
  let ny = -Math.sin(boom)
  const side = boom < 0 ? -1 : 1
  if (nx * side < 0) {
    nx = -nx
    ny = -ny
  }
  return [nx, ny]
}

function leechPoint(boom: number, t: number, phase: number, luff: number, stall: number): [number, number] {
  const [nx, ny] = sailNormal(boom)
  const off = clothOffset(t, phase, luff, stall)
  return [Math.sin(boom) * SAIL * t + nx * off, Math.cos(boom) * SAIL * t + ny * off]
}

function SailShape({
  boom,
  time,
  luff,
  stall,
  faint,
}: {
  boom: number
  time: number
  luff: number
  stall: number
  faint?: boolean
}) {
  const steps = 20
  const leech: [number, number][] = []
  for (let i = 0; i <= steps; i++) leech.push(leechPoint(boom, i / steps, time, faint ? 0 : luff, faint ? 0 : stall))
  const clew = boomPoint(boom, SAIL)
  const d = `${poly(leech)} L${clew[0].toFixed(2)} ${clew[1].toFixed(2)} L0 0 Z`
  const fill = faint ? 'rgba(229, 72, 77, 0.13)' : luff > 0.45 ? '#e4eef4' : stall > 0.45 ? '#ddd6c8' : '#f6f3ea'
  const stroke = faint ? 'rgba(229, 72, 77, 0.55)' : luff > 0.45 ? '#8aa4b6' : '#d9d0c2'
  const seams = [0.28, 0.5, 0.72].map((t) => {
    const foot = boomPoint(boom, SAIL * t)
    const edge = leechPoint(boom, t, time, faint ? 0 : luff, faint ? 0 : stall)
    return `M${foot[0].toFixed(2)} ${foot[1].toFixed(2)} L${edge[0].toFixed(2)} ${edge[1].toFixed(2)}`
  })
  return (
    <g opacity={faint ? 0.85 : 1}>
      {luff > 0.2 && !faint && (
        <path d={d} fill="#d5e4ee" opacity={0.45} transform={`translate(${Math.sin(time * 31) * luff * 1.4} 0)`} />
      )}
      <path d={d} fill={fill} stroke={stroke} strokeWidth={faint ? 1.5 : 1} strokeLinejoin="round" />
      {!faint &&
        seams.map((sd, i) => (
          <path key={i} d={sd} fill="none" stroke={luff > 0.4 ? 'rgba(90, 120, 140, 0.45)' : 'rgba(120, 96, 70, 0.28)'} strokeWidth="1" />
        ))}
      {!faint &&
        [0.22, 0.4, 0.58, 0.76].map((t) => {
          const env = clothOffset(t, time, luff, stall)
          if (luff < 0.18 || Math.abs(env) < 3) return null
          const [nx, ny] = sailNormal(boom)
          const edge = leechPoint(boom, t, time, luff, stall)
          const len = 5 + luff * 6
          return (
            <path
              key={t}
              d={`M${edge[0].toFixed(2)} ${edge[1].toFixed(2)} l${(nx * len).toFixed(2)} ${(ny * len).toFixed(2)}`}
              stroke="#9ec3d6"
              strokeWidth="1.4"
              strokeLinecap="round"
            />
          )
        })}
      <path
        d={`M0 0 L${clew[0].toFixed(2)} ${clew[1].toFixed(2)}`}
        stroke={faint ? 'rgba(229, 72, 77, 0.7)' : '#5c3b24'}
        strokeWidth={faint ? 2 : 3.5}
        strokeLinecap="round"
      />
    </g>
  )
}

const PORT_LEAD: [number, number] = [-26, 22]
const STBD_LEAD: [number, number] = [26, 22]

function jibClewPoint(angle: number, time: number, luff: number): [number, number] {
  const side = angle >= 0 ? 1 : -1
  const flutter = Math.sin(time * 28) * luff * 4
  return [Math.sin(angle) * 48 + side * flutter, -36]
}

/** A rope from a clew back to a lead on one side of the boat. Slack bows outboard. */
function SideSheet({ from, to, tight }: { from: [number, number]; to: [number, number]; tight: number }) {
  const slack = 1 - clamp(tight, 0, 1)
  const side = to[0] >= 0 ? 1 : -1
  const mx = (from[0] + to[0]) / 2 + side * 16 * slack
  const my = (from[1] + to[1]) / 2 + 8 * slack
  const hot = tight > 0.62
  return (
    <g>
      <path
        d={`M${from[0].toFixed(1)} ${from[1].toFixed(1)} Q${mx.toFixed(1)} ${my.toFixed(1)} ${to[0]} ${to[1]}`}
        fill="none"
        stroke={hot ? '#f0c24d' : '#e6c48a'}
        strokeWidth={hot ? 2.6 : 1.6}
        strokeLinecap="round"
        opacity={0.4 + clamp(tight, 0, 1) * 0.6}
      />
      <circle cx={to[0]} cy={to[1]} r="3.2" fill={hot ? '#f0c24d' : '#8d6a3d'} stroke="#2a2118" strokeWidth="1" />
    </g>
  )
}

function HeadsailJib({ angle, time, luff }: { angle: number; time: number; luff: number }) {
  const tack: [number, number] = [0, -76]
  const head: [number, number] = [0, -8]
  const clew = jibClewPoint(angle, time, luff)
  const side = angle >= 0 ? 1 : -1
  const leech: [number, number] = [(head[0] + clew[0]) / 2 + side * 5, (head[1] + clew[1]) / 2]
  const foot: [number, number] = [(tack[0] + clew[0]) / 2 + side * 3, (tack[1] + clew[1]) / 2]
  const fill = luff > 0.45 ? '#e7eef3' : '#f7f4ec'
  const stroke = luff > 0.45 ? '#9eb0be' : '#e3dccf'
  const d = `M${head[0]} ${head[1]} Q${leech[0].toFixed(1)} ${leech[1].toFixed(1)} ${clew[0].toFixed(1)} ${clew[1].toFixed(1)} Q${foot[0].toFixed(1)} ${foot[1].toFixed(1)} ${tack[0]} ${tack[1]} Z`
  return (
    <g>
      <path d={d} fill={fill} stroke={stroke} strokeWidth="1" strokeLinejoin="round" />
      <circle cx={clew[0]} cy={clew[1]} r="2.3" fill="#5c3b24" />
    </g>
  )
}

/** Symmetric kite ahead of the bow. The foot runs from a clew on each side. */
function spinOutline(center: number, half: number, time: number, luff: number) {
  const head: [number, number] = [0, -16]
  const wag = Math.sin(time * 14) * (1.5 + luff * 7)
  const foot: [number, number][] = []
  const steps = 10
  for (let i = 0; i <= steps; i++) {
    const u = i / steps
    const ang = center - half + 2 * half * u
    const reach = 68 + 30 * Math.sin(Math.PI * u)
    const p = bowPoint(ang, reach)
    foot.push([p[0] + wag * Math.sin(Math.PI * u), p[1]])
  }
  return { head, foot }
}

function SpinCloth({ center, half, time, luff }: { center: number; half: number; time: number; luff: number }) {
  const { head, foot } = spinOutline(center, half, time, luff)
  const nose = foot[Math.floor(foot.length / 2)] ?? head
  const fill = luff > 0.45 ? '#f3c2b8' : '#e23b32'
  const stroke = luff > 0.45 ? '#c46a5c' : '#8d1c16'
  return (
    <g>
      <path d={poly([head, ...foot], true)} fill={fill} stroke={stroke} strokeWidth="1.4" strokeLinejoin="round" />
      <path
        d={`M${head[0]} ${head[1]} L${nose[0].toFixed(1)} ${nose[1].toFixed(1)}`}
        fill="none"
        stroke="#f0a040"
        strokeWidth="3"
        strokeLinecap="round"
        opacity="0.9"
      />
      {foot[0] && <circle cx={foot[0][0]} cy={foot[0][1]} r="2.4" fill="#5c3b24" />}
      {foot[foot.length - 1] && (
        <circle cx={foot[foot.length - 1][0]} cy={foot[foot.length - 1][1]} r="2.4" fill="#5c3b24" />
      )}
    </g>
  )
}

function Jib({ boom, time, luff }: { boom: number; time: number; luff: number }) {
  const angle = clamp(boom * 0.78, -1.2, 1.2)
  const clewX = Math.sin(angle) * 28
  const clewY = -34
  const flutter = luff * 5 * Math.sin(time * 30)
  const [nx, ny] = sailNormal(angle)
  const midX = clewX * 0.55 + nx * flutter
  const midY = (-6 + clewY) * 0.5 + ny * flutter
  return (
    <path
      d={`M0 -6 L0 -72 Q${midX.toFixed(2)} ${midY.toFixed(2)} ${clewX.toFixed(2)} ${clewY.toFixed(2)} Z`}
      fill={luff > 0.45 ? '#e7eef3' : '#f7f4ec'}
      stroke={luff > 0.45 ? '#9eb0be' : '#e3dccf'}
      strokeWidth="1"
      opacity="0.95"
    />
  )
}

function Hull() {
  return (
    <g>
      <path
        d="M0 -84 C9 -79 15 -64 17 -44 C19 -22 18 2 16 20 C14 38 11 50 7 60 L-7 60 C-11 50 -14 38 -16 20 C-18 2 -19 -22 -17 -44 C-15 -64 -9 -79 0 -84 Z"
        fill="#c4a27a"
        stroke="#f4f7fb"
        strokeWidth="4"
        strokeLinejoin="round"
      />
      <path
        d="M0 -76 C7 -72 11 -58 12 -42 C13 -24 12 -2 10 16 C9 30 7 42 4 50 L-4 50 C-7 42 -9 30 -10 16 C-12 -2 -13 -24 -12 -42 C-11 -58 -7 -72 0 -76 Z"
        fill="#b8895c"
      />
      <path
        d="M-9 -6 H9 V16 H-9 Z"
        fill="#eef1f4"
        stroke="#d5dbe2"
        strokeWidth="1"
      />
      <path d="M-6 -2 H-1 V5 H-6 Z M1 -2 H6 V5 H1 Z M-6 8 H-1 V13 H-6 Z M1 8 H6 V13 H1 Z" fill="#1b2833" opacity="0.85" />
      <rect x="-7" y="22" width="14" height="20" rx="3" fill="#2a241c" />
      <circle cx="0" cy="30" r="4.2" fill="none" stroke="#c5ccd3" strokeWidth="1.6" />
      <circle cx="0" cy="30" r="1.1" fill="#c5ccd3" />
      <path d="M-13 6 L-13 16 M13 6 L13 16" stroke="rgba(255,255,255,0.35)" strokeWidth="1" />
    </g>
  )
}

function Sheet({ boom, lock }: { boom: number; lock: boolean }) {
  const [cx, cy] = boomPoint(boom, SAIL)
  const blockY = 24
  const slack = Math.min(1, Math.abs(boom) / 1.1)
  const mx = cx * 0.46
  const my = (cy + blockY) / 2 + 7 * slack
  return (
    <g>
      <path
        d={`M${cx.toFixed(2)} ${cy.toFixed(2)} Q${mx.toFixed(2)} ${my.toFixed(2)} 0 ${blockY}`}
        fill="none"
        stroke={lock ? '#f0c24d' : '#e6c48a'}
        strokeWidth={lock ? 2.6 : 2}
        strokeLinecap="round"
      />
      <circle cx="0" cy={blockY} r={lock ? 4.5 : 3} fill={lock ? '#f0c24d' : '#8d6a3d'} stroke="#2a2118" strokeWidth="1" />
    </g>
  )
}

function RangeArc({ allowed, mark }: { allowed: number | null; mark: number | null }) {
  const full = arcPoints(ARC, -BEAM, BEAM, 28)
  const limit = allowed == null ? null : clamp(allowed, 0.08, BEAM)
  const wedge = limit == null ? null : [ [0, 0] as [number, number], ...arcPoints(ARC, -limit, limit, 20) ]
  const markPoint = mark == null ? null : boomPoint(mark, ARC)
  return (
    <g>
      <path d={poly(full)} fill="none" stroke="rgba(255,255,255,0.38)" strokeWidth="1.6" strokeDasharray="3 5" />
      {wedge && <path d={poly(wedge, true)} fill="rgba(240, 194, 77, 0.16)" stroke="#f0c24d" strokeWidth="2.5" />}
      <path d="M-8 0 H8 M0 -8 V8" transform={`translate(${-ARC} 0)`} stroke="rgba(255,255,255,0.7)" strokeWidth="1.4" />
      <path d="M-8 0 H8 M0 -8 V8" transform={`translate(${ARC} 0)`} stroke="rgba(255,255,255,0.7)" strokeWidth="1.4" />
      <text x="0" y={ARC + 18} textAnchor="middle" fontSize="16" fontWeight="700" fill="#f4f7fb">
        180°
      </text>
      {markPoint && (
        <g>
          <circle cx={markPoint[0]} cy={markPoint[1]} r="9" fill="rgba(240,194,77,0.28)" />
          <circle cx={markPoint[0]} cy={markPoint[1]} r="4.5" fill="#f0c24d" />
        </g>
      )}
    </g>
  )
}

function ZoneRing({ heading, windFrom }: { heading: number; windFrom: number }) {
  const tack = zonePoints(112, -1.8, 1.8, 32)
  const gybe = zonePoints(112, 1.8, Math.PI * 2 - 1.8, 32)
  const deg = (-heading * 180) / PI
  const rel = Math.atan2(Math.sin(windFrom - heading), Math.cos(windFrom - heading))
  const pip = bowPoint(rel, 112)
  const tackLabel = bowPoint(1.15, 132)
  const gybeLabel = bowPoint(Math.PI + 0.95, 132)
  return (
    <g>
      <path d={poly(tack)} fill="none" stroke="rgba(159, 212, 255, 0.95)" strokeWidth="16" strokeLinecap="butt" opacity="0.9" />
      <path d={poly(gybe)} fill="none" stroke="rgba(240, 194, 77, 0.95)" strokeWidth="16" strokeLinecap="butt" opacity="0.9" />
      <circle cx={pip[0]} cy={pip[1]} r="7" fill="#f4f7fb" stroke="#102838" strokeWidth="2" />
      <text textAnchor="middle" fontSize="16" fontWeight="700" fill="#d7eeff" transform={`translate(${tackLabel[0]} ${tackLabel[1]}) rotate(${deg})`}>
        Tack
      </text>
      <text textAnchor="middle" fontSize="16" fontWeight="700" fill="#ffe7a8" transform={`translate(${gybeLabel[0]} ${gybeLabel[1]}) rotate(${deg})`}>
        Gybe
      </text>
    </g>
  )
}

function TurnCue({ rudder }: { rudder: number }) {
  if (Math.abs(rudder) < 0.08) return null
  const dir = Math.sign(rudder)
  const points: [number, number][] = []
  for (let i = 0; i <= 12; i++) {
    const a = dir * (-0.15 + (1.15 * i) / 12)
    points.push(bowPoint(a, 100))
  }
  const end = points[points.length - 1]
  const prev = points[points.length - 2]
  if (!end || !prev) return null
  const ang = Math.atan2(end[1] - prev[1], end[0] - prev[0])
  return (
    <g opacity={clamp(Math.abs(rudder) * 2.2, 0, 1)}>
      <path d={poly(points)} fill="none" stroke="#f4f7fb" strokeWidth="2" strokeLinecap="round" />
      <path
        d="M0 0 L-8 -4 L-8 4 Z"
        fill="#f4f7fb"
        transform={`translate(${end[0]} ${end[1]}) rotate(${(ang * 180) / PI})`}
      />
    </g>
  )
}

function StallMarks({ boom, stall, time }: { boom: number; stall: number; time: number }) {
  if (stall < 0.2) return null
  const [nx, ny] = sailNormal(boom)
  return (
    <g opacity={clamp(stall, 0, 1)}>
      {[0.4, 0.62].map((t, i) => {
        const [x, y] = leechPoint(boom, t, 0, 0, stall)
        const cx = x + nx * 14
        const cy = y + ny * 14
        const spin = ((time * 70 + i * 40) % 360)
        return (
          <g key={t} transform={`translate(${cx} ${cy}) rotate(${spin})`}>
            <path d="M0 0 A7 7 0 1 1 -5 5" fill="none" stroke="#f0c24d" strokeWidth="1.5" strokeLinecap="round" />
          </g>
        )
      })}
    </g>
  )
}

function Wake({ speed, time }: { speed: number; time: number }) {
  if (speed < 0.04) return null
  const len = 18 + speed * 74
  const dash = -time * (16 + speed * 36)
  return (
    <g fill="none" stroke="rgba(255,255,255,0.55)" strokeWidth="1.7" strokeLinecap="round" opacity={0.25 + speed * 0.55}>
      <path d={`M-7 58 C-16 ${58 + len * 0.45}, -8 ${58 + len}, 0 ${64 + len}`} strokeDasharray="5 8" strokeDashoffset={dash} />
      <path d={`M7 58 C16 ${58 + len * 0.45}, 8 ${58 + len}, 0 ${64 + len}`} strokeDasharray="5 8" strokeDashoffset={dash} />
    </g>
  )
}

function Rudder({ rudder }: { rudder: number }) {
  return (
    <g transform={`translate(0 60) rotate(${(rudder * 180) / PI})`}>
      <path d="M-2.4 0 L0 16 L2.4 0 Z" fill="#c4894a" />
    </g>
  )
}

export function Boat(props: BoatProps) {
  const {
    x = BOAT_X,
    y = BOAT_Y,
    heading,
    boom,
    luff = 0,
    stall = 0,
    speed = 0,
    rudder = 0,
    time,
    opacity = 1,
    showArc = false,
    allowed = null,
    mark = null,
    showZone = false,
    windFrom = 0,
    lock = false,
    ghosts = [],
    ghostArc = false,
    showTurn = false,
    headsail = 'follow',
    jibSet = 0,
    spinSet = 0,
    clew = 0,
    spinCenter = 0,
    spinHalf = 1,
    jibPort = 0,
    jibStbd = 0,
    spinPort = 0,
    spinStbd = 0,
    headsailLuff = 0,
    scale = 1,
  } = props
  const deg = (heading * 180) / PI
  const sheets = headsail === 'sheets'
  const spin = sheets ? spinOutline(spinCenter, spinHalf, time, headsailLuff) : null
  const spinPortClew = spin?.foot[0]
  const spinStbdClew = spin?.foot[spin.foot.length - 1]
  const labelSide = boom >= 0 ? -1 : 1
  return (
    <g opacity={opacity}>
      <g transform={`translate(${x} ${y}) scale(${scale}) rotate(${deg})`}>
        {showZone && <ZoneRing heading={heading} windFrom={windFrom} />}
        {showArc && <RangeArc allowed={allowed} mark={mark} />}
        {ghostArc && (
          <path
            d={poly(arcPoints(96, -1.35, 1.35, 28))}
            fill="none"
            stroke="rgba(229, 72, 77, 0.8)"
            strokeWidth="10"
            strokeLinecap="round"
          />
        )}
        <Wake speed={speed} time={time} />
        {ghosts.map((ghost, i) => (
          <g key={i} opacity={0.35 + i * 0.12}>
            <SailShape boom={ghost} time={0} luff={0} stall={0} faint />
          </g>
        ))}
        <Sheet boom={boom} lock={lock} />
        <Hull />
        {sheets ? (
          <>
            {jibSet > 0.02 && (
              <g opacity={jibSet}>
                <HeadsailJib angle={clew} time={time} luff={headsailLuff} />
              </g>
            )}
            {spinSet > 0.02 && (
              <g opacity={spinSet}>
                <SpinCloth center={spinCenter} half={spinHalf} time={time} luff={headsailLuff} />
              </g>
            )}
          </>
        ) : (
          <Jib boom={boom} time={time} luff={luff} />
        )}
        <SailShape boom={boom} time={time} luff={luff} stall={stall} />
        {sheets && jibSet > 0.02 && (
          <g opacity={jibSet}>
            <SideSheet from={jibClewPoint(clew, time, headsailLuff)} to={PORT_LEAD} tight={jibPort} />
            <SideSheet from={jibClewPoint(clew, time, headsailLuff)} to={STBD_LEAD} tight={jibStbd} />
          </g>
        )}
        {sheets && spinSet > 0.02 && spinPortClew && spinStbdClew && (
          <g opacity={spinSet}>
            <SideSheet from={spinPortClew} to={PORT_LEAD} tight={spinPort} />
            <SideSheet from={spinStbdClew} to={STBD_LEAD} tight={spinStbd} />
          </g>
        )}
        <StallMarks boom={boom} stall={stall} time={time} />
        <circle cx="0" cy="0" r="3.4" fill="#e7ebf0" stroke="#6d767f" strokeWidth="1" />
        <Rudder rudder={rudder} />
        <path d="M0 -84 L0 -6" stroke="rgba(255,255,255,0.2)" strokeWidth="1" />
        {showTurn && <TurnCue rudder={rudder} />}
        {lock && (
          <g transform={`translate(${labelSide * 78} 8) rotate(${-deg})`}>
            <rect x="-46" y="-12" width="92" height="22" rx="6" fill="#f0c24d" />
            <text y="4" textAnchor="middle" fontSize="12" fontWeight="700" fill="#2a2118">
              sheeted in
            </text>
          </g>
        )}
      </g>
    </g>
  )
}

function Water({ uid, time }: { uid: string; time: number }) {
  const waves = []
  for (let i = 0; i < 8; i++) {
    const y = 28 + i * 54
    const phase = time * 0.55 + i * 0.8
    let d = `M0 ${y}`
    for (let x = 0; x <= VW; x += 24) {
      const dy = Math.sin(x * 0.018 + phase) * 3.2 + Math.sin(x * 0.045 - phase * 0.6) * 1.6
      d += ` L${x} ${(y + dy).toFixed(1)}`
    }
    waves.push(d)
  }
  return (
    <g>
      <defs>
        <linearGradient id={`${uid}-water`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1f7c9c" />
          <stop offset="58%" stopColor="#14556e" />
          <stop offset="100%" stopColor="#0c3a4c" />
        </linearGradient>
        <radialGradient id={`${uid}-shade`} cx="50%" cy="46%" r="68%">
          <stop offset="72%" stopColor="rgba(0,0,0,0)" />
          <stop offset="100%" stopColor="rgba(0,0,0,0.16)" />
        </radialGradient>
      </defs>
      <rect width={VW} height={VH} fill={`url(#${uid}-water)`} />
      {waves.map((d, i) => (
        <path key={i} d={d} fill="none" stroke="rgba(255,255,255,0.14)" strokeWidth="1.4" />
      ))}
      <rect width={VW} height={VH} fill={`url(#${uid}-shade)`} />
    </g>
  )
}

function WindVane({ windFrom, time }: { windFrom: number; time: number }) {
  const radius = 150
  const cx = BOAT_X + Math.sin(windFrom) * radius
  const cy = BOAT_Y - Math.cos(windFrom) * radius
  const blow = ((windFrom + PI) * 180) / PI
  const labelX = BOAT_X + Math.sin(windFrom) * (radius + 28)
  const labelY = BOAT_Y - Math.cos(windFrom) * (radius + 28)
  return (
    <g>
      <text x={labelX} y={labelY} textAnchor="middle" fontSize="13" fontWeight="700" letterSpacing="0.14em" fill="#e7f6ff">
        WIND
      </text>
      <g transform={`translate(${cx} ${cy}) rotate(${blow})`}>
        {[0, 1, 2].map((i) => {
          const shift = ((time * 0.45 + i * 0.33) % 1) * 26 - 13
          const fade = 0.45 + 0.55 * Math.sin(((time * 0.45 + i * 0.33) % 1) * Math.PI)
          return (
            <path
              key={i}
              d="M0 12 V-10 M-5 -4 L0 -12 L5 -4"
              transform={`translate(${(i - 1) * 14} ${shift})`}
              fill="none"
              stroke="#e7f6ff"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={fade}
            />
          )
        })}
      </g>
    </g>
  )
}

function LessonBar({
  time,
  duration,
  marks,
  caption,
  onSeek,
}: {
  time: number
  duration: number
  marks: readonly number[]
  caption: string
  onSeek: (time: number) => void
}) {
  const span = duration > 0 ? Math.min(Math.max(time, 0), duration) : 0
  const step = 0.05
  const max = Math.max(step, duration - step)
  const shown = Math.min(span, max)
  const fraction = duration > 0 ? shown / duration : 0
  return (
    <label className="theory-progress">
      <span className="theory-progress-track" aria-hidden="true">
        <span className="theory-progress-fill" style={{ width: `${fraction * 100}%` }} />
        {duration > 0 &&
          marks.map((mark) => (
            <span key={mark} className="theory-progress-mark" style={{ left: `${(mark / duration) * 100}%` }} />
          ))}
        <span className="theory-progress-knob" style={{ left: `${fraction * 100}%` }} />
      </span>
      <input
        type="range"
        min={0}
        max={max}
        step={step}
        value={shown}
        aria-label="Lesson slider"
        aria-valuetext={caption}
        onChange={(event) => onSeek(Number(event.target.value))}
      />
    </label>
  )
}

export function Stage({
  time,
  windFrom,
  children,
  badge,
  speed,
  progress,
  controls,
  alert = false,
}: {
  time: number
  windFrom: number
  children: ReactNode
  badge?: { tone: BadgeTone; title: string; detail?: string } | null
  speed?: { knots: number; note: string } | null
  progress?: {
    time: number
    duration: number
    marks: readonly number[]
    caption: string
    onSeek: (time: number) => void
  } | null
  /** Sailing-panel copy, drawn in the bottom right of the diagram. */
  controls?: ReactNode
  alert?: boolean
}) {
  const uid = useId().replace(/:/g, '')
  const tight = useTightDiagram()
  return (
    <div className={`theory-stage${tight ? ' is-tight' : ''}${alert ? ' is-alert' : ''}`}>
      <svg viewBox={tight ? TIGHT_VIEW : `0 0 ${VW} ${VH}`} className="theory-svg" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
        <Water uid={uid} time={time} />
        <WindVane windFrom={windFrom} time={time} />
        {children}
      </svg>
      {badge && (
        <div className={`theory-badge theory-badge-${badge.tone}`}>
          <strong>{badge.title}</strong>
          {badge.detail && <span>{badge.detail}</span>}
        </div>
      )}
      {speed && (
        <div className={`theory-speed${speed.knots >= 5 ? ' is-fast' : speed.knots < 3.4 ? ' is-slow' : ''}`}>
          <span>{speed.note}</span>
          <strong>
            {speed.knots.toFixed(1)}
            <small> kn</small>
          </strong>
        </div>
      )}
      {controls}
      {progress && (
        <LessonBar
          time={progress.time}
          duration={progress.duration}
          marks={progress.marks}
          caption={progress.caption}
          onSeek={progress.onSeek}
        />
      )}
    </div>
  )
}
