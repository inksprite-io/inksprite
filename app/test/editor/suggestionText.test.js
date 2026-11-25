import { describe, it, expect } from 'vitest'
import {
  holdsSuggestions,
  readingOf,
  seenMarkdown,
  textAsItStands,
  withoutSuggestionMarkup,
} from '@/editor/suggestionText.js'
import { withoutComments } from '@/editor/comments.js'
import { parseMarkdown, serializeMarkdown } from '@/editor/markdown.js'
import { suggestChange, suggestionsIn } from '@/editor/suggestions.js'
import { anyEdit, plain, random } from '../drive/randomEdits.js'

const MARKDOWN =
  'A {--cold--}{>>sabcd1<<}{++warm++}{>>sabcd1<<} {==night==}{>>cabcd1<<}.\n\n{++Gulls came.++}{>>sabcd2<<}'

describe('suggestions in markdown', () => {
  it('tells a text that may hold one by a half’s close', () => {
    expect(holdsSuggestions(MARKDOWN)).toBe(true)
    expect(holdsSuggestions('A {==night==}{>>cabcd1<<}.')).toBe(false)
    expect(holdsSuggestions(null)).toBe(false)
  })

  it('reads as one reader sees it, comments kept', () => {
    expect(seenMarkdown(MARKDOWN)).toBe('A cold {==night==}{>>cabcd1<<}.')
    expect(seenMarkdown(MARKDOWN, ['sabcd1'])).toBe('A warm {==night==}{>>cabcd1<<}.')
    expect(seenMarkdown(MARKDOWN, ['sabcd1', 'sabcd2'])).toBe(
      'A warm {==night==}{>>cabcd1<<}.\n\nGulls came.'
    )
  })

  it('leaves a text without any as it was, untouched', () => {
    const text = 'Words *as* typed  here.'
    expect(seenMarkdown(text)).toBe(text)
    // A close with no open is text, and the text stays as it was.
    expect(seenMarkdown('One half--}{>>sabcd1<<} and more')).toBe(
      'One half--}{>>sabcd1<<} and more'
    )
  })

  it('gives a reader of the text the text as it stands, without comments', () => {
    expect(textAsItStands(MARKDOWN)).toBe('A cold night.')
  })

  it('reads markup in a text from outside as the change it marks', () => {
    expect(withoutSuggestionMarkup('A {--cold--}{>>sx1234<<}{++warm++}{>>sx1234<<} night.')).toBe(
      'A warm night.'
    )
    expect(withoutSuggestionMarkup('{++\n---\n++}{>>sx1234<<}')).toBe('\n---\n')
    expect(withoutSuggestionMarkup('Plain {++ not closed')).toBe('Plain {++ not closed')
  })
})

