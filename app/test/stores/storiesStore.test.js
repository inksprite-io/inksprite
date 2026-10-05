import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useStoriesStore } from '../../src/stores/storiesStore'
import { useDocumentsStore } from '../../src/stores/documentsStore'
import { rootIdFor } from '../../src/stores/migrations/projectTree.js'

// Mock the database module
vi.mock('../../src/stores/db', () => ({
  default: {
    stories: {
      toArray: vi.fn(),
    },
    documents: {
      where: vi.fn(() => ({ equals: vi.fn(() => ({ toArray: vi.fn(async () => []) })) })),
      bulkGet: vi.fn(async () => []),
    },
  },
}))

// Mock the sync store. One spy for every store made, so a test can ask what
// was saved or deleted.
const trackChange = vi.fn()
const trackDelete = vi.fn()
vi.mock('../../src/stores/syncStore', () => ({
  useSyncStore: () => ({ trackChange, trackDelete }),
}))

// Mock all stores needed for cascading deletes
vi.mock('../../src/stores/partsStore.js', () => ({
  usePartsStore: () => ({
    loadPartsForStory: vi.fn().mockResolvedValue(undefined),
    getPartsForStory: vi.fn().mockReturnValue([]),
    deletePart: vi.fn(),
  }),
}))

vi.mock('../../src/stores/scenesStore.js', () => ({
  useScenesStore: () => ({
    getScenesForPart: vi.fn().mockReturnValue([]),
    deleteScene: vi.fn(),
  }),
}))

vi.mock('../../src/stores/sceneBeatsStore.js', () => ({
  useSceneBeatsStore: () => ({
    loadBeatsForStory: vi.fn().mockResolvedValue(undefined),
    deleteSceneBeatsForScene: vi.fn(),
    deleteSceneBeatsForStory: vi.fn(),
  }),
}))

vi.mock('../../src/stores/chatsStore.js', () => ({
  useChatsStore: () => ({
    loadChatsForStory: vi.fn().mockResolvedValue(undefined),
    getChatsForStory: vi.fn().mockReturnValue([]),
    deleteChat: vi.fn(),
  }),
}))

vi.mock('../../src/stores/messagesStore.js', () => ({
  useMessagesStore: () => ({
    deleteMessagesForChat: vi.fn(),
  }),
}))

vi.mock('../../src/stores/lorebooksStore.js', () => ({
  useLorebooksStore: () => ({
    getLorebookForStory: vi.fn().mockResolvedValue(null),
    deleteLorebook: vi.fn(),
  }),
}))

vi.mock('../../src/stores/loreEntriesStore.js', () => ({
  useLoreEntriesStore: () => ({
    deleteLoreEntriesForLorebook: vi.fn(),
  }),
}))

// Mock nanoid. Distinct ids per call, because creating a project now creates a
// tree: a constant would collapse every document in it onto one entry.
import { nanoid } from 'nanoid'
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

