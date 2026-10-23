import { describe, it, expect } from 'vitest'
import { textChanges } from '@/utils/wordDiff.js'

/** The pieces, joined back into the text each side has. */
const sides = pieces => ({
  first: pieces
    .filter(p => p.in !== 'second')
    .map(p => p.text)
    .join(''),
  second: pieces
    .filter(p => p.in !== 'first')
    .map(p => p.text)
    .join(''),
})

describe('textChanges', () => {
  it('marks the words only one side has', () => {
    const pieces = textChanges('The gate was locked.', 'The gate was open.')
    expect(pieces).toEqual([
      { text: 'The gate was ', in: 'both' },
      { text: 'locked.', in: 'first' },
      { text: 'open.', in: 'second' },
    ])
  })

  it('reads back as both texts, paragraphs and all', () => {
    const first = 'Snow fell.\n\nShe waited by the gate.'
    const second = 'Snow fell all night.\n\nShe waited.\n\nNobody came.'
    expect(sides(textChanges(first, second))).toEqual({ first, second })
  })

  it('is one piece when nothing changed', () => {
    expect(textChanges('Snow fell.', 'Snow fell.')).toEqual([{ text: 'Snow fell.', in: 'both' }])
  })

  it('still reads back as both texts past what words are compared for', () => {
    const first = Array.from({ length: 4000 }, (_, i) => `a${i}`).join(' ')
    const second = Array.from({ length: 4000 }, (_, i) => `b${i}`).join(' ')
    expect(sides(textChanges(first, second))).toEqual({ first, second })
  })
})
