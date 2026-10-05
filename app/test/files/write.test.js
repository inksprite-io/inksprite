/* global Blob */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { reextractFile, writeFile } from '@/files/write.js'
import { minimalPdf } from './helpers.js'
import { useDocumentsStore } from '@/stores/documentsStore'
import { clearDocumentInstances } from '@/composables/useDocuments'
import { rootIdFor } from '@/stores/migrations/projectTree.js'
import db from '@/stores/db'

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

const inspected = (overrides = {}) => ({
  title: 'paper',
  mime: 'application/pdf',
  size: 1234,
  pages: 3,
  text: '[p.1]\nAbstract',
  blob: new Blob(['%PDF'], { type: 'application/pdf' }),
  ...overrides,
})

describe('writeFile', () => {
  /** @type {ReturnType<typeof useDocumentsStore>} */
  let store

  beforeEach(() => {
    setActivePinia(createPinia())
    clearDocumentInstances()
    vi.clearAllMocks()
    store = useDocumentsStore()
  })

  it('writes a file document with its text as the body', async () => {
    const written = await writeFile(STORY, inspected())

    const made = store.getDocument(written.folderId)
    expect(made).toMatchObject({
      type: 'file',
      title: 'paper',
      parentId: rootIdFor(STORY),
      mime: 'application/pdf',
      size: 1234,
      pages: 3,
      content: '[p.1]\nAbstract',
      plain: true,
    })
    expect(made.wordCount).toBe(2)
    expect(written).toMatchObject({ title: 'paper', documents: 1, pinnedIds: [], greetingIds: [] })
  })

  it('keeps the bytes under the document, straight in the database', async () => {
    const file = inspected()
    const written = await writeFile(STORY, file)

    expect(db.files.put).toHaveBeenCalledWith({
      id: written.folderId,
      storyId: STORY,
      blob: file.blob,
    })
  })

  it('goes where it was asked for', async () => {
    const folder = store.createDocument({
      storyId: STORY,
      parentId: rootIdFor(STORY),
      type: 'folder',
      title: 'Papers',
    })
    const written = await writeFile(STORY, inspected(), { parentId: folder.id })

    expect(store.getDocument(written.folderId).parentId).toBe(folder.id)
  })

  it('does not make two documents of one name', async () => {
    await writeFile(STORY, inspected())
    const second = await writeFile(STORY, inspected())

    expect(second.title).toBe('paper (2)')
  })

  it('leaves pages off a file that has none', async () => {
    const written = await writeFile(STORY, inspected({ mime: 'image/png', pages: undefined }))

    expect('pages' in store.getDocument(written.folderId)).toBe(false)
  })

  it('tells the writer how much text came out, and when none did', async () => {
    expect((await writeFile(STORY, inspected())).note).toBe('3 pages of text.')
    expect((await writeFile(STORY, inspected({ pages: 1 }))).note).toBe('1 page of text.')
    expect((await writeFile(STORY, inspected({ text: '' }))).note).toMatch(/no text.*scan/)
    expect((await writeFile(STORY, inspected({ mime: 'image/png', text: '' }))).note).toBe(
      'Kept as it is.'
    )
    expect((await writeFile(STORY, inspected({ mime: 'text/csv', text: 'a,b' }))).note).toBe(
      'Its text is the document.'
    )
  })

  describe('an epub', () => {
    const book = (/** @type {Object} */ more = {}) =>
      inspected({
        title: 'Tides',
        mime: 'application/epub+zip',
        pages: undefined,
        text: 'the whole book',
        blob: new Blob(['PK'], { type: 'application/epub+zip' }),
        sections: [
          { title: 'Front matter', text: 'For K.' },
          {
            title: 'Part One',
            text: '# Part One\n\nWhere it begins.',
            children: [
              { title: 'Chapter', text: 'A.' },
              { title: 'Chapter', text: 'B.' },
            ],
          },
          { title: 'Part Two', text: '', children: [{ title: 'Coda', text: 'C.' }] },
        ],
        ...more,
      })
    /** Titles under a folder, in order, folders as `{title: [...]}`. */
    const tree = (/** @type {string} */ id) =>
      store
        .getChildrenOrdered(id)
        .map(child => (child.type === 'folder' ? { [child.title]: tree(child.id) } : child.title))

    it('becomes an ordered folder of its parts and chapters, with the epub last', async () => {
      const written = await writeFile(STORY, book())

      const folder = store.getDocument(written.folderId)
      expect(folder).toMatchObject({ type: 'folder', title: 'Tides', ordered: true })
      expect(tree(folder.id)).toEqual([
        'Front matter',
        { 'Part One': ['Part One', 'Chapter', 'Chapter (2)'] },
        { 'Part Two': ['Coda'] },
        'Tides',
      ])
      expect(written).toMatchObject({
        title: 'Tides',
        documents: 6,
        note: '5 chapters, and the epub.',
      })
    })

    it('writes the chapters as markdown, and keeps the epub with no text of its own', async () => {
      const written = await writeFile(STORY, book())
      const [front, partOne, , file] = store.getChildrenOrdered(written.folderId)

      expect(front).toMatchObject({ type: 'text', content: 'For K.' })
      expect(store.getChildrenOrdered(partOne.id)[0].content).toBe('# Part One\n\nWhere it begins.')
      expect(store.getDocument(partOne.id).ordered).toBe(true)
      expect(file).toMatchObject({ type: 'file', mime: 'application/epub+zip', content: '' })
      expect(db.files.put).toHaveBeenCalledWith({
        id: file.id,
        storyId: STORY,
        blob: expect.any(Blob),
      })
    })

    it('is one file, as before, when no chapters could be read out of it', async () => {
      const written = await writeFile(STORY, book({ sections: [], text: '' }))
      expect(store.getDocument(written.folderId)).toMatchObject({ type: 'file', title: 'Tides' })
    })
  })

  describe('reextractFile', () => {
    it('reads the text out of the bytes again, over what the text had become', async () => {
      const written = await writeFile(STORY, inspected({ text: 'cut down by hand', pages: 1 }))
      const pdf = new Blob([minimalPdf([['Hello there'], ['Second page']])], {
        type: 'application/pdf',
      })
      db.files.get.mockResolvedValue({ id: written.folderId, storyId: STORY, blob: pdf })

      const found = await reextractFile(STORY, written.folderId)

      expect(found.pages).toBe(2)
      const document = store.getDocument(written.folderId)
      expect(document.content).toContain('Hello there')
      expect(document.content).toContain('Second page')
      expect(document.pages).toBe(2)
      expect(db.files.put).toHaveBeenCalledTimes(1)
    })

    it('leaves a file whose bytes are gone as it is', async () => {
      const written = await writeFile(STORY, inspected())
      db.files.get.mockResolvedValue(undefined)

      expect(await reextractFile(STORY, written.folderId)).toBeNull()
      expect(store.getDocument(written.folderId).content).toBe('[p.1]\nAbstract')
    })

    it('does nothing for a document that is not a file', async () => {
      const made = store.createDocument({
        storyId: STORY,
        parentId: rootIdFor(STORY),
        type: 'text',
        title: 'Notes',
        content: 'kept',
      })
      expect(await reextractFile(STORY, made.id)).toBeNull()
      expect(db.files.get).not.toHaveBeenCalled()
    })
  })
})
