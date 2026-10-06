import type { AppSettings, CopyImageArgs, DirectoryListing, OpenFileResult, RecentFile, SaveAsResult } from './file'
import type { ResolveLinkResult } from './link'
import type { CloseDocumentChoice, FileIdentityResult, SavePathResult } from './tab'

export type Unsubscribe = () => void
export type Platform = 'win32' | 'darwin' | 'linux' | 'android' | 'ios'

/** Shared application boundary. Native hosts supply this interface before React starts. */
export interface AppApi {
  host?: 'tauri' | 'electron' | 'web'
  platform: Platform
  capabilities?: { nativeSpellcheck: boolean }
  inspectFilePath(path: string): Promise<FileIdentityResult>
  chooseSavePath(currentPath?: string): Promise<SavePathResult>
  confirmDocumentClose(name: string): Promise<CloseDocumentChoice>
  onRequestClose(callback: () => void): Unsubscribe
  completeWindowClose(allowed: boolean): void
  resolveLink(href: string, documentPath: string | null): Promise<ResolveLinkResult>
  openAttachment(path: string): Promise<string>
  openFile(): Promise<OpenFileResult | null>
  openFilePath(path: string): Promise<OpenFileResult | null>
  listDirectory(documentPath: string): Promise<DirectoryListing>
  saveFile(path: string, content: string): Promise<boolean>
  saveFileAs(content: string, currentPath?: string): Promise<SaveAsResult | null>
  readInitialFile(): Promise<OpenFileResult | null>
  copyImageToDoc(args: CopyImageArgs): Promise<string>
  importImagePath?(sourcePath: string, documentPath: string | null): Promise<string>
  pasteImage(args: { buffer: number[]; mimeType: string; documentPath: string | null }): Promise<string>
  getRecentFiles(): Promise<RecentFile[]>
  addRecentFile(path: string, snippet?: string): Promise<void>
  removeRecentFile(path: string): Promise<void>
  pinRecentFile(path: string): Promise<RecentFile[]>
  revealFile(path: string): Promise<void>
  renameFile(oldPath: string, newName: string): Promise<{ newPath: string } | null>
  getSettings(): Promise<AppSettings>
  setSettings(partial: Partial<AppSettings>): Promise<void>
  onOpenFile(callback: (path: string | null) => void): Unsubscribe
  onMenuSave(callback: () => void): Unsubscribe
  onMenuSaveAs(callback: () => void): Unsubscribe
  onThemeChange(callback: (theme: 'light' | 'dark') => void): Unsubscribe
  onNativeDrop?(callback: (paths: string[]) => void): Unsubscribe
  openExternal(url: string): Promise<void>
  exportHtml(args: { defaultPath: string; content: string }): Promise<{ path: string } | null>
  exportPdf?(args: { defaultPath: string }): Promise<{ path: string } | null>
  exportDocx?(args: { defaultPath: string; html: string; title: string }): Promise<{ path: string } | null>
  exportBinary?(args: { defaultPath: string; buffer: number[]; format: 'pdf' | 'docx' }): Promise<{ path: string } | null>
  getSpellSuggestions(): Promise<{ misspelledWord: string; suggestions: string[] }>
  replaceMisspelling(word: string): void
  getPathForFile(file: File): string
  displayMediaUrl?(url: string): string
}
