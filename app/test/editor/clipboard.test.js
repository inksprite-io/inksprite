import { describe, it, expect } from 'vitest'
import { TextSelection } from 'prosemirror-state'
import { createEditorState } from '../../src/editor/state.js'
import { serializeMarkdown } from '../../src/editor/markdown.js'
import { pasteMarkdown, readClipboard, selectionMarkdown } from '../../src/editor/clipboard.js'

/** Where `words` start in the state's document, or end. */
const find = (state, words, end = false) => {
  let found = null
  state.doc.descendants((node, pos) => {
    if (found === null && node.isText && node.text.includes(words)) {
      found = pos + node.text.indexOf(words) + (end ? words.length : 0)
    }
  })
  if (found === null) throw new Error(`No "${words}"`)
  return found
}

/** The state with the selection from the start of one run of words to the end of another. */
const selecting = (markdown, from, to = from) => {
  const state = createEditorState(markdown)
  return state.apply(
    state.tr.setSelection(TextSelection.create(state.doc, find(state, from), find(state, to, true)))
  )
}

/** The markdown after running a command. */
const after = (state, command) => {
  let next = state
  command(state, tr => (next = state.apply(tr)))
  return serializeMarkdown(next.doc)
}

describe('selectionMarkdown', () => {
  it('writes part of a paragraph with its marks', () => {
    expect(selectionMarkdown(selecting('The **long** road home.', 'The', 'road'))).toBe(
      'The **long** road'
    )
  })

  it('writes whole blocks as they are', () => {
    const state = selecting('## The Ferry\n\n- one\n- two', 'The Ferry', 'two')
    expect(selectionMarkdown(state)).toBe('## The Ferry\n\n- one\n- two')
  })

  it('keeps a comment as its markup', () => {
    const state = selecting('It was a {==dark==}{>>c7k2m1: reword<<} night.', 'It', 'night.')
    expect(selectionMarkdown(state)).toBe('It was a {==dark==}{>>c7k2m1: reword<<} night.')
  })
})

describe('pasteMarkdown', () => {
  it('joins one paragraph of it to the line it lands in', () => {
    const state = createEditorState('It was  by then.')
    const at = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, find(state, ' by')))
    )
    expect(after(at, pasteMarkdown('**late** and *dark*'))).toBe(
      'It was **late** and *dark* by then.'
    )
  })

  it('makes blocks of blocks', () => {
    const state = createEditorState('')
    expect(after(state, pasteMarkdown('## The Ferry\n\nIt was **late**.'))).toBe(
      '## The Ferry\n\nIt was **late**.'
    )
  })

  it('does nothing with nothing', () => {
    expect(pasteMarkdown('  ')(createEditorState('Text.'))).toBe(false)
  })
})

describe('readClipboard', () => {
  /** A clipboard holding one item of these types. */
  const holding = (/** @type {Record<string, string>} */ data) => {
    /** @type {any[]} */
    const asked = []
    return {
      asked,
      read: async (/** @type {any} */ options) => {
        asked.push(options)
        return [
          {
            types: Object.keys(data),
            getType: async (/** @type {string} */ type) => ({ text: async () => data[type] }),
          },
        ]
      },
    }
  }

  it('reads the HTML and the text, asking for the HTML as it was written', async () => {
    const clipboard = holding({ 'text/html': '<p><strong>late</strong></p>', 'text/plain': 'late' })
    expect(await readClipboard(/** @type {any} */ (clipboard))).toEqual({
      html: '<p><strong>late</strong></p>',
      text: 'late',
    })
    expect(clipboard.asked).toEqual([{ unsanitized: ['text/html'] }])
  })

  it('has no HTML for plain text', async () => {
    const clipboard = holding({ 'text/plain': 'late' })
    expect(await readClipboard(/** @type {any} */ (clipboard))).toEqual({ html: '', text: 'late' })
  })
})
