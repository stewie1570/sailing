import { useEffect, useRef } from 'react'
import { actionsFor, sameBinding, scopeOf, shortPadName, type ActionId, type Binding } from '../input/gamepad'
import {
  clearBinding,
  followConnectedController,
  getController,
  setActiveThrottles,
  setHelmMode,
  setListening,
  useController,
  applyLayout,
} from '../input/controller'
import {
  bindingLabel,
  detectedLayout,
  labelsFor,
  LAYOUTS,
  layoutName,
  type LayoutChoice,
  type LayoutId,
} from '../input/layouts'
import type { HelmMode } from '../scene/boat/helm'

function boundText(
  binding: Binding | undefined,
  selected: boolean,
  padCount: number,
  also: string | null,
  buttons?: readonly string[],
) {
  const name = !binding
    ? null
    : padCount > 1
      ? `${shortPadName(binding.padId)} · ${bindingLabel(binding, buttons)}`
      : bindingLabel(binding, buttons)
  if (selected) {
    const now = name ? `Press a control · now ${name}` : 'Press a control'
    return also ? `${now} · ${also}` : now
  }
  if (!name) return 'Not set'
  return also ? `${name} · ${also}` : name
}

function otherModeUse(id: ActionId, binding: Binding | undefined, mode: HelmMode) {
  if (!binding || scopeOf(id) !== mode) return null
  const other: HelmMode = mode === 'engine' ? 'sailing' : 'engine'
  const bucket = getController().bindings[other]
  for (const action of actionsFor(other)) {
    if (scopeOf(action.id) !== other) continue
    const existing = bucket[action.id]
    if (existing && sameBinding(existing, binding)) {
      return `${other === 'engine' ? 'Engine' : 'Sailing'}: ${action.label}`
    }
  }
  return null
}

function layoutHelp(layout: LayoutChoice, detected: LayoutId | null, active: boolean) {
  const levers = active ? ' Active throttles are on.' : ''
  if (layout === 'custom') {
    return 'These assignments are yours. Pick a controller above to replace them with its defaults, including active throttles.'
  }
  if (layout === 'auto') {
    if (!detected) return 'Plug in a standard controller and it uses that layout, with active throttles. Or pick one above.'
    return `${layoutName(detected)} defaults follow the connected controller.${levers} Change a row and your assignments stay.`
  }
  if (detected && detected !== layout) {
    return `${layoutName(layout)} defaults are selected.${levers} The connected controller looks like ${layoutName(detected)}.`
  }
  return `${layoutName(layout)} defaults.${levers} Change a row and your assignments stay.`
}

export function ControllerSetup({ onClose }: { onClose: () => void }) {
  const { activeThrottles, bindings, helmMode, layout, listening, pads } = useController()
  const dialogRef = useRef<HTMLDivElement>(null)
  const selectedRef = useRef<HTMLButtonElement>(null)
  const actions = actionsFor(helmMode)

  useEffect(() => {
    const saved = getController()
    const list = actionsFor(saved.helmMode)
    const first = list.find((action) => !saved.bindings[scopeOf(action.id)][action.id]) ?? list[0]
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
  const detected = detectedLayout(pads)
  const pressed: LayoutId | null = layout === 'auto' ? detected : layout === 'custom' ? null : layout

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
            : `${names.join(', ')} connected. A control can do one thing in Engine and another in Sailing. The switch picks which one runs.`}
        </p>

        <p className="controller-kicker">Default layout</p>
        <div className="controller-modes controller-layouts" role="group" aria-label="Default layout">
          {LAYOUTS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={pressed === item.id ? 'active' : ''}
              aria-pressed={pressed === item.id}
              onClick={() => applyLayout(item.id)}
            >
              {item.name}
            </button>
          ))}
        </div>
        <p className="controller-help">{layoutHelp(layout, detected, activeThrottles)}</p>
        {layout !== 'auto' && detected && (
          <button type="button" className="controller-match" onClick={() => followConnectedController()}>
            {layout === 'custom'
              ? `Replace with the connected ${layoutName(detected)}`
              : `Follow the connected ${layoutName(detected)}`}
          </button>
        )}

        <div className="controller-modes" role="group" aria-label="Programming mode">
          <button
            type="button"
            className={helmMode === 'engine' ? 'active' : ''}
            aria-pressed={helmMode === 'engine'}
            onClick={() => setHelmMode('engine')}
          >
            Engine
          </button>
          <button
            type="button"
            className={helmMode === 'sailing' ? 'active' : ''}
            aria-pressed={helmMode === 'sailing'}
            onClick={() => setHelmMode('sailing')}
          >
            Sailing
          </button>
        </div>

        {pads.length > 0 && helmMode === 'engine' && (
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
                  ? 'A stick position is the lever. Centred is stop. Buttons still nudge. The controller function toggles this.'
                  : 'Sticks and buttons nudge the levers and leave them. Push farther and they move faster. The controller function toggles this.'}
              </span>
            </span>
          </label>
        )}

        <div className="controller-list">
          {actions.map((action, index) => {
            const selected = listening === action.id
            const binding = bindings[scopeOf(action.id)][action.id]
            const buttons = labelsFor(layout, pads, binding)
            const showGroup = index === 0 || actions[index - 1].group !== action.group
            const modeNote = action.id === 'toggleHelm' ? (helmMode === 'engine' ? 'Engine' : 'Sailing') : null
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
                    <span>
                      {action.label}
                      {modeNote ? ` · ${modeNote}` : ''}
                      {action.id === 'toggleActive' ? (activeThrottles ? ' · on' : ' · off') : ''}
                    </span>
                    <span className="controller-bind">
                      {boundText(binding, selected, pads.length, otherModeUse(action.id, binding, helmMode), buttons)}
                    </span>
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
