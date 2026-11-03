import { useEffect, useRef, useState } from 'react'
import { remoteShip, sendHail, shipIsFresh } from '../net/session'
import { AIS_TEXT_MAX, cleanHail } from '../net/protocol'
import { formatKnots, propulsionLabel } from '../scene/boat/telemetry'
import { closeAis, currentAisDraft, rememberSent, setAisDraft, setAisError, useAisMail } from '../net/aisMail'

/**
 * The same note on both boats. One helm opens it from the chart. The other
 * helm's copy opens when the text arrives.
 */
export function AisNote() {
  const mail = useAisMail()
  const inputRef = useRef<HTMLInputElement>(null)
  const logRef = useRef<HTMLDivElement>(null)
  const [busy, setBusy] = useState(false)
  const peerId = mail.peerId
  const [trackedPeer, setTrackedPeer] = useState(peerId)
  const [draftReady, setDraftReady] = useState(() => cleanHail(mail.draft).length > 0)
  const loadedPeer = useRef<string | null>(null)
  if (peerId !== trackedPeer) {
    setTrackedPeer(peerId)
    setDraftReady(cleanHail(mail.draft).length > 0)
  }

  useEffect(() => {
    if (!peerId) {
      loadedPeer.current = null
      return
    }
    const input = inputRef.current
    if (!input) return
    // Load a saved draft only when the other boat changes. After that the field
    // owns the text, so a re-render cannot wipe a keystroke.
    if (loadedPeer.current !== peerId) {
      loadedPeer.current = peerId
      input.value = currentAisDraft()
    }
    input.focus({ preventScroll: true })
  }, [peerId])

  useEffect(() => {
    const log = logRef.current
    if (!log) return
    log.scrollTop = log.scrollHeight
  }, [mail.notes])

  useEffect(() => {
    if (!peerId) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeAis()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [peerId])

  if (!peerId) return null
  const ready = draftReady && !busy

  return (
    <section className="ais-note" role="dialog" aria-labelledby="ais-note-title">
      <div className="ais-note-head">
        <div>
          <div className="ais-kicker" id="ais-note-title">AIS</div>
          <strong>{mail.peerName || 'Sailor'}</strong>
          <PeerMotion peerId={peerId} />
        </div>
        <button type="button" onClick={closeAis}>Close</button>
      </div>
      {mail.notes.length > 0 && (
        <div className="ais-log" ref={logRef}>
          {mail.notes.map((line) => (
            <p key={line.id} className={line.mine ? 'mine' : ''}>
              <span>{line.mine ? 'You' : mail.peerName || 'Sailor'}</span>
              {line.text}
            </p>
          ))}
        </div>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault()
          const text = cleanHail(inputRef.current?.value ?? '')
          if (!text || busy) return
          setBusy(true)
          void sendHail(peerId, text).then((err) => {
            setBusy(false)
            if (err) {
              setAisError(err)
              return
            }
            if (inputRef.current) inputRef.current.value = ''
            setDraftReady(false)
            rememberSent(peerId, text)
          })
        }}
      >
        <input
          ref={inputRef}
          id="ais-draft"
          type="text"
          name="ais"
          defaultValue={mail.draft}
          maxLength={AIS_TEXT_MAX}
          enterKeyHint="send"
          autoComplete="off"
          autoCapitalize="sentences"
          autoCorrect="on"
          spellCheck
          aria-label={mail.notes.length > 0 ? `Reply to ${mail.peerName || 'Sailor'}` : `Message ${mail.peerName || 'Sailor'}`}
          placeholder={mail.notes.length > 0 ? 'Reply' : `Message ${mail.peerName || 'Sailor'}`}
          onPointerDown={(event) => event.stopPropagation()}
          onChange={(event) => {
            const next = event.target.value
            setAisDraft(peerId, next)
            setDraftReady(cleanHail(next).length > 0)
            if (mail.error) setAisError(null)
          }}
        />
        <button type="submit" disabled={!ready}>{busy ? 'Sending' : 'Send'}</button>
      </form>
      {mail.error && <p className="ais-error">{mail.error}</p>}
    </section>
  )
}

function PeerMotion({ peerId }: { peerId: string }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let raf = 0
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const node = ref.current
      const ship = remoteShip(peerId)
      if (!node || !ship || !shipIsFresh(peerId)) {
        if (node) node.hidden = true
        return
      }
      node.hidden = false
      const speed = node.firstElementChild
      const drive = node.lastElementChild
      if (speed) speed.textContent = formatKnots(ship.speed, ship.sway)
      if (drive) drive.textContent = propulsionLabel(ship.port, ship.starboard, ship.bow, ship.stern, ship.hoist, ship.jibHoist)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [peerId])

  return (
    <div className="ais-motion" ref={ref} hidden>
      <span />
      <span />
    </div>
  )
}
