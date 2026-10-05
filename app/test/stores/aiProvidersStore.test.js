import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useAIProvidersStore } from '../../src/stores/aiProvidersStore'

// Mock the database module
vi.mock('../../src/stores/db', () => ({
  default: {
    aiProviders: {
      toArray: vi.fn(),
      add: vi.fn(),
      update: vi.fn(),
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

describe('AIProvidersStore', () => {
  /** @type {import('../../src/stores/aiProvidersStore').useAIProvidersStore} */
  let store

  beforeEach(() => {
    // Create a fresh Pinia instance before each test
    setActivePinia(createPinia())
    // Reset mock
    vi.clearAllMocks()
  })

  describe('initialization', () => {
    it('should initialize with an empty providers map', async () => {
      const { default: db } = await import('../../src/stores/db')
      db.aiProviders.toArray.mockResolvedValue([])

      store = useAIProvidersStore()
      await store.ensureInitialized()

      expect(store.providers.size).toBe(0)
      expect(store.isInitialized).toBe(true)
    })

    it('should load providers from database on initialization', async () => {
      const mockProviders = [
        { id: 'provider_1', name: 'Provider 1' },
        { id: 'provider_2', name: 'Provider 2' },
        { id: 'provider_3', name: 'Provider 3' },
      ]

      const { default: db } = await import('../../src/stores/db')
      db.aiProviders.toArray.mockResolvedValue(mockProviders)

      store = useAIProvidersStore()
      await store.ensureInitialized()

      expect(store.providers.size).toBe(3)
      expect(store.providers.has('provider_1')).toBe(true)
      expect(store.providers.has('provider_2')).toBe(true)
      expect(store.providers.has('provider_3')).toBe(true)
    })

    it('should handle database errors gracefully', async () => {
      const { default: db } = await import('../../src/stores/db')
      db.aiProviders.toArray.mockRejectedValue(new Error('Database error'))

      store = useAIProvidersStore()
      await store.ensureInitialized()

      expect(store.providers.size).toBe(0)
      expect(store.isInitialized).toBe(true)
    })

    it('should only initialize once', async () => {
      const { default: db } = await import('../../src/stores/db')
      db.aiProviders.toArray.mockResolvedValue([])

      store = useAIProvidersStore()
      await store.ensureInitialized()

      // Clear the mock call count after first init
      db.aiProviders.toArray.mockClear()

      // Try to initialize again
      await store.ensureInitialized()

      // Should not call database again
      expect(db.aiProviders.toArray).not.toHaveBeenCalled()
      expect(store.isInitialized).toBe(true)
    })
  })

  describe('createProvider', () => {
    beforeEach(async () => {
      const { default: db } = await import('../../src/stores/db')
      db.aiProviders.toArray.mockResolvedValue([])
      store = useAIProvidersStore()
      await store.ensureInitialized()
    })

    it('should create a new generic provider', () => {
      const provider = store.createProvider({
        name: 'My Local LLM',
        type: 'generic',
        endpoint: 'http://localhost:1234/v1',
        apiKey: 'sk-test-key',
      })

      expect(provider).toMatchObject({
        id: 'provider_test-id-123',
        name: 'My Local LLM',
        type: 'generic',
        endpoint: 'http://localhost:1234/v1',
        apiKey: 'sk-test-key',
        isDefault: false,
        version: 1,
      })
      expect(typeof provider.created).toBe('number')
      expect(typeof provider.updated).toBe('number')
      expect(store.providers.has(provider.id)).toBe(true)
    })

    it('should create an OpenRouter provider', () => {
      const provider = store.createProvider({
        name: 'OpenRouter',
        type: 'openrouter',
        apiKey: 'sk-openrouter-key',
      })

      expect(provider.type).toBe('openrouter')
      expect(provider.endpoint).toBeUndefined()
    })

    it('should allow custom ID for default providers', () => {
      const provider = store.createProvider({
        id: 'provider_default',
        name: 'Default Provider',
        type: 'openrouter',
        isDefault: true,
      })

      expect(provider.id).toBe('provider_default')
      expect(provider.isDefault).toBe(true)
    })

    it('should handle missing optional fields', () => {
      const provider = store.createProvider({
        name: 'Basic Provider',
        type: 'generic',
      })

      expect(provider.endpoint).toBeUndefined()
      expect(provider.apiKey).toBeUndefined()
      expect(provider.isDefault).toBe(false)
    })
  })

  describe('updateProvider', () => {
    beforeEach(async () => {
      const { default: db } = await import('../../src/stores/db')
      db.aiProviders.toArray.mockResolvedValue([])
      store = useAIProvidersStore()
      await store.ensureInitialized()
      store.createProvider({
        name: 'Test Provider',
        type: 'generic',
        endpoint: 'http://localhost:1234',
      })
    })

    it('should update an existing provider', () => {
      const updated = store.updateProvider('provider_test-id-123', {
        name: 'Updated Provider',
        apiKey: 'new-key',
      })

      expect(updated.name).toBe('Updated Provider')
      expect(updated.apiKey).toBe('new-key')
      expect(updated.endpoint).toBe('http://localhost:1234') // Unchanged
      expect(updated.version).toBe(1) // Not incremented in this store
    })

    it('should preserve system fields during update', () => {
      const original = store.providers.get('provider_test-id-123')
      const updated = store.updateProvider('provider_test-id-123', {
        id: 'different_id',
        isDefault: true,
        created: 999,
      })

      expect(updated.id).toBe(original.id)
      expect(updated.isDefault).toBe(original.isDefault)
      expect(updated.created).toBe(original.created)
    })

    it('should return null when updating non-existent provider', () => {
      const updated = store.updateProvider('non_existent', { name: 'New' })

      expect(updated).toBeNull()
    })
  })

  describe('deleteProvider', () => {
    beforeEach(async () => {
      const { default: db } = await import('../../src/stores/db')
      db.aiProviders.toArray.mockResolvedValue([])
      store = useAIProvidersStore()
      await store.ensureInitialized()
    })

    it('should delete a provider', () => {
      store.createProvider({
        name: 'Test Provider',
        type: 'generic',
      })

      const result = store.deleteProvider('provider_test-id-123')

      expect(result).toBe(true)
      expect(store.providers.has('provider_test-id-123')).toBe(false) // Removed from cache
      expect(store.getProvider('provider_test-id-123')).toBeNull()
      expect(trackDelete).toHaveBeenCalledWith('aiProviders', 'provider_test-id-123')
    })

    it('should throw error when deleting non-existent provider', () => {
      expect(() => store.deleteProvider('non_existent')).toThrow(
        "Failed to delete provider, 'non_existent' not found"
      )
    })

    it('should throw error when trying to delete default provider', () => {
      store.createProvider({
        id: 'provider_default',
        name: 'Default Provider',
        type: 'openrouter',
        isDefault: true,
      })

      expect(() => store.deleteProvider('provider_default')).toThrow(
        "Cannot delete default provider 'provider_default'"
      )
    })
  })

  describe('getProvider', () => {
    beforeEach(async () => {
      const { default: db } = await import('../../src/stores/db')
      db.aiProviders.toArray.mockResolvedValue([])
      store = useAIProvidersStore()
      await store.ensureInitialized()
      store.createProvider({
        name: 'Test Provider',
        type: 'generic',
      })
    })

    it('should return provider if found', () => {
      const provider = store.getProvider('provider_test-id-123')

      expect(provider).toBeDefined()
      expect(provider.name).toBe('Test Provider')
    })

    it('should return null for deleted providers', () => {
      store.deleteProvider('provider_test-id-123')

      const provider = store.getProvider('provider_test-id-123')

      expect(provider).toBeNull()
    })

    it('should return null for non-existent provider', () => {
      const provider = store.getProvider('non_existent')

      expect(provider).toBeNull()
    })
  })

  describe('getAllProviders', () => {
    beforeEach(async () => {
      const { default: db } = await import('../../src/stores/db')
      db.aiProviders.toArray.mockResolvedValue([])
      store = useAIProvidersStore()
      await store.ensureInitialized()

      store.createProvider({ name: 'Provider 1', type: 'generic' })
      vi.mocked(nanoid).mockReturnValueOnce('test-id-456')
      store.createProvider({ name: 'Provider 2', type: 'openrouter' })
      vi.mocked(nanoid).mockReturnValueOnce('test-id-789')
      store.createProvider({ name: 'Provider 3', type: 'generic' })
    })

    it('should return all providers', () => {
      const providers = store.getAllProviders()

      expect(providers).toHaveLength(3)
      expect(providers[0].name).toBe('Provider 1')
      expect(providers[1].name).toBe('Provider 2')
      expect(providers[2].name).toBe('Provider 3')
    })

    it('should exclude deleted providers', () => {
      store.deleteProvider('provider_test-id-123')

      const providers = store.getAllProviders()

      expect(providers).toHaveLength(2)
      expect(providers.find(p => p.name === 'Provider 1')).toBeUndefined()
    })
  })

  describe('getAllProvidersOrdered', () => {
    beforeEach(async () => {
      const { default: db } = await import('../../src/stores/db')
      db.aiProviders.toArray.mockResolvedValue([])
      store = useAIProvidersStore()
      await store.ensureInitialized()
    })

    it('should order providers by updated date descending', async () => {
      const now = Date.now()

      store.createProvider({ name: 'Old Provider', type: 'generic' })
      store.providers.get('provider_test-id-123').updated = now - 1000

      vi.mocked(nanoid).mockReturnValueOnce('test-id-456')
      store.createProvider({ name: 'New Provider', type: 'generic' })
      store.providers.get('provider_test-id-456').updated = now

      const providers = store.getAllProvidersOrdered()

      expect(providers[0].name).toBe('New Provider')
      expect(providers[1].name).toBe('Old Provider')
    })

    it('should order by name alphabetically when updated dates are equal', () => {
      const now = Date.now()

      store.createProvider({ name: 'Charlie', type: 'generic' })
      vi.mocked(nanoid).mockReturnValueOnce('test-id-456')
      store.createProvider({ name: 'Alice', type: 'generic' })
      vi.mocked(nanoid).mockReturnValueOnce('test-id-789')
      store.createProvider({ name: 'Bob', type: 'generic' })

      // Set all to same update time
      store.providers.forEach(p => (p.updated = now))

      const providers = store.getAllProvidersOrdered()

      expect(providers[0].name).toBe('Alice')
      expect(providers[1].name).toBe('Bob')
      expect(providers[2].name).toBe('Charlie')
    })

    it('should exclude deleted providers from ordered list', () => {
      store.createProvider({ name: 'Provider 1', type: 'generic' })
      vi.mocked(nanoid).mockReturnValueOnce('test-id-456')
      store.createProvider({ name: 'Provider 2', type: 'generic' })

      store.deleteProvider('provider_test-id-123')

      const providers = store.getAllProvidersOrdered()

      expect(providers).toHaveLength(1)
      expect(providers[0].name).toBe('Provider 2')
    })
  })

  describe('edge cases', () => {
    beforeEach(async () => {
      const { default: db } = await import('../../src/stores/db')
      db.aiProviders.toArray.mockResolvedValue([])
      store = useAIProvidersStore()
      await store.ensureInitialized()
    })

    it('should handle providers with same name', () => {
      store.createProvider({ name: 'Duplicate', type: 'generic' })
      vi.mocked(nanoid).mockReturnValueOnce('test-id-456')
      store.createProvider({ name: 'Duplicate', type: 'openrouter' })

      const providers = store.getAllProviders()

      expect(providers).toHaveLength(2)
      expect(providers[0].id).not.toBe(providers[1].id)
    })

    it('should handle empty endpoint and apiKey', () => {
      const provider = store.createProvider({
        name: 'Minimal',
        type: 'generic',
        endpoint: '',
        apiKey: '',
      })

      expect(provider.endpoint).toBe('')
      expect(provider.apiKey).toBe('')
    })

    it('should handle concurrent updates correctly', () => {
      store.createProvider({ name: 'Test', type: 'generic' })

      const update1 = store.updateProvider('provider_test-id-123', { name: 'Update 1' })
      const update2 = store.updateProvider('provider_test-id-123', { name: 'Update 2' })

      expect(update1.name).toBe('Update 1')
      expect(update2.name).toBe('Update 2')
      expect(store.providers.get('provider_test-id-123').name).toBe('Update 2')
    })
  })
})
