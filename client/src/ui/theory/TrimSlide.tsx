import { useState } from 'react'
import { Boat, Stage } from './diagram'
import { clamp, knotsOf, lerp, sailLook, track } from './math'
import { cueAt, useLesson, useSeconds } from './useSeconds'
import { FigureCopy, SheetRange } from './widgets'

const DUR = 17.2
const HEADING = 1.02
const EASED = 1.02
const QUIET = 0.56
const TIGHT = 0.04
const SWEET = (EASED - QUIET) / (EASED - TIGHT)

const CUES = [
  { t: 0, text: 'Over-eased. The sail is luffing: the cloth flaps because the sheet lets it line up with the wind.' },
  { t: 3.2, text: 'Sheet in. The luff should die away, from the leech back toward the mast, until the whole sail is quiet.' },
  { t: 5.8, text: 'Just enough. It does not luff anywhere on the sail, and the boat is up to speed.' },
  { t: 8.4, text: 'Keep hauling and you over-trim it. The sail stays quiet, but it stops pulling.' },
  { t: 10.8, text: 'Over-trimmed. You are not getting much speed. The sail is stalled.' },
  { t: 12.6, text: 'Ease back until the sail is just short of luffing. That is the trim.' },
  { t: 15, text: 'Leave it here: quiet everywhere, and driving.' },
]

const BEATS = [
  'Over-eased, the sail luffs: the cloth flaps because it is lined up with the wind.',
  'Sheet in just until the luff leaves the whole sail. That trim is the one that gives you speed.',
  'Over-trimmed, the sail is quiet but stalled, and the boat is not getting much speed.',
  'Come back to the spot where it has just stopped luffing, and leave it there.',
]

function boomAt(time: number) {
  const t = clamp(time, 0, DUR)
  return {
    t,
    boom: track(t, [
      { t: 0, v: EASED },
      { t: 3, v: EASED },
      { t: 5.6, v: QUIET },
      { t: 8.2, v: QUIET },
      { t: 10.6, v: TIGHT },
      { t: 12.4, v: TIGHT },
      { t: 14.8, v: QUIET },
      { t: DUR, v: QUIET },
    ]),
  }
}

function sheetOf(boom: number) {
  return (EASED - boom) / (EASED - TIGHT)
}

function boomOf(sheet: number) {
  return lerp(EASED, TIGHT, sheet)
}

function words(luff: number, stall: number, speed: number, telling: boolean) {
  if (luff > 0.55) {
    return telling
      ? 'Over-eased. The sail is luffing: the cloth is flapping, lined up with the wind, and not driving.'
      : 'Luffing'
  }
  if (luff > 0.12) {
    return telling
      ? 'Still luffing. Sheet in a little more, until the flap is gone from the whole sail.'
      : 'Still luffing'
  }
  if (stall > 0.45) {
    return telling
      ? 'Over-trimmed. The sail is quiet, but it is stalled, so you are not getting much speed.'
      : 'Stalled'
  }
  if (speed > 0.82) {
    return telling
      ? 'Just enough. The sail does not luff anywhere, and this is the speed you are after.'
      : 'Just quiet'
  }
  return telling ? 'Close. Ease a touch if it is tight, or sheet in if any cloth is still luffing.' : 'Trimming'
}

export function TrimSlide() {
  const { time, reduced, seek } = useLesson()
  const { time: flutter } = useSeconds(!reduced)
  const [sheet, setSheet] = useState<number | null>(null)

  const handsOn = sheet != null
  const animated = boomAt(time)
  const boom = handsOn ? boomOf(sheet) : animated.boom
  const look = sailLook(-HEADING, boom)
  const slider = handsOn ? sheet : sheetOf(boom)
  const note = words(look.luff, look.stall, look.speed, false)
  const caption = handsOn ? words(look.luff, look.stall, look.speed, true) : cueAt(CUES, animated.t).text

  return (
    <>
      <Stage
        time={flutter}
        windFrom={0}
        speed={{ knots: knotsOf(look.speed), note }}
        progress={{
          time: animated.t,
          duration: DUR,
          marks: CUES.map((cue) => cue.t),
          caption,
          onSeek: (next) => {
            setSheet(null)
            seek(next)
          },
        }}
      >
        <Boat
          heading={HEADING}
          boom={boom}
          time={flutter}
          luff={look.luff}
          stall={look.stall}
          speed={look.speed}
          opacity={1}
          windFrom={0}
        />
      </Stage>
      <FigureCopy reduced={reduced} caption={caption} beats={BEATS} />
      <SheetRange
        value={slider}
        sweet={SWEET}
        status={note}
        onChange={(value) => setSheet(value)}
      />
    </>
  )
}
