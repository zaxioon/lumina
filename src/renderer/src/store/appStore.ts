import { create } from 'zustand'
import type { AppSettings, FileState, RecentFile } from '../types/file'
import type { DocumentTab } from '../types/tab'

/** In-memory scratchpad: content of the current unsaved new file */
export interface DraftState {
  content: string       // raw markdown / text
  createdAt: string     // ISO timestamp — used as stable key
}

interface AppState {
  file: FileState
  tabs: DocumentTab[]
  activeTabId: string
  addTab: (tab: DocumentTab, replaceId?: string) => void
  activateTab: (id: string) => void
  patchTab: (id: string, partial: Partial<DocumentTab>) => void
  removeTab: (id: string) => void
  draft: DraftState | null
  theme: AppSettings['theme']
  sidebarOpen: boolean
  recentFiles: RecentFile[]
  settingsOpen: boolean
  linkDialogOpen: boolean
  findReplaceOpen: boolean
  sidebarSearch: string
  commandPaletteOpen: boolean
  outlineOpen: boolean
  focusMode: boolean
  toast: { message: string; type: 'success' | 'error' } | null

  setFile: (file: Partial<FileState>) => void
  markDirty: (dirty: boolean) => void
  saveDraft: (content: string) => void
  clearDraft: () => void
  setTheme: (theme: AppSettings['theme']) => void
  toggleSidebar: () => void
  setSidebarOpen: (open: boolean) => void
  setRecentFiles: (files: RecentFile[]) => void
  setSettingsOpen: (open: boolean) => void
  setLinkDialogOpen: (open: boolean) => void
  setFindReplaceOpen: (open: boolean) => void
  setSidebarSearch: (q: string) => void
  setCommandPaletteOpen: (open: boolean) => void
  setOutlineOpen: (open: boolean) => void
  setFocusMode: (on: boolean) => void
  showToast: (message: string, type: 'success' | 'error') => void
  dismissToast: () => void
}

export const useAppStore = create<AppState>((set) => ({
  file: { path: null, content: '', isDirty: false, fileType: 'md' },
  tabs: [{ id: 'initial', path: null, content: '', isDirty: false, fileType: 'md', revision: 0 }],
  activeTabId: 'initial',
  addTab: (tab, replaceId) => set(state => ({
    tabs: replaceId ? state.tabs.map(existing => existing.id === replaceId ? tab : existing) : [...state.tabs, tab],
    activeTabId: tab.id,
    file: { path: tab.path, content: tab.content, isDirty: tab.isDirty, fileType: tab.fileType },
  })),
  activateTab: id => set(state => {
    const tab = state.tabs.find(item => item.id === id)
    return tab ? { activeTabId: id, file: { path: tab.path, content: tab.content, isDirty: tab.isDirty, fileType: tab.fileType } } : {}
  }),
  patchTab: (id, partial) => set(state => ({
    tabs: state.tabs.map(tab => tab.id === id ? { ...tab, ...partial } : tab),
    ...(state.activeTabId === id ? { file: { ...state.file, ...partial } } : {}),
  })),
  removeTab: id => set(state => ({ tabs: state.tabs.filter(tab => tab.id !== id) })),
  draft: null,
  theme: 'system',
  sidebarOpen: true,
  recentFiles: [],
  settingsOpen: false,
  linkDialogOpen: false,
  findReplaceOpen: false,
  sidebarSearch: '',
  commandPaletteOpen: false,
  outlineOpen: false,
  focusMode: false,
  toast: null,

  setFile: (partial) =>
    set((state) => ({ file: { ...state.file, ...partial }, tabs: state.tabs.map(tab => tab.id === state.activeTabId ? { ...tab, ...partial } : tab) })),

  markDirty: (dirty) =>
    set((state) => ({ file: { ...state.file, isDirty: dirty }, tabs: state.tabs.map(tab => tab.id === state.activeTabId ? { ...tab, isDirty: dirty, revision: tab.revision + (dirty ? 1 : 0) } : tab) })),

  saveDraft: (content) =>
    set((state) => ({
      draft: { content, createdAt: state.draft?.createdAt ?? new Date().toISOString() }
    })),

  clearDraft: () => set({ draft: null }),

  setTheme: (theme) => set({ theme }),

  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),

  setSidebarOpen: (open) => set({ sidebarOpen: open }),

  setRecentFiles: (files) => set({ recentFiles: files }),

  setSettingsOpen: (open) => set({ settingsOpen: open }),
  setLinkDialogOpen: (open) => set({ linkDialogOpen: open }),
  setFindReplaceOpen: (open) => set({ findReplaceOpen: open }),
  setSidebarSearch: (q) => set({ sidebarSearch: q }),
  setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),
  setOutlineOpen: (open) => set({ outlineOpen: open }),
  setFocusMode: (on) => set({ focusMode: on }),
  showToast: (message, type) => set({ toast: { message, type } }),
  dismissToast: () => set({ toast: null }),
}))
