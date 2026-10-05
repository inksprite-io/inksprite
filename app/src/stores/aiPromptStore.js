/**
 * @module stores/aiPromptStore
 * @description Store for saved system prompts — the user's own named prompts,
 * shared across every story and chat in the app.
 *
 * The prompts that ship with the app are not kept here; they live in
 * `src/ai/prompts/` so they improve with the app. This store holds only what
 * the user has written, and nothing reads it during generation: selecting a
 * prompt copies its text onto the chat, so editing a saved prompt later never
 * rewrites a conversation that is already using it.
 */

import { defineStore } from 'pinia'
import { ref } from 'vue'
import { nanoid } from 'nanoid'
import { useSyncStore } from './syncStore.js'
import db from './db'

/** @typedef {import('../types/models.js').AIPrompt} AIPrompt */

/**
 * Generate a unique prompt ID
 * @returns {string} Prompt ID in format prompt_xxx
 */
function generatePromptId() {
  return `prompt_${nanoid()}`
}

export const useAIPromptStore = defineStore('aiPrompts', () => {
  /**
   * @type {import('vue').Ref<Map<string, AIPrompt>>}
   */
  const prompts = ref(new Map())

  const syncStore = useSyncStore()

  /**
   * Load saved prompts from the database
   * @returns {Promise<void>}
   */
  async function initialize() {
    try {
      const stored = await db.aiPrompts.toArray()
      stored.forEach(prompt => {
        prompts.value.set(prompt.id, prompt)
      })

      console.log(`Loaded ${prompts.value.size} saved prompts`)
    } catch (error) {
      console.error('Failed to load saved prompts from database:', error)
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
   * Save a new prompt
   * @param {object} opts - Prompt fields
   * @param {string} opts.name - Display name
   * @param {string} [opts.content] - Prompt text
   * @returns {AIPrompt} The saved prompt
   */
  function createPrompt({ name, content = '' }) {
    /** @type {AIPrompt} */
    const prompt = {
      id: generatePromptId(),
      name,
      content,
      version: 1,
      created: Date.now(),
      updated: Date.now(),
    }

    prompts.value.set(prompt.id, prompt)
    syncStore.trackChange('aiPrompts', prompt.id, prompt)

    return prompt
  }

  /**
   * Update a saved prompt
   * @param {string} promptId - Prompt ID to update
   * @param {Partial<AIPrompt>} updates - Fields to update
   * @returns {AIPrompt|null} Updated prompt, or null if not found
   */
  function updatePrompt(promptId, updates) {
    const prompt = prompts.value.get(promptId)
    if (!prompt) {
      console.error(`Failed to update prompt, '${promptId}' not found`)
      return null
    }

    /** @type {AIPrompt} */
    const updated = {
      ...prompt,
      ...updates,
      // Preserve system fields
      id: prompt.id,
      created: prompt.created,
      updated: Date.now(),
    }

    prompts.value.set(promptId, updated)
    syncStore.trackChange('aiPrompts', promptId, updated)

    return updated
  }

  /**
   * Delete a saved prompt
   * @param {string} promptId - Prompt ID to delete
   * @returns {boolean} True if deleted, false if not found
   */
  function deletePrompt(promptId) {
    const prompt = prompts.value.get(promptId)
    if (!prompt) {
      console.error(`Failed to delete prompt, '${promptId}' not found`)
      return false
    }

    prompts.value.delete(promptId)
    syncStore.trackDelete('aiPrompts', promptId)
    return true
  }

  /**
   * Get a single saved prompt by ID
   * @param {string} promptId - Prompt ID to retrieve
   * @returns {AIPrompt|null} Prompt, or null if missing or deleted
   */
  function getPrompt(promptId) {
    const prompt = prompts.value.get(promptId)
    return prompt || null
  }

  /**
   * Get all saved prompts, ordered by name
   * @returns {AIPrompt[]} Array of prompts
   */
  function getAllPromptsOrdered() {
    return Array.from(prompts.value.values()).sort((a, b) => a.name.localeCompare(b.name))
  }

  return {
    // State
    prompts,
    isInitialized,

    // Actions
    createPrompt,
    updatePrompt,
    deletePrompt,
    getPrompt,
    getAllPromptsOrdered,
    ensureInitialized,
  }
})
