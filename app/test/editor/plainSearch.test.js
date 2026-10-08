import { describe, it, expect, afterEach } from 'vitest'
import { EditorSelection, EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { history, undo } from '@codemirror/commands'
import {
  find,
  findMatches,
  findNext,
  plainSearch,
  replaceAll,
  replaceCurrent,
  searchOf,
} from '../../src/editor/plainSearch.js'

/** @type {EditorView[]} */
let views = []

/** A view over the text, with the caret where asked: at the start unless told. */
const viewOf = (doc, caret = 0) => {
  const view = new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc,
      selection: EditorSelection.cursor(caret),
      extensions: [history(), plainSearch],
    }),
  })
  views.push(view)
  return view
}

afterEach(() => {
  for (const view of views) view.destroy()
  views = []
})

/** The text of every match, in order. */
const texts = view => searchOf(view.state).matches.map(m => view.state.sliceDoc(m.from, m.to))

/** What the selection covers. */
const selected = view => {
  const { from, to } = view.state.selection.main
  return view.state.sliceDoc(from, to)
}

const DOC = [
  '# The Road',
  '',
  'The road went on. The *road* went **on and on**.',
  '',
  'At the end of the road, a gate.',
].join('\n')

describe('findMatches', () => {
  const doc = EditorState.create({ doc: DOC }).doc

  it('finds every match in order, whatever the case', () => {
    const matches = findMatches(doc, 'road')
    expect(matches.map(m => DOC.slice(m.from, m.to))).toEqual(['Road', 'road', 'road', 'road'])
  })

  it('finds the text as written, markup and all', () => {
    expect(findMatches(doc, 'The *road*')).toHaveLength(1)
    expect(findMatches(doc, 'went on and on')).toHaveLength(0)
  })

  it('takes the query as text, not as a pattern', () => {
    expect(findMatches(EditorState.create({ doc: 'a.b and axb' }).doc, 'a.b')).toHaveLength(1)
  })

  it('finds nothing for nothing', () => {
    expect(findMatches(doc, '')).toEqual([])
  })
})

describe('find', () => {
  it('selects the first match from the caret on', () => {
    const view = viewOf(DOC)
    find('road')(view)
    expect(texts(view)).toHaveLength(4)
    expect(searchOf(view.state).current).toBe(0)
    expect(selected(view)).toBe('Road')
  })

  it('goes round to the first match from past the last', () => {
    const view = viewOf(DOC, DOC.length)
    find('road')(view)
    expect(searchOf(view.state).current).toBe(0)
  })

  it('stays on the match it is on while the query grows and still matches it', () => {
    const view = viewOf(DOC)
    find('ro')(view)
    findNext()(view)
    findNext()(view)
    expect(searchOf(view.state).current).toBe(2)

    find('roa')(view)
    expect(searchOf(view.state).current).toBe(2)
    expect(selected(view)).toBe('roa')

    find('road went')(view)
    expect(texts(view)).toEqual(['road went'])
  })

  it('draws each match, and the current one apart', () => {
    const view = viewOf(DOC)
    find('road')(view)
    const classes = []
    searchOf(view.state).decorations.between(0, DOC.length, (_from, _to, decoration) => {
      classes.push(decoration.spec.class)
    })
    expect(classes).toEqual([
      'find-match find-match-current',
      'find-match',
      'find-match',
      'find-match',
    ])
  })

  it('puts the search away for an empty query', () => {
    const view = viewOf(DOC)
    find('road')(view)
    find('')(view)
    expect(searchOf(view.state).matches).toEqual([])
    expect(searchOf(view.state).decorations.size).toBe(0)
  })
})

describe('findNext', () => {
  it('moves forward and back, going round at the ends', () => {
    const view = viewOf(DOC)
    find('road')(view)
    findNext(-1)(view)
    expect(searchOf(view.state).current).toBe(3)
    findNext()(view)
    expect(searchOf(view.state).current).toBe(0)
  })

  it('does nothing without a match', () => {
    const view = viewOf(DOC)
    find('nowhere')(view)
    expect(findNext()(view)).toBe(false)
  })
})

describe('after an edit', () => {
  it('finds the query again, staying on the match it was on', () => {
    const view = viewOf(DOC)
    find('road')(view)
    findNext()(view)
    const before = searchOf(view.state).matches[1].from

    // Typed at the start of the text, ahead of everything.
    view.dispatch({ changes: { from: 0, insert: 'road ' } })

    expect(texts(view)).toHaveLength(5)
    const { matches, current } = searchOf(view.state)
    expect(matches[current].from).toBe(before + 5)
  })
})

describe('replaceCurrent', () => {
  it('replaces the match it is on and moves to the next', () => {
    const view = viewOf(DOC)
    find('road')(view)
    findNext()(view)
    replaceCurrent('path')(view)

    expect(view.state.doc.toString()).toContain('The path went on. The *road*')
    expect(texts(view)).toHaveLength(3)
    expect(searchOf(view.state).current).toBe(1)
    expect(selected(view)).toBe('road')
  })

  it('does not find what it put in again', () => {
    const view = viewOf('a cat, a cat')
    find('cat')(view)
    replaceCurrent('cats')(view)
    expect(view.state.doc.toString()).toBe('a cats, a cat')
    const { matches, current } = searchOf(view.state)
    expect(matches[current].from).toBe(matches.at(-1).from)
  })

  it('deletes for an empty replacement', () => {
    const view = viewOf('a very long road')
    find('very ')(view)
    replaceCurrent('')(view)
    expect(view.state.doc.toString()).toBe('a long road')
  })
})

describe('replaceAll', () => {
  it('replaces every match as one undo', () => {
    const view = viewOf(DOC)
    find('road')(view)
    replaceAll('path')(view)

    expect(view.state.doc.toString()).not.toMatch(/road/i)
    expect(view.state.doc.toString()).toContain('The *path* went')
    expect(searchOf(view.state).matches).toEqual([])

    undo(view)
    expect(view.state.doc.toString()).toBe(DOC)
  })

  it('does nothing without a match', () => {
    const view = viewOf(DOC)
    find('nowhere')(view)
    expect(replaceAll('x')(view)).toBe(false)
  })
})
