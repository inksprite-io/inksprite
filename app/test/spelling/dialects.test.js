import { describe, it, expect, afterEach, vi } from 'vitest'
import {
  checksByDefault,
  defaultDialect,
  dialectFor,
  isDialect,
} from '../../src/spelling/dialects.js'

describe('dialectFor', () => {
  it("takes the dialect from the browser's region", () => {
    expect(dialectFor('en-US')).toBe('american')
    expect(dialectFor('en-GB')).toBe('british')
    expect(dialectFor('en-AU')).toBe('australian')
    expect(dialectFor('en-CA')).toBe('canadian')
    expect(dialectFor('en-IN')).toBe('indian')
  })

  it('spells as Britain does where the region spells so', () => {
    expect(dialectFor('en-NZ')).toBe('british')
    expect(dialectFor('en-IE')).toBe('british')
  })

  it('takes American for English with no region, or one not listed', () => {
    expect(dialectFor('en')).toBe('american')
    expect(dialectFor('en-PH')).toBe('american')
    expect(dialectFor('en-Latn-GB')).toBe('british')
  })

  it('has none for another language', () => {
    expect(dialectFor('de-DE')).toBe(null)
    expect(dialectFor('fr')).toBe(null)
    expect(dialectFor(undefined)).toBe(null)
  })
})

describe('the defaults', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('check in the dialect of an English browser', () => {
    vi.stubGlobal('navigator', { language: 'en-GB' })
    expect([checksByDefault(), defaultDialect()]).toEqual([true, 'british'])
  })

  it('leave another language to the browser, with American ready', () => {
    vi.stubGlobal('navigator', { language: 'de-DE' })
    expect([checksByDefault(), defaultDialect()]).toEqual([false, 'american'])
  })
})

describe('isDialect', () => {
  it('knows the dialects and nothing else', () => {
    expect(isDialect('british')).toBe(true)
    expect(isDialect('browser')).toBe(false)
    expect(isDialect('klingon')).toBe(false)
    expect(isDialect(null)).toBe(false)
  })
})
