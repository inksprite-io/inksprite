/* global Blob */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { contentsOf, refreshRepository, writeRepository } from '@/source/write.js'
import { inRepository, isRepository, isSourceFile, keptWhole, repositoryOf } from '@/source/tree.js'
import { useDocumentsStore } from '@/stores/documentsStore'
import { clearDocumentInstances, useDocuments } from '@/composables/useDocuments'
import { rootIdFor } from '@/stores/migrations/projectTree.js'
import { DOCX_MIME } from '@/files/docx.js'
import { barePng, minimalDocx, minimalPdf } from '../files/helpers.js'

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

/** The bytes put, by document, as the files table would keep them. */
const stored = new Map()
const putFile = vi.fn(async (id, _storyId, blob) => {
  stored.set(id, blob)
})
const getFile = vi.fn(async id => stored.get(id) ?? null)
vi.mock('@/stores/filesStore', () => ({ useFilesStore: () => ({ putFile, getFile }) }))

vi.mock('@/stores/syncStore', () => ({
  useSyncStore: () => ({ trackChange: vi.fn(), trackDelete: vi.fn(), start: () => false }),
}))

const STORY = 'story_1'
const source = {
  from: /** @type {const} */ ('github'),
  name: 'acme/widgets',
  commit: 'aaa1111',
  imported: 1,
}
const file = (path, text) => ({ path, text, size: text.length })
/** A file that comes in whole, as `gatherSource` hands it on. */
const whole = (path, bytes, mime) => ({ path, text: '', size: bytes.length, bytes, mime })

/** A Word file of a heading, a picture and a line. */
const wordFile = () =>
  minimalDocx(
    '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Plans</w:t></w:r></w:p>' +
      '<w:p><w:r><w:drawing><wp:inline><wp:docPr id="1" name="Picture" descr="A map"/><a:graphic>' +
      '<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic>' +
      '<pic:blipFill><a:blip r:embed="rMap"/></pic:blipFill></pic:pic></a:graphicData></a:graphic>' +
      '</wp:inline></w:drawing></w:r></w:p>' +
      '<w:p><w:r><w:t>The vault is under the mill.</w:t></w:r></w:p>',
    { images: { rMap: barePng() } }
  )

