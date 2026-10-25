import { describe, it, expect } from 'vitest'
import { isCodeName, languageOf } from '@/source/language.js'

describe('languageOf', () => {
  it('knows a language by its extension, and plain text otherwise', () => {
    expect(languageOf('d20.py')).toEqual({ language: 'Python', mime: 'text/x-python' })
    expect(languageOf('Chapter 1.5')).toEqual({ language: 'Text', mime: 'text/plain' })
  })
})

describe('isCodeName', () => {
  it('takes a script or a table for code', () => {
    expect(isCodeName('d20.py')).toBe(true)
    expect(isCodeName('odds.CSV')).toBe(true)
    expect(isCodeName('Makefile')).toBe(true)
  })

  it('takes prose, Markdown and a name with no language for none', () => {
    expect(isCodeName('Chapter 1')).toBe(false)
    expect(isCodeName('Chapter 1.5')).toBe(false)
    expect(isCodeName('notes.mdx')).toBe(false)
    expect(isCodeName('.py')).toBe(false)
  })
})
