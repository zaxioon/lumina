import { Sidebar } from './Sidebar'
import { EditorPane } from '../editor/EditorPane'
import { SettingsModal } from '../settings/SettingsModal'
import { Toast } from '../ui/Toast'
import { useAppStore } from '../../store/appStore'
import type { Editor } from '@tiptap/react'

interface AppShellProps {
  editor: Editor
  onOpenFile: () => void
  onSaveFile: () => void
  onSaveFileAs: () => void
  onSelectTab: (id: string) => void
  onCloseTab: (id: string) => void
  onOpenFilePath: (path: string) => void
  onNewFile: () => void
  onOpenDraft: () => void
}

export function AppShell({ editor, onOpenFile, onSaveFile, onSaveFileAs, onSelectTab, onCloseTab, onOpenFilePath, onNewFile, onOpenDraft }: AppShellProps): JSX.Element {
  const focusMode = useAppStore((s) => s.focusMode)
  const sidebarOpen = useAppStore((s) => s.sidebarOpen)
  const isMac = window.api.platform === 'darwin'
  const nativeDragRegion = isMac && window.api.host === 'tauri' ? '' : undefined

  return (
    <div className={`flex flex-col h-screen lm-ink${isMac ? ' lm-platform-mac' : ''}${!sidebarOpen ? ' lm-sidebar-hidden' : ''}`} style={{ background: 'var(--lm-bg)' }}>
      {isMac && focusMode && <div className="lm-focus-drag" data-tauri-drag-region={nativeDragRegion} aria-hidden="true" />}
      <div className="flex flex-1 min-h-0">
        {/* Sidebar: hidden in focus mode */}
        <div
          className="flex flex-col min-h-0"
          style={{
            transition: 'opacity 200ms ease, transform 200ms ease',
            opacity: focusMode ? 0 : 1,
            transform: focusMode ? 'translateX(-8px)' : 'translateX(0)',
            pointerEvents: focusMode ? 'none' : undefined,
            width: focusMode ? 0 : undefined,
            overflow: focusMode ? 'hidden' : undefined,
            flexShrink: 0,
          }}
        >
          {isMac && sidebarOpen && <div className="lm-sidebar-drag" data-tauri-drag-region={nativeDragRegion} aria-hidden="true" />}
          <div className="flex-1 min-h-0">
            <Sidebar onOpenFile={onOpenFilePath} onOpenDraft={onOpenDraft} />
          </div>
        </div>
        <EditorPane editor={editor} onOpenFile={onOpenFile} onSaveFile={onSaveFile} onSaveFileAs={onSaveFileAs} onNewFile={onNewFile} onSelectTab={onSelectTab} onCloseTab={onCloseTab} onOpenFilePath={onOpenFilePath} />
      </div>
      <SettingsModal />
      <Toast />
    </div>
  )
}
