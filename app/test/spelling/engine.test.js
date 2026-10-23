// @vitest-environment node
import { describe, it, expect, beforeAll } from 'vitest'
import { LocalLinter } from 'harper.js'
import { slimBinary } from 'harper.js/slimBinary'
import {
  baseWord,
  configure,
  harperWords,
  hyphenatedIn,
  isHyphenated,
  lintHash,
  lintTexts,
  wordAround,
} from '../../src/spelling/engine.js'

/**
 * Harper itself, run in Node as the worker runs it. Building its dictionary
 * takes most of a second, so one linter serves the file, set up again by each
 * test that changes it.
 */

/** @type {LocalLinter} */
let linter

beforeAll(async () => {
  linter = new LocalLinter({ binary: slimBinary })
  await linter.setup()
}, 30000)

/** The hyphenated words the last `configure` gave back. */
let hyphenated = new Set()

/** @param {string} text */
const lintsOf = async text => (await lintTexts(linter, [text], hyphenated))[0]

/** @param {string} text */
const flagged = async text => (await lintsOf(text)).map(lint => lint.text)

describe('lintTexts', () => {
  it('finds misspellings, at their places in the string', async () => {
    hyphenated = await configure(linter, { dialect: 'american', words: [] })
    const text = 'She walkd to the door.'
    const [lint] = await lintsOf(text)
    expect(lint).toMatchObject({ kind: 'Spelling', text: 'walkd' })
    expect(text.slice(lint.from, lint.to)).toBe('walkd')
    expect(lint.suggestions).toContain('walked')
  })

  it('counts an emoji as JavaScript does', async () => {
    hyphenated = await configure(linter, { dialect: 'american', words: [] })
    const text = '\u{1F642}\u{1F642} She walkd home.'
    const [lint] = await lintsOf(text)
    expect(text.slice(lint.from, lint.to)).toBe('walkd')
  })

  it('reads a line break as one character', async () => {
    hyphenated = await configure(linter, { dialect: 'american', words: [] })
    const text = 'She walkd\nto teh door.'
    const lints = await lintsOf(text)
    expect(lints.map(lint => text.slice(lint.from, lint.to))).toEqual(['walkd', 'teh'])
  })

  it('checks each text on its own, with its own offsets', async () => {
    hyphenated = await configure(linter, { dialect: 'american', words: [] })
    const texts = ['All is well.', 'She walkd home.', '', 'Then teh rain.']
    const results = await lintTexts(linter, texts)
    expect(
      results.map(lints =>
        lints.map(lint => texts[results.indexOf(lints)].slice(lint.from, lint.to))
      )
    ).toEqual([[], ['walkd'], [], ['teh']])
  })

  it('has nothing to check in nothing', async () => {
    expect(await lintTexts(linter, [])).toEqual([])
    expect(await lintTexts(linter, ['', ' '])).toEqual([[], []])
  })

  it('gives grammar a hash to ignore it by, and spelling none', async () => {
    hyphenated = await configure(linter, { dialect: 'american', words: [] })
    const lints = await lintsOf('He go home and walkd.')
    const grammar = lints.find(lint => lint.text === 'go')
    const spelling = lints.find(lint => lint.text === 'walkd')
    expect(grammar?.hash).toMatch(/^[0-9a-z]+$/)
    expect(spelling?.hash).toBeUndefined()
  })

  it('gives each part of a hyphenated misspelling the whole word', async () => {
    hyphenated = await configure(linter, { dialect: 'american', words: [] })
    const lints = await lintsOf('The Wi-Fi was down, and walkd.')
    expect(lints.map(({ text, word }) => [text, word])).toEqual([
      ['Wi', 'Wi-Fi'],
      ['Fi', 'Wi-Fi'],
      ['walkd', undefined],
    ])
  })

  it('quotes in its messages rather than marking up', async () => {
    hyphenated = await configure(linter, { dialect: 'american', words: [] })
    const [lint] = await lintsOf('She walkd home.')
    expect(lint.message).not.toContain('`')
    expect(lint.message).toContain('“walkd”')
  })

  it('never suggests the text as it stands', async () => {
    hyphenated = await configure(linter, { dialect: 'american', words: [] })
    for (const lint of await lintsOf('Its a long way, and teh road is long.')) {
      expect(lint.suggestions).not.toContain(lint.text)
    }
  })

  it('leaves dialogue spelt on purpose alone', async () => {
    hyphenated = await configure(linter, { dialect: 'american', words: [] })
    expect(await flagged('“I ain’t going, and I dunno who’s gonna,” she said.')).toEqual([])
  })
})

