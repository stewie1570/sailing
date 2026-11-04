import { useEffect, useRef, useState, type ReactNode } from 'react'
import { CourseSlide } from './CourseSlide'
import { GybeSlide } from './GybeSlide'
import { SheetSlide } from './SheetSlide'
import { TrimSlide } from './TrimSlide'
import { useReducedMotion } from './useSeconds'
import type { SlideProps } from './widgets'
import './theory.css'

const SLIDES: { title: string; lead: string; View: (props: SlideProps) => ReactNode }[] = [
  {
    title: 'The main sheet',
    lead: 'The mainsail travels about 180°. The sheet pulls it in against the wind, and easing lets the wind blow it out.',
    View: SheetSlide,
  },
  {
    title: 'Tack or gybe',
    lead: 'Into the wind, or with the wind on your side, you tack. With the wind behind you, or behind and to the side, you gybe.',
    View: CourseSlide,
  },
  {
    title: 'Trim on a tack',
    lead: 'Over-eased, the sail laughs. Over-trimmed, it goes quiet and slow. Stop where the laugh just disappears.',
    View: TrimSlide,
  },
  {
    title: 'Gybing downwind',
    lead: 'Turning toward the sail with the wind behind you sends the boom across. Sheet the main in first so it is locked.',
    View: GybeSlide,
  },
]

export function Theory({ onBack }: { onBack: () => void }) {
  const reduced = useReducedMotion()
  const [index, setIndex] = useState(0)
  const [playing, setPlaying] = useState(true)
  const rootRef = useRef<HTMLDivElement>(null)
  const swipe = useRef<{ x: number; y: number } | null>(null)
  const slide = SLIDES[index] ?? SLIDES[0]
  const last = SLIDES.length - 1

  useEffect(() => {
    rootRef.current?.focus()
  }, [])

  const go = (next: number) => {
    setIndex(Math.min(last, Math.max(0, next)))
    setPlaying(true)
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return
      if (event.key === 'ArrowRight') {
        event.preventDefault()
        setIndex((value) => Math.min(last, value + 1))
        setPlaying(true)
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault()
        setIndex((value) => Math.max(0, value - 1))
        setPlaying(true)
      } else if (event.key === ' ' && !reduced) {
        event.preventDefault()
        setPlaying((value) => !value)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [last, reduced])

  if (!slide) return null
  const View = slide.View

  return (
    <div
      className="theory"
      ref={rootRef}
      tabIndex={-1}
      onPointerDown={(event) => {
        const target = event.target
        if (!(target instanceof Element) || target.closest('input, button, a, label')) return
        swipe.current = { x: event.clientX, y: event.clientY }
      }}
      onPointerUp={(event) => {
        const start = swipe.current
        swipe.current = null
        if (!start) return
        const dx = event.clientX - start.x
        const dy = event.clientY - start.y
        if (Math.abs(dx) < 56 || Math.abs(dx) < Math.abs(dy) * 1.3) return
        go(index + (dx < 0 ? 1 : -1))
      }}
    >
      <div className="theory-sky" />
      <div className="theory-frame">
        <header className="theory-top">
          <div>
            <p className="theory-kicker">
              Sailing theory · {index + 1} of {SLIDES.length}
            </p>
            <h1>{slide.title}</h1>
            <p className="theory-lead">{slide.lead}</p>
          </div>
          <button type="button" className="theory-back" onClick={onBack}>
            Menu
          </button>
        </header>
        <div className="theory-body" key={index}>
          <View playing={playing && !reduced} onHold={() => setPlaying(false)} />
        </div>
        <nav className="theory-nav" aria-label="Slides">
          <button type="button" onClick={() => go(index - 1)} disabled={index === 0}>
            Back
          </button>
          <div className="theory-dots">
            {SLIDES.map((item, dot) => (
              <button
                key={item.title}
                type="button"
                className={dot === index ? 'is-on' : ''}
                aria-label={item.title}
                aria-current={dot === index ? 'true' : undefined}
                onClick={() => go(dot)}
              />
            ))}
          </div>
          {index === last ? (
            <button type="button" onClick={onBack}>
              Done
            </button>
          ) : (
            <button type="button" onClick={() => go(index + 1)}>
              Next
            </button>
          )}
          {!reduced && (
            <button type="button" aria-pressed={playing} onClick={() => setPlaying((value) => !value)}>
              {playing ? 'Pause' : 'Play'}
            </button>
          )}
        </nav>
      </div>
    </div>
  )
}
