import { describe, expect, it } from 'vitest'
import MarkdownIt from 'markdown-it'
import { installLocalFileLinks } from '../localFileMarkdown'

describe('local Markdown file links', () => {
  const md = new MarkdownIt()
  installLocalFileLinks(md)
  installLocalFileLinks(md)
  it.each(['file:///C:/docs/notes.md', 'FILE:///D:/notes.md', './notes.md', 'https://example.com'])('allows %s', href => {
    expect(md.renderInline(`[notes](${href})`)).toContain('<a href=')
  })
  it.each(['javascript:alert(1)', 'vbscript:alert(1)', 'data:text/html,test'])('retains the rejection of %s', href => {
    expect(md.renderInline(`[notes](${href})`)).not.toContain('<a href=')
  })
})
