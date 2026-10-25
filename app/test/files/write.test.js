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

  it('says when a PDF came in with no text', async () => {
    expect((await writeFile(STORY, inspected())).scan).toBeUndefined()
    expect((await writeFile(STORY, inspected({ text: '' }))).scan).toBe(true)
    expect(
      (await writeFile(STORY, inspected({ mime: 'image/png', text: '' }))).scan
    ).toBeUndefined()
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
    /** Titles under a document, in order, what holds others as `{title: [...]}`. */
    const held = (/** @type {string} */ id) =>
      store.getChildrenOrdered(id).map(child => {
        const under = store.getChildrenOrdered(child.id)
        return under.length || child.type === 'folder'
          ? { [child.title]: held(child.id) }
          : child.title
      })

    it('is the epub, holding its parts and chapters in order', async () => {
      const written = await writeFile(STORY, book())

      const epub = store.getDocument(written.folderId)
      expect(epub).toMatchObject({
        type: 'file',
        title: 'Tides',
        mime: 'application/epub+zip',
        content: '',
        ordered: true,
      })
      expect(epub.parentId).toBe(rootIdFor(STORY))
      expect(held(epub.id)).toEqual([
        'Front matter',
        { 'Part One': ['Chapter', 'Chapter (2)'] },
        { 'Part Two': ['Coda'] },
      ])
      expect(db.files.put).toHaveBeenCalledWith({
        id: epub.id,
        storyId: STORY,
        blob: expect.any(Blob),
      })
      expect(written).toMatchObject({ title: 'Tides', documents: 6 })
    })

    it('writes the chapters as markdown', async () => {
      const written = await writeFile(STORY, book())
      const [front, partOne] = store.getChildrenOrdered(written.folderId)

      expect(front).toMatchObject({ type: 'text', content: 'For K.' })
      expect(store.getChildrenOrdered(partOne.id)[0]).toMatchObject({ type: 'text', content: 'A.' })
    })

    it('makes a part with words of its own that text, and one with none a folder', async () => {
      const written = await writeFile(STORY, book())
      const [, partOne, partTwo] = store.getChildrenOrdered(written.folderId)

      expect(partOne).toMatchObject({
        type: 'text',
        content: '# Part One\n\nWhere it begins.',
        ordered: true,
      })
      expect(partTwo).toMatchObject({ type: 'folder', ordered: true })
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
