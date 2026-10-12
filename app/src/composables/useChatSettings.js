/**
 * @module composables/useChatSettings
 * @description One chat's settings, and the profile it runs on, for everything
 * that shows or changes them: the settings pane and the chat header's profile
 * menu.
 *
 * The chat can be the story's unstarted one, whose settings are kept in memory
 * until something is sent in it. Reading and writing go to whichever it is, so
 * nothing showing them has to know.
 */

import { computed, toValue } from 'vue'
import { useChats } from './useChats.js'
import { useProfiles } from './useProfiles.js'
import { DEFAULT_CHAT_PROMPT } from '@/ai/prompts/index.js'
import { noteOnProfile, settingsForProfileSwitch } from '@/ai/profiles/index.js'

/** @typedef {import('../types/models.js').Chat} Chat */

/**
 * @param {string} storyId
 * @param {import('vue').MaybeRefOrGetter<string>} chatId
 */
export function useChatSettings(storyId, chatId) {
  const chatsApi = useChats(storyId)
  const profilesApi = useProfiles()

  const unstarted = computed(() => chatsApi.isUnstarted(toValue(chatId)))

  /** @type {import('vue').ComputedRef<Partial<Chat>|null>} */
  const chat = computed(() =>
    unstarted.value ? chatsApi.unstartedChat.value : chatsApi.getChatById(toValue(chatId))
  )

  /** @param {Partial<Chat>} updates */
  const update = updates =>
    unstarted.value
      ? chatsApi.updateUnstartedChat(updates)
      : chatsApi.updateChat(toValue(chatId), updates)

  /** The profile chats in this project start on, and go back to on reset. */
  const defaultProfileId = computed(() => chatsApi.defaultProfileId())

  // The profile generation runs the chat on, which is not always the one it
  // names: one deleted since reads as the project's default, and one with an
  // NSFW or general counterpart as whichever the settings switch puts in its
  // place.
  const selectedProfileId = computed(
    () => profilesApi.getProfile(chat.value?.profileId)?.id ?? defaultProfileId.value
  )

  const selectedProfile = computed(() => profilesApi.getProfile(selectedProfileId.value))

  // The author's note as the turn reads it. See `noteOnProfile`.
  const note = computed(() => noteOnProfile(chat.value?.rules, selectedProfile.value))

  /** The system prompt as the profile holds it, which is what the next request sends. */
  const prompt = computed(() => selectedProfile.value?.settings?.prompt ?? DEFAULT_CHAT_PROMPT)

  // Only the writer's own can be renamed or removed; the built-ins ship with
  // the app, and editing one makes a copy to edit instead.
  const isSavedProfile = computed(() => !!selectedProfile.value && !selectedProfile.value.readOnly)

  /**
   * Copy the selected profile and switch the chat to the copy. The copy starts
   * new chats with this chat's author's note rather than the profile's: an
   * edited list of opt-ins, or rules worked out here, is as often as not why
   * the writer wants one. The chat is given its note as it reads it, which a
   * copy, having no counterpart, would otherwise read differently. See
   * `noteOnProfile`.
   * @param {Partial<import('@/ai/profiles/index.js').ProfileSettings>} [changes]
   */
  const forkProfile = (changes = {}) => {
    const rules = note.value
    const copy = profilesApi.duplicateProfile(selectedProfileId.value, { rules, ...changes })
    if (copy) update({ profileId: copy.id, rules })
  }

  /**
   * Change the system prompt, as it is typed. A saved profile takes the edit
   * itself. A built-in is read-only, so the first keystroke makes a copy of
   * the writer's own and moves the chat onto it: the text stays where it is,
   * and the copy's name appears in place of the built-in's.
   * @param {string} text
   */
  const setPrompt = text => {
    if (isSavedProfile.value) {
      profilesApi.updateProfile(selectedProfileId.value, { settings: { prompt: text } })
    } else {
      forkProfile({ prompt: text })
    }
  }

  /**
   * Change the author's note, as it is typed. Stored trimmed, and stored as
   * absent when there is nothing left: an empty string and no note at all
   * mean the same thing to the turn, and only one of them should reach the
   * row.
   * @param {string} text
   */
  const setNote = text => update({ rules: text.trim() || undefined })

  /**
   * Point the chat at a profile.
   *
   * Only the prompt follows the profile from here. Everything the profile also
   * carries — its tools, its context switches, its author's note — is stamped
   * on in place of whatever the chat had, because a chat that silently
   * retooled itself when its profile changed would be a chat whose settings
   * nobody could trust.
   *
   * @param {string} id
   */
  const setProfile = id => {
    const profile = profilesApi.getProfile(id)
    if (profile) update(settingsForProfileSwitch(profile))
  }

  /**
   * Remove one of the writer's own profiles. This chat goes back to the
   * project's default if it was on it; any other chat on it does too, on its
   * next turn, since a profile that is gone reads as the default.
   *
   * @param {string} id
   */
  const deleteProfile = id => {
    const profile = profilesApi.getProfile(id)
    if (!profile || profile.readOnly) return
    const wasOnIt = chat.value?.profileId === id
    profilesApi.deleteProfile(id)
    if (wasOnIt) setProfile(defaultProfileId.value)
  }

  return {
    chat,
    update,
    profiles: profilesApi.profiles,
    defaultProfileId,
    selectedProfileId,
    selectedProfile,
    isSavedProfile,
    note,
    setNote,
    prompt,
    setPrompt,
    forkProfile,
    setProfile,
    deleteProfile,
  }
}
