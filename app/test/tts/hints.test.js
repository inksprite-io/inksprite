import { describe, it, expect } from 'vitest'
import { applyHints, parseHints } from '@/tts/hints.js'

describe('parseHints', () => {
  it('reads word:say, one to a line', () => {
    expect(parseHints('Aelinor:AY-lin-or\nSiobhan: shiv-AWN')).toEqual([
      { word: 'Aelinor', say: 'AY-lin-or' },
      { word: 'Siobhan', say: 'shiv-AWN' },
    ])
  })

  it('skips blank lines, comments, and lines missing a half', () => {
    expect(parseHints('\n# names\nAelinor:AY-lin-or\n\nno colon here\n:nothing\nempty:\n')).toEqual(
      [{ word: 'Aelinor', say: 'AY-lin-or' }]
    )
  })

  it('splits on the first colon only', () => {
    expect(parseHints('time:ten:thirty')).toEqual([{ word: 'time', say: 'ten:thirty' }])
  })

  it('reads nothing from nothing', () => {
    expect(parseHints('')).toEqual([])
    expect(parseHints(null)).toEqual([])
    expect(parseHints(undefined)).toEqual([])
  })
})

describe('applyHints', () => {
  const hints = parseHints('Aelinor:AY-lin-or\nCal:Kal')

  it('respells whole words, in any case', () => {
    expect(applyHints('The Aelinor rises! AELINOR, not Aelinora.', hints)).toBe(
      'The AY-lin-or rises! AY-lin-or, not Aelinora.'
    )
  })

  it('leaves longer words alone', () => {
    expect(applyHints('Cal and Callum and Cal.', hints)).toBe('Kal and Callum and Kal.')
  })

  it('bounds words by letters in any script', () => {
    const accented = parseHints('Zoë:Zo-ay')
    expect(applyHints('Zoë smiled. Zoës book.', accented)).toBe('Zo-ay smiled. Zoës book.')
  })

  it('takes the word and the respelling as written', () => {
    const literal = parseHints('C++:see plus plus\ncost:$5')
    expect(applyHints('I learned C++ at cost.', literal)).toBe('I learned see plus plus at $5.')
  })

  it('changes nothing with no hints', () => {
    expect(applyHints('As written.', [])).toBe('As written.')
  })
})
