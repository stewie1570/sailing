import { Boat, Stage, type BadgeTone } from './diagram'
import { BEAM, clamp, lerp, relativeWind, rudderFrom, sailLook, snap, track } from './math'
import { cueAt, useLesson, useSeconds } from './useSeconds'
import { FigureCopy } from './widgets'

const DUR = 17.6

const HEADING = [
  { t: 0, v: 0.82 },
  { t: 2, v: 0.82 },
  { t: 5.4, v: -0.82 },
  { t: 6.6, v: -0.82 },
  { t: 8.8, v: -1.62 },
  { t: 10, v: -1.62 },
  { t: 12, v: -2.25 },
  { t: 13, v: -2.25 },
  { t: 15.6, v: -4.05 },
  { t: DUR, v: -4.05 },
] as const

const CUES = [
  { t: 0, text: 'Going into the wind. To change sides you tack: the bow turns through the wind.' },
  { t: 2, text: 'The bow is turning through the wind. The sail luffs as it crosses, then fills on the new side. That is a tack.' },
  { t: 5.6, text: 'The wind is on the side of the boat. Coming about from here is still a tack.' },
  { t: 10.2, text: 'The wind is off to the side and behind you. A turn that brings the stern through the wind is a gybe.' },
  { t: 13.1, text: 'The wind is behind you. The stern turns through it, and the sail flips across. That is a gybe.' },
  { t: 15.9, text: 'Behind you, or on the quarter: gybe. Ahead of you, or on the side: tack.' },
]

const BEATS = [
  'Going into the wind: you tack. The bow turns through the wind.',
  'Wind on the side of you: changing sides is still a tack.',
  'Wind off to the side and behind you: that turn is a gybe.',
  'Wind behind you: you gybe. The stern turns through the wind and the sail flips across.',
]

function headingOf(time: number) {
  return track(clamp(time, 0, DUR), HEADING)
}

function boomOf(heading: number) {
  if (heading < -2.82 && heading > -3.58) {
    const u = (-2.82 - heading) / 0.76
    return lerp(-1.42, 1.42, snap(u))
  }
  const rel = relativeWind(0, heading)
  const off = Math.abs(rel)
  let cap = 0.42
  if (off >= 1.75) cap = lerp(1.2, 1.42, clamp((off - 1.75) / 0.7, 0, 1))
  else if (off >= 0.95) cap = lerp(0.42, 1.2, (off - 0.95) / 0.8)
  return clamp(clamp(-rel, -BEAM, BEAM), -cap, cap)
}

function phrase(off: number) {
  if (off < 0.95) return 'Into the wind'
  if (off < 1.8) return 'Wind on the side'
  if (off < 2.5) return 'Off to the side and behind'
  return 'Wind behind you'
}

function frame(time: number) {
  const t = clamp(time, 0, DUR)
  const heading = headingOf(t)
  const rel = relativeWind(0, heading)
  const off = Math.abs(rel)
  const boom = boomOf(heading)
  const tack = off < 1.8
  return {
    t,
    heading,
    boom,
    off,
    tack,
    rudder: rudderFrom(headingOf, t),
    opacity: 1,
    caption: cueAt(CUES, t).text,
  }
}

export function CourseSlide() {
  const { time, reduced, seek } = useLesson()
  const { time: flutter } = useSeconds(!reduced)
  const pose = frame(time)
  const tone: BadgeTone = pose.tack ? 'tack' : 'gybe'
  const look = sailLook(relativeWind(0, pose.heading), pose.boom)
  return (
    <>
      <Stage
        time={flutter}
        windFrom={0}
        badge={{ tone, title: pose.tack ? 'Tack' : 'Gybe', detail: phrase(pose.off) }}
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
          showZone
          windFrom={0}
          speed={look.speed}
          luff={look.luff}
          stall={look.stall}
          opacity={pose.opacity}
        />
      </Stage>
      <FigureCopy reduced={reduced} caption={pose.caption} beats={BEATS} />
    </>
  )
}
