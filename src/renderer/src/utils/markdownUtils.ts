/**
 * markdownUtils.ts
 *
 * Utilities for preprocessing markdown content before loading into the editor
 * and postprocessing before saving back to disk.
 *
 * The core concern: relative image paths in markdown (e.g. `src="build/icon.png"`
 * or `![icon](images/photo.jpg)`) cannot be resolved by the browser without an
 * explicit base. We convert them to `media://` absolute URLs when loading so they
 * render correctly via Electron's custom protocol handler, then restore the
 * original relative paths when saving so the file on disk is never corrupted.
 */

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Return the directory portion of an absolute file path (cross-platform). */
export function docDir(filePath: string): string {
  return filePath.replace(/\\/g, '/').split('/').slice(0, -1).join('/')
}

/** Convert an absolute OS path to a file:// URL. */
export function pathToFileUrl(absPath: string): string {
  const normalized = absPath.replace(/\\/g, '/').replace(/[ %#?]/g, encodeURIComponent)
  // On Windows paths start with a drive letter (C:/...), on Unix with /
  return normalized.startsWith('/') ? `file://${normalized}` : `file:///${normalized}`
}

/**
 * Convert an absolute OS path to a `media://` URL served by Electron's custom
 * protocol handler.  We use `media://` (not `file://`) for local images because
 * Electron's webSecurity blocks `file://` URLs in the renderer process.
 *
 * URL format: `media://local<absPath>`
 *
 * The dummy host `local` is required because the `media` scheme is registered
 * with `standard:true`, which makes Chromium parse it like an HTTP URL.
 * Without an explicit host, `media:///Users/alice/...` gets normalised to
 * `media://users/alice/...` — Chromium steals the first path segment as the
 * (lowercased) hostname and truncates the real path.  Using `media://local/`
 * keeps the full path intact in `URL.pathname`.
 */
export function pathToMediaUrl(absPath: string): string {
  const normalized = absPath.replace(/\\/g, '/')
  // Ensure the path starts with / so it appends cleanly after the host
  const path = normalized.startsWith('/') ? normalized : '/' + normalized
  return `media://local${path}`
}

/** True if a src value is already an absolute URL that doesn't need resolving. */
function isAbsoluteUrl(src: string): boolean {
  return /^(https?:|data:|file:|media:|blob:|\/\/|\/)/i.test(src.trim())
}

/** Map image destinations while preserving HTML quoting and Markdown titles. */
function mapImages(content: string, transform: (src: string) => string): string {
  const html = content.replace(/(<img\b[^>]*?\bsrc=)(["'])([^"']*?)\2/gi,
    (_, pre, quote, src) => pre + quote + transform(src) + quote)
  return html.replace(/!\[([^\]]*)\]\((<[^>]*>|[^)\s"]+)((?:\s+"[^"]*")?)\)/g,
    (_, alt, destination, title) => {
      const angle = destination.startsWith('<')
      const next = transform(angle ? destination.slice(1, -1) : destination)
      return '![' + alt + '](' + (angle ? '<' + next + '>' : next.replace(/ /g, '%20')) + title + ')'
    })
}

function localUrlPath(src: string): string | null {
  try {
    const url = new URL(src)
    if (!((url.protocol === 'media:' && url.hostname === 'local') ||
      (url.protocol === 'file:' && (!url.hostname || url.hostname === 'localhost')))) return null
    const path = decodeURIComponent(url.pathname)
    return /^\/[a-z]:\//i.test(path) ? path.slice(1) : path
  } catch { return null }
}

function segments(path: string): string[] {
  const parts: string[] = []
  for (const part of path.replace(/\\/g, '/').split('/')) {
    if (part === '..') parts.pop()
    else if (part && part !== '.') parts.push(part)
  }
  return parts
}

function relativeImagePath(imagePath: string, filePath: string): string {
  const from = segments(docDir(filePath))
  const to = segments(imagePath)
  const windows = /^[a-z]:/i.test(from[0] ?? '')
  const same = (a: string, b: string) => windows ? a.toLowerCase() === b.toLowerCase() : a === b
  if (windows !== /^[a-z]:/i.test(to[0] ?? '') || (windows && !same(from[0], to[0]))) {
    return pathToFileUrl(imagePath).replace(/ /g, '%20')
  }
  let common = 0
  while (common < from.length && common < to.length && same(from[common], to[common])) common++
  return [...from.slice(common).map(() => '..'), ...to.slice(common)].join('/').replace(/[%#?]/g, encodeURIComponent)
}

// ── HTML normalisation (load-time) ────────────────────────────────────────────

/**
 * Convert the deprecated HTML `align="center|left|right"` attribute on block
 * elements to an inline `style="text-align:..."` so that TipTap's TextAlign
 * extension (which reads `element.style.textAlign`) picks it up correctly.
 *
 * Many GitHub README files use `<p align="center">` and `<h1 align="center">`
 * which are valid in older HTML but not parsed by modern style-based tools.
 */
export function normalizeAlignAttributes(content: string): string {
  return content.replace(
    /(<(?:p|h[1-6])\b[^>]*?)\s+align="(left|center|right)"/gi,
    (_, tag, val) => `${tag} style="text-align:${val}"`
  )
}

// ── Resolve (load-time) ───────────────────────────────────────────────────────

/**
 * Replace relative image sources in markdown content with absolute `media://`
 * URLs so the editor can load local images via Electron's custom protocol.
 *
 * Handles:
 *   - HTML img tags:      src="relative/path"
 *   - Markdown images:    ![alt](relative/path)  and  ![alt](relative/path "title")
 */
export function resolveRelativeImagePaths(content: string, filePath: string): string {
  const dir = docDir(filePath)
  return mapImages(content, src => {
    if (/^file:/i.test(src)) {
      const local = localUrlPath(src)
      return local ? pathToMediaUrl(local.replace(/[%#?]/g, encodeURIComponent)) : src
    }
    if (isAbsoluteUrl(src)) return src
    return pathToMediaUrl(`${dir}/${src}`)
  })
}

// ── Unresolve (save-time) ─────────────────────────────────────────────────────

/**
 * Convert every local media URL relative to the destination document directory.
 * Cross-drive images use file URLs, which load through media on the next open.
 */
export function unresolveRelativeImagePaths(content: string, filePath: string): string {
  return mapImages(content, src => {
    if (!/^media:\/\/local\//i.test(src)) return src
    const local = localUrlPath(src)
    return local ? relativeImagePath(local, filePath) : src
  })
}

/** Keep image targets stable when saving a document in another folder. */
export function rebaseImagePaths(content: string, oldPath: string | null, newPath: string): string {
  return unresolveRelativeImagePaths(oldPath ? resolveRelativeImagePaths(content, oldPath) : content, newPath)
}
