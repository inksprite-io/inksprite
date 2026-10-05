import { describe, it, expect } from 'vitest'
import { headingsOf, sectionOf } from '@/ai/tools/slices.js'

/** A thesis's extracted text, made up and in miniature: front matter, then chapters. */
const THESIS = [
  '[p.1]',
  'Contents',
  '1 Introduction 1',
  '2 Where It Fails 9',
  '2.1 Early Results . . . . . . . . . . 10',
  '2.1.1 Sampling . . . . . . . . . . . . 11',
  '',
  'List of Figures',
  '2.1 A paper boat is folded twice and sets out to cross the harbour in',
  '',
  '[p.2]',
  'Chapter 1',
  'Introduction',
  'Words about the whole thing. 1998 Field Notes Quarterly under the heading',
  '',
  '[p.3]',
  'Chapter 2',
  'Where It Fails',
  'The essential critique.',
  '2.1 Early Results',
  'Some results.',
  '2.1.1 Sampling',
  'A fundamental pitfall. See 2.1.1. In recent work by colleagues',
  '2.1.1. In recent work by my colleagues at the lab, the story',
  '[p.4]',
  '2.2 Later Results',
  'Other results.',
  '# Not a heading: a comment in a code listing',
  '',
  '[p.5]',
  'Chapter 3',
  'Doing Better',
  'The end.',
].join('\n')

describe('headingsOf on a PDF’s text', () => {
  const headings = headingsOf(THESIS)

  it('finds the chapters and the numbered sections, with page and offset', () => {
    expect(headings.map(heading => `${heading.number} ${heading.title}`)).toEqual([
      '1 Introduction',
      '2 Where It Fails',
      '2.1 Early Results',
      '2.1.1 Sampling',
      '2.2 Later Results',
      '3 Doing Better',
    ])
    expect(headings.map(heading => heading.level)).toEqual([1, 1, 2, 3, 2, 1])
    const pain = headings[1]
    expect(pain.offset).toBe(THESIS.indexOf('Chapter 2'))
    expect(pain.page).toBe(3)
    expect(headings[4].page).toBe(4)
  })

  it('leaves the contents, the list of figures and stray numbers out', () => {
    const titles = headings.map(heading => heading.title)
    expect(titles).not.toContain(
      'A paper boat is folded twice and sets out to cross the harbour in'
    )
    expect(titles.some(title => title.includes('Quarterly'))).toBe(false)
    expect(titles.some(title => title.startsWith('In recent work'))).toBe(false)
    // The contents' entry for 2.1 comes before the body's; the body's is the one kept.
    expect(headings.find(heading => heading.number === '2.1').offset).toBe(
      THESIS.indexOf('2.1 Early Results\nSome')
    )
  })

  it('does not take a code comment for a Markdown heading in a paged text', () => {
    expect(headings.some(heading => heading.title.includes('code listing'))).toBe(false)
  })

  it('still reads Markdown headings in prose, and falls back to numbers without them', () => {
    expect(headingsOf('# One\n\ntext\n\n## Two\n\nmore').map(heading => heading.title)).toEqual([
      'One',
      'Two',
    ])
    expect(
      headingsOf('1 First\n\ntext\n\n1.1 Inside\n\nmore').map(heading => heading.number)
    ).toEqual(['1', '1.1'])
    expect(headingsOf('Just prose.')).toEqual([])
  })

  it('keeps chapters and sections whole when the map is cut, dropping subsections first', () => {
    const many = ['Chapter 1\nOne']
      .concat(Array.from({ length: 30 }, (_, at) => `1.${at + 1} Section ${at + 1} here`))
      .concat(Array.from({ length: 30 }, (_, at) => `1.1.${at + 1} Sub ${at + 1} here`))
      .join('\n\n')
    const map = headingsOf(`[p.1]\n${many}`, 40)

    expect(map).toHaveLength(40)
    expect(map.filter(heading => heading.level <= 2)).toHaveLength(31)
    expect(map.filter(heading => heading.level === 3)).toHaveLength(9)
  })
})

describe('sectionOf', () => {
  const headings = headingsOf(THESIS)

  it('finds a section by number, with or without "Chapter", and by a piece of its title', () => {
    const two = sectionOf(headings, 'Chapter 2', THESIS.length)
    expect(two.heading.number).toBe('2')
    expect(sectionOf(headings, '2', THESIS.length).heading).toBe(two.heading)
    expect(sectionOf(headings, 'where it', THESIS.length).heading).toBe(two.heading)
    expect(sectionOf(headings, '2.1.1', THESIS.length).heading.title).toBe('Sampling')
  })

  it('runs a section to the next heading at its level or above, and the last to the end', () => {
    const two = sectionOf(headings, '2', THESIS.length)
    expect(two.until).toBe(THESIS.indexOf('Chapter 3'))
    const inside = sectionOf(headings, '2.1', THESIS.length)
    expect(inside.until).toBe(THESIS.indexOf('2.2 Later Results'))
    const sub = sectionOf(headings, '2.1.1', THESIS.length)
    expect(sub.until).toBe(THESIS.indexOf('2.2 Later Results'))
    expect(sectionOf(headings, '3', THESIS.length).until).toBe(THESIS.length)
  })

  it('finds nothing for a name that is not there', () => {
    expect(sectionOf(headings, 'Appendix', THESIS.length)).toBeNull()
    expect(sectionOf(headings, '', THESIS.length)).toBeNull()
  })
})
