import { describe, expect, it } from 'vitest'
import MarkdownIt from 'markdown-it'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from 'tiptap-markdown'
import { ChineseStrong, installChineseStrong } from '../chineseStrong'

const md = new MarkdownIt({ html: true })
installChineseStrong(md)

describe('Chinese strong punctuation boundaries', () => {
  it.each([
    ['read**“重点”**now', 'read<strong>“重点”</strong>now'],
    ['**追问：工作线程抛异常怎么办？**', '<strong>追问：工作线程抛异常怎么办？</strong>'],
    ['这是**“*重点*”**后文', '这是<strong>“<em>重点</em>”</strong>后文'],
    ['[**重点：**后文](./doc.md)', '<a href="./doc.md"><strong>重点：</strong>后文</a>'],
  ])('parses %s', (source, html) => {
    expect(md.renderInline(source)).toBe(html)
  })

  it.each([
    '`**重点：**后文`',
    '```md\n**重点：**后文\n```',
    '    **重点：**后文',
    '\\*\\*重点：\\*\\*后文',
    '[文件](./**重点：**后文.md)',
    '<div>\n**重点：**后文\n</div>',
    '** 加粗 **',
    '*普通斜体* **ordinary bold** ___bold italic___',
    '这是*“单星号”*后文',
    '这是***“三颗星”***后文',
    '**punctuation!**suffix',
    '**未闭合：后文',
  ])('preserves standard parsing of %s', (source) => {
    expect(md.render(source)).toBe(new MarkdownIt({ html: true }).render(source))
  })

  it('round-trips through the actual editor repeatedly without escaping strong markers', () => {
    const editor = new Editor({
      extensions: [StarterKit.configure({ bold: false }), Markdown.configure({ html: true }), ChineseStrong],
      content: '',
    })
    try {
      const source = '**追问：工作线程抛异常怎么办？**后续正文\n\n这是**“重点”**后文'
      editor.commands.setContent(source)
      const expected = '<p><strong>追问：工作线程抛异常怎么办？</strong>后续正文</p><p>这是<strong>“重点”</strong>后文</p>'
      expect(editor.getHTML()).toBe(expected)
      for (let i = 0; i < 3; i++) {
        const saved = (editor.storage as unknown as { markdown: { getMarkdown(): string } }).markdown.getMarkdown()
        expect(saved).toBe(source)
        editor.commands.setContent(saved)
        expect(editor.getHTML()).toBe(expected)
      }
      editor.commands.setContent('<p>前文<strong> spaced bold </strong>后文</p>')
      const spaced = editor.getHTML()
      const saved = (editor.storage as unknown as { markdown: { getMarkdown(): string } }).markdown.getMarkdown()
      expect(saved).toContain('<strong> spaced bold </strong>')
      editor.commands.setContent(saved)
      expect(editor.getHTML()).toBe(spaced)
      editor.commands.setContent('**追问：工作线程抛异常怎么办？**Future/Promise')
      const mixed = editor.getHTML()
      editor.commands.setContent((editor.storage as unknown as { markdown: { getMarkdown(): string } }).markdown.getMarkdown())
      expect(editor.getHTML()).toBe(mixed)
      editor.commands.setContent('前文**“重点[链接](https://example.com)*斜体*！”**后文')
      const nested = editor.getHTML()
      expect(nested).toContain('<strong>')
      expect(nested).toContain('<a ')
      expect(nested).toContain('<em>')
      editor.commands.setContent((editor.storage as unknown as { markdown: { getMarkdown(): string } }).markdown.getMarkdown())
      expect(editor.getHTML()).toBe(nested)
      for (const html of [
        '<p><strong>word.</strong>next</p>',
        '<p>before<strong>!word</strong></p>',
        '<p><strong>word$</strong>next</p>',
      ]) {
        editor.commands.setContent(html)
        const beforeSave = editor.getHTML()
        const markdown = (editor.storage as unknown as { markdown: { getMarkdown(): string } }).markdown.getMarkdown()
        expect(markdown).toContain('<strong>')
        editor.commands.setContent(markdown)
        expect(editor.getHTML()).toBe(beforeSave)
      }
    } finally {
      editor.destroy()
    }
  })
})
