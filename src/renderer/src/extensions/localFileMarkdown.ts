import { Extension } from '@tiptap/core'
import type MarkdownIt from 'markdown-it'

const installed = new WeakSet<MarkdownIt>()

export function installLocalFileLinks(md: MarkdownIt): void {
  if (installed.has(md)) return
  installed.add(md)
  const validate = md.validateLink.bind(md)
  md.validateLink = href => /^file:/i.test(href) || validate(href)
}

export const LocalFileMarkdown = Extension.create({
  name: 'localFileMarkdown',
  addStorage() {
    return { markdown: { parse: { setup: installLocalFileLinks } } }
  },
})
