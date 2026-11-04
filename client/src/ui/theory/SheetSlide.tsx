import { useState } from 'react'
import { Boat, Stage } from './diagram'
import { PI, lerp, loopFade, smooth, track, trail } from './math'
import { useSeconds } from './useSeconds'
import { FigureCopy, SheetRange, type SlideProps } from './widgets'

const DUR = 16.6
const EASED = PI / 2
const HAULED = 0.16
const OUT = 1.5

const BEATS = [
  'The mainsail travels about 180°, from the port beam to the starboard beam.',
  'The wind blows the sail out. The sheet only decides how far it may go.',
  'Haul the sheet and the sail comes in against the wind.',
  'Ease the sheet and the wind blows the sail back out along the same arc.',
]

function sliderOf(allowed: number) {
  return (EASED - allowed) / (EASED - HAULED)
}

function poseAt(time: number) {
  const t = time % DUR
  const boom = track(t, [
    { t: 0, v: -OUT },
    { t: 2.5, v: -OUT },
    { t: 5.1, v: -0.18 },
    { t: 6.3, v: -0.18 },
    { t: 8.8, v: -OUT },
    { t: 9.6, v: -OUT },
    { t: 10.5, v: OUT, ease: 'snap' },
    { t: 12.5, v: OUT },
    { t: 14.0, v: -OUT, ease: 'snap' },
    { t: DUR, v: -OUT },
  ])
  const windFrom = track(t, [
    { t: 0, v: PI / 2 },
    { t: 9.2, v: PI / 2 },
    { t: 11.4, v: (3 * PI) / 2 },
    { t: 12.3, v: (3 * PI) / 2 },
    { t: 14.7, v: PI / 2 },
    { t: DUR, v: PI / 2 },
  ])
  const hauling = t >= 2.5 && t < 8.8
  const allowed = hauling ? Math.max(Math.abs(boom), HAULED) : EASED
  const mark = t < 2.4 ? lerp(-EASED, EASED, smooth(t / 2.4)) : null
  let ghosts: number[] = []
  if (t >= 9.6 && t <= 10.7) ghosts = trail((t - 9.6) / 0.9, -OUT, OUT)
  else if (t >= 12.5 && t <= 14.2) ghosts = trail((t - 12.5) / 1.5, OUT, -OUT)
  let caption = 'Back across the same arc. The sheet is still the limit, and the wind does the pushing.'
  if (t < 2.5) caption = 'This arc is how far the mainsail can travel: about 180°, from one side of the boat to the other.'
  else if (t < 6.4) caption = 'Haul the main sheet and you pull the sail in against the wind.'
  else if (t < 9.3) caption = 'Ease the sheet. The wind blows the sail back out until the rope stops it.'
  else if (t < 12.4) caption = 'With the sheet eased, the sail can use that whole arc. It crosses about 180°, from one side to the other.'
  return { t, boom, windFrom, allowed, mark, ghosts, caption, opacity: loopFade(t, DUR) }
}

function poseFromSheet(sheet: number) {
  const allowed = lerp(EASED, HAULED, sheet)
  let caption = 'The sheet sets the limit. The wind pushes the sail out until the rope is tight.'
  if (sheet < 0.22) caption = 'Eased. The wind holds the sail out at the end of the sheet, on the edge of the 180° arc.'
  else if (sheet > 0.78) caption = 'Hauled. The sheet has pulled the sail in against the wind, toward the middle of the boat.'
  return {
    t: 0,
    boom: -allowed,
    windFrom: PI / 2,
    allowed,
    mark: null as number | null,
    ghosts: [] as number[],
    caption,
    opacity: 1,
  }
}

function statusFor(sheet: number) {
  if (sheet < 0.22) return 'Eased'
  if (sheet > 0.78) return 'Hauled in'
  return 'Sheet partly in'
}

export function SheetSlide({ playing, onHold }: SlideProps) {
  const { time, reduced } = useSeconds(playing)
  const [sheet, setSheet] = useState<number | null>(null)
  const [wasPlaying, setWasPlaying] = useState(playing)
  if (playing !== wasPlaying) {
    setWasPlaying(playing)
    if (playing) setSheet(null)
  }

  const handsOn = reduced || (!playing && sheet != null)
  const pose = handsOn ? poseFromSheet(sheet ?? 0) : poseAt(time)
  const slider = handsOn ? (sheet ?? 0) : sliderOf(pose.allowed)

  return (
    <>
      <Stage time={handsOn ? 0 : time} windFrom={pose.windFrom} progress={handsOn ? null : { time: pose.t, duration: DUR }}>
        <Boat
          heading={0}
          boom={pose.boom}
          time={handsOn ? 0 : time}
          speed={0.42}
          showArc
          allowed={pose.allowed}
          mark={pose.mark}
          ghosts={pose.ghosts}
          opacity={pose.opacity}
          windFrom={pose.windFrom}
        />
      </Stage>
      <FigureCopy reduced={reduced} caption={pose.caption} beats={BEATS} />
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
