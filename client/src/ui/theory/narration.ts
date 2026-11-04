import { useEffect, useLayoutEffect, useRef } from 'react'

let lastSpoken = ''
let pending = 0

export function stopNarration() {
  window.clearTimeout(pending)
  pending = 0
  window.speechSynthesis?.cancel()
  lastSpoken = ''
}

/** Speak on the next turn. Chrome drops an utterance that starts in the same turn as cancel(). */
export function speakNow(text: string) {
  const synth = window.speechSynthesis
  const line = text.trim()
  if (!synth || !line) return
  window.clearTimeout(pending)
  synth.cancel()
  lastSpoken = line
  pending = window.setTimeout(() => {
    pending = 0
    const utter = new SpeechSynthesisUtterance(line)
    utter.lang = 'en-US'
    utter.rate = 0.96
    const voices = synth.getVoices()
    const pick = voices.find((voice) => voice.lang === 'en-US') ?? voices.find((voice) => voice.lang.startsWith('en'))
    if (pick) utter.voice = pick
    synth.speak(utter)
  }, 40)
}

/**
 * Narrate the live caption. `intro` is spoken once each time audio is turned on.
 * Caption changes are debounced so dragging the lesson does not stutter.
 */
export function useNarration(enabled: boolean, caption: string, intro = '') {
  const primed = useRef(false)
  const captionRef = useRef(caption)
  const spokenCaption = useRef('')

  useLayoutEffect(() => {
    captionRef.current = caption
  }, [caption])

  useLayoutEffect(() => {
    if (!enabled) {
      primed.current = false
      spokenCaption.current = ''
      stopNarration()
      return
    }
    const current = captionRef.current
    const text = !primed.current && intro ? `${intro} ${current}` : current
    primed.current = true
    spokenCaption.current = current
    if (text && text !== lastSpoken) speakNow(text)
    return () => stopNarration()
  }, [enabled, intro])

  useEffect(() => {
    if (!enabled || !primed.current || caption === spokenCaption.current) return
    spokenCaption.current = caption
    const timer = window.setTimeout(() => speakNow(caption), 240)
    return () => window.clearTimeout(timer)
  }, [enabled, caption])
}

export function useLessonAudio(
  audio: boolean,
  lineRef: { current: string },
  caption: string,
  intro = '',
) {
  const opening = intro ? `${intro} ${caption}` : caption
  useLayoutEffect(() => {
    lineRef.current = opening
  }, [lineRef, opening])
  useNarration(audio, caption, intro)
}
