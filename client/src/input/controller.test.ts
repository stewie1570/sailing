import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PadSample } from './gamepad'

const XBOX_ID = 'Xbox 360 Controller (XInput STANDARD GAMEPAD)'
const memory = new Map<string, string>()

function storage() {
  return {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => {
      memory.set(key, value)
    },
    removeItem: (key: string) => {
      memory.delete(key)
    },
    clear: () => memory.clear(),
    key: (index: number) => [...memory.keys()][index] ?? null,
    get length() {
      return memory.size
    },
  }
}

function pad(id: string, index = 0, mapping = 'standard'): PadSample {
  return { id, index, mapping, buttons: [], axes: [] }
}

async function load() {
  vi.resetModules()
  return import('./controller')
}

beforeEach(() => {
  memory.clear()
  vi.stubGlobal('localStorage', storage())
})

describe('controller defaults', () => {
  it('applies the connected pad when nothing has been assigned', async () => {
    const api = await load()
    api.setConnectedPads([
      pad('Generic USB Joystick', 0, ''),
      pad('Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 09cc)', 2),
      pad(XBOX_ID, 1),
    ])
    const state = api.getController()
    expect(state.layout).toBe('auto')
    expect(state.helmMode).toBe('engine')
    expect(state.activeThrottles).toBe(true)
    expect(state.bindings.shared.toggleHelm).toEqual({ padId: XBOX_ID, source: 'button', index: 9, sign: 1 })
    expect(state.bindings.sailing.sheetIn).toEqual({ padId: XBOX_ID, source: 'button', index: 0, sign: 1 })
    const stored = JSON.parse(memory.get('sailing.controller') ?? '{}') as { layout?: string; throttlesSet?: boolean }
    expect(stored.layout).toBe('auto')
    expect(stored.throttlesSet).toBeUndefined()
  })

  it('leaves a pad alone when the browser has not remapped it', async () => {
    const api = await load()
    api.setConnectedPads([pad('Xbox 360 Controller', 0, '')])
    expect(api.getController().bindings.shared.toggleHelm).toBeUndefined()
    expect(api.getController().activeThrottles).toBe(false)
    expect(api.getController().layout).toBe('auto')
  })

  it('keeps a map that was saved before layouts existed', async () => {
    memory.set('sailing.controller', JSON.stringify({
      activeThrottles: true,
      helmMode: 'sailing',
      bindings: {
        shared: { toggleHelm: { padId: XBOX_ID, source: 'button', index: 9, sign: 1 } },
        engine: {},
        sailing: {},
      },
    }))
    const api = await load()
    api.setConnectedPads([pad(XBOX_ID)])
    const state = api.getController()
    expect(state.layout).toBe('custom')
    expect(state.helmMode).toBe('sailing')
    expect(state.activeThrottles).toBe(true)
    expect(state.bindings.shared.toggleHelm?.index).toBe(9)
    expect(state.bindings.shared.rudderPort).toBeUndefined()
  })

  it('does not turn active throttles back on after they were switched off', async () => {
    const api = await load()
    api.setConnectedPads([pad(XBOX_ID)])
    api.setActiveThrottles(false)
    const dualsense = 'DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)'
    api.setConnectedPads([pad(dualsense)])
    expect(api.getController().activeThrottles).toBe(false)
    expect(api.getController().layout).toBe('auto')
    expect(api.getController().bindings.shared.toggleHelm?.padId).toBe(dualsense)
    expect(JSON.parse(memory.get('sailing.controller') ?? '{}').throttlesSet).toBe(true)

    const again = await load()
    again.setConnectedPads([pad(XBOX_ID)])
    expect(again.getController().activeThrottles).toBe(false)
    expect(again.getController().bindings.shared.rudderStbd?.padId).toBe(XBOX_ID)
  })

  it('lets a sailor pick a layout, edit one row, and come back to the connected pad', async () => {
    const api = await load()
    api.setHelmMode('sailing')
    api.applyLayout('nintendo')
    expect(api.getController().layout).toBe('nintendo')
    expect(api.getController().helmMode).toBe('sailing')
    expect(api.getController().activeThrottles).toBe(true)
    expect(api.getController().bindings.engine.toggleActive).toEqual({
      padId: 'preset:nintendo',
      source: 'button',
      index: 0,
      sign: 1,
    })

    const pro = 'Pro Controller (STANDARD GAMEPAD Vendor: 057e Product: 2009)'
    api.setConnectedPads([pad(pro)])
    expect(api.getController().layout).toBe('nintendo')
    expect(api.getController().bindings.engine.toggleActive?.padId).toBe(pro)

    api.bindAction('zoomIn', { padId: pro, source: 'button', index: 8, sign: 1 })
    expect(api.getController().layout).toBe('custom')
    api.setConnectedPads([pad(XBOX_ID)])
    expect(api.getController().bindings.shared.zoomIn?.index).toBe(8)
    expect(api.getController().layout).toBe('custom')

    api.followConnectedController()
    expect(api.getController().layout).toBe('auto')
    expect(api.getController().bindings.shared.zoomIn).toEqual({ padId: XBOX_ID, source: 'button', index: 2, sign: 1 })
    expect(api.getController().helmMode).toBe('sailing')
  })

  it('clearing one row keeps the rest and stops following the pad', async () => {
    const api = await load()
    api.setConnectedPads([pad('Logitech Gamepad F310 (STANDARD GAMEPAD Vendor: 046d Product: c21d)')])
    expect(api.getController().bindings.sailing.jibIn?.index).toBe(4)
    api.clearBinding('zoomIn')
    expect(api.getController().layout).toBe('custom')
    expect(api.getController().bindings.shared.zoomIn).toBeUndefined()
    expect(api.getController().bindings.shared.zoomOut?.index).toBe(1)
    api.setConnectedPads([pad(XBOX_ID)])
    expect(api.getController().bindings.shared.zoomOut?.padId).toContain('Logitech')
  })
})