describe('StoriesStore', () => {
  /** @type {import('../../src/stores/storiesStore').useStoriesStore} */
  let store

  beforeEach(() => {
    // Create a fresh Pinia instance before each test
    setActivePinia(createPinia())
    // Reset mocks
    vi.clearAllMocks()
    resetIds()
  })

  describe('initialization', () => {
    it('should initialize with an empty stories map', async () => {
      const { default: db } = await import('../../src/stores/db')
      db.stories.toArray.mockResolvedValue([])

      store = useStoriesStore()
      await store.ensureInitialized()

      expect(store.stories.size).toBe(0)
      expect(store.isInitialized).toBe(true)
    })

    it('should load stories from database on initialization', async () => {
      const mockStories = [
        { id: 'story_1', title: 'Story 1' },
        { id: 'story_2', title: 'Story 2' },
        { id: 'story_3', title: 'Story 3' },
      ]

      const { default: db } = await import('../../src/stores/db')
      db.stories.toArray.mockResolvedValue(mockStories)

      store = useStoriesStore()
      await store.ensureInitialized()

      expect(store.stories.size).toBe(3)
      expect(store.stories.has('story_1')).toBe(true)
      expect(store.stories.has('story_2')).toBe(true)
      expect(store.stories.has('story_3')).toBe(true)
      expect(store.isInitialized).toBe(true)
    })

    it('should handle database errors gracefully', async () => {
      const { default: db } = await import('../../src/stores/db')
      db.stories.toArray.mockRejectedValue(new Error('Database error'))

      store = useStoriesStore()
      await store.ensureInitialized()

      expect(store.stories.size).toBe(0)
      expect(store.isInitialized).toBe(true)
    })
  })

  describe('createStory', () => {
    beforeEach(async () => {
      const { default: db } = await import('../../src/stores/db')
      db.stories.toArray.mockResolvedValue([])
      store = useStoriesStore()
      await store.ensureInitialized()
    })

    it('should create a new story with default values', async () => {
      const story = await store.createStory('Test Story')

      expect(story).toMatchObject({
        id: 'story_test-id-123',
        overview: '',
        wordCount: 0,
        version: 1,
      })
      expect(typeof story.created).toBe('number')
      expect(typeof story.updated).toBe('number')
      expect(store.stories.has(story.id)).toBe(true)
    })

    it('starts a project empty, with nowhere to land and no options', async () => {
      const story = await store.createStory('Test Story')

      expect(useDocumentsStore().getChildren(rootIdFor(story.id))).toEqual([])
      expect(story.lastDocumentId).toBeNull()
      expect(story.options).toEqual({})
    })

    it('should name the project on its root node, not the story record', async () => {
      const story = await store.createStory('Test Story')

      // The bookshelf shows a name long before anyone opens the story, so the
      // root node has to exist by the time createStory returns.
      expect(useDocumentsStore().getRoot(story.id).title).toBe('Test Story')
      expect(story.title).toBeUndefined()
    })

    it('should handle empty title', async () => {
      const story = await store.createStory('')

      expect(useDocumentsStore().getRoot(story.id).title).toBe('Untitled')
      expect(story.id).toBe('story_test-id-123')
    })

    it('should handle undefined title', async () => {
      const story = await store.createStory()

      expect(story.title).toBeUndefined()
      expect(story.id).toBe('story_test-id-123')
    })
  })

  describe('updateStory', () => {
    beforeEach(async () => {
      const existingStory = {
        id: 'story_1',
        title: 'Original Title',
        overview: 'Original Overview',
        wordCount: 100,
        lastDocumentId: null,
        version: 1,
        created: Date.now() - 1000,
        updated: Date.now() - 1000,
      }

      const { default: db } = await import('../../src/stores/db')
      db.stories.toArray.mockResolvedValue([existingStory])

      store = useStoriesStore()
      await store.ensureInitialized()
    })

    it('should update an existing story', async () => {
      const updated = await store.updateStory('story_1', {
        title: 'Updated Title',
        overview: 'Updated Overview',
      })

      expect(updated.title).toBe('Updated Title')
      expect(updated.overview).toBe('Updated Overview')
      expect(updated.version).toBe(1) // Version only increments at persist time
      expect(updated.id).toBe('story_1') // System field preserved
      expect(typeof updated.updated).toBe('number')
    })

    it('should preserve system fields during update', async () => {
      const original = store.stories.get('story_1')
      const updated = await store.updateStory('story_1', {
        id: 'different_id',
        created: 999,
        version: 999,
      })

      expect(updated.id).toBe(original.id)
      expect(updated.created).toBe(original.created)
      expect(updated.version).toBe(1) // Version only increments at persist time // Incremented, not set to 999
    })

    it('should throw error when updating non-existent story', async () => {
      await expect(store.updateStory('non_existent', { title: 'New Title' })).rejects.toThrow(
        "Failed to update story, 'non_existent' not found"
      )
    })
  })

  describe('deleteStory', () => {
    beforeEach(async () => {
      const existingStory = {
        id: 'story_1',
        title: 'Story to Delete',
        overview: '',
        wordCount: 0,
        lastDocumentId: null,
        version: 1,
        created: Date.now(),
        updated: Date.now(),
      }

      const { default: db } = await import('../../src/stores/db')
      db.stories.toArray.mockResolvedValue([existingStory])

      store = useStoriesStore()
      await store.ensureInitialized()
    })

    it('should delete a story', async () => {
      await store.deleteStory('story_1')

      expect(store.stories.has('story_1')).toBe(false) // Removed from cache
      expect(store.getStory('story_1')).toBeNull()
      expect(trackDelete).toHaveBeenCalledWith('stories', 'story_1')
    })

    it('should throw error when deleting non-existent story', async () => {
      await expect(store.deleteStory('non_existent')).rejects.toThrow(
        "Failed to delete story, 'non_existent' not found"
      )
    })
  })

  describe('getStory', () => {
    beforeEach(async () => {
      const mockStories = [
        { id: 'story_1', title: 'Story 1' },
        { id: 'story_2', title: 'Story 2' },
      ]

      const { default: db } = await import('../../src/stores/db')
      db.stories.toArray.mockResolvedValue(mockStories)

      store = useStoriesStore()
      await store.ensureInitialized()
    })

    it('should return story if found', () => {
      const story = store.getStory('story_1')

      expect(story).toBeDefined()
      expect(story.title).toBe('Story 1')
    })

    it('should return null for a deleted story', async () => {
      await store.deleteStory('story_2')

      const story = store.getStory('story_2')

      expect(story).toBeNull()
    })

    it('should return null for non-existent story', () => {
      const story = store.getStory('non_existent')

      expect(story).toBeNull()
    })
  })

  describe('getAllStories', () => {
    beforeEach(async () => {
      const mockStories = [
        { id: 'story_1', title: 'Story 1', updated: 1000 },
        { id: 'story_2', title: 'Story 2', updated: 2000 },
        { id: 'story_3', title: 'Story 3', updated: 3000 },
      ]

      const { default: db } = await import('../../src/stores/db')
      db.stories.toArray.mockResolvedValue(mockStories)

      store = useStoriesStore()
      await store.ensureInitialized()
    })

    it('should return all stories', () => {
      const allStories = store.getAllStories()

      expect(allStories).toHaveLength(3)
      expect(allStories[0].id).toBe('story_1')
      expect(allStories[1].id).toBe('story_2')
      expect(allStories[2].id).toBe('story_3')
    })

    it('should exclude deleted stories', async () => {
      await store.deleteStory('story_3')

      const allStories = store.getAllStories()

      expect(allStories).toHaveLength(2)
      expect(allStories.find(s => s.id === 'story_3')).toBeUndefined()
    })
  })

  describe('getAllStoriesOrdered', () => {
    beforeEach(async () => {
      const mockStories = [
        { id: 'story_1', title: 'Story A', updated: 1000 },
        { id: 'story_2', title: 'Story B', updated: 3000 },
        { id: 'story_3', title: 'Story C', updated: 2000 },
      ]

      const { default: db } = await import('../../src/stores/db')
      db.stories.toArray.mockResolvedValue(mockStories)

      store = useStoriesStore()
      await store.ensureInitialized()
    })

    it('should return stories ordered by updated date descending', () => {
      const orderedStories = store.getAllStoriesOrdered()

      expect(orderedStories).toHaveLength(3)
      expect(orderedStories[0].id).toBe('story_2') // Most recent
      expect(orderedStories[1].id).toBe('story_3')
      expect(orderedStories[2].id).toBe('story_1') // Oldest
    })

    it('should use id as secondary sort when dates are equal', async () => {
      // Names live on root documents, which the shelf loads separately — the
      // tiebreak has to work from the story records alone.
      const mockStories = [
        { id: 'story_3', updated: 1000 },
        { id: 'story_1', updated: 1000 },
        { id: 'story_2', updated: 1000 },
      ]

      const { default: db } = await import('../../src/stores/db')
      db.stories.toArray.mockResolvedValue(mockStories)

      // Create new store with new data
      setActivePinia(createPinia())
      const newStore = useStoriesStore()
      await newStore.ensureInitialized()

      const orderedStories = newStore.getAllStoriesOrdered()

      expect(orderedStories[0].id).toBe('story_1')
      expect(orderedStories[1].id).toBe('story_2')
      expect(orderedStories[2].id).toBe('story_3')
    })
  })

  describe('edge cases', () => {
    beforeEach(async () => {
      const { default: db } = await import('../../src/stores/db')
      db.stories.toArray.mockResolvedValue([])
      store = useStoriesStore()
      await store.ensureInitialized()
    })

    it('should handle concurrent updates correctly', async () => {
      await store.createStory('Test Story')

      const update1 = await store.updateStory('story_test-id-123', { overview: 'Overview 1' })
      const update2 = await store.updateStory('story_test-id-123', { overview: 'Overview 2' })

      expect(update1.version).toBe(1) // Version only increments at persist time
      expect(update2.version).toBe(1) // Version only increments at persist time
      expect(store.stories.get('story_test-id-123').overview).toBe('Overview 2')
    })

    it('should handle stories with same title', async () => {
      const story1 = await store.createStory('Duplicate Title')
      vi.mocked(nanoid).mockReturnValueOnce('test-id-456')
      const story2 = await store.createStory('Duplicate Title')

      expect(story1.id).not.toBe(story2.id)
      expect(store.stories.size).toBe(2)
    })

    it('should only initialize once', async () => {
      const { default: db } = await import('../../src/stores/db')
      db.stories.toArray.mockClear()
      db.stories.toArray.mockResolvedValue([])

      // First initialization already happened in beforeEach
      await store.ensureInitialized()
      await store.ensureInitialized()
      await store.ensureInitialized()

      // Should not call database again after first init
      expect(db.stories.toArray).not.toHaveBeenCalled()
    })
  })
})
