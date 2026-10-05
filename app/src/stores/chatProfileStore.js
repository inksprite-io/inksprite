/**
 * @module stores/chatProfileStore
 * @description The writer's own chat profiles — how a chat is run.
 *
 * The built-in profiles ship as source (`ai/profiles/index.js`) so that an
 * improvement reaches chats that have not been created yet. These are the ones
 * the writer made, which the app must never rewrite.
 *
 * The rows the prompt library used to hold became these, keeping their ids; see
 * `stores/migrations/profiles.js`.
 *
 * Not the AI presets (`stores/aiPresetStore.js`), which are what a request runs
 * on. A profile says how a chat is run; a preset says what runs it.
 */

import { defineStore } from 'pinia'
import { ref } from 'vue'
import { nanoid } from 'nanoid'
import { useSyncStore } from './syncStore.js'
import db from './db'

/** @typedef {import('../types/models.js').StoredChatProfile} StoredChatProfile */

/** @returns {string} */
function generateProfileId() {
  return `chatprofile_${nanoid()}`
}

export const useChatProfileStore = defineStore('chatProfiles', () => {
  /** @type {import('vue').Ref<Map<string, StoredChatProfile>>} */
  const profiles = ref(new Map())

  const syncStore = useSyncStore()

  /** @type {import('vue').Ref<Promise<void>|null>} */
  const initializePromise = ref(null)

  async function initialize() {
    try {
      const stored = await db.chatProfiles.toArray()
      for (const profile of stored) {
        profiles.value.set(profile.id, profile)
      }
      console.log(`Loaded ${profiles.value.size} chat profiles`)
    } catch (error) {
      console.error('Failed to load chat profiles from database:', error)
    }
  }

  /** @returns {Promise<void>} */
  function ensureInitialized() {
    if (!initializePromise.value) initializePromise.value = initialize()
    return initializePromise.value
  }

  ensureInitialized()

  /**
   * @param {{name: string, settings?: object, id?: string}} opts
   * @returns {StoredChatProfile}
   */
  function createProfile({ name, settings = {}, id }) {
    /** @type {StoredChatProfile} */
    const profile = {
      id: id || generateProfileId(),
      name,
      settings,
      version: 1,
      created: Date.now(),
      updated: Date.now(),
    }

    profiles.value.set(profile.id, profile)
    syncStore.trackChange('chatProfiles', profile.id, profile)
    return profile
  }

  /**
   * @param {string} profileId
   * @param {Partial<StoredChatProfile>} updates
   * @returns {StoredChatProfile|null}
   */
  function updateProfile(profileId, updates) {
    const profile = profiles.value.get(profileId)
    if (!profile) {
      console.error(`Failed to update chat profile, '${profileId}' not found`)
      return null
    }

    const updated = {
      ...profile,
      ...updates,
      // Merged rather than replaced, so a caller changing one setting does not
      // have to send the rest back to keep them.
      settings: { ...profile.settings, ...(updates.settings || {}) },
      id: profile.id,
      created: profile.created,
      updated: Date.now(),
    }

    profiles.value.set(profileId, updated)
    syncStore.trackChange('chatProfiles', profileId, updated)
    return updated
  }

  /**
   * @param {string} profileId
   * @returns {boolean}
   */
  function deleteProfile(profileId) {
    const profile = profiles.value.get(profileId)
    if (!profile) return false

    profiles.value.delete(profileId)
    syncStore.trackDelete('chatProfiles', profileId)
    return true
  }

  /**
   * @param {string} profileId
   * @returns {StoredChatProfile|null}
   */
  function getProfile(profileId) {
    return profiles.value.get(profileId) || null
  }

  /** @returns {StoredChatProfile[]} */
  function getAllProfiles() {
    return Array.from(profiles.value.values()).sort((a, b) => a.name.localeCompare(b.name))
  }

  return {
    profiles,
    ensureInitialized,
    createProfile,
    updateProfile,
    deleteProfile,
    getProfile,
    getAllProfiles,
  }
})
