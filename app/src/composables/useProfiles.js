/**
 * @module composables/useProfiles
 * @description The chat profiles, built-in and the writer's own, as one list.
 *
 * The built-ins lead, the way they did in the prompt library and for the same
 * reason: they are what a chat falls back to, and a list whose first entries
 * move as saved ones come and go is a list nobody can point at.
 *
 * A built-in cannot be edited. Editing one makes a copy of the writer's own and
 * moves the chat onto it, which is what the library did with prompts and the
 * behaviour everybody already has in their fingers.
 */

import { computed } from 'vue'
import { useChatProfileStore } from '@/stores/chatProfileStore'
import { BUILT_IN_PROFILES, DEFAULT_PROFILE_ID, getBuiltInProfile } from '@/ai/profiles/index.js'

/**
 * A profile as the library hands it over: the same shape whether it ships with
 * the app or was saved.
 *
 * @typedef {Object} ProfileEntry
 * @property {string} id
 * @property {string} name
 * @property {string} [description] - Built-ins only, for the picker
 * @property {import('@/ai/profiles/index.js').ProfileSettings} settings
 * @property {boolean} readOnly - True for the ones that ship with the app
 */

/** @param {any} profile @returns {ProfileEntry} */
const storedEntry = profile => ({
  id: profile.id,
  name: profile.name,
  settings: profile.settings || {},
  readOnly: false,
})

/** @param {import('@/ai/profiles/index.js').ChatProfile} profile @returns {ProfileEntry} */
const builtInEntry = profile => ({ ...profile, readOnly: true })

export const useProfiles = () => {
  const store = useChatProfileStore()

  /** @type {import('vue').ComputedRef<ProfileEntry[]>} */
  const profiles = computed(() => [
    ...BUILT_IN_PROFILES.map(builtInEntry),
    ...store.getAllProfiles().map(storedEntry),
  ])

  /**
   * @param {string|null|undefined} id
   * @returns {ProfileEntry|null}
   */
  function getProfile(id) {
    if (!id) return null
    const builtIn = getBuiltInProfile(id)
    if (builtIn) return builtInEntry(builtIn)
    const stored = store.getProfile(id)
    return stored ? storedEntry(stored) : null
  }

  /**
   * The saved profiles load from the database, so anything that must not read
   * a half-built library waits on this first.
   *
   * @returns {Promise<void>}
   */
  const ready = () => store.ensureInitialized()

  /**
   * @param {string} name
   * @param {import('@/ai/profiles/index.js').ProfileSettings} settings
   * @returns {ProfileEntry}
   */
  function saveProfile(name, settings) {
    return storedEntry(store.createProfile({ name, settings }))
  }

  /**
   * A copy of a profile under a new name, which is how a built-in is edited.
   *
   * @param {string} id - The profile to copy
   * @param {Partial<import('@/ai/profiles/index.js').ProfileSettings>} [changes]
   * @returns {ProfileEntry|null}
   */
  function duplicateProfile(id, changes = {}) {
    const source = getProfile(id)
    if (!source) return null
    return saveProfile(`${source.name} copy`, { ...source.settings, ...changes })
  }

  /**
   * @param {string} id
   * @param {{name?: string, settings?: Partial<import('@/ai/profiles/index.js').ProfileSettings>}} updates
   * @returns {ProfileEntry|null}
   */
  function updateProfile(id, updates) {
    const updated = store.updateProfile(id, /** @type {any} */ (updates))
    return updated ? storedEntry(updated) : null
  }

  /**
   * @param {string} id
   * @returns {boolean}
   */
  const deleteProfile = id => store.deleteProfile(id)

  return {
    profiles,
    getProfile,
    ready,
    saveProfile,
    duplicateProfile,
    updateProfile,
    deleteProfile,
    DEFAULT_PROFILE_ID,
  }
}
