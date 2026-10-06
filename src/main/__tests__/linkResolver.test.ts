import { describe, expect, it } from 'vitest'
import { resolveDocumentLink } from '../linkResolver'

describe('document link resolution', () => {
  it.each<[string, string, string]>([
    ['./章节/下一页.md#中文标题', 'C:\\notes\\章节\\下一页.md', '中文标题'],
    ['../other%20file.markdown#%E6%A0%87%E9%A2%98', 'C:\\other file.markdown', '标题'],
    ['D:/资料/笔记.txt', 'D:\\资料\\笔记.txt', ''],
    ['D:\\资料\\笔记.txt', 'D:\\资料\\笔记.txt', ''],
    ['file:///D:/%E8%B5%84%E6%96%99/a%20b.md#intro', 'D:\\资料\\a b.md', 'intro'],
    ['file:///C:/notes/a%23b%25.md', 'C:\\notes\\a#b%.md', ''],
  ])('resolves %s on Windows', (href, path, anchor) => {
    expect(resolveDocumentLink(href, 'C:\\notes\\index.md', 'win32')).toEqual({ kind: 'document', path, anchor })
  })
  it('resolves POSIX relative links', () => {
    expect(resolveDocumentLink('../next.md', '/home/docs/index.md', 'linux')).toEqual({ kind: 'document', path: '/home/next.md', anchor: '' })
  })
  it('decodes a Chinese anchor', () => {
    expect(resolveDocumentLink('#%E6%A0%87%E9%A2%98', null)).toEqual({ kind: 'anchor', anchor: '标题' })
  })
  it('routes a PDF attachment and an external URL separately', () => {
    expect(resolveDocumentLink('./paper.pdf', 'C:\\notes\\index.md', 'win32').kind).toBe('attachment')
    expect(resolveDocumentLink('HTTPS://example.com', null).kind).toBe('external')
  })
  it.each<[string, RegExp | typeof URIError]>([
    ['./app.exe', /file type/i],
    ['javascript:alert(1)', /protocol/i],
    ['data:text/html,test', /protocol/i],
    ['//server/share.md', /Network and device paths/i],
    ['file://server/share.md', /Network and device paths/i],
    ['C:/a.pdf:evil.exe', /Invalid Windows file path/i],
    ['./bad%00.md', /Invalid file path/i],
    ['./bad%ZZ.md', URIError],
  ])('rejects unsafe or malformed link %s with the relevant error', (href, reason) => {
    expect(() => resolveDocumentLink(href, 'C:\\notes\\index.md', 'win32')).toThrow(reason)
  })
  it('requires a saved document for relative links', () => {
    expect(() => resolveDocumentLink('./next.md', null, 'win32')).toThrow(/Save/)
  })
})
