import { useState } from 'react'
import { cleanName, filterCodeInput, isRoomCode } from '../net/protocol'
import { hostGame, joinGame, leaveGame, sailAlone, useSession } from '../net/session'

export function Menu({ onLearn, hidden = false }: { onLearn: () => void; hidden?: boolean }) {
  const session = useSession()
  const [name, setName] = useState(session.name)
  const [code, setCode] = useState('')
  const connecting = session.phase === 'connecting'
  const joining = connecting && session.role === 'guest'
  const hosting = connecting && session.role === 'host'

  return (
    <div className="menu" hidden={hidden}>
      <div className="menu-sky" />
      <div className="menu-card">
        <p className="menu-kicker">Sailing and docking</p>
        <h1>Lake Windermere</h1>
        <p className="menu-lead">Sail on your own, or share the lake with a four-character code.</p>

        <label className="menu-field">
          <span>Your name</span>
          <input
            value={name}
            maxLength={16}
            autoComplete="nickname"
            enterKeyHint="done"
            disabled={connecting}
            placeholder="Sailor"
            onChange={(event) => setName(cleanName(event.target.value))}
          />
        </label>

        {session.notice && <p className="menu-notice">{session.notice}</p>}
        {session.error && <p className="menu-error" role="alert">{session.error}</p>}

        <button
          type="button"
          className="menu-go"
          disabled={connecting}
          onClick={() => sailAlone(name)}
        >
          Sail alone
        </button>

        <div className="menu-or">or a room</div>

        <button
          type="button"
          className="menu-choice"
          disabled={connecting}
          onClick={() => void hostGame(name)}
        >
          {hosting ? `Opening ${session.code}` : 'Host a room'}
        </button>

        <form
          className="menu-join"
          onSubmit={(event) => {
            event.preventDefault()
            if (connecting || !isRoomCode(code)) return
            void joinGame(name, code)
          }}
        >
          <label className="menu-field menu-code">
            <span>Room code</span>
            <input
              value={code}
              maxLength={4}
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="go"
              disabled={connecting}
              placeholder="ABCD"
              aria-label="Room code"
              onChange={(event) => setCode(filterCodeInput(event.target.value))}
            />
          </label>
          <button type="submit" className="menu-choice" disabled={connecting || !isRoomCode(code)}>
            {joining ? 'Joining' : 'Join'}
          </button>
        </form>

        {connecting && (
          <button type="button" className="menu-quiet" onClick={() => void leaveGame()}>
            Cancel
          </button>
        )}

        <button type="button" className="menu-choice menu-theory" disabled={connecting} onClick={onLearn}>
          Sailing theory
        </button>

        <p className="menu-foot">
          The host keeps the room. Each sailor steers their own boat.
        </p>
      </div>
    </div>
  )
}
