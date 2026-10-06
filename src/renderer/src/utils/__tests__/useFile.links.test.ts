import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Editor } from '@tiptap/react'
import { useFile } from '../../hooks/useFile'
import { useAppStore } from '../../store/appStore'
import { requestLinkNavigation } from '../linkNavigation'

describe('opening linked documents preserves edits', () => {
  let markdown: string
  let editor: Editor
  beforeEach(() => {
    vi.clearAllMocks()
    markdown = 'unsaved edits'
    editor = {
      storage: { markdown: { getMarkdown: () => markdown } },
      commands: { setContent: vi.fn((value: string) => { markdown = value }) },
      view: { dom: document.createElement('div') },
    } as unknown as Editor
    useAppStore.setState({ file: { path: 'C:\\notes\\current.md', content: 'old', isDirty: true, fileType: 'md' }, recentFiles: [], toast: null })
    vi.mocked(window.api.saveFile).mockResolvedValue(true)
    vi.mocked(window.api.openFilePath).mockResolvedValue({ path: 'C:\\notes\\next.md', content: '# Next' })
  })
  it('waits for the current file to be saved before replacing content', async () => {
    let finishSave!: (ok: boolean) => void
    vi.mocked(window.api.saveFile).mockImplementation(() => new Promise(resolve => { finishSave = resolve }))
    const { result, unmount } = renderHook(() => useFile(editor))
    let opening!: Promise<boolean>
    act(() => { opening = result.current.openFilePath('C:\\notes\\next.md') })
    await waitFor(() => expect(window.api.saveFile).toHaveBeenCalledWith('C:\\notes\\current.md', 'unsaved edits'))
    expect(editor.commands.setContent).not.toHaveBeenCalled()
    await act(async () => { finishSave(true); expect(await opening).toBe(true) })
    expect(useAppStore.getState().file.path).toBe('C:\\notes\\next.md')
    unmount()
  })
  it('keeps the current document when saving fails', async () => {
    vi.mocked(window.api.saveFile).mockResolvedValue(false)
    const { result, unmount } = renderHook(() => useFile(editor))
    await act(async () => { expect(await result.current.openFilePath('next.md')).toBe(false) })
    expect(useAppStore.getState().file.path).toBe('C:\\notes\\current.md')
    expect(editor.commands.setContent).not.toHaveBeenCalled()
    expect(useAppStore.getState().toast?.message).toMatch(/Could not save/)
    unmount()
  })
  it('preserves edits typed while saving', async () => {
    vi.mocked(window.api.saveFile).mockImplementation(async () => { markdown = 'even newer edits'; return true })
    const { result, unmount } = renderHook(() => useFile(editor))
    await act(async () => { expect(await result.current.openFilePath('next.md')).toBe(false) })
    expect(editor.commands.setContent).not.toHaveBeenCalled()
    expect(useAppStore.getState().file.isDirty).toBe(true)
    unmount()
  })
  it('reports missing files and keeps the current document', async () => {
    vi.mocked(window.api.openFilePath).mockResolvedValue(null)
    const { result, unmount } = renderHook(() => useFile(editor))
    await act(async () => { expect(await result.current.openFilePath('missing.md')).toBe(false) })
    expect(window.api.saveFile).not.toHaveBeenCalled()
    expect(useAppStore.getState().toast?.message).toMatch(/exists/)
    unmount()
  })
  it('does not reload the same Windows document with different casing or separators', async () => {
    const { result, unmount } = renderHook(() => useFile(editor))
    await act(async () => { expect(await result.current.openFilePath('c:/NOTES/current.md')).toBe(true) })
    expect(window.api.openFilePath).not.toHaveBeenCalled()
    expect(editor.commands.setContent).not.toHaveBeenCalled()
    unmount()
  })
  it('reads a file alias again after saving instead of restoring stale disk content', async () => {
    vi.mocked(window.api.openFilePath)
      .mockResolvedValueOnce({ path: 'C:\\notes\\alias.md', content: 'old disk content' })
      .mockResolvedValueOnce({ path: 'C:\\notes\\alias.md', content: 'unsaved edits' })
    const { result, unmount } = renderHook(() => useFile(editor))
    await act(async () => { expect(await result.current.openFilePath('C:\\notes\\alias.md')).toBe(true) })
    expect(editor.commands.setContent).toHaveBeenCalledWith('unsaved edits')
    unmount()
  })
  it('uses the shared navigation event for a Chinese anchor', async () => {
    editor.view.dom.innerHTML = '<h1>中文标题</h1>'
    const scroll = vi.fn()
    editor.view.dom.firstElementChild!.scrollIntoView = scroll
    vi.mocked(window.api.resolveLink).mockResolvedValue({ target: { kind: 'anchor', anchor: '中文标题' } })
    const { unmount } = renderHook(() => useFile(editor))
    act(() => requestLinkNavigation('#%E4%B8%AD%E6%96%87%E6%A0%87%E9%A2%98'))
    await waitFor(() => expect(scroll).toHaveBeenCalled())
    unmount()
  })
})
