import {
  sameBinding,
  type ActionId,
  type Binding,
} from './gamepad'

/**
 * Default control maps for pads the browser exposes as a standard gamepad.
 * The standard mapping puts the same physical control on the same index for
 * an Xbox pad, a DualSense, and a Switch Pro Controller, so one assignment
 * fits all of them. The layout only changes the names printed on the buttons.
 * A pad that does not report that mapping is left alone: its indexes may not
 * mean these positions, and the sailor can still pick a layout or assign rows.
 */

export const LAYOUT_IDS = ['xbox', 'playstation', 'nintendo', 'standard'] as const

export type LayoutId = (typeof LAYOUT_IDS)[number]

/** `auto` follows the connected pad. `custom` is a map the sailor edited. */
export type LayoutChoice = 'auto' | 'custom' | LayoutId

export interface LayoutBindings {
  shared: Partial<Record<ActionId, Binding>>
  engine: Partial<Record<ActionId, Binding>>
  sailing: Partial<Record<ActionId, Binding>>
}

interface ControlAssignment {
  source: 'button' | 'axis'
  index: number
  sign: 1 | -1
}

type AssignmentMap = Partial<Record<ActionId, ControlAssignment>>

interface AssignmentSets {
  shared: AssignmentMap
  engine: AssignmentMap
  sailing: AssignmentMap
}

const button = (index: number): ControlAssignment => ({ source: 'button', index, sign: 1 })
const axis = (index: number, sign: 1 | -1): ControlAssignment => ({ source: 'axis', index, sign })

/**
 * Left stick steers, and its vertical axis is the port lever (or the port sheet).
 * Right stick vertical is the starboard lever (or the starboard sheet); sideways furls the spinnaker.
 * Bottom face button toggles active throttles, or sheets the main in. Top face button eases the main.
 * Left face button zooms in, right zooms out. Bumpers furl the jib, triggers hoist the main.
 * Start switches engine and sailing. The d-pad looks around.
 */
const STANDARD_ASSIGNMENTS = {
  shared: {
    toggleHelm: button(9),
    zoomIn: button(2),
    zoomOut: button(1),
    lookPort: button(14),
    lookStbd: button(15),
    lookUp: button(12),
    lookDown: button(13),
    rudderPort: axis(0, -1),
    rudderStbd: axis(0, 1),
  },
  engine: {
    portAhead: axis(1, -1),
    portAstern: axis(1, 1),
    stbdAhead: axis(3, -1),
    stbdAstern: axis(3, 1),
    toggleActive: button(0),
  },
  sailing: {
    sheetIn: button(0),
    sheetOut: button(3),
    jibPortHaul: axis(1, 1),
    jibPortEase: axis(1, -1),
    jibStbdHaul: axis(3, 1),
    jibStbdEase: axis(3, -1),
    halyardUp: button(7),
    halyardDown: button(6),
    jibOut: button(5),
    jibIn: button(4),
    spinOut: axis(2, 1),
    spinIn: axis(2, -1),
  },
} satisfies AssignmentSets

const ASSIGNMENTS: Record<LayoutId, AssignmentSets> = {
  xbox: STANDARD_ASSIGNMENTS,
  playstation: STANDARD_ASSIGNMENTS,
  nintendo: STANDARD_ASSIGNMENTS,
  standard: STANDARD_ASSIGNMENTS,
}

const XBOX_BUTTONS = [
  'A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'Back', 'Start', 'L3', 'R3',
  'D-pad up', 'D-pad down', 'D-pad left', 'D-pad right',
]

const PLAYSTATION_BUTTONS = [
  'Cross', 'Circle', 'Square', 'Triangle', 'L1', 'R1', 'L2', 'R2', 'Share', 'Options', 'L3', 'R3',
  'D-pad up', 'D-pad down', 'D-pad left', 'D-pad right',
]

const NINTENDO_BUTTONS = [
  'B', 'A', 'Y', 'X', 'L', 'R', 'ZL', 'ZR', 'Minus', 'Plus', 'LS', 'RS',
  'D-pad up', 'D-pad down', 'D-pad left', 'D-pad right',
]

