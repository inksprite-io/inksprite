import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useDocumentsStore } from '@/stores/documentsStore'

const rows = vi.hoisted(() => ({
  /** @type {any[]} */ current: [],
  /** @type {any[]} */ versions: [],
}))
vi.mock('@/storage/index.js', () => ({
  storage: {
    documents: vi.fn(async () => rows.current),
    versionsOf: vi.fn(async documentId => rows.versions.filter(v => v.documentId === documentId)),
  },
}))

const trackChange = vi.fn()
const trackDelete = vi.fn()
vi.mock('@/stores/syncStore', () => ({ useSyncStore: () => ({ trackChange, trackDelete }) }))

const PNG = { mime: 'image/png', width: 640, height: 480 }

/** A text row as storage hands it back. */
const row = (id, storyId, content, extra = {}) => ({
  id,
  storyId,
  parentId: storyId,
  order: 0,
  type: 'text',
  title: id,
  content,
  summary: '',
  wordCount: 0,
  version: 1,
  created: 1,
  updated: 1,
  ...extra,
})

describe('documentsStore, with pictures', () => {
  /** @type {ReturnType<typeof useDocumentsStore>} */
  let store

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    rows.versions = []
    store = useDocumentsStore()
  })

  it('keeps the pictures a text document is made with, and none on a folder', () => {
    const made = store.createDocument({
      storyId: 'story_1',
      parentId: 'story_1',
      type: 'text',
      title: 'Prologue',
      content: '![](.images/doc_a/gate.png)',
      pictures: { 'gate.png': PNG },
    })
    expect(made.pictures).toEqual({ 'gate.png': PNG })

    const folder = store.createDocument({
      storyId: 'story_1',
      parentId: 'story_1',
      type: 'folder',
      title: 'Act 1',
      pictures: { 'gate.png': PNG },
    })
    expect('pictures' in folder).toBe(false)
  })

  it("deletes a document's pictures with it", () => {
    const made = store.createDocument({
      storyId: 'story_1',
      parentId: 'story_1',
      type: 'text',
      title: 'Prologue',
      pictures: { 'gate.png': PNG, 'market map.png': PNG },
    })
    store.deleteDocument(made.id)

    expect(trackDelete).toHaveBeenCalledWith('documents', made.id)
    expect(trackDelete).toHaveBeenCalledWith('files', `${made.id}/gate.png`)
    expect(trackDelete).toHaveBeenCalledWith('files', `${made.id}/market map.png`)
  })

  it('lets go of the pictures no text refers to as the project first loads', async () => {
    rows.current = [
      row('doc_a', 'story_2', 'The gate ![](.images/doc_a/gate.png) and nothing else.', {
        pictures: { 'gate.png': PNG, 'wall.png': PNG },
      }),
      row('doc_b', 'story_2', 'Only words.', { pictures: { 'well.png': PNG } }),
    ]
    await store.loadStory('story_2')

    expect(store.getDocument('doc_a')?.pictures).toEqual({ 'gate.png': PNG })
    expect(store.getDocument('doc_b')?.pictures).toBeUndefined()
    expect(trackDelete.mock.calls.filter(([table]) => table === 'files')).toEqual([
      ['files', 'doc_a/wall.png'],
      ['files', 'doc_b/well.png'],
    ])
    expect(store.getDocument('doc_a')?.updated).toBe(1)
  })

  it('keeps a picture one of its versions refers to, so the version restored has it', async () => {
    rows.current = [row('doc_a', 'story_5', 'Words.', { pictures: { 'gate.png': PNG } })]
    rows.versions = [{ id: 'ver_1', documentId: 'doc_a', content: '![](.images/doc_a/gate.png)' }]
    await store.loadStory('story_5')

    expect(store.getDocument('doc_a')?.pictures).toEqual({ 'gate.png': PNG })
    expect(trackDelete).not.toHaveBeenCalled()
  })

  it("keeps a picture another document's text refers to", async () => {
    rows.current = [
      row('doc_a', 'story_3', 'Words.', { pictures: { 'gate.png': PNG } }),
      row('doc_b', 'story_3', 'Pasted: ![](.images/doc_a/gate.png)'),
    ]
    await store.loadStory('story_3')

    expect(store.getDocument('doc_a')?.pictures).toEqual({ 'gate.png': PNG })
    expect(trackDelete).not.toHaveBeenCalled()
    expect(trackChange).not.toHaveBeenCalled()
  })

  it('looks a project over once a session, however often it loads', async () => {
    rows.current = [row('doc_a', 'story_4', 'Words.', { pictures: { 'gate.png': PNG } })]
    await store.loadStory('story_4')
    expect(trackDelete).toHaveBeenCalledTimes(1)

    // Another store, as after the project was put away and opened again.
    setActivePinia(createPinia())
    vi.clearAllMocks()
    rows.current = [row('doc_a', 'story_4', 'Words.', { pictures: { 'gate.png': PNG } })]
    await useDocumentsStore().loadStory('story_4')
    expect(trackDelete).not.toHaveBeenCalled()
  })
})
