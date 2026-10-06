import { convertFileSrc, invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import type { AppApi, Platform, Unsubscribe } from './types/appApi'
import { useAppStore } from './store/appStore'

type Listener<T> = (value: T) => void
function eventChannel<T>() {
  const callbacks = new Set<Listener<T>>()
  const pending: T[] = []
  return {
    subscribe(callback: Listener<T>): Unsubscribe {
      callbacks.add(callback)
      queueMicrotask(() => {
        if (!callbacks.has(callback)) return
        for (const value of pending.splice(0)) for (const listener of callbacks) listener(value)
      })
      return () => { callbacks.delete(callback) }
    },
    emit(value: T): void {
      if (!callbacks.size) pending.push(value)
      else for (const callback of callbacks) callback(value)
    },
  }
}

/** Register native listeners before mounting React so the close guard is always available. */
export async function createTauriApi(): Promise<AppApi> {
  const opened = eventChannel<string | null>()
  const saved = eventChannel<void>()
  const savedAs = eventChannel<void>()
  const close = eventChannel<void>()
  const theme = eventChannel<'light' | 'dark'>()
  const dropped = eventChannel<string[]>()
  await Promise.all([
    listen<string | null>('lumina:open-file', event => opened.emit(event.payload)),
    listen('lumina:menu-save', () => saved.emit()),
    listen('lumina:menu-save-as', () => savedAs.emit()),
    listen('lumina:request-close', () => close.emit()),
    listen<string>('lumina:error', event => useAppStore.getState().showToast(event.payload, 'error')),
    listen<'light' | 'dark'>('lumina:theme-change', event => theme.emit(event.payload)),
    getCurrentWebviewWindow().onDragDropEvent(event => {
      if (event.payload.type === 'drop') dropped.emit(event.payload.paths)
    }),
  ])
  const agent = navigator.userAgent.toLowerCase()
  const platform: Platform = /android/.test(agent) ? 'android' : /iphone|ipad/.test(agent) ? 'ios'
    : /win/.test(navigator.platform.toLowerCase()) ? 'win32' : /mac/.test(navigator.platform.toLowerCase()) ? 'darwin' : 'linux'
  return {
    host: 'tauri', platform, capabilities: { nativeSpellcheck: false },
    inspectFilePath: path => invoke('inspect_file_path', { path }),
    chooseSavePath: currentPath => invoke('choose_save_path', { currentPath }),
    confirmDocumentClose: name => invoke('confirm_document_close', { name }),
    onRequestClose: close.subscribe,
    completeWindowClose: allowed => { void invoke('complete_window_close', { allowed }).catch(console.error) },
    resolveLink: (href, documentPath) => invoke('resolve_link', { href, documentPath }),
    openAttachment: path => invoke('open_attachment', { path }),
    openFile: () => invoke('open_file'),
    openFilePath: path => invoke('open_file_path', { path }),
    listDirectory: documentPath => invoke('list_directory', { documentPath }),
    saveFile: (path, content) => invoke('save_file', { path, content }),
    saveFileAs: (content, currentPath) => invoke('save_file_as', { content, currentPath }),
    readInitialFile: () => invoke('read_initial_file'),
    copyImageToDoc: args => invoke('copy_image_to_doc', { ...args }),
    importImagePath: (sourcePath, documentPath) => invoke('copy_image_to_doc', { sourcePath, documentPath }),
    pasteImage: args => invoke('paste_image', { ...args }),
    getRecentFiles: () => invoke('get_recent_files'),
    addRecentFile: (path, snippet) => invoke('add_recent_file', { path, snippet }),
    removeRecentFile: path => invoke('remove_recent_file', { path }),
    pinRecentFile: path => invoke('pin_recent_file', { path }),
    revealFile: path => invoke('reveal_file', { path }),
    renameFile: (oldPath, newName) => invoke('rename_file', { oldPath, newName }),
    getSettings: () => invoke('get_settings'),
    setSettings: partial => invoke('set_settings', { partial }),
    onOpenFile: opened.subscribe,
    onMenuSave: saved.subscribe,
    onMenuSaveAs: savedAs.subscribe,
    onThemeChange: theme.subscribe,
    onNativeDrop: dropped.subscribe,
    openExternal: url => invoke('open_external', { url }),
    exportHtml: args => invoke('export_html', { ...args }),
    exportBinary: args => invoke('export_binary', { ...args }),
    getSpellSuggestions: async () => ({ misspelledWord: '', suggestions: [] }),
    replaceMisspelling: () => {},
    getPathForFile: () => '',
    displayMediaUrl: url => {
      if (!/^media:\/\/local\//i.test(url)) return url
      try {
        let path = decodeURIComponent(new URL(url).pathname)
        if (/^\/[a-z]:\//i.test(path)) path = path.slice(1)
        return convertFileSrc(path, 'media')
      } catch { return url }
    },
  }
}
