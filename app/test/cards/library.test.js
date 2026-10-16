/* global Blob, File, structuredClone */
import { describe, it, expect } from 'vitest'
import {
  cardDownload,
  cardMatches,
  isNsfw,
  commonTags,
  describeAdded,
  describeCard,
  parseSearch,
  plainText,
  readCardFile,
  sortCards,
  suggestTags,
  tagKey,
  tagLabel,
} from '@/cards/library.js'
import { cardJsonFile, cardPngFile } from './pngFixture.js'

const V2 = {
  spec: 'chara_card_v2',
  data: {
    name: 'Maren',
    nickname: 'The Ferrywoman',
    description: '{{char}} rows travellers across the estuary.',
    first_mes: 'The boat rocks as you step in.',
    alternate_greetings: ['Fog again.'],
    creator: 'someone',
    tags: ['Fantasy', 'female', 'Fantasy'],
    creator_notes: '<p>A quiet <b>ferry</b> keeper.</p><img src="x.png">Plays slow.',
    system_prompt: 'Write as {{char}}.',
    character_book: { entries: [{ keys: ['tide'], content: 'The tide turns at dusk.' }] },
  },
}

/** A library row with only what a test cares about. */
const row = (title, fields = {}) => ({
  id: title,
  name: title,
  title,
  creator: '',
  tags: [],
  notes: '',
  greetings: 1,
  lore: 0,
  systemPrompt: false,
  hash: title,
  added: 0,
  ...fields,
})

