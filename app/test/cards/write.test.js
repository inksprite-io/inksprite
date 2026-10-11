/* global Blob */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { reimportCard, writeCard, writeLorebook, SIDECAR_TITLE } from '@/cards/write.js'
import { readCard, readLorebook } from '@/cards/card.js'
import { useDocumentsStore } from '@/stores/documentsStore'
import { clearDocumentInstances } from '@/composables/useDocuments'
import { rootIdFor } from '@/stores/migrations/projectTree.js'

vi.mock('@/stores/db', () => ({
  default: {
    documents: {
      where: vi.fn(() => ({ equals: vi.fn(() => ({ toArray: vi.fn(async () => []) })) })),
      filter: vi.fn(() => ({ toArray: vi.fn(async () => []) })),
      bulkDelete: vi.fn(),
      bulkGet: vi.fn(async () => []),
      get: vi.fn(async () => undefined),
    },
    stories: { toArray: vi.fn(async () => []) },
    files: { put: vi.fn(async () => undefined), get: vi.fn(async () => undefined) },
  },
}))
import db from '@/stores/db'

vi.mock('@/stores/syncStore', () => ({
  useSyncStore: () => ({ trackChange: vi.fn(), trackDelete: vi.fn() }),
}))

const STORY = 'story_1'

describe('cards/write', () => {
  /** @type {ReturnType<typeof useDocumentsStore>} */
  let store

  beforeEach(() => {
    setActivePinia(createPinia())
    clearDocumentInstances()
    store = useDocumentsStore()
    vi.clearAllMocks()
  })

  /** Everything written under a folder, by title. */
  const childrenOf = folderId =>
    [...store.documents.values()]
      .filter(document => document.parentId === folderId && !document.deleted)
      .sort((a, b) => a.order - b.order)

  const titlesUnder = folderId => childrenOf(folderId).map(document => document.title)
  const byTitle = (folderId, title) =>
    childrenOf(folderId).find(document => document.title === title)

  const card = (data = {}) =>
    readCard({
      spec: 'chara_card_v2',
      data: {
        name: 'Elara',
        description: '{{char}} is a knight. {{user}} met her on the road.',
        first_mes: 'Well, {{user}}?',
        ...data,
      },
    })

  describe('writeCard', () => {
    it('writes the card as a folder of documents', async () => {
      const written = await writeCard(STORY, card({ personality: 'Blunt.', scenario: 'The road.' }))

      expect(titlesUnder(written.folderId)).toEqual([
        'Description',
        'Personality',
        'Scenario',
        'Greeting',
        SIDECAR_TITLE,
      ])
      expect(store.getDocument(written.folderId)).toMatchObject({
        type: 'folder',
        kind: 'card',
        title: 'Elara',
      })
    })

    it('writes no document for a field the card left empty', async () => {
      // Most cards have no personality separate from the description, and an
      // empty stub is one more line in the listing to read past.
      const written = await writeCard(STORY, card())

      expect(titlesUnder(written.folderId)).not.toContain('Personality')
      expect(titlesUnder(written.folderId)).not.toContain('Scenario')
    })

    it('marks each document with what it is, so a rename cannot lose it', async () => {
      const written = await writeCard(STORY, card({ mes_example: 'Elara: Well?' }))

      expect(byTitle(written.folderId, 'Description').kind).toBe('description')
      expect(byTitle(written.folderId, 'Example Dialogue').kind).toBe('examples')
      expect(byTitle(written.folderId, 'Greeting').kind).toBe('greeting')
    })

    it('keeps the macros, for a chat on the card to fill in', async () => {
      const written = await writeCard(STORY, card())

      expect(byTitle(written.folderId, 'Description').content).toBe(
        '{{char}} is a knight. {{user}} met her on the road.'
      )
      expect(byTitle(written.folderId, 'Greeting').content).toBe('Well, {{user}}?')
    })

    it('writes plain documents, stored as the card has them', async () => {
      const written = await writeCard(
        STORY,
        card({
          description: '*{{char}}* is a knight_errant [sworn].',
          character_book: {
            entries: [{ comment: "{{char}}'s Oath", content: '**Never** yield.' }],
          },
        })
      )

      const description = byTitle(written.folderId, 'Description')
      expect(description).toMatchObject({ plain: true })
      expect(description.content).toBe('*{{char}}* is a knight_errant [sworn].')
      expect(byTitle(written.folderId, 'Greeting').plain).toBe(true)
      const entry = byTitle(byTitle(written.folderId, 'Lore').id, "{{char}}'s Oath")
      expect(entry).toMatchObject({ plain: true, content: '**Never** yield.' })
    })

    it('leaves out what the author wrote for other people, and nothing else', async () => {
      const written = await writeCard(
        STORY,
        card({
          description:
            '{{// Swap the town for your own. }}\n{{char}} guards Ostmark{{// or wherever }}.\nToday is {{date}}.',
        })
      )

      // A comment is never sent in ST. The other macros say what they are for,
      // and a date frozen at import would be wrong by tomorrow.
      expect(byTitle(written.folderId, 'Description').content).toBe(
        '{{char}} guards Ostmark.\nToday is {{date}}.'
      )
    })

    it("keeps the card's post-history instructions as its author's note, hidden", async () => {
      const written = await writeCard(
        STORY,
        card({ post_history_instructions: '{{original}}\nThoughts in italics.' })
      )

      const note = byTitle(written.folderId, "Author's Note")
      expect(note).toMatchObject({ kind: 'rules', hidden: true })
      // Resolved when a chat starts, not here.
      expect(note.content).toContain('{{original}}')
      expect(written.pinnedIds).not.toContain(note.id)
    })

    it('numbers the alternate greetings and keeps the first first', async () => {
      const written = await writeCard(STORY, card({ alternate_greetings: ['Second.', 'Third.'] }))

      expect(titlesUnder(written.folderId)).toContain('Greeting 2')
      expect(byTitle(written.folderId, 'Greeting 2').content).toBe('Second.')
      expect(written.greetingIds).toHaveLength(3)
      expect(byTitle(written.folderId, 'Greeting').id).toBe(written.greetingIds[0])
    })

    it('pins what has to be in context from the first turn', async () => {
      const written = await writeCard(
        STORY,
        card({ personality: 'Blunt.', mes_example: 'Elara: Well?' })
      )

      // Not the greeting: it is seeded as the opening message, and in context
      // as well would be the same words twice.
      expect(written.pinnedIds).toEqual([
        byTitle(written.folderId, 'Description').id,
        byTitle(written.folderId, 'Personality').id,
        byTitle(written.folderId, 'Example Dialogue').id,
      ])
    })

    it('keeps the card as it arrived, hidden and stored as written', async () => {
      const raw = { spec: 'chara_card_v2', data: { name: 'Elara' }, extensions: { theirs: 1 } }
      const written = await writeCard(STORY, readCard(raw))
      const sidecar = byTitle(written.folderId, SIDECAR_TITLE)

      expect(sidecar).toMatchObject({ kind: 'sidecar', hidden: true, plain: true })
      expect(JSON.parse(sidecar.content)).toEqual(raw)
    })

    it('lands where it was told to', async () => {
      const folder = store.createDocument({
        storyId: STORY,
        parentId: rootIdFor(STORY),
        type: 'folder',
        title: 'Characters',
      })

      const written = await writeCard(STORY, card(), { parentId: folder.id })

      expect(store.getDocument(written.folderId).parentId).toBe(folder.id)
    })

    it('does not make two folders of one name', async () => {
      // Importing the same card twice is a thing people do, and two folders
      // with one name is a tree nobody can read.
      const first = await writeCard(STORY, card())
      const second = await writeCard(STORY, card())

      expect(store.getDocument(first.folderId).title).toBe('Elara')
      expect(store.getDocument(second.folderId).title).toBe('Elara (2)')
    })

    it('takes the folder name from the nickname', async () => {
      const written = await writeCard(
        STORY,
        readCard({
          data: {
            name: 'Narrator',
            nickname: 'Hero Academy RPG',
            description: '{{char}} speaks.',
          },
        })
      )

      expect(store.getDocument(written.folderId).title).toBe('Hero Academy RPG')
    })
  })

  describe("a card's lorebook", () => {
    const withLore = (...entries) =>
      card({ character_book: { entries: entries.map(e => ({ content: 'x', ...e })) } })

    it('goes under a Lore folder of its own', async () => {
      const written = await writeCard(STORY, withLore({ comment: 'Crowns', content: 'The coin.' }))
      const lore = byTitle(written.folderId, 'Lore')

      // The character's own documents and the world's background are two
      // different things to look at.
      expect(lore.kind).toBe('lore')
      expect(titlesUnder(lore.id)).toEqual(['Crowns'])
    })

    it('puts the keys on the first line of the body, not in the summary', async () => {
      const written = await writeCard(
        STORY,
        withLore({ comment: 'Crowns', content: 'The coin.', keys: ['Crowns', 'Currency'] })
      )
      const entry = byTitle(byTitle(written.folderId, 'Lore').id, 'Crowns')

      // The summary rides in the project block on every turn; a body is read
      // once, by a turn that wanted it. Search matches content either way.
      expect(entry.content).toBe('Crowns, Currency\n\nThe coin.')
      expect(entry.summary).toBe('')
    })

    it('numbers an entry of a name another already has', async () => {
      const written = await writeCard(
        STORY,
        withLore({ comment: 'Crowns' }, { comment: 'crowns' }, { comment: 'Crowns' })
      )

      expect(titlesUnder(byTitle(written.folderId, 'Lore').id)).toEqual([
        'Crowns',
        'crowns (2)',
        'Crowns (3)',
      ])
    })

    it('takes the decoration off an entry title', async () => {
      const written = await writeCard(STORY, withLore({ comment: '[☰] The Realm [☰]' }))

      expect(titlesUnder(byTitle(written.folderId, 'Lore').id)).toEqual(['The Realm'])
    })

    it('pins the entries that say they are always in context', async () => {
      const written = await writeCard(
        STORY,
        withLore({ comment: 'Always', constant: true }, { comment: 'Sometimes' })
      )
      const lore = byTitle(written.folderId, 'Lore')

      expect(written.pinnedIds).toContain(byTitle(lore.id, 'Always').id)
      expect(written.pinnedIds).not.toContain(byTitle(lore.id, 'Sometimes').id)
    })

    it('makes no Lore folder for a card that has no book', async () => {
      const written = await writeCard(STORY, card())

      expect(titlesUnder(written.folderId)).not.toContain('Lore')
    })
  })

  describe('writeLorebook', () => {
    const book = readLorebook({
      name: 'A World',
      entries: {
        0: { comment: 'Crowns', content: 'The coin.', key: ['Crowns'] },
        1: { comment: 'Underworld', content: 'Below.', constant: true },
      },
    })

    it('writes a book that arrived on its own, with no card around it', async () => {
      const written = await writeLorebook(STORY, book)

      expect(store.getDocument(written.folderId)).toMatchObject({ kind: 'lore', title: 'A World' })
      // Straight in, rather than a Lore folder inside a Lore folder.
      expect(titlesUnder(written.folderId)).toEqual(['Crowns', 'Underworld', SIDECAR_TITLE])
    })

    it('pins its constants, the same as a card would', async () => {
      const written = await writeLorebook(STORY, book)

      expect(written.pinnedIds).toEqual([byTitle(written.folderId, 'Underworld').id])
    })

    it("takes a title from the caller over the book's own", async () => {
      const written = await writeLorebook(STORY, book, { title: 'Mine' })

      expect(store.getDocument(written.folderId).title).toBe('Mine')
    })

    it('falls back to a name when the book has none', async () => {
      const written = await writeLorebook(STORY, readLorebook({ entries: [{ content: 'x' }] }))

      expect(store.getDocument(written.folderId).title).toBe('Lore')
    })
  })

  describe('reimportCard', () => {
    it('writes the card again into the same folder, over the edits since', async () => {
      const written = await writeCard(STORY, card())
      const before = childrenOf(written.folderId).map(document => document.id)
      store.updateDocument(byTitle(written.folderId, 'Description').id, { content: 'edited' })

      const again = await reimportCard(STORY, written.folderId, card())

      expect(again.folderId).toBe(written.folderId)
      expect(store.getDocument(written.folderId)).toMatchObject({ title: 'Elara', kind: 'card' })
      expect(byTitle(written.folderId, 'Description').content).toContain('{{user}} met her')
      expect(byTitle(written.folderId, 'Greeting').content).toBe('Well, {{user}}?')
      const now = childrenOf(written.folderId).map(document => document.id)
      for (const id of before) expect(now).not.toContain(id)
      expect(again.documents).toBe(written.documents - 1)
      expect(again.greetingIds).toHaveLength(1)
    })

    it('keeps the portrait the card arrived in', async () => {
      const png = new Blob(['png'], { type: 'image/png' })
      const written = await writeCard(STORY, card(), { portrait: png })
      const portrait = byTitle(written.folderId, 'Portrait')
      db.files.get.mockImplementation(async id =>
        id === portrait.id ? { id, storyId: STORY, blob: png } : undefined
      )

      await reimportCard(STORY, written.folderId, card())

      const kept = byTitle(written.folderId, 'Portrait')
      expect(kept).toBeDefined()
      expect(kept.id).not.toBe(portrait.id)
      expect(db.files.put).toHaveBeenLastCalledWith({ id: kept.id, storyId: STORY, blob: png })
    })

    it('refuses a folder that is not a card', async () => {
      const folder = store.createDocument({
        storyId: STORY,
        parentId: rootIdFor(STORY),
        type: 'folder',
        title: 'Notes',
      })
      await expect(reimportCard(STORY, folder.id, card())).rejects.toThrow('card folder')
    })
  })
})
