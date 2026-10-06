import '../styles/print.css'

let activeCleanup: (() => void) | undefined

/** Open the host print dialog. Its PDF save/cancel result is owned by the OS. */
export async function printDocument(html: string, title: string, displayUrl: (url: string) => string = url => url): Promise<void> {
  activeCleanup?.()
  const root = document.createElement('div')
  root.id = 'lumina-print-root'
  const article = document.createElement('article')
  article.innerHTML = html
  root.append(article)
  document.body.append(root)
  const originalTitle = document.title
  const cleanup = () => {
    root.remove()
    document.title = originalTitle
    window.removeEventListener('afterprint', cleanup)
    if (activeCleanup === cleanup) activeCleanup = undefined
  }
  activeCleanup = cleanup
  try {
    const images = Array.from(article.querySelectorAll('img'))
    images.forEach(image => { image.src = displayUrl(image.getAttribute('src') ?? '') })
    await Promise.all(images.map(image => new Promise<void>(resolve => {
      const timer = setTimeout(resolve, 15000)
      image.decode().catch(() => undefined).finally(() => { clearTimeout(timer); resolve() })
    })))
    await document.fonts?.ready
    if (activeCleanup !== cleanup) return
    document.title = title
    window.addEventListener('afterprint', cleanup, { once: true })
    window.print()
  } catch (error) { cleanup(); throw error }
}
