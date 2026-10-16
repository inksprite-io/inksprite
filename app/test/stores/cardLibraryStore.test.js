/* global Blob, Response */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useCardLibraryStore } from '@/stores/cardLibraryStore.js'
import { carrying, cardJsonFile, cardPngFile } from '../cards/pngFixture.js'

const fetch = vi.fn()
vi.mock('@/platform/fetch.js', () => ({ fetch: (...args) => fetch(...args) }))
let desktop = false
vi.mock('@/platform/desktop.js', () => ({ isDesktop: () => desktop }))

/** The two tables, as storage holds them. */
const tables = { cards: new Map(), cardFiles: new Map() }

vi.mock('@/storage/index.js', () => ({
  storage: {
    all: vi.fn(async table => [...tables[table].values()]),
    count: vi.fn(async table => tables[table].size),
    get: vi.fn(async (table, id) => tables[table].get(id)),
    put: vi.fn(async (table, row) => {
      tables[table].set(row.id, row)
    }),
    remove: vi.fn(async (table, ids) => {
      for (const id of ids) tables[table].delete(id)
    }),
  },
}))

const trackChange = vi.fn((table, id, row) => tables[table].set(id, row))
const trackDelete = vi.fn((table, id) => tables[table].delete(id))
vi.mock('@/stores/syncStore.js', () => ({
  useSyncStore: () => ({ trackChange, trackDelete }),
}))

const makeThumbnail = vi.fn(async () => new Blob(['small'], { type: 'image/jpeg' }))
vi.mock('@/cards/thumbnail.js', () => ({
  makeThumbnail: (...args) => makeThumbnail(...args),
}))

/** @param {string} name */
const card = name => ({
  spec: 'chara_card_v2',
  data: { name, description: `${name} is here.`, first_mes: 'Hello.', tags: ['test'] },
})