describe('a repository in the tree', () => {
  /** @type {ReturnType<typeof useDocumentsStore>} */
  let store
  /** @type {ReturnType<typeof useDocuments>} */
  let api

  beforeEach(async () => {
    setActivePinia(createPinia())
    clearDocumentInstances()
    store = useDocumentsStore()
    api = useDocuments(STORY)
    await api.init()
    vi.clearAllMocks()
    stored.clear()
  })

  const write = files => writeRepository(STORY, { title: 'widgets', source, files })

  /** @param {string} folderId */
  const pathsIn = folderId => [...contentsOf(api.childrenOf, folderId).files.keys()].sort()

  it('writes a folder that says where it came from, with the files under it', async () => {
    const { folderId, files } = await write([
      file('src/index.ts', 'export const one = 1\n'),
      file('src/index.js', 'module.exports = 1\n'),
      file('README.md', '# Widgets\n'),
    ])

    const folder = store.getDocument(folderId)
    expect(folder).toMatchObject({
      type: 'folder',
      kind: 'repository',
      title: 'widgets',
      parentId: rootIdFor(STORY),
      source,
    })
    expect(files).toBe(3)
    // Titled with their filenames, extensions and all, so two never collide.
    expect(pathsIn(folderId)).toEqual(['README.md', 'src/index.js', 'src/index.ts'])
  })

  it('keeps the text as the file, with no bytes beside it', async () => {
    const { folderId } = await write([file('src/index.ts', 'export const one = 1\n')])

    const index = contentsOf(api.childrenOf, folderId).files.get('src/index.ts')
    expect(index).toMatchObject({
      type: 'file',
      mime: 'text/x-typescript',
      content: 'export const one = 1\n',
      size: 21,
    })
    expect(putFile).not.toHaveBeenCalled()
  })

  it('names a second import of the same repository apart from the first', async () => {
    await write([file('a.ts', 'a')])
    const { folderId } = await write([file('a.ts', 'a')])

    expect(store.getDocument(folderId)?.title).toBe('widgets (2)')
  })

  it('knows which documents are in a repository', async () => {
    const { folderId } = await write([file('src/index.ts', 'x')])
    const folder = /** @type {any} */ (store.getDocument(folderId))
    const src = contentsOf(api.childrenOf, folderId).folders.get('src')
    const index = contentsOf(api.childrenOf, folderId).files.get('src/index.ts')

    expect(isRepository(folder)).toBe(true)
    expect(repositoryOf(api.get, index)?.id).toBe(folderId)
    expect(inRepository(api.get, folder)).toBe(false)
    expect(inRepository(api.get, src)).toBe(true)
    expect(isSourceFile(api.get, index)).toBe(true)
    expect(isSourceFile(api.get, src)).toBe(false)
  })

  describe('files that come in whole', () => {
    /** @param {string} folderId @param {string} path */
    const at = (folderId, path) =>
      /** @type {import('@/types/models.js').Document} */ (
        contentsOf(api.childrenOf, folderId).files.get(path)
      )

    it('keeps a PDF as itself, with its text read out page by page', async () => {
      const pdf = minimalPdf([['The mill wheel turns.'], ['The vault is dry.']])
      const { folderId } = await write([whole('docs/spec.pdf', pdf, 'application/pdf')])

      const spec = at(folderId, 'docs/spec.pdf')
      expect(spec).toMatchObject({
        type: 'file',
        title: 'spec.pdf',
        mime: 'application/pdf',
        size: pdf.length,
        pages: 2,
      })
      expect(spec.content).toContain('The vault is dry.')
      expect(putFile).toHaveBeenCalledWith(spec.id, STORY, expect.any(Blob))
      expect(stored.get(spec.id).type).toBe('application/pdf')
      expect(keptWhole(spec)).toBe(true)
      // Read as an imported file is, not by line.
      expect(isSourceFile(api.get, spec)).toBe(false)
    })

    it('reads a Word file as markdown, its pictures left in the file', async () => {
      const { folderId } = await write([whole('notes.docx', wordFile(), DOCX_MIME)])

      const notes = at(folderId, 'notes.docx')
      expect(notes.content).toContain('# Plans')
      expect(notes.content).toContain('The vault is under the mill.')
      expect(notes.content).not.toContain('inksprite-picture')
      expect(stored.has(notes.id)).toBe(true)
    })

    it('keeps a picture with no text, and a file it cannot open with none', async () => {
      const { folderId } = await write([
        whole('logo.png', barePng(), 'image/png'),
        whole('broken.pdf', new Uint8Array([1, 2, 3]), 'application/pdf'),
      ])

      expect(at(folderId, 'logo.png')).toMatchObject({ content: '', mime: 'image/png' })
      expect(at(folderId, 'broken.pdf')).toMatchObject({ content: '', mime: 'application/pdf' })
      expect(putFile).toHaveBeenCalledTimes(2)
    })

    it('leaves one alone when its bytes are the same, and replaces one whose bytes changed', async () => {
      const { folderId } = await write([
        whole('same.png', barePng(), 'image/png'),
        whole('moved.png', barePng(), 'image/png'),
      ])
      const same = at(folderId, 'same.png').id
      const moved = at(folderId, 'moved.png').id
      putFile.mockClear()

      const other = barePng()
      other[other.length - 1] ^= 0xff
      const result = await refreshRepository(STORY, folderId, {
        source,
        files: [whole('same.png', barePng(), 'image/png'), whole('moved.png', other, 'image/png')],
      })

      expect(result).toEqual({ added: 0, updated: 1, removed: 0, unchanged: 1 })
      expect(at(folderId, 'same.png').id).toBe(same)
      // A new document: a file's bytes never change under its id.
      const replaced = at(folderId, 'moved.png')
      expect(replaced.id).not.toBe(moved)
      expect(store.getDocument(moved)).toBeFalsy()
      expect(putFile).toHaveBeenCalledTimes(1)
      expect(putFile).toHaveBeenCalledWith(replaced.id, STORY, expect.any(Blob))
      expect(pathsIn(folderId)).toEqual(['moved.png', 'same.png'])
    })

    it('replaces a file of text that now comes in whole, and the other way about', async () => {
      const { folderId } = await write([
        file('a.png', 'not a picture'),
        whole('b.ts', barePng(), 'image/png'),
      ])
      const a = at(folderId, 'a.png').id

      const result = await refreshRepository(STORY, folderId, {
        source,
        files: [whole('a.png', barePng(), 'image/png'), file('b.ts', 'export {}\n')],
      })

      expect(result.updated).toBe(2)
      expect(at(folderId, 'a.png').id).not.toBe(a)
      expect(keptWhole(at(folderId, 'a.png'))).toBe(true)
      expect(at(folderId, 'b.ts')).toMatchObject({
        content: 'export {}\n',
        mime: 'text/x-typescript',
      })
    })
  })

  describe('refreshed', () => {
    it('updates what changed in place, adds what is new, removes what is gone', async () => {
      const { folderId } = await write([
        file('src/a.ts', 'a1'),
        file('src/b.ts', 'b1'),
        file('old/gone.ts', 'g'),
      ])
      const before = contentsOf(api.childrenOf, folderId).files

      const result = await refreshRepository(STORY, folderId, {
        source: { ...source, commit: 'bbb2222', imported: 2 },
        files: [file('src/a.ts', 'a1'), file('src/b.ts', 'b2'), file('src/c.ts', 'c1')],
      })

      expect(result).toEqual({ added: 1, updated: 1, removed: 1, unchanged: 1 })
      const after = contentsOf(api.childrenOf, folderId)
      expect([...after.files.keys()].sort()).toEqual(['src/a.ts', 'src/b.ts', 'src/c.ts'])
      // The same documents, so a chat that read one is told it changed.
      expect(after.files.get('src/a.ts')?.id).toBe(before.get('src/a.ts')?.id)
      expect(after.files.get('src/b.ts')?.id).toBe(before.get('src/b.ts')?.id)
      expect(after.files.get('src/b.ts')?.content).toBe('b2')
      // A folder left empty goes too.
      expect(after.folders.has('old')).toBe(false)
      expect(store.getDocument(folderId)?.source?.commit).toBe('bbb2222')
    })

    it('writes nothing for a file whose text is the same', async () => {
      const { folderId } = await write([file('a.ts', 'same')])
      const update = vi.spyOn(store, 'updateDocument')

      await refreshRepository(STORY, folderId, { source, files: [file('a.ts', 'same')] })

      expect(update.mock.calls.filter(([id]) => id !== folderId)).toEqual([])
    })

    it('copes with a folder that became a file', async () => {
      const { folderId } = await write([file('lib/inner.ts', 'x')])

      const result = await refreshRepository(STORY, folderId, {
        source,
        files: [file('lib', 'now a file')],
      })

      expect(result.added).toBe(1)
      expect(pathsIn(folderId)).toEqual(['lib'])
    })
  })
})
