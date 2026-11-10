import { Boat, Stage, type BadgeTone } from './diagram'
import { PI, clamp, rudderFrom, track, trail } from './math'
import { cueAt, useLesson, useSeconds } from './useSeconds'
import { ControlCallout } from './ControlCallout'
import { FigureCopy } from './widgets'

const DUR = 16.4
const SWAP = 7.5
const OUT = 1.28

const CUES: { t: number; text: string; title: string; detail: string; tone: BadgeTone }[] = [
  {
    t: 0,
    text: 'Running, with the wind behind you and the sail eased out to one side.',
    title: 'Wind behind',
    detail: 'Sail eased out',
    tone: 'warn',
  },
  {
    t: 2.2,
    text: 'You turn toward the sail. Watch out for the gybe.',
    title: 'Turning in',
    detail: 'Toward the sail',
    tone: 'warn',
  },
  {
    t: 3.45,
    text: 'The wind gets behind the sail and it gybes at once. The boom swings all the way across.',
    title: 'Gybing',
    detail: 'Boom swinging across',
    tone: 'warn',
  },
  {
    t: 5.7,
    text: 'That full swing is what you are watching out for.',
    title: 'Watch out',
    detail: 'All the way across',
    tone: 'warn',
  },
  {
    t: 7.5,
    text: 'Sheet the main all the way in before the turn. The boom comes to the middle and the sheet locks it.',
    title: 'Sheet in',
    detail: 'Lock the boom',
    tone: 'ok',
  },
  {
    t: 9.8,
    text: 'Locked. The sail has almost no room to swing.',
    title: 'Locked',
    detail: 'Boom in the middle',
    tone: 'ok',
  },
  {
    t: 10.9,
    text: 'Same turn toward the sail. It still flips when the wind crosses, but only across the centerline.',
    title: 'Small flip',
    detail: 'Nowhere to swing',
    tone: 'ok',
  },
  {
    t: 12.5,
    text: 'Then ease the sheet on the new side and let the sail fill.',
    title: 'New side',
    detail: 'Ease the sheet',
    tone: 'ok',
  },
]

const BEATS = [
  'Wind behind you, sail eased out. You turn toward the sail.',
  'Watch out: the sail gybes at once and the boom swings all the way across.',
  'Sheet the main all the way in first, so the boom is locked in the middle.',
  'The wind still flips the sail, but it only crosses the centerline. Then ease it out on the new side.',
]

function mainTight(boom: number) {
  const eased = clamp((Math.abs(boom) - 0.2) / (OUT - 0.2), 0, 1)
  return 1 - eased
}

function headingAt(time: number) {
  if (time < SWAP) {
    return track(time, [
      { t: 0, v: 0 },
      { t: 2.2, v: 0 },
      { t: 5.1, v: 0.95 },
      { t: SWAP, v: 0.95 },
    ])
  }
  return track(time, [
    { t: SWAP, v: 0 },
    { t: 10.2, v: 0 },
    { t: 13.1, v: 0.95 },
    { t: DUR, v: 0.95 },
  ])
}

function poseAt(time: number) {
  const t = clamp(time, 0, DUR)
  const danger = t < SWAP
  const heading = headingAt(t)
  let boom = OUT
  let ghosts: number[] = []
  if (danger) {
    if (t < 3.45) boom = OUT
    else if (t < 4.35) {
      const u = (t - 3.45) / 0.9
      boom = OUT + (-OUT - OUT) * (u * u * u)
      ghosts = trail(u, OUT, -OUT)
    } else boom = -OUT
  } else {
      boom = track(t, [
      { t: SWAP, v: OUT },
      { t: 9.7, v: 0.22 },
      { t: 10.7, v: 0.22 },
      { t: 11.25, v: -0.24, ease: 'snap' },
      { t: 12.3, v: -0.24 },
      { t: 14.6, v: -1.22 },
      { t: DUR, v: -1.22 },
    ])
  }
  let opacity = 1
  if (t > SWAP - 0.42 && t < SWAP + 0.42) {
    const dip = t < SWAP ? (SWAP - t) / 0.42 : (t - SWAP) / 0.42
    opacity *= dip
  }
  const cue = cueAt(CUES, t)
  return {
    t,
    heading,
    boom,
    ghosts,
    opacity,
    caption: cue.text,
    title: cue.title,
    detail: cue.detail,
    tone: cue.tone,
    lock: !danger && t >= 9.55 && t < 13.4,
    ghostArc: (danger && t >= 2.15) || (!danger && t >= 10.75 && t < 13.3),
    alert: danger && t >= 3.4 && t < 5.8,
    rudder: rudderFrom(headingAt, t),
  }
}

export function GybeSlide() {
  const { time, reduced, seek } = useLesson()
  const { time: flutter } = useSeconds(!reduced)
  const pose = poseAt(time)

  return (
    <>
      <Stage
        time={flutter}
        windFrom={PI}
        controls={<ControlCallout highlight={['main']} main={mainTight(pose.boom)} />}
        alert={pose.alert}
        badge={{ tone: pose.tone, title: pose.title, detail: pose.detail }}
        progress={{
          time: pose.t,
          duration: DUR,
          marks: CUES.map((cue) => cue.t),
          caption: pose.caption,
          onSeek: seek,
        }}
      >
        <Boat
          heading={pose.heading}
          boom={pose.boom}
          time={flutter}
          rudder={pose.rudder}
          showTurn
          speed={0.58}
          lock={pose.lock}
          ghostArc={pose.ghostArc}
          ghosts={pose.ghosts}
          opacity={pose.opacity}
          windFrom={PI}
        />
      </Stage>
      <FigureCopy reduced={reduced} caption={pose.caption} beats={BEATS} />
    </>
  )
}
