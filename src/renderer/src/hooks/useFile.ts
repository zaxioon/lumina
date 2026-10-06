import { useCallback, useEffect, useRef } from 'react'
import { EditorState } from '@tiptap/pm/state'
import type { Editor } from '@tiptap/react'
import { useAppStore } from '../store/appStore'
import type { FileType } from '../types/file'
import type { DocumentTab } from '../types/tab'
import { buildTxtDoc, serializeTxtDoc, detectFileType, extractSnippet } from '../utils/txtUtils'
import { resolveRelativeImagePaths, unresolveRelativeImagePaths, normalizeAlignAttributes, rebaseImagePaths } from '../utils/markdownUtils'
import { NAVIGATE_LINK, findAnchor, sameDocumentPath } from '../utils/linkNavigation'

export { detectFileType } from '../utils/txtUtils'

type Snapshot = { state: EditorState; content: string; scrollTop: number }
type Reservation = { tabId: string; path: string; identity: string }
const showError = (message: string): void => useAppStore.getState().showToast(message, 'error')
const tabName = (tab: DocumentTab): string => tab.path?.split(/[/\\]/).pop() ?? 'Untitled'

export function useFile(editor: Editor | null) {
  const snapshots = useRef(new Map<string, Snapshot>())
  const opening = useRef(false)
  const closing = useRef(false)
  const saveQueue = useRef<Promise<unknown>>(Promise.resolve())
  const reservations = useRef<Reservation[]>([])
  const saveAsBusy = useRef(new Set<string>())
  const resumeAutosave = useRef<() => void>(() => {})

  const writeSnapshot = useCallback((path: string, content: string, allowed: () => boolean = () => true): Promise<boolean> => {
    const pending = saveQueue.current.catch(() => undefined).then(() => allowed() ? window.api.saveFile(path, content) : false)
    saveQueue.current = pending
    return pending
  }, [])

  const stableAddRecent = useCallback(async (path: string, content: string, fileType: FileType) => {
    try {
      await window.api.addRecentFile(path, extractSnippet(content, fileType))
      const state = useAppStore.getState()
      if (!state.recentFiles.some(file => sameDocumentPath(file.path, path))) {
        state.setRecentFiles([{ path, name: path.split(/[/\\]/).pop() ?? path, lastOpened: new Date().toISOString(), snippet: extractSnippet(content, fileType) }, ...state.recentFiles].slice(0, 20))
      }
    } catch { showError('File opened, but the recent files list could not be updated.') }
  }, [])

  const getContent = useCallback((): string => {
    if (!editor) return ''
    const { fileType, path } = useAppStore.getState().file
    if (fileType === 'txt') return serializeTxtDoc(editor.state.doc)
    const storage = editor.storage as unknown as { markdown?: { getMarkdown(): string } }
    const raw = storage.markdown?.getMarkdown() ?? editor.getText()
    return path ? unresolveRelativeImagePaths(raw, path) : raw
  }, [editor])

  const captureActive = useCallback(() => {
    if (!editor) return
    const id = useAppStore.getState().activeTabId
    const scroller = editor.view.dom.closest<HTMLElement>('[data-editor-scroll]')
    snapshots.current.set(id, { state: editor.state, content: getContent(), scrollTop: scroller?.scrollTop ?? 0 })
  }, [editor, getContent])

  const refreshEditor = useCallback(() => {
    if (!editor) return
    const text = editor.getText()
    ;(editor.storage as unknown as { wordCount: number }).wordCount = text.trim() ? text.trim().split(/\s+/).length : 0
    const transaction = editor.state.tr
    editor.emit('transaction', { editor, transaction, appendedTransactions: [] })
    editor.emit('selectionUpdate', { editor, transaction })
    const active = useAppStore.getState().tabs.find(tab => tab.id === useAppStore.getState().activeTabId)
    document.title = (active ? tabName(active) : 'Untitled') + ' — Lumina'
  }, [editor])

  const loadContent = useCallback((raw: string, fileType: FileType, path: string | null) => {
    if (!editor) return
    try {
      const aligned = normalizeAlignAttributes(raw)
      editor.commands.setContent(fileType === 'txt' ? buildTxtDoc(raw) : path ? resolveRelativeImagePaths(aligned, path) : aligned, { emitUpdate: false })
    } catch (error) {
      console.error('[Lumina] Unable to parse document:', error)
      editor.commands.setContent(buildTxtDoc(raw), { emitUpdate: false })
    }
    editor.view.updateState(EditorState.create({ schema: editor.schema, plugins: editor.state.plugins, doc: editor.state.doc }))
    refreshEditor()
  }, [editor, refreshEditor])

  const selectTab = useCallback((id: string): boolean => {
    const state = useAppStore.getState()
    if (!editor || id === state.activeTabId) return !!editor
    const tab = state.tabs.find(item => item.id === id)
    if (!tab) return false
    captureActive()
    state.activateTab(id)
    const snapshot = snapshots.current.get(id)
    if (snapshot) {
      editor.view.updateState(snapshot.state)
      refreshEditor()
    } else loadContent(tab.content, tab.fileType, tab.path)
    const scroller = editor.view.dom.closest<HTMLElement>('[data-editor-scroll]')
    if (scroller) scroller.scrollTop = snapshot?.scrollTop ?? 0
    return true
  }, [editor, captureActive, loadContent, refreshEditor])

  const addDocument = useCallback((content: string, path: string | null, identity?: string, dirty = false, reuseEmpty = true) => {
    if (!editor) return
    captureActive()
    const state = useAppStore.getState()
    const empty = reuseEmpty && !state.file.path && !state.file.isDirty && editor.isEmpty
    const replaceId = empty ? state.activeTabId : undefined
    const tab: DocumentTab = { id: crypto.randomUUID(), path, content, identity, fileType: detectFileType(path), isDirty: dirty, revision: 0 }
    state.addTab(tab, replaceId)
    if (replaceId) snapshots.current.delete(replaceId)
    loadContent(content, tab.fileType, path)
    captureActive()
  }, [editor, captureActive, loadContent])

  const findConflict = useCallback((id: string, path: string, identity: string) => {
    return useAppStore.getState().tabs.some(tab => tab.id !== id && (sameDocumentPath(tab.path, path) || tab.identity === identity)) ||
      reservations.current.some(item => item.tabId !== id && (sameDocumentPath(item.path, path) || item.identity === identity))
  }, [])

  const saveTabAs = useCallback(async (id: string): Promise<boolean> => {
    if (!editor || saveAsBusy.current.has(id)) return false
    saveAsBusy.current.add(id)
    try {
      const initial = useAppStore.getState().tabs.find(tab => tab.id === id)
      if (!initial) return false
      const chosen = await window.api.chooseSavePath(initial.path ?? undefined)
      if (!chosen) return false
      if (chosen.error) { showError(chosen.error); return false }
      const inspected = await window.api.inspectFilePath(chosen.path!)
      if (inspected.error) { showError(inspected.error); return false }
      const { path, identity } = inspected as { path: string; identity: string }
      if (findConflict(id, path, identity)) { showError('This file is already open in another tab. Choose a different save location.'); return false }
      reservations.current.push({ tabId: id, path, identity })
      if (useAppStore.getState().activeTabId === id) captureActive()
      const tab = useAppStore.getState().tabs.find(item => item.id === id)
      const snapshot = snapshots.current.get(id)
      if (!tab || !snapshot) return false
      const content = tab.fileType === 'md' ? rebaseImagePaths(snapshot.content, tab.path, path) : snapshot.content
      const ok = await writeSnapshot(path, content, () => !findConflict(id, path, identity))
      if (!ok) { showError('Could not save this document. Your changes are preserved.'); return false }
      const current = useAppStore.getState().tabs.find(item => item.id === id)
      if (!current) return false
      const actual = await window.api.inspectFilePath(path)
      const unchanged = useAppStore.getState().tabs.find(item => item.id === id)?.revision === tab.revision
      // Retain edits made while saving, while rebasing the background snapshot to its new directory.
      if (useAppStore.getState().activeTabId === id) captureActive()
      const latest = snapshots.current.get(id)
      if (latest && tab.fileType === 'md') snapshots.current.set(id, { ...latest, content: rebaseImagePaths(latest.content, tab.path, path) })
      useAppStore.getState().patchTab(id, { path, identity: actual.identity ?? identity, isDirty: !unchanged, fileType: detectFileType(path), content })
      if (useAppStore.getState().activeTabId === id) refreshEditor()
      await stableAddRecent(path, content, detectFileType(path))
      return unchanged
    } catch { showError('Could not save this document. Your changes are preserved.'); return false }
    finally {
      saveAsBusy.current.delete(id)
      reservations.current = reservations.current.filter(item => item.tabId !== id)
      resumeAutosave.current()
    }
  }, [editor, captureActive, findConflict, refreshEditor, stableAddRecent, writeSnapshot])

  const saveTab = useCallback(async (id: string): Promise<boolean> => {
    if (saveAsBusy.current.has(id)) return false
    const tab = useAppStore.getState().tabs.find(item => item.id === id)
    if (!tab) return false
    if (!tab.path) return saveTabAs(id)
    if (useAppStore.getState().activeTabId === id) captureActive()
    const snapshot = snapshots.current.get(id)
    if (!snapshot) return false
    try {
      const ok = await writeSnapshot(tab.path, snapshot.content)
      if (!ok) { showError('Could not save this document. Your changes are preserved.'); return false }
      const current = useAppStore.getState().tabs.find(item => item.id === id)
      if (!current || current.revision !== tab.revision || current.path !== tab.path) return false
      useAppStore.getState().patchTab(id, { isDirty: false, content: snapshot.content })
      return true
    } catch { showError('Could not save this document. Your changes are preserved.'); return false }
  }, [captureActive, saveTabAs, writeSnapshot])

  const openFilePath = useCallback(async (requestedPath: string): Promise<boolean> => {
    if (!editor || opening.current || closing.current) return false
    const existing = useAppStore.getState().tabs.find(tab => sameDocumentPath(tab.path, requestedPath))
    if (existing) return selectTab(existing.id)
    opening.current = true
    const sourceId = useAppStore.getState().activeTabId
    try {
      const inspected = await window.api.inspectFilePath(requestedPath)
      if (inspected.error) { showError(inspected.error); return false }
      const { path, identity } = inspected as { path: string; identity: string }
      if (reservations.current.some(item => item.identity === identity || sameDocumentPath(item.path, path))) { showError('This document is being saved. Open it again when saving finishes.'); return false }
      const alreadyOpen = useAppStore.getState().tabs.find(tab => tab.identity === identity || sameDocumentPath(tab.path, path))
      if (alreadyOpen) return selectTab(alreadyOpen.id)
      const result = await window.api.openFilePath(path)
      if (!result) { showError('Unable to open linked file. Check that it exists.'); return false }
      if (useAppStore.getState().activeTabId !== sourceId) return false
      addDocument(result.content, path, identity)
      await stableAddRecent(path, result.content, detectFileType(path))
      return true
    } catch { showError('Unable to open this document. Your current tabs are preserved.'); return false }
    finally { opening.current = false }
  }, [editor, selectTab, addDocument, stableAddRecent])

  const openFile = useCallback(async () => {
    if (closing.current) return
    try {
      const result = await window.api.openFile()
      if (result) await openFilePath(result.path)
    } catch { showError('Unable to open a document.') }
  }, [openFilePath])
  const newFile = useCallback(() => { if (!closing.current) addDocument('', null, undefined, false, false) }, [addDocument])
  const openDraft = useCallback(() => {
    const { draft } = useAppStore.getState()
    if (draft && !closing.current) addDocument(draft.content, null, undefined, true)
  }, [addDocument])
  const saveFile = useCallback(async () => { await saveTab(useAppStore.getState().activeTabId) }, [saveTab])
  const saveFileAs = useCallback(async () => { await saveTabAs(useAppStore.getState().activeTabId) }, [saveTabAs])

  const confirmClose = useCallback(async (id: string): Promise<{ allowed: boolean; discardedRevision?: number }> => {
    const tab = useAppStore.getState().tabs.find(item => item.id === id)
    if (!tab || !tab.isDirty) return { allowed: true }
    const choice = await window.api.confirmDocumentClose(tabName(tab))
    if (choice === 'cancel') return { allowed: false }
    if (choice === 'save') return { allowed: await saveTab(id) }
    const current = useAppStore.getState().tabs.find(item => item.id === id)
    if (current?.revision !== tab.revision) { showError('This document changed while closing. Please try again.'); return { allowed: false } }
    return { allowed: true, discardedRevision: tab.revision }
  }, [saveTab])

  const closeTab = useCallback(async (id: string) => {
    if (closing.current) return
    closing.current = true
    try {
      await saveQueue.current.catch(() => undefined)
      if (!(await confirmClose(id)).allowed) return
      const state = useAppStore.getState()
      if (!state.tabs.some(tab => tab.id === id)) return
      if (state.activeTabId === id) {
        const index = state.tabs.findIndex(tab => tab.id === id)
        const next = state.tabs[index + 1] ?? state.tabs[index - 1]
        if (next) selectTab(next.id)
        else addDocument('', null, undefined, false, false)
      }
      useAppStore.getState().removeTab(id)
      snapshots.current.delete(id)
    } catch { showError('Unable to close this document. Your changes are preserved.') }
    finally { closing.current = false; resumeAutosave.current() }
  }, [confirmClose, selectTab, addDocument])

  const closeWindow = useCallback(async () => {
    if (closing.current) { window.api.completeWindowClose(false); return }
    closing.current = true
    let allowed = false
    try {
      await saveQueue.current.catch(() => undefined)
      const discarded = new Map<string, number>()
      for (const tab of [...useAppStore.getState().tabs]) {
        const result = await confirmClose(tab.id)
        if (!result.allowed) return
        if (result.discardedRevision !== undefined) discarded.set(tab.id, result.discardedRevision)
      }
      allowed = useAppStore.getState().tabs.every(tab => !tab.isDirty || discarded.get(tab.id) === tab.revision)
      if (!allowed) showError('A document changed while closing. Your tabs remain open.')
    } catch { showError('Unable to save all documents. Your tabs remain open.') }
    finally { closing.current = false; if (!allowed) resumeAutosave.current(); window.api.completeWindowClose(allowed) }
  }, [confirmClose])

  useEffect(() => {
    if (!editor) return
    captureActive()
    editor.on('update', captureActive)
    return () => { editor.off('update', captureActive) }
  }, [editor, captureActive])

  useEffect(() => {
    if (!editor) return
    let navigating = false
    const navigate = async (event: Event): Promise<void> => {
      if (navigating || closing.current) return
      navigating = true
      try {
        const sourceId = useAppStore.getState().activeTabId
        const result = await window.api.resolveLink((event as CustomEvent<string>).detail, useAppStore.getState().file.path)
        if (result.error) { showError(result.error); return }
        const target = result.target
        if (!target || useAppStore.getState().activeTabId !== sourceId) return
        if (target.kind === 'external') { await window.api.openExternal(target.url); return }
        if (target.kind === 'attachment') { const error = await window.api.openAttachment(target.path); if (error) showError(error); return }
        if (target.kind === 'document' && !await openFilePath(target.path)) return
        if (target.anchor) {
          const heading = findAnchor(editor.view.dom, target.anchor)
          if (heading) heading.scrollIntoView({ behavior: 'smooth', block: 'start' })
          else showError('Heading not found: ' + target.anchor)
        } else if (target.kind === 'anchor') editor.view.dom.scrollIntoView({ behavior: 'smooth', block: 'start' })
      } catch { showError('Unable to open this link.') }
      finally { navigating = false }
    }
    window.addEventListener(NAVIGATE_LINK, navigate)
    return () => window.removeEventListener(NAVIGATE_LINK, navigate)
  }, [editor, openFilePath])

  useEffect(() => {
    const callbacks = [
      window.api.onMenuSave(() => { void saveFile() }),
      window.api.onMenuSaveAs(() => { void saveFileAs() }),
      window.api.onOpenFile(path => { if (path === null) newFile(); else void openFilePath(path) }),
      window.api.onRequestClose(() => { void closeWindow() }),
    ]
    return () => callbacks.forEach(unsubscribe => unsubscribe())
  }, [saveFile, saveFileAs, openFilePath, newFile, closeWindow])

  useEffect(() => {
    if (!editor) return
    let disposed = false
    const initialFile = useAppStore.getState().file
    window.api.readInitialFile().then(async result => {
      if (!result || disposed || useAppStore.getState().file !== initialFile) return
      await openFilePath(result.path)
    }).catch(() => showError('Unable to restore the last document.'))
    return () => { disposed = true }
  }, [editor, openFilePath])

  useEffect(() => {
    const timers = new Map<string, ReturnType<typeof setTimeout>>()
    const revisions = new Map<string, number>()
    const update = (): void => {
      const tabs = useAppStore.getState().tabs
      window.__lumina_isDirty__ = tabs.some(tab => tab.isDirty)
      for (const [id, timer] of timers) {
        if (!tabs.some(tab => tab.id === id && tab.isDirty && tab.path)) { clearTimeout(timer); timers.delete(id); revisions.delete(id) }
      }
      for (const tab of tabs) {
        if (!tab.isDirty || !tab.path || revisions.get(tab.id) === tab.revision) continue
        if (timers.has(tab.id)) clearTimeout(timers.get(tab.id))
        revisions.set(tab.id, tab.revision)
        timers.set(tab.id, setTimeout(() => {
          timers.delete(tab.id)
          if (closing.current || saveAsBusy.current.has(tab.id)) { revisions.delete(tab.id); return }
          void saveTab(tab.id)
        }, 2000))
      }
    }
    const unsubscribe = useAppStore.subscribe(update)
    resumeAutosave.current = update
    update()
    return () => { resumeAutosave.current = () => {}; unsubscribe(); for (const timer of timers.values()) clearTimeout(timer) }
  }, [saveTab])

  return { openFile, saveFile, saveFileAs, newFile, openFilePath, openDraft, selectTab, closeTab }
}
