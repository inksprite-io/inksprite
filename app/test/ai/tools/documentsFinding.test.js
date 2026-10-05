import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import {
  projectOverview,
  executeListDocuments,
  executeSearchDocuments,
  executeEditDocument,
} from '@/ai/tools/documents.js'
import { useDocumentsStore } from '@/stores/documentsStore'
import { useChatsStore } from '@/stores/chatsStore'
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
  },
}))

vi.mock('@/stores/syncStore', () => ({
  useSyncStore: () => ({ trackChange: vi.fn(), trackDelete: vi.fn() }),
}))

const STORY = 'story_1'

describe('finding things in a project', () => {
  /** @type {ReturnType<typeof useDocumentsStore>} */
  let store

  const text = (title, content, extra = {}) =>
    store.createDocument({
      storyId: STORY,
      parentId: rootIdFor(STORY),
      type: 'text',
      title,
      content,
      ...extra,
    })

  beforeEach(async () => {
    setActivePinia(createPinia())
    clearDocumentInstances()
    store = useDocumentsStore()
    vi.clearAllMocks()
    await projectOverview(STORY)
  })

  describe('the listing', () => {
    it('marks what the writer pinned, and nothing else', async () => {
      const held = text('Design', 'The design.')
      text('Notes', 'Some notes.')
      const chat = useChatsStore().createChat(STORY)
      useChatsStore().updateChat(chat.id, { pinnedIds: [held.id] })

      const listing = await executeListDocuments({}, { storyId: STORY, chatId: chat.id })

      expect(listing).toContain('Design — 2 words, pinned')
      expect(listing).toContain('Notes — 2 words')
      expect(listing).not.toContain('Notes — 2 words, pinned')
    })

    it('marks each document under a pinned folder, not the folder', async () => {
      const folder = store.createDocument({
        storyId: STORY,
        parentId: rootIdFor(STORY),
        type: 'folder',
        title: 'Papers',
      })
      store.createDocument({ storyId: STORY, parentId: folder.id, type: 'text', title: 'One' })
      const chat = useChatsStore().createChat(STORY)
      useChatsStore().updateChat(chat.id, { pinnedIds: [folder.id] })

      const listing = await executeListDocuments({}, { storyId: STORY, chatId: chat.id })

      expect(listing.split('\n')).toContain('Papers/')
      expect(listing).toContain('Papers/One — 0 words, pinned')
    })

    it('marks nothing for a chat with no pins', async () => {
      text('Design', 'The design.')
      expect(await executeListDocuments({}, { storyId: STORY })).not.toContain('pinned')
    })
  })

  describe('search_documents', () => {
    it('looks in titles and text, not in a summary the model never sees', async () => {
      text('Standup', 'Nothing about it here.', { summary: 'Marcus measured the reranker.' })
      text('Reranker plan', 'Nothing about it here either.')

      const { results } = await executeSearchDocuments({ query: 'reranker' }, { storyId: STORY })

      expect(results.map(hit => hit.path)).toEqual(['Reranker plan'])
      expect(results[0]).not.toHaveProperty('inSummary')
    })

    it('says how long each hit is, for deciding whether to read it whole', async () => {
      text('Paper', 'The reranker gains six points over the baseline.')

      const { results } = await executeSearchDocuments({ query: 'reranker' }, { storyId: STORY })

      expect(results[0].words).toBe(8)
    })

    it('gives several passages from a document that says it more than once', async () => {
      text(
        'Paper',
        'The reranker gains six points. ' +
          'A'.repeat(300) +
          ' The reranker costs 38 ms. ' +
          'B'.repeat(300) +
          ' Without the reranker recall is the ceiling. ' +
          'C'.repeat(300) +
          ' The reranker again.'
      )

      const { results } = await executeSearchDocuments({ query: 'reranker' }, { storyId: STORY })

      expect(results[0].matches).toBe(4)
      // Three passages at most, in order.
      expect(results[0].passages).toHaveLength(3)
      expect(results[0].passages[0].text).toContain('six points')
      expect(results[0].passages[1].text).toContain('38 ms')
      expect(results[0].passages[2].text).toContain('ceiling')
    })

    it('leads with the document that says it most', async () => {
      text('Once', 'The budget is 150 ms.')
      text('Often', 'Budget here. Budget there. Budget everywhere.')

      const { results } = await executeSearchDocuments({ query: 'budget' }, { storyId: STORY })

      expect(results.map(result => result.path)).toEqual(['Often', 'Once'])
    })

    it('caps the list and says how many more there were', async () => {
      for (let n = 0; n < 25; n++) text(`Note ${n}`, 'The same word in every one.')

      const result = await executeSearchDocuments({ query: 'same word' }, { storyId: STORY })

      expect(result.results).toHaveLength(20)
      expect(result.more).toBe(5)
      expect(result.note).toMatch(/more specific/)
    })

    it('falls back to every word when no document has the phrase, and says so', async () => {
      text('Standup', '- **Marcus**: 22M reranker over the top 20 measured at 17 ms.')
      text('Paper', 'The reranker costs 38 ms. Nobody measured anything.')
      text('Other', 'Marcus went home.')

      const result = await executeSearchDocuments(
        { query: 'Marcus reranker measured' },
        { storyId: STORY }
      )

      expect(result.matchedBy).toBe('words')
      expect(result.note).toMatch(/every word/)
      expect(result.results.map(hit => hit.path)).toEqual(['Standup'])
      expect(result.results[0].passages[0].text).toContain('17 ms')
    })

    it('keeps to the phrase when a document has it as written', async () => {
      text('Exact', 'The reranker measured well.')
      text('Words', 'Measured once. The reranker twice.')

      const result = await executeSearchDocuments(
        { query: 'reranker measured' },
        { storyId: STORY }
      )

      expect(result.matchedBy).toBeUndefined()
      expect(result.results.map(hit => hit.path)).toEqual(['Exact'])
    })

    it('does not fall back for a single word', async () => {
      text('Note', 'Nothing here.')

      const result = await executeSearchDocuments({ query: 'reranker' }, { storyId: STORY })

      expect(result.results).toEqual([])
      expect(result.matchedBy).toBeUndefined()
    })

    it('collapses the whitespace inside a passage', async () => {
      text('Table', 'A row\n\n| cell |   with   | gaps |\n\nafter.')

      const { results } = await executeSearchDocuments({ query: 'gaps' }, { storyId: STORY })

      expect(results[0].passages[0].text).toBe('A row | cell | with | gaps | after.')
    })
  })

  describe('edit_document', () => {
    it('treats a passage that is only in the summary as not found', async () => {
      text('Design', 'The body.', { summary: 'The design being written: goals and ranking.' })

      const result = await executeEditDocument(
        { path: 'Design', old: 'The design being written: goals and ranking.', new: 'Changed.' },
        { storyId: STORY }
      )

      expect(result.error).toMatch(/was not found/)
      expect(result.error).not.toMatch(/summary/)
    })

    it('still reports a plain misquote as one', async () => {
      text('Design', 'The body.', { summary: 'A summary.' })

      const result = await executeEditDocument(
        { path: 'Design', old: 'Not there at all.', new: 'x' },
        { storyId: STORY }
      )

      expect(result.error).toMatch(/not found/)
      expect(result.nearest).toBeDefined()
    })
  })
})
