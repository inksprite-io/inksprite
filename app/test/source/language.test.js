import { describe, it, expect } from 'vitest'
import { keepsAsWritten, languageOf } from '@/source/language.js'

describe('languageOf', () => {
  it('knows a language by its extension, and plain text otherwise', () => {
    expect(languageOf('d20.py')).toEqual({ language: 'Python', mime: 'text/x-python' })
    expect(languageOf('Chapter 1.5')).toEqual({ language: 'Text', mime: 'text/plain' })
  })
})

describe('keepsAsWritten', () => {
  it('keeps a script, a table or plain text as written', () => {
    expect(keepsAsWritten('d20.py')).toBe(true)
    expect(keepsAsWritten('odds.CSV')).toBe(true)
    expect(keepsAsWritten('Makefile')).toBe(true)
    expect(keepsAsWritten('prompt.txt')).toBe(true)
    expect(keepsAsWritten('NOTES.TXT')).toBe(true)
  })

  it('lays out prose, Markdown and a name with no language', () => {
    expect(keepsAsWritten('Chapter 1')).toBe(false)
    expect(keepsAsWritten('Chapter 1.5')).toBe(false)
    expect(keepsAsWritten('notes.mdx')).toBe(false)
    expect(keepsAsWritten('.py')).toBe(false)
  })
})