describe('cards/library', () => {
  describe('readCardFile', () => {
    it('reads a card out of a PNG, keeping the PNG', async () => {
      const read = await readCardFile(cardPngFile('maren.png', V2))
      expect(read?.card.data.name).toBe('Maren')
      expect(read?.image?.type).toBe('image/png')
    })

    it('reads a card from JSON, with no picture', async () => {
      const read = await readCardFile(cardJsonFile('maren.json', V2))
      expect(read?.card.data.name).toBe('Maren')
      expect(read?.image).toBeNull()
    })

    it('finds nothing in a lorebook, a PNG with no card, or anything else', async () => {
      const book = cardJsonFile('book.json', { entries: { 0: { key: ['x'], content: 'y' } } })
      expect(await readCardFile(book)).toBeNull()
      expect(
        await readCardFile(new File([new Uint8Array([1, 2, 3])], 'art.png', { type: 'image/png' }))
      ).toBeNull()
      expect(await readCardFile(new File(['{oops'], 'broken.json'))).toBeNull()
      expect(await readCardFile(new File(['hello'], 'notes.txt'))).toBeNull()
    })
  })

  describe('describeCard', () => {
    it('describes a card by what the library shows and searches', () => {
      const described = describeCard(V2)
      expect(described).toMatchObject({
        name: 'Maren',
        title: 'The Ferrywoman',
        creator: 'someone',
        tags: ['Fantasy', 'female'],
        greetings: 2,
        lore: 1,
        systemPrompt: true,
      })
      expect(described.notes).toBe('A quiet ferry keeper.\nPlays slow.')
    })

    it("falls back on the description, with the character's name in it", () => {
      const card = { ...V2, data: { ...V2.data, creator_notes: '' } }
      expect(describeCard(card).notes).toBe('Maren rows travellers across the estuary.')
    })

    it('fingerprints the card, the same for the same card', () => {
      expect(describeCard(V2).hash).toBe(describeCard(structuredClone(V2)).hash)
      const other = { ...V2, data: { ...V2.data, name: 'Other' } }
      expect(describeCard(other).hash).not.toBe(describeCard(V2).hash)
    })

    it('cuts long notes at a word', () => {
      const card = { ...V2, data: { ...V2.data, creator_notes: 'word '.repeat(300) } }
      const { notes } = describeCard(card)
      expect(notes.length).toBeLessThanOrEqual(601)
      expect(notes.endsWith('word…')).toBe(true)
    })
  })

  describe('plainText', () => {
    it('keeps what a page says and drops how it looks', () => {
      expect(
        plainText(
          '<style>p{color:red}</style><p>One &amp; two</p>Three<br>![art](a.png) [see](http://x)'
        )
      ).toBe('One & two\nThree\nsee')
    })

    it('is empty for nothing', () => {
      expect(plainText('')).toBe('')
    })
  })

  describe('cardMatches', () => {
    const card = row('Maren', { creator: 'someone', tags: ['Fantasy', 'Female'] })

    it('matches every word of the search, anywhere in the names, creator or tags', () => {
      expect(cardMatches(card, '', [])).toBe(true)
      expect(cardMatches(card, 'mar fant', [])).toBe(true)
      expect(cardMatches(card, 'SOMEONE', [])).toBe(true)
      expect(cardMatches(card, 'mar sci-fi', [])).toBe(false)
    })

    it('needs every tag chosen, in any case', () => {
      expect(cardMatches(card, '', ['fantasy'])).toBe(true)
      expect(cardMatches(card, '', ['fantasy', 'female'])).toBe(true)
      expect(cardMatches(card, '', ['fantasy', 'male'])).toBe(false)
    })
  })

  describe('tags', () => {
    it('are one tag however they are written', () => {
      expect(tagKey('Multiple_Greetings')).toBe('multiple greetings')
      expect(tagKey('multiple  greetings ')).toBe('multiple greetings')
      expect(tagLabel('multiple_greetings')).toBe('multiple greetings')
    })

    it('are named in a search with tag:', () => {
      expect(parseSearch('mar tag:female  Tag:slow_burn')).toEqual({
        words: ['mar'],
        tags: ['female', 'slow_burn'],
      })
      expect(parseSearch('tag:')).toEqual({ words: [], tags: [] })
    })

    it('filter a search as chosen ones do, written either way', () => {
      const card = row('Maren', { tags: ['slow_burn', 'Female'] })
      expect(cardMatches(card, 'tag:slow burn')).toBe(false)
      expect(cardMatches(card, 'tag:Slow_Burn tag:female')).toBe(true)
      expect(cardMatches(card, '', ['slow burn'])).toBe(true)
      expect(cardMatches(card, 'tag:male')).toBe(false)
      expect(cardMatches(card, 'slow burn')).toBe(true)
    })

    it('are offered for a word being typed: those it starts first, the most used first', () => {
      const cards = [
        row('a', { tags: ['female', 'femboy', 'fantasy'] }),
        row('b', { tags: ['female', 'older_female'] }),
        row('c', { tags: ['Female'] }),
      ]
      expect(suggestTags(cards, 'fem', [], 5)).toEqual([
        { tag: 'female', count: 3 },
        { tag: 'femboy', count: 1 },
        { tag: 'older_female', count: 1 },
      ])
      expect(suggestTags(cards, 'fem', ['Female'], 5).map(entry => entry.tag)).toEqual([
        'femboy',
        'older_female',
      ])
      expect(suggestTags(cards, 'older fe', [], 5).map(entry => entry.tag)).toEqual([
        'older_female',
      ])
    })
  })

  describe('sortCards', () => {
    const cards = [
      row('Bram', { added: 1, used: 5 }),
      row('alder', { added: 3 }),
      row('Cass', { added: 2, used: 9 }),
    ]
    const titles = list => list.map(card => card.title)

    it('puts the newest first', () => {
      expect(titles(sortCards(cards, 'added'))).toEqual(['alder', 'Cass', 'Bram'])
    })

    it('sorts by name, whatever the case', () => {
      expect(titles(sortCards(cards, 'name'))).toEqual(['alder', 'Bram', 'Cass'])
    })

    it('puts the most recently used first, and the never used after', () => {
      expect(titles(sortCards(cards, 'used'))).toEqual(['Cass', 'Bram', 'alder'])
    })
  })

  describe('commonTags', () => {
    it('lists the most used tags first, one per spelling', () => {
      const cards = [
        row('a', { tags: ['Fantasy', 'Female'] }),
        row('b', { tags: ['fantasy', 'Horror'] }),
        row('c', { tags: ['FANTASY', 'female'] }),
      ]
      expect(commonTags(cards, 10)).toEqual(['Fantasy', 'Female', 'Horror'])
      expect(commonTags(cards, 1)).toEqual(['Fantasy'])
    })
  })

  describe('describeAdded', () => {
    it('names one card, and counts several', () => {
      expect(describeAdded({ added: [row('Maren')], duplicates: [], skipped: [] })).toBe(
        'Added Maren.'
      )
      expect(
        describeAdded({
          added: [row('a'), row('b')],
          duplicates: [row('c'), row('d')],
          skipped: ['x.png', 'y.png'],
        })
      ).toBe(
        'Added 2 cards. 2 cards are already in the library. 2 files have no character card in them.'
      )
    })

    it('says which card was already there, and which file had none', () => {
      expect(describeAdded({ added: [], duplicates: [row('Maren')], skipped: ['x.png'] })).toBe(
        'Maren is already in the library. x.png has no character card in it.'
      )
    })
  })

  describe('isNsfw', () => {
    it('knows a card tagged NSFW or NSFL, written any way', () => {
      expect(isNsfw(row('a', { tags: ['NSFW'] }))).toBe(true)
      expect(isNsfw(row('b', { tags: ['fantasy', 'nsfw'] }))).toBe(true)
      expect(isNsfw(row('c', { tags: ['Nsfl'] }))).toBe(true)
      expect(isNsfw(row('d', { tags: ['sfw', 'nsfw_lite'] }))).toBe(false)
      expect(isNsfw(row('e'))).toBe(false)
    })
  })

  describe('cardDownload', () => {
    it('hands back the PNG a card came in, named for its title', () => {
      const image = new Blob(['png'], { type: 'image/png' })
      const { blob, filename } = cardDownload(row('The Ferrywoman'), { id: 'x', card: V2, image })
      expect(blob).toBe(image)
      expect(filename).toBe('The Ferrywoman.png')
    })

    it('hands back its JSON when it came without a picture', async () => {
      const { blob, filename } = cardDownload(row('Bram: Night/Watch'), {
        id: 'x',
        card: V2,
        image: null,
      })
      expect(filename).toBe('Bram- Night-Watch.json')
      expect(blob.type).toBe('application/json')
      expect(JSON.parse(await blob.text())).toEqual(V2)
    })
  })
})
