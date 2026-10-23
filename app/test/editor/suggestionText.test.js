import { describe, it, expect } from 'vitest'
import {
  holdsSuggestions,
  seenMarkdown,
  textAsItStands,
  withoutSuggestionMarkup,
} from '@/editor/suggestionText.js'

const MARKDOWN =
  'A {--cold--}{>>sabcd1<<}{++warm++}{>>sabcd1<<} {==night==}{>>cabcd1<<}.\n\n{++Gulls came.++}{>>sabcd2<<}'

describe('suggestions in markdown', () => {
  it('tells a text that may hold one by a half’s close', () => {
    expect(holdsSuggestions(MARKDOWN)).toBe(true)
    expect(holdsSuggestions('A {==night==}{>>cabcd1<<}.')).toBe(false)
    expect(holdsSuggestions(null)).toBe(false)
  })

  it('reads as one reader sees it, comments kept', () => {
    expect(seenMarkdown(MARKDOWN)).toBe('A cold {==night==}{>>cabcd1<<}.')
    expect(seenMarkdown(MARKDOWN, ['sabcd1'])).toBe('A warm {==night==}{>>cabcd1<<}.')
    expect(seenMarkdown(MARKDOWN, ['sabcd1', 'sabcd2'])).toBe(
      'A warm {==night==}{>>cabcd1<<}.\n\nGulls came.'
    )
  })

  it('leaves a text without any as it was, untouched', () => {
    const text = 'Words *as* typed  here.'
    expect(seenMarkdown(text)).toBe(text)
    // A close with no open is text, and the text stays as it was.
    expect(seenMarkdown('One half--}{>>sabcd1<<} and more')).toBe(
      'One half--}{>>sabcd1<<} and more'
    )
  })

  it('gives a reader of the text the text as it stands, without comments', () => {
    expect(textAsItStands(MARKDOWN)).toBe('A cold night.')
  })

  it('reads markup in a text from outside as the change it marks', () => {
    expect(withoutSuggestionMarkup('A {--cold--}{>>sx1234<<}{++warm++}{>>sx1234<<} night.')).toBe(
      'A warm night.'
    )
    expect(withoutSuggestionMarkup('{++\n---\n++}{>>sx1234<<}')).toBe('\n---\n')
    expect(withoutSuggestionMarkup('Plain {++ not closed')).toBe('Plain {++ not closed')
  })
})
