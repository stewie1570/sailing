import { useEffect, type RefObject } from 'react'

/**
 * iPad Safari leaves fullscreen when a touch drag counts as a scroll.
 * `touch-action: none` is not enough there, and React's touch listeners are
 * passive, so `preventDefault` in an `onTouchMove` handler does not count.
 * These listeners sit on the slider itself and are not passive, so the drag
 * never becomes a scroll.
 */
export function useCancelSliderTouch(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const block = (e: TouchEvent) => {
      if (e.cancelable) e.preventDefault()
    }
    el.addEventListener('touchstart', block, { capture: true, passive: false })
    el.addEventListener('touchmove', block, { capture: true, passive: false })
    return () => {
      el.removeEventListener('touchstart', block, { capture: true })
      el.removeEventListener('touchmove', block, { capture: true })
    }
  }, [ref])
}
