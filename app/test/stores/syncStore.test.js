import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useSyncStore } from '../../src/stores/syncStore'

// Mock the database module
vi.mock('../../src/stores/db', () => ({
  default: {
    transaction: vi.fn(),
    stories: {
      put: vi.fn(),
      delete: vi.fn(),
    },
    parts: {
      put: vi.fn(),
      delete: vi.fn(),
    },
    scenes: {
      put: vi.fn(),
      delete: vi.fn(),
    },
  },
}))

describe('SyncStore', () => {
  /** @type {import('../../src/stores/syncStore').useSyncStore} */
  let store

  beforeEach(() => {
    // Create a fresh Pinia instance before each test
    setActivePinia(createPinia())
    // Reset all mocks
    vi.clearAllMocks()
    // Reset timers
    vi.useFakeTimers()
    // Mock window and document
    globalThis.window = { addEventListener: vi.fn(), setInterval: vi.fn() }
    globalThis.document = { addEventListener: vi.fn(), hidden: false }
  })

  afterEach(() => {
    vi.useRealTimers()
    delete globalThis.window
    delete globalThis.document
  })

  describe('initialization', () => {
    it('should initialize with empty pending changes', () => {
      store = useSyncStore()
      expect(store.pendingChanges.size).toBe(0)
      expect(store.isSyncing).toBe(false)
    })

    it('should set up event listeners when window is available', () => {
      store = useSyncStore()
      expect(window.addEventListener).toHaveBeenCalledWith('blur', expect.any(Function))
      expect(document.addEventListener).toHaveBeenCalledWith(
        'visibilitychange',
        expect.any(Function)
      )
      expect(window.setInterval).toHaveBeenCalledWith(expect.any(Function), 10000)
    })
  })

  describe('trackChange', () => {
    beforeEach(() => {
      store = useSyncStore()
    })

    it('should track a change with valid parameters', () => {
      const data = { id: 'story_123', title: 'Test Story' }
      store.trackChange('stories', 'story_123', data)

      expect(store.pendingChanges.size).toBe(1)
      expect(store.pendingChanges.has('stories:story_123')).toBe(true)

      const change = store.pendingChanges.get('stories:story_123')
      expect(change).toMatchObject({
        entityType: 'stories',
        id: 'story_123',
        data: data,
      })
      expect(typeof change.timestamp).toBe('number')
    })

    it('should overwrite existing change for same entity', () => {
      const data1 = { id: 'story_123', title: 'First Version' }
      const data2 = { id: 'story_123', title: 'Second Version' }

      store.trackChange('stories', 'story_123', data1)
      store.trackChange('stories', 'story_123', data2)

      expect(store.pendingChanges.size).toBe(1)
      const change = store.pendingChanges.get('stories:story_123')
      expect(change.data.title).toBe('Second Version')
    })

    it('should handle missing entityType', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      store.trackChange('', 'id_123', { data: 'test' })

      expect(consoleSpy).toHaveBeenCalledWith(
        'Invalid trackChange call: missing entityType or id',
        { entityType: '', id: 'id_123' }
      )
      expect(store.pendingChanges.size).toBe(0)

      consoleSpy.mockRestore()
    })

    it('should handle missing id', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      store.trackChange('stories', '', { data: 'test' })

      expect(consoleSpy).toHaveBeenCalledWith(
        'Invalid trackChange call: missing entityType or id',
        { entityType: 'stories', id: '' }
      )
      expect(store.pendingChanges.size).toBe(0)

      consoleSpy.mockRestore()
    })

    it('should handle missing data', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      store.trackChange('stories', 'id_123', null)

      expect(consoleSpy).toHaveBeenCalledWith('Invalid trackChange call: missing data', {
        entityType: 'stories',
        id: 'id_123',
      })
      expect(store.pendingChanges.size).toBe(0)

      consoleSpy.mockRestore()
    })

    it('should debounce sync calls', async () => {
      store.trackChange('stories', 'story_1', { title: 'Story 1' })
      store.trackChange('stories', 'story_2', { title: 'Story 2' })
      store.trackChange('stories', 'story_3', { title: 'Story 3' })

      // Should have 3 pending changes
      expect(store.pendingChanges.size).toBe(3)

      // Advance timers by less than debounce time
      vi.advanceTimersByTime(400)
      expect(store.pendingChanges.size).toBe(3) // Still pending

      // Advance past debounce time
      const { default: db } = await import('../../src/stores/db')
      db.transaction.mockImplementation(async (mode, tables, fn) => {
        await fn()
      })

      vi.advanceTimersByTime(200)
      await vi.runAllTimersAsync()

      // Changes should be processed
      expect(store.pendingChanges.size).toBe(0)
    })
  })

  describe('trackDelete', () => {
    beforeEach(async () => {
      store = useSyncStore()
      const { default: db } = await import('../../src/stores/db')
      db.transaction.mockImplementation(async (mode, tables, fn) => {
        await fn()
      })
    })

    it('queues a delete that sync removes from the table', async () => {
      const { default: db } = await import('../../src/stores/db')

      store.trackDelete('stories', 'story_1')

      expect(store.pendingChanges.get('stories:story_1')).toMatchObject({
        entityType: 'stories',
        id: 'story_1',
        op: 'delete',
        data: null,
      })

      await store.processSync()

      expect(db.stories.delete).toHaveBeenCalledWith('story_1')
      expect(db.stories.put).not.toHaveBeenCalled()
      expect(store.pendingChanges.size).toBe(0)
    })

    it('drops an edit queued before the delete, so the row is not put back', async () => {
      const { default: db } = await import('../../src/stores/db')

      store.trackChange('stories', 'story_1', { id: 'story_1', title: 'Edited' })
      store.trackDelete('stories', 'story_1')

      expect(store.pendingChanges.size).toBe(1)

      await store.processSync()

      expect(db.stories.delete).toHaveBeenCalledWith('story_1')
      expect(db.stories.put).not.toHaveBeenCalled()
    })

    it('lets a write queued after the delete win, as a restore', async () => {
      const { default: db } = await import('../../src/stores/db')

      store.trackDelete('stories', 'story_1')
      store.trackChange('stories', 'story_1', { id: 'story_1', title: 'Back', version: 1 })

      expect(store.pendingChanges.size).toBe(1)

      await store.processSync()

      expect(db.stories.put).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'story_1', title: 'Back', version: 2 })
      )
      expect(db.stories.delete).not.toHaveBeenCalled()
    })

    it('deletes and puts other rows in the same transaction', async () => {
      const { default: db } = await import('../../src/stores/db')

      store.trackDelete('stories', 'story_1')
      store.trackChange('stories', 'story_2', { id: 'story_2', version: 0 })

      await store.processSync()

      expect(db.transaction).toHaveBeenCalledTimes(1)
      expect(db.stories.delete).toHaveBeenCalledWith('story_1')
      expect(db.stories.put).toHaveBeenCalledWith(expect.objectContaining({ id: 'story_2' }))
    })

    it('refuses a delete with no id', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      store.trackDelete('stories', '')

      expect(consoleSpy).toHaveBeenCalledWith(
        'Invalid trackDelete call: missing entityType or id',
        { entityType: 'stories', id: '' }
      )
      expect(store.pendingChanges.size).toBe(0)

      consoleSpy.mockRestore()
    })
  })

  describe('processSync', () => {
    beforeEach(async () => {
      store = useSyncStore()
      const { default: db } = await import('../../src/stores/db')
      db.transaction.mockImplementation(async (mode, tables, fn) => {
        await fn()
      })
    })

    it('should process pending changes successfully', async () => {
      const { default: db } = await import('../../src/stores/db')

      store.trackChange('stories', 'story_1', { id: 'story_1', title: 'Story 1', version: 1 })
      store.trackChange('parts', 'part_1', { id: 'part_1', title: 'Part 1', version: 2 })

      await store.processSync()

      expect(db.transaction).toHaveBeenCalledTimes(2)
      expect(db.stories.put).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'story_1',
          title: 'Story 1',
          version: 2, // Incremented
        })
      )
      expect(db.parts.put).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'part_1',
          title: 'Part 1',
          version: 3, // Incremented
        })
      )
      expect(store.pendingChanges.size).toBe(0)
    })

    it('should skip if already syncing', async () => {
      const { default: db } = await import('../../src/stores/db')

      store.isSyncing = true
      store.trackChange('stories', 'story_1', { title: 'Story 1' })

      await store.processSync()

      expect(db.transaction).not.toHaveBeenCalled()
      expect(store.pendingChanges.size).toBe(1) // Still pending
    })

    it('should skip if no pending changes', async () => {
      const { default: db } = await import('../../src/stores/db')

      await store.processSync()

      expect(db.transaction).not.toHaveBeenCalled()
    })

    it('should handle database errors and re-queue changes', async () => {
      const { default: db } = await import('../../src/stores/db')
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      db.transaction.mockRejectedValueOnce(new Error('Database error'))

      store.trackChange('stories', 'story_1', { title: 'Story 1' })

      await store.processSync()

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to persist stories'),
        expect.any(Error)
      )
      expect(store.pendingChanges.size).toBe(1) // Re-queued

      consoleSpy.mockRestore()
    })

    it('should handle non-existent table gracefully', async () => {
      const { default: db } = await import('../../src/stores/db')
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      // Remove the table from mock
      delete db.nonExistentTable

      store.trackChange('nonExistentTable', 'id_1', { data: 'test' })

      await store.processSync()

      expect(consoleSpy).toHaveBeenCalledWith(
        "Table 'nonExistentTable' not found in database - discarding 1 changes"
      )
      expect(store.pendingChanges.size).toBe(0) // Not re-queued

      consoleSpy.mockRestore()
    })

    it('should group changes by entity type', async () => {
      const { default: db } = await import('../../src/stores/db')

      store.trackChange('stories', 'story_1', { id: 'story_1', version: 0 })
      store.trackChange('stories', 'story_2', { id: 'story_2', version: 0 })
      store.trackChange('parts', 'part_1', { id: 'part_1', version: 0 })

      await store.processSync()

      // Should have 2 transactions: one for stories, one for parts
      expect(db.transaction).toHaveBeenCalledTimes(2)
      expect(db.stories.put).toHaveBeenCalledTimes(2)
      expect(db.parts.put).toHaveBeenCalledTimes(1)
    })

    it('should handle missing database table gracefully', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      // Remove the stories table
      const { default: db } = await import('../../src/stores/db')
      delete db.stories

      store.trackChange('stories', 'story_1', { title: 'Story 1' })

      await store.processSync()

      expect(consoleSpy).toHaveBeenCalledWith(
        "Table 'stories' not found in database - discarding 1 changes"
      )
      expect(store.pendingChanges.size).toBe(0) // Not re-queued

      // Restore stories table
      db.stories = { put: vi.fn() }
      consoleSpy.mockRestore()
    })

    it('should set isSyncing flag correctly', async () => {
      const { default: db } = await import('../../src/stores/db')
      db.transaction.mockImplementation(async (mode, tables, fn) => {
        await fn()
      })

      store.trackChange('stories', 'story_1', { id: 'story_1', version: 0 })

      expect(store.isSyncing).toBe(false)

      const syncPromise = store.processSync()
      expect(store.isSyncing).toBe(true)

      await syncPromise
      expect(store.isSyncing).toBe(false)
    })

    it('should retry on failure', async () => {
      const { default: db } = await import('../../src/stores/db')
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      db.transaction.mockRejectedValueOnce(new Error('Database error'))

      store.trackChange('stories', 'story_1', { title: 'Story 1' })

      await store.processSync()

      // Should have re-queued the change
      expect(store.pendingChanges.size).toBe(1)

      // Should schedule retry - advance timer
      db.transaction.mockImplementation(async (mode, tables, fn) => {
        await fn()
      })

      vi.advanceTimersByTime(500)
      await vi.runAllTimersAsync()

      // After retry, should be cleared
      expect(store.pendingChanges.size).toBe(0)

      consoleSpy.mockRestore()
    })
  })

  describe('event handlers', () => {
    beforeEach(() => {
      store = useSyncStore()
    })

    it('should sync on window blur if changes pending', async () => {
      const { default: db } = await import('../../src/stores/db')
      db.transaction.mockImplementation(async (mode, tables, fn) => {
        await fn()
      })

      store.trackChange('stories', 'story_1', { title: 'Story 1' })
      expect(store.pendingChanges.size).toBe(1)

      // Get the blur handler that was registered
      const blurHandler = window.addEventListener.mock.calls.find(call => call[0] === 'blur')[1]

      await blurHandler()

      // Changes should be processed
      expect(store.pendingChanges.size).toBe(0)
    })

    it('should not sync on window blur if no changes pending', async () => {
      const { default: db } = await import('../../src/stores/db')
      const putSpy = vi.fn()
      db.stories = { put: putSpy }

      // Get the blur handler that was registered
      const blurHandler = window.addEventListener.mock.calls.find(call => call[0] === 'blur')[1]

      await blurHandler()

      // No database operations should occur
      expect(putSpy).not.toHaveBeenCalled()
    })

    it('should sync on visibility change when hidden if changes pending', async () => {
      const { default: db } = await import('../../src/stores/db')
      db.transaction.mockImplementation(async (mode, tables, fn) => {
        await fn()
      })

      store.trackChange('stories', 'story_1', { title: 'Story 1' })
      expect(store.pendingChanges.size).toBe(1)

      // Get the visibility change handler
      const visibilityHandler = document.addEventListener.mock.calls.find(
        call => call[0] === 'visibilitychange'
      )[1]

      document.hidden = true
      await visibilityHandler()

      // Changes should be processed
      expect(store.pendingChanges.size).toBe(0)
    })

    it('should not sync on visibility change when visible', async () => {
      store.trackChange('stories', 'story_1', { title: 'Story 1' })
      expect(store.pendingChanges.size).toBe(1)

      // Get the visibility change handler
      const visibilityHandler = document.addEventListener.mock.calls.find(
        call => call[0] === 'visibilitychange'
      )[1]

      document.hidden = false
      await visibilityHandler()

      // Changes should still be pending
      expect(store.pendingChanges.size).toBe(1)
    })
  })

  describe('edge cases', () => {
    beforeEach(() => {
      store = useSyncStore()
    })

    it('should handle deeply nested reactive data', async () => {
      const { default: db } = await import('../../src/stores/db')
      db.transaction.mockImplementation(async (mode, tables, fn) => {
        await fn()
      })

      const complexData = {
        id: 'story_1',
        nested: {
          deep: {
            array: [1, 2, { key: 'value' }],
          },
        },
        version: 0,
      }

      store.trackChange('stories', 'story_1', complexData)
      await store.processSync()

      expect(db.stories.put).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'story_1',
          nested: {
            deep: {
              array: [1, 2, { key: 'value' }],
            },
          },
          version: 1,
        })
      )
    })

    it('should handle rapid successive changes', async () => {
      const { default: db } = await import('../../src/stores/db')
      db.transaction.mockImplementation(async (mode, tables, fn) => {
        await fn()
      })

      // Rapidly add changes
      for (let i = 0; i < 10; i++) {
        store.trackChange('stories', `story_${i}`, { title: `Story ${i}` })
      }

      // Should have all changes pending
      expect(store.pendingChanges.size).toBe(10)

      // Advance past debounce
      vi.advanceTimersByTime(500)
      await vi.runAllTimersAsync()

      // All changes should be processed
      expect(store.pendingChanges.size).toBe(0)
      expect(db.stories.put).toHaveBeenCalledTimes(10)
    })
  })
})
