import { beforeEach, describe, expect, it, vi } from 'vitest'
const native = vi.hoisted(() => ({
  invoke: vi.fn(),
  events: new Map<string, (event: { payload: unknown }) => void>(),
  drop: vi.fn(),
  convert: vi.fn((path: string, scheme: string) => `${scheme}:${path}`),
}))
vi.mock('@tauri-apps/api/core', () => ({ invoke: native.invoke, convertFileSrc: native.convert }))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async (name, callback) => { native.events.set(name, callback); return () => {} }) }))
vi.mock('@tauri-apps/api/webviewWindow', () => ({ getCurrentWebviewWindow: () => ({ onDragDropEvent: native.drop }) }))
import { createTauriApi } from '../../tauri-api'
import { useAppStore } from '../../store/appStore'

beforeEach(() => { vi.clearAllMocks(); native.events.clear(); native.invoke.mockResolvedValue(undefined); native.drop.mockResolvedValue(() => {}) })
describe('Tauri application boundary', () => {
  it('keeps close requests sent during startup until a live hook subscribes', async () => {
    const api = await createTauriApi()
    native.events.get('lumina:request-close')!({ payload: null })
    const stale = vi.fn()
    api.onRequestClose(stale)()
    const current = vi.fn()
    const unsubscribe = api.onRequestClose(current)
    await Promise.resolve()
    expect(stale).not.toHaveBeenCalled()
    expect(current).toHaveBeenCalledTimes(1)
    unsubscribe()
    api.completeWindowClose(false)
    expect(native.invoke).toHaveBeenCalledWith('complete_window_close', { allowed: false })
    native.events.get('lumina:error')!({ payload: 'Unable to open this file.' })
    expect(useAppStore.getState().toast).toEqual({ message: 'Unable to open this file.', type: 'error' })
  })
  it('converts canonical local image URLs only for display and preserves decoded path characters', async () => {
    const api = await createTauriApi()
    const canonical = 'media://local/C:/notes/%E4%B8%AD%E6%96%87%20%23.png'
    expect(api.displayMediaUrl!(canonical)).toBe('media:C:/notes/中文 #.png')
    expect(native.convert).toHaveBeenCalledWith('C:/notes/中文 #.png', 'media')
    expect(api.displayMediaUrl!('https://example.com/image.png')).toBe('https://example.com/image.png')
  })
})
