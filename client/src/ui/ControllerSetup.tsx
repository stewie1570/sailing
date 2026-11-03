import { useEffect, useRef } from 'react'
import { ACTIONS, bindingLabel, shortPadName, type Binding } from '../input/gamepad'
import {
  clearBinding,
  getController,
  setActiveThrottles,
  setListening,
  useController,
} from '../input/controller'

function boundText(binding: Binding | undefined, selected: boolean, padCount: number) {
  if (selected) {
    return binding ? `Press a control · now ${bindingLabel(binding)}` : 'Press a control'
  }
  if (!binding) return 'Not set'
  return padCount > 1 ? `${shortPadName(binding.padId)} · ${bindingLabel(binding)}` : bindingLabel(binding)
}

export function ControllerSetup({ onClose }: { onClose: () => void }) {
  const { activeThrottles, bindings, listening, pads } = useController()
  const dialogRef = useRef<HTMLDivElement>(null)
  const selectedRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const saved = getController().bindings
    const first = ACTIONS.find((action) => !saved[action.id]) ?? ACTIONS[0]
    setListening(first.id)
    dialogRef.current?.focus()
    return () => setListening(null)
  }, [])

  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: 'nearest' })
  }, [listening])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const names = pads.map((pad) => shortPadName(pad.id))

  return (
    <div className="controller-backdrop" onPointerDown={onClose}>
      <div
        ref={dialogRef}
        className="controller-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="controller-title"
        tabIndex={-1}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="controller-head">
          <h2 id="controller-title">Controllers</h2>
          <button type="button" className="controller-close" onClick={onClose}>
            Close
          </button>
        </div>

        <p className="controller-status">
          {pads.length === 0
            ? 'No controller yet. Press a button on it, then pick a function.'
            : `${names.join(', ')} connected. Pick a function, press a button or push a stick, and the next function is selected.`}
        </p>

        {pads.length > 0 && (
          <label className="controller-active">
            <input
              type="checkbox"
              checked={activeThrottles}
              onChange={(event) => setActiveThrottles(event.target.checked)}
            />
            <span>
              <span className="controller-active-name">Active throttles</span>
              <span className="controller-help">
                {activeThrottles
                  ? 'A stick position is the lever. Centred is stop. Buttons still nudge.'
                  : 'Sticks and buttons nudge the levers and leave them. Push farther and they move faster.'}
              </span>
            </span>
          </label>
        )}

        <div className="controller-list">
          {ACTIONS.map((action, index) => {
            const selected = listening === action.id
            const binding = bindings[action.id]
            const showGroup = index === 0 || ACTIONS[index - 1].group !== action.group
            return (
              <div key={action.id}>
                {showGroup && <div className="controller-group">{action.group}</div>}
                <div className={`controller-row${selected ? ' selected' : ''}`}>
                  <button
                    ref={selected ? selectedRef : undefined}
                    type="button"
                    className="controller-pick"
                    aria-current={selected ? 'true' : undefined}
                    onClick={() => setListening(action.id)}
                  >
                    <span>{action.label}</span>
                    <span className="controller-bind">{boundText(binding, selected, pads.length)}</span>
                  </button>
                  {binding && (
                    <button type="button" className="controller-clear" onClick={() => clearBinding(action.id)}>
                      Clear
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