const STANDARD_BUTTONS = [
  'Bottom button', 'Right button', 'Left button', 'Top button',
  'Left bumper', 'Right bumper', 'Left trigger', 'Right trigger',
  'Back', 'Start', 'Left stick click', 'Right stick click',
  'D-pad up', 'D-pad down', 'D-pad left', 'D-pad right',
]

const AXIS_LABELS: Record<string, string> = {
  '0:1': 'Left stick right',
  '0:-1': 'Left stick left',
  '1:-1': 'Left stick up',
  '1:1': 'Left stick down',
  '2:1': 'Right stick right',
  '2:-1': 'Right stick left',
  '3:-1': 'Right stick up',
  '3:1': 'Right stick down',
}

export const LAYOUTS: readonly { id: LayoutId; name: string; buttons: readonly string[] }[] = [
  { id: 'xbox', name: 'Xbox', buttons: XBOX_BUTTONS },
  { id: 'playstation', name: 'PlayStation', buttons: PLAYSTATION_BUTTONS },
  { id: 'nintendo', name: 'Nintendo', buttons: NINTENDO_BUTTONS },
  { id: 'standard', name: 'Standard', buttons: STANDARD_BUTTONS },
]

export function isLayoutId(value: unknown): value is LayoutId {
  return typeof value === 'string' && (LAYOUT_IDS as readonly string[]).includes(value)
}

export function layoutName(id: LayoutId) {
  for (const layout of LAYOUTS) {
    if (layout.id === id) return layout.name
  }
  return id
}

export function layoutButtons(id: LayoutId) {
  for (const layout of LAYOUTS) {
    if (layout.id === id) return layout.buttons
  }
  return XBOX_BUTTONS
}

/** Saved when a layout is chosen before any pad is connected. */
export function presetPadId(layout: LayoutId) {
  return `preset:${layout}`
}

export function bindingLabel(binding: Binding, buttons?: readonly string[]) {
  if (binding.source === 'button') {
    const names = buttons ?? XBOX_BUTTONS
    return names[binding.index] ?? `Button ${binding.index}`
  }
  return AXIS_LABELS[`${binding.index}:${binding.sign}`] ?? `Axis ${binding.index} ${binding.sign > 0 ? '+' : '−'}`
}

const XBOX_ID = /xbox|xinput|x-box|045e|microsoft/
const PLAYSTATION_ID = /playstation|dualshock|dualsense|054c|sony/
const NINTENDO_ID = /nintendo|057e|joy-con|joycon|switch pro|pro controller/

function familyFromId(id: string): LayoutId | null {
  const text = id.toLowerCase()
  if (XBOX_ID.test(text)) return 'xbox'
  if (PLAYSTATION_ID.test(text)) return 'playstation'
  if (NINTENDO_ID.test(text)) return 'nintendo'
  // DualShock pads often report this product name and no brand.
  if (text.includes('wireless controller')) return 'playstation'
  return null
}

function presetLayout(padId: string): LayoutId | null {
  if (!padId.startsWith('preset:')) return null
  const id = padId.slice('preset:'.length)
  return isLayoutId(id) ? id : null
}

/** True when the browser says this pad uses the standard button order. */
export function isStandardPad(pad: { id: string; mapping: string }) {
  return pad.mapping === 'standard' || /standard gamepad/i.test(pad.id)
}

export function detectLayout(pad: { id: string; mapping: string }): LayoutId | null {
  if (!isStandardPad(pad)) return null
  return familyFromId(pad.id) ?? 'standard'
}

export function choosePad<T extends { id: string; index: number; mapping: string }>(pads: readonly T[]): T | null {
  let best: T | null = null
  for (const pad of pads) {
    if (!detectLayout(pad)) continue
    if (!best || pad.index < best.index) best = pad
  }
  return best
}

export function detectedLayout(pads: readonly { id: string; index: number; mapping: string }[]): LayoutId | null {
  const pad = choosePad(pads)
  return pad ? detectLayout(pad) : null
}

export function padForLayout<T extends { id: string; index: number; mapping: string }>(layout: LayoutId, pads: readonly T[]): T | null {
  for (const pad of pads) {
    if (detectLayout(pad) === layout) return pad
  }
  for (const pad of pads) {
    if (isStandardPad(pad)) return pad
  }
  return pads[0] ?? null
}

