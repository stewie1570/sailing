import { useState } from 'react'
import { Boat, Stage } from './diagram'
import { lerp, loopFade, sailLook, track } from './math'
import { useLessonAudio } from './narration'
import { useSeconds } from './useSeconds'
import { FigureCopy, SheetRange, type SlideProps } from './widgets'

const DUR = 13.6
const HEADING = 0.72
const EASED = 0.72
const HAULED = 0.28
const RULE = 'The sheet is the rope that controls the sail.'

const BEATS = [
  'The wind is in front of the boat. Ease the sheet and the sail swings out. The cloth flaps.',
  'Haul the sheet. The rope pulls the sail in against the wind until the cloth holds still.',
  'Sheeted in, the boat starts to move. Ease the rope and the sail falls back out.',
]

function sliderOf(boom: number) {
  return (EASED - boom) / (EASED - HAULED)
}

function poseAt(time: number) {
  const t = time % DUR
  const boom = track(t, [
    { t: 0, v: EASED },
    { t: 2.6, v: EASED },
    { t: 5.2, v: HAULED },
    { t: 8.0, v: HAULED },
    { t: 10.6, v: EASED },
    { t: DUR, v: EASED },
  ])
  let caption = 'The rope is the limit. The wind does the pushing.'
  if (t < 2.8) caption = 'The wind is in front of the boat. With the sheet eased, the sail swings out and the cloth flaps.'
  else if (t < 5.6) caption = 'Haul the sheet. The rope pulls the sail in against the wind.'
  else if (t < 8.4) caption = 'Sheeted in, the cloth holds still and the boat starts to move.'
  else if (t < 11.2) caption = 'Ease the sheet and the sail falls back out. The cloth flaps again.'
  return { t, boom, caption, opacity: loopFade(t, DUR) }
}

function poseFromSheet(sheet: number) {
  const boom = lerp(EASED, HAULED, sheet)
  let caption = 'The sheet sets how far the sail can swing out.'
  if (sheet < 0.22) caption = 'Eased. The sail is out and the cloth is flapping in the wind ahead of the boat.'
  else if (sheet > 0.78) caption = 'Hauled in. The rope has pulled the sail against the wind, and the cloth holds still.'
  return { t: 0, boom, caption, opacity: 1 }
}

function statusFor(sheet: number) {
  if (sheet < 0.22) return 'Eased'
  if (sheet > 0.78) return 'Hauled in'
  return 'Sheet partly in'
}

export function SheetSlide({ playing, onHold, audio, lineRef }: SlideProps) {
  const { time, reduced, seek, hold } = useSeconds(playing)
  const { time: flutter } = useSeconds(!reduced)
  const [sheet, setSheet] = useState<number | null>(null)
  const [wasPlaying, setWasPlaying] = useState(playing)
  if (playing !== wasPlaying) {
    setWasPlaying(playing)
    if (playing) setSheet(null)
  }

  const handsOn = reduced || (!playing && sheet != null)
  const pose = handsOn ? poseFromSheet(sheet ?? 0) : poseAt(time)
  const look = sailLook(-HEADING, pose.boom)
  const slider = handsOn ? (sheet ?? 0) : sliderOf(pose.boom)
  const narrated = reduced ? BEATS.join(' ') : pose.caption
  useLessonAudio(audio, lineRef, narrated, RULE)

  return (
    <>
      <Stage
        time={flutter}
        windFrom={0}
        progress={
          handsOn
            ? null
            : { time: pose.t, duration: DUR, onSeek: seek, onScrub: hold }
        }
      >
        <Boat
          heading={HEADING}
          boom={pose.boom}
          time={flutter}
          speed={look.speed}
          luff={look.luff}
          stall={look.stall}
          showArc
          allowed={pose.boom}
          opacity={pose.opacity}
          windFrom={0}
        />
      </Stage>
      <FigureCopy reduced={reduced} caption={pose.caption} beats={BEATS} rule={RULE} />
      <SheetRange
        value={slider}
        status={statusFor(slider)}
        onChange={(value) => {
          onHold()
          setSheet(value)
        }}
      />
    </>
  )
}