describe('configure', () => {
  it('knows the words it is given, and their possessives with either apostrophe', async () => {
    hyphenated = await configure(linter, { dialect: 'american', words: [] })
    expect(await flagged('Tavrek and Quellith met. Tavrek’s boat.')).toEqual([
      'Tavrek',
      'Quellith',
      'Tavrek’s',
    ])
    hyphenated = await configure(linter, { dialect: 'american', words: ['Tavrek', 'Quellith'] })
    expect(await flagged("Tavrek and Quellith met. Tavrek’s boat, Quellith's oar.")).toEqual([])
  })

  it('forgets the words it was given before', async () => {
    hyphenated = await configure(linter, { dialect: 'american', words: ['Tavrek'] })
    hyphenated = await configure(linter, { dialect: 'american', words: [] })
    expect(await flagged('Tavrek met her.')).toEqual(['Tavrek'])
  })

  it('says nothing of a sentence for its length alone', async () => {
    hyphenated = await configure(linter, { dialect: 'american', words: [] })
    const long = Array.from({ length: 8 }, () => 'and the road went on past the farm').join(', ')
    expect(await lintsOf(`The road wound on, ${long}.`)).toEqual([])
  })

  it('leaves style to the writer', async () => {
    hyphenated = await configure(linter, { dialect: 'american', words: [] })
    for (const text of [
      '“Oh shit,” she said. “That bastard took the keys.”',
      'I would argue that she knew, so to speak.',
      'He bought bread, cheese and wine.',
      '“I went thru it, tho,” the kid said. “It’s legit.”',
    ]) {
      expect(await lintsOf(text)).toEqual([])
    }
  })

  it('knows a hyphenated word it is given, and not its parts alone', async () => {
    hyphenated = await configure(linter, { dialect: 'american', words: ['Wi-Fi'] })
    expect(await flagged('The Wi-Fi was down, and the Wi-Fi\u2019s light blinked.')).toEqual([])
    expect(await flagged('Wi is not a word.')).toEqual(['Wi'])
  })

  it('spells in the dialect it is set to', async () => {
    hyphenated = await configure(linter, { dialect: 'british', words: [] })
    expect(await flagged('The colour was grey.')).toEqual([])
    hyphenated = await configure(linter, { dialect: 'american', words: [] })
    expect(await flagged('The colour was grey.')).toEqual(['colour', 'grey'])
  })
})

describe('words', () => {
  it('keeps a word without the possessive it was found with', () => {
    expect(baseWord('Tavrek’s')).toBe('Tavrek')
    expect(baseWord("Tavrek's")).toBe('Tavrek')
    expect(baseWord(' Tavrek ')).toBe('Tavrek')
    expect(baseWord('Moss')).toBe('Moss')
  })

  it('gives Harper each word with its possessive, once', () => {
    expect(harperWords(['Tavrek', 'Tavrek’s', ''])).toEqual(['Tavrek', "Tavrek's"])
  })

  it('keeps hyphenated words from Harper, for the check to know itself', () => {
    expect(harperWords(['Wi-Fi', 'Tavrek'])).toEqual(['Tavrek', "Tavrek's"])
    expect([...hyphenatedIn(['Wi-Fi\u2019s', 'Tavrek', 'half\u2010elf'])]).toEqual([
      'Wi-Fi',
      'half\u2010elf',
    ])
  })

  it('tells a hyphenated word from a word beside a dash', () => {
    expect(isHyphenated('Wi-Fi')).toBe(true)
    expect(isHyphenated('Tavrek')).toBe(false)
    expect(isHyphenated('-ish')).toBe(false)
  })
})

describe('wordAround', () => {
  it('takes in the whole hyphenated word from any part of it', () => {
    const text = 'The Wi-Fi\u2019s light was out.'
    expect(wordAround(text, 4, 6)).toBe('Wi-Fi\u2019s')
    expect(wordAround(text, 7, 9)).toBe('Wi-Fi\u2019s')
  })

  it('stops at a dash, and at a hyphen with nothing after it', () => {
    expect(wordAround('He waited--then left.', 3, 9)).toBe('waited')
    expect(wordAround('A walkd- and a run.', 2, 7)).toBe('walkd')
  })
})

describe('lintHash', () => {
  const PARAGRAPH =
    'It rained all morning on the quay. He go home. The boats stayed in the harbour until dark.'
  const at = PARAGRAPH.indexOf('go')
  const hash = lintHash('Agreement', PARAGRAPH, at, at + 2)

  it('names the same lint in the same words the same', () => {
    expect(lintHash('Agreement', PARAGRAPH, at, at + 2)).toBe(hash)
  })

  it('keeps it through an edit away from the lint', () => {
    const edited = `Once upon a time, far off. ${PARAGRAPH} And so on, to the end.`
    const there = edited.indexOf('go')
    expect(lintHash('Agreement', edited, there, there + 2)).toBe(hash)
  })

  it('names it anew after an edit beside it, or as another kind', () => {
    const edited = PARAGRAPH.replace('He go', 'She go')
    const there = edited.indexOf('go')
    expect(lintHash('Agreement', edited, there, there + 2)).not.toBe(hash)
    expect(lintHash('Grammar', PARAGRAPH, at, at + 2)).not.toBe(hash)
  })
})
