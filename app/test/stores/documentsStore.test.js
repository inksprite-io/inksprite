import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useDocumentsStore } from '../../src/stores/documentsStore'

vi.mock('../../src/stores/db', () => ({
  default: {
    documents: {
      where: vi.fn(() => ({ equals: vi.fn(() => ({ toArray: vi.fn() })) })),
      bulkGet: vi.fn(async () => []),
    },
  },
}))

const trackChange = vi.fn()
const trackDelete = vi.fn()
vi.mock('../../src/stores/syncStore', () => ({
  useSyncStore: () => ({ trackChange, trackDelete }),
}))

// Distinct ids per call: a template lays down a whole tree at once, and a
// constant would collapse it onto a single entry.
const { mockNanoid, resetIds } = vi.hoisted(() => {
  let n = 0
  return {
    mockNanoid: vi.fn(() => (n++ === 0 ? 'test-id-123' : `test-id-${n}`)),
    resetIds: () => {
      n = 0
    },
  }
})
vi.mock('nanoid', () => ({ nanoid: mockNanoid }))

describe('DocumentsStore', () => {
  /** @type {ReturnType<typeof useDocumentsStore>} */
  let store

  const folder = (id, parentId = 'story_1', extra = {}) =>
    store.createDocument({
      id,
      storyId: 'story_1',
      parentId,
      type: 'folder',
      title: id,
      ...extra,
    })

  const text = (id, parentId, extra = {}) =>
    store.createDocument({
      id,
      storyId: 'story_1',
      parentId,
      type: 'text',
      title: id,
      ...extra,
    })

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useDocumentsStore()
    vi.clearAllMocks()
    resetIds()
  })

  describe('createDocument', () => {
    it('creates a document with tree and system fields', () => {
      const doc = folder('part_1')

      expect(doc).toMatchObject({
        id: 'part_1',
        storyId: 'story_1',
        parentId: 'story_1',
        type: 'folder',
        order: 0,
        version: 1,
      })
      // A row is either there or gone; nothing marks it deleted.
      expect('deleted' in doc).toBe(false)
      expect('deletedAt' in doc).toBe(false)
      expect(store.getDocument('part_1')).toBe(doc)
      expect(trackChange).toHaveBeenCalledWith('documents', 'part_1', doc)
    })

    it('mints a doc_ id when the caller does not supply one', () => {
      const doc = store.createDocument({
        storyId: 'story_1',
        parentId: 'story_1',
        type: 'folder',
        title: 'New',
      })

      expect(doc.id).toBe('doc_test-id-123')
    })

    it('appends after existing siblings', () => {
      folder('part_1')
      folder('part_2')

      expect(store.getDocument('part_2').order).toBe(1)
    })

    it('counts words for text documents only', () => {
      const scene = text('scene_1', 'part_1', { content: '# one\n\n**two** three' })
      const act = folder('part_2', 'story_1', { content: 'ignored' })

      expect(scene.wordCount).toBe(3)
      // A folder holds children, not prose.
      expect(act.content).toBe('')
      expect(act.wordCount).toBe(0)
    })

    it('requires a story and a parent', () => {
      expect(() =>
        store.createDocument({ parentId: 'story_1', type: 'folder', title: 'x' })
      ).toThrow('Story ID is required to create a document')
      expect(() =>
        store.createDocument({ storyId: 'story_1', type: 'folder', title: 'x' })
      ).toThrow('Parent ID is required to create a document')
    })
  })

  describe('getChildren', () => {
    beforeEach(() => {
      folder('part_1')
      text('scene_1', 'part_1')
      text('scene_2', 'part_1')
    })

    it('returns children of a parent', () => {
      expect(store.getChildren('part_1').map(d => d.id)).toEqual(['scene_1', 'scene_2'])
    })

    it('treats the story as the root, so one index serves both levels', () => {
      expect(store.getChildren('story_1').map(d => d.id)).toEqual(['part_1'])
    })

    it('returns an empty array for an unknown parent', () => {
      expect(store.getChildren('nope')).toEqual([])
    })

    it('sorts by order with a stable tiebreak', () => {
      store.updateDocument('scene_1', { order: 5 })
      store.updateDocument('scene_2', { order: 5 })

      expect(store.getChildrenOrdered('part_1').map(d => d.id)).toEqual(['scene_1', 'scene_2'])
    })
  })

  describe('updateDocument', () => {
    beforeEach(() => {
      folder('part_1')
      text('scene_1', 'part_1', { content: 'one two' })
    })

    it('recomputes word count when content changes', () => {
      const updated = store.updateDocument('scene_1', { content: 'one two three four' })
      expect(updated.wordCount).toBe(4)
    })

    it('preserves id, created and version', () => {
      const before = store.getDocument('scene_1')
      const updated = store.updateDocument('scene_1', {
        id: 'other',
        created: 999,
        version: 999,
      })

      expect(updated.id).toBe('scene_1')
      expect(updated.created).toBe(before.created)
      // Version only increments at persist time.
      expect(updated.version).toBe(1)
    })

    it('reindexes when a document is reparented', () => {
      folder('part_2')
      store.updateDocument('scene_1', { parentId: 'part_2' })

      expect(store.getChildren('part_1')).toEqual([])
      expect(store.getChildren('part_2').map(d => d.id)).toEqual(['scene_1'])
    })

    it('adopts the new parent story when reparented across stories', () => {
      store.createDocument({
        id: 'part_other',
        storyId: 'story_2',
        parentId: 'story_2',
        type: 'folder',
        title: 'Other',
      })

      const moved = store.updateDocument('scene_1', { parentId: 'part_other' })
      expect(moved.storyId).toBe('story_2')
    })

    it('throws for an unknown document', () => {
      expect(() => store.updateDocument('nope', { title: 'x' })).toThrow(
        "Failed to update document, 'nope' not found"
      )
    })
  })

  describe('deleteDocument', () => {
    beforeEach(() => {
      folder('part_1')
      text('scene_1', 'part_1')
      text('scene_2', 'part_1')
    })

    it('drops the document from the live cache and queues the row for deletion', () => {
      trackChange.mockClear()

      store.deleteDocument('scene_1')

      expect(store.getDocument('scene_1')).toBeNull()
      expect(store.getChildren('part_1').map(d => d.id)).toEqual(['scene_2'])
      // The row goes from the database too, and nothing writes it back.
      expect(trackDelete).toHaveBeenCalledWith('documents', 'scene_1')
      expect(trackChange).not.toHaveBeenCalled()
    })

    it('leaves children alone — cascading is the caller`s decision', () => {
      store.deleteDocument('part_1')

      expect(store.getDocument('scene_1')).not.toBeNull()
    })

    it('throws for an unknown document', () => {
      expect(() => store.deleteDocument('nope')).toThrow(
        "Failed to delete document, 'nope' not found"
      )
    })
  })

  describe('deleteChildren', () => {
    it('deletes only the requested type', () => {
      folder('part_1')
      text('scene_1', 'part_1')
      folder('nested', 'part_1')

      expect(store.deleteChildren('part_1', 'text')).toBe(1)
      expect(store.getChildren('part_1').map(d => d.id)).toEqual(['nested'])
    })

    it('deletes every child when no type is given', () => {
      folder('part_1')
      text('scene_1', 'part_1')
      folder('nested', 'part_1')

      expect(store.deleteChildren('part_1')).toBe(2)
      expect(store.getChildren('part_1')).toEqual([])
    })
  })

  describe('reorderChildren', () => {
    beforeEach(() => {
      folder('part_1', 'story_1', { ordered: true })
      folder('part_2')
      text('scene_1', 'part_1')
      text('scene_2', 'part_1')
      text('scene_3', 'part_1')
    })

    it('renumbers in the given order', () => {
      const out = store.reorderChildren('part_1', ['scene_3', 'scene_1', 'scene_2'])

      expect(out.map(d => [d.id, d.order])).toEqual([
        ['scene_3', 0],
        ['scene_1', 1],
        ['scene_2', 2],
      ])
    })

    it('moves in a document dragged from another parent', () => {
      text('scene_x', 'part_2')

      store.reorderChildren('part_1', ['scene_x', 'scene_1', 'scene_2', 'scene_3'])

      expect(store.getDocument('scene_x').parentId).toBe('part_1')
      expect(store.getChildren('part_2')).toEqual([])
    })

    it('requires a parent and known ids', () => {
      expect(() => store.reorderChildren('', ['scene_1'])).toThrow(
        'Parent ID is required to reorder documents'
      )
      expect(() => store.reorderChildren('part_1', ['scene_1', 'nope'])).toThrow(
        "Document 'nope' not found"
      )
    })
  })

  describe('loadStory', () => {
    /** @param {any[]} rows */
    const mockRows = async rows => {
      const { default: db } = await import('../../src/stores/db')
      db.documents.where.mockReturnValue({
        equals: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue(rows) }),
      })
      return db
    }

    const row = (id, parentId, type = 'text', extra = {}) => ({
      id,
      storyId: 'story_1',
      parentId,
      type,
      title: id,
      order: 0,
      ...extra,
    })

    it('loads a whole tree in one query', async () => {
      const db = await mockRows([
        row('part_1', 'story_1', 'folder'),
        row('scene_1', 'part_1'),
        row('scene_2', 'part_1'),
      ])

      await store.loadStory('story_1')

      // Parts and scenes needed a query per part; a tree takes one read.
      expect(db.documents.where).toHaveBeenCalledTimes(1)
      expect(store.getChildren('story_1').map(d => d.id)).toEqual(['part_1'])
      expect(store.getChildren('part_1').map(d => d.id)).toEqual(['scene_1', 'scene_2'])
    })

    it('does not re-query a story it already has', async () => {
      const db = await mockRows([row('part_1', 'story_1', 'folder')])

      await store.loadStory('story_1')
      db.documents.where.mockClear()
      await store.loadStory('story_1')

      expect(db.documents.where).not.toHaveBeenCalled()
    })

    it('marks an empty story loaded so it is not re-read forever', async () => {
      const db = await mockRows([])

      await store.loadStory('story_1')
      expect(store.isStoryLoaded('story_1')).toBe(true)

      db.documents.where.mockClear()
      await store.loadStory('story_1')
      expect(db.documents.where).not.toHaveBeenCalled()
    })

    it('dedupes concurrent loads', async () => {
      const { default: db } = await import('../../src/stores/db')
      let release
      const gate = new Promise(resolve => {
        release = resolve
      })
      db.documents.where.mockReturnValue({
        equals: vi.fn().mockReturnValue({
          toArray: vi.fn(() => gate.then(() => [row('part_1', 'story_1', 'folder')])),
        }),
      })

      const first = store.loadStory('story_1')
      const second = store.loadStory('story_1')
      release()
      await Promise.all([first, second])

      expect(db.documents.where).toHaveBeenCalledTimes(1)
    })

    it('requires a story id and reports read failures', async () => {
      await expect(store.loadStory('')).rejects.toThrow('Story ID is required to load documents')

      const { default: db } = await import('../../src/stores/db')
      db.documents.where.mockReturnValue({
        equals: vi.fn().mockReturnValue({
          toArray: vi.fn().mockRejectedValue(new Error('Database error')),
        }),
      })

      await expect(store.loadStory('story_1')).rejects.toThrow(
        'Failed to load documents: Database error'
      )
    })
  })

  describe('markEdited', () => {
    const MINUTE = 60_000
    let now = 0
    /** @type {import('vitest').MockInstance} */
    let clock
    const edited = () => store.getRoot('story_1').edited

    beforeEach(() => {
      now = 10 * MINUTE
      clock = vi.spyOn(Date, 'now').mockImplementation(() => now)
      store.ensureRoot('story_1', 'Novel')
    })
    afterEach(() => clock.mockRestore())

    it('notes on the root when a document in the project is made, changed or deleted', () => {
      const rootId = store.getRoot('story_1').id
      expect(edited()).toBe(now)

      now += MINUTE
      text('doc_1', rootId)
      expect(edited()).toBe(now)

      now += MINUTE
      store.updateDocument('doc_1', { content: 'More.' })
      expect(edited()).toBe(now)

      now += MINUTE
      store.deleteDocument('doc_1')
      expect(edited()).toBe(now)
      expect(trackChange).toHaveBeenLastCalledWith('documents', rootId, store.getRoot('story_1'))
    })

    it('keeps it to the minute, so typing does not rewrite the root on every save', () => {
      const rootId = store.getRoot('story_1').id
      const first = edited()
      text('doc_1', rootId)
      trackChange.mockClear()

      now += MINUTE / 2
      store.updateDocument('doc_1', { content: 'A word.' })

      expect(edited()).toBe(first)
      expect(trackChange).toHaveBeenCalledTimes(1)
      expect(trackChange).toHaveBeenCalledWith('documents', 'doc_1', expect.anything())
    })

    it('keeps the time when the root itself is renamed', () => {
      const first = edited()
      now += MINUTE / 2
      store.updateDocument(store.getRoot('story_1').id, { title: 'Renamed' })
      expect(edited()).toBe(first)
    })

    it('takes a time worked out after the fact, and nothing for a project not loaded', () => {
      const root = store.getRoot('story_1')
      const { edited: _, ...unmarked } = root
      store.documents.set(root.id, unmarked)

      store.markEdited('story_1', 3 * MINUTE)
      expect(edited()).toBe(3 * MINUTE)

      expect(() => store.markEdited('story_2')).not.toThrow()
      expect(store.getRoot('story_2')).toBeNull()
    })
  })

  describe('renameProject', () => {
    it('renames the story root', async () => {
      store.createDocument({
        id: 'root_story_1',
        storyId: 'story_1',
        parentId: 'story_1',
        type: 'folder',
        title: 'Old Name',
      })

      await store.renameProject('story_1', 'New Name')

      expect(store.getRoot('story_1').title).toBe('New Name')
    })

    it('loads the root first, for callers holding only story records', async () => {
      const { default: db } = await import('../../src/stores/db')
      db.documents.bulkGet.mockResolvedValue([
        {
          id: 'root_story_9',
          storyId: 'story_9',
          parentId: 'story_9',
          type: 'folder',
          title: 'Old Name',
        },
      ])

      // The bookshelf renames stories whose trees it has never opened.
      await store.renameProject('story_9', 'New Name')

      expect(db.documents.bulkGet).toHaveBeenCalledWith(['root_story_9'])
      expect(store.getRoot('story_9').title).toBe('New Name')
    })

    it('throws for a story with no root', async () => {
      const { default: db } = await import('../../src/stores/db')
      db.documents.bulkGet.mockResolvedValue([undefined])

      await expect(store.renameProject('story_missing', 'x')).rejects.toThrow(
        "Story 'story_missing' has no root document to rename"
      )
    })
  })

  describe('ensureRoot', () => {
    it('creates the project root and nothing else', () => {
      const root = store.ensureRoot('story_1', 'My Novel')

      expect(root).toMatchObject({ id: 'root_story_1', type: 'folder', title: 'My Novel' })
      expect(store.getChildren('root_story_1')).toEqual([])
    })

    it('leaves a root that already exists alone', () => {
      store.ensureRoot('story_1', 'My Novel')
      store.updateDocument('root_story_1', { title: 'A Better Title' })

      expect(store.ensureRoot('story_1', 'My Novel').title).toBe('A Better Title')
    })

    it('does not bring back a folder the writer deleted', () => {
      store.ensureRoot('story_1', 'My Novel')
      const notes = folder('notes', 'root_story_1')
      store.deleteDocument(notes.id)

      // This is the state after a reload: a deleted document is not in the map,
      // which is exactly what used to make the default folders reappear.
      store.ensureRoot('story_1', 'My Novel')

      expect(store.getDocument('notes')).toBeNull()
      expect(store.getChildren('root_story_1')).toEqual([])
    })
  })
})
