/* global Blob */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useFilesStore } from '@/stores/filesStore'
import db from '@/stores/db'

vi.mock('@/stores/db', () => ({
  default: {
    files: {
      put: vi.fn(async () => undefined),
      get: vi.fn(async () => undefined),
      bulkDelete: vi.fn(async () => undefined),
    },
  },
}))

describe('filesStore', () => {
  /** @type {ReturnType<typeof useFilesStore>} */
  let store

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    store = useFilesStore()
  })

  it('puts a file under its document', async () => {
    const blob = new Blob(['x'], { type: 'image/png' })
    await store.putFile('doc_1', 'story_1', blob)

    expect(db.files.put).toHaveBeenCalledWith({ id: 'doc_1', storyId: 'story_1', blob })
  })

  it('refuses a file with no document to belong to', async () => {
    await expect(store.putFile('', 'story_1', new Blob())).rejects.toThrow(/id/)
    expect(db.files.put).not.toHaveBeenCalled()
  })

  it('hands back the blob, and null when there is none', async () => {
    const blob = new Blob(['x'])
    db.files.get.mockResolvedValueOnce({ id: 'doc_1', storyId: 'story_1', blob })

    expect(await store.getFile('doc_1')).toBe(blob)
    expect(await store.getFile('doc_2')).toBeNull()
    expect(await store.getFile('')).toBeNull()
  })

  it('reads a failure as nothing rather than throwing into the viewer', async () => {
    db.files.get.mockRejectedValueOnce(new Error('closed'))
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(await store.getFile('doc_1')).toBeNull()
    error.mockRestore()
  })

  it('deletes the files it is given, and nothing for nothing', async () => {
    await store.deleteFiles([])
    expect(db.files.bulkDelete).not.toHaveBeenCalled()

    await store.deleteFiles(['a', 'b'])
    expect(db.files.bulkDelete).toHaveBeenCalledWith(['a', 'b'])
  })
})
