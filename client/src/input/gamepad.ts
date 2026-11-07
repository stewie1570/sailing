import type { HelmMode } from '../scene/boat/helm'

/** One physical control on a pad: a button, or one end of an axis. */
export interface Binding {
  padId: string
  source: 'button' | 'axis'
  index: number
  /** Axis end that means "do this". +1 is the positive axis value. */
  sign: 1 | -1
}

export interface ActionDef {
  id: ActionId
  label: string
  group: 'Mode' | 'Camera' | 'Steering' | 'Engines' | 'Sails'
}

export const ACTIONS = [
  { id: 'toggleHelm', label: 'Switch engine / sailing', group: 'Mode' },
  { id: 'zoomIn', label: 'Zoom in', group: 'Camera' },
  { id: 'zoomOut', label: 'Zoom out', group: 'Camera' },
  { id: 'lookPort', label: 'Look to port', group: 'Camera' },
  { id: 'lookStbd', label: 'Look to starboard', group: 'Camera' },
  { id: 'lookUp', label: 'Look up', group: 'Camera' },
  { id: 'lookDown', label: 'Look down', group: 'Camera' },
  { id: 'rudderPort', label: 'Rudder to port', group: 'Steering' },
  { id: 'rudderStbd', label: 'Rudder to starboard', group: 'Steering' },
  { id: 'toggleActive', label: 'Toggle active throttles', group: 'Engines' },
  { id: 'portAhead', label: 'Port throttle ahead', group: 'Engines' },
  { id: 'portAstern', label: 'Port throttle astern', group: 'Engines' },
  { id: 'stbdAhead', label: 'Starboard throttle ahead', group: 'Engines' },
  { id: 'stbdAstern', label: 'Starboard throttle astern', group: 'Engines' },
  { id: 'bowPort', label: 'Bow thruster to port', group: 'Engines' },
  { id: 'bowStbd', label: 'Bow thruster to starboard', group: 'Engines' },
  { id: 'sternPort', label: 'Stern thruster to port', group: 'Engines' },
  { id: 'sternStbd', label: 'Stern thruster to starboard', group: 'Engines' },
  { id: 'sheetIn', label: 'Sheet in the main', group: 'Sails' },
  { id: 'sheetOut', label: 'Ease the main', group: 'Sails' },
  { id: 'halyardUp', label: 'Hoist the main', group: 'Sails' },
  { id: 'halyardDown', label: 'Drop the main', group: 'Sails' },
  { id: 'jibOut', label: 'Unfurl the jib', group: 'Sails' },
  { id: 'jibIn', label: 'Furl the jib', group: 'Sails' },
  { id: 'jibPortHaul', label: 'Haul the port jib sheet', group: 'Sails' },
  { id: 'jibPortEase', label: 'Ease the port jib sheet', group: 'Sails' },
  { id: 'jibStbdHaul', label: 'Haul the starboard jib sheet', group: 'Sails' },
  { id: 'jibStbdEase', label: 'Ease the starboard jib sheet', group: 'Sails' },
] as const

export type ActionId = (typeof ACTIONS)[number]['id']

const ACTION_IDS = new Set<string>(ACTIONS.map((action) => action.id))

export function isActionId(value: string): value is ActionId {
  return ACTION_IDS.has(value)
}

/** Shared controls run in both modes. Engine and sailing controls each have their own binding. */
export type BindingScope = 'shared' | HelmMode

export function scopeOf(id: ActionId): BindingScope {
  const group = ACTIONS.find((action) => action.id === id)!.group
  if (group === 'Engines') return 'engine'
  if (group === 'Sails') return 'sailing'
  return 'shared'
}

/** Functions to program for one mode. Shared rows are in both lists. */
export function actionsFor(mode: HelmMode) {
  return ACTIONS.filter((action) => {
    const scope = scopeOf(action.id)
    return scope === 'shared' || scope === mode
  })
}

/** Stick travel inside this is "let go". Past it, the amount is how hard it is pushed. */
export const DEADZONE = 0.18
/** How far a stick must move before the setup screen accepts it. */
export const CAPTURE_THRESHOLD = 0.62

export interface PadSample {
  id: string
  index: number
  buttons: number[]
  axes: number[]
}

export function deflection(raw: number, sign: 1 | -1, dead = DEADZONE) {
  const pressed = raw * sign
  if (pressed <= dead) return 0
  return Math.min(1, (pressed - dead) / (1 - dead))
}

/** Full lever position from a stick, −1 to +1, with a small stop at the centre. */
export function axisLever(raw: number, sign: 1 | -1) {
  const pressed = raw * sign
  const dead = 0.12
  const mag = Math.abs(pressed)
  if (mag <= dead) return 0
  const shaped = Math.min(1, (mag - dead) / (1 - dead))
  return Math.sign(pressed) * shaped
}

export function bindingValue(binding: Binding, pad: PadSample) {
  if (binding.source === 'button') return deflection(pad.buttons[binding.index] ?? 0, 1, 0.08)
  return deflection(pad.axes[binding.index] ?? 0, binding.sign)
}

/**
 * Nudge a lever and leave it. `input` is −1..1; its size is how fast the lever moves.
 * Zero input, which is a released stick, does not pull the lever back.
 */
