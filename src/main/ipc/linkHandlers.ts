import { ipcMain, shell } from 'electron'
import { realpath, stat } from 'fs/promises'
import { isAbsolute } from 'path'
import { pathToFileURL } from 'url'
import { IPC } from '../../renderer/src/types/ipc'
import type { ResolveLinkResult } from '../../renderer/src/types/link'
import { isAllowedAttachment, resolveDocumentLink } from '../linkResolver'

export function registerLinkHandlers(): void {
  ipcMain.handle(IPC.LINK_RESOLVE, (_, href: string, documentPath: string | null): ResolveLinkResult => {
    try { return { target: resolveDocumentLink(href, documentPath) } }
    catch (error) { return { error: error instanceof Error ? error.message : 'Unable to resolve link.' } }
  })
  ipcMain.handle(IPC.LINK_OPEN_ATTACHMENT, async (_, path: string): Promise<string> => {
    try {
      if (typeof path !== 'string' || !isAbsolute(path) || !isAllowedAttachment(path)) return 'Unsupported attachment.'
      // Reuse the path validation at the privileged boundary; do not trust renderer input.
      resolveDocumentLink(pathToFileURL(path).href, null)
      const actualPath = await realpath(path)
      resolveDocumentLink(pathToFileURL(actualPath).href, null)
      if (!isAllowedAttachment(actualPath) || !(await stat(actualPath)).isFile()) return 'Unsupported attachment.'
      return await shell.openPath(actualPath)
    } catch { return 'Unable to open attachment. Check that the file exists.' }
  })
}
