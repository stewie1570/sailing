import { useEffect, useSyncExternalStore } from 'react'
import { nudgeCamera } from '../scene/cameraDrive'
import { controlDrag, getHelm, updateHelm, type Helm } from '../scene/boat/helm'
import {
  ACTIONS,
  axisLever,
  bindingValue,
  captureInput,
  isActionId,
  isBinding,
  padFor,
  rateStep,
  sameBinding,
  type ActionId,
  type Binding,
  type PadSample,
} from './gamepad'

const STORAGE_KEY = 'sailing.controller'

interface SavedController {
  activeThrottles: boolean
  bindings: Partial<Record<ActionId, Binding>>
}

export interface ControllerState extends SavedController {
  listening: ActionId | null
  pads: PadSample[]
}

function emptySaved(): SavedController {
  return { activeThrottles: false, bindings: {} }
}

function loadSaved(): SavedController {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return emptySaved()
    const parsed = JSON.parse(raw) as Partial<SavedController>
    const bindings: Partial<Record<ActionId, Binding>> = {}
    const stored = parsed.bindings
    if (stored && typeof stored === 'object') {
      for (const [id, binding] of Object.entries(stored)) {
        if (isActionId(id) && isBinding(binding)) bindings[id] = binding
      }
    }
    return { activeThrottles: parsed.activeThrottles === true, bindings }
  } catch {
    return emptySaved()
  }
}

let state: ControllerState = { ...loadSaved(), listening: null, pads: [] }
const listeners = new Set<() => void>()

function commit(next: ControllerState, persist: boolean) {
  state = next
  if (persist) {
    const saved: SavedController = { activeThrottles: next.activeThrottles, bindings: next.bindings }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved))
  }
  listeners.forEach((listener) => listener())
}

function replace(patch: Partial<ControllerState>, persist: boolean) {
  commit({ ...state, ...patch }, persist)
}

export function getController(): ControllerState {
  return state
}

export function useController(): ControllerState {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => state,
  )
}

export function setListening(id: ActionId | null) {
  if (state.listening === id) return
  replace({ listening: id }, false)
}

export function setActiveThrottles(on: boolean) {
  if (state.activeThrottles === on) return
  replace({ activeThrottles: on }, true)
}

export function clearBinding(id: ActionId) {
  if (!state.bindings[id]) return
  const bindings = { ...state.bindings }
  delete bindings[id]
  replace({ bindings }, true)
}

/** Assign a control. The same press cannot stay bound to another function. */
export function bindAction(id: ActionId, binding: Binding) {
  const bindings = { ...state.bindings }
  for (const key of Object.keys(bindings) as ActionId[]) {
    const existing = bindings[key]
    if (existing && sameBinding(existing, binding)) delete bindings[key]
  }
  bindings[id] = binding
  const index = ACTIONS.findIndex((action) => action.id === id)
  const next = ACTIONS[index + 1]?.id ?? id
  replace({ bindings, listening: state.listening === id ? next : state.listening }, true)
}

function readPads(): PadSample[] {
  const list = navigator.getGamepads?.() ?? []
  const pads: PadSample[] = []
  for (const pad of list) {
    if (!pad) continue
    pads.push({
      id: pad.id || `Controller ${pad.index + 1}`,
      index: pad.index,
      buttons: pad.buttons.map((button) => button.value),
      axes: Array.from(pad.axes),
    })
  }
  return pads
}

function padsChanged(next: PadSample[]) {
  if (next.length !== state.pads.length) return true
  return next.some((pad, index) => pad.id !== state.pads[index]?.id || pad.index !== state.pads[index]?.index)
}

function readAction(id: ActionId, pads: readonly PadSample[]) {
  const binding = state.bindings[id]
  if (!binding) return 0
  const pad = padFor(binding, pads)
  if (!pad) return 0
  return bindingValue(binding, pad)
}

/**
 * Active throttles copy the stick. The ahead binding's axis is the lever:
 * the end captured for "ahead" is full ahead, and the other end is full astern.
 * Buttons have no position, so those throttles keep nudging instead.
 */
function activeLever(ahead: ActionId, astern: ActionId, pads: readonly PadSample[]) {
  const aheadBinding = state.bindings[ahead]
  if (aheadBinding?.source === 'axis') {
    const pad = padFor(aheadBinding, pads)
    if (!pad) return null
    return axisLever(pad.axes[aheadBinding.index] ?? 0, aheadBinding.sign)
  }
  const asternBinding = state.bindings[astern]
  if (asternBinding?.source === 'axis') {
    const pad = padFor(asternBinding, pads)
    if (!pad) return null
    return -axisLever(pad.axes[asternBinding.index] ?? 0, asternBinding.sign)
  }
  return null
}

