import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { contentsOf, refreshRepository, writeRepository } from '@/source/write.js'
import { inRepository, isRepository, isSourceFile, repositoryOf } from '@/source/tree.js'
import { useDocumentsStore } from '@/stores/documentsStore'
import { clearDocumentInstances, useDocuments } from '@/composables/useDocuments'
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

const putFile = vi.fn()
vi.mock('@/stores/filesStore', () => ({ useFilesStore: () => ({ putFile }) }))

vi.mock('@/stores/syncStore', () => ({
  useSyncStore: () => ({ trackChange: vi.fn(), trackDelete: vi.fn() }),
}))

const STORY = 'story_1'
const source = {
  from: /** @type {const} */ ('github'),
  name: 'acme/widgets',
  commit: 'aaa1111',
  imported: 1,
}
const file = (path, text) => ({ path, text, size: text.length })

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
