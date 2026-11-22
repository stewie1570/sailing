import { useEffect, useRef, useState } from 'react'
import { dismissChallenge, formatDuration, useChallenge } from '../scene/challenge'

function useElapsed(running: boolean, startedAt: number, finishedAt: number | null) {
  const [now, setNow] = useState(() => performance.now())
  useEffect(() => {
    if (!running) return
    const id = window.setInterval(() => setNow(performance.now()), 200)
    return () => window.clearInterval(id)
  }, [running])
  if (finishedAt != null) return finishedAt - startedAt
  if (!running) return 0
  return Math.max(0, now - startedAt)
}

export function ChallengeBanner() {
  const challenge = useChallenge()
  const running = challenge.phase === 'pickup' || challenge.phase === 'carry'
  const elapsed = useElapsed(running, challenge.startedAt, challenge.finishedAt)
  if (!running) return null
  const cars = challenge.kind === 'ferry'
  const task = cars
    ? challenge.phase === 'pickup'
      ? `Pick up the cars at ${challenge.harborName}`
      : `Deliver the cars to ${challenge.harborName}`
    : challenge.phase === 'pickup'
      ? `Pick up the package at ${challenge.harborName}`
      : `Deliver the package to ${challenge.harborName}`
  return (
    <div className="hud challenge-banner" aria-live="polite">
      <div className="challenge-kicker">Challenge</div>
      <strong>{task}</strong>
      <div className="challenge-clock">{formatDuration(elapsed)}</div>
    </div>
  )
}

export function ChallengeResult() {
  const challenge = useChallenge()
  const dialogRef = useRef<HTMLDivElement>(null)
  const open = challenge.phase === 'done' && challenge.finishedAt != null
  useEffect(() => {
    if (open) dialogRef.current?.focus()
  }, [open])
  if (!open || challenge.finishedAt == null) return null
  const took = formatDuration(challenge.finishedAt - challenge.startedAt)
  return (
    <div className="challenge-backdrop">
      <div
        ref={dialogRef}
        className="challenge-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="challenge-title"
        tabIndex={-1}
      >
        <p className="challenge-kicker">Challenge complete</p>
        <h2 id="challenge-title">{challenge.kind === 'ferry' ? 'Cars delivered' : 'Package delivered'}</h2>
        <p className="challenge-time">{took}</p>
        <p className="challenge-note">
          {challenge.kind === 'ferry'
            ? 'That’s how long it took to load the cars and put them on the other dock.'
            : 'That’s how long it took to pick the package up and put it on the other dock.'}
        </p>
        <button type="button" onClick={() => dismissChallenge()}>
          Done
        </button>
      </div>
    </div>
  )
}
