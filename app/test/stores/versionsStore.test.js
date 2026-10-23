import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useVersionsStore } from '@/stores/versionsStore'
import { PAUSE_MS, STRETCH_MS } from '@/utils/versions.js'

/** The versions table, as the sync store saves to it. */
const kept = vi.hoisted(() => new Map())
vi.mock('@/stores/syncStore', () => ({
  useSyncStore: () => ({
    trackChange: (table, id, row) => table === 'versions' && kept.set(id, row),
    trackDelete: (table, id) => table === 'versions' && kept.delete(id),
    processSync: async () => {},
  }),
}))
vi.mock('@/storage/index.js', () => ({
  storage: {
    versionsOf: async documentId => [...kept.values()].filter(v => v.documentId === documentId),
  },
}))

const HOUR = 60 * 60_000

/** A text document as it stood, last written `updated`. */
const doc = (content, updated, extra = {}) => ({
  id: 'doc_1',
  storyId: 'story_1',
  parentId: 'root_story_1',
  order: 0,
  type: 'text',
  title: 'Chapter 1',
  content,
  summary: '',
  wordCount: 0,
  version: 1,
  created: 0,
  updated,
  ...extra,
})

describe('versionsStore', () => {
  /** @type {ReturnType<typeof useVersionsStore>} */
  let store
  const all = () => store.list('doc_1')

  beforeEach(() => {
    setActivePinia(createPinia())
    kept.clear()
    store = useVersionsStore()
  })

  it('keeps the text a document was left at, once it changes after a pause', async () => {
    const now = 10 * HOUR
    store.changing(doc('Snow fell.', now - PAUSE_MS), now)

    const versions = await all()
    expect(versions).toHaveLength(1)
    expect(versions[0]).toMatchObject({
      documentId: 'doc_1',
      storyId: 'story_1',
      title: 'Chapter 1',
      content: 'Snow fell.',
      words: 2,
      at: now - PAUSE_MS,
    })
    expect('by' in versions[0]).toBe(false)
  })

  it('keeps nothing while typing goes on, until the stretch has gone an hour', async () => {
    const start = 10 * HOUR
    store.changing(doc('Snow fell.', start - PAUSE_MS), start)
    await all()
    store.changing(doc('Snow fell. Then', start + 1000), start + 2000)
    store.changing(doc('Snow fell. Then rain.', start + 2000), start + 3000)
    expect(await all()).toHaveLength(1)

    store.changing(doc('Snow fell. Then rain, all night.', start + STRETCH_MS), start + STRETCH_MS)
    expect((await all()).map(v => v.content)).toEqual([
      'Snow fell. Then rain, all night.',
      'Snow fell.',
    ])
  })

  it('keeps no empty text, and no text the newest version already has', async () => {
    store.changing(doc('', 0), 10 * HOUR)
    store.changing(doc('Snow fell.', 0), 10 * HOUR)
    store.changing(doc('Snow fell.', 0), 11 * HOUR)
    expect(await all()).toHaveLength(1)
  })

  it('keeps the text before the model changes it, once for a run of its edits', async () => {
    const write = vi.fn()
    store.around(doc('Snow fell.', 1000), 'model', write)
    store.around(doc('Snow fell hard.', 2000), 'model', write)

    expect(write).toHaveBeenCalledTimes(2)
    const versions = await all()
    expect(versions.map(v => [v.content, v.by])).toEqual([['Snow fell.', 'model']])
  })

  it('starts a new run once the writer has typed between', async () => {
    store.around(doc('Snow fell.', 1000), 'model', () => {})
    store.changing(doc('Snow fell hard.', 2000), 3000)
    store.around(doc('Snow fell hard, she said.', 3000), 'model', () => {})

    // Taken within the same moment, so in no order of their own.
    expect((await all()).map(v => v.content).sort()).toEqual([
      'Snow fell hard, she said.',
      'Snow fell.',
    ])
  })

  it('leaves the write from outside to what was kept before it', async () => {
    const now = 10 * HOUR
    store.around(doc('Snow fell.', now - PAUSE_MS), 'drive', () =>
      // The write goes through the store, which tells of the change too.
      store.changing(doc('Snow fell.', now - PAUSE_MS), now)
    )
    expect((await all()).map(v => v.by)).toEqual(['drive'])
  })

  it('keeps a version under a name, which never ages out', async () => {
    const named = await store.keepNamed(doc('Snow fell.', 0), ' First draft ')
    expect(named?.name).toBe('First draft')

    // A year of versions after it, which thin as they go.
    for (let day = 1; day <= 365; day++) {
      store.changing(doc(`Day ${day}.`, day * 24 * HOUR - PAUSE_MS), day * 24 * HOUR)
    }
    const versions = await all()
    expect(versions.some(v => v.name === 'First draft')).toBe(true)
    expect(versions.length).toBeLessThan(100)
  })

  it('keeps the text that lost a clash under a name of its own, and says how large it was', async () => {
    await store.keepClash(doc('The other device’s words.', 0), true)
    await store.keepClash(doc('A word or two.', 0), false)
    const versions = await all()
    expect(versions.map(v => [v.content, v.name, v.clash]).sort()).toEqual([
      ['A word or two.', 'Clashed with an edit from another device', 'small'],
      ['The other device’s words.', 'Clashed with an edit from another device', 'large'],
    ])
  })

  it('names a version, takes its name away, and deletes one', async () => {
    store.changing(doc('Snow fell.', 0), 10 * HOUR)
    const [version] = await all()

    expect(store.rename(version, 'Kept').name).toBe('Kept')
    expect('name' in store.rename(version, '  ')).toBe(false)
    store.remove(version)
    expect(await all()).toEqual([])
  })

  it('lets go of a document’s versions once it is deleted for good', async () => {
    store.changing(doc('Snow fell.', 0), 10 * HOUR)
    await store.keepNamed(doc('Rain.', 0), 'Kept')

    await store.dropFor('doc_1')

    expect(await all()).toEqual([])
  })

  it('says which pictures a document’s versions refer to', async () => {
    store.changing(doc('![](.images/doc_1/gate.png)', 0), 10 * HOUR)
    await all()
    expect([...((await store.picturesOf('doc_1')) ?? [])]).toEqual(['doc_1/gate.png'])
  })
})
