import { useCallback, useState, useEffect } from 'react'
import { EditorContent } from '@tiptap/react'
import type { Editor } from '@tiptap/react'
import type { MutableRefObject } from 'react'
import { useAppStore } from '../../store/appStore'
import { EditorContextMenu, type ContextMenuState } from './EditorContextMenu'
import { BubbleToolbar } from './BubbleToolbar'
import { LinkDialog } from './LinkDialog'

interface EditorCoreProps {
  editor: Editor
  insertImageRef: MutableRefObject<() => void>
  focusMode?: boolean
  onOpenFilePath: (path: string) => void
}

export function EditorCore({ editor, insertImageRef, focusMode, onOpenFilePath }: EditorCoreProps): JSX.Element {
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({ x: 0, y: 0, visible: false })
  const fileType = useAppStore((s) => s.file.fileType)

  const insertForTab = useCallback((tabId: string, src: string, alt?: string) => {
    if (useAppStore.getState().activeTabId !== tabId) {
      useAppStore.getState().showToast('The active document changed. Insert the image again in the intended tab.', 'error')
      return
    }
    editor.chain().focus().setImage({ src, alt }).run()
  }, [editor])

  const insertFile = useCallback(async (file: File, tabId: string) => {
    const state = useAppStore.getState()
    if (state.activeTabId !== tabId) return
    try {
      const buffer = Array.from(new Uint8Array(await file.arrayBuffer()))
      const src = await window.api.pasteImage({ buffer, mimeType: file.type, documentPath: state.file.path })
      insertForTab(tabId, src, file.name)
    } catch {
      useAppStore.getState().showToast('Unable to insert this image. Check the file and try again.', 'error')
    }
  }, [insertForTab])

  const handleDrop = useCallback(
    async (e: React.DragEvent<HTMLDivElement>) => {
      const files = e.dataTransfer.files
      if (!files.length) return
      const documents = Array.from(files).filter(file => /\.(md|markdown|txt)$/i.test(file.name))
      if (documents.length) {
        e.preventDefault()
        e.stopPropagation()
        for (const file of documents) {
          const path = window.api.getPathForFile(file)
          if (path) await onOpenFilePath(path)
        }
        return
      }
      const imageFiles = Array.from(files).filter((f) => f.type.startsWith('image/'))
      if (!imageFiles.length) return

      e.preventDefault()
      e.stopPropagation()

      const tabId = useAppStore.getState().activeTabId
      for (const file of imageFiles) await insertFile(file, tabId)
    },
    [insertFile, onOpenFilePath]
  )

  useEffect(() => {
    if (!window.api.onNativeDrop) return
    return window.api.onNativeDrop(async paths => {
      for (const path of paths) {
        if (/\.(md|markdown|txt)$/i.test(path)) { await onOpenFilePath(path); continue }
        if (!/\.(png|jpe?g|gif|webp|svg|bmp|ico|avif)$/i.test(path)) continue
        const { activeTabId, file } = useAppStore.getState()
        try {
          const src = window.api.importImagePath
            ? await window.api.importImagePath(path, file.path)
            : file.path ? await window.api.copyImageToDoc({ sourcePath: path, documentPath: file.path }) : null
          if (src) insertForTab(activeTabId, src, path.split(/[/\\]/).pop())
        } catch { useAppStore.getState().showToast('Unable to insert the dropped image.', 'error') }
      }
    })
  }, [insertForTab, onOpenFilePath])

  const handlePaste = useCallback(
    async (e: React.ClipboardEvent<HTMLDivElement>) => {
      const items = e.clipboardData?.items
      if (!items) return
      const imageItem = Array.from(items).find((item) => item.type.startsWith('image/'))
      if (!imageItem) return

      e.preventDefault()
      const file = imageItem.getAsFile()
      if (!file) return

      await insertFile(file, useAppStore.getState().activeTabId)
    },
    [insertFile]
  )

  // Define handleInsertImage BEFORE useEffect that references it
  const handleInsertImage = useCallback(() => {
    const tabId = useAppStore.getState().activeTabId
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return
      await insertFile(file, tabId)
    }
    input.click()
  }, [insertFile])

  // Expose image insert handler to parent via ref (must come after handleInsertImage)
  useEffect(() => {
    insertImageRef.current = handleInsertImage
  }, [insertImageRef, handleInsertImage])

  const handleContextMenu = useCallback(async (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault()
    // Fetch OS spell-check data captured by the main process on the same right-click event.
    // The native context-menu event fires before the renderer's onContextMenu, so by the
    // time this async call resolves the main process already has the latest spell data.
    const spell = window.api.capabilities?.nativeSpellcheck === false
      ? undefined : await window.api.getSpellSuggestions()
    setContextMenu({ x: e.clientX, y: e.clientY, visible: true, spell })
  }, [])

  return (
    <div
      data-editor-scroll
      className={`flex-1 overflow-y-auto lm-bg${fileType === 'txt' ? ' txt-mode' : ''}${focusMode ? ' focus-mode-editor' : ''}`}
      onDrop={handleDrop}
      onDragOver={(e) => e.preventDefault()}
      onPaste={handlePaste}
      onContextMenu={handleContextMenu}
    >
      <EditorContent editor={editor} className="h-full" />

      <EditorContextMenu
        editor={editor}
        menuState={contextMenu}
        onClose={() => setContextMenu({ x: 0, y: 0, visible: false })}
        onInsertImage={handleInsertImage}
      />

      <BubbleToolbar editor={editor} contextMenuOpen={contextMenu.visible} />

      <LinkDialog editor={editor} />
    </div>
  )
}
