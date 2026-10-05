import { describe, it, expect } from 'vitest'
import {
  findSection,
  indexOf,
  linker,
  markdownSections,
  sectionIndexAt,
  sectionPath,
  sectionTree,
  slugOf,
} from '@/utils/sections.js'

const DOC = [
  '# Rules',
  'Intro words here.',
  '## Combat',
  'Swing a sword.',
  '### Grappling',
  'Hold on tight.',
  '```',
  '# not a heading',
  '```',
  '## Magic',
  'Cast a spell.',
  '# Examples',
  'One.',
  '## Examples',
  'Two.',
].join('\n')

describe('Markdown sections', () => {
  it('makes a link the way Markdown viewers do', () => {
    expect(slugOf('Game Tuning & Static Flow')).toBe('game-tuning--static-flow')
    expect(slugOf("What's Next? (Part 2)")).toBe('whats-next-part-2')
    expect(slugOf('Jötunn Rules')).toBe('jötunn-rules')
  })

  it('numbers a repeated link, and never hands out one twice', () => {
    const link = linker()
    expect(['Intro', 'Intro', 'Intro-1', 'Intro'].map(link)).toEqual([
      'intro',
      'intro-1',
      'intro-1-1',
      'intro-2',
    ])
    expect(linker()('!!!')).toBe('section')
  })

  it('finds the headings outside code, each with where it runs and how long it is', () => {
    const sections = markdownSections(DOC)

    expect(sections.map(section => [section.level, section.title, section.link])).toEqual([
      [1, 'Rules', 'rules'],
      [2, 'Combat', 'combat'],
      [3, 'Grappling', 'grappling'],
      [2, 'Magic', 'magic'],
      [1, 'Examples', 'examples'],
      [2, 'Examples', 'examples-1'],
    ])
    const combat = sections[1]
    expect(combat.offset).toBe(DOC.indexOf('## Combat'))
    expect(combat.end).toBe(DOC.indexOf('### Grappling'))
    expect(combat.until).toBe(DOC.indexOf('## Magic'))
    // Its own words and its subsection's, code included.
    expect(combat.words).toBe(
      DOC.slice(combat.offset, combat.until).split(/\s+/).filter(Boolean).length
    )
    expect(sections[0].until).toBe(DOC.indexOf('# Examples'))
    expect(sections[5].until).toBe(DOC.length)
  })

  it('takes the marks off a heading and leaves its words', () => {
    const [section] = markdownSections('## **Bold** and [linked](#x) `code`')
    expect(section.title).toBe('Bold and linked code')
  })

  it('builds the tree, and cuts deep levels when it is too big, saying how many', () => {
    const sections = markdownSections(DOC)
    const tree = sectionTree(sections)
    expect(tree.map(node => node.link)).toEqual(['rules', 'examples'])
    expect(tree[0].sections.map(node => node.link)).toEqual(['combat', 'magic'])
    expect(tree[0].sections[0].sections).toEqual([
      { link: 'grappling', title: 'Grappling', words: expect.any(Number) },
    ])

    const cut = sectionTree(sections, 3)
    expect(cut.map(node => node.link)).toEqual(['rules', 'examples'])
    expect(cut[0]).not.toHaveProperty('sections')
    expect(cut[0].more).toBe(3)
    expect(cut[1].more).toBe(1)
  })

  it('finds a section by link, by title, or by a piece of its title', () => {
    const sections = markdownSections(DOC)
    expect(findSection(sections, 'examples-1')?.level).toBe(2)
    expect(findSection(sections, '#combat')?.title).toBe('Combat')
    expect(findSection(sections, 'Grappling')?.link).toBe('grappling')
    expect(findSection(sections, 'grapp')?.link).toBe('grappling')
    expect(findSection(sections, 'nothing like it')).toBeNull()
    expect(findSection(sections, '  ')).toBeNull()
  })

  it('writes an index of links, three levels deep from the top', () => {
    const deep = '# A\n## B\n### C\n#### D\n# E'
    expect(indexOf(markdownSections(deep))).toBe(
      ['- [A](#a)', '  - [B](#b)', '    - [C](#c)', '- [E](#e)'].join('\n')
    )
    expect(indexOf(markdownSections('## Only [odd] one'))).toBe(
      '- [Only \\[odd\\] one](#only-odd-one)'
    )
    expect(indexOf([])).toBe('')
  })

  /** A chapter with a long run of spells under one section, and two short sections. */
  const SPELLS = [
    '# Spells',
    '## Casting',
    'How to cast.',
    '## Spell Descriptions',
    ...Array.from({ length: 40 }, (_, at) => `### Spell ${at + 1}\nIt does ${at + 1} things.`),
    '## Lists',
    'Lists of spells.',
  ].join('\n')

  it('says how many a long run of subsections has, with the first and last, instead of listing them', () => {
    const tree = sectionTree(markdownSections(SPELLS))
    const descriptions = tree[0].sections.find(node => node.link === 'spell-descriptions')
    expect(descriptions).toEqual({
      link: 'spell-descriptions',
      title: 'Spell Descriptions',
      words: expect.any(Number),
      entries: 40,
      range: 'Spell 1 … Spell 40',
    })
    expect(tree[0].sections.map(node => node.link)).toEqual([
      'casting',
      'spell-descriptions',
      'lists',
    ])
    // The run itself, asked for as the top level, is listed whole.
    const inner = markdownSections(SPELLS).filter(section => section.level === 3)
    expect(sectionTree(inner)).toHaveLength(40)
  })

  it('counts a long run in the index, not a line each', () => {
    const index = indexOf(markdownSections(SPELLS)).split('\n')
    expect(index).toEqual([
      '- [Spells](#spells)',
      '  - [Casting](#casting)',
      '  - [Spell Descriptions](#spell-descriptions) (40 entries)',
      '  - [Lists](#lists)',
    ])
  })

  it('says which section an offset is in, and where that section sits', () => {
    const sections = markdownSections(SPELLS)
    const at = SPELLS.indexOf('It does 7 things')
    const index = sectionIndexAt(sections, at)
    expect(sections[index].title).toBe('Spell 7')
    expect(sectionPath(sections, index)).toBe('Spells / Spell Descriptions / Spell 7')
    expect(sectionIndexAt(markdownSections('Before.\n# One'), 0)).toBe(-1)
  })
})
