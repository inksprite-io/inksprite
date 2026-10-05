import { describe, it, expect } from 'vitest'
import {
  READ_BUDGET,
  headingsOf,
  isLong,
  offsetOfPage,
  pageAt,
  sliceAt,
  wordsIn,
} from '@/ai/tools/slices.js'

/** Paragraphs of a given size, numbered, separated by blank lines. */
const paragraphs = (count, size = 500) =>
  Array.from({ length: count }, (_, at) => `P${at + 1} ` + 'x'.repeat(size - 4)).join('\n\n')

/** A PDF's text as the importer writes it: pages under markers. */
const paged = pages => pages.map((body, at) => `[p.${at + 1}]\n${body}`).join('\n\n')

describe('sliceAt', () => {
  it('returns a short text whole, with nothing to go on to', () => {
    const slice = sliceAt('Hello there.', 0)

    expect(slice).toEqual({ text: 'Hello there.', from: 0, to: 12, length: 12, next: null })
    expect(isLong('Hello there.')).toBe(false)
  })

  it('cuts a long text at a paragraph break within the budget, and says where to go on', () => {
    const text = paragraphs(200)
    expect(isLong(text)).toBe(true)

    const first = sliceAt(text, 0)

    expect(first.from).toBe(0)
    expect(first.to).toBeLessThanOrEqual(READ_BUDGET)
    expect(first.to).toBeGreaterThan(READ_BUDGET - 4000)
    expect(text.slice(first.to, first.to + 2)).toBe('\n\n')
    expect(first.text.endsWith('x')).toBe(true)
    expect(first.next).toBe(first.to)
    expect(first.length).toBe(text.length)
  })

  it('reads on from the next offset until the end', () => {
    const text = paragraphs(200)
    let slice = sliceAt(text, 0)
    let pieces = [slice.text]
    while (slice.next !== null) {
      slice = sliceAt(text, slice.next)
      pieces.push(slice.text)
    }

    expect(slice.next).toBeNull()
    expect(slice.to).toBe(text.length)
    // Joined back with the breaks the cuts fell on, nothing was lost.
    expect(pieces.join('\n\n').replace(/\n\n\n\n/g, '\n\n')).toBe(text)
  })

  it('cuts at a line when there is no paragraph to cut at, and at the budget when there is no line', () => {
    const lines = Array.from({ length: 100 }, (_, at) => `L${at} ` + 'y'.repeat(600)).join('\n')
    const byLine = sliceAt(lines, 0)
    expect(lines[byLine.to]).toBe('\n')

    const solid = 'z'.repeat(READ_BUDGET * 2)
    expect(sliceAt(solid, 0).to).toBe(READ_BUDGET)
  })

  it('takes an offset past the end as the end, and a bad one as the start', () => {
    const text = paragraphs(10)
    expect(sliceAt(text, text.length + 50)).toMatchObject({
      text: '',
      from: text.length,
      next: null,
    })
    expect(sliceAt(text, -5).from).toBe(0)
    expect(sliceAt(text, NaN).from).toBe(0)
  })
})

describe('pages', () => {
  const text = paged(['First page.', 'Second page.', 'Third page.'])

  it('finds where a page starts, at its marker', () => {
    expect(offsetOfPage(text, 1)).toBe(0)
    expect(text.slice(offsetOfPage(text, 2), offsetOfPage(text, 2) + 5)).toBe('[p.2]')
    expect(offsetOfPage(text, 9)).toBeNull()
  })

  it('says which page an offset is on', () => {
    expect(pageAt(text, 0)).toBe(1)
    expect(pageAt(text, offsetOfPage(text, 2) + 3)).toBe(2)
    expect(pageAt(text, text.length)).toBe(3)
    expect(pageAt('No pages here.', 5)).toBeNull()
  })
})

describe('headingsOf', () => {
  it('lists the headings with their offsets and levels', () => {
    const text = '# Title\n\nIntro.\n\n## Method\n\nWords.\n\n### Detail ###\n\nMore.'

    expect(headingsOf(text)).toEqual([
      { title: 'Title', level: 1, offset: 0 },
      { title: 'Method', level: 2, offset: text.indexOf('## Method') },
      { title: 'Detail', level: 3, offset: text.indexOf('### Detail') },
    ])
  })

  it('adds the page for a text that has pages, and caps a long map', () => {
    const text = paged(['# One\n\nA.', '# Two\n\nB.'])
    expect(headingsOf(text)).toEqual([
      { title: 'One', level: 1, offset: text.indexOf('# One'), page: 1 },
      { title: 'Two', level: 1, offset: text.indexOf('# Two'), page: 2 },
    ])

    const many = Array.from({ length: 100 }, (_, at) => `# H${at}`).join('\n\n')
    expect(headingsOf(many, 10)).toHaveLength(10)
  })

  it('is empty for a text with no headings', () => {
    expect(headingsOf('Just prose.\n\nMore prose.')).toEqual([])
  })
})

describe('wordsIn', () => {
  it('counts words the way the listing does', () => {
    expect(wordsIn('one two\n\nthree')).toBe(3)
    expect(wordsIn('')).toBe(0)
  })
})
