export const NAVIGATE_LINK = 'lumina:navigate-link'

export function requestLinkNavigation(href: string): void {
  window.dispatchEvent(new CustomEvent(NAVIGATE_LINK, { detail: href }))
}

export function handleEditorLinkClick(event: MouseEvent): boolean {
  const target = event.target
  if (!(target instanceof Element)) return false
  const href = target.closest('a')?.getAttribute('href')
  if (!href) return false
  event.preventDefault()
  requestLinkNavigation(href)
  return true
}

/** Preserve file addresses; only expand clear bare web domains. */
export function normalizeLinkInput(value: string): string {
  const trimmed = value.trim()
  if (/^(?:[.#/\\]|[a-z]:|[a-z][a-z\d+.-]*:)/i.test(trimmed) || /\.(?:md|markdown|txt|pdf|png|jpe?g|gif|webp|bmp|avif|mp3|wav|ogg|mp4|webm|exe|cmd|bat|ps1|lnk)(?:#.*)?$/i.test(trimmed)) return trimmed
  return /^(?:[a-z\d](?:[a-z\d-]*[a-z\d])?\.)+[a-z]{2,}(?::\d+)?(?:[/?#]|$)/i.test(trimmed)
    ? `https://${trimmed}` : trimmed
}

export function isLocalLink(value: string): boolean {
  return /^file:/i.test(value) || /^[a-z]:[/\\]/i.test(value)
}

export function sameDocumentPath(left: string | null, right: string | null): boolean {
  if (!left || !right) return left === right
  const normalize = (value: string): string => {
    const slashes = value.replace(/\\/g, '/')
    return /^[a-z]:\//i.test(slashes) ? slashes.toLowerCase() : slashes
  }
  return normalize(left) === normalize(right)
}

/** Unicode-aware heading ids, with stable suffixes for duplicate headings. */
export function findAnchor(root: HTMLElement, anchor: string): HTMLElement | null {
  const byId = Array.from(root.querySelectorAll<HTMLElement>('[id]')).find(el => el.id === anchor)
  if (byId) return byId
  const used = new Set<string>()
  for (const heading of root.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6')) {
    const base = (heading.textContent ?? '').toLowerCase().replace(/[^\p{L}\p{N}\p{M}_\s-]/gu, '').trim().replace(/\s/g, '-')
    let slug = base
    let suffix = 0
    while (used.has(slug)) slug = `${base}-${++suffix}`
    used.add(slug)
    if (slug === anchor) return heading
  }
  return null
}
