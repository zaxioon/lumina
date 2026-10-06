import { useCallback, useEffect, useRef } from 'react'
import { useAppStore } from '../store/appStore'
import type { Editor } from '@tiptap/react'
import type { FileType } from '../types/file'
import { buildTxtDoc, serializeTxtDoc, detectFileType, extractSnippet } from '../utils/txtUtils'
import { resolveRelativeImagePaths, unresolveRelativeImagePaths, normalizeAlignAttributes } from '../utils/markdownUtils'
import { NAVIGATE_LINK, findAnchor, sameDocumentPath } from '../utils/linkNavigation'

// Re-export detectFileType for backward compatibility (other files import it from here)
export { detectFileType } from '../utils/txtUtils'

// ── Hook ─────────────────────────────────────────────────────────────────

export function useFile(editor: Editor | null): {
  openFile: () => Promise<void>
  saveFile: () => Promise<void>
  saveFileAs: () => Promise<void>
  newFile: () => void
  openFilePath: (path: string) => Promise<boolean>
  openDraft: () => void
} {
  const setFile = useAppStore((s) => s.setFile)
  const markDirty = useAppStore((s) => s.markDirty)
  const setRecentFiles = useAppStore((s) => s.setRecentFiles)
  const saveDraft = useAppStore((s) => s.saveDraft)
  const clearDraft = useAppStore((s) => s.clearDraft)
  const opening = useRef(false)
  const saveQueue = useRef<Promise<unknown>>(Promise.resolve())
  const showError = (message: string): void => useAppStore.getState().showToast(message, 'error')
  const writeSnapshot = useCallback((path: string, content: string): Promise<boolean> => {
    const pending = saveQueue.current.catch(() => undefined).then(() => window.api.saveFile(path, content))
    saveQueue.current = pending
    return pending
  }, [])

  /** Add to recents without reordering existing entries mid-session. */
  const stableAddRecent = useCallback(
    async (path: string, snippet?: string) => {
      await window.api.addRecentFile(path, snippet)
      const current = useAppStore.getState().recentFiles
      if (!current.some((f) => f.path === path)) {
        const name = path.split(/[/\\]/).pop() ?? path
        setRecentFiles([{ path, name, lastOpened: new Date().toISOString(), snippet }, ...current].slice(0, 20))
      }
    },
    [setRecentFiles]
  )

  /** Load content into TipTap, routing by file type. */
  const loadContent = useCallback(
    (raw: string, fileType: FileType, filePath?: string | null) => {
      if (!editor) return
      try {
        if (fileType === 'txt') {
          editor.commands.setContent(buildTxtDoc(raw))
        } else {
          // 1. Normalise deprecated align="center" → style="text-align:center"
          //    so TipTap's TextAlign extension centres the content correctly.
          // 2. Resolve relative image paths to media:// URLs so local images render.
          //    The reverse (unresolve) happens in getContent() before saving.
          const aligned = normalizeAlignAttributes(raw)
          const content = filePath ? resolveRelativeImagePaths(aligned, filePath) : aligned
          editor.commands.setContent(content)
        }
      } catch (err) {
        // Fallback: if the parsed doc is rejected by the ProseMirror schema,
        // load as plain text paragraphs so the user isn't left with a blank editor.
        console.error('[Lumina] setContent failed, falling back to plain text:', err)
        const fallback = { type: 'doc', content: raw.split(/\r?\n/).map((line) =>
          line ? { type: 'paragraph', content: [{ type: 'text', text: line }] } : { type: 'paragraph' }
        )}
        editor.commands.setContent(fallback)
      }
      markDirty(false)
    },
    [editor, markDirty]
  )

  /** Serialize editor content to the correct format for saving. */
  const getContent = useCallback((): string => {
    if (!editor) return ''
    const { fileType, path } = useAppStore.getState().file
    if (fileType === 'txt') return serializeTxtDoc(editor.state.doc)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = (editor.storage as any).markdown?.getMarkdown() ?? editor.getText()
    // Strip file:// absolute prefixes we added on load — restore original relative paths
    return path ? unresolveRelativeImagePaths(raw, path) : raw
  }, [editor])

  /**
   * If there's an unsaved new file with content, snapshot it to the draft store
   * before switching away.  Called at the top of every "open" action.
   */
  const snapshotDraftIfNeeded = useCallback(() => {
    const state = useAppStore.getState()
    if (!state.file.path && state.file.isDirty && editor) {
      const raw = (editor.storage as unknown as Record<string, { getMarkdown?: () => string }>)
        .markdown?.getMarkdown?.() ?? editor.getText()
      if (raw.trim()) saveDraft(raw)
    }
  }, [editor, saveDraft])

  const openFilePath = useCallback(
    async (path: string) => {
      if (opening.current || !editor) return false
      if (sameDocumentPath(path, useAppStore.getState().file.path)) return true
      opening.current = true
      const originalPath = useAppStore.getState().file.path
      try {
        let result = await window.api.openFilePath(path)
        if (!result) { showError('Unable to open linked file. Check that it exists.'); return false }
        if (useAppStore.getState().file.path !== originalPath) return false
        // Flush pending edits before replacing the editor, instead of relying on the 2s timer.
        if (originalPath && useAppStore.getState().file.isDirty) {
          const content = getContent()
          if (!await writeSnapshot(originalPath, content)) {
            showError('Could not save the current document. The link was not opened.')
            return false
          }
          if (useAppStore.getState().file.path !== originalPath || getContent() !== content) {
            showError('The document changed while saving. Open the link again to keep your latest edits.')
            return false
          }
          // An alias/symlink can point at the current file. Read again after flushing edits.
          result = await window.api.openFilePath(path)
          if (!result) { showError('Unable to read linked file after saving.'); return false }
          if (useAppStore.getState().file.path !== originalPath || getContent() !== content) {
            showError('The document changed while opening the link. Try again to keep your latest edits.')
            return false
          }
        }
        snapshotDraftIfNeeded()
        const fileType = detectFileType(result.path)
        setFile({ path: result.path, content: result.content, isDirty: false, fileType })
        loadContent(result.content, fileType, result.path)
        document.title = `${result.path.split(/[/\\]/).pop()} — Lumina`
        try { await stableAddRecent(result.path, extractSnippet(result.content, fileType)) }
        catch { showError('File opened, but the recent files list could not be updated.') }
        return true
      } catch {
        showError('Unable to open link. Your current document is preserved.')
        return false
      } finally { opening.current = false }
    },
    [editor, getContent, writeSnapshot, setFile, loadContent, stableAddRecent, snapshotDraftIfNeeded]
  )

  useEffect(() => {
    if (!editor) return
    let navigating = false
    const navigate = async (event: Event): Promise<void> => {
      if (navigating) return
      navigating = true
      try {
        const href = (event as CustomEvent<string>).detail
        const sourcePath = useAppStore.getState().file.path
        const result = await window.api.resolveLink(href, sourcePath)
        if (result.error) { showError(result.error); return }
        const target = result.target
        if (!target || useAppStore.getState().file.path !== sourcePath) return
        if (target.kind === 'external') { await window.api.openExternal(target.url); return }
        if (target.kind === 'attachment') {
          const error = await window.api.openAttachment(target.path)
          if (error) showError(error)
          return
        }
        if (target.kind === 'document' && !sameDocumentPath(target.path, sourcePath) && !await openFilePath(target.path)) return
        if (target.anchor) {
          const heading = findAnchor(editor.view.dom, target.anchor)
          if (heading) heading.scrollIntoView({ behavior: 'smooth', block: 'start' })
          else showError(`Heading not found: ${target.anchor}`)
        } else if (target.kind === 'anchor') editor.view.dom.scrollIntoView({ behavior: 'smooth', block: 'start' })
      } catch { showError('Unable to open this link.') }
      finally { navigating = false }
    }
    window.addEventListener(NAVIGATE_LINK, navigate)
    return () => window.removeEventListener(NAVIGATE_LINK, navigate)
  }, [editor, openFilePath])

  const newFile = useCallback(() => {
    snapshotDraftIfNeeded()
    setFile({ path: null, content: '', isDirty: false, fileType: 'md' })
    editor?.commands.setContent('')
    document.title = 'Untitled — Lumina'
  }, [editor, setFile, snapshotDraftIfNeeded])

  /** Restore the in-memory draft into the editor. */
  const openDraft = useCallback(() => {
    const { draft } = useAppStore.getState()
    if (!draft || !editor) return
    setFile({ path: null, content: draft.content, isDirty: true, fileType: 'md' })
    loadContent(draft.content, 'md', null)
    document.title = 'Unsaved draft — Lumina'
  }, [editor, setFile, loadContent])

  const openFile = useCallback(async () => {
    snapshotDraftIfNeeded()
    const result = await window.api.openFile()
    if (!result) return
    const fileType = detectFileType(result.path)
    setFile({ path: result.path, content: result.content, isDirty: false, fileType })
    loadContent(result.content, fileType, result.path)
    await stableAddRecent(result.path, extractSnippet(result.content, fileType))
    document.title = `${result.path.split(/[/\\]/).pop()} — Lumina`
  }, [setFile, loadContent, stableAddRecent, snapshotDraftIfNeeded])

  const saveFile = useCallback(async () => {
    const state = useAppStore.getState()
    if (!state.file.path) { await saveFileAs(); return }
    const content = getContent()
    const ok = await writeSnapshot(state.file.path, content)
    if (ok && useAppStore.getState().file.path === state.file.path && getContent() === content) {
      markDirty(false)
      ;(window as Window & { __lumina_isDirty__?: boolean }).__lumina_isDirty__ = false
    }
  }, [getContent, markDirty, writeSnapshot])

  const saveFileAs = useCallback(async () => {
    const content = getContent()
    const result = await window.api.saveFileAs(content, useAppStore.getState().file.path ?? undefined)
    if (!result) return
    const fileType = detectFileType(result.path)
    setFile({ path: result.path, isDirty: false, fileType })
    markDirty(false)
    clearDraft()  // draft is now a real saved file
    ;(window as Window & { __lumina_isDirty__?: boolean }).__lumina_isDirty__ = false
    await stableAddRecent(result.path, extractSnippet(content, fileType))
    document.title = `${result.path.split(/[/\\]/).pop()} — Lumina`
  }, [getContent, setFile, markDirty, clearDraft, stableAddRecent])

  // Menu-triggered open / save
  useEffect(() => {
    const unsubSave = window.api.onMenuSave(() => saveFile())
    const unsubSaveAs = window.api.onMenuSaveAs(() => saveFileAs())
    const unsubOpen = window.api.onOpenFile((path) => {
      if (path === null) newFile()
      else openFilePath(path)
    })
    return () => { unsubSave(); unsubSaveAs(); unsubOpen() }
  }, [saveFile, saveFileAs, openFilePath, newFile])

  // Load initial file (CLI / most recent / welcome)
  useEffect(() => {
    const initialFile = useAppStore.getState().file
    window.api.readInitialFile().then(async (result) => {
      if (!result || useAppStore.getState().file !== initialFile) return
      const fileType = detectFileType(result.path)
      setFile({ path: result.path, content: result.content, isDirty: false, fileType })
      loadContent(result.content, fileType, result.path)
      document.title = `${result.path.split(/[/\\]/).pop()} — Lumina`
      await window.api.addRecentFile(result.path, extractSnippet(result.content, fileType))
      const recents = await window.api.getRecentFiles()
      setRecentFiles(recents)
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-save: 2 seconds after the last edit, if the file already has a path
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null

    const unsub = useAppStore.subscribe((state) => {
      if (state.file.isDirty && state.file.path) {
        if (timer) clearTimeout(timer)
        timer = setTimeout(() => {
          // Re-read state at fire time — path may have changed
          const s = useAppStore.getState()
          if (s.file.isDirty && s.file.path) saveFile()
        }, 2000)
      } else if (timer) {
        clearTimeout(timer)
        timer = null
      }
    })

    return () => {
      unsub()
      if (timer) clearTimeout(timer)
    }
  }, [saveFile])

  // Sync dirty flag to window global for close guard
  useEffect(() => {
    return useAppStore.subscribe((state) => {
      ;(window as Window & { __lumina_isDirty__?: boolean }).__lumina_isDirty__ = state.file.isDirty
    })
  }, [])

  return { openFile, saveFile, saveFileAs, newFile, openFilePath, openDraft }
}
