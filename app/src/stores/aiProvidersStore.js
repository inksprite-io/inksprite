/**
 * @module stores/aiProvidersStore
 * @description Store for managing AI provider configurations
 *
 * @example
 * // Create a new provider
 * const store = useAIProvidersStore()
 * const provider = await store.createProvider({
 *   name: 'My Local Endpoint',
 *   type: 'generic',
 *   endpoint: 'http://localhost:1234/v1',
 *   apiKey: 'sk-...'
 * })
 */

import { defineStore } from 'pinia'
import { ref, triggerRef } from 'vue'
import { nanoid } from 'nanoid'
import { useSyncStore } from './syncStore.js'
import { sessionStorage } from '@/utils/sessionStorage'
import db from './db'

/** @typedef {import('../types/models.js').AIProvider} AIProvider */

// Session storage key for API keys
const SESSION_API_KEYS_KEY = 'inksprite.session-api-keys'

/**
 * Generate unique IDs for AI providers
 * @returns {string} Provider ID in format provider_xxx
 */
function generateProviderId() {
  return `provider_${nanoid()}`
}

export const useAIProvidersStore = defineStore('aiProviders', () => {
  /**
   * @type {import('vue').Ref<Map<string, AIProvider>>}
   */
  const providers = ref(new Map())

  // Get sync store instance
  const syncStore = useSyncStore()

  /**
   * Get session API keys from sessionStorage
   * @returns {Object<string, string>} Map of provider IDs to API keys
   */
  function getSessionApiKeys() {
    return sessionStorage.get(SESSION_API_KEYS_KEY, {})
  }

  /**
   * Set session API key for a provider
   * @param {string} providerId - Provider ID
   * @param {string} apiKey - API key to store
   */
  function setSessionApiKey(providerId, apiKey) {
    const keys = getSessionApiKeys()
    keys[providerId] = apiKey
    sessionStorage.set(SESSION_API_KEYS_KEY, keys)
  }

  /**
   * Remove session API key for a provider
   * @param {string} providerId - Provider ID
   */
  function removeSessionApiKey(providerId) {
    const keys = getSessionApiKeys()
    delete keys[providerId]
    sessionStorage.set(SESSION_API_KEYS_KEY, keys)
  }

  /**
   * Restore session API keys to providers in memory
   */
  function restoreSessionApiKeys() {
    const sessionKeys = getSessionApiKeys()
    for (const [providerId, apiKey] of Object.entries(sessionKeys)) {
      const provider = providers.value.get(providerId)
      if (provider && provider.rememberKey === false) {
        provider.apiKey = apiKey
      }
    }
  }

  /**
   * Initialize store by loading all providers from database
   * @returns {Promise<void>}
   */
  async function initialize() {
    try {
      // Load all providers and filter in memory (IndexedDB doesn't handle boolean indexes well)
      const allProviders = await db.aiProviders.toArray()
      const loaded = allProviders
      loaded.forEach(provider => {
        providers.value.set(provider.id, provider)
      })
      console.log(`Loaded ${loaded.length} AI providers from database`)

      // Restore session API keys for providers with rememberKey=false
      restoreSessionApiKeys()
    } catch (error) {
      console.error('Failed to load AI providers from database:', error)
    }
  }

  /** @type {import('vue').Ref<boolean>} */
  const isInitialized = ref(false)

  /** @type {import('vue').Ref<Promise<void>|null>} */
  const initializePromise = ref(null)

  /**
   * Ensure initialization happens only once
   * @returns {Promise<void>}
   */
  function ensureInitialized() {
    if (!initializePromise.value) {
      initializePromise.value = (async () => {
        try {
          await initialize()
        } finally {
          isInitialized.value = true
        }
      })()
    }
    return initializePromise.value
  }

  // Auto-initialize when store is created
  ensureInitialized()

  /**
   * Create a new provider
   * @param {object} opts
   * @param {string} [opts.id] - Optional ID (for default providers)
   * @param {string} opts.name - Provider name
   * @param {'openrouter'|'llamacpp'|'generic'} opts.type - Provider type. See ai/providers.js.
   * @param {string} [opts.endpoint] - API endpoint
   * @param {string} [opts.apiKey] - API key
   * @param {boolean} [opts.rememberKey] - Whether to persist API key in IndexedDB (default true)
   * @param {import('../ai/routing.js').OpenRouterRouting} [opts.routing] - OpenRouter provider routing policy
   * @param {boolean} [opts.isDefault] - Whether this is a default provider
   * @returns {AIProvider} The created provider
   */
  function createProvider({
    id,
    name,
    type,
    endpoint,
    apiKey,
    rememberKey = true,
    routing,
    isDefault = false,
  }) {
    const providerId = id || generateProviderId()

    /** @type {AIProvider} */
    const provider = {
      id: providerId,
      name,
      type,
      endpoint,
      apiKey: rememberKey ? apiKey : undefined, // Only store in DB if rememberKey is true
      rememberKey,
      routing,
      isDefault,
      version: 1,
      created: Date.now(),
      updated: Date.now(),
    }

    // If rememberKey is false, store API key in session storage instead
    if (!rememberKey && apiKey) {
      setSessionApiKey(providerId, apiKey)
      // Set it in memory for immediate use
      provider.apiKey = apiKey
    }

    providers.value.set(provider.id, provider)

    // Track change for persistence (apiKey will be undefined if rememberKey is false)
    syncStore.trackChange('aiProviders', provider.id, provider)

    return provider
  }

  /**
   * Update an existing provider with partial updates
   * @param {string} providerId - Provider ID to update
   * @param {Partial<AIProvider>} updates - Fields to update
   * @returns {AIProvider|null} Updated provider or null if not found
   */
  function updateProvider(providerId, updates) {
    const provider = providers.value.get(providerId)
    if (!provider) {
      console.error(`Failed to update provider, '${providerId}' not found`)
      return null
    }

    // Handle rememberKey changes
    const newRememberKey = updates.rememberKey ?? provider.rememberKey ?? true
    const oldRememberKey = provider.rememberKey ?? true
    const newApiKey = updates.apiKey ?? provider.apiKey

    // If rememberKey is changing or API key is being updated
    if (newRememberKey !== oldRememberKey || updates.apiKey !== undefined) {
      if (newRememberKey) {
        // Moving from session to persistent storage
        removeSessionApiKey(providerId)
      } else {
        // Moving from persistent to session storage
        if (newApiKey) {
          setSessionApiKey(providerId, newApiKey)
        }
      }
    }

    /** @type {AIProvider} */
    const updated = {
      ...provider,
      ...updates,
      // Only store apiKey in DB if rememberKey is true
      apiKey: newRememberKey ? newApiKey : undefined,
      rememberKey: newRememberKey,
      // Preserve system fields
      id: provider.id,
      isDefault: provider.isDefault,
      created: provider.created,
      updated: Date.now(),
    }

    // If rememberKey is false, keep API key in memory but not in DB
    if (!newRememberKey && newApiKey) {
      updated.apiKey = newApiKey
    }

    providers.value.set(providerId, updated)

    // Track change for persistence (apiKey will be undefined if rememberKey is false)
    syncStore.trackChange('aiProviders', providerId, updated)

    return updated
  }

  /**
   * Delete a provider
   * @param {string} providerId - Provider ID to delete
   * @returns {boolean} True if deleted
   * @throws {Error} If provider not found or is a default provider
   */
  function deleteProvider(providerId) {
    const provider = providers.value.get(providerId)
    if (!provider) {
      throw new Error(`Failed to delete provider, '${providerId}' not found`)
    }

    // Prevent deletion of default providers
    if (provider.isDefault) {
      throw new Error(`Cannot delete default provider '${providerId}'`)
    }

    syncStore.trackDelete('aiProviders', providerId)

    // Remove session API key if it exists
    removeSessionApiKey(providerId)

    providers.value.delete(providerId)

    return true
  }

  /**
   * Get a single provider by ID
   * @param {string} providerId - Provider ID to retrieve
   * @returns {AIProvider|null} Provider or null if not found
   */
  function getProvider(providerId) {
    // Check if we have the provider in memory
    const provider = providers.value.get(providerId)
    return provider || null
  }

  /**
   * Get all providers as an array
   * @returns {AIProvider[]} Array of providers
   */
  function getAllProviders() {
    return Array.from(providers.value.values())
  }

  /**
   * Get all providers ordered by last updated date and name
   * @returns {AIProvider[]} Array of providers
   */
  function getAllProvidersOrdered() {
    return Array.from(providers.value.values()).sort(
      (a, b) => b.updated - a.updated || (a.name > b.name ? 1 : a.name < b.name ? -1 : 0)
    )
  }

  /**
   * Reload a provider from database (useful for cross-tab updates)
   * @param {string} providerId - Provider ID to reload
   * @returns {Promise<AIProvider|null>} The reloaded provider or null if not found
   */
  async function reloadProvider(providerId) {
    try {
      const provider = await db.aiProviders.get(providerId)
      if (provider) {
        // Restore session API key if needed
        if (provider.rememberKey === false) {
          const sessionKeys = getSessionApiKeys()
          if (sessionKeys[providerId]) {
            provider.apiKey = sessionKeys[providerId]
          }
        }
        providers.value.set(providerId, provider)
        triggerRef(providers)

        return provider
      }
      return null
    } catch (error) {
      console.error(`Failed to reload provider ${providerId}:`, error)
      return null
    }
  }

  return {
    // State
    providers,
    isInitialized,

    // Actions
    createProvider,
    updateProvider,
    deleteProvider,
    getProvider,
    getAllProviders,
    getAllProvidersOrdered,
    ensureInitialized,
    reloadProvider,
  }
})
