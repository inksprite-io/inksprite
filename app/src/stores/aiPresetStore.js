/**
 * @module stores/aiPresetStore
 * @description The AI presets: what a request runs on — provider, model, and
 * how it generates.
 *
 * Not to be confused with a chat profile (`ai/profiles/index.js`), which is how
 * a chat is run: its prompt, its tools, its roles. A profile says how a chat is
 * run; a preset says what runs it.
 *
 * The rows are still stored in the `aiProfiles` table under `profile_` ids,
 * because a table name is not worth a migration and an id is opaque. The word
 * changed; the data did not.
 *
 * Legacy fields (sampler params, prompts, presetId, etc.) are preserved in
 * stored data for forward and backward compatibility but no longer read.
 */

import { defineStore } from 'pinia'
import { ref } from 'vue'
import { nanoid } from 'nanoid'
import { useSyncStore } from './syncStore.js'
import db from './db'

/** @typedef {import('../types/models.js').AIPreset} AIPreset */

/**
 * Generate unique IDs for AI presets
 * @returns {string} Preset ID in format profile_xxx
 */
function generatePresetId() {
  return `profile_${nanoid()}`
}

export const useAIPresetStore = defineStore('aiProfiles', () => {
  /**
   * @type {import('vue').Ref<Map<string, AIPreset>>}
   */
  const presets = ref(new Map())

  // Get sync store instance
  const syncStore = useSyncStore()

  /**
   * Initialize store by loading presets from database and ensuring defaults exist
   * @returns {Promise<void>}
   */
  async function initialize() {
    try {
      // Load all presets from database
      const stored = await db.aiProfiles.toArray()
      const loaded = stored

      // Add database presets to the map
      loaded.forEach(preset => {
        presets.value.set(preset.id, preset)
      })

      console.log(`Loaded ${loaded.length} AI presets`)
    } catch (error) {
      console.error('Failed to load AI presets from database:', error)
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
   * Create a new preset.
   * @param {object} opts
   * @param {string} [opts.id] - Optional ID (for default presets)
   * @param {string} [opts.type] - Preset type (legacy, optional)
   * @param {string} opts.name - Preset name
   * @param {string} opts.providerId - Provider ID
   * @param {string} opts.model - Model identifier
   * @param {string[]} [opts.allowedProviders] - OpenRouter upstreams allowed to serve the model
   * @param {boolean} [opts.toolsEnabled] - Whether the model may call tools
   * @param {import('../ai/defaults.js').AISettingsOverrides} [opts.generationOverrides] - Sparse overrides on AI_DEFAULTS
   * @param {boolean} [opts.isDefault] - Whether this is a default preset
   * @returns {AIPreset} The created preset
   */
  function createPreset({
    id,
    type,
    name,
    providerId,
    model,
    allowedProviders,
    toolsEnabled = true,
    generationOverrides = {},
    isDefault = false,
  }) {
    /** @type {AIPreset} */
    const preset = {
      id: id || generatePresetId(),
      type: type || undefined,
      name,
      providerId,
      model,
      ...(allowedProviders?.length ? { allowedProviders } : {}),
      toolsEnabled,
      generationOverrides,
      isDefault,
      version: 1,
      created: Date.now(),
      updated: Date.now(),
    }

    presets.value.set(preset.id, preset)
    syncStore.trackChange('aiProfiles', preset.id, preset)

    return preset
  }

  /**
   * Update an existing preset with partial updates
   * @param {string} presetId - Preset ID to update
   * @param {Partial<AIPreset>} updates - Fields to update
   * @returns {AIPreset|null} Updated preset or null if not found
   * @throws {Error} When trying to update a default preset
   */
  function updatePreset(presetId, updates) {
    const preset = presets.value.get(presetId)
    if (!preset) {
      console.error(`Failed to update preset, '${presetId}' not found`)
      return null
    }

    /** @type {AIPreset} */
    const updated = {
      ...preset,
      ...updates,
      // Preserve system fields
      id: preset.id,
      isDefault: preset.isDefault,
      created: preset.created,
      updated: Date.now(),
    }

    presets.value.set(presetId, updated)

    // Track change for persistence
    syncStore.trackChange('aiProfiles', presetId, updated)

    return updated
  }

  /**
   * Delete a preset
   * @param {string} presetId - Preset ID to delete
   * @returns {boolean} True if deleted, false if not found
   * @throws {Error} When trying to delete a default preset
   */
  function deletePreset(presetId) {
    const preset = presets.value.get(presetId)
    if (!preset) {
      console.error(`Failed to delete preset, '${presetId}' not found`)
      return false
    }

    // Don't allow deleting default presets
    if (preset.isDefault) {
      throw new Error(`Cannot delete the default preset '${preset.name}'`)
    }

    presets.value.delete(presetId)
    syncStore.trackDelete('aiProfiles', presetId)
    return true
  }

  /**
   * Get a single preset by ID
   * @param {string} presetId - Preset ID to retrieve
   * @returns {AIPreset|null} Preset or null if not found
   */
  function getPreset(presetId) {
    // Check if we have the preset in memory
    const preset = presets.value.get(presetId)
    return preset || null
  }

  /**
   * Get all presets as an array
   * @returns {AIPreset[]} Array of presets
   */
  function getAllPresets() {
    return Array.from(presets.value.values())
  }

  /**
   * Get all presets ordered by default status, then name
   * Default presets come first.
   * @returns {AIPreset[]} Array of presets
   */
  function getAllPresetsOrdered() {
    return Array.from(presets.value.values()).sort((a, b) => {
      if (a.isDefault && !b.isDefault) return -1
      if (!a.isDefault && b.isDefault) return 1
      return a.name.localeCompare(b.name)
    })
  }

  return {
    // State
    presets,
    isInitialized,

    // Actions
    createPreset,
    updatePreset,
    deletePreset,
    getPreset,
    getAllPresets,
    getAllPresetsOrdered,
    ensureInitialized,
  }
})
