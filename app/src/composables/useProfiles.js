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
 *
 * An NSFW built-in and its general counterpart are one entry, which the
 * settings switch decides between. Off, the general one is offered, and a chat
 * or a project that names the NSFW one runs on the general one; on, the other
 * way round, so card chats, which start on Roleplay, start on Roleplay (NSFW).
 * Either way the chat keeps the id it names, and flipping the switch back puts
 * it where it was.
 */

import { computed } from 'vue'
import { useChatProfileStore } from '@/stores/chatProfileStore'
import { useApplicationState } from './useApplicationState.js'
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

/** Each general built-in's NSFW counterpart, by the general one's id. */
const NSFW_COUNTERPARTS = Object.fromEntries(
  BUILT_IN_PROFILES.filter(profile => profile.nsfw).map(profile => [profile.generalId, profile.id])
)

export const useProfiles = () => {
  const store = useChatProfileStore()
  const { nsfwProfiles } = useApplicationState()

  /**
   * The built-in that runs in place of this one: its counterpart when the
   * switch is set the other way, and itself otherwise.
   * @param {import('@/ai/profiles/index.js').ChatProfile} profile
   * @returns {import('@/ai/profiles/index.js').ChatProfile}
   */
  const inPlaceOf = profile => {
    const counterpart = nsfwProfiles.value
      ? NSFW_COUNTERPARTS[profile.id]
      : profile.nsfw && profile.generalId
    return (counterpart && getBuiltInProfile(counterpart)) || profile
  }

  /** @type {import('vue').ComputedRef<ProfileEntry[]>} */
  const profiles = computed(() => [
    ...BUILT_IN_PROFILES.filter(profile => inPlaceOf(profile) === profile).map(builtInEntry),
    ...store.getAllProfiles().map(storedEntry),
  ])

  /**
   * The profile a chat on this id runs on: the one it names, or its NSFW or
   * general counterpart, as the switch is set. Null for one that is gone, which
   * callers read as the project's default.
   *
   * @param {string|null|undefined} id
   * @returns {ProfileEntry|null}
   */
  function getProfile(id) {
    if (!id) return null
    const builtIn = getBuiltInProfile(id)
    if (builtIn) return builtInEntry(inPlaceOf(builtIn))
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
