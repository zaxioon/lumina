import { afterEach, describe, expect, it, vi } from 'vitest'
import JSZip from 'jszip'
import { buildDocxExport } from '../docxExport'
import { act, cleanup, renderHook } from '@testing-library/react'
import type { Editor } from '@tiptap/react'
import { useExport } from '../../hooks/useExport'
import { useAppStore } from '../../store/appStore'
import { printDocument } from '../printDocument'

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('browser Word export', () => {
  it('writes actual OOXML text, formatting, lists, tables, relationships and embedded image bytes', async () => {
    const base64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='
    const png = Uint8Array.from(atob(base64), char => char.charCodeAt(0))
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === 'https://example.com/missing.png') throw new Error('unavailable')
      return new Response(png, { headers: { 'Content-Type': 'image/png' } })
    }))
    const output = await buildDocxExport(`
      <h1>中文文档</h1><p><strong>Bold</strong> <em>Italic</em> <a href="https://example.com">Link</a></p>
      <ol start="3"><li><p>First</p><ul><li><p>Nested</p></li></ul></li><li><p>Second</p></li></ol>
      <table><tr><th colspan="2">Header</th></tr><tr><td><p>A</p></td><td><p>B</p></td></tr></table>
      <p><img src="media://local/C:/image.png" width="1" height="1" alt="Pixel" /></p>
      <p><img src="data:image/png;base64,${base64}" width="1" height="1" alt="Inline pixel" /></p>
      <p><img src="https://example.com/missing.png" alt="Missing" /></p>`, '中文文档', url => url.replace('media://local/', 'http://media.localhost/'))
    const zip = await JSZip.loadAsync(output.bytes)
    const xml = await zip.file('word/document.xml')!.async('string')
    const document = new DOMParser().parseFromString(xml, 'application/xml')
    const ns = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
    const tags = (tag: string) => Array.from(document.getElementsByTagNameNS(ns, tag))
    expect(tags('t').map(node => node.textContent).join(' ')).toContain('中文文档')
    expect(tags('pStyle').some(node => node.getAttributeNS(ns, 'val') === 'Heading1')).toBe(true)
    expect(tags('b').length).toBeGreaterThan(0)
    expect(tags('i').length).toBeGreaterThan(0)
    expect(tags('numPr')).toHaveLength(3)
    expect(tags('tbl')).toHaveLength(1)
    expect(tags('tc')).toHaveLength(3)
    expect(tags('gridSpan')[0].getAttributeNS(ns, 'val')).toBe('2')
    const numbering = await zip.file('word/numbering.xml')!.async('string')
    expect(numbering).toContain('w:start w:val="3"')
    const relationships = await zip.file('word/_rels/document.xml.rels')!.async('string')
    expect(relationships).toContain('https://example.com')
    expect(relationships).toContain('/image')
    const media = Object.values(zip.files).filter(entry => entry.name.startsWith('word/media/') && !entry.dir)
    expect(media).toHaveLength(1)
    expect(tags('drawing')).toHaveLength(2)
    expect(await media[0].async('uint8array')).toEqual(png)
    expect(vi.mocked(fetch).mock.calls.every(([url]) => !String(url).startsWith('data:'))).toBe(true)
    expect(output.omittedImages).toBe(1)
    expect(tags('t').map(node => node.textContent).join(' ')).toContain('[Image unavailable: Missing]')
  })

  it('does not report an export when the native save dialog is canceled', async () => {
    const originalExport = window.api.exportBinary
    const originalToast = useAppStore.getState().showToast
    const showToast = vi.fn()
    const save = vi.fn().mockResolvedValue(null)
    window.api.exportBinary = save
    useAppStore.setState({ showToast })
    try {
      const editor = { getHTML: () => '<p>Unsaved document</p>' } as unknown as Editor
      const { result } = renderHook(() => useExport(editor))
      await act(async () => { await result.current.exportDocx() })
      expect(save).toHaveBeenCalledOnce()
      expect(save.mock.calls[0][0].format).toBe('docx')
      expect(showToast).not.toHaveBeenCalled()
    } finally {
      window.api.exportBinary = originalExport
      useAppStore.setState({ showToast: originalToast })
    }
  })

  it('prepares only the document for system printing and cleans up after the dialog closes', async () => {
    const title = document.title
    const print = vi.spyOn(window, 'print').mockImplementation(() => {})
    await printDocument('<h1>Print document</h1><p>Content</p>', 'Print document')
    expect(print).toHaveBeenCalledOnce()
    expect(document.querySelector('#lumina-print-root article')?.textContent).toBe('Print documentContent')
    window.dispatchEvent(new Event('afterprint'))
    expect(document.getElementById('lumina-print-root')).toBeNull()
    expect(document.title).toBe(title)
  })
})
