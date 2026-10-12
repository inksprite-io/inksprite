import { describe, it, expect } from 'vitest'
import {
  applyFilters,
  filteredRanges,
  filtersValid,
  parseFilters,
  piecesOf,
} from '@/tts/filters.js'

describe('parseFilters', () => {
  it('reads a regular expression to a line, passing over blank lines and broken ones', () => {
    const filters = parseFilters('^Page \\d+$\n\n  \\[\\d+\\]  \n(unclosed')
    expect(filters.map(filter => filter.source)).toEqual(['^Page \\d+$', '\\[\\d+\\]'])
  })

  it('has none in no text', () => {
    expect(parseFilters('')).toEqual([])
    expect(parseFilters(undefined)).toEqual([])
  })
})

describe('filtersValid', () => {
  it('says whether every line is a regular expression', () => {
    expect(filtersValid('^Page \\d+$\n\n\\[\\d+\\]')).toBe(true)
    expect(filtersValid('')).toBe(true)
    expect(filtersValid('^Page \\d+$\n[unclosed')).toBe(false)
  })
})

describe('filteredRanges', () => {
  it('finds every match of every filter, in order', () => {
    const filters = parseFilters('\\[\\d+\\]\nfact')
    expect(filteredRanges('A fact [1] and [2].', filters)).toEqual([
      { from: 2, to: 6 },
      { from: 7, to: 10 },
      { from: 15, to: 18 },
    ])
  })

  it('joins matches that overlap or touch', () => {
    // `[1` and `1]` overlap; `[` and `1` touch.
    expect(filteredRanges('[1] x', parseFilters('\\[\\d\n\\d\\]'))).toEqual([{ from: 0, to: 3 }])
    expect(filteredRanges('[1] x', parseFilters('\\[\n\\d'))).toEqual([{ from: 0, to: 2 }])
  })

  it('takes the ends of a line as the ends of a line within a block', () => {
    expect(filteredRanges('The end.\n12', parseFilters('^\\d+$'))).toEqual([{ from: 9, to: 11 }])
  })

  it('passes over a filter that matches nothing but the space between characters', () => {
    expect(filteredRanges('Snow.', parseFilters('x*'))).toEqual([])
  })
})

describe('piecesOf', () => {
  it('cuts the text where the filters match', () => {
    expect(piecesOf('A fact [1].', parseFilters('\\s*\\[\\d+\\]'))).toEqual([
      { text: 'A fact', filtered: false },
      { text: ' [1]', filtered: true },
      { text: '.', filtered: false },
    ])
    expect(piecesOf('Snow.', [])).toEqual([{ text: 'Snow.', filtered: false }])
  })
})

describe('applyFilters', () => {
  it('takes out what the filters match', () => {
    expect(applyFilters('This is a fact [1].', parseFilters('\\s*\\[\\d+\\]'))).toBe(
      'This is a fact.'
    )
  })

  it('leaves nothing of a block the filters take all of, but space', () => {
    expect(applyFilters('Page 12', parseFilters('^Page \\d+$'))).toBe('')
    expect(applyFilters('[1] [2]', parseFilters('\\[\\d+\\]'))).toBe('')
  })

  it('leaves the text as it was where nothing matches', () => {
    expect(applyFilters('Snow fell.', parseFilters('^Page \\d+$'))).toBe('Snow fell.')
    expect(applyFilters('Snow fell.', [])).toBe('Snow fell.')
  })
})
