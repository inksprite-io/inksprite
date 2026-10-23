/* global Blob */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useFilesStore } from '@/stores/filesStore'
import { provideFiles } from '@/cloud/onDemand.js'
import db from '@/stores/db'

vi.mock('@/stores/db', () => ({
  default: {
    files: {
      put: vi.fn(async () => undefined),
      get: vi.fn(async () => undefined),
    },
  },
}))

describe('filesStore', () => {
  /** @type {ReturnType<typeof useFilesStore>} */
  let store

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.resetAllMocks()
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

  it('waits for a put of the same file that has not finished', async () => {
    const blob = new Blob(['%PDF'], { type: 'application/pdf' })
    /** @type {() => void} */
    let finish = () => {}
    db.files.put.mockImplementationOnce(
      () => new Promise(resolve => (finish = () => resolve(undefined)))
    )
    db.files.get.mockImplementation(async () => (finished ? { id: 'doc_1', blob } : undefined))
    let finished = false

    const putting = store.putFile('doc_1', 'story_1', blob)
    const reading = store.getFile('doc_1')
    expect(await store.getFile('doc_2')).toBeNull()
    finished = true
    finish()
    await putting

    expect(await reading).toBe(blob)
  })

  it('reads a failure as nothing rather than throwing into the viewer', async () => {
    db.files.get.mockRejectedValueOnce(new Error('closed'))
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(await store.getFile('doc_1')).toBeNull()
    error.mockRestore()
  })

  it('fetches a file whose bytes are on the sync server alone, and tells how far it has come', async () => {
    const fetched = new Blob(['%PDF'], { type: 'application/pdf' })
    const stop = provideFiles({
      has: async id => id === 'doc_far',
      fetch: async (id, progress) => {
        progress?.(1, 1)
        return id === 'doc_far' ? fetched : null
      },
      fetchProjects: async () => 0,
    })
    const progress = vi.fn()

    expect(await store.getFile('doc_far', { progress })).toBe(fetched)
    expect(progress).toHaveBeenCalledWith(1, 1)
    expect(await store.isElsewhere('doc_far')).toBe(true)
    expect(await store.getFile('doc_none')).toBeNull()
    stop()
    expect(await store.getFile('doc_far')).toBeNull()
    expect(await store.isElsewhere('doc_far')).toBe(false)
  })

  it('reads a download that failed as nothing, for the viewer to offer again', async () => {
    const stop = provideFiles({
      has: async () => true,
      fetch: async () => {
        throw new Error('offline')
      },
      fetchProjects: async () => 0,
    })
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await store.getFile('doc_far')).toBeNull()
    error.mockRestore()
    stop()
  })
})
