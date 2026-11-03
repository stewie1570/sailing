import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useControllerLoop } from '../input/controller'
import { useHelmKeyboard } from '../scene/boat/helm'
import { ControllerSetup } from './ControllerSetup'
import { SailingControls } from './SailingControls'
import { Throttles } from './Throttles'

type Tab = 'engine' | 'sailing'

function GearIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path
        fill="currentColor"
        d="M19.14 12.94c.04-.31.06-.63.06-.94s-.02-.63-.06-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.1 7.1 0 0 0-1.63-.94l-.36-2.54a.5.5 0 0 0-.49-.42h-3.8a.5.5 0 0 0-.49.42l-.36 2.54c-.59.24-1.13.55-1.63.94l-2.39-.96a.5.5 0 0 0-.6.22L2.71 8.48a.5.5 0 0 0 .12.64l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32c.13.23.4.32.64.22l2.39-.96c.5.39 1.04.7 1.63.94l.36 2.54c.05.24.26.42.49.42h3.8c.24 0 .44-.18.49-.42l.36-2.54c.59-.24 1.13-.55 1.63-.94l2.39.96c.23.1.51 0 .64-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58zM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7z"
      />
    </svg>
  )
}

export function HelmDock() {
  const [tab, setTab] = useState<Tab>('engine')
  const [controllers, setControllers] = useState(false)
  useHelmKeyboard(tab)
  useControllerLoop()

  return (
    <div className="hud throttles">
      <div className="helm-tabs">
        <div className="helm-tablist" role="tablist" aria-label="Boat controls">
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
        <button
          type="button"
          className={`helm-gear${controllers ? ' open' : ''}`}
          aria-label="Controller setup"
          aria-haspopup="dialog"
          aria-expanded={controllers}
          onClick={() => setControllers(true)}
        >
          <GearIcon />
        </button>
      </div>
      {tab === 'engine' ? <Throttles /> : <SailingControls />}
      {controllers && createPortal(<ControllerSetup onClose={() => setControllers(false)} />, document.body)}
    </div>
  )
}
