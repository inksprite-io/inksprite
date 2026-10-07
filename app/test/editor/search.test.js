import { describe, it, expect } from 'vitest'
import { TextSelection } from 'prosemirror-state'
import { undo } from 'prosemirror-history'
import { serializeMarkdown } from '../../src/editor/markdown.js'
import { createEditorState } from '../../src/editor/state.js'
import {
  find,
  findMatches,
  findNext,
  replaceAll,
  replaceCurrent,
  searchOf,
} from '../../src/editor/search.js'

/** Run a command and return the state it leaves, or the same state if it did nothing. */
const run = (state, command) => {
  let next = state
  command(state, tr => {
    next = state.apply(tr)
  })
  return next
}

/** The text of every match, in order. */
const texts = state => searchOf(state).matches.map(m => state.doc.textBetween(m.from, m.to))

/** What the selection covers. */
const selected = state => state.doc.textBetween(state.selection.from, state.selection.to)

/** The caret at the start of the document. */
const atStart = state => state.apply(state.tr.setSelection(TextSelection.atStart(state.doc)))

const DOC = [
  '# The Road',
  '',
  'The road went on. The *road* went **on and on**.',
  '',
  'At the end of the road, a gate.',
].join('\n')

describe('findMatches', () => {
  it('finds every match in order, whatever the case', () => {
    const state = createEditorState(DOC)
    const matches = findMatches(state.doc, 'road')
    expect(matches.map(m => state.doc.textBetween(m.from, m.to))).toEqual([
      'Road',
      'road',
      'road',
      'road',
    ])
  })

  it('finds across marks inside a paragraph, but not across paragraphs', () => {
    const state = createEditorState(DOC)
    expect(findMatches(state.doc, 'went on and on')).toHaveLength(1)
    expect(findMatches(state.doc, 'on.At')).toHaveLength(0)
  })

  it('counts a line break as one place, so what follows it lines up', () => {
    const state = createEditorState('one  \ntwo')
    const [match] = findMatches(state.doc, 'two')
    expect(state.doc.textBetween(match.from, match.to)).toBe('two')
  })

  it('takes the query as text, not as a pattern', () => {
    const state = createEditorState('a.b and axb')
    expect(findMatches(state.doc, 'a.b')).toHaveLength(1)
  })

  it('finds nothing for nothing', () => {
    expect(findMatches(createEditorState(DOC).doc, '')).toEqual([])
  })
})

describe('find', () => {
  it('selects the first match from the caret on', () => {
    const state = atStart(createEditorState(DOC))
    const found = run(state, find('road'))
    expect(texts(found)).toHaveLength(4)
    expect(searchOf(found).current).toBe(0)
    expect(selected(found)).toBe('Road')
  })

  it('goes round to the first match from past the last', () => {
    // A new state has the caret at the end.
    const found = run(createEditorState(DOC), find('road'))
    expect(searchOf(found).current).toBe(0)
  })

  it('stays on the match it is on while the query grows and still matches it', () => {
    let state = atStart(createEditorState(DOC))
    state = run(state, find('road'))
    state = run(state, findNext())
    state = run(state, findNext())
    expect(searchOf(state).current).toBe(2)

    state = run(state, find('road '))
    expect(selected(state)).toBe('road ')
    expect(searchOf(state).current).toBe(1)
    expect(texts(state)).toEqual(['road ', 'road '])
  })

  it('draws each match, and the current one apart', () => {
    const state = run(atStart(createEditorState(DOC)), find('road'))
    const classes = searchOf(state)
      .decorations.find()
      .map(d => /** @type {any} */ (d).type.attrs.class)
    expect(classes).toEqual([
      'find-match find-match-current',
      'find-match',
      'find-match',
      'find-match',
    ])
  })

  it('puts the search away for an empty query', () => {
    let state = run(createEditorState(DOC), find('road'))
    state = run(state, find(''))
    expect(searchOf(state).matches).toEqual([])
    expect(searchOf(state).decorations.find()).toEqual([])
  })
})

describe('findNext', () => {
  it('moves forward and back, going round at the ends', () => {
    let state = run(atStart(createEditorState(DOC)), find('road'))
    state = run(state, findNext(-1))
    expect(searchOf(state).current).toBe(3)
    state = run(state, findNext())
    expect(searchOf(state).current).toBe(0)
  })

  it('does nothing without a match', () => {
    const state = run(createEditorState(DOC), find('nowhere'))
    expect(findNext()(state)).toBe(false)
  })
})

describe('after an edit', () => {
  it('finds the query again, staying on the match it was on', () => {
    let state = run(atStart(createEditorState(DOC)), find('road'))
    state = run(state, findNext())
    const before = searchOf(state).matches[1].from

    // Typed at the start of the document, ahead of everything.
    state = state.apply(state.tr.insertText('road ', 1))

    expect(texts(state)).toHaveLength(5)
    expect(searchOf(state).matches[searchOf(state).current].from).toBe(before + 5)
  })
})

describe('replaceCurrent', () => {
  it('replaces the match it is on and moves to the next', () => {
    let state = run(atStart(createEditorState(DOC)), find('road'))
    state = run(state, findNext())
    state = run(state, replaceCurrent('path'))

    expect(serializeMarkdown(state.doc)).toContain('The path went on. The *road*')
    expect(texts(state)).toHaveLength(3)
    expect(searchOf(state).current).toBe(1)
    expect(selected(state)).toBe('road')
  })

  it('keeps the marks of what it replaces', () => {
    let state = run(createEditorState('The *road* went on.'), find('road'))
    state = run(state, replaceCurrent('path'))
    expect(serializeMarkdown(state.doc)).toBe('The *path* went on.')
  })

  it('does not find what it put in again', () => {
    let state = run(atStart(createEditorState('a cat, a cat')), find('cat'))
    state = run(state, replaceCurrent('cats'))
    expect(serializeMarkdown(state.doc)).toBe('a cats, a cat')
    expect(searchOf(state).matches[searchOf(state).current].from).toBe(
      searchOf(state).matches.at(-1).from
    )
  })

  it('deletes for an empty replacement', () => {
    let state = run(createEditorState('a very long road'), find('very '))
    state = run(state, replaceCurrent(''))
    expect(serializeMarkdown(state.doc)).toBe('a long road')
  })
})

describe('replaceAll', () => {
  it('replaces every match as one undo', () => {
    let state = run(createEditorState(DOC), find('road'))
    state = run(state, replaceAll('path'))

    expect(serializeMarkdown(state.doc)).not.toMatch(/road/i)
    expect(serializeMarkdown(state.doc)).toContain('The *path* went')
    expect(searchOf(state).matches).toEqual([])

    state = run(state, undo)
    expect(serializeMarkdown(state.doc)).toBe(DOC)
  })

  it('does nothing without a match', () => {
    const state = run(createEditorState(DOC), find('nowhere'))
    expect(replaceAll('x')(state)).toBe(false)
  })
})
