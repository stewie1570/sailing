import { Boat, Stage, type BadgeTone } from './diagram'
import { PI, clamp, relativeWind, sailLook, track } from './math'
import { cueAt, useLesson, useSeconds } from './useSeconds'
import { FigureCopy } from './widgets'

const DUR = 16.4

const CUES: { t: number; text: string; title: string; detail: string; tone: BadgeTone }[] = [
  { t: 0, text: 'The main has one sheet, led to the middle.', title: 'Main', detail: 'One sheet', tone: 'tack' },
  {
    t: 3.4,
    text: 'The jib works the same way, except two sheets, one on each side.',
    title: 'Jib',
    detail: 'Two sheets',
    tone: 'ok',
  },
  {
    t: 6.8,
    text: 'Haul one sheet. The clew comes to that side, and the other stays slack.',
    title: 'Jib',
    detail: 'Haul one side',
    tone: 'ok',
  },
  {
    t: 10.4,
    text: 'The spinnaker is controlled in the same way. Eased, it fills on both sides.',
    title: 'Spinnaker',
    detail: 'Both eased',
    tone: 'gybe',
  },
  {
    t: 13.6,
    text: 'Haul one sheet and the sail comes across to that side.',
    title: 'Spinnaker',
    detail: 'Hauled across',
    tone: 'gybe',
  },
]

const BEATS = CUES.map((cue) => cue.text)

function poseAt(time: number) {
  const t = clamp(time, 0, DUR)
  const cue = cueAt(CUES, t)
  const windFrom = track(t, [
    { t: 0, v: -1.05 },
    { t: 10.4, v: -1.05 },
    { t: 12.2, v: -PI },
    { t: DUR, v: -PI },
  ])
  const boom = track(t, [
    { t: 0, v: 0.62 },
    { t: 10.4, v: 0.66 },
    { t: 12.4, v: 1.22 },
    { t: DUR, v: 1.22 },
  ])
  const look = sailLook(relativeWind(windFrom, 0), boom)
  return {
    t,
    windFrom,
    boom,
    look,
    cue,
    clew: track(t, [
      { t: 0, v: 0.22 },
      { t: 6.8, v: 0.28 },
      { t: 8.8, v: 1.02 },
      { t: DUR, v: 1.02 },
    ]),
    jibLuff: track(t, [
      { t: 0, v: 0.9 },
      { t: 6.8, v: 0.85 },
      { t: 8.6, v: 0.08 },
      { t: DUR, v: 0.08 },
    ]),
    jibSet: track(t, [
      { t: 0, v: 0 },
      { t: 3.4, v: 0 },
      { t: 4.2, v: 1 },
      { t: 10.4, v: 1 },
      { t: 11.3, v: 0 },
      { t: DUR, v: 0 },
    ]),
    jibPort: 0.12,
    jibStbd: track(t, [
      { t: 0, v: 0.15 },
      { t: 6.8, v: 0.18 },
      { t: 8.8, v: 0.94 },
      { t: DUR, v: 0.94 },
    ]),
    spinSet: track(t, [
      { t: 0, v: 0 },
      { t: 10.4, v: 0 },
      { t: 11.4, v: 1 },
      { t: DUR, v: 1 },
    ]),
    spinCenter: track(t, [
      { t: 0, v: 0 },
      { t: 13.6, v: 0 },
      { t: 15.6, v: -0.95 },
      { t: DUR, v: -0.95 },
    ]),
    spinHalf: track(t, [
      { t: 0, v: 1.05 },
      { t: 13.6, v: 1.05 },
      { t: 15.6, v: 0.4 },
      { t: DUR, v: 0.4 },
    ]),
    spinPort: track(t, [
      { t: 0, v: 0.1 },
      { t: 13.6, v: 0.12 },
      { t: 15.6, v: 0.94 },
      { t: DUR, v: 0.94 },
    ]),
    spinStbd: 0.1,
    spinLuff: 0.06,
  }
}

export function HeadsailSlide() {
  const { time, reduced, seek } = useLesson()
  const { time: flutter } = useSeconds(!reduced)
  const pose = poseAt(time)
  const headsailLuff = pose.spinSet > pose.jibSet ? pose.spinLuff : pose.jibLuff
  return (
    <>
      <Stage
        time={flutter}
        windFrom={pose.windFrom}
        badge={{ tone: pose.cue.tone, title: pose.cue.title, detail: pose.cue.detail }}
        progress={{
          time: pose.t,
          duration: DUR,
          marks: CUES.map((cue) => cue.t),
          caption: pose.cue.text,
          onSeek: seek,
        }}
      >
        <Boat
          heading={0}
          boom={pose.boom}
          time={flutter}
          speed={pose.look.speed}
          luff={pose.look.luff}
          stall={pose.look.stall}
          windFrom={pose.windFrom}
          headsail="sheets"
          jibSet={pose.jibSet}
          spinSet={pose.spinSet}
          clew={pose.clew}
          spinCenter={pose.spinCenter}
          spinHalf={pose.spinHalf}
          jibPort={pose.jibPort}
          jibStbd={pose.jibStbd}
          spinPort={pose.spinPort}
          spinStbd={pose.spinStbd}
          headsailLuff={headsailLuff}
        />
      </Stage>
      <FigureCopy reduced={reduced} caption={pose.cue.text} beats={BEATS} />
    </>
  )
}
