/* global File, AbortController */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useBulkImport, describeImport } from '@/composables/useBulkImport.js'
import { useDocuments, clearDocumentInstances } from '@/composables/useDocuments'
import { useDocumentsStore } from '@/stores/documentsStore'
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
    files: { put: vi.fn(async () => undefined), get: vi.fn(async () => undefined) },
    stories: { toArray: vi.fn(async () => []) },
  },
}))
vi.mock('@/stores/syncStore', () => ({
  useSyncStore: () => ({ trackChange: vi.fn(), trackDelete: vi.fn() }),
}))

const STORY = 'story_1'

const md = (name, text = '# Hello') => new File([text], name, { type: 'text/markdown' })
const csv = name => new File(['a,b'], name, { type: 'text/csv' })

describe('useBulkImport', () => {
  /** @type {ReturnType<typeof useDocuments>} */
  let api
  let store

  beforeEach(() => {
    setActivePinia(createPinia())
    clearDocumentInstances()
    store = useDocumentsStore()
    api = useDocuments(STORY)
  })

  const titlesUnder = id => api.childrenOf(id).map(child => child.title)
  const folderUnder = (id, title) =>
    api.childrenOf(id).find(child => child.type === 'folder' && child.title === title)

  it('writes each file into the folders it came in, making them once', async () => {
    const bulk = useBulkImport(STORY)

    const result = await bulk.importMany([
      { file: md('index.md'), folders: ['research'] },
      { file: csv('a.csv'), folders: ['research', 'papers'] },
      { file: csv('b.csv'), folders: ['research', 'papers'] },
      { file: md('loose.md'), folders: [] },
    ])

    expect(result).toMatchObject({ documents: 4, folders: 2, cards: 0, scans: 0, skipped: [] })
    const root = rootIdFor(STORY)
    expect(titlesUnder(root)).toEqual(['loose', 'research'])
    const research = folderUnder(root, 'research')
    expect(titlesUnder(research.id)).toEqual(['index', 'papers'])
    const papers = folderUnder(research.id, 'papers')
    expect(titlesUnder(papers.id)).toEqual(['a', 'b'])
    expect(store.getDocument(api.childrenOf(papers.id)[0].id)).toMatchObject({ type: 'file' })
  })

  it('uses a folder that is already there rather than making a second', async () => {
    const existing = api.createFolder(rootIdFor(STORY), 'papers')
    const bulk = useBulkImport(STORY)

    const result = await bulk.importMany([{ file: md('a.md'), folders: ['papers'] }])

    expect(result.folders).toBe(0)
    expect(titlesUnder(existing.id)).toEqual(['a'])
    expect(titlesUnder(rootIdFor(STORY))).toEqual(['papers'])
  })

  it('uses a folder there under the name in another case', async () => {
    const existing = api.createFolder(rootIdFor(STORY), 'Papers')
    const bulk = useBulkImport(STORY)

    await bulk.importMany([{ file: md('a.md'), folders: ['papers'] }])

    expect(titlesUnder(existing.id)).toEqual(['a'])
    expect(titlesUnder(rootIdFor(STORY))).toEqual(['Papers'])
  })

  it('makes a folder beside a document of its name as Name (2)', async () => {
    api.createTextDocument(rootIdFor(STORY), 'papers')
    const bulk = useBulkImport(STORY)

    await bulk.importMany([
      { file: md('a.md'), folders: ['papers'] },
      { file: md('b.md'), folders: ['papers'] },
    ])

    const made = folderUnder(rootIdFor(STORY), 'papers (2)')
    expect(titlesUnder(made.id)).toEqual(['a', 'b'])
  })

  it('lands the batch on the folder it was asked for', async () => {
    const into = api.createFolder(rootIdFor(STORY), 'Notes')
    const bulk = useBulkImport(STORY)

    await bulk.importMany([{ file: md('a.md'), folders: ['sub'] }], { parentId: into.id })

    expect(titlesUnder(into.id)).toEqual(['sub'])
    expect(titlesUnder(folderUnder(into.id, 'sub').id)).toEqual(['a'])
  })

  it('skips a file that cannot be read and goes on, saying which', async () => {
    const bulk = useBulkImport(STORY)
    const bad = new File(['not a pdf'], 'broken.pdf', { type: 'application/pdf' })
    const progress = vi.fn()

    const result = await bulk.importMany(
      [
        { file: bad, folders: [] },
        { file: md('fine.md'), folders: [] },
      ],
      { onProgress: progress }
    )

    expect(result.documents).toBe(1)
    expect(result.skipped).toHaveLength(1)
    expect(result.skipped[0].name).toBe('broken.pdf')
    expect(progress).toHaveBeenCalledTimes(2)
    expect(progress).toHaveBeenLastCalledWith(2, 2)
  })

  it('stops by its signal before the next file, keeping what was written', async () => {
    const bulk = useBulkImport(STORY)
    const controller = new AbortController()

    await expect(
      bulk.importMany(
        [
          { file: md('one.md'), folders: [] },
          { file: md('two.md'), folders: [] },
        ],
        { signal: controller.signal, onProgress: () => controller.abort() }
      )
    ).rejects.toMatchObject({ name: 'AbortError' })

    expect(titlesUnder(rootIdFor(STORY))).toEqual(['one'])
  })

  it('writes a card in the batch with the defaults and counts it', async () => {
    const bulk = useBulkImport(STORY)
    const card = new File(
      [
        JSON.stringify({
          spec: 'chara_card_v2',
          data: { name: 'Elara', description: 'A knight.' },
        }),
      ],
      'elara.json',
      { type: 'application/json' }
    )

    const result = await bulk.importMany([{ file: card, folders: [] }])

    expect(result.cards).toBe(1)
    expect(result.documents).toBeGreaterThan(1)
  })
})

describe('describeImport', () => {
  it('says what landed, and what did not', () => {
    expect(describeImport({ documents: 12, folders: 2, cards: 0, scans: 0, skipped: [] })).toEqual({
      severity: 'success',
      summary: 'Imported 12 documents, 2 new folders',
      detail: '',
    })
    expect(
      describeImport({
        documents: 1,
        folders: 0,
        cards: 1,
        scans: 1,
        skipped: [{ name: 'x.pdf', reason: 'bad' }],
      })
    ).toEqual({
      severity: 'warn',
      summary: 'Imported 1 document',
      detail:
        '1 card written with the default name; re-import one to set yours. 1 PDF with no text: a scan. Skipped x.pdf (bad).',
    })
    expect(
      describeImport({ documents: 0, folders: 0, cards: 0, scans: 0, skipped: [] }).severity
    ).toBe('error')
  })

  it('counts the pictures a Doc came with and lost', () => {
    expect(
      describeImport({ documents: 2, folders: 0, cards: 0, scans: 0, images: 3, skipped: [] })
    ).toEqual({
      severity: 'success',
      summary: 'Imported 2 documents',
      detail: '3 images left out.',
    })
  })
})