export function rateStep(value: number, input: number, rate: number, dt: number, min: number, max: number) {
  if (input === 0 || !(dt > 0)) return value
  return Math.min(max, Math.max(min, value + input * rate * dt))
}

/** Catch state for a rate-driven lever with a centre stop. */
export interface CenterNotch {
  /** True while the lever is pinned at 0 and the stick has not pushed clear. */
  held: boolean
  /** Signed stick travel commanded since the lever snapped to centre. */
  travel: number
}

/**
 * Rate-step a lever that has the pointer's stop notch.
 * Letting go inside `release` sits at 0. Driving into `grab` catches there,
 * and the stick has to travel past `release` before the lever leaves, so a
 * resting "off" cannot keep a fraction of power. Thrust then builds from the
 * overshoot rather than jumping across the notch: a stick has no absolute
 * position for the lever to catch up to.
 */
export function notchStep(
  value: number,
  input: number,
  rate: number,
  dt: number,
  notch: CenterNotch,
  grab: number,
  release: number,
  min = -1,
  max = 1,
) {
  const clamp = (v: number) => Math.min(max, Math.max(min, v))
  if (!(dt > 0)) return value
  if (input === 0) {
    notch.held = false
    notch.travel = 0
    return Math.abs(value) <= release ? 0 : value
  }
  if (notch.held) {
    notch.travel = clamp(notch.travel + input * rate * dt)
    if (Math.abs(notch.travel) <= release) return 0
    const next = clamp(notch.travel - Math.sign(notch.travel) * release)
    notch.held = false
    notch.travel = 0
    return next
  }
  const next = clamp(value + input * rate * dt)
  const towardCenter = value !== 0 && Math.sign(input) !== Math.sign(value)
  const crossed = value !== 0 && next !== 0 && Math.sign(value) !== Math.sign(next)
  if (crossed || (towardCenter && Math.abs(next) <= grab)) {
    notch.held = true
    notch.travel = 0
    return 0
  }
  return next
}

export function sameBinding(a: Binding, b: Binding) {
  return a.padId === b.padId && a.source === b.source && a.index === b.index && a.sign === b.sign
}

export function isBinding(value: unknown): value is Binding {
  if (!value || typeof value !== 'object') return false
  const binding = value as Partial<Binding>
  return typeof binding.padId === 'string'
    && (binding.source === 'button' || binding.source === 'axis')
    && typeof binding.index === 'number'
    && Number.isInteger(binding.index)
    && binding.index >= 0
    && (binding.sign === 1 || binding.sign === -1)
}

/**
 * A new press since the previous sample. A stick that is already held does not count,
 * so advancing to the next function does not immediately bind the same push.
 */
export function captureInput(prev: PadSample | null, next: PadSample): Binding | null {
  if (!prev || prev.id !== next.id) return null
  let best: { mag: number; binding: Binding } | null = null
  const buttons = Math.max(prev.buttons.length, next.buttons.length)
  for (let index = 0; index < buttons; index++) {
    const before = prev.buttons[index] ?? 0
    const after = next.buttons[index] ?? 0
    if (before < 0.5 && after >= 0.5 && (!best || after > best.mag)) {
      best = { mag: after, binding: { padId: next.id, source: 'button', index, sign: 1 } }
    }
  }
  const axes = Math.max(prev.axes.length, next.axes.length)
  for (let index = 0; index < axes; index++) {
    const before = prev.axes[index] ?? 0
    const after = next.axes[index] ?? 0
    let sign: 1 | -1 | null = null
    if (after >= CAPTURE_THRESHOLD && before < CAPTURE_THRESHOLD) sign = 1
    else if (after <= -CAPTURE_THRESHOLD && before > -CAPTURE_THRESHOLD) sign = -1
    const mag = Math.abs(after)
    if (sign && (!best || mag > best.mag)) {
      best = { mag, binding: { padId: next.id, source: 'axis', index, sign } }
    }
  }
  return best?.binding ?? null
}

const STANDARD_BUTTONS = [
  'A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'Back', 'Start', 'L3', 'R3',
  'D-pad up', 'D-pad down', 'D-pad left', 'D-pad right',
]

const STANDARD_AXES: Record<string, string> = {
  '0:1': 'Left stick right',
  '0:-1': 'Left stick left',
  '1:-1': 'Left stick up',
  '1:1': 'Left stick down',
  '2:1': 'Right stick right',
  '2:-1': 'Right stick left',
  '3:-1': 'Right stick up',
  '3:1': 'Right stick down',
}

export function bindingLabel(binding: Binding) {
  if (binding.source === 'button') return STANDARD_BUTTONS[binding.index] ?? `Button ${binding.index}`
  return STANDARD_AXES[`${binding.index}:${binding.sign}`] ?? `Axis ${binding.index} ${binding.sign > 0 ? '+' : '−'}`
}

export function shortPadName(id: string) {
  const name = id.split('(')[0]?.trim()
  return name || 'Controller'
}

export function padFor(binding: Binding, pads: readonly PadSample[]) {
  return pads.find((pad) => pad.id === binding.padId) ?? null
}
