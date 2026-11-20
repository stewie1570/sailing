import { describe, expect, it } from 'vitest'
import { ACTIONS, scopeOf, type Binding } from './gamepad'
import {
  autoBindings,
  bindingLabel,
  bindingsFor,
  choosePad,
  detectLayout,
  labelsFor,
  layoutButtons,
  layoutFromSaved,
  retargetLayout,
  type LayoutBindings,
} from './layouts'

const XBOX_ID = 'Xbox 360 Controller (XInput STANDARD GAMEPAD)'

function control(source: Binding['source'], index: number, sign: 1 | -1, padId = XBOX_ID): Binding {
  return { padId, source, index, sign }
}

function withoutPad(bindings: LayoutBindings): LayoutBindings {
  const next: LayoutBindings = { shared: {}, engine: {}, sailing: {} }
  for (const scope of ['shared', 'engine', 'sailing'] as const) {
    for (const [id, binding] of Object.entries(bindings[scope]) as [keyof LayoutBindings['shared'], Binding][]) {
      if (!binding) continue
      next[scope][id] = { ...binding, padId: '' }
    }
  }
  return next
}

describe('standard controller layouts', () => {
  it('uses the saved Xbox map on every standard pad', () => {
    const map = bindingsFor('xbox', XBOX_ID)
    expect(map.shared.toggleHelm).toEqual(control('button', 9, 1))
    expect(map.shared.zoomIn).toEqual(control('button', 2, 1))
    expect(map.shared.zoomOut).toEqual(control('button', 1, 1))
    expect(map.shared.lookPort).toEqual(control('button', 14, 1))
    expect(map.shared.lookStbd).toEqual(control('button', 15, 1))
    expect(map.shared.lookUp).toEqual(control('button', 12, 1))
    expect(map.shared.lookDown).toEqual(control('button', 13, 1))
    expect(map.shared.rudderPort).toEqual(control('axis', 0, -1))
    expect(map.shared.rudderStbd).toEqual(control('axis', 0, 1))
    expect(map.engine.portAhead).toEqual(control('axis', 1, -1))
    expect(map.engine.portAstern).toEqual(control('axis', 1, 1))
    expect(map.engine.stbdAhead).toEqual(control('axis', 3, -1))
    expect(map.engine.stbdAstern).toEqual(control('axis', 3, 1))
    expect(map.engine.toggleActive).toEqual(control('button', 0, 1))
    expect(map.sailing.sheetIn).toEqual(control('button', 0, 1))
    expect(map.sailing.sheetOut).toEqual(control('button', 3, 1))
    expect(map.sailing.jibPortHaul).toEqual(control('axis', 1, 1))
    expect(map.sailing.jibPortEase).toEqual(control('axis', 1, -1))
    expect(map.sailing.jibStbdHaul).toEqual(control('axis', 3, 1))
    expect(map.sailing.jibStbdEase).toEqual(control('axis', 3, -1))
    expect(map.sailing.halyardUp).toEqual(control('button', 7, 1))
    expect(map.sailing.halyardDown).toEqual(control('button', 6, 1))
    expect(map.sailing.jibOut).toEqual(control('button', 5, 1))
    expect(map.sailing.jibIn).toEqual(control('button', 4, 1))
    expect(map.sailing.spinOut).toEqual(control('axis', 2, 1))
    expect(map.sailing.spinIn).toEqual(control('axis', 2, -1))

    for (const action of ACTIONS) {
      expect(map[scopeOf(action.id)][action.id], action.id).toBeTruthy()
    }
    expect(withoutPad(bindingsFor('playstation', 'pad'))).toEqual(withoutPad(map))
    expect(withoutPad(bindingsFor('nintendo', 'pad'))).toEqual(withoutPad(map))
    expect(withoutPad(bindingsFor('standard', 'pad'))).toEqual(withoutPad(map))
  })

  it('names the face buttons the way that pad prints them', () => {
    const sheet = bindingsFor('xbox', XBOX_ID).sailing.sheetIn!
    expect(bindingLabel(sheet)).toBe('A')
    expect(bindingLabel(sheet, layoutButtons('playstation'))).toBe('Cross')
    expect(bindingLabel(sheet, layoutButtons('nintendo'))).toBe('B')
    expect(bindingLabel(sheet, layoutButtons('standard'))).toBe('Bottom button')
    expect(bindingLabel(bindingsFor('xbox', XBOX_ID).shared.rudderPort!)).toBe('Left stick left')
    expect(bindingLabel(bindingsFor('xbox', XBOX_ID).shared.toggleHelm!)).toBe('Start')
    expect(bindingLabel(bindingsFor('playstation', 'pad').shared.toggleHelm!, layoutButtons('playstation'))).toBe('Options')
  })

  it('detects a standard pad from the browser id', () => {
    expect(detectLayout({ id: XBOX_ID, mapping: 'standard' })).toBe('xbox')
    expect(detectLayout({ id: XBOX_ID, mapping: '' })).toBe('xbox')
    expect(detectLayout({ id: 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)', mapping: 'standard' })).toBe('xbox')
    expect(detectLayout({ id: '045e-02ea-Microsoft X-Box One pad', mapping: 'standard' })).toBe('xbox')
    expect(detectLayout({ id: 'DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)', mapping: 'standard' })).toBe('playstation')
    expect(detectLayout({ id: '054c-09cc-Wireless Controller', mapping: 'standard' })).toBe('playstation')
    expect(detectLayout({ id: 'Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 09cc)', mapping: '' })).toBe('playstation')
    expect(detectLayout({ id: 'Pro Controller (STANDARD GAMEPAD Vendor: 057e Product: 2009)', mapping: 'standard' })).toBe('nintendo')
    expect(detectLayout({ id: '057e-2009-Pro Controller', mapping: 'standard' })).toBe('nintendo')
    expect(detectLayout({ id: 'Logitech Gamepad F310 (STANDARD GAMEPAD Vendor: 046d Product: c21d)', mapping: 'standard' })).toBe('standard')
    expect(detectLayout({ id: 'Generic USB Joystick', mapping: '' })).toBeNull()
    expect(detectLayout({ id: 'Xbox 360 Controller', mapping: '' })).toBeNull()
  })

  it('picks the lowest-index standard pad', () => {
    const pads = [
      { id: 'Generic USB Joystick', index: 0, mapping: '' },
      { id: 'Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 09cc)', index: 2, mapping: 'standard' },
      { id: XBOX_ID, index: 1, mapping: 'standard' },
    ]
    expect(choosePad(pads)?.id).toBe(XBOX_ID)
    expect(autoBindings(pads)?.shared.toggleHelm?.padId).toBe(XBOX_ID)
    expect(autoBindings([{ id: 'Generic USB Joystick', index: 0, mapping: '' }])).toBeNull()
  })

  it('keeps an older hand-made map and follows an empty one', () => {
    const empty: LayoutBindings = { shared: {}, engine: {}, sailing: {} }
    const made: LayoutBindings = {
      shared: { zoomIn: control('button', 4, 1) },
      engine: {},
      sailing: {},
    }
    expect(layoutFromSaved(undefined, empty)).toBe('auto')
    expect(layoutFromSaved(undefined, made)).toBe('custom')
    expect(layoutFromSaved('auto', made)).toBe('auto')
    expect(layoutFromSaved('playstation', empty)).toBe('playstation')
    expect(layoutFromSaved('nope', empty)).toBe('auto')
    expect(layoutFromSaved('custom', empty)).toBe('custom')
  })

  it('moves a chosen layout onto the pad that is plugged in', () => {
    const pinned = bindingsFor('nintendo', 'preset:nintendo')
    const gone = retargetLayout('nintendo', pinned, [])
    expect(gone).toBeNull()
    const pad = { id: 'Pro Controller (STANDARD GAMEPAD Vendor: 057e Product: 2009)', index: 0, mapping: 'standard' }
    const moved = retargetLayout('nintendo', pinned, [pad])
    expect(moved?.engine.toggleActive?.padId).toBe(pad.id)
    expect(moved?.engine.toggleActive?.index).toBe(0)
    expect(retargetLayout('nintendo', moved!, [pad])).toBeNull()

    const edited: LayoutBindings = {
      ...pinned,
      shared: { ...pinned.shared, zoomIn: control('button', 8, 1, 'preset:nintendo') },
    }
    expect(retargetLayout('nintendo', edited, [pad])).toBeNull()
  })

  it('labels a row from the layout, or from the pad that row was bound on', () => {
    const pads = [{ id: 'DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)', index: 0, mapping: 'standard' }]
    const binding = bindingsFor('playstation', pads[0].id).sailing.sheetIn!
    expect(labelsFor('auto', pads, binding)).toEqual(layoutButtons('playstation'))
    expect(labelsFor('custom', [], { ...binding, padId: XBOX_ID })).toEqual(layoutButtons('xbox'))
    expect(labelsFor('custom', pads, { ...binding, padId: 'Logitech Gamepad F310 (STANDARD GAMEPAD Vendor: 046d Product: c21d)' })).toEqual(layoutButtons('standard'))
    expect(labelsFor('nintendo', pads)).toEqual(layoutButtons('nintendo'))
  })
})