describe('cardLibraryStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    tables.cards.clear()
    tables.cardFiles.clear()
    vi.clearAllMocks()
  })

  it('adds the cards in files, with their PNG and a thumbnail', async () => {
    const store = useCardLibraryStore()
    const result = await store.addFiles([
      cardPngFile('maren.png', card('Maren')),
      cardJsonFile('bram.json', card('Bram')),
    ])

    expect(result.added.map(added => added.title)).toEqual(['Maren', 'Bram'])
    expect(store.allCards).toHaveLength(2)

    const [maren, bram] = result.added
    expect(maren.id).toMatch(/^libcard_/)
    expect(maren.tags).toEqual(['test'])
    expect(tables.cards.get(maren.id)).toEqual(maren)

    const file = tables.cardFiles.get(maren.id)
    expect(file.card.data.name).toBe('Maren')
    expect(file.image.type).toBe('image/png')
    expect(await file.thumbnail.text()).toBe('small')

    // A card that came as JSON has no picture to make one from.
    expect(tables.cardFiles.get(bram.id).image).toBeNull()
    expect(makeThumbnail).toHaveBeenCalledTimes(1)
  })

  it('adds the cards a file of Export carried, under new ids, but those already here', async () => {
    const store = useCardLibraryStore()
    const [maren] = (await store.addFiles([cardPngFile('maren.png', card('Maren'))])).added
    const brought = { ...maren, id: 'libcard_elsewhere_bram', title: 'Bram', hash: 'bram' }
    const image = new Blob(['png'], { type: 'image/png' })

    const result = await store.addRows(
      [{ ...maren, id: 'libcard_elsewhere_maren' }, brought],
      [
        { id: 'libcard_elsewhere_maren', card: card('Maren'), image, thumbnail: null },
        { id: 'libcard_elsewhere_bram', card: card('Bram'), image, thumbnail: null },
      ]
    )

    expect(result.duplicates.map(one => one.id)).toEqual([maren.id])
    expect(result.added.map(one => one.title)).toEqual(['Bram'])
    const [bram] = result.added
    expect(bram.id).toMatch(/^libcard_/)
    expect(bram.id).not.toBe('libcard_elsewhere_bram')
    expect(tables.cards.get(bram.id)).toEqual(bram)
    expect(tables.cardFiles.get(bram.id)).toEqual({
      id: bram.id,
      card: card('Bram'),
      image,
      thumbnail: null,
    })
  })

  it('skips a card already in the library, and a file with no card in it', async () => {
    const store = useCardLibraryStore()
    await store.addFiles([cardPngFile('maren.png', card('Maren'))])
    const result = await store.addFiles([
      cardPngFile('maren copy.png', card('Maren')),
      cardJsonFile('book.json', { entries: { 0: { key: ['x'], content: 'y' } } }),
    ])

    expect(result.added).toEqual([])
    expect(result.duplicates.map(duplicate => duplicate.title)).toEqual(['Maren'])
    expect(result.skipped).toEqual(['book.json'])
    expect(store.allCards).toHaveLength(1)
  })

  it('has cards kept from before once counted, before they are read', async () => {
    tables.cards.set('libcard_old', { id: 'libcard_old', title: 'Old', hash: 'h' })
    const store = useCardLibraryStore()
    expect(store.hasCards).toBe(false)

    await store.countCards()
    expect(store.hasCards).toBe(true)
    expect(store.allCards).toEqual([])

    await store.ensureLoaded()
    expect(store.allCards.map(row => row.title)).toEqual(['Old'])
  })

  it('makes a thumbnail that is missing, and keeps it', async () => {
    const image = new Blob(['big'], { type: 'image/png' })
    tables.cards.set('libcard_1', { id: 'libcard_1', title: 'One', hash: 'h' })
    tables.cardFiles.set('libcard_1', { id: 'libcard_1', card: {}, image, thumbnail: null })
    const store = useCardLibraryStore()
    await store.ensureLoaded()

    const made = await store.thumbnail('libcard_1')
    expect(await made?.text()).toBe('small')
    expect(await tables.cardFiles.get('libcard_1').thumbnail.text()).toBe('small')

    await store.thumbnail('libcard_1')
    expect(makeThumbnail).toHaveBeenCalledTimes(1)
  })

  it('shows the PNG itself where a thumbnail cannot be made', async () => {
    makeThumbnail.mockResolvedValueOnce(null)
    const image = new Blob(['big'], { type: 'image/png' })
    tables.cardFiles.set('libcard_1', { id: 'libcard_1', card: {}, image, thumbnail: null })
    const store = useCardLibraryStore()

    expect(await store.thumbnail('libcard_1')).toBe(image)
  })

  it('remembers the projects a card went into, the newest last', async () => {
    const store = useCardLibraryStore()
    const { added } = await store.addFiles([cardJsonFile('bram.json', card('Bram'))])
    const id = added[0].id
    store.markUsed(id, { storyId: 'story_1', folderId: 'folder_1', made: true })
    store.markUsed(id, { storyId: 'story_2', folderId: 'folder_2' })

    const projects = tables.cards.get(id).projects
    expect(projects.map(use => [use.storyId, use.folderId, Boolean(use.made)])).toEqual([
      ['story_1', 'folder_1', true],
      ['story_2', 'folder_2', false],
    ])
    expect(projects.every(use => use.at > 0)).toBe(true)
  })

  it('notes when a card was last used', async () => {
    const store = useCardLibraryStore()
    const { added } = await store.addFiles([cardJsonFile('bram.json', card('Bram'))])
    store.markUsed(added[0].id)
    expect(store.getCard(added[0].id)?.used).toBeGreaterThan(0)
    expect(tables.cards.get(added[0].id).used).toBeGreaterThan(0)
  })

  it('takes a card out of the library with its files', async () => {
    const store = useCardLibraryStore()
    const { added } = await store.addFiles([cardPngFile('maren.png', card('Maren'))])
    await store.removeCard(added[0].id)

    expect(store.allCards).toEqual([])
    expect(tables.cards.size).toBe(0)
    expect(tables.cardFiles.size).toBe(0)
  })

  describe('addLink', () => {
    /** A response the site might give. */
    const answer = (body, init = {}) => new Response(body, { status: 200, ...init })

    beforeEach(() => {
      fetch.mockReset()
      desktop = false
    })

    it("adds the card a botbooru page's link downloads, whatever the site calls the file", async () => {
      fetch.mockResolvedValue(
        answer(carrying('chara', card('Maren')), {
          headers: { 'content-type': 'application/octet-stream' },
        })
      )
      const store = useCardLibraryStore()
      const result = await store.addLink('https://botbooru.com/character/12345')

      expect(fetch).toHaveBeenCalledWith('https://botbooru.com/download/png/12345')
      expect(result.added.map(added => added.title)).toEqual(['Maren'])
      expect(tables.cardFiles.get(result.added[0].id).image.type).toBe('image/png')
    })

    it('adds a card a link gives as JSON', async () => {
      fetch.mockResolvedValue(answer(JSON.stringify(card('Bram'))))
      const result = await useCardLibraryStore().addLink('https://files.example.com/bram')
      expect(result.added.map(added => added.title)).toEqual(['Bram'])
      expect(tables.cardFiles.get(result.added[0].id).image).toBeNull()
    })

    it('says plainly why a link brought nothing', async () => {
      const store = useCardLibraryStore()
      await expect(store.addLink('just some words')).rejects.toThrow("That isn't a link.")

      fetch.mockResolvedValueOnce(answer('gone', { status: 404 }))
      await expect(store.addLink('https://files.example.com/x.png')).rejects.toThrow(
        'The site answered with an error (404).'
      )

      fetch.mockResolvedValueOnce(answer('<html>a page</html>'))
      await expect(store.addLink('https://files.example.com/page')).rejects.toThrow(
        "That link isn't to a character card."
      )
      expect(store.allCards).toEqual([])
    })

    it('says when a site will not let the page download from it, and what to do', async () => {
      fetch.mockRejectedValue(new TypeError('Load failed'))
      const store = useCardLibraryStore()
      await expect(store.addLink('https://botbooru.com/character/1')).rejects.toThrow(
        'Web imports from botbooru.com only work in the desktop app.'
      )
      await expect(store.addLink('someone/a-card')).rejects.toThrow(
        'Web imports from chub.ai only work in the desktop app.'
      )

      desktop = true
      await expect(store.addLink('https://botbooru.com/character/1')).rejects.toThrow(
        "Couldn't reach botbooru.com."
      )
    })
  })
})
