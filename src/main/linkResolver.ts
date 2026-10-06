import { posix, win32 } from 'path'
import { fileURLToPath } from 'url'
import type { LinkTarget } from '../renderer/src/types/link'

const documentExtensions = new Set(['.md', '.markdown', '.txt'])
// Explicit, non-executable attachment formats. Rechecked after resolving symlinks.
const attachmentExtensions = new Set(['.pdf', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.avif', '.mp3', '.wav', '.ogg', '.mp4', '.webm'])

export function isAllowedAttachment(path: string): boolean {
  return attachmentExtensions.has(win32.extname(path).toLowerCase())
}

export function resolveDocumentLink(href: string, documentPath: string | null, platform = process.platform): LinkTarget {
  if (typeof href !== 'string' || !href.trim() || /[\u0000-\u001f]/.test(href)) throw new Error('Invalid link address.')
  const value = href.trim()
  if (/^(https?:|mailto:)/i.test(value)) return { kind: 'external', url: new URL(value).href }
  const hash = value.indexOf('#')
  const anchor = hash < 0 ? '' : decodeURIComponent(value.slice(hash + 1))
  if (value.startsWith('#')) return { kind: 'anchor', anchor }
  let pathname = hash < 0 ? value : value.slice(0, hash)
  const windows = platform === 'win32'
  const paths = windows ? win32 : posix
  if (/^file:/i.test(pathname)) {
    const url = new URL(pathname)
    if (url.search) throw new Error('File links cannot contain a query string.')
    pathname = fileURLToPath(url, { windows })
  } else {
    if (/^[a-z][a-z\d+.-]*:/i.test(pathname) && !/^[a-z]:[/\\]/i.test(pathname)) throw new Error('This link protocol is not supported.')
    pathname = decodeURIComponent(pathname)
  }
  if (/[\u0000-\u001f]/.test(pathname)) throw new Error('Invalid file path.')
  // Device paths and network shares should never be opened implicitly by document content.
  if (/^[/\\]{2}/.test(pathname)) throw new Error('Network and device paths are not supported.')
  if (windows && /:/.test(pathname.replace(/^[a-z]:/i, ''))) throw new Error('Invalid Windows file path.')
  if (!paths.isAbsolute(pathname)) {
    if (!documentPath) throw new Error('Save this document before opening a relative link.')
    pathname = paths.resolve(paths.dirname(documentPath), pathname)
  } else pathname = paths.normalize(pathname)
  const extension = paths.extname(pathname).toLowerCase()
  if (documentExtensions.has(extension)) return { kind: 'document', path: pathname, anchor }
  if (isAllowedAttachment(pathname)) return { kind: 'attachment', path: pathname, anchor }
  throw new Error('This file type cannot be opened from a document link.')
}
