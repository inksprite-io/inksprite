import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import {
  projectOverview,
  executeListDocuments,
  pinnedDocuments,
  executeReadDocument,
  executeSearchDocuments,
  executeUpdateDocument,
  executeAppendDocument,
  executeEditDocument,
} from '@/ai/tools/documents.js'
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
  },
}))

vi.mock('@/stores/syncStore', () => ({
  useSyncStore: () => ({ trackChange: vi.fn(), trackDelete: vi.fn() }),
}))

const STORY = 'story_1'
const context = { storyId: STORY }

describe('document tools, on files', () => {
  /** @type {ReturnType<typeof useDocumentsStore>} */
  let store
  /** @type {import('@/types/models.js').Document} */
  let paper
  /** @type {import('@/types/models.js').Document} */
  let figure

  beforeEach(async () => {
    setActivePinia(createPinia())
    clearDocumentInstances()
    store = useDocumentsStore()
    vi.clearAllMocks()

    // init() builds the root.
    await projectOverview(STORY)
    const papers = store.createDocument({
      storyId: STORY,
      parentId: rootIdFor(STORY),
      type: 'folder',
      title: 'Papers',
    })
    paper = store.createDocument({
      storyId: STORY,
      parentId: papers.id,
      type: 'file',
      title: 'RAG survey',
      content: '[p.1]\nRetrieval helps generation.\n\n[p.2]\nAblations follow.',
      summary: 'A survey.',
      mime: 'application/pdf',
      size: 4096,
      pages: 2,
    })
    figure = store.createDocument({
      storyId: STORY,
      parentId: papers.id,
      type: 'file',
      title: 'Figure 3',
      mime: 'image/png',
      size: 512,
    })
  })

  it('lists a file as what it is', async () => {
    expect(await executeListDocuments({ path: 'Papers' }, context)).toMatch(
      /^Papers\/RAG survey — file, 2 pages, \d+ words/m
    )
  })

  it('reads a file as its text, saying what it is and how long', async () => {
    const result = await executeReadDocument({ path: 'Papers/RAG survey' }, context)

    expect(result).toMatchObject({
      id: paper.id,
      type: 'file',
      mime: 'application/pdf',
      pages: 2,
      content: '[p.1]\nRetrieval helps generation.\n\n[p.2]\nAblations follow.',
    })
    expect(result.note).toBeUndefined()
  })

  it('says when a file had no text to read', async () => {
    const result = await executeReadDocument({ path: 'Papers/Figure 3' }, context)

    expect(result).toMatchObject({ id: figure.id, type: 'file', mime: 'image/png', content: '' })
    expect(result.pages).toBeUndefined()
    expect(result.note).toMatch(/no text/i)
  })

  it('pins a file like any document', async () => {
    expect(
      (await pinnedDocuments(STORY, { pinnedIds: [paper.id] })).map(entry => entry.id)
    ).toEqual([paper.id])
  })

  it('finds text inside a file', async () => {
    const { results } = await executeSearchDocuments({ query: 'ablations' }, context)

    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({ id: paper.id, path: 'Papers/RAG survey' })
    expect(results[0].passages[0].text).toContain('[p.2]')
  })

  it('lets a file’s title change, and leaves its summary to the writer', async () => {
    const result = await executeUpdateDocument(
      { path: 'Papers/RAG survey', updates: { title: 'Survey', summary: 'Better.' } },
      context
    )

    expect(result.success).toBe(true)
    expect(store.getDocument(paper.id)).toMatchObject({ title: 'Survey', summary: 'A survey.' })
  })

  it('does not rewrite a file’s text', async () => {
    const before = store.getDocument(paper.id).content

    const rewrite = await executeUpdateDocument(
      { path: 'Papers/RAG survey', updates: { content: 'Mine now.' } },
      context
    )
    const edit = await executeEditDocument(
      { path: 'Papers/RAG survey', old: 'Retrieval', new: 'Recall' },
      context
    )
    const append = await executeAppendDocument({ path: 'Papers/RAG survey', text: 'PS' }, context)

    for (const result of [rewrite, edit, append]) {
      expect(result.error).toMatch(/is a file/)
      expect(result.error).toMatch(/document of its own/)
    }
    expect(store.getDocument(paper.id).content).toBe(before)
  })
})
