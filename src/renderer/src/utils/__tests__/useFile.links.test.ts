import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from 'tiptap-markdown'
import { useFile } from '../../hooks/useFile'
import { useAppStore } from '../../store/appStore'
import { requestLinkNavigation } from '../linkNavigation'

describe('opening linked documents preserves edits in tabs', () => {
  let editor: Editor
  beforeEach(() => {
    vi.clearAllMocks()
    const file = { path: 'C:\\notes\\current.md', content: 'old', isDirty: true, fileType: 'md' as const }
    useAppStore.setState({ file, tabs: [{ ...file, id: 'current', revision: 1, identity: 'current' }], activeTabId: 'current', recentFiles: [], toast: null })
    editor = new Editor({ extensions: [StarterKit, Markdown], content: 'unsaved edits', onUpdate: () => useAppStore.getState().markDirty(true) })
    vi.mocked(window.api.saveFile).mockResolvedValue(true)
    vi.mocked(window.api.inspectFilePath).mockImplementation(async path => ({ path, identity: path.replace(/\\/g, '/').toLowerCase() }))
    vi.mocked(window.api.openFilePath).mockResolvedValue({ path: 'C:\\notes\\next.md', content: '# Next' })
  })
  afterEach(() => { cleanup(); editor.destroy() })

  it('opens a new tab while retaining the source edits and dirty flag', async () => {
    const { result } = renderHook(() => useFile(editor))
    await act(async () => { expect(await result.current.openFilePath('C:\\notes\\next.md')).toBe(true) })
    expect(useAppStore.getState().file.path).toBe('C:\\notes\\next.md')
    expect(useAppStore.getState().tabs.find(tab => tab.id === 'current')?.isDirty).toBe(true)
    act(() => { result.current.selectTab('current') })
    expect(editor.getText()).toBe('unsaved edits')
  })
  it('allows opening a tab even when the source file cannot be saved', async () => {
    vi.mocked(window.api.saveFile).mockResolvedValue(false)
    const { result } = renderHook(() => useFile(editor))
    await act(async () => { expect(await result.current.openFilePath('C:\\notes\\next.md')).toBe(true) })
    act(() => { result.current.selectTab('current') })
    expect(editor.getText()).toBe('unsaved edits')
    expect(useAppStore.getState().file.isDirty).toBe(true)
  })
  it('preserves edits typed while a manual save is pending', async () => {
    let finish!: (ok: boolean) => void
    vi.mocked(window.api.saveFile).mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const { result } = renderHook(() => useFile(editor))
    let pending!: Promise<void>
    act(() => { pending = result.current.saveFile() })
    await waitFor(() => expect(window.api.saveFile).toHaveBeenCalled())
    act(() => { editor.commands.insertContent('newer ') })
    await act(async () => { finish(true); await pending })
    expect(editor.getText()).toContain('newer')
    expect(useAppStore.getState().file.isDirty).toBe(true)
  })
  it('reports missing files and keeps the current document', async () => {
    vi.mocked(window.api.openFilePath).mockResolvedValue(null)
    const { result } = renderHook(() => useFile(editor))
    await act(async () => { expect(await result.current.openFilePath('C:\\notes\\missing.md')).toBe(false) })
    expect(useAppStore.getState().activeTabId).toBe('current')
    expect(useAppStore.getState().toast?.message).toMatch(/exists/)
  })
  it('reuses the same Windows document with different casing or separators', async () => {
    const { result } = renderHook(() => useFile(editor))
    await act(async () => { expect(await result.current.openFilePath('c:/NOTES/current.md')).toBe(true) })
    expect(window.api.openFilePath).not.toHaveBeenCalled()
    expect(editor.getText()).toBe('unsaved edits')
  })
  it('reuses a file alias by identity instead of loading stale disk content', async () => {
    vi.mocked(window.api.inspectFilePath).mockResolvedValue({ path: 'C:\\notes\\alias.md', identity: 'current' })
    const { result } = renderHook(() => useFile(editor))
    await act(async () => { expect(await result.current.openFilePath('C:\\notes\\alias.md')).toBe(true) })
    expect(window.api.openFilePath).not.toHaveBeenCalled()
    expect(editor.getText()).toBe('unsaved edits')
  })
  it('uses the shared navigation event for a Chinese anchor', async () => {
    editor.commands.setContent('# 中文标题')
    const scroll = vi.fn()
    editor.view.dom.firstElementChild!.scrollIntoView = scroll
    vi.mocked(window.api.resolveLink).mockResolvedValue({ target: { kind: 'anchor', anchor: '中文标题' } })
    renderHook(() => useFile(editor))
    act(() => requestLinkNavigation('#%E4%B8%AD%E6%96%87%E6%A0%87%E9%A2%98'))
    await waitFor(() => expect(scroll).toHaveBeenCalled())
  })
})
