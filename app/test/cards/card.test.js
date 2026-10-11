import { describe, it, expect } from 'vitest'
import {
  shapeOf,
  readCard,
  readLorebook,
  uncomment,
  overOriginal,
  undecorate,
} from '@/cards/card.js'

describe('cards/card', () => {
  describe('shapeOf', () => {
    it('knows a card by its spec', () => {
      expect(shapeOf({ spec: 'chara_card_v2', data: {} })).toBe('card')
      expect(shapeOf({ spec: 'chara_card_v3', data: {} })).toBe('card')
    })

    it('knows a V1 card, which says nothing about itself', () => {
      expect(shapeOf({ name: 'Elara', first_mes: 'Hello.' })).toBe('card')
    })

    it('knows a lorebook by having entries and no character', () => {
      // Both arrive as .json, so the extension says nothing and the contents
      // say everything.
      expect(shapeOf({ name: 'A World', entries: {} })).toBe('lorebook')
      expect(shapeOf({ entries: [] })).toBe('lorebook')
    })

    it('says nothing about a file that is neither', () => {
      expect(shapeOf({ hello: 'world' })).toBeNull()
      expect(shapeOf(null)).toBeNull()
      expect(shapeOf('a string')).toBeNull()
    })
  })

  describe('readCard', () => {
    it('flattens a V2 card', () => {
      const card = readCard({
        spec: 'chara_card_v2',
        data: {
          name: 'Elara',
          description: 'A knight.',
          personality: 'Blunt.',
          scenario: 'The road north.',
          first_mes: 'Well?',
          mes_example: '<START>\nElara: Well?',
          post_history_instructions: 'Never write for them.',
          tags: ['fantasy'],
          creator: 'someone',
        },
      })

      expect(card).toMatchObject({
        name: 'Elara',
        title: 'Elara',
        description: 'A knight.',
        personality: 'Blunt.',
        scenario: 'The road north.',
        examples: '<START>\nElara: Well?',
        greetings: ['Well?'],
        rules: 'Never write for them.',
        tags: ['fantasy'],
        creator: 'someone',
      })
    })

    it('reads a V1 card, which has no wrapper', () => {
      expect(readCard({ name: 'Elara', description: 'A knight.' })).toMatchObject({
        name: 'Elara',
        description: 'A knight.',
      })
    })

    it('takes the nickname as the title and leaves the name alone', () => {
      // What the card is called where people browse is often nothing to do
      // with the character: a scenario card is named for its world and its
      // `name` is whoever narrates it. Import by name and nobody finds it.
      const card = readCard({
        data: { name: 'Narrator', nickname: 'Hero Academy RPG V2' },
      })

      expect(card.title).toBe('Hero Academy RPG V2')
      expect(card.name).toBe('Narrator')
    })

    it('puts the greeting first and the alternates after it', () => {
      const card = readCard({
        data: { first_mes: 'First.', alternate_greetings: ['Second.', 'Third.'] },
      })

      expect(card.greetings).toEqual(['First.', 'Second.', 'Third.'])
    })

    it('leaves out a greeting that is empty', () => {
      const card = readCard({ data: { first_mes: '', alternate_greetings: ['Only this.', '  '] } })

      expect(card.greetings).toEqual(['Only this.'])
    })

    it("reads V3's lorebook and V2's character_book alike", () => {
      const entries = [{ comment: 'Crowns', content: 'The currency.', keys: ['Crowns'] }]

      expect(readCard({ data: { lorebook: { entries } } }).lore).toHaveLength(1)
      expect(readCard({ data: { character_book: { entries } } }).lore).toHaveLength(1)
    })

    it('keeps the card exactly as it arrived', () => {
      // Everything export needs and this app has never heard of — extensions,
      // creator notes, V3 assets — rides in here to the sidecar.
      const raw = { spec: 'chara_card_v3', data: { name: 'Elara' }, extensions: { theirs: 1 } }

      expect(readCard(raw).raw).toBe(raw)
    })

    it('survives a card with nothing in it', () => {
      expect(readCard({}).name).toBe('Unnamed')
      expect(readCard(null).greetings).toEqual([])
    })
  })

  describe('readLorebook', () => {
    const entry = {
      comment: 'Crowns',
      content: 'The currency of the realm.',
      keys: ['Crowns', 'Coin'],
    }

    it("reads the card spec's list of entries", () => {
      const book = readLorebook({ name: 'A World', entries: [entry] })

      expect(book.name).toBe('A World')
      expect(book.entries).toEqual([
        {
          title: 'Crowns',
          content: 'The currency of the realm.',
          keys: ['Crowns', 'Coin'],
          constant: false,
        },
      ])
    })

    it("reads SillyTavern's own export, keyed by index", () => {
      // The same book, serialised the way ST holds it rather than the way the
      // card spec wrote it down.
      const book = readLorebook({
        name: 'A World',
        entries: { 0: { ...entry, key: entry.keys, keys: undefined } },
      })

      expect(book.entries[0]).toMatchObject({ title: 'Crowns', keys: ['Crowns', 'Coin'] })
    })

    it('takes keys from either spelling, without repeating one', () => {
      const book = readLorebook({ entries: [{ ...entry, key: ['Crowns', 'Money'] }] })

      expect(book.entries[0].keys).toEqual(['Crowns', 'Coin', 'Money'])
    })

    it('skips an entry with no content', () => {
      // ST has no headings, so a book with structure is full of separators
      // whose whole job is to draw a line across somebody else's editor.
      const book = readLorebook({
        entries: [{ comment: '═══════[Setting]═══════', content: '' }, entry],
      })

      expect(book.entries).toHaveLength(1)
    })

    it('skips an entry switched off under either name', () => {
      const book = readLorebook({
        entries: [
          { ...entry, enabled: false },
          { ...entry, disable: true },
        ],
      })

      expect(book.entries).toEqual([])
    })

    it('falls back from comment to name to the first key for a title', () => {
      expect(readLorebook({ entries: [{ content: 'x', name: 'By name' }] }).entries[0].title).toBe(
        'By name'
      )
      expect(readLorebook({ entries: [{ content: 'x', keys: ['By key'] }] }).entries[0].title).toBe(
        'By key'
      )
      expect(readLorebook({ entries: [{ content: 'x' }] }).entries[0].title).toBe('Untitled')
    })

    it('marks the entries that are always in context', () => {
      // Not retrieval at all: a statement that this paragraph is always there.
      // Those get pinned at import.
      const book = readLorebook({ entries: [{ ...entry, constant: true }] })

      expect(book.entries[0].constant).toBe(true)
    })

    it('reads nothing out of nothing', () => {
      expect(readLorebook(null).entries).toEqual([])
      expect(readLorebook({}).entries).toEqual([])
    })
  })

  describe('uncomment', () => {
    it('takes out a comment, and the line it had to itself', () => {
      expect(uncomment('{{// for other authors }}\nElara guards the gate.')).toBe(
        'Elara guards the gate.'
      )
      expect(uncomment('One.\n  {{// note }}  \nTwo.')).toBe('One.\nTwo.')
    })

    it('takes out a comment inside a line and leaves the line', () => {
      expect(uncomment('She guards Ostmark{{// or wherever}}.')).toBe('She guards Ostmark.')
    })

    it('takes out one that runs over several lines', () => {
      expect(uncomment('A.\n{{// one\ntwo\nthree }}\nB.')).toBe('A.\nB.')
    })

    it('leaves every other macro alone', () => {
      expect(uncomment('{{date}} and {{char}}')).toBe('{{date}} and {{char}}')
      expect(uncomment('')).toBe('')
    })
  })

  describe('overOriginal', () => {
    it('puts what it overrides where it says {{original}}', () => {
      expect(overOriginal('{{original}}\nThoughts in italics.', 'Never speak for them.')).toBe(
        'Never speak for them.\nThoughts in italics.'
      )
      expect(overOriginal('Before.\n\n{{ Original }}', 'Defaults.')).toBe('Before.\n\nDefaults.')
    })

    it('replaces it when it does not say {{original}}', () => {
      // A card whose author wrote a whole set is not read beside a second set
      // that argues with it.
      expect(overOriginal('Three paragraphs.', 'A paragraph or two.')).toBe('Three paragraphs.')
    })

    it('leaves what it overrides when it says nothing', () => {
      expect(overOriginal('', 'Defaults.')).toBe('Defaults.')
      expect(overOriginal('   ', 'Defaults.')).toBe('Defaults.')
    })

    it('leaves no gap where there was nothing to put', () => {
      expect(overOriginal('{{original}}\n\nItalics.', '')).toBe('Italics.')
      expect(overOriginal('A.\n\n{{original}}\n\nB.')).toBe('A.\n\nB.')
    })
  })

  describe('undecorate', () => {
    it('takes the box-drawing off a title', () => {
      expect(undecorate('═══════[World]═══════')).toBe('World')
      expect(undecorate('[☰] The Realm [☰]')).toBe('The Realm')
      expect(undecorate('[📆]────↓Festivals↓────[📆]')).toBe('Festivals')
      expect(undecorate('[›] [🎭] Duelist')).toBe('Duelist')
    })

    it('leaves an ordinary title alone', () => {
      expect(undecorate('Elara')).toBe('Elara')
      expect(undecorate('Chapter 1')).toBe('Chapter 1')
    })

    it('keeps punctuation that is part of the title', () => {
      expect(undecorate("The Baron's Daughter")).toBe("The Baron's Daughter")
      expect(undecorate('Who goes there?')).toBe('Who goes there?')
    })

    it('keeps a quotation mark that opens a title', () => {
      // Taking it off leaves the closing one behind looking like a mistake.
      expect(undecorate('"Bent Nail" Tobin\'s Forge')).toBe('"Bent Nail" Tobin\'s Forge')
    })

    it('keeps a title that is nothing but decoration', () => {
      // Better a strange name than a document with none.
      expect(undecorate('═══════')).toBe('═══════')
    })
  })
})
