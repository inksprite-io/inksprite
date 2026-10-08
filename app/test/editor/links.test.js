/* global KeyboardEvent, MouseEvent */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { TextSelection } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { serializeMarkdown } from '../../src/editor/markdown.js'
import { createEditorState } from '../../src/editor/state.js'
import {
  canLink,
  linkAround,
  links,
  normalizeHref,
  removeLink,
  setLink,
} from '../../src/editor/links.js'

const TEXT = 'The keeper kept a [logbook](https://example.com/log) of every ship.'

/** Where `words` start in the state's document, or where they end. */
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

/** The state with the selection over `words`, or the caret before them. */
const at = (markdown, words, { caret = false, end = false } = {}) => {
  const state = createEditorState(markdown)
  const from = find(state, words, end)
  const to = caret ? from : from + words.length
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, from, to)))
}

/** The markdown after running the command on the state. */
const after = (state, command) => {
  let next = state
  command(state, tr => (next = state.apply(tr)))
  return serializeMarkdown(next.doc)
}

describe('linkAround', () => {
  it('finds the whole link from inside it or against either end', () => {
    const state = createEditorState(TEXT)
    const start = find(state, 'logbook')
    const expected = { from: start, to: start + 'logbook'.length, href: 'https://example.com/log' }
    for (const pos of [start, start + 3, start + 'logbook'.length]) {
      expect(linkAround(state.doc.resolve(pos))).toEqual(expected)
    }
  })

  it('finds no link in plain text', () => {
    const state = createEditorState(TEXT)
    expect(linkAround(state.doc.resolve(find(state, 'every')))).toBe(null)
  })

  it('takes a link across marks inside it as one', () => {
    const state = createEditorState('A [log **book** entry](https://example.com) here.')
    const around = linkAround(state.doc.resolve(find(state, 'entry')))
    expect(state.doc.textBetween(around.from, around.to)).toBe('log book entry')
  })

  it('keeps two links side by side apart', () => {
    const state = createEditorState('[one](https://one.example)[two](https://two.example)')
    expect(linkAround(state.doc.resolve(find(state, 'two') + 1)).href).toBe('https://two.example')
  })
})

describe('setLink', () => {
  it('links the selection', () => {
    expect(after(at(TEXT, 'every ship'), setLink('https://ships.example'))).toBe(
      'The keeper kept a [logbook](https://example.com/log) of [every ship](https://ships.example).'
    )
  })

  it('changes the whole of the link the caret is in', () => {
    const state = at(TEXT, 'book', { caret: true })
    expect(after(state, setLink('https://example.org'))).toBe(
      'The keeper kept a [logbook](https://example.org) of every ship.'
    )
  })

  it('puts in a new link with its words, or the address with none', () => {
    const state = at(TEXT, ' of every', { caret: true, end: true })
    expect(after(state, setLink('https://ships.example', 'ships'))).toBe(
      'The keeper kept a [logbook](https://example.com/log) of every[ships](https://ships.example) ship.'
    )
    expect(after(state, setLink('https://ships.example'))).toBe(
      'The keeper kept a [logbook](https://example.com/log) of every<https://ships.example> ship.'
    )
  })

  it('leaves the caret after the link', () => {
    const state = at(TEXT, 'every ship')
    let next = state
    setLink('https://ships.example')(state, tr => (next = state.apply(tr)))
    expect(next.selection.empty).toBe(true)
    expect(next.selection.from).toBe(find(state, 'every ship', true))
  })

  it('does nothing in a code block', () => {
    const state = at('```\nconst x = 1\n```', 'const')
    expect(canLink(state)).toBe(false)
    expect(setLink('https://example.com')(state)).toBe(false)
  })
})

describe('removeLink', () => {
  it('takes the link off the whole link the caret is in, and keeps the words', () => {
    expect(after(at(TEXT, 'book', { caret: true }), removeLink)).toBe(
      'The keeper kept a logbook of every ship.'
    )
  })

  it('takes links off the selection', () => {
    const state = createEditorState(TEXT)
    const selection = TextSelection.create(
      state.doc,
      find(state, 'kept'),
      find(state, 'logbook', true)
    )
    expect(after(state.apply(state.tr.setSelection(selection)), removeLink)).toBe(
      'The keeper kept a logbook of every ship.'
    )
  })

  it('does nothing where there is no link', () => {
    expect(removeLink(at(TEXT, 'every', { caret: true }))).toBe(false)
    expect(removeLink(at(TEXT, 'every ship'))).toBe(false)
  })
})

