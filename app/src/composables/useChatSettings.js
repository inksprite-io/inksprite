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
    note,
    setProfile,
    deleteProfile,
  }
}
