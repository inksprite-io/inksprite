import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useAIPromptStore } from '../../src/stores/aiPromptStore'

// Mock the database module
vi.mock('../../src/stores/db', () => ({
  default: {
    aiPrompts: {
      toArray: vi.fn(),
    },
  },
}))

const trackChange = vi.fn()
const trackDelete = vi.fn()

// Mock the sync store
vi.mock('../../src/stores/syncStore.js', () => ({
  useSyncStore: () => ({
    trackChange: (...args) => trackChange(...args),
    trackDelete: (...args) => trackDelete(...args),
  }),
}))

// Mock nanoid
vi.mock('nanoid', () => ({
  nanoid: vi.fn(() => 'test-id-123'),
}))

describe('AIPromptStore', () => {
  /** @type {ReturnType<typeof useAIPromptStore>} */
  let store

  beforeEach(async () => {
    setActivePinia(createPinia())
    vi.clearAllMocks()

    const { default: db } = await import('../../src/stores/db')
    db.aiPrompts.toArray.mockResolvedValue([])
  })

  describe('initialization', () => {
    it('should load saved prompts from the database', async () => {
      const { default: db } = await import('../../src/stores/db')
      db.aiPrompts.toArray.mockResolvedValue([
        { id: 'prompt_1', name: 'Editor', content: 'Be terse.' },
        { id: 'prompt_2', name: 'Writer', content: 'Be vivid.' },
      ])

      store = useAIPromptStore()
      await store.ensureInitialized()

      expect(store.getAllPromptsOrdered()).toHaveLength(2)
      expect(store.getPrompt('prompt_1').name).toBe('Editor')
      expect(store.getPrompt('prompt_2').name).toBe('Writer')
    })

    it('should survive a database that fails to load', async () => {
      const { default: db } = await import('../../src/stores/db')
      db.aiPrompts.toArray.mockRejectedValue(new Error('nope'))

      store = useAIPromptStore()
      await store.ensureInitialized()

      expect(store.isInitialized).toBe(true)
      expect(store.getAllPromptsOrdered()).toEqual([])
    })
  })

  describe('createPrompt', () => {
    beforeEach(async () => {
      store = useAIPromptStore()
      await store.ensureInitialized()
    })

    it('should save a prompt and track the change', () => {
      const prompt = store.createPrompt({ name: 'Editor', content: 'Be terse.' })

      expect(prompt.id).toBe('prompt_test-id-123')
      expect(prompt.name).toBe('Editor')
      expect(prompt.content).toBe('Be terse.')
      expect(trackChange).toHaveBeenCalledWith('aiPrompts', prompt.id, prompt)
    })

    it('should default to empty content', () => {
      expect(store.createPrompt({ name: 'Blank' }).content).toBe('')
    })
  })

  describe('updatePrompt', () => {
    beforeEach(async () => {
      store = useAIPromptStore()
      await store.ensureInitialized()
    })

    it('should apply updates', () => {
      const prompt = store.createPrompt({ name: 'Editor', content: 'Be terse.' })

      const updated = store.updatePrompt(prompt.id, { content: 'Be very terse.' })

      expect(updated.content).toBe('Be very terse.')
      expect(updated.name).toBe('Editor')
      expect(store.getPrompt(prompt.id).content).toBe('Be very terse.')
    })

    it('should preserve identity fields', () => {
      const prompt = store.createPrompt({ name: 'Editor' })

      const updated = store.updatePrompt(prompt.id, { id: 'prompt_other', created: 0 })

      expect(updated.id).toBe(prompt.id)
      expect(updated.created).toBe(prompt.created)
    })

    it('should return null for a prompt that does not exist', () => {
      expect(store.updatePrompt('prompt_missing', { name: 'x' })).toBeNull()
    })
  })

  describe('deletePrompt', () => {
    beforeEach(async () => {
      store = useAIPromptStore()
      await store.ensureInitialized()
    })

    it('should delete the prompt and track the deletion', () => {
      const prompt = store.createPrompt({ name: 'Editor' })

      expect(store.deletePrompt(prompt.id)).toBe(true)
      expect(store.getPrompt(prompt.id)).toBeNull()
      expect(store.getAllPromptsOrdered()).toEqual([])
      // Dropped from the cache; the sync store carries the delete to the database.
      expect(store.prompts.has(prompt.id)).toBe(false)
      expect(trackDelete).toHaveBeenCalledWith('aiPrompts', prompt.id)
    })

    it('should return false for a prompt that does not exist', () => {
      expect(store.deletePrompt('prompt_missing')).toBe(false)
    })
  })

  describe('getAllPromptsOrdered', () => {
    it('should order by name', async () => {
      store = useAIPromptStore()
      await store.ensureInitialized()

      const { nanoid } = await import('nanoid')
      nanoid.mockReturnValueOnce('c').mockReturnValueOnce('a').mockReturnValueOnce('b')
      store.createPrompt({ name: 'Writer' })
      store.createPrompt({ name: 'Adventure' })
      store.createPrompt({ name: 'Editor' })

      expect(store.getAllPromptsOrdered().map(p => p.name)).toEqual([
        'Adventure',
        'Editor',
        'Writer',
      ])
    })
  })
})
