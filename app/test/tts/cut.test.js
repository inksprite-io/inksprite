import { describe, it, expect, vi } from 'vitest'
import { cutText } from '@/tts/cut.js'

describe('cutText', () => {
  it('leaves a text that fits as it is', () => {
    expect(cutText('Short. Enough.', 14)).toEqual(['Short. Enough.'])
  })

  it('cuts at sentence ends, as few pieces as fit', () => {
    const text = 'The lamp was low. She read on. The clock struck two. Nobody came.'
    const pieces = cutText(text, 32)
    expect(pieces).toEqual([
      'The lamp was low. She read on.',
      'The clock struck two.',
      'Nobody came.',
    ])
    expect(pieces.every(piece => piece.length <= 32)).toBe(true)
  })

  it('keeps a closing quotation mark with its sentence', () => {
    expect(cutText('"Who is there?" she asked. Nobody answered her.', 30)).toEqual([
      '"Who is there?" she asked.',
      'Nobody answered her.',
    ])
  })

  it('cuts a sentence longer than the limit between words', () => {
    const pieces = cutText('one two three four five six seven eight nine ten.', 15)
    expect(pieces).toEqual(['one two three', 'four five six', 'seven eight', 'nine ten.'])
  })

  it('cuts a word longer than the limit where it reaches it', () => {
    expect(cutText('abcdefghij klm', 4)).toEqual(['abcd', 'efgh', 'ij', 'klm'])
  })

  it('cuts at the same places where the browser has no sentence segmenter', () => {
    vi.stubGlobal('Intl', {})
    try {
      expect(cutText('"Who is there?" she asked. Nobody answered her.', 30)).toEqual([
        '"Who is there?" she asked.',
        'Nobody answered her.',
      ])
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('loses no words', () => {
    const text = 'A first line here. '.repeat(40).trim()
    expect(cutText(text, 100).join(' ')).toBe(text)
  })
})
