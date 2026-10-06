import { BrowserWindow, dialog, ipcMain } from 'electron'
import { realpath, stat } from 'fs/promises'
import { basename, dirname, isAbsolute, join, resolve } from 'path'
import { IPC } from '../../renderer/src/types/ipc'
import type { CloseDocumentChoice, FileIdentityResult, SavePathResult } from '../../renderer/src/types/tab'

export async function inspectDocumentPath(path: string): Promise<FileIdentityResult> {
  try {
    if (typeof path !== 'string' || !isAbsolute(path) || path.includes('\0')) return { error: 'Invalid document path.' }
    const canonical = await realpath(path)
    const info = await stat(canonical, { bigint: true })
    if (!info.isFile()) return { error: 'Select a document file.' }
    return { path: canonical, identity: `${info.dev}:${info.ino}` }
  } catch {
    try {
      const canonical = join(await realpath(dirname(path)), basename(path))
      return { path: canonical, identity: `path:${process.platform === 'win32' ? canonical.toLowerCase() : canonical}` }
    } catch { return { error: 'Unable to resolve the document path.' } }
  }
}

export function registerTabHandlers(): void {
  ipcMain.handle(IPC.FILE_INSPECT_PATH, (_, path: string) => inspectDocumentPath(resolve(path)))
  ipcMain.handle(IPC.FILE_CHOOSE_SAVE_PATH, async (_, currentPath?: string): Promise<SavePathResult> => {
    try {
      const win = BrowserWindow.getFocusedWindow()
      const result = await dialog.showSaveDialog(win!, {
        defaultPath: currentPath ?? 'untitled.md',
        filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }, { name: 'Plain Text', extensions: ['txt'] }],
      })
      return result.canceled || !result.filePath ? null : { path: result.filePath }
    } catch { return { error: 'Unable to choose a save location.' } }
  })
  ipcMain.handle(IPC.DOCUMENT_CONFIRM_CLOSE, async (_, name: string): Promise<CloseDocumentChoice> => {
    const win = BrowserWindow.getFocusedWindow()
    const result = await dialog.showMessageBox(win!, {
      type: 'question', buttons: ['Save', "Don't Save", 'Cancel'], defaultId: 0, cancelId: 2,
      message: `Save changes to ${name}?`, detail: 'Save your edits before closing this document.',
    })
    return result.response === 0 ? 'save' : result.response === 1 ? 'discard' : 'cancel'
  })
}
