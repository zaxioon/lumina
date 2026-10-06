import {
  AlignmentType, Document, ExternalHyperlink, HeadingLevel, ImageRun, LevelFormat,
  Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType,
} from 'docx'
import type { IRunOptions, ParagraphChild } from 'docx'

type Block = Paragraph | Table
type ImageData = { bytes: Uint8Array; type: 'png' | 'jpg' | 'gif' | 'bmp'; width: number; height: number }
export type DocxExportResult = { bytes: Uint8Array; omittedImages: number }

function decodeDataImage(src: string): { bytes: Uint8Array; mime: string } {
  const comma = src.indexOf(',')
  if (comma < 0) throw new Error('Invalid image data URL')
  const metadata = src.slice(5, comma)
  const mime = metadata.split(';')[0]
  if (!/^image\//i.test(mime)) throw new Error('Expected image data')
  const payload = src.slice(comma + 1)
  if (/;base64$/i.test(metadata)) return { bytes: Uint8Array.from(atob(payload), char => char.charCodeAt(0)), mime }
  const bytes = [...payload.matchAll(/%[\da-f]{2}|[\s\S]/giu)].flatMap(([part]) => part.startsWith('%') && part.length === 3
    ? [parseInt(part.slice(1), 16)] : Array.from(new TextEncoder().encode(part)))
  return { bytes: Uint8Array.from(bytes), mime }
}

async function decodeImage(src: string): Promise<HTMLImageElement> {
  const image = new Image()
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Image decoding timed out')), 10000)
    image.onload = () => { clearTimeout(timer); resolve() }
    image.onerror = () => { clearTimeout(timer); reject(new Error('Image decoding failed')) }
    image.src = src
  })
  return image
}

/** Load pixels in the WebView; unsupported Word image formats are rasterized. */
async function loadImage(element: HTMLImageElement, displayUrl: (url: string) => string): Promise<ImageData> {
  const src = displayUrl(element.getAttribute('src') ?? '')
  // Inline data is decoded locally; blob pixels use the existing image/canvas
  // permission. Neither path needs a fetch or a broader connect-src policy.
  const isBlobUrl = /^blob:/i.test(src)
  let blob: Blob | undefined
  let bytes: Uint8Array = new Uint8Array()
  if (/^data:/i.test(src)) {
    const data = decodeDataImage(src)
    bytes = data.bytes
  } else if (!isBlobUrl) {
    const response = await fetch(src, { signal: AbortSignal.timeout(15000) })
    if (!response.ok) throw new Error('Image could not be loaded')
    blob = await response.blob()
    bytes = new Uint8Array(await blob.arrayBuffer())
  }
  const type = bytes[0] === 0x89 && bytes[1] === 0x50 ? 'png'
    : bytes[0] === 0xff && bytes[1] === 0xd8 ? 'jpg'
      : bytes[0] === 0x47 && bytes[1] === 0x49 ? 'gif'
        : bytes[0] === 0x42 && bytes[1] === 0x4d ? 'bmp' : null
  let width = Number(element.getAttribute('width'))
  let height = Number(element.getAttribute('height'))
  let image: HTMLImageElement | undefined
  let objectUrl: string | undefined
  try {
    if (!type || !(width > 0 && height > 0)) {
      if (blob) objectUrl = URL.createObjectURL(blob)
      image = await decodeImage(objectUrl ?? src)
      if (width > 0 && !(height > 0)) height = width * image.naturalHeight / image.naturalWidth
      else if (height > 0 && !(width > 0)) width = height * image.naturalWidth / image.naturalHeight
      else if (!(width > 0 && height > 0)) { width = image.naturalWidth; height = image.naturalHeight }
    }
    if (!(width > 0 && height > 0)) throw new Error('Invalid image dimensions')
    const scale = Math.min(1, 600 / width)
    width = Math.max(1, Math.round(width * scale))
    height = Math.max(1, Math.round(height * scale))
    if (type) return { bytes, type, width, height }
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context || !image) throw new Error('Image conversion is unavailable')
    context.drawImage(image, 0, 0, width, height)
    const png = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('Image conversion failed')), 'image/png'))
    return { bytes: new Uint8Array(await png.arrayBuffer()), type: 'png', width, height }
  } finally {
    if (objectUrl) URL.revokeObjectURL(objectUrl)
  }
}