describe('a reading, and each suggestion the other way', () => {
  /** A reader's text the long way: the whole document written as they see it. */
  const whole = (markdown, made) => withoutComments(seenMarkdown(markdown, made))

  /**
   * Every suggestion of a text the other way, for a reader who sees `made`:
   * each must be the whole document written so, and share with the reader's
   * text what it says it does.
   */
  const turnedRight = (markdown, made, label = markdown) => {
    const doc = parseMarkdown(markdown)
    const reading = readingOf(doc, made)
    expect(reading.text, label).toBe(whole(markdown, made))
    for (const id of suggestionsIn(doc)) {
      const other = made.includes(id) ? made.filter(each => each !== id) : [...made, id]
      const turned = reading.turned(id)
      expect(turned.text, `${label}\n${id} for ${made}`).toBe(whole(markdown, other))
      expect(turned.text.slice(0, turned.start)).toBe(reading.text.slice(0, turned.start))
      expect(turned.text.slice(turned.text.length - turned.end)).toBe(
        reading.text.slice(reading.text.length - turned.end)
      )
    }
    return reading
  }

  /** Each way a text's suggestions can be seen: none made, all, and each alone. */
  const readers = markdown => {
    const ids = suggestionsIn(parseMarkdown(markdown))
    return [[], ids, ...ids.map(id => [id])]
  }

  it('gives the reader’s text without comments, and the text with one the other way', () => {
    const reading = readingOf(parseMarkdown(MARKDOWN), ['sabcd1'])
    expect(reading.text).toBe('A warm night.')
    expect(reading.turned('sabcd1')).toEqual({ text: 'A cold night.', start: 0, end: 0 })
    expect(reading.turned('sabcd2').text).toBe('A warm night.\n\nGulls came.')
  })

  it('writes again only the blocks around the one turned, and says how much is the same', () => {
    const blocks = ['First words.', 'A {--cold--}{>>sabcd1<<}{++warm++}{>>sabcd1<<} night.']
    const markdown = [...blocks, 'Third words.', 'Fourth words.', 'Fifth words.'].join('\n\n')
    const reading = readingOf(parseMarkdown(markdown), [])
    // From the block before it to the block after: the rest is the reader's text.
    expect(reading.turned('sabcd1')).toEqual({
      text: 'First words.\n\nA warm night.\n\nThird words.\n\nFourth words.\n\nFifth words.',
      start: 0,
      end: '\n\nFourth words.\n\nFifth words.'.length,
    })
  })

  it('leaves the text as it is for a suggestion the document has not', () => {
    const reading = readingOf(parseMarkdown(MARKDOWN), [])
    expect(reading.turned('snone1').text).toBe(reading.text)
    expect(reading.text).toBe('A cold night.')
  })

  it.each([
    [
      'at a block’s start and its end',
      '{--Rain--}{>>sabc1<<}{++Snow++}{>>sabc1<<} from the west{++, hard++}{>>sabc2<<}\n\nLast words.',
    ],
    [
      'several in a block, two with nothing between',
      'One.\n\nA {--cold--}{>>sabc1<<}{++warm++}{>>sabc1<<}{--, dark--}{>>sabc2<<}{++, bright++}{>>sabc2<<} night, {++very ++}{>>sabc3<<}long.\n\nThree.',
    ],
    [
      'a block put in whole and one taken out',
      'One.\n\n{++Put in whole.++}{>>sabc1<<}\n\n{--Taken out whole.--}{>>sabc2<<}\n\nFour.',
    ],
    [
      'a rule and a table, by marks of their own',
      'One.\n\n{++\n---\n++}{>>sabc1<<}\n\n{--\n| a | b |\n| --- | --- |\n| c | d |\n--}{>>sabc2<<}\n\nFour.',
    ],
    [
      'one across blocks',
      'One.\n\nThe first of {--two.--}{>>sabc1<<}{++two, and more.++}{>>sabc1<<}\n\n{--The second of two.--}{>>sabc1<<}\n\nFour.',
    ],
    [
      'a code block for another',
      '{--\n```\nold code\n```\n--}{>>sabc1<<}\n\n{++\n```\nnew code\n```\n++}{>>sabc1<<}\n\nAfter it.',
    ],
    [
      'in a list, and a list in it',
      '- one\n  - {--inner--}{>>sabc1<<}{++deeper++}{>>sabc1<<}\n  - {++more++}{>>sabc2<<}\n- two',
    ],
    [
      'items of a numbered list',
      '1. one\n2. {--two--}{>>sabc1<<}\n3. three\n4. {++four++}{>>sabc2<<}',
    ],
    ['what is between two lists', '- one\n- two\n\n{--Between them.--}{>>sabc1<<}\n\n- three'],
    [
      'in a quote and a heading',
      '> Mind the {--gap--}{>>sabc1<<}{++step++}{>>sabc1<<}.\n\n# The {--old--}{>>sabc2<<}{++new++}{>>sabc2<<} title',
    ],
    [
      'in a table’s cells',
      '| Day | Miles |\n| --- | --- |\n| Mon | {--12--}{>>sabc1<<}{++14++}{>>sabc1<<} |\n| {++Tue++}{>>sabc2<<} | 9 |',
    ],
    [
      'in bold and in a link',
      'Rain, **{--hard--}{>>sabc1<<}{++soft++}{>>sabc1<<}**, then [{--dry--}{>>sabc2<<}{++wet++}{>>sabc2<<}](https://example.com).',
    ],
    [
      'beside a comment and a formula',
      'A {==cold==}{>>cabcd1<<} {--night--}{>>sabc1<<}{++day++}{>>sabc1<<}, and $x^2${++ or $y^2$++}{>>sabc2<<}.',
    ],
    ['all the document holds, put in', '{++Only words here.++}{>>sabc1<<}'],
    [
      'all the document holds, taken out',
      '{--Only words here.--}{>>sabc1<<}\n\n{--\n---\n--}{>>sabc2<<}',
    ],
    [
      'beside an empty paragraph put in',
      '{++Put first.++}{>>sabc1<<}\n\n{++\n++}{>>sabc2<<}\n\nLast words.',
    ],
    [
      'between empty paragraphs put in',
      'First.\n\n{++\n++}{>>sabc1<<}\n\n{++Second.++}{>>sabc2<<}\n\n{++\n++}{>>sabc3<<}\n\n{--Last.--}{>>sabc2<<}',
    ],
    [
      'among paragraphs that read alike',
      `${'The tide came in.\n\n'.repeat(4)}The tide {--came--}{>>sabc1<<}{++went++}{>>sabc1<<} in.\n\n{--The tide came in.--}{>>sabc2<<}${'\n\nThe tide came in.'.repeat(4)}`,
    ],
  ])('is the whole document written the other way: %s', (_shape, markdown) => {
    for (const made of readers(markdown)) turnedRight(markdown, made)
  })

  it('writes the whole document where its text has all its dollars escaped', () => {
    // The serializer marks a dollar by a character the text has none of, and
    // escapes every dollar where the text has them all: blocks written
    // alone, without those characters, would not.
    const markdown =
      'Marks \uE000 and \uF8FF here.\n\nBetween.\n\nIt costs {++$5 or $6 ++}{>>sabc1<<}today.\n\nAfter.'
    const reading = turnedRight(markdown, [])
    expect(reading.turned('sabc1').text).toContain('It costs \\$5 or \\$6 today.')
    expect(reading.turned('sabc1')).toMatchObject({ start: 0, end: 0 })
  })

  it('is the whole document written the other way, over changes made at random', () => {
    const sample = [
      '# Harbour notes',
      'Rain from the west, **hard**, then *dry*. Ask [Ada](https://example.com) about it.',
      'The ferry was late again and {==nobody minded==}{>>c7k2m1<<} much.',
      '- Ropes\n- Oars',
      '> Mind the gap.',
      '| Day | Miles |\n| --- | --- |\n| Mon | 12 |',
      '```\ncode stays\n```',
      'The ferry was late again.',
      'The ferry was late again.',
      '---',
      'Last words of the day.',
    ].join('\n\n')
    const next = random(29)
    /** The text with one to three edits made to it. */
    const edited = text => {
      const blocks = text.split('\n\n')
      const pick = list => {
        const choices = list.map((block, i) => (plain(block) ? i : -1)).filter(i => i >= 0)
        return choices.length ? choices[Math.floor(next() * choices.length)] : -1
      }
      for (let k = 1 + Math.floor(next() * 3); k > 0; k--) {
        if (next() < 0.15) blocks.splice(Math.floor(next() * (blocks.length + 1)), 0, '---')
        else anyEdit(blocks, pick, next)
      }
      return blocks.join('\n\n')
    }
    let count = 0
    const fresh = () => `sn${String(++count).padStart(4, '0')}`
    let turned = 0
    for (let round = 0; round < 150; round++) {
      // Two writers' changes, the second made over the first's, not seen.
      const first = suggestChange(
        parseMarkdown(sample),
        parseMarkdown(edited(sample)),
        fresh(),
        [],
        fresh
      )
      const both = suggestChange(first.doc, parseMarkdown(edited(sample)), fresh(), [], fresh)
      const markdown = serializeMarkdown(both.doc)
      const ids = suggestionsIn(both.doc)
      for (const made of [[], first.ids, both.ids, ids.filter(() => next() < 0.5)]) {
        turnedRight(markdown, made, `round ${round}:\n${markdown}`)
        turned += ids.length
      }
    }
    expect(turned).toBeGreaterThan(1500)
    // Thousands of random changes: past the 5-second default on a slow CI runner.
  }, 30_000)
})
