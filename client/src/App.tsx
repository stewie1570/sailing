import { useCallback, useState } from 'react'
import { useSession } from './net/session'
import { Scene } from './scene/Scene'
import { Hud } from './ui/Hud'
import { Menu } from './ui/Menu'

export default function App() {
  const session = useSession()
  const sailing = session.phase === 'sailing'
  const [loading, setLoading] = useState(true)
  const [prevPhase, setPrevPhase] = useState(session.phase)
  if (session.phase !== prevPhase) {
    setPrevPhase(session.phase)
    if (session.phase === 'sailing') setLoading(true)
  }
  const onReady = useCallback(() => setLoading(false), [])

  return (
    <div className="app">
      {sailing ? (
        <>
          <Scene onReady={onReady} />
          <Hud loading={loading} />
        </>
      ) : (
        <Menu />
      )}
    </div>
  )
}
