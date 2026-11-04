import { useCallback, useState } from 'react'
import { useSession } from './net/session'
import { Scene } from './scene/Scene'
import { Hud } from './ui/Hud'
import { Menu } from './ui/Menu'
import { Theory } from './ui/theory/Theory'

export default function App() {
  const session = useSession()
  const sailing = session.phase === 'sailing'
  const [loading, setLoading] = useState(true)
  const [theory, setTheory] = useState(false)
  const [prevPhase, setPrevPhase] = useState(session.phase)
  if (session.phase !== prevPhase) {
    setPrevPhase(session.phase)
    if (session.phase === 'sailing') {
      setLoading(true)
      setTheory(false)
    }
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
        <>
          <Menu onLearn={() => setTheory(true)} hidden={theory} />
          {theory && <Theory onBack={() => setTheory(false)} />}
        </>
      )}
    </div>
  )
}
