import { useState } from 'react'
import { useHelmKeyboard } from '../scene/boat/helm'
import { SailingControls } from './SailingControls'
import { Throttles } from './Throttles'

type Tab = 'engine' | 'sailing'

export function HelmDock() {
  useHelmKeyboard()
  const [tab, setTab] = useState<Tab>('engine')

  return (
    <div className="hud throttles">
      <div className="helm-tabs" role="tablist" aria-label="Boat controls">
        <button
          type="button"
          role="tab"
          id="tab-engine"
          aria-selected={tab === 'engine'}
          aria-controls="panel-engine"
          className={tab === 'engine' ? 'active' : ''}
          onClick={() => setTab('engine')}
        >
          Engine
        </button>
        <button
          type="button"
          role="tab"
          id="tab-sailing"
          aria-selected={tab === 'sailing'}
          aria-controls="panel-sailing"
          className={tab === 'sailing' ? 'active' : ''}
          onClick={() => setTab('sailing')}
        >
          Sailing
        </button>
      </div>
      {tab === 'engine' ? <Throttles /> : <SailingControls />}
    </div>
  )
}