/** Convert editor HTML into native OOXML paragraphs, lists, tables and images. */
export async function buildDocxExport(html: string, title: string, displayUrl: (url: string) => string = url => url): Promise<DocxExportResult> {
  const root = new DOMParser().parseFromString(html, 'text/html').body
  let omittedImages = 0
  const numbering: NonNullable<ConstructorParameters<typeof Document>[0]['numbering']>['config'][number][] = []
  const headings = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6]

  async function inline(nodes: Iterable<ChildNode>, marks: IRunOptions = {}): Promise<ParagraphChild[]> {
    const result: ParagraphChild[] = []
    for (const node of nodes) {
      if (node.nodeType === Node.TEXT_NODE) { result.push(new TextRun({ ...marks, text: node.textContent ?? '' })); continue }
      if (!(node instanceof HTMLElement)) continue
      const tag = node.tagName.toLowerCase()
      if (['script', 'style', 'input', 'button'].includes(tag)) continue
      if (tag === 'br') { result.push(new TextRun({ ...marks, break: 1 })); continue }
      if (tag === 'img') {
        try {
          const image = await loadImage(node as HTMLImageElement, displayUrl)
          result.push(new ImageRun({ data: image.bytes, type: image.type, transformation: { width: image.width, height: image.height }, altText: { title: node.getAttribute('alt') ?? '', description: node.getAttribute('alt') ?? '', name: 'Image' } }))
        } catch {
          omittedImages++
          result.push(new TextRun({ text: `[Image unavailable: ${node.getAttribute('alt') || 'image'}]`, italics: true }))
        }
        continue
      }
      const childMarks: IRunOptions = {
        ...marks,
        ...(['strong', 'b'].includes(tag) ? { bold: true } : {}),
        ...(['em', 'i'].includes(tag) ? { italics: true } : {}),
        ...(['s', 'del', 'strike'].includes(tag) ? { strike: true } : {}),
        ...(tag === 'u' ? { underline: {} } : {}),
        ...(tag === 'code' ? { font: 'Consolas' } : {}),
      }
      const children = await inline(node.childNodes, childMarks)
      const href = node.getAttribute('href') ?? ''
      result.push(...(tag === 'a' && /^(https?:|mailto:)/i.test(href)
        ? [new ExternalHyperlink({ link: href, children })] : children))
    }
    return result
  }

  async function blocks(container: Element, depth = 0): Promise<Block[]> {
    const result: Block[] = []
    for (const node of container.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) {
        if (node.textContent?.trim()) result.push(new Paragraph({ children: await inline([node]) }))
        continue
      }
      if (!(node instanceof HTMLElement)) continue
      const tag = node.tagName.toLowerCase()
      if (['script', 'style', 'button'].includes(tag)) continue
      if (tag === 'table') {
        const rows: TableRow[] = []
        for (const row of (node as HTMLTableElement).rows) {
          const cells: TableCell[] = []
          for (const cell of row.cells) {
            const children = await blocks(cell, depth)
            cells.push(new TableCell({ children: children.length ? children : [new Paragraph('')], columnSpan: cell.colSpan > 1 ? cell.colSpan : undefined, rowSpan: cell.rowSpan > 1 ? cell.rowSpan : undefined, shading: cell.tagName === 'TH' ? { fill: 'F3F4F6' } : undefined }))
          }
          if (cells.length) rows.push(new TableRow({ children: cells, tableHeader: row.parentElement?.tagName === 'THEAD' || Array.from(row.cells).every(cell => cell.tagName === 'TH') }))
        }
        if (rows.length) result.push(new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } }))
        continue
      }
      if (tag === 'ul' || tag === 'ol') {
        const reference = `list-${numbering.length}`
        const level = Math.min(depth, 8)
        const task = node.getAttribute('data-type') === 'taskList'
        numbering.push({ reference, levels: Array.from({ length: 9 }, (_, index) => ({ level: index, format: tag === 'ol' ? LevelFormat.DECIMAL : LevelFormat.BULLET, text: tag === 'ol' ? `%${index + 1}.` : '•', start: Math.max(1, Number(node.getAttribute('start')) || 1), alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720 * (index + 1), hanging: 360 } } } })) })
        for (const item of Array.from(node.children).filter(child => child.tagName === 'LI')) {
          const copy = item.cloneNode(true) as HTMLElement
          const nested = Array.from(copy.children).filter(child => ['UL', 'OL'].includes(child.tagName))
          nested.forEach(child => child.remove())
          const paragraph = copy.querySelector('p')
          const children = await inline(paragraph ? paragraph.childNodes : copy.childNodes)
          if (task) children.unshift(new TextRun(item.getAttribute('data-checked') === 'true' ? '☑ ' : '☐ '))
          result.push(new Paragraph({ children, ...(task ? { indent: { left: 720 * level } } : { numbering: { reference, level } }) }))
          if (paragraph) {
            paragraph.remove()
            result.push(...await blocks(copy, depth + 1))
          }
          for (const list of nested) { const wrapper = document.createElement('div'); wrapper.append(list); result.push(...await blocks(wrapper, depth + 1)) }
        }
        continue
      }
      if (tag === 'pre') {
        for (const line of (node.textContent ?? '').split('\n')) result.push(new Paragraph({ children: [new TextRun({ text: line, font: 'Consolas', size: 20 })], spacing: { after: 0 }, shading: { fill: 'F3F4F6' } }))
        continue
      }
      if (['div', 'section', 'article', 'blockquote'].includes(tag)) { result.push(...await blocks(node, depth)); continue }
      const heading = /^h[1-6]$/.test(tag) ? headings[Number(tag[1]) - 1] : undefined
      const align = node.style.textAlign
      result.push(new Paragraph({ children: await inline(tag === 'img' ? [node] : node.childNodes), heading, alignment: align === 'center' ? AlignmentType.CENTER : align === 'right' ? AlignmentType.RIGHT : AlignmentType.LEFT, spacing: { after: 160 } }))
    }
    return result
  }

  const children = await blocks(root)
  const doc = new Document({ title, creator: 'Lumina', numbering: { config: numbering }, sections: [{ children: children.length ? children : [new Paragraph('')] }] })
  return { bytes: new Uint8Array(await Packer.toArrayBuffer(doc)), omittedImages }
}
