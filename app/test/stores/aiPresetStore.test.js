import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useAIPresetStore } from '../../src/stores/aiPresetStore'

// Mock the database module
vi.mock('../../src/stores/db', () => ({
  default: {
    aiProfiles: {
      toArray: vi.fn(),
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

// Mock nanoid
import { nanoid } from 'nanoid'
vi.mock('nanoid', () => ({
  nanoid: vi.fn(() => 'test-id-123'),
}))

describe('AIPresetStore', () => {
  /** @type {import('../../src/stores/aiPresetStore').useAIPresetStore} */
  let store

  beforeEach(() => {
    // Create a fresh Pinia instance before each test
    setActivePinia(createPinia())
    // Reset mocks
    vi.clearAllMocks()
  })

  describe('initialization', () => {
    it('should load presets from database on initialization', async () => {
      const mockProfiles = [
        {
          id: 'profile_1',
          name: 'Preset 1',
          providerId: 'provider_1',
          model: 'gpt-4',
          completionType: 'chat',
        },
        {
          id: 'profile_2',
          name: 'Preset 2',
        },
      ]

      const { default: db } = await import('../../src/stores/db')
      db.aiProfiles.toArray.mockResolvedValue(mockProfiles)

      store = useAIPresetStore()
      await store.ensureInitialized()

      expect(store.presets.size).toBe(2)
      expect(store.presets.has('profile_1')).toBe(true)
      expect(store.presets.has('profile_2')).toBe(true)
    })

    it('should handle database errors gracefully', async () => {
      const { default: db } = await import('../../src/stores/db')
      db.aiProfiles.toArray.mockRejectedValue(new Error('Database error'))

      store = useAIPresetStore()
      await store.ensureInitialized()

      expect(store.presets.size).toBe(0)
      expect(store.isInitialized).toBe(true)
    })

    it('should only initialize once', async () => {
      const { default: db } = await import('../../src/stores/db')
      db.aiProfiles.toArray.mockResolvedValue([])

      store = useAIPresetStore()
      await store.ensureInitialized()
      await store.ensureInitialized()
      await store.ensureInitialized()

      // Should only call database once
      expect(db.aiProfiles.toArray).toHaveBeenCalledTimes(1)
    })
  })

  describe('createPreset', () => {
    beforeEach(async () => {
      const { default: db } = await import('../../src/stores/db')
      db.aiProfiles.toArray.mockResolvedValue([])
      store = useAIPresetStore()
      await store.ensureInitialized()
    })

    it('should create a new preset with required fields', () => {
      const preset = store.createPreset({
        name: 'My Preset',
        providerId: 'provider_123',
        model: 'gpt-4',
      })

      expect(preset).toMatchObject({
        id: 'profile_test-id-123',
        name: 'My Preset',
        providerId: 'provider_123',
        model: 'gpt-4',
        isDefault: false,
        version: 1,
      })
      expect(typeof preset.created).toBe('number')
      expect(typeof preset.updated).toBe('number')
      expect(store.presets.has(preset.id)).toBe(true)
    })

    it('should enable tool use by default', () => {
      const preset = store.createPreset({
        name: 'My Preset',
        providerId: 'provider_123',
        model: 'gpt-4',
      })

      expect(preset.toolsEnabled).toBe(true)
    })

    it('should allow tool use to be disabled at creation', () => {
      const preset = store.createPreset({
        name: 'My Preset',
        providerId: 'provider_123',
        model: 'gpt-4',
        toolsEnabled: false,
      })

      expect(preset.toolsEnabled).toBe(false)
    })

    it('should start with no generation overrides', () => {
      const preset = store.createPreset({
        name: 'My Preset',
        providerId: 'provider_123',
        model: 'gpt-4',
      })

      // Sparse by design: untouched settings keep tracking AI_DEFAULTS.
      expect(preset.generationOverrides).toEqual({})
    })

    it('should keep generation overrides passed at creation', () => {
      const generationOverrides = { maxTokens: 512, parameters: { temperature: 0.2 } }
      const preset = store.createPreset({
        name: 'My Preset',
        providerId: 'provider_123',
        model: 'gpt-4',
        generationOverrides,
      })

      expect(preset.generationOverrides).toEqual(generationOverrides)
    })

    it('should allow custom ID for default presets', () => {
      const preset = store.createPreset({
        id: 'profile_default_1',
        name: 'Default Preset',
        providerId: 'provider_123',
        model: 'gpt-4',
        isDefault: true,
      })

      expect(preset.id).toBe('profile_default_1')
      expect(preset.isDefault).toBe(true)
    })
  })

  describe('updatePreset', () => {
    beforeEach(async () => {
      const existingProfile = {
        id: 'profile_1',
        name: 'Original',
        providerId: 'provider_1',
        model: 'gpt-4',
        completionType: 'chat',
        useStreaming: true,
        isDefault: false,
        version: 1,
        created: Date.now() - 1000,
        updated: Date.now() - 1000,
      }

      const { default: db } = await import('../../src/stores/db')
      db.aiProfiles.toArray.mockResolvedValue([existingProfile])

      store = useAIPresetStore()
      await store.ensureInitialized()
    })

    it('should update an existing preset', () => {
      const updated = store.updatePreset('profile_1', {
        name: 'Updated',
        model: 'claude-3',
        maxTokens: 1500,
      })

      expect(updated).toBeTruthy()
      expect(updated.name).toBe('Updated')
      expect(updated.model).toBe('claude-3')
      expect(updated.maxTokens).toBe(1500)
      expect(updated.providerId).toBe('provider_1') // Preserved
    })

    it('should preserve system fields during update', () => {
      const original = store.presets.get('profile_1')
      const updated = store.updatePreset('profile_1', {
        id: 'different_id',
        isDefault: true,
        created: 999,
      })

      expect(updated.id).toBe(original.id)
      expect(updated.isDefault).toBe(original.isDefault)
      expect(updated.created).toBe(original.created)
      expect(updated.updated).toBeGreaterThan(original.updated)
    })

    it('should return null when updating non-existent preset', () => {
      const result = store.updatePreset('non_existent', { name: 'New' })

      expect(result).toBeNull()
    })
  })

  describe('deletePreset', () => {
    beforeEach(async () => {
      const presets = [
        {
          id: 'profile_user',
          name: 'User Preset',
          isDefault: false,
        },
        {
          id: 'profile_default',
          name: 'Default Preset',
          isDefault: true,
        },
      ]

      const { default: db } = await import('../../src/stores/db')
      db.aiProfiles.toArray.mockResolvedValue(presets)

      store = useAIPresetStore()
      await store.ensureInitialized()
    })

    it('should delete a user preset', () => {
      const result = store.deletePreset('profile_user')

      expect(result).toBe(true)
      expect(store.presets.has('profile_user')).toBe(false) // Removed from cache
      expect(store.getPreset('profile_user')).toBeNull()
      expect(trackDelete).toHaveBeenCalledWith('aiProfiles', 'profile_user')
    })

    it('should return false when deleting non-existent preset', () => {
      const result = store.deletePreset('non_existent')

      expect(result).toBe(false)
    })

    it('should throw error when deleting default preset', () => {
      expect(() => store.deletePreset('profile_default')).toThrow(
        "Cannot delete the default preset 'Default Preset'"
      )
    })
  })

  describe('getPreset', () => {
    beforeEach(async () => {
      const mockProfiles = [
        {
          id: 'profile_1',
          name: 'Preset 1',
        },
        {
          id: 'profile_2',
          name: 'Preset 2',
        },
      ]

      const { default: db } = await import('../../src/stores/db')
      db.aiProfiles.toArray.mockResolvedValue(mockProfiles)

      store = useAIPresetStore()
      await store.ensureInitialized()
    })

    it('should return preset if found', () => {
      const preset = store.getPreset('profile_1')

      expect(preset).toBeDefined()
      expect(preset.name).toBe('Preset 1')
    })

    it('should return null for a deleted preset', () => {
      store.deletePreset('profile_2')

      const preset = store.getPreset('profile_2')

      expect(preset).toBeNull()
    })

    it('should return null for non-existent preset', () => {
      const preset = store.getPreset('non_existent')

      expect(preset).toBeNull()
    })
  })

  describe('getAllPresets', () => {
    beforeEach(async () => {
      const mockProfiles = [
        {
          id: 'profile_1',
          name: 'Preset 1',
        },
        {
          id: 'profile_2',
          name: 'Preset 2',
        },
        {
          id: 'profile_3',
          name: 'Preset 3',
        },
      ]

      const { default: db } = await import('../../src/stores/db')
      db.aiProfiles.toArray.mockResolvedValue(mockProfiles)

      store = useAIPresetStore()
      await store.ensureInitialized()
    })

    it('should return all presets', () => {
      const allProfiles = store.getAllPresets()

      expect(allProfiles).toHaveLength(3)
      expect(allProfiles.find(p => p.id === 'profile_1')).toBeDefined()
      expect(allProfiles.find(p => p.id === 'profile_2')).toBeDefined()
      expect(allProfiles.find(p => p.id === 'profile_3')).toBeDefined()
    })

    it('should exclude deleted presets', () => {
      store.deletePreset('profile_3')

      const allProfiles = store.getAllPresets()

      expect(allProfiles).toHaveLength(2)
      expect(allProfiles.find(p => p.id === 'profile_3')).toBeUndefined()
    })
  })

  describe('getAllPresetsOrdered', () => {
    beforeEach(async () => {
      const mockProfiles = [
        {
          id: 'profile_z',
          name: 'Zebra',
          isDefault: false,
        },
        {
          id: 'profile_a',
          name: 'Alpha',
          isDefault: false,
        },
        {
          id: 'profile_b',
          name: 'Beta',
          isDefault: false,
        },
        {
          id: 'profile_default',
          name: 'Default',
          isDefault: true,
        },
      ]

      const { default: db } = await import('../../src/stores/db')
      db.aiProfiles.toArray.mockResolvedValue(mockProfiles)

      store = useAIPresetStore()
      await store.ensureInitialized()
    })

    it('should order by default status, then name', () => {
      const ordered = store.getAllPresetsOrdered()

      expect(ordered).toHaveLength(4)
      expect(ordered[0].id).toBe('profile_default') // Default first
      expect(ordered[1].id).toBe('profile_a') // Then alphabetical
      expect(ordered[2].id).toBe('profile_b')
      expect(ordered[3].id).toBe('profile_z')
    })

    it('should exclude deleted presets from ordering', () => {
      store.deletePreset('profile_a')

      const ordered = store.getAllPresetsOrdered()

      expect(ordered).toHaveLength(3)
      expect(ordered.find(p => p.id === 'profile_a')).toBeUndefined()
    })
  })

  describe('edge cases', () => {
    beforeEach(async () => {
      const { default: db } = await import('../../src/stores/db')
      db.aiProfiles.toArray.mockResolvedValue([])
      store = useAIPresetStore()
      await store.ensureInitialized()
    })

    it('should handle concurrent updates correctly', () => {
      store.createPreset({
        name: 'Test',
        providerId: 'provider_1',
        model: 'gpt-4',
        completionType: 'chat',
      })

      const update1 = store.updatePreset('profile_test-id-123', { name: 'Update 1' })
      const update2 = store.updatePreset('profile_test-id-123', { name: 'Update 2' })

      expect(update1.name).toBe('Update 1')
      expect(update2.name).toBe('Update 2')
      expect(store.presets.get('profile_test-id-123').name).toBe('Update 2')
    })

    it('should handle presets with same name', () => {
      store.createPreset({
        name: 'Duplicate',
        providerId: 'provider_1',
        model: 'gpt-4',
      })

      vi.mocked(nanoid).mockReturnValueOnce('test-id-456')
      const profile2 = store.createPreset({
        name: 'Duplicate',
        providerId: 'provider_2',
        model: 'claude-3',
      })

      expect(profile2.id).toBe('profile_test-id-456')
      expect(store.presets.size).toBe(2)
    })
  })
})
