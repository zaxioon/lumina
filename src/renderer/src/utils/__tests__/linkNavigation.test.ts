import { describe, expect, it } from 'vitest'
import { findAnchor, normalizeLinkInput } from '../linkNavigation'

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
