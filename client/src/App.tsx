import { useCallback, useEffect, useState } from 'react'
import { startGameConnection } from './net/gameConnection'
import { Scene } from './scene/Scene'
import { Hud } from './ui/Hud'

export default function App() {
  const [loading, setLoading] = useState(true)
  const onReady = useCallback(() => setLoading(false), [])

  useEffect(() => {
    startGameConnection()
  }, [])

  return (
    <div className="app">
      <Scene onReady={onReady} />
      <Hud loading={loading} />
    </div>
  )
}
