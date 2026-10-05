import { describe, it, expect } from 'vitest'
import { partialStrings } from '../../src/utils/partialJson'

describe('partialStrings', () => {
  it('reads the string fields of a whole object', () => {
    expect(partialStrings('{"path": "notes/Elara", "new": "A knight."}')).toEqual({
      path: 'notes/Elara',
      new: 'A knight.',
    })
  })

  it('reads a field that is still arriving, as far as it has got', () => {
    expect(partialStrings('{"path":"notes/Elara","new":"Snow fell on')).toEqual({
      path: 'notes/Elara',
      new: 'Snow fell on',
    })
  })

  it('decodes escapes, and waits for one cut off at the end', () => {
    expect(partialStrings('{"new":"She said \\"go\\".\\nThen')).toEqual({
      new: 'She said "go".\nThen',
    })
    expect(partialStrings('{"new":"tail\\')).toEqual({ new: 'tail' })
    expect(partialStrings('{"new":"caf\\u00e')).toEqual({ new: 'caf' })
    expect(partialStrings('{"new":"caf\\u00e9"}')).toEqual({ new: 'café' })
  })

  it('reads through a nested object, by the inner keys', () => {
    expect(partialStrings('{"path":"a","updates":{"summary":"s","content":"Once upo')).toEqual({
      path: 'a',
      summary: 's',
      content: 'Once upo',
    })
  })

  it('reads nothing from nothing, or from a text with no string field yet', () => {
    expect(partialStrings('')).toEqual({})
    expect(partialStrings(null)).toEqual({})
    expect(partialStrings(undefined)).toEqual({})
    expect(partialStrings('{"pa')).toEqual({})
    expect(partialStrings('{"count": 3')).toEqual({})
  })
})
