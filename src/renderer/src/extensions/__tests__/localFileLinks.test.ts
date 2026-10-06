import { describe, expect, it, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from 'tiptap-markdown'
import { LocalFileMarkdown } from '../localFileMarkdown'
import { handleEditorLinkClick, isLocalLink, NAVIGATE_LINK } from '../../utils/linkNavigation'
import { resolveDocumentLink } from '../../../../main/linkResolver'

describe('Markdown link to editor click integration', () => {
  it.each([
    ['[文档](file:///D:/notes/a%20b.md)', 'D:\\notes\\a b.md'],
    ['[文档](D:/notes/a.md)', 'D:\\notes\\a.md'],
    ['[文档](<./中文 空格.md>)', 'C:\\notes\\中文 空格.md'],
    ['[文档](./a%23b.md)', 'C:\\notes\\a#b.md'],
  ])('preserves and routes %s', (source, path) => {
    const editor = new Editor({
      extensions: [StarterKit.configure({ link: { openOnClick: false, isAllowedUri: (url, ctx) => isLocalLink(url) || ctx.defaultValidate(url) } }), Markdown, LocalFileMarkdown],
      content: source,
    })
    const navigate = vi.fn()
    window.addEventListener(NAVIGATE_LINK, navigate)
    try {
      const link = editor.view.dom.querySelector('a')
      expect(link).not.toBeNull()
      const event = new MouseEvent('click', { cancelable: true })
      Object.defineProperty(event, 'target', { value: link })
      expect(handleEditorLinkClick(event)).toBe(true)
      expect(event.defaultPrevented).toBe(true)
      const href = (navigate.mock.calls[0][0] as CustomEvent<string>).detail
      expect(resolveDocumentLink(href, 'C:\\notes\\index.md', 'win32')).toEqual({ kind: 'document', path, anchor: '' })
    } finally {
      window.removeEventListener(NAVIGATE_LINK, navigate)
      editor.destroy()
    }
  })
})
