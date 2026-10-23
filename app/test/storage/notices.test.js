// @vitest-environment node
import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import { dexieStorage } from '@/storage/dexie.js'
import { storage, useStorage, onWrittenForSync } from '@/storage/index.js'
import { rootIdFor } from '@/stores/migrations/projectTree.js'

// What the storage tells the app's other windows once a write is done.
const windows = vi.hoisted(() => ({ tellOtherWindows: vi.fn() }))
vi.mock('@/platform/windows.js', () => windows)

/** Storage that writes nothing, and says what it was asked. */
const quiet = /** @type {any} */ (
  Object.fromEntries(Object.keys(dexieStorage).map(name => [name, vi.fn(async () => {})]))
)

/** A put of a row, as `syncStore` writes it. */
const put = (id, data) => ({ entityType: 'documents', id, op: 'put', data, timestamp: 1 })

/** Whatever was told, once the moment's writes are over. */
const told = async () => {
  await Promise.resolve()
  return windows.tellOtherWindows.mock.calls.map(([notice]) => notice)
}

beforeEach(() => {
  vi.clearAllMocks()
  useStorage(quiet)
})

afterAll(() => useStorage(dexieStorage))

describe('what a write tells the other windows', () => {
  it('names the app tables written in one moment, once', async () => {
    await Promise.all([
      storage.put('aiPrompts', { id: 'p1' }),
      storage.remove('chatProfiles', ['c1']),
      storage.write('aiPrompts', []),
    ])
    expect(await told()).toEqual([{ type: 'tables', tables: ['aiPrompts', 'chatProfiles'] }])
  })

  it('tells of a project come, gone or renamed, for the lists of projects', async () => {
    await storage.addProject(/** @type {any} */ ({}))
    await storage.removeProject('story_1')
    await storage.write('stories', [])
    await storage.write('documents', [put(rootIdFor('story_1'), { storyId: 'story_1' })])
    expect(await told()).toEqual([
      { type: 'projects' },
      { type: 'projects' },
      { type: 'projects' },
      { type: 'projects' },
    ])
  })

  it('tells nothing of a project’s own rows: they are its window’s', async () => {
    await storage.write('documents', [put('doc_1', { storyId: 'story_1' })])
    await storage.write('messages', [])
    await storage.documents('story_1')
    expect(await told()).toEqual([])
  })

  it('has every window reload when everything is replaced', async () => {
    await storage.replaceAll({})
    expect(await told()).toEqual([{ type: 'reload' }])
  })

  it('tells nothing of a write that failed', async () => {
    quiet.put.mockRejectedValueOnce(new Error('The disk is full.'))
    await expect(storage.put('aiPrompts', { id: 'p1' })).rejects.toThrow('The disk is full.')
    expect(await told()).toEqual([])
  })
})

describe('what a write tells sync', () => {
  it('tells of the setup’s rows put, written and removed, and of no device’s own', async () => {
    /** @type {any[]} */
    const heard = []
    const stop = onWrittenForSync(written => heard.push(written))
    await storage.put('skillWordings', { name: 'interpret', text: 'Closely.' })
    await storage.remove('cardFiles', ['libcard_1'])
    await storage.write('aiProviders', [
      { entityType: 'aiProviders', id: 'p1', op: 'put', data: { id: 'p1' }, timestamp: 1 },
    ])
    await storage.put('projectViews', { id: 'story_1' })
    await storage.put('jobs', { id: 'job_1' })
    stop()

    expect(heard.map(written => [written.table, written.changes.map(change => change.id)])).toEqual(
      [
        ['skillWordings', ['interpret']],
        ['cardFiles', ['libcard_1']],
        ['aiProviders', ['p1']],
      ]
    )
    expect(heard[1].changes[0].op).toBe('delete')
  })
})
