import { Boat, Stage, type BadgeTone } from './diagram'
import { BEAM, PI, clamp, lerp, relativeWind, rudderFrom, sailLook, smooth, track } from './math'
import { cueAt, useLesson, useSeconds } from './useSeconds'
import { FigureCopy } from './widgets'

/**
 * A and B share an x, and the breeze is from the top of the figure, so B is
 * directly upwind. The legs leave the wind by the same angle each side.
 * Splay is tan of that angle: a little wider than a real close-haul, so the
 * zigzag reads on the chart.
 */
const A = { x: 320, y: 316 }
const B = { x: 320, y: 122 }
const SPAN = A.y - B.y
const V1 = SPAN / 4
const V2 = SPAN / 2
const SPLAY = 1.58
const DX = V1 * SPLAY
const P1 = { x: A.x + DX, y: A.y - V1 }
const P2 = { x: P1.x - 2 * DX, y: P1.y - V2 }
const HEAD = Math.atan2(DX, V1)

const SPEED = 72
const TURN = 1.05
const T_BEAR = 2.4
const T_LEG1 = T_BEAR + TURN
const T_P1 = T_LEG1 + Math.hypot(DX, V1) / SPEED
const T_LEG2 = T_P1 + TURN
const T_P2 = T_LEG2 + Math.hypot(2 * DX, V2) / SPEED
const T_LEG3 = T_P2 + TURN
const T_B = T_LEG3 + Math.hypot(DX, V1) / SPEED
const T_HOME = T_B + 1.15
const T_RUN = T_HOME + 1.25
const T_A = T_RUN + SPAN / SPEED
const DUR = T_A + 1.15

const RULE = 'You cannot sail straight into the wind.'

const CUES = [
  { t: 0, text: 'Point B is directly upwind of A. The straight line points into the wind, and the boat cannot sail it.' },
  { t: T_BEAR, text: 'So you head off to one side, as close to the wind as the boat will go.' },
  { t: T_P1, text: 'You tack. The bow turns through the wind, and you head off on the other side.' },
  { t: T_P2, text: 'You tack again. Each zigzag brings you closer to B.' },
  { t: T_B, text: 'You are at B. The zigzag got you here. Each turn through the wind was a tack.' },
  { t: T_HOME, text: 'Now the way back. A is directly downwind, so you turn and bring the wind behind you.' },
  { t: T_RUN, text: 'This is a run. You come straight back. No zigzag.' },
  { t: T_A, text: 'Upwind took a zigzag. Downwind, the same two points are a straight run.' },
]

const BEATS = [
  'Point B is directly upwind of A. The boat cannot sail the straight line into the wind.',
  'You zigzag up to B. Each time the bow turns through the wind, that is a tack.',
  'Coming back, the wind is behind you. You run straight from B to A.',
  'Upwind is a zigzag. Downwind is a straight run.',
]

function line(points: readonly { x: number; y: number }[]) {
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ')
}

const PLAN = line([A, P1, P2, B])

function headingOf(time: number) {
  return track(time, [
    { t: 0, v: 0 },
    { t: T_BEAR, v: 0 },
    { t: T_LEG1, v: HEAD },
    { t: T_P1, v: HEAD },
    { t: T_LEG2, v: -HEAD },
    { t: T_P2, v: -HEAD },
    { t: T_LEG3, v: HEAD },
    { t: T_B, v: HEAD },
    { t: T_HOME, v: HEAD },
    { t: T_RUN, v: PI },
    { t: DUR, v: PI },
  ])
}

function pointAt(time: number) {
  const t = clamp(time, 0, DUR)
  return {
    x: track(t, [
      { t: 0, v: A.x },
      { t: T_LEG1, v: A.x },
      { t: T_P1, v: P1.x },
      { t: T_LEG2, v: P1.x },
      { t: T_P2, v: P2.x },
      { t: T_LEG3, v: P2.x },
      { t: T_B, v: B.x },
      { t: T_RUN, v: B.x },
      { t: T_A, v: A.x },
      { t: DUR, v: A.x },
    ]),
    y: track(t, [
      { t: 0, v: A.y },
      { t: T_LEG1, v: A.y },
      { t: T_P1, v: P1.y },
      { t: T_LEG2, v: P1.y },
      { t: T_P2, v: P2.y },
      { t: T_LEG3, v: P2.y },
      { t: T_B, v: B.y },
      { t: T_RUN, v: B.y },
      { t: T_A, v: A.y },
      { t: DUR, v: A.y },
    ]),
  }
}

/** Sheeted boom for a wind from the top of the figure. Fills once you are off the wind line. */
function boomOf(heading: number) {
  const rel = relativeWind(0, heading)
  const off = Math.abs(rel)
  let cap = 0.42
  if (off >= 1.75) cap = lerp(1.2, 1.42, clamp((off - 1.75) / 0.7, 0, 1))
  else if (off >= 0.95) cap = lerp(0.42, 1.2, (off - 0.95) / 0.8)
  return clamp(clamp(-rel, -BEAM, BEAM), -cap, cap)
}

