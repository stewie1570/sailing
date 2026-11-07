import { useState } from 'react'
import { Boat, Stage } from './diagram'
import { clamp, lerp, sailLook, track } from './math'
import { cueAt, useLesson, useSeconds } from './useSeconds'
import { FigureCopy, SheetRange } from './widgets'

const DUR = 13.6
const HEADING = 0.72
const EASED = 0.72
const HAULED = 0.28
const RULE = 'The sheet is the rope that controls the sail.'

const CUES = [
  { t: 0, text: 'The wind is in front of the boat. With the sheet eased, the sail swings out and the cloth flaps.' },
  { t: 2.8, text: 'Haul the sheet. The rope pulls the sail in against the wind.' },
  { t: 5.6, text: 'Sheeted in, the cloth holds still and the boat starts to move.' },
  { t: 8.4, text: 'Ease the sheet and the sail falls back out. The cloth flaps again.' },
  { t: 11.2, text: 'The rope is the limit. The wind does the pushing.' },
]

const BEATS = [
  'The wind is in front of the boat. Ease the sheet and the sail swings out. The cloth flaps.',
  'Haul the sheet. The rope pulls the sail in against the wind until the cloth holds still.',
  'Sheeted in, the boat starts to move. Ease the rope and the sail falls back out.',
]

function sliderOf(boom: number) {
  return (EASED - boom) / (EASED - HAULED)
}

function poseAt(time: number) {
  const t = clamp(time, 0, DUR)
  const boom = track(t, [
    { t: 0, v: EASED },
    { t: 2.6, v: EASED },
    { t: 5.2, v: HAULED },
    { t: 8.0, v: HAULED },
    { t: 10.6, v: EASED },
    { t: DUR, v: EASED },
  ])
  return { t, boom, caption: cueAt(CUES, t).text, opacity: 1 }
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

export function SheetSlide() {
  const { time, reduced, seek } = useLesson()
  const { time: flutter } = useSeconds(!reduced)
  const [sheet, setSheet] = useState<number | null>(null)

  const handsOn = sheet != null
  const pose = handsOn ? poseFromSheet(sheet) : poseAt(time)
  const look = sailLook(-HEADING, pose.boom)
  const slider = handsOn ? sheet : sliderOf(pose.boom)

  return (
    <>
      <Stage
        time={flutter}
        windFrom={0}
        progress={{
          time: clamp(time, 0, DUR),
          duration: DUR,
          marks: CUES.map((cue) => cue.t),
          caption: pose.caption,
          onSeek: (next) => {
            setSheet(null)
            seek(next)
          },
        }}
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
        onChange={(value) => setSheet(value)}
      />
    </>
  )
}
