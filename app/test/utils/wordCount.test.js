import { describe, it, expect } from 'vitest'
import { countWords } from '../../src/utils/wordCount'

describe('countWords', () => {
  it('counts the words in prose', () => {
    expect(countWords('Hello world this is a test')).toBe(6)
    expect(countWords('Hello    world\n\nthis\tis')).toBe(4)
    expect(countWords("It's a well-known fact.")).toBe(4)
  })

  it('counts through the syntax rather than the syntax', () => {
    expect(countWords('# Chapter One')).toBe(2)
    expect(countWords('**bold** and *italic* and `code`')).toBe(5)
    expect(countWords('- one\n- two\n\n1. three')).toBe(3)
    expect(countWords('> quoted words')).toBe(2)
    expect(countWords('[a link](https://example.com/very/long)')).toBe(2)
    expect(countWords('```\nsome code here\n```')).toBe(3)
  })

  it('does not count a rule or a dash as a word', () => {
    expect(countWords('one\n\n---\n\ntwo')).toBe(2)
    expect(countWords('one — two')).toBe(2)
    expect(countWords('| a | b |')).toBe(2)
  })

  it('counts numbers and any script', () => {
    expect(countWords('3 blind mice')).toBe(3)
    expect(countWords('Ünïcödé wörds naïve café')).toBe(4)
    expect(countWords('日本語 テキスト')).toBe(2)
  })

  it('counts nothing as nothing', () => {
    expect(countWords('')).toBe(0)
    expect(countWords('   \n  ')).toBe(0)
    expect(countWords(null)).toBe(0)
    expect(countWords(undefined)).toBe(0)
  })

  it("counts a comment's passage and not what was said about it", () => {
    expect(
      countWords('We had a {==cold and narrow==}{>>c7k2m1: reword this phrase<<} attic.')
    ).toBe(7)
  })
})
