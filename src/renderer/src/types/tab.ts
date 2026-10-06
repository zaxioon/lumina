import type { FileState } from './file'

export interface DocumentTab extends FileState {
  id: string
  revision: number
  identity?: string
}

export type CloseDocumentChoice = 'save' | 'discard' | 'cancel'
export type FileIdentityResult = { path: string; identity: string; error?: never } | { error: string; path?: never; identity?: never }
export type SavePathResult = { path: string; error?: never } | { error: string; path?: never } | null