describe('normalizeHref', () => {
  it('makes a bare domain a web page and a bare address mail', () => {
    expect(normalizeHref(' example.com/page ')).toBe('https://example.com/page')
    expect(normalizeHref('localhost:3000')).toBe('https://localhost:3000')
    expect(normalizeHref('someone@example.com')).toBe('mailto:someone@example.com')
  })

  it('keeps an address with a scheme, a fragment, or a path as it is', () => {
    expect(normalizeHref('http://example.com')).toBe('http://example.com')
    expect(normalizeHref('mailto:someone@example.com')).toBe('mailto:someone@example.com')
    expect(normalizeHref('#notes')).toBe('#notes')
    expect(normalizeHref('/project/one')).toBe('/project/one')
    expect(normalizeHref('   ')).toBe('')
  })
})

describe('links', () => {
  /** @type {EditorView|null} */
  let view = null

  afterEach(() => {
    view?.destroy()
    view = null
  })

  /** A view over `state` with the plugin, and what it called back with. */
  const mount = state => {
    const calls = { edit: vi.fn(), open: vi.fn(), update: vi.fn() }
    view = new EditorView(document.createElement('div'), { state, plugins: [links(calls)] })
    return { view, calls }
  }

  /** Paste `text`, with HTML too if given, as a clipboard would. */
  const paste = (editorView, text, html = '') => {
    const types = html ? ['text/plain', 'text/html'] : ['text/plain']
    const event = /** @type {ClipboardEvent} */ (
      /** @type {unknown} */ ({
        clipboardData: { types, getData: type => (type === 'text/html' ? html : text) },
      })
    )
    return editorView.someProp('handlePaste', handle => handle(editorView, event, null))
  }

  it('asks for the field on Mod-K, where a link can go', () => {
    const { view, calls } = mount(at(TEXT, 'every ship'))
    const mac = /Mac/.test(navigator.platform)
    const key = new KeyboardEvent('keydown', { key: 'k', ctrlKey: !mac, metaKey: mac })
    view.someProp('handleKeyDown', handle => handle(view, key))
    expect(calls.edit).toHaveBeenCalledTimes(1)
  })

  it('opens a link on Mod-click and leaves a plain click to the caret', () => {
    const { view, calls } = mount(createEditorState(TEXT))
    const anchor = view.dom.querySelector('a')
    const click = init => {
      const event = new MouseEvent('click', init)
      Object.defineProperty(event, 'target', { value: anchor })
      return view.someProp('handleClick', handle => handle(view, 0, event))
    }
    expect(click({})).toBeFalsy()
    expect(calls.open).not.toHaveBeenCalled()
    expect(click({ metaKey: true })).toBe(true)
    expect(calls.open).toHaveBeenCalledWith('https://example.com/log')
  })

  it('links the selection with a pasted link', () => {
    const { view } = mount(at(TEXT, 'every ship'))
    expect(paste(view, ' https://ships.example ')).toBe(true)
    expect(serializeMarkdown(view.state.doc)).toBe(
      'The keeper kept a [logbook](https://example.com/log) of [every ship](https://ships.example).'
    )
  })

  it('puts a pasted link in as a new one, even against a link already there', () => {
    const { view } = mount(at(TEXT, ' of', { caret: true }))
    expect(paste(view, 'https://ships.example')).toBe(true)
    expect(serializeMarkdown(view.state.doc)).toBe(
      'The keeper kept a [logbook](https://example.com/log)<https://ships.example> of every ship.'
    )
  })

  it("leaves the editor's own paste to text that is not one link, HTML, and code", () => {
    expect(paste(mount(at(TEXT, 'every ship')).view, 'two words')).toBeFalsy()
    view?.destroy()
    expect(
      paste(mount(at(TEXT, 'every', { caret: true })).view, 'https://a.example', '<a>x</a>')
    ).toBeFalsy()
    view?.destroy()
    expect(
      paste(mount(at('Some `inline code` here.', 'code')).view, 'https://a.example')
    ).toBeFalsy()
  })

  it('tells the editor as the state changes', () => {
    const { view, calls } = mount(createEditorState(TEXT))
    calls.update.mockClear()
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 3)))
    expect(calls.update).toHaveBeenCalledWith(view, expect.anything())
  })
})
