import { describe, it, expect } from 'vitest'
import { formatContext, formatPrice } from '@/utils/modelFacts.js'

describe('formatPrice', () => {
  it('says a price per million tokens, read and written', () => {
    expect(formatPrice({ prompt: 0.000003, completion: 0.000015 })).toBe('$3 / $15')
    expect(formatPrice({ prompt: 0.00000037, completion: 0.00000125 })).toBe('$0.37 / $1.25')
    expect(formatPrice({ prompt: 0.00000001, completion: 0.0000068 })).toBe('$0.01 / $6.8')
  })

  it('says Free for a model that costs nothing, and nothing where it isn’t known', () => {
    expect(formatPrice({ prompt: 0, completion: 0 })).toBe('Free')
    expect(formatPrice(undefined)).toBe('')
  })
})

describe('formatContext', () => {
  it('says how much a model reads at once', () => {
    expect(formatContext(1048576)).toBe('1M')
    expect(formatContext(1500000)).toBe('1.5M')
    expect(formatContext(262144)).toBe('262K')
    expect(formatContext(undefined)).toBe('')
  })
})
