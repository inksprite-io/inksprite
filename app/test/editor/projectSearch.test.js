import { describe, it, expect } from 'vitest'
import { LINE_LIMIT, searchProject } from '../../src/editor/projectSearch.js'
import { findMatches } from '../../src/editor/search.js'
import { createEditorState } from '../../src/editor/state.js'

/**
 * A document as the search reads it: laid out unless said.
 *
 * @param {string} id
 * @param {string} content
 * @param {Partial<import('../../src/editor/projectSearch.js').Searchable>} [rest]
 */
const doc = (id, content, rest = {}) => ({ id, title: id, content, laidOut: true, ...rest })

/** Each line as it reads, the match in brackets. */
const lines = found => found.lines.map(line => `${line.before}[${line.match}]${line.after}`)

describe('searchProject', () => {
  it('finds in the text a laid-out document shows, across marks', () => {
    const found = searchProject(
      [doc('one', 'The **long** road went on.'), doc('two', 'No road here, long or short.')],
      'the long road'
    )
    expect(found.documents.map(document => document.id)).toEqual(['one'])
    expect(lines(found.documents[0])).toEqual(['[The long road] went on.'])
  })

  it('finds nothing in a link address or a comment id, as the editor does', () => {
    const found = searchProject(
      [doc('one', 'See [the plan](../Notes/Gatehouse.md) and {==the gate==}{>>gatehouse<<}.')],
      'gatehouse'
    )
    expect(found.documents).toEqual([])
  })

  it('finds in a plain document or a file as its text is, saying where', () => {
    const content = 'First line\nthe **long** road\nlast'
    const found = searchProject([doc('plain', content, { laidOut: false })], '**long**')
    expect(lines(found.documents[0])).toEqual(['the [**long**] road'])
    expect(found.documents[0].lines[0].at).toBe(content.indexOf('**long**'))
  })

  it('counts the matches as the document’s own find does', () => {
    const content = [
      '# The Road',
      '',
      'The road went on. The *road* went **on and on**.',
      '',
      '- a road',
      '- [another road](Roads.md)',
    ].join('\n')
    const found = searchProject([doc('one', content)], 'road')
    const state = createEditorState(content)
    const matches = findMatches(state.doc, 'road')

    expect(found.documents[0].count).toBe(matches.length)
    expect(found.documents[0].lines.map(line => line.index)).toEqual(matches.map((_, at) => at))
    expect(found.count).toBe(matches.length)
  })

  it('reads an open document as the editor has it, not as stored', () => {
    const state = createEditorState('The gate is open now.')
    const found = searchProject([doc('one', 'Nothing yet.', { doc: state.doc })], 'gate')
    expect(lines(found.documents[0])).toEqual(['The [gate] is open now.'])
  })

  it('lists a document named with the words, with nothing in its text', () => {
    const found = searchProject([doc('one', 'Nothing.', { title: 'The Gatehouse' })], 'gate')
    expect(found.documents).toEqual([{ id: 'one', inTitle: true, count: 0, lines: [] }])
  })

  it('matches case and whole words when asked', () => {
    const documents = [doc('one', 'Gate, gate, gatehouse.')]
    expect(searchProject(documents, 'gate').count).toBe(3)
    expect(searchProject(documents, 'gate', { matchCase: true }).count).toBe(2)
    expect(searchProject(documents, 'gate', { wholeWord: true }).count).toBe(2)
  })

  it('cuts a long line to the words before the match', () => {
    const before = 'word '.repeat(30)
    const [line] = searchProject([doc('one', `${before}gate and more.`)], 'gate').documents[0].lines
    expect(line.before.startsWith('…')).toBe(true)
    expect(line.before.length).toBeLessThanOrEqual(25)
    expect(line.before.endsWith('word ')).toBe(true)
    expect(line.after).toBe(' and more.')
  })

  it('lists so many lines in all, and counts on past them', () => {
    const many = 'gate '.repeat(LINE_LIMIT / 2 + 10)
    const found = searchProject([doc('one', many), doc('two', many)], 'gate')
    expect(found.count).toBe(LINE_LIMIT + 20)
    expect(found.documents.map(document => document.lines.length)).toEqual([
      LINE_LIMIT / 2 + 10,
      LINE_LIMIT / 2 - 10,
    ])
    expect(found.cut).toBe(true)
  })

  it('finds nothing for nothing', () => {
    expect(searchProject([doc('one', 'Anything.')], '')).toEqual({
      documents: [],
      count: 0,
      cut: false,
    })
  })
})
