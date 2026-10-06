import { useEditor } from './hooks/useEditor'
import { useFile } from './hooks/useFile'
import { useTheme } from './hooks/useTheme'
import { useRecentFiles } from './hooks/useRecentFiles'
import { AppShell } from './components/layout/AppShell'

export function App(): JSX.Element | null {
  useTheme()
  useRecentFiles()

  const editor = useEditor()
  const { openFile, saveFile, saveFileAs, openFilePath, newFile, openDraft, selectTab, closeTab } = useFile(editor)

  if (!editor) return null

  return (
    <AppShell
      editor={editor}
      onOpenFile={openFile}
      onSaveFile={saveFile}
      onSaveFileAs={saveFileAs}
      onSelectTab={selectTab}
      onCloseTab={closeTab}
      onOpenFilePath={openFilePath}
      onNewFile={newFile}
      onOpenDraft={openDraft}
    />
  )
}
