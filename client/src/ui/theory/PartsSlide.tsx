import { BOAT_X, BOAT_Y, Boat, Stage, type BadgeTone } from './diagram'
import { clamp, rudderFrom, smooth, track } from './math'
import { cueAt, useLesson, useSeconds } from './useSeconds'
import { FigureCopy } from './widgets'

const T_STERN = 2.3
const T_ALONG = 4.6
const T_STBD = 7.1
const T_PORT = 9.4
const T_TURN = 11.8
const T_OUT = 13.4
const T_BACK = 14.3
const DUR = 17.2

const RULE = 'Port and starboard belong to the boat. They do not swap when you turn.'

const CUES = [
  { t: 0, text: 'The bow is the front. It is the pointy end, and it leads.' },
  { t: T_STERN, text: 'The stern is the back.' },
  { t: T_ALONG, text: 'Forward is toward the bow. Aft is toward the stern.' },
  { t: T_STBD, text: 'Face the bow. Starboard is the right-hand side. Green is starboard.' },
  { t: T_PORT, text: 'Port is the left-hand side. Red is port.' },
  { t: T_TURN, text: 'The boat turns. Port stays port, and starboard stays starboard.' },
]

const BEATS = [
  'The bow is the front of the boat. The stern is the back.',
  'Forward is toward the bow. Aft is toward the stern.',
  'Face the bow. Starboard is the right side. Port is the left side.',
  'Port and starboard belong to the boat. They stay put when the boat turns.',
]

const PORT = '#ffb4b4'
const STARBOARD = '#b6f5d0'
const NEUTRAL = '#f4f7fb'

function headingOf(time: number) {
  return track(time, [
    { t: 0, v: 0 },
    { t: T_TURN, v: 0 },
    { t: T_OUT, v: 0.58 },
    { t: T_BACK, v: 0.58 },
    { t: 16.2, v: -0.52 },
    { t: DUR, v: -0.52 },
  ])
}

function place(x: number, y: number, heading: number) {
  const c = Math.cos(heading)
  const s = Math.sin(heading)
  return { x: BOAT_X + x * c - y * s, y: BOAT_Y + x * s + y * c }
}

function appear(time: number, start: number) {
  return smooth(clamp((time - start) / 0.4, 0, 1))
}

function badgeAt(time: number): { tone: BadgeTone; title: string; detail: string } {
  if (time < T_STERN) return { tone: 'tack', title: 'Bow', detail: 'The front' }
  if (time < T_ALONG) return { tone: 'tack', title: 'Stern', detail: 'The back' }
  if (time < T_STBD) return { tone: 'tack', title: 'Forward', detail: 'And aft' }
  if (time < T_PORT) return { tone: 'ok', title: 'Starboard', detail: 'Right' }
  if (time < T_TURN) return { tone: 'warn', title: 'Port', detail: 'Left side' }
  return { tone: 'tack', title: 'Turn', detail: 'Names stay' }
}

/** A horizontal word that grows away from the mast, so a turn does not swing it into the hull. */
function Tag({
  at,
  text,
  fill,
  opacity,
}: {
  at: { x: number; y: number }
  text: string
  fill: string
  opacity: number
}) {
  if (opacity < 0.04) return null
  const anchor = at.x < BOAT_X - 14 ? 'end' : at.x > BOAT_X + 14 ? 'start' : 'middle'
  return (
    <text
      x={at.x}
      y={at.y}
      textAnchor={anchor}
      dominantBaseline="central"
      fontSize="15"
      fontWeight="700"
      fill={fill}
      opacity={opacity}
    >
      {text}
    </text>
  )
}

function Leader({
  from,
  to,
  color,
  opacity,
}: {
  from: { x: number; y: number }
  to: { x: number; y: number }
  color: string
  opacity: number
}) {
  if (opacity < 0.04) return null
  return (
    <path
      d={`M${from.x.toFixed(1)} ${from.y.toFixed(1)} L${to.x.toFixed(1)} ${to.y.toFixed(1)}`}
      fill="none"
      stroke={color}
      strokeWidth="1.6"
      strokeLinecap="round"
      opacity={opacity * 0.85}
    />
  )
}

export function PartsSlide() {
  const { time, reduced, seek } = useLesson()
  const { time: flutter } = useSeconds(!reduced)
  const t = clamp(time, 0, DUR)
  const heading = headingOf(t)
  const deg = (heading * 180) / Math.PI
  const bow = appear(t, -1)
  const stern = appear(t, T_STERN)
  const along = appear(t, T_ALONG)
  const starboard = appear(t, T_STBD)
  const port = appear(t, T_PORT)
  const caption = cueAt(CUES, t).text

  const bowAt = place(-78, -70, heading)
  const sternAt = place(0, 108, heading)
  const forwardAt = place(64, -52, heading)
  const aftAt = place(64, 62, heading)
  const portAt = place(-72, 6, heading)
  const starboardAt = place(68, 6, heading)

  return (
    <>
      <Stage
        time={flutter}
        windFrom={0}
        badge={badgeAt(t)}
        progress={{
          time: t,
          duration: DUR,
          marks: CUES.map((cue) => cue.t),
          caption,
          onSeek: seek,
        }}
      >
        <Boat
          heading={heading}
          boom={0.15}
          time={flutter}
          rudder={rudderFrom(headingOf, t)}
          showTurn
          luff={0}
          stall={0}
          speed={0}
          windFrom={0}
        />
        <g transform={`translate(${BOAT_X} ${BOAT_Y}) rotate(${deg})`} opacity={Math.max(port, starboard, along)}>
          <path
            d="M-16 -4 V26"
            fill="none"
            stroke="#e5484d"
            strokeWidth="5"
            strokeLinecap="round"
            opacity={port}
          />
          <path
            d="M16 -4 V26"
            fill="none"
            stroke="#3ddc84"
            strokeWidth="5"
            strokeLinecap="round"
            opacity={starboard}
          />
          <path
            d="M34 -34 V-78 M28 -68 L34 -78 L40 -68"
            fill="none"
            stroke={NEUTRAL}
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={along}
          />
          <path
            d="M34 30 V74 M28 64 L34 74 L40 64"
            fill="none"
            stroke={NEUTRAL}
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={along}
          />
        </g>
        <Leader from={place(0, -84, heading)} to={bowAt} color={NEUTRAL} opacity={bow} />
        <Leader from={place(0, 66, heading)} to={sternAt} color={NEUTRAL} opacity={stern} />
        <Leader from={place(-16, 8, heading)} to={portAt} color={PORT} opacity={port} />
        <Leader from={place(16, 8, heading)} to={starboardAt} color={STARBOARD} opacity={starboard} />
        <Tag at={bowAt} text="Bow" fill={NEUTRAL} opacity={bow} />
        <Tag at={sternAt} text="Stern" fill={NEUTRAL} opacity={stern} />
        <Tag at={forwardAt} text="Forward" fill={NEUTRAL} opacity={along} />
        <Tag at={aftAt} text="Aft" fill={NEUTRAL} opacity={along} />
        <Tag at={portAt} text="Port" fill={PORT} opacity={port} />
        <Tag at={starboardAt} text="Starboard" fill={STARBOARD} opacity={starboard} />
      </Stage>
      <FigureCopy reduced={reduced} caption={caption} beats={BEATS} rule={RULE} />
    </>
  )
}
