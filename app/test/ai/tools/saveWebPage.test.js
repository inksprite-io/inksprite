/* global File */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { minimalPdf } from '../../files/helpers.js'

const fetchToKeep = vi.hoisted(() => vi.fn())
vi.mock('@/web/keep.js', () => ({ fetchToKeep }))

const desktop = vi.hoisted(() => ({ on: true }))
vi.mock('@/platform/desktop.js', async importOriginal => ({
  .../** @type {any} */ (await importOriginal()),
  isDesktop: () => desktop.on,
}))

vi.mock('@/jobs/index.js', () => ({
  startConversion: vi.fn(async () => ({ id: 'job_1' })),
  currentDigests: () => () => false,
}))

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
    cardFiles: { get: vi.fn(async () => undefined) },
    stories: { toArray: vi.fn(async () => []) },
  },
}))

vi.mock('@/stores/syncStore', () => ({
  useSyncStore: () => ({ trackChange: vi.fn(), trackDelete: vi.fn() }),
}))

const { executeSaveWebPage } = await import('@/ai/tools/web.js')
const { projectOverview } = await import('@/ai/tools/documents.js')
const { useDocumentsStore } = await import('@/stores/documentsStore')
const { clearDocumentInstances } = await import('@/composables/useDocuments')
const { rootIdFor } = await import('@/stores/migrations/projectTree.js')
const { ServiceError } = await import('@/web/answers.js')

const STORY = 'story_1'
const context = { storyId: STORY }
const PDF_URL = 'https://example.org/files/maths-standards.pdf'

/** The standards, as the PDF a site would hand over. */
const standards = () =>
  new File([minimalPdf([['Fractions on a number line']])], 'maths-standards.pdf', {
    type: 'application/pdf',
  })

describe('save_web_page', () => {
  /** @type {ReturnType<typeof useDocumentsStore>} */
  let store

  beforeEach(async () => {
    setActivePinia(createPinia())
    clearDocumentInstances()
    store = useDocumentsStore()
    fetchToKeep.mockReset()
    desktop.on = true

    // init() builds the root.
    await projectOverview(STORY)
    store.createDocument({
      storyId: STORY,
      parentId: rootIdFor(STORY),
      type: 'folder',
      title: 'References',
    })
  })

  /** The document saved at a path, by its title under a folder. */
  const saved = (/** @type {string} */ title) =>
    [...store.documents.values()].find(document => document.title === title)

  it('keeps a PDF as the file, its text read out, in the folder asked for', async () => {
    fetchToKeep.mockResolvedValue({ file: standards() })

    const answer = await executeSaveWebPage({ url: PDF_URL, folder: 'References' }, context)

    expect(answer).toEqual({ saved: true, path: 'References/maths-standards', kept: 'file' })
    const document = saved('maths-standards')
    expect(document).toMatchObject({ type: 'file', mime: 'application/pdf', url: PDF_URL })
    expect(document?.content).toContain('Fractions on a number line')
  })

  it('keeps a page as its text, its address and the day in its first line', async () => {
    fetchToKeep.mockResolvedValue({
      page: { title: 'Counting games', text: 'Count the shells in pairs.' },
      read: false,
    })

    const answer = await executeSaveWebPage({ url: 'https://example.org/games' }, context)

    expect(answer).toEqual({ saved: true, path: 'Counting games', kept: 'text' })
    const document = saved('Counting games')
    expect(document).toMatchObject({ type: 'text', url: 'https://example.org/games' })
    expect(document?.content).toMatch(/^\*From https:\/\/example\.org\/games, saved .+\.\*\n/)
    expect(document?.content).toContain('Count the shells in pairs.')
  })

  it('calls it what it was asked to', async () => {
    fetchToKeep.mockResolvedValue({ file: standards() })

    const answer = await executeSaveWebPage(
      { url: PDF_URL, folder: 'References', title: 'Maths standards, grade 4' },
      context
    )

    expect(answer).toMatchObject({ path: 'References/Maths standards, grade 4' })
  })

  it('says where an address is kept already, and fetches nothing', async () => {
    fetchToKeep.mockResolvedValue({ file: standards() })
    await executeSaveWebPage({ url: PDF_URL, folder: 'References' }, context)
    fetchToKeep.mockClear()

    expect(await executeSaveWebPage({ url: PDF_URL }, context)).toEqual({
      path: 'References/maths-standards',
      note: 'This is in the project already.',
    })
    expect(fetchToKeep).not.toHaveBeenCalled()
  })

  it('refuses a folder that is not there, before fetching anything', async () => {
    const answer = await executeSaveWebPage({ url: PDF_URL, folder: 'Sources' }, context)

    expect(answer).toEqual({ error: expect.stringMatching(/^No folder at "Sources"/) })
    expect(fetchToKeep).not.toHaveBeenCalled()
  })

  it('says a PDF kept in a browser was kept as its text', async () => {
    desktop.on = false
    fetchToKeep.mockResolvedValue({ page: { text: 'Its words.' }, read: true })

    expect(await executeSaveWebPage({ url: PDF_URL }, context)).toMatchObject({
      kept: 'text',
      note: expect.stringMatching(/^Kept as its text/),
    })
  })

  it('passes on why the site refused', async () => {
    fetchToKeep.mockRejectedValue(new ServiceError(`${PDF_URL} would not be read (403).`))

    expect(await executeSaveWebPage({ url: PDF_URL }, context)).toEqual({
      error: `${PDF_URL} would not be read (403).`,
    })
  })

  it('asks for an address it can fetch', async () => {
    expect(await executeSaveWebPage({ url: 'ftp://example.org/a.pdf' }, context)).toEqual({
      error: expect.stringMatching(/http:\/\/ or https:\/\//),
    })
  })
})
