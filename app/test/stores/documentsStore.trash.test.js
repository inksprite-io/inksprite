import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useDocumentsStore } from '../../src/stores/documentsStore'
import { TRASH_KEPT_MS } from '../../src/utils/trash.js'

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

describe('DocumentsStore trash', () => {
  /** @type {ReturnType<typeof useDocumentsStore>} */
  let store

  const make = (id, parentId, type = 'text', extra = {}) =>
    store.createDocument({ id, storyId: 'story_1', parentId, type, title: id, ...extra })

  /** A project's root, a folder with a document in it, and one beside it. */
  const project = () => {
    make('root_story_1', 'story_1', 'folder')
    make('notes', 'root_story_1', 'folder')
    make('elara', 'notes', 'text', { content: 'A thief.' })
    make('chapter', 'root_story_1')
  }

  /** @param {any[]} rows */
  const mockRows = async rows => {
    const { default: db } = await import('../../src/stores/db')
    db.documents.where.mockReturnValue({
      equals: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue(rows) }),
    })
  }

  const row = (id, storyId, parentId, extra = {}) => ({
    id,
    storyId,
    parentId,
    type: 'text',
    title: id,
    order: 0,
    content: '',
    ...extra,
  })

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useDocumentsStore()
    vi.clearAllMocks()
  })

  describe('trashDocument', () => {
    it('takes a folder and what is in it out of the tree, marking only the folder', () => {
      project()

      const trashed = store.trashDocument('notes', 1000)

      expect(trashed.trashed).toBe(1000)
      expect(store.getDocument('notes')).toBeNull()
      expect(store.getDocument('elara')).toBeNull()
      expect(store.getChildren('root_story_1').map(d => d.id)).toEqual(['chapter'])
      expect(store.getTrashedDocument('elara')?.trashed).toBeUndefined()
      expect(trackChange).toHaveBeenLastCalledWith('documents', 'notes', trashed)
    })

    it('lists only what was deleted, the most recent first', () => {
      project()
      store.trashDocument('chapter', 1000)
      store.trashDocument('notes', 2000)

      expect(store.trashedOf('story_1').map(d => d.id)).toEqual(['notes', 'chapter'])
      expect(store.trashedUnder('notes').map(d => d.id)).toEqual(['elara'])
    })

    it('refuses a project root and a document not in the tree', () => {
      project()
      expect(() => store.trashDocument('root_story_1')).toThrow()
      store.trashDocument('notes')
      expect(() => store.trashDocument('elara')).toThrow()
    })

    it('keeps edits away from what is in the trash', () => {
      project()
      store.trashDocument('notes')
      expect(() => store.updateDocument('elara', { content: 'Changed.' })).toThrow()
    })
  })

  describe('restoreDocument', () => {
    it('brings a folder back with what went with it', () => {
      project()
      store.trashDocument('notes')

      const back = store.restoreDocument('notes')

      expect('trashed' in back).toBe(false)
      expect(store.getDocument('notes')).toBe(back)
      expect(store.getChildren('notes').map(d => d.id)).toEqual(['elara'])
      expect(store.trashedOf('story_1')).toEqual([])
    })

    it('moves it where the caller says, under the name the caller gives', () => {
      project()
      store.trashDocument('elara')
      store.trashDocument('notes')

      store.restoreDocument('elara', { parentId: 'root_story_1', title: 'Elara (2)', order: 5 })

      expect(store.getDocument('elara')).toMatchObject({
        parentId: 'root_story_1',
        title: 'Elara (2)',
        order: 5,
      })
      expect(store.getChildren('notes')).toEqual([])
    })

    it('leaves in the trash what was deleted on its own before its folder was', () => {
      project()
      store.trashDocument('elara', 1000)
      store.trashDocument('notes', 2000)
      expect(store.trashedOf('story_1').map(d => d.id)).toEqual(['notes'])

      store.restoreDocument('notes')

      expect(store.getDocument('elara')).toBeNull()
      expect(store.trashedOf('story_1').map(d => d.id)).toEqual(['elara'])
    })

    it('refuses what is under a trashed folder rather than trashed itself', () => {
      project()
      store.trashDocument('notes')
      expect(() => store.restoreDocument('elara')).toThrow()
    })
  })

  describe('deleteTrashed', () => {
    it('deletes a trashed folder and what is in it for good', () => {
      project()
      store.trashDocument('notes')

      expect(store.deleteTrashed('notes')).toBe(2)

      expect(store.getTrashedDocument('notes')).toBeNull()
      expect(store.getTrashedDocument('elara')).toBeNull()
      expect(trackDelete).toHaveBeenCalledWith('documents', 'notes')
      expect(trackDelete).toHaveBeenCalledWith('documents', 'elara')
    })

    it('deletes nothing that is not in the trash', () => {
      project()
      expect(store.deleteTrashed('chapter')).toBe(0)
      expect(store.getDocument('chapter')).not.toBeNull()
    })
  })

  describe('loadStory', () => {
    it('keeps a trashed folder and what is in it out of the tree', async () => {
      await mockRows([
        row('root_story_a', 'story_a', 'story_a', { type: 'folder' }),
        row('notes', 'story_a', 'root_story_a', { type: 'folder', trashed: Date.now() }),
        row('elara', 'story_a', 'notes'),
        row('chapter', 'story_a', 'root_story_a'),
      ])

      await store.loadStory('story_a')

      expect(store.getChildren('root_story_a').map(d => d.id)).toEqual(['chapter'])
      expect(store.getDocument('elara')).toBeNull()
      expect(store.trashedOf('story_a').map(d => d.id)).toEqual(['notes'])
    })

    it('lets go of what has been in the trash for 30 days', async () => {
      const now = Date.now()
      await mockRows([
        row('root_story_b', 'story_b', 'story_b', { type: 'folder' }),
        row('old', 'story_b', 'root_story_b', { type: 'folder', trashed: now - TRASH_KEPT_MS }),
        row('inside', 'story_b', 'old'),
        row('recent', 'story_b', 'root_story_b', { trashed: now - 1000 }),
      ])

      await store.loadStory('story_b')

      expect(store.getTrashedDocument('old')).toBeNull()
      expect(store.getTrashedDocument('inside')).toBeNull()
      expect(trackDelete).toHaveBeenCalledWith('documents', 'old')
      expect(trackDelete).toHaveBeenCalledWith('documents', 'inside')
      expect(store.trashedOf('story_b').map(d => d.id)).toEqual(['recent'])
    })
  })

  describe('receive', () => {
    it('takes a folder trashed on another device out of the tree, with what is in it', () => {
      project()
      const notes = /** @type {any} */ (store.getDocument('notes'))

      store.receive('notes', { ...notes, trashed: 1000 })

      expect(store.getDocument('notes')).toBeNull()
      expect(store.getDocument('elara')).toBeNull()
      expect(store.trashedOf('story_1').map(d => d.id)).toEqual(['notes'])
    })

    it('brings back a folder restored on another device', () => {
      project()
      store.trashDocument('notes')
      const notes = /** @type {any} */ (store.getTrashedDocument('notes'))
      const { trashed, ...restored } = notes

      store.receive('notes', restored)

      expect(trashed).toBeTypeOf('number')
      expect(store.getChildren('notes').map(d => d.id)).toEqual(['elara'])
    })

    it('puts a document arriving in a trashed folder in the trash with it', () => {
      project()
      store.trashDocument('notes')

      store.receive('marta', row('marta', 'story_1', 'notes'))

      expect(store.getDocument('marta')).toBeNull()
      expect(store.getTrashedDocument('marta')).not.toBeNull()
    })
  })
})
