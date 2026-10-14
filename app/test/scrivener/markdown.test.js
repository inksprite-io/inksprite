import { describe, it, expect } from 'vitest'
import { kindOf, markdownOfBlocks, markdownOfText } from '@/scrivener/markdown.js'
import { settleMarkdown } from '@/editor/markdown.js'

/**
 * A paragraph as the reader gives one.
 *
 * @param {string|Array<[string, {bold?: boolean, italic?: boolean, strike?: boolean}?]>} runs
 * @param {{style?: string, list?: {level: number, ordered: boolean}}} [options]
 * @returns {import('@/scrivener/rtf.js').RtfParagraph}
 */
const p = (runs, { style, list } = {}) => ({
  type: 'paragraph',
  runs: (typeof runs === 'string' ? [[runs]] : runs).map(([text, marks = {}]) => ({
    text,
    bold: !!marks.bold,
    italic: !!marks.italic,
    strike: !!marks.strike,
  })),
  style: style ?? null,
  list: list ?? null,
})

/** @param {number} level */
const bullet = level => ({ list: { level, ordered: false } })
/** @param {number} level */
const numbered = level => ({ list: { level, ordered: true } })

describe('kindOf', () => {
  it('knows the styles of Scrivener’s templates by name', () => {
    expect(kindOf('Title')).toEqual({ type: 'heading', level: 1 })
    expect(kindOf('Heading 1')).toEqual({ type: 'heading', level: 2 })
    expect(kindOf('heading 2')).toEqual({ type: 'heading', level: 3 })
    expect(kindOf('Heading 9')).toEqual({ type: 'heading', level: 6 })
    expect(kindOf('Block Quote')).toEqual({ type: 'blockquote' })
    expect(kindOf('Code Block')).toEqual({ type: 'code' })
    expect(kindOf('Centered Text')).toEqual({ type: 'paragraph' })
    expect(kindOf(null)).toEqual({ type: 'paragraph' })
  })
})

describe('markdownOfBlocks', () => {
  it('writes styled paragraphs as headings, without the bold their style gives them', () => {
    const markdown = markdownOfBlocks([
      p('Harbour', { style: 'Title' }),
      p([['Before dawn', { bold: true }]], { style: 'Heading 1' }),
      p('Gulls on the wall.'),
    ])

    expect(markdown).toBe('# Harbour\n\n## Before dawn\n\nGulls on the wall.')
  })

  it('keeps bold, italic and strikethrough', () => {
    const markdown = markdownOfBlocks([
      p([
        ['The', { bold: true }],
        [' keeper '],
        ['slept', { italic: true }],
        [' '],
        ['late', { strike: true }],
        [' again.'],
      ]),
    ])

    expect(markdown).toBe('**The** keeper *slept* ~~late~~ again.')
  })

  it('escapes what markdown would read as something else, in the file format’s own form', () => {
    const markdown = markdownOfBlocks([p('#'), p('1. Not a list'), p('<$wc> words')])

    expect(markdown).toBe('\\#\n\n1\\. Not a list\n\n<$wc> words')
    expect(settleMarkdown(markdown)).toBe(markdown)
  })

  it('drops empty paragraphs, and the space and tabs around a paragraph', () => {
    const markdown = markdownOfBlocks([p('\tIndented. '), p(''), p('   '), p('Next.')])

    expect(markdown).toBe('Indented.\n\nNext.')
  })

  it('keeps a line break inside a paragraph', () => {
    expect(markdownOfBlocks([p('Harbour Road\nNorth Point')])).toBe('Harbour Road\nNorth Point')
  })

  it('nests list items by level, and starts a new list where the kind changes', () => {
    const markdown = markdownOfBlocks([
      p('Salt', bullet(0)),
      p('Kelp', bullet(1)),
      p('Wrack', bullet(1)),
      p('Sand', bullet(0)),
      p('First', numbered(0)),
      p('Second', numbered(0)),
      p('After the lists.'),
    ])

    expect(markdown).toBe(
      '- Salt\n  - Kelp\n  - Wrack\n- Sand\n\n1. First\n2. Second\n\nAfter the lists.'
    )
  })

  it('takes a level more than one deeper than the item before as one deeper', () => {
    const markdown = markdownOfBlocks([p('Top', bullet(0)), p('Deep', bullet(3))])

    expect(markdown).toBe('- Top\n  - Deep')
  })

  it('gathers quoted paragraphs into one block quote, and code lines into one block', () => {
    const markdown = markdownOfBlocks([
      p('The sea is calm.', { style: 'Block Quote' }),
      p('The sea is wide.', { style: 'Block Quote' }),
      p('Said the keeper.'),
      p('let tide = 1', { style: 'Code Block' }),
      p('tide++', { style: 'Code Block' }),
    ])

    expect(markdown).toBe(
      '> The sea is calm.\n>\n> The sea is wide.\n\nSaid the keeper.\n\n```\nlet tide = 1\ntide++\n```'
    )
  })

  it('writes a table of rows as a table, its first row the header', () => {
    const markdown = markdownOfBlocks([
      {
        type: 'table',
        rows: [['Name', 'Light'], ['North\nPoint', 'Red'], ['South']],
      },
    ])

    expect(markdown).toBe('| Name | Light |\n| --- | --- |\n| North Point | Red |\n| South |  |')
  })

  it('writes a table of one row, which lays out a page, as its cells’ paragraphs', () => {
    const markdown = markdownOfBlocks([
      { type: 'table', rows: [['A. Keeper\nHarbour Road', '', 'About 900 words.']] },
    ])

    expect(markdown).toBe('A. Keeper\nHarbour Road\n\nAbout 900 words.')
  })

  it('writes nothing for a text with nothing in it', () => {
    expect(markdownOfBlocks([])).toBe('')
    expect(markdownOfBlocks([p(''), p('  ')])).toBe('')
  })
})

describe('markdownOfText', () => {
  it('makes each line of plain text a paragraph', () => {
    expect(markdownOfText('The keeper wakes.\r\n\r\n# Not a heading\n')).toBe(
      'The keeper wakes.\n\n\\# Not a heading'
    )
    expect(markdownOfText(' \n')).toBe('')
  })
})
