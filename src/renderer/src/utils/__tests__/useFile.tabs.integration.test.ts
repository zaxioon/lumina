import { act, renderHook, cleanup, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Image from '@tiptap/extension-image'
import { Markdown } from 'tiptap-markdown'
import { useFile } from '../../hooks/useFile'
import { useAppStore } from '../../store/appStore'

describe('real editor tab lifecycle', () => {
  let editor: Editor
  let requestClose: () => void
  const initial = { path: null, content: '', isDirty: false, fileType: 'md' as const }
  const a = 'C:\\docs\\alpha.md'
  const b = 'C:\\docs\\beta.md'
  const identity = (path: string): string => path.replace(/\\/g, '/').toLowerCase()

  beforeEach(() => {
    vi.clearAllMocks()
    useAppStore.setState({ file: initial, tabs: [{ ...initial, id: 'initial', revision: 0 }], activeTabId: 'initial', recentFiles: [], draft: null, toast: null })
    Object.assign(window.api, {
      inspectFilePath: vi.fn(async (path: string) => ({ path, identity: identity(path) })),
      chooseSavePath: vi.fn().mockResolvedValue(null),
      confirmDocumentClose: vi.fn().mockResolvedValue('cancel'),
      onRequestClose: vi.fn((callback: () => void) => { requestClose = callback; return () => {} }),
      completeWindowClose: vi.fn(),
    })
    vi.mocked(window.api.readInitialFile).mockResolvedValue(null)
    vi.mocked(window.api.saveFile).mockResolvedValue(true)
    vi.mocked(window.api.openFilePath).mockImplementation(async (path) => ({ path, content: path === a ? 'Alpha' : 'Beta' }))
    editor = new Editor({
      extensions: [StarterKit, Markdown, Image],
      content: '',
      onUpdate: () => useAppStore.getState().markDirty(true),
    })
  })
  afterEach(() => { cleanup(); editor.destroy(); vi.useRealTimers() })

  function mount() { return renderHook(() => useFile(editor)) }
  function append(text: string): void {
    editor.commands.insertContentAt(editor.state.doc.content.size - 1, text)
  }
  async function open(api: ReturnType<typeof mount>, path: string): Promise<string> {
    await act(async () => { expect(await api.result.current.openFilePath(path)).toBe(true) })
    return useAppStore.getState().activeTabId
  }

  it('preserves separate content and undo history across tab switches', async () => {
    const api = mount()
    const first = await open(api, a)
    act(() => append(' one'))
    const second = await open(api, b)
    act(() => append(' two'))
    act(() => { api.result.current.selectTab(first) })
    expect(editor.getText()).toBe('Alpha one')
    act(() => { editor.commands.undo() })
    expect(editor.getText()).toBe('Alpha')
    act(() => { api.result.current.selectTab(second) })
    expect(editor.getText()).toBe('Beta two')
    act(() => { editor.commands.undo() })
    expect(editor.getText()).toBe('Beta')
  })

  it('saves edits from an inactive tab without writing the active editor into that file', async () => {
    vi.useFakeTimers()
    const api = mount()
    const first = await open(api, a)
    const second = await open(api, b)
    act(() => { api.result.current.selectTab(first) })
    act(() => append(' background'))
    act(() => { api.result.current.selectTab(second) })
    await act(async () => { await vi.advanceTimersByTimeAsync(2500) })
    expect(window.api.saveFile).toHaveBeenCalledWith(a, 'Alpha background')
    expect(vi.mocked(window.api.saveFile).mock.calls.some(([path, content]) => path === a && content.includes('Beta'))).toBe(false)
    expect(useAppStore.getState().tabs.find(tab => tab.id === first)?.isDirty).toBe(false)
    expect(editor.getText()).toBe('Beta')
  })

  it('keeps dirty tabs and content on close cancellation or save failure', async () => {
    const api = mount()
    const first = await open(api, a)
    act(() => append(' keep me'))
    await act(async () => { await api.result.current.closeTab(first) })
    expect(useAppStore.getState().tabs.some(tab => tab.id === first)).toBe(true)
    vi.mocked(window.api.confirmDocumentClose).mockResolvedValue('save')
    vi.mocked(window.api.saveFile).mockResolvedValue(false)
    await act(async () => { await api.result.current.closeTab(first) })
    expect(useAppStore.getState().tabs.find(tab => tab.id === first)?.isDirty).toBe(true)
    expect(editor.getText()).toBe('Alpha keep me')
  })

  it('rejects Save As to another open tab before any file write', async () => {
    const api = mount()
    await open(api, a)
    await open(api, b)
    act(() => append(' unsaved'))
    vi.mocked(window.api.chooseSavePath).mockResolvedValue({ path: 'c:/DOCS/ALPHA.md' })
    vi.mocked(window.api.saveFile).mockClear()
    await act(async () => { await api.result.current.saveFileAs() })
    expect(window.api.saveFile).not.toHaveBeenCalled()
    expect(useAppStore.getState().file.path).toBe(b)
    expect(useAppStore.getState().file.isDirty).toBe(true)
    expect(editor.getText()).toBe('Beta unsaved')
  })

  it('does not clean newer edits or another tab when an earlier save resolves', async () => {
    const api = mount()
    const first = await open(api, a)
    const second = await open(api, b)
    act(() => { api.result.current.selectTab(first) })
    act(() => append(' first'))
    let finish!: (ok: boolean) => void
    vi.mocked(window.api.saveFile).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    let pending!: Promise<void>
    await act(async () => { pending = api.result.current.saveFile(); await Promise.resolve() })
    act(() => append(' newest'))
    act(() => { api.result.current.selectTab(second) })
    act(() => append(' separate'))
    await act(async () => { finish(true); await pending })
    expect(useAppStore.getState().tabs.find(tab => tab.id === first)?.isDirty).toBe(true)
    expect(useAppStore.getState().tabs.find(tab => tab.id === second)?.isDirty).toBe(true)
    expect(editor.getText()).toBe('Beta separate')
    expect(window.api.saveFile).toHaveBeenCalledWith(a, 'Alpha first')
    act(() => { api.result.current.selectTab(first) })
    expect(editor.getText()).toBe('Alpha first newest')
  })

  it('denies window close if an inactive dirty tab cannot save', async () => {
    const api = mount()
    const first = await open(api, a)
    const second = await open(api, b)
    act(() => { api.result.current.selectTab(first) })
    act(() => append(' retained'))
    act(() => { api.result.current.selectTab(second) })
    vi.mocked(window.api.confirmDocumentClose).mockResolvedValue('save')
    vi.mocked(window.api.saveFile).mockResolvedValue(false)
    await act(async () => { await requestClose() })
    await waitFor(() => expect(window.api.completeWindowClose).toHaveBeenLastCalledWith(false))
    expect(useAppStore.getState().tabs.find(tab => tab.id === first)?.isDirty).toBe(true)
  })

  it('denies window close when Save As is canceled for an untitled tab', async () => {
    const api = mount()
    act(() => { api.result.current.newFile(); append('Untitled content') })
    vi.mocked(window.api.confirmDocumentClose).mockResolvedValue('save')
    await act(async () => { await requestClose() })
    await waitFor(() => expect(window.api.completeWindowClose).toHaveBeenLastCalledWith(false))
    expect(editor.getText()).toBe('Untitled content')
    expect(useAppStore.getState().file.isDirty).toBe(true)
  })

  it('resumes automatic saving after a close dialog outlasts the save timer and is canceled', async () => {
    vi.useFakeTimers()
    const api = mount()
    const first = await open(api, a)
    act(() => append(' delayed'))
    let cancel!: (choice: 'cancel') => void
    vi.mocked(window.api.confirmDocumentClose).mockImplementationOnce(() => new Promise(resolve => { cancel = resolve }))
    let close!: Promise<void>
    await act(async () => { close = api.result.current.closeTab(first); await Promise.resolve() })
    await act(async () => { await vi.advanceTimersByTimeAsync(2200) })
    expect(window.api.saveFile).not.toHaveBeenCalled()
    await act(async () => { cancel('cancel'); await close })
    await act(async () => { await vi.advanceTimersByTimeAsync(2200) })
    expect(window.api.saveFile).toHaveBeenCalledWith(a, 'Alpha delayed')
    expect(useAppStore.getState().tabs.find(tab => tab.id === first)?.isDirty).toBe(false)
  })

  it('does not autosave to the old file after Save As changes a tab destination', async () => {
    vi.useFakeTimers()
    const api = mount()
    await open(api, a)
    act(() => append(' copied'))
    const destination = 'C:\\docs\\copy.md'
    vi.mocked(window.api.chooseSavePath).mockResolvedValue({ path: destination })
    let finish!: (ok: boolean) => void
    vi.mocked(window.api.saveFile).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    let saving!: Promise<void>
    await act(async () => { saving = api.result.current.saveFileAs(); await Promise.resolve() })
    act(() => append(' newer'))
    await act(async () => { await vi.advanceTimersByTimeAsync(2200) })
    await act(async () => { finish(true); await saving })
    await act(async () => { await vi.advanceTimersByTimeAsync(2200) })
    expect(useAppStore.getState().file.path).toBe(destination)
    expect(vi.mocked(window.api.saveFile).mock.calls.some(([path]) => path === a)).toBe(false)
    expect(window.api.saveFile).toHaveBeenCalledWith(destination, 'Alpha copied newer')
  })

  it('applies a delayed Save As result only to its originating tab', async () => {
    const api = mount()
    const first = await open(api, a)
    const second = await open(api, b)
    act(() => { api.result.current.selectTab(first); append(' source') })
    let choose!: (value: { path: string }) => void
    vi.mocked(window.api.chooseSavePath).mockImplementationOnce(() => new Promise(resolve => { choose = resolve }))
    let saving!: Promise<void>
    act(() => { saving = api.result.current.saveFileAs() })
    act(() => { api.result.current.selectTab(second); append(' destination') })
    const copy = 'C:\\docs\\copy.md'
    await act(async () => { choose({ path: copy }); await saving })
    expect(useAppStore.getState().activeTabId).toBe(second)
    expect(useAppStore.getState().file.path).toBe(b)
    expect(editor.getText()).toBe('Beta destination')
    expect(useAppStore.getState().file.isDirty).toBe(true)
    expect(useAppStore.getState().tabs.find(tab => tab.id === first)?.path).toBe(copy)
    expect(window.api.saveFile).toHaveBeenCalledWith(copy, 'Alpha source')
  })

  it('preserves local image targets through cross-folder Save As and background saving', async () => {
    vi.useFakeTimers()
    const api = mount()
    vi.mocked(window.api.openFilePath).mockImplementation(async (path) => ({ path, content: path === a ? '![diagram](images/a.png)\n\nAlpha' : 'Beta' }))
    const first = await open(api, a)
    const second = await open(api, b)
    act(() => { api.result.current.selectTab(first) })
    expect(editor.getHTML()).toContain('media://local/')
    const copy = 'C:\\new\\alpha.md'
    vi.mocked(window.api.chooseSavePath).mockResolvedValue({ path: copy })
    let finish!: (ok: boolean) => void
    vi.mocked(window.api.saveFile).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    let saving!: Promise<void>
    await act(async () => { saving = api.result.current.saveFileAs(); await Promise.resolve() })
    act(() => { append(' newer'); api.result.current.selectTab(second) })
    await act(async () => { finish(true); await saving })
    await act(async () => { await vi.advanceTimersByTimeAsync(2200) })
    act(() => { api.result.current.selectTab(first) })
    expect(editor.getHTML()).toContain('media://local/')
    await act(async () => { await api.result.current.saveFile() })
    const writes = vi.mocked(window.api.saveFile).mock.calls
    expect(writes.length).toBeGreaterThanOrEqual(3)
    for (const [path, content] of writes) {
      expect(path).toBe(copy)
      expect(content).toContain('![diagram](../docs/images/a.png)')
      expect(content).not.toContain('media://')
    }
    expect(writes.at(-1)?.[1]).toContain('Alpha newer')
  })
})
