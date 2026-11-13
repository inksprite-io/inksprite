/**
 * @module composables/useProfiles
 * @description The chat profiles, built-in and the writer's own, as one list.
 *
 * The built-ins lead, the way they did in the prompt library and for the same
 * reason: they are what a chat falls back to, and a list whose first entries
 * move as saved ones come and go is a list nobody can point at.
 *
 * A built-in's wording cannot be edited. Saving a chat's settings to one makes
 * a copy of the writer's own, `Default - Custom`, and moves the chat onto it;
 * a copy of one of the writer's own is numbered, `Notes (2)`, as copies are
 * everywhere else. What a pick in a chat leaves on a profile, its model, its
 * effort, whether edits wait and its tools, is kept on a built-in all the
 * same, in the application state beside it (`builtInProfiles`), so it is
 * never copied for that.
 *
 * Every profile has a preset its chats start on. One never picked on starts
 * them on the preset chats ran on before profiles kept their own, while it is
 * here, and otherwise on the built-in one.
 *
 * An NSFW built-in and its general counterpart are one entry, which the
 * settings switch decides between. Off, the general one is offered, and a chat
 * or a project that names the NSFW one runs on the general one; on, the other
 * way round, so card chats, which start on Roleplay, start on Roleplay (NSFW).
 * Either way the chat keeps the id it names, and flipping the switch back puts
 * it where it was.
 *
 * The roleplay built-ins are offered only while the Roleplay extension is on.
 * A chat or a project already on one runs on it all the same.
 */

import { computed } from 'vue'
import { useChatProfileStore } from '@/stores/chatProfileStore'
import { useAIPresetStore } from '@/stores/aiPresetStore'
import { useApplicationState } from './useApplicationState.js'
import { DEFAULT_PRESET_ID } from '@/ai/defaults.js'
import {
  BUILT_IN_PROFILES,
  DEFAULT_PROFILE_ID,
  ROLEPLAY_PROFILE_ID,
  getBuiltInProfile,
} from '@/ai/profiles/index.js'
import { freeName } from '@/utils/titleValidation.js'

/**
 * A profile as the library hands it over: the same shape whether it ships with
 * the app or was saved.
 *
 * @typedef {Object} ProfileEntry
 * @property {string} id
 * @property {string} name
 * @property {import('@/ai/profiles/index.js').ProfileSettings} settings
 * @property {boolean} readOnly - True for the ones that ship with the app
 */

/**
 * The choices a pick in a chat leaves on its profile: its model, effort and
 * edits, and its tools switched.
 * @typedef {Pick<import('@/ai/profiles/index.js').ProfileSettings, 'providerId'|'model'|'reasoningEffort'|'applyEdits'|'disabledTools'|'disabledToolGroups'|'onlyToolGroups'|'toolsOff'>} ProfileChoices
 */

/** Each general built-in's NSFW counterpart, by the general one's id. */
const NSFW_COUNTERPARTS = Object.fromEntries(
  BUILT_IN_PROFILES.filter(profile => profile.nsfw).map(profile => [profile.generalId, profile.id])
)

export const useProfiles = () => {
  const store = useChatProfileStore()
  const presets = useAIPresetStore()
  const {
    nsfwProfiles,
    chatProfileId,
    roleplayProfileId,
    roleplay,
    legacyPresetId,
    builtInProfiles,
    setBuiltInProfile,
  } = useApplicationState()

  /**
   * The preset a profile never picked on starts chats on: the one chats ran
   * on before profiles kept their own, while it is here, then the built-in
   * one, then any.
   * @returns {string|undefined}
   */
  const startingPresetId = () =>
    [legacyPresetId.value, DEFAULT_PRESET_ID].find(id => id && presets.getPreset(id)) ??
    presets.getAllPresetsOrdered()[0]?.id

  /** @param {any} profile @returns {ProfileEntry} */
  const storedEntry = profile => ({
    id: profile.id,
    name: profile.name,
    settings: profile.settings || {},
    readOnly: false,
  })

  /** @param {import('@/ai/profiles/index.js').ChatProfile} profile @returns {ProfileEntry} */
  const builtInEntry = profile => ({
    ...profile,
    settings: { ...profile.settings, ...builtInProfiles.value[profile.id] },
    readOnly: true,
  })

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

  /**
   * The profiles offered: a built-in in its own place, and a roleplay one only
   * while roleplay is on.
   * @type {import('vue').ComputedRef<ProfileEntry[]>}
   */
  const profiles = computed(() => [
    ...BUILT_IN_PROFILES.filter(
      profile => inPlaceOf(profile) === profile && (roleplay.value || !profile.roleplay)
    ).map(builtInEntry),
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
   * What a copy of a profile is called: `Default - Custom` for a built-in's,
   * and the next number for one of the writer's own, `Notes (2)`, either one
   * numbered on past a name already taken.
   *
   * @param {ProfileEntry} source
   * @returns {string}
   */
  function copyName(source) {
    return freeProfileName(source.readOnly ? `${source.name} - Custom` : source.name)
  }

  /**
   * A name no profile has yet: this one, or this one numbered, `New Profile (2)`.
   * @param {string} name
   * @returns {string}
   */
  function freeProfileName(name) {
    const taken = [...BUILT_IN_PROFILES, ...store.getAllProfiles()].map(profile => profile.name)
    return freeName(taken, name)
  }

  /**
   * A copy of a profile under a new name, with changes over its settings.
   *
   * @param {string} id - The profile to copy
   * @param {Partial<import('@/ai/profiles/index.js').ProfileSettings>} [changes]
   * @returns {ProfileEntry|null}
   */
  function duplicateProfile(id, changes = {}) {
    const source = getProfile(id)
    if (!source) return null
    return saveProfile(copyName(source), { ...source.settings, ...changes })
  }

  /**
   * The profile new chats start on where a project has not chosen one: the
   * one chosen in the settings, while it is there, and Default otherwise.
   * @returns {string}
   */
  const chatDefaultId = () =>
    (getProfile(chatProfileId.value) ? chatProfileId.value : null) ?? DEFAULT_PROFILE_ID

  /**
   * The profile chats on a character card start on: the one chosen in the
   * settings, while it is there, and Roleplay otherwise — which the NSFW
   * switch puts its counterpart in place of, as it does for any chat on it.
   * A profile of the writer's own stays theirs whichever way the switch is.
   * @returns {string}
   */
  const roleplayDefaultId = () =>
    (getProfile(roleplayProfileId.value) ? roleplayProfileId.value : null) ?? ROLEPLAY_PROFILE_ID

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
   * Leave what was picked in a chat on its profile, for the chats started on
   * it next: on one of the writer's own, in its settings; on a built-in,
   * beside it.
   *
   * @param {string} id
   * @param {ProfileChoices} choices
   */
  function setProfileChoices(id, choices) {
    if (getBuiltInProfile(id)) setBuiltInProfile(id, choices)
    // Merged into its settings by the store, the rest kept.
    else if (store.getProfile(id))
      store.updateProfile(id, /** @type {any} */ ({ settings: choices }))
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
    copyName,
    freeProfileName,
    chatDefaultId,
    roleplayDefaultId,
    updateProfile,
    setProfileChoices,
    deleteProfile,
    startingPresetId,
    DEFAULT_PROFILE_ID,
  }
}
