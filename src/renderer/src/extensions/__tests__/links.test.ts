import { describe, expect, it, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from 'tiptap-markdown'
import MarkdownIt from 'markdown-it'
import { LocalFileMarkdown, installLocalFileLinks } from '../localFileMarkdown'
import { handleEditorLinkClick, isLocalLink, NAVIGATE_LINK, findAnchor, normalizeLinkInput } from '../../utils/linkNavigation'
import { resolveDocumentLink } from '../../../../main/linkResolver'

describe('local Markdown links', () => {
  const md = new MarkdownIt()
  installLocalFileLinks(md)
  installLocalFileLinks(md)

  it.each(['javascript:alert(1)', 'vbscript:alert(1)', 'data:text/html,test'])('retains the rejection of %s', href => {
    expect(md.renderInline(`[notes](${href})`)).not.toContain('<a href=')
  })

  it.each([
    ['[文档](FILE:///D:/notes/a%20b.md)', 'D:\\notes\\a b.md'],
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

describe('link navigation UI helpers', () => {
  it.each(['./next.md', 'notes.md', '../a b.md#标题', 'C:\\notes\\a.md', 'file:///C:/a.md', '#标题'])('preserves %s in the link dialog', value => {
    expect(normalizeLinkInput(value)).toBe(value)
  })
  it.each(['example.com/path', 'docs.example.com', 'baidu.cn', 'example.co.uk'])('expands bare website %s', value => {
    expect(normalizeLinkInput(value)).toBe(`https://${value}`)
  })
  it('finds Chinese and duplicate heading anchors', () => {
    const root = document.createElement('div')
    root.innerHTML = '<h1>中文 标题！</h1><h2>中文 标题！</h2><h3 id="explicit">Other</h3>'
    expect(findAnchor(root, '中文-标题')).toBe(root.children[0])
    expect(findAnchor(root, '中文-标题-1')).toBe(root.children[1])
    expect(findAnchor(root, 'explicit')).toBe(root.children[2])
    expect(findAnchor(root, 'missing')).toBeNull()
  })
})
