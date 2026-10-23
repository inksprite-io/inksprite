import { describe, it, expect } from 'vitest'
import { spliceInside } from '@/drive/suggestions.js'

describe('spliceInside', () => {
  const cut = (/** @type {number} */ startIndex, /** @type {number} */ endIndex) => ({
    deleteContentRange: { range: { startIndex, endIndex } },
  })

  it('puts what goes in between two of the words’ own letters, or finds no way', () => {
    const words = { start: 10, text: 'went' }
    // Applied in order to the words, each request leaves what it should.
    /** @param {object[]} requests */
    const apply = requests =>
      requests.reduce((text, request) => {
        const { insertText, deleteContentRange } = /** @type {any} */ (request)
        if (insertText) {
          const at = insertText.location.index - 10
          // In between two of the words' own, never at an end.
          expect(at).toBeGreaterThan(0)
          expect(at).toBeLessThan(text.length)
          return text.slice(0, at) + insertText.text + text.slice(at)
        }
        const { startIndex, endIndex } = deleteContentRange.range
        return text.slice(0, startIndex - 10) + text.slice(endIndex - 10)
      }, 'went')
    expect(apply(/** @type {object[]} */ (spliceInside(words, 0, 0, 'un')))).toBe('unwent')
    expect(apply(/** @type {object[]} */ (spliceInside(words, 4, 4, 'ly')))).toBe('wently')
    expect(apply(/** @type {object[]} */ (spliceInside(words, 0, 2, 'sa')))).toBe('sant')
    expect(apply(/** @type {object[]} */ (spliceInside(words, 2, 4, 'st')))).toBe('west')
    expect(apply(/** @type {object[]} */ (spliceInside(words, 0, 4, 'x')))).toBe('x')
    expect(spliceInside(words, 1, 3, '')).toEqual([cut(11, 13)])
    expect(spliceInside({ start: 10, text: 'a' }, 1, 1, 'n')).toBeNull()
    expect(spliceInside({ start: 10, text: 'a' }, 0, 1, 'an')).toBeNull()
  })

  it('names the tab', () => {
    expect(spliceInside({ start: 10, text: 'went', tabId: 't.1' }, 4, 4, 's')).toEqual([
      { insertText: { text: 'ts', location: { index: 13, tabId: 't.1' } } },
      { deleteContentRange: { range: { startIndex: 15, endIndex: 16, tabId: 't.1' } } },
    ])
  })
})