function sailed(from: number, to: number) {
  if (to - from < 0.02) return ''
  const steps = Math.ceil((to - from) / 0.12)
  let d = ''
  for (let i = 0; i <= steps; i++) {
    const p = pointAt(from + ((to - from) * i) / steps)
    d += `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`
  }
  return d
}

function badgeAt(time: number): { tone: BadgeTone; title: string; detail: string } {
  if (time < T_BEAR) return { tone: 'warn', title: 'Upwind', detail: 'Can\'t sail it' }
  if (time < T_P1) return { tone: 'tack', title: 'Tack', detail: 'Off to one side' }
  if (time < T_LEG2) return { tone: 'tack', title: 'Turn', detail: 'Bow through' }
  if (time < T_P2) return { tone: 'tack', title: 'Tack', detail: 'Other side' }
  if (time < T_LEG3) return { tone: 'tack', title: 'Turn', detail: 'Bow through' }
  if (time < T_B) return { tone: 'tack', title: 'Tack', detail: 'Up to B' }
  if (time < T_HOME) return { tone: 'ok', title: 'At B', detail: 'Zigzag upwind' }
  if (time < T_RUN) return { tone: 'gybe', title: 'Downwind', detail: 'Wind behind you' }
  if (time < T_A) return { tone: 'gybe', title: 'Run', detail: 'Straight back' }
  return { tone: 'ok', title: 'At A', detail: 'Straight run' }
}

function Mark({ x, y, label }: { x: number; y: number; label: string }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <circle r="14" fill="#f4f7fb" stroke="#102838" strokeWidth="2" />
      <text y="1" textAnchor="middle" dominantBaseline="central" fontSize="16" fontWeight="700" fill="#102838">
        {label}
      </text>
    </g>
  )
}

export function UpwindSlide() {
  const { time, reduced, seek } = useLesson()
  const { time: flutter } = useSeconds(!reduced)
  const t = clamp(time, 0, DUR)
  const heading = headingOf(t)
  const boom = boomOf(heading)
  const at = pointAt(t)
  const look = sailLook(relativeWind(0, heading), boom)
  const caption = cueAt(CUES, t).text
  const badge = badgeAt(t)
  const plan = smooth(clamp((t - T_BEAR) / (T_LEG1 - T_BEAR), 0, 1))
  const blocked = 1 - smooth(clamp((t - T_HOME) / (T_RUN - T_HOME), 0, 1))
  const upwind = sailed(T_LEG1, Math.min(t, T_RUN))
  const run = sailed(T_RUN, Math.min(t, DUR))

  return (
    <>
      <Stage
        time={flutter}
        windFrom={0}
        badge={badge}
        progress={{
          time: t,
          duration: DUR,
          marks: CUES.map((cue) => cue.t),
          caption,
          onSeek: seek,
        }}
      >
        <path
          d={line([A, B])}
          fill="none"
          stroke="#e5484d"
          strokeWidth="2.6"
          strokeDasharray="7 8"
          strokeLinecap="round"
          opacity={blocked}
        />
        {blocked > 0.02 && (
          <g opacity={blocked} transform={`translate(${A.x} ${B.y + SPAN * 0.22})`}>
            <circle r="11" fill="rgba(8, 32, 42, 0.45)" stroke="#e5484d" strokeWidth="2.4" />
            <path d="M-6.2 -6.2 L6.2 6.2" stroke="#e5484d" strokeWidth="2.4" strokeLinecap="round" />
          </g>
        )}
        <path
          d={PLAN}
          fill="none"
          stroke="#9fd4ff"
          strokeWidth="3"
          strokeDasharray="7 8"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={plan * 0.55}
        />
        {upwind && (
          <path d={upwind} fill="none" stroke="#b9ddf5" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
        )}
        {run && (
          <path d={run} fill="none" stroke="#f0c24d" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
        )}
        <Boat
          x={at.x}
          y={at.y}
          scale={0.46}
          heading={heading}
          boom={boom}
          time={flutter}
          rudder={rudderFrom(headingOf, t)}
          showTurn
          speed={look.speed}
          luff={look.luff}
          stall={look.stall}
          windFrom={0}
        />
        <text x={B.x + 46} y={B.y + 5} fontSize="14" fontWeight="700" fill="#d7eeff">
          upwind
        </text>
        <Mark x={A.x} y={A.y} label="A" />
        <Mark x={B.x} y={B.y} label="B" />
      </Stage>
      <FigureCopy reduced={reduced} caption={caption} beats={BEATS} rule={RULE} />
    </>
  )
}
