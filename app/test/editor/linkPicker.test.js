/* global KeyboardEvent */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { TextSelection } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { serializeMarkdown } from '../../src/editor/markdown.js'
import { createEditorState } from '../../src/editor/state.js'
import { linkPicker, pickingAt, putLink } from '../../src/editor/linkPicker.js'

/** The state with the caret after `words`. */
const after = (markdown, words) => {
  const state = createEditorState(markdown)
  let pos = null
  state.doc.descendants((node, at) => {
    if (pos === null && node.isText && node.text.includes(words)) {
      pos = at + node.text.indexOf(words) + words.length
    }
  })
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, pos)))
}

describe('pickingAt', () => {
  it('finds the `[[` the caret is after, and what was typed since', () => {
    const state = after('See [[Cast li here.', '[[Cast li')
    expect(pickingAt(state)).toEqual({ from: 5, to: 14, query: 'Cast li' })
    expect(pickingAt(after('See [[ here.', '[['))?.query).toBe('')
    expect(pickingAt(after('See [[Cast list#The cr here.', '#The cr'))?.query).toBe(
      'Cast list#The cr'
    )
  })

  it('finds none once closed, on another line, in code, or with nothing opened', () => {
    expect(pickingAt(after('See [[Cast list]] here.', 'list]]'))).toBeNull()
    expect(pickingAt(after('See [Cast here.', '[Cast'))).toBeNull()
    expect(pickingAt(after('See `[[Cast` here.', '[[Cast'))).toBeNull()
    expect(pickingAt(after('```\n[[Cast\n```', '[[Cast'))).toBeNull()
  })
})

describe('linkPicker', () => {
  /** @type {EditorView|null} */
  let view = null
  afterEach(() => {
    view?.destroy()
    view = null
  })

  /** A focused view with the plugin, and what it called back with. */
  const mount = (state, taken = true) => {
    const calls = { update: vi.fn(), key: vi.fn(() => taken) }
    const place = document.createElement('div')
    document.body.append(place)
    view = new EditorView(place, { state, plugins: [linkPicker(calls)] })
    view.focus()
    return { view, calls }
  }

  /** @param {EditorView} editorView @param {string} key */
  const press = (editorView, key) =>
    editorView.someProp('handleKeyDown', handle =>
      handle(editorView, new KeyboardEvent('keydown', { key }))
    )

  it('says what `[[` opened as the text changes, and takes the list’s keys', () => {
    const { view, calls } = mount(after('See [[Ca here.', '[[Ca'))
    view.dispatch(view.state.tr.insertText('s'))
    expect(calls.update).toHaveBeenLastCalledWith(view, { from: 5, to: 10, query: 'Cas' })
    expect(press(view, 'ArrowDown')).toBe(true)
    expect(press(view, 'Enter')).toBe(true)
    expect(calls.key.mock.calls).toEqual([['down'], ['pick']])
    expect(press(view, 'a')).toBeFalsy()
  })

  it('leaves the keys to the editor when the list shows nothing', () => {
    const { view, calls } = mount(after('See [[Zz here.', '[[Zz'), false)
    press(view, 'Enter')
    expect(calls.key).toHaveBeenCalledWith('pick')
    // Enter did what it does: a new paragraph.
    expect(view.state.doc.childCount).toBe(2)
  })

  it('puts the list away on Escape until that `[[` goes', () => {
    const { view, calls } = mount(after('See [[Ca here.', '[[Ca'))
    expect(press(view, 'Escape')).toBe(true)
    expect(calls.update).toHaveBeenLastCalledWith(view, null)
    view.dispatch(view.state.tr.insertText('s'))
    expect(calls.update).toHaveBeenLastCalledWith(view, null)
    // Typed again, it opens again.
    view.dispatch(view.state.tr.insertText(' [[T'))
    expect(calls.update).toHaveBeenLastCalledWith(view, expect.objectContaining({ query: 'T' }))
  })

  it('puts the link picked in place of the `[[` and what was typed', () => {
    const { view } = mount(after('See [[Ca here.', '[[Ca'))
    putLink(view, /** @type {any} */ (pickingAt(view.state)), {
      href: 'Notes/Cast%20list.md',
      words: 'Cast list',
    })
    expect(serializeMarkdown(view.state.doc)).toBe('See [Cast list](Notes/Cast%20list.md) here.')
    // The caret after it, outside it.
    view.dispatch(view.state.tr.insertText('!'))
    expect(serializeMarkdown(view.state.doc)).toBe('See [Cast list](Notes/Cast%20list.md)! here.')
  })
})
