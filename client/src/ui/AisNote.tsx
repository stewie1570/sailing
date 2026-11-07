import { useEffect, useRef, useState } from 'react'
import { remoteShip, sendHail, shipIsFresh } from '../net/session'
import { AIS_TEXT_MAX, cleanHail } from '../net/protocol'
import { formatKnots, propulsionLabel } from '../scene/boat/telemetry'
import { closeAis, setAisError, useAisMail } from '../net/aisMail'

/**
 * One hail, then a reply. Closing the note throws that hail away.
 * A collapsed chart does not open this; the line sits above the chart until it is tapped.
 */
export function AisNote() {
  const mail = useAisMail()
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const peerId = mail.peerId
  const [trackedPeer, setTrackedPeer] = useState(peerId)
  const [draftReady, setDraftReady] = useState(false)
  if (peerId !== trackedPeer) {
    setTrackedPeer(peerId)
    setDraftReady(false)
  }

  useEffect(() => {
    if (!peerId) return
    const input = inputRef.current
    if (!input) return
    input.value = ''
    input.focus({ preventScroll: true })
  }, [peerId])

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
  const reply = mail.receivedText.length > 0

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
      {reply && (
        <p className="ais-received">
          <span>{mail.peerName || 'Sailor'}</span>
          {mail.receivedText}
        </p>
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
            setAisError(null)
          })
        }}
      >
        <input
          ref={inputRef}
          id="ais-draft"
          type="text"
          name="ais"
          maxLength={AIS_TEXT_MAX}
          enterKeyHint="send"
          autoComplete="off"
          autoCapitalize="sentences"
          autoCorrect="on"
          spellCheck
          aria-label={reply ? `Reply to ${mail.peerName || 'Sailor'}` : `Message ${mail.peerName || 'Sailor'}`}
          placeholder={reply ? 'Reply' : `Message ${mail.peerName || 'Sailor'}`}
          onPointerDown={(event) => event.stopPropagation()}
          onChange={(event) => {
            setDraftReady(cleanHail(event.target.value).length > 0)
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
      if (drive) drive.textContent = propulsionLabel(ship.port, ship.starboard, ship.bow, ship.stern, ship.hoist, ship.jibHoist, ship.spinHoist)
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
