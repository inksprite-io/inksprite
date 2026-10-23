/* global Blob */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { reimportCard, writeCard, writeLorebook, SIDECAR_TITLE } from '@/cards/write.js'
import { readCard, readLorebook } from '@/cards/card.js'
import { useDocumentsStore } from '@/stores/documentsStore'
import { useVersionsStore } from '@/stores/versionsStore'
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
      expect(byTitle(written.folderId, 'Example dialogue').kind).toBe('examples')
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

    it("keeps the card's post-history instructions, hidden", async () => {
      const written = await writeCard(
        STORY,
        card({ post_history_instructions: '{{original}}\nThoughts in italics.' })
      )

      const note = byTitle(written.folderId, 'Post-history instructions')
      expect(note).toMatchObject({ kind: 'rules', hidden: true })
      // Resolved on each turn of a chat on the card, not here.
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
        byTitle(written.folderId, 'Example dialogue').id,
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
    it('puts the card back in the documents it was written as, keeping their ids', async () => {
      const written = await writeCard(STORY, card())
      const before = childrenOf(written.folderId).map(document => document.id)
      store.updateDocument(byTitle(written.folderId, 'Description').id, { content: 'edited' })

      const again = await reimportCard(STORY, written.folderId, card())

      expect(again.folderId).toBe(written.folderId)
      expect(store.getDocument(written.folderId)).toMatchObject({ title: 'Elara', kind: 'card' })
      expect(byTitle(written.folderId, 'Description').content).toContain('{{user}} met her')
      expect(byTitle(written.folderId, 'Greeting').content).toBe('Well, {{user}}?')
      expect(childrenOf(written.folderId).map(document => document.id)).toEqual(before)
      // So a chat that pins the card's documents still pins them.
      expect(again.pinnedIds).toEqual(written.pinnedIds)
      expect(again.greetingIds).toEqual(written.greetingIds)
    })

    it('keeps the text it takes back as a version first', async () => {
      const written = await writeCard(STORY, card())
      const description = byTitle(written.folderId, 'Description')
      store.updateDocument(description.id, { content: 'edited' })
      const around = vi.spyOn(useVersionsStore(), 'around')

      await reimportCard(STORY, written.folderId, card())

      expect(around).toHaveBeenCalledTimes(1)
      expect(around).toHaveBeenCalledWith(
        expect.objectContaining({ id: description.id, content: 'edited' }),
        'import',
        expect.any(Function)
      )
    })

    it('puts back a title and a hidden switch the writer changed', async () => {
      const written = await writeCard(STORY, card({ post_history_instructions: 'Stay terse.' }))
      const rules = byTitle(written.folderId, 'Post-history instructions')
      store.updateDocument(rules.id, { title: 'My rules', hidden: false })

      await reimportCard(
        STORY,
        written.folderId,
        card({ post_history_instructions: 'Stay terse.' })
      )

      expect(store.getDocument(rules.id)).toMatchObject({
        title: 'Post-history instructions',
        hidden: true,
      })
    })

    it('matches the greetings in order, and the lore by name, then in order', async () => {
      const lore = {
        character_book: {
          entries: [
            { comment: 'Crowns', content: 'The coin.' },
            { comment: 'Roads', content: 'They wind.' },
          ],
        },
      }
      const written = await writeCard(
        STORY,
        card({ alternate_greetings: ['Second.', 'Third.'], ...lore })
      )
      const book = byTitle(written.folderId, 'Lore')
      const roads = byTitle(book.id, 'Roads')
      store.updateDocument(roads.id, { title: 'Highways', content: 'Mine.' })
      const crowns = byTitle(book.id, 'Crowns')

      await reimportCard(
        STORY,
        written.folderId,
        card({ alternate_greetings: ['Second.'], ...lore })
      )

      expect(store.getDocument(roads.id)).toMatchObject({ title: 'Roads', content: 'They wind.' })
      expect(byTitle(book.id, 'Crowns').id).toBe(crowns.id)
      const greetings = childrenOf(written.folderId).filter(doc => doc.kind === 'greeting')
      expect(greetings.map(doc => doc.id)).toEqual(written.greetingIds.slice(0, 2))
      expect(store.getDocument(written.greetingIds[2])).toBeNull()
    })

    it("lets go of a field the card no longer has, makes one it has now, and leaves the writer's own", async () => {
      const written = await writeCard(STORY, card({ personality: 'Blunt.' }))
      const personality = byTitle(written.folderId, 'Personality')
      const mine = store.createDocument({
        storyId: STORY,
        parentId: written.folderId,
        type: 'text',
        title: 'My notes',
        content: 'Hers to keep.',
      })

      await reimportCard(STORY, written.folderId, card({ scenario: 'The road.' }))

      expect(store.getDocument(personality.id)).toBeNull()
      expect(byTitle(written.folderId, 'Scenario')?.content).toBe('The road.')
      expect(store.getDocument(mine.id)?.content).toBe('Hers to keep.')
    })

    it('puts a field it lets go of in the trash', async () => {
      const written = await writeCard(STORY, card({ personality: 'Blunt.' }))
      const personality = byTitle(written.folderId, 'Personality')

      await reimportCard(STORY, written.folderId, card())

      expect(store.getTrashedDocument(personality.id)?.trashed).toBeTypeOf('number')
    })

    it('keeps the portrait the card arrived in, as it is', async () => {
      const png = new Blob(['png'], { type: 'image/png' })
      const written = await writeCard(STORY, card(), { portrait: png })
      const portrait = byTitle(written.folderId, 'Portrait')
      vi.mocked(db.files.put).mockClear()

      await reimportCard(STORY, written.folderId, card(), { portrait: png })

      expect(byTitle(written.folderId, 'Portrait').id).toBe(portrait.id)
      expect(db.files.put).not.toHaveBeenCalled()
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
