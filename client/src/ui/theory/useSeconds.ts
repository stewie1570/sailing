import { useCallback, useEffect, useRef, useState } from 'react'

export function useReducedMotion() {
  const [reduced, setReduced] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => setReduced(query.matches)
    sync()
    query.addEventListener('change', sync)
    return () => query.removeEventListener('change', sync)
  }, [])
  return reduced
}

/** The latest cue whose time is at or before `time`. */
export function cueAt<T extends { t: number }>(cues: readonly T[], time: number): T {
  let current = cues[0]
  for (const cue of cues) {
    if (current == null || time >= cue.t) current = cue
  }
  return current as T
}

/** Lesson time. It moves only when the slider says so. */
export function useLesson() {
  const reduced = useReducedMotion()
  const [time, setTime] = useState(0)
  const seek = useCallback((next: number) => {
    setTime(Math.max(0, next))
  }, [])
  return { time, reduced, seek }
}

/** Seconds since the slide started. Pauses without rewinding. `seek` jumps the clock. */
export function useSeconds(running: boolean) {
  const reduced = useReducedMotion()
  const [time, setTime] = useState(0)
  const acc = useRef(0)
  const held = useRef(false)

  const seek = useCallback((next: number) => {
    const value = Math.max(0, next)
    acc.current = value
    setTime(value)
  }, [])

  const hold = useCallback((down: boolean) => {
    held.current = down
  }, [])

  useEffect(() => {
    if (!running || reduced) return
    let frame = 0
    let last = performance.now()
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      if (!document.hidden && !held.current) {
        acc.current += dt
        setTime(acc.current)
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [running, reduced])

  return { time, reduced, seek, hold }
}
