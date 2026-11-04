import { Boat, Stage, type BadgeTone } from './diagram'
import { PI, loopFade, rudderFrom, track, trail } from './math'
import { useLessonAudio } from './narration'
import { useSeconds } from './useSeconds'
import { FigureCopy, type SlideProps } from './widgets'

const DUR = 16.4
const SWAP = 7.5
const OUT = 1.28

const BEATS = [
  'Wind behind you, sail eased out. You turn toward the sail.',
  'Watch out: the sail gybes at once and the boom swings all the way across.',
  'Sheet the main all the way in first, so the boom is locked in the middle.',
  'The wind still flips the sail, but it only crosses the centerline. Then ease it out on the new side.',
]

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
  const t = time % DUR
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
  let opacity = loopFade(t, DUR, 0.35)
  if (t > SWAP - 0.42 && t < SWAP + 0.42) {
    const dip = t < SWAP ? (SWAP - t) / 0.42 : (t - SWAP) / 0.42
    opacity *= dip
  }
  let caption = 'Then ease the sheet on the new side and let the sail fill.'
  let title = 'New side'
  let detail = 'Ease the sheet'
  let tone: BadgeTone = 'ok'
  if (t < 2.2) {
    caption = 'Running, with the wind behind you and the sail eased out to one side.'
    title = 'Wind behind'
    detail = 'Sail eased out'
    tone = 'warn'
  } else if (t < 3.45) {
    caption = 'You turn toward the sail. Watch out for the gybe.'
    title = 'Turning in'
    detail = 'Toward the sail'
    tone = 'warn'
  } else if (t < 5.7) {
    caption = 'The wind gets behind the sail and it gybes at once. The boom swings all the way across.'
    title = 'Gybing'
    detail = 'Boom swinging across'
    tone = 'warn'
  } else if (t < SWAP) {
    caption = 'That full swing is what you are watching out for.'
    title = 'Watch out'
    detail = 'All the way across'
    tone = 'warn'
  } else if (t < 9.8) {
    caption = 'Sheet the main all the way in before the turn. The boom comes to the middle and the sheet locks it.'
    title = 'Sheet in'
    detail = 'Lock the boom'
    tone = 'ok'
  } else if (t < 10.9) {
    caption = 'Locked. The sail has almost no room to swing.'
    title = 'Locked'
    detail = 'Boom in the middle'
    tone = 'ok'
  } else if (t < 12.5) {
    caption = 'Same turn toward the sail. It still flips when the wind crosses, but only across the centerline.'
    title = 'Small flip'
    detail = 'Nowhere to swing'
    tone = 'ok'
  }
  return {
    t,
    heading,
    boom,
    ghosts,
    opacity,
    caption,
    title,
    detail,
    tone,
    lock: !danger && t >= 9.55 && t < 13.4,
    ghostArc: (danger && t >= 2.15) || (!danger && t >= 10.75 && t < 13.3),
    alert: danger && t >= 3.4 && t < 5.8,
    rudder: rudderFrom(headingAt, t),
  }
}

export function GybeSlide({ playing, audio, lineRef }: SlideProps) {
  const { time, reduced, seek, hold } = useSeconds(playing)
  const pose = poseAt(time)
  useLessonAudio(
    audio,
    lineRef,
    reduced
      ? `With the wind behind you, sheeting in locks the boom before the sail gybes. ${BEATS.join(' ')}`
      : pose.caption,
  )
  if (reduced) {
    return (
      <>
        <div className="theory-compare">
          <figure>
            <Stage time={0} windFrom={PI} alert badge={{ tone: 'warn', title: 'Watch out', detail: 'Turning toward the sail' }}>
              <Boat heading={0.72} boom={-1.05} time={0} rudder={0.45} showTurn ghosts={[1.15, 0.4, -0.25]} speed={0.5} windFrom={PI} />
            </Stage>
            <figcaption>Turn toward the eased sail and the boom slams across.</figcaption>
          </figure>
          <figure>
            <Stage time={0} windFrom={PI} badge={{ tone: 'ok', title: 'Sheeted in', detail: 'Boom locked' }}>
              <Boat heading={0.62} boom={-0.22} time={0} rudder={0.4} showTurn lock ghostArc ghosts={[0.22]} speed={0.5} windFrom={PI} />
            </Stage>
            <figcaption>Sheet in first. The sail flips, but only across the middle.</figcaption>
          </figure>
        </div>
        <FigureCopy
          reduced
          caption="With the wind behind you, sheeting in locks the boom before the sail gybes."
          beats={BEATS}
        />
      </>
    )
  }

  return (
    <>
      <Stage
        time={time}
        windFrom={PI}
        alert={pose.alert}
        badge={{ tone: pose.tone, title: pose.title, detail: pose.detail }}
        progress={{ time: pose.t, duration: DUR, onSeek: seek, onScrub: hold }}
      >
        <Boat
          heading={pose.heading}
          boom={pose.boom}
          time={time}
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
      <FigureCopy reduced={false} caption={pose.caption} beats={BEATS} />
    </>
  )
}