const dragName = {
  port: () => controlDrag('port'),
  starboard: () => controlDrag('starboard'),
  rudder: () => controlDrag('rudder'),
  bow: () => controlDrag('bow'),
  stern: () => controlDrag('stern'),
  sheet: () => controlDrag('sheet'),
  halyard: () => controlDrag('halyard'),
  jib: () => controlDrag('jib'),
  jibPort: () => controlDrag('jibPort'),
  jibStarboard: () => controlDrag('jibStarboard'),
}

const RATE = {
  throttle: 0.9,
  rudder: 1.1,
  thruster: 0.9,
  sheet: 0.45,
  furler: 0.45,
  zoom: 0.85,
  lookYaw: 1.15,
  lookHeight: 6,
}

/** True on the frame a bound control crosses into a press. Holding it does not repeat. */
function rising(id: ActionId, pads: readonly PadSample[], prev: Map<ActionId, number>) {
  const value = readAction(id, pads)
  const was = prev.get(id) ?? 0
  prev.set(id, value)
  return was < 0.5 && value >= 0.5
}

function apply(pads: readonly PadSample[], dt: number) {
  const helm = getHelm()
  const patch: Partial<Helm> = {}
  const active = state.activeThrottles

  const lever = (
    current: number,
    ahead: ActionId,
    astern: ActionId,
    rate: number,
    drag: keyof typeof dragName,
    min: number,
    max: number,
    position: number | null,
  ) => {
    if (dragName[drag]()) return current
    if (position != null) return position
    return rateStep(current, readAction(ahead, pads) - readAction(astern, pads), rate, dt, min, max)
  }

  const portPosition = active ? activeLever('portAhead', 'portAstern', pads) : null
  const stbdPosition = active ? activeLever('stbdAhead', 'stbdAstern', pads) : null
  patch.port = lever(helm.port, 'portAhead', 'portAstern', RATE.throttle, 'port', -1, 1, portPosition)
  patch.starboard = lever(helm.starboard, 'stbdAhead', 'stbdAstern', RATE.throttle, 'starboard', -1, 1, stbdPosition)
  patch.rudder = lever(helm.rudder, 'rudderStbd', 'rudderPort', RATE.rudder, 'rudder', -1, 1, null)
  patch.bow = lever(helm.bow, 'bowStbd', 'bowPort', RATE.thruster, 'bow', -1, 1, null)
  patch.stern = lever(helm.stern, 'sternStbd', 'sternPort', RATE.thruster, 'stern', -1, 1, null)
  patch.sheet = lever(helm.sheet, 'sheetOut', 'sheetIn', RATE.sheet, 'sheet', 0, 1, null)
  patch.halyard = lever(helm.halyard, 'halyardUp', 'halyardDown', RATE.furler, 'halyard', 0, 1, null)
  patch.jib = lever(helm.jib, 'jibOut', 'jibIn', RATE.furler, 'jib', 0, 1, null)
  patch.jibPort = lever(helm.jibPort, 'jibPortHaul', 'jibPortEase', RATE.sheet, 'jibPort', 0, 1, null)
  patch.jibStarboard = lever(helm.jibStarboard, 'jibStbdHaul', 'jibStbdEase', RATE.sheet, 'jibStarboard', 0, 1, null)
  updateHelm(patch)

  const zoom = readAction('zoomOut', pads) - readAction('zoomIn', pads)
  const look = readAction('lookStbd', pads) - readAction('lookPort', pads)
  const lift = readAction('lookUp', pads) - readAction('lookDown', pads)
  if (zoom !== 0 || look !== 0 || lift !== 0) {
    nudgeCamera({
      distance: zoom !== 0 ? Math.exp(zoom * RATE.zoom * dt) : 1,
      yaw: look * RATE.lookYaw * dt,
      height: lift * RATE.lookHeight * dt,
    })
  }
}

/** Poll pads. While a function is selected, the next press binds it and moves on. */
export function useControllerLoop() {
  useEffect(() => {
    const seen = new Map<number, PadSample>()
    const held = new Map<ActionId, number>()
    let last = performance.now()
    let raf = 0
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick)
      const dt = Math.min(0.05, Math.max(0, (now - last) / 1000))
      last = now
      let pads: PadSample[] = []
      try {
        pads = readPads()
      } catch {
        pads = []
      }
      if (padsChanged(pads)) replace({ pads }, false)

      const listening = state.listening
      if (listening) {
        // Keep the edge tracker current so closing the dialog on a held button does not toggle.
        rising('toggleActive', pads, held)
        for (const pad of pads) {
          const hit = captureInput(seen.get(pad.index) ?? null, pad)
          seen.set(pad.index, pad)
          if (hit && state.listening === listening) {
            bindAction(listening, hit)
            break
          }
        }
        for (const index of seen.keys()) {
          if (!pads.some((pad) => pad.index === index)) seen.delete(index)
        }
        return
      }
      seen.clear()
      if (rising('toggleActive', pads, held)) setActiveThrottles(!state.activeThrottles)
      apply(pads, dt)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])
}
