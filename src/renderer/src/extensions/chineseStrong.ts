import { Bold } from '@tiptap/extension-bold'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import type MarkdownIt from 'markdown-it'
import type StateInline from 'markdown-it/lib/rules_inline/state_inline'

const installed = new WeakSet<MarkdownIt>()
const han = /\p{Script=Han}/u
const punctuation = /\p{P}/u
const cjkPunctuation = /[\u3001-\u303f\uff01-\uff65“”‘’]/u
const letterOrNumber = /[\p{L}\p{N}]/u
const markdownPunctuation = /[\p{P}\p{S}]/u

function relaxedOpen(before: string, after: string): boolean {
  return punctuation.test(after) &&
    (han.test(before) || (cjkPunctuation.test(after) && letterOrNumber.test(before)))
}

function relaxedClose(before: string, after: string): boolean {
  return punctuation.test(before) &&
    (han.test(after) || (cjkPunctuation.test(before) && letterOrNumber.test(after)))
}

/** Allow punctuation inside **strong** to touch Chinese prose outside it.
 * Keep markdown-it's delimiter pairing, nesting and all other inline rules.
 * Code, escapes and link destinations are consumed by their own rules first.
 */
export function installChineseStrong(md: MarkdownIt): void {
  if (installed.has(md)) return
  installed.add(md)
  md.inline.ruler.before('emphasis', 'chinese_strong', (state: StateInline, silent: boolean) => {
    if (silent || state.src[state.pos] !== '*') return false
    const scanned = state.scanDelims(state.pos, true)
    // Single emphasis and mixed *** runs retain standard CommonMark behavior.
    if (scanned.length !== 2) return false
    const before = Array.from(state.src.slice(Math.max(0, state.pos - 2), state.pos)).at(-1) ?? ''
    const after = Array.from(state.src.slice(state.pos + 2, state.pos + 4))[0] ?? ''
    const open = scanned.can_open || relaxedOpen(before, after)
    const close = scanned.can_close || relaxedClose(before, after)
    if (open === scanned.can_open && close === scanned.can_close) return false

    for (let i = 0; i < 2; i++) {
      state.push('text', '', 0).content = '*'
      state.delimiters.push({ marker: 0x2a, length: 2, token: state.tokens.length - 1, end: -1, open, close })
    }
    state.pos += 2
    return true
  })
}

function strongDelimiter(parent: ProseMirrorNode, index: number, opening: boolean): string {
  // Preserve whitespace applied with the toolbar using inline HTML. Markdown
  // delimiters cannot enclose leading/trailing whitespace reliably.
  let first = opening ? index : index - 1
  let last = first
  const isBold = (i: number) => parent.child(i).marks.some(mark => mark.type.name === 'bold')
  while (first > 0 && isBold(first - 1)) first--
  while (last + 1 < parent.childCount && isBold(last + 1)) last++
  const start = Array.from(parent.child(first).textContent)[0] ?? ''
  const end = Array.from(parent.child(last).textContent).at(-1) ?? ''
  const before = first > 0 ? Array.from(parent.child(first - 1).textContent).at(-1) ?? '' : ''
  const after = last + 1 < parent.childCount ? Array.from(parent.child(last + 1).textContent)[0] ?? '' : ''
  const whitespace = (char: string) => !char || /\s/u.test(char)
  const canOpen = !whitespace(start) &&
    (!markdownPunctuation.test(start) || whitespace(before) || markdownPunctuation.test(before) || relaxedOpen(before, start))
  const canClose = !whitespace(end) &&
    (!markdownPunctuation.test(end) || whitespace(after) || markdownPunctuation.test(after) || relaxedClose(end, after))
  // A toolbar can create marks that Markdown cannot express (e.g.
  // <strong>word.</strong>next). Inline HTML preserves those marks as well.
  const needsHTML = !canOpen || !canClose
  return needsHTML ? (opening ? '<strong>' : '</strong>') : '**'
}

export const ChineseStrong = Bold.extend({
  addStorage() {
    return {
      markdown: {
        parse: { setup: installChineseStrong },
        serialize: {
          // tiptap-markdown's expelEnclosingWhitespace also moves punctuation
          // outside marks using CommonMark boundaries. Our parser supports
          // these boundaries, so preserve the original mark extent instead.
          expelEnclosingWhitespace: false,
          mixable: true,
          open: (_state: unknown, _mark: unknown, parent: ProseMirrorNode, index: number) => strongDelimiter(parent, index, true),
          close: (_state: unknown, _mark: unknown, parent: ProseMirrorNode, index: number) => strongDelimiter(parent, index, false),
        },
      },
    }
  },
})
