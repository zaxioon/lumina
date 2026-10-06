import { app, BrowserWindow, dialog } from 'electron'
import { readFile, readdir, stat } from 'fs/promises'
import { dirname, extname, join } from 'path'
import store from './store'
import type { OpenFileResult, DirectoryListing } from '../renderer/src/types/file'

export async function listDocumentDirectory(documentPath: string): Promise<DirectoryListing> {
  const path = dirname(documentPath)
  try {
    const entries = await readdir(path, { withFileTypes: true })
    const files = entries
      .filter((entry) => entry.isFile() && ['.md', '.markdown', '.txt'].includes(extname(entry.name).toLowerCase()))
      .map((entry) => ({ name: entry.name, path: join(path, entry.name) }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }))
    return { path, files }
  } catch {
    return { path, files: [], error: 'This folder is unavailable. Check its location and permissions.' }
  }
}

export async function openDocumentDialog(win: BrowserWindow): Promise<OpenFileResult | null> {
  let defaultPath = join(app.getPath('documents'), 'Lumina')
  const cached = store.get('lastOpenDirectory')
  if (cached) {
    try {
      if ((await stat(cached)).isDirectory()) defaultPath = cached
    } catch { /* Fall back when the remembered folder no longer exists. */ }
  }
  const result = await dialog.showOpenDialog(win, {
    defaultPath,
    filters: [
      { name: 'All Supported', extensions: ['md', 'markdown', 'txt'] },
      { name: 'Markdown', extensions: ['md', 'markdown'] },
      { name: 'Plain Text', extensions: ['txt'] },
    ],
    properties: ['openFile'],
  })
  if (result.canceled || !result.filePaths[0]) return null
  const path = result.filePaths[0]
  try {
    const raw = await readFile(path, 'utf8')
    store.set('lastOpenDirectory', dirname(path))
    return { path, content: raw.startsWith('\uFEFF') ? raw.slice(1) : raw }
  } catch {
    await dialog.showMessageBox(win, { type: 'error', message: 'Unable to open file', detail: 'Check that the file still exists and that you have permission to read it.' })
    return null
  }
}
