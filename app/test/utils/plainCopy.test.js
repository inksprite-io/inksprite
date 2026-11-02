/* global structuredClone */
import { describe, it, expect } from 'vitest'
import { reactive } from 'vue'
import { plainCopy } from '@/utils/plainCopy.js'

const throughJson = value => JSON.parse(JSON.stringify(value))

describe('plainCopy', () => {
  it.each([
    [
      'a row',
      { id: 'd1', title: 'Notes', order: 3, plain: false, summary: null, tags: ['a', 'b'] },
    ],
    ['nesting', { a: { b: { c: [1, [2, { d: 3 }]] } } }],
    [
      'what JSON leaves out of an object',
      { kept: 1, gone: undefined, run: () => 1, s: Symbol('s') },
    ],
    ['what JSON nulls in an array', [undefined, () => 1, Symbol('s'), 1]],
    ['numbers JSON has no way to write', { nan: NaN, far: Infinity, near: -Infinity, zero: -0 }],
    ['a date, by its toJSON', { at: new Date(1793500000000) }],
    ['things with no keys of their own', { map: new Map([[1, 2]]), set: new Set([1]) }],
    ['strings of every kind', { curly: 'it’s', quoted: '"a"\n\\', empty: '' }],
    ['null', null],
    ['a bare string', 'text'],
  ])('holds what JSON would for %s', (_, value) => {
    expect(plainCopy(value)).toEqual(throughJson(value))
  })

  it('keeps a key called __proto__ as a key, as JSON does', () => {
    const value = JSON.parse('{"__proto__": {"polluted": true}, "a": 1}')
    const copy = plainCopy(value)

    expect(Object.keys(copy)).toEqual(['__proto__', 'a'])
    expect(copy.polluted).toBeUndefined()
    expect({}.polluted).toBeUndefined()
  })

  it('shares nothing with what it copied, down to the deepest object', () => {
    const value = { a: { b: [{ c: 1 }] } }
    const copy = plainCopy(value)

    copy.a.b[0].c = 2
    expect(value.a.b[0].c).toBe(1)
  })

  it('takes reactivity off at every depth', () => {
    const value = reactive({ a: { b: [{ c: 1 }] } })
    const copy = plainCopy(value)

    expect(copy).toEqual({ a: { b: [{ c: 1 }] } })
    // A proxy would be refused by a structured clone, which is how rows are stored.
    expect(() => structuredClone(copy)).not.toThrow()
  })

  it('refuses a cycle rather than going round it for ever', () => {
    const value = { a: {} }
    value.a.back = value

    expect(() => plainCopy(value)).toThrow(RangeError)
  })
})
