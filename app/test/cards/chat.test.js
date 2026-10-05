import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { cardsNamed, isCard, readCardChat } from '@/cards/chat.js'
import { writeCard } from '@/cards/write.js'
import { readCard } from '@/cards/card.js'
import { useDocumentsStore } from '@/stores/documentsStore'
import { clearDocumentInstances, useDocuments } from '@/composables/useDocuments'

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
  },
}))
vi.mock('@/stores/syncStore', () => ({
  useSyncStore: () => ({ trackChange: vi.fn(), trackDelete: vi.fn() }),
}))

const STORY = 'story_1'

describe('cards/chat', () => {
  /** @type {ReturnType<typeof useDocumentsStore>} */
  let store

  beforeEach(() => {
    setActivePinia(createPinia())
    clearDocumentInstances()
    store = useDocumentsStore()
    vi.clearAllMocks()
  })

  const imported = (data = {}, options = {}) =>
    writeCard(
      STORY,
      readCard({
        spec: 'chara_card_v2',
        data: {
          name: 'Elara',
          description: 'A knight.',
          personality: 'Blunt.',
          first_mes: 'Well?',
          ...data,
        },
      }),
      options
    )

  describe('isCard', () => {
    it('knows a folder an import wrote', async () => {
      const written = await imported()

      expect(isCard(store.getDocument(written.folderId))).toBe(true)
    })

    it('says no to an ordinary folder or a document', async () => {
      await imported()
      const description = [...store.documents.values()].find(d => d.kind === 'description')

      expect(isCard(description)).toBe(false)
      expect(isCard({ type: 'folder' })).toBe(false)
      expect(isCard(null)).toBe(false)
    })
  })

  describe('readCardChat', () => {
    it('finds what a chat needs without being told anything', async () => {
      // Import and "Chat with…" are different moments: by the time this runs,
      // the file is gone. Everything comes back off the documents.
      const written = await imported({ post_history_instructions: 'Never write for them.' })

      const card = await readCardChat(STORY, written.folderId)

      expect(card).toMatchObject({ title: 'Elara', rules: 'Never write for them.' })
      expect(card.greetings.map(g => g.content)).toEqual(['Well?'])
    })

    it('pins the same documents the import did', async () => {
      const written = await imported({
        mes_example: 'Elara: Well?',
        character_book: {
          entries: [
            { comment: 'Always', content: 'Known.', constant: true },
            { comment: 'Sometimes', content: 'Looked up.' },
          ],
        },
      })

      const card = await readCardChat(STORY, written.folderId)

      expect(card.pinnedIds.sort()).toEqual([...written.pinnedIds].sort())
    })

    it('still finds everything after the writer has rearranged it', async () => {
      // The titles are theirs. `kind` is what this reads, so renaming a
      // document and moving it into a subfolder changes nothing.
      const written = await imported()
      const api = useDocuments(STORY)
      const description = [...store.documents.values()].find(d => d.kind === 'description')
      const nested = store.createDocument({
        storyId: STORY,
        parentId: written.folderId,
        type: 'folder',
        title: 'Notes',
      })
      api.rename(description.id, 'Who she is')
      store.updateDocument(description.id, { parentId: nested.id })

      const card = await readCardChat(STORY, written.folderId)

      expect(card.pinnedIds).toContain(description.id)
    })

    it('keeps the greetings in the order the card had them', async () => {
      const written = await imported({ alternate_greetings: ['Second.', 'Third.'] })

      const card = await readCardChat(STORY, written.folderId)

      // By order, not by title: `Greeting 2` is a name the writer may change.
      expect(card.greetings.map(g => g.content)).toEqual(['Well?', 'Second.', 'Third.'])
    })

    it('reads the hidden documents, which is what they were hidden for', async () => {
      // The rules and the system prompt reach the model by their own routes,
      // and are hidden so they do not arrive twice. This is that route.
      const written = await imported(
        { system_prompt: 'You are Elara.', post_history_instructions: 'Stay in it.' },
        { useSystemPrompt: true }
      )

      const card = await readCardChat(STORY, written.folderId)

      expect(card.systemPrompt).toBe('You are Elara.')
      expect(card.rules).toBe('Stay in it.')
    })

    it('leaves the system prompt out when the writer declined it', async () => {
      const written = await imported({ system_prompt: 'You are Elara.' })

      expect((await readCardChat(STORY, written.folderId)).systemPrompt).toBe('')
    })

    it('is nothing for a folder that did not come from a card', async () => {
      const folder = store.createDocument({
        storyId: STORY,
        parentId: 'root_story_1',
        type: 'folder',
        title: 'Chapters',
      })

      expect(await readCardChat(STORY, folder.id)).toBeNull()
      expect(await readCardChat(STORY, 'nothing_here')).toBeNull()
    })
  })

  describe('cardsNamed', () => {
    it('finds the card for a character, however the name was typed', async () => {
      const written = await imported()

      expect((await cardsNamed(STORY, ' elara ')).map(card => card.id)).toEqual([written.folderId])
    })

    it("goes by the character's name rather than the folder's", async () => {
      // A scenario card: known by one name where people browse for it, and
      // answering under another.
      const written = await imported({ nickname: 'The Siege of Varn' })

      expect(store.getDocument(written.folderId).title).toBe('The Siege of Varn')
      expect((await cardsNamed(STORY, 'Elara')).map(card => card.id)).toEqual([written.folderId])
      expect(await cardsNamed(STORY, 'The Siege of Varn')).toEqual([])
    })

    it('still finds a card the writer has renamed', async () => {
      const written = await imported()
      store.updateDocument(written.folderId, { title: 'Knight, first draft' })

      expect(await cardsNamed(STORY, 'Elara')).toHaveLength(1)
    })

    it('goes by the title when the sidecar is gone or no longer JSON', async () => {
      const written = await imported()
      const sidecar = [...store.documents.values()].find(d => d.kind === 'sidecar')
      store.updateDocument(sidecar.id, { content: '{ "data": ' })

      expect((await cardsNamed(STORY, 'Elara')).map(card => card.id)).toEqual([written.folderId])
    })

    it('finds a card the writer has filed away in a folder', async () => {
      const cast = store.createDocument({
        storyId: STORY,
        parentId: 'root_story_1',
        type: 'folder',
        title: 'Cast',
      })
      await imported({}, { parentId: cast.id })

      expect(await cardsNamed(STORY, 'Elara')).toHaveLength(1)
    })

    it('hands back both when two cards are one character', async () => {
      await imported()
      await imported({ description: 'A knight, revised.' })

      expect(await cardsNamed(STORY, 'Elara')).toHaveLength(2)
    })

    it('finds nothing for a stranger, or for no name at all', async () => {
      await imported()

      expect(await cardsNamed(STORY, 'Seraphina')).toEqual([])
      expect(await cardsNamed(STORY, '  ')).toEqual([])
    })
  })
})