function stamp(source: AssignmentSets, padId: string): LayoutBindings {
  const bind = (scope: AssignmentMap) => {
    const out: Partial<Record<ActionId, Binding>> = {}
    for (const [id, control] of Object.entries(scope) as [ActionId, ControlAssignment][]) {
      out[id] = { padId, source: control.source, index: control.index, sign: control.sign }
    }
    return out
  }
  return { shared: bind(source.shared), engine: bind(source.engine), sailing: bind(source.sailing) }
}

export function bindingsFor(layout: LayoutId, padId: string): LayoutBindings {
  return stamp(ASSIGNMENTS[layout], padId)
}

export function autoBindings(pads: readonly { id: string; index: number; mapping: string }[]): LayoutBindings | null {
  const pad = choosePad(pads)
  if (!pad) return null
  const layout = detectLayout(pad)
  if (!layout) return null
  return bindingsFor(layout, pad.id)
}

function listed(bindings: LayoutBindings) {
  return (['shared', 'engine', 'sailing'] as const).flatMap((scope) =>
    (Object.entries(bindings[scope]) as [ActionId, Binding][]).map(([id, binding]) => ({ scope, id, binding })),
  )
}

export function sameBindingSets(a: LayoutBindings, b: LayoutBindings) {
  const left = listed(a)
  const right = listed(b)
  if (left.length !== right.length) return false
  return left.every((item) => {
    const other = b[item.scope][item.id]
    return other != null && sameBinding(item.binding, other)
  })
}

function sameControls(a: LayoutBindings, b: LayoutBindings) {
  const left = listed(a)
  const right = listed(b)
  if (left.length !== right.length) return false
  return left.every((item) => {
    const other = b[item.scope][item.id]
    return other != null
      && other.source === item.binding.source
      && other.index === item.binding.index
      && other.sign === item.binding.sign
  })
}

function hasAssignment(bindings: LayoutBindings) {
  return listed(bindings).length > 0
}

/**
 * A save from before layouts had no `layout` field. Rows the sailor already
 * assigned stay theirs. An empty map follows whatever pad is connected.
 */
export function layoutFromSaved(layout: unknown, bindings: LayoutBindings): LayoutChoice {
  if (layout === 'auto' || layout === 'custom' || isLayoutId(layout)) return layout
  return hasAssignment(bindings) ? 'custom' : 'auto'
}

/** Point a chosen layout at a pad that is plugged in now, when it still matches that layout. */
export function retargetLayout(
  layout: LayoutId,
  bindings: LayoutBindings,
  pads: readonly { id: string; index: number; mapping: string }[],
): LayoutBindings | null {
  const live = new Set(pads.map((pad) => pad.id))
  const used = new Set(listed(bindings).map((item) => item.binding.padId))
  if (used.size === 0) return null
  let aimed = true
  for (const id of used) {
    if (!live.has(id)) aimed = false
  }
  if (aimed) return null
  const match = pads.find((pad) => detectLayout(pad) === layout) ?? (pads.length === 1 ? pads[0] : null)
  if (!match) return null
  const stamped = bindingsFor(layout, match.id)
  if (!sameControls(bindings, stamped)) return null
  return stamped
}

type PadLike = { id: string; index: number; mapping: string }

/** Button names for the layout on screen, so a DualSense row says Cross rather than A. */
export function labelsFor(layout: LayoutChoice, pads: readonly PadLike[], binding?: Binding) {
  if (isLayoutId(layout)) return layoutButtons(layout)
  if (layout === 'auto') {
    const detected = detectedLayout(pads)
    return detected ? layoutButtons(detected) : undefined
  }
  const preset = binding ? presetLayout(binding.padId) : null
  if (preset) return layoutButtons(preset)
  if (binding) {
    const family = familyFromId(binding.padId)
    if (family) return layoutButtons(family)
    const connected = pads.find((pad) => pad.id === binding.padId)
    const detected = connected ? detectLayout(connected) : null
    if (detected) return layoutButtons(detected)
    if (isStandardPad({ id: binding.padId, mapping: '' })) return layoutButtons('standard')
  }
  const fallback = detectedLayout(pads)
  return fallback ? layoutButtons(fallback) : undefined
}
