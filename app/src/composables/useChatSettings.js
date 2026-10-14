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
import { useApplicationState } from './useApplicationState.js'
import { useWebSearch } from './useWebSearch.js'
import { useMcpServers } from './useMcpServers.js'
import { useStoriesStore } from '@/stores/storiesStore'
import { DEFAULT_CHAT_PROMPT } from '@/ai/prompts/index.js'
import {
  noteOnProfile,
  settingsForProfileSwitch,
  ROLEPLAY_NSFW_PROFILE_ID,
  ROLEPLAY_PROFILE_ID,
} from '@/ai/profiles/index.js'
import { ownPrompt, skillPrompt } from '@/ai/skills/index.js'
import { webForChat } from '@/web/config.js'
import { serversForChat } from '@/mcp/servers.js'

/** @typedef {import('../types/models.js').Chat} Chat */

/**
 * @param {string} storyId
 * @param {import('vue').MaybeRefOrGetter<string>} chatId
 */
export function useChatSettings(storyId, chatId) {
  const chatsApi = useChats(storyId)
  const profilesApi = useProfiles()
  const app = useApplicationState()
  const webSearch = useWebSearch()
  const mcp = useMcpServers()
  const storiesStore = useStoriesStore()

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

  /** The profile's system prompt, which a chat reads until it has its own. */
  const profilePrompt = computed(
    () => selectedProfile.value?.settings?.prompt ?? DEFAULT_CHAT_PROMPT
  )

  /** The system prompt the next request sends: the chat's own, or its profile's. */
  const prompt = computed(() => chat.value?.prompt ?? profilePrompt.value)

  // Only the writer's own can be renamed, removed or saved over; the built-ins
  // ship with the app, and saving to one makes a copy instead.
  const isSavedProfile = computed(() => !!selectedProfile.value && !selectedProfile.value.readOnly)

  /**
   * Change the system prompt, as it is typed. The change is the chat's: the
   * profile keeps its own until the writer saves to it. Typed back to the
   * profile's, the chat reads the profile's again.
   * @param {string} text
   */
  const setPrompt = text => update({ prompt: text === profilePrompt.value ? undefined : text })

  /**
   * Change the author's note, as it is typed. Stored trimmed, and stored as
   * absent when there is nothing left: an empty string and no note at all
   * mean the same thing to the turn, and only one of them should reach the
   * row.
   * @param {string} text
   */
  const setNote = text => update({ rules: text.trim() || undefined })

  /**
   * The chat's roleplay settings: the names its macros become, and the
   * instructions sent after its prompt and its note. They are the chat's
   * alone, so none of them is in what a profile is saved from, and switching
   * profiles leaves them as they are. Each is stored trimmed, and as absent
   * when empty, as the note is.
   */
  const roleplay = computed(() => ({
    userName: chat.value?.userName || '',
    characterName: chat.value?.characterName || '',
    prompt: chat.value?.roleplayPrompt || '',
    postHistory: chat.value?.postHistory || '',
  }))

  /**
   * Whether this is a roleplay chat, which is where the roleplay settings are
   * shown: one on a Roleplay profile or on the profile character cards start
   * on, or one that has any of them already. A card chat moved to Default
   * still fills its names in, and they stay where they can be changed.
   */
  const isRoleplay = computed(
    () =>
      [
        ROLEPLAY_PROFILE_ID,
        ROLEPLAY_NSFW_PROFILE_ID,
        profilesApi.getProfile(profilesApi.roleplayDefaultId())?.id,
      ].includes(selectedProfileId.value) || Object.values(roleplay.value).some(Boolean)
  )

  /** @param {string} text - What `{{user}}` becomes */
  const setUserName = text => update({ userName: text.trim() || undefined })
  /** @param {string} text - What `{{char}}` becomes */
  const setCharacterName = text => update({ characterName: text.trim() || undefined })
  /** @param {string} text - Sent after the system prompt */
  const setRoleplayPrompt = text => update({ roleplayPrompt: text.trim() || undefined })
  /** @param {string} text - Sent after the author's note */
  const setPostHistory = text => update({ postHistory: text.trim() || undefined })

  /**
   * What a skill runs under on the profile, and in this chat: the chat's
   * wording over the profile's, and the skill's own under both. See
   * `skillPrompt`.
   * @param {string} id
   */
  const profileSkillPrompt = id => skillPrompt(id, selectedProfile.value?.settings)
  /** @param {string} id */
  const skillPromptOf = id =>
    skillPrompt(id, {
      skills: { ...selectedProfile.value?.settings?.skills, ...chat.value?.skills },
    })

  /**
   * Change what a skill runs under, in this chat. Typed back to the profile's
   * wording, the chat reads the profile's again; to the skill's own, it is
   * kept as none, so it keeps up with that wording as it changes.
   * @param {string} id
   * @param {string} text
   */
  const setSkillPrompt = (id, text) => {
    const own = { ...chat.value?.skills }
    if (text.trim() === profileSkillPrompt(id)) delete own[id]
    else own[id] = { prompt: text.trim() === ownPrompt(id) ? '' : text }
    update({ skills: Object.keys(own).length > 0 ? own : undefined })
  }

  /**
   * Put a skill back on its own wording, in this chat.
   * @param {string} id
   */
  const resetSkill = id => setSkillPrompt(id, ownPrompt(id))

  /** @param {string} id */
  const isSkillReworded = id => skillPromptOf(id) !== ownPrompt(id)

  /** @param {string[]|undefined} a @param {string[]|undefined} b */
  const sameSet = (a, b) => {
    const left = new Set(a || [])
    const right = new Set(b || [])
    return left.size === right.size && [...left].every(name => right.has(name))
  }

  /** The servers the chat's profile lists, as a chat that has not chosen reads them. */
  const listedServers = () => serversForChat(null, selectedProfileId.value).map(server => server.id)

  /**
   * Whether this chat runs differently from its profile: its prompt, a skill's
   * wording, its tools, the web or a server, or its author's note. What Save
   * to profile would write.
   */
  const changed = computed(() => {
    const own = chat.value
    const settings = selectedProfile.value?.settings
    if (!own || !settings) return false
    const id = selectedProfileId.value
    return (
      prompt.value !== profilePrompt.value ||
      Object.keys(own.skills || {}).some(
        skill => skillPromptOf(skill) !== profileSkillPrompt(skill)
      ) ||
      !sameSet(own.disabledTools, settings.disabledTools) ||
      !sameSet(own.disabledToolGroups, settings.disabledToolGroups) ||
      (note.value || '') !== (settings.rules || '') ||
      webForChat(own, id) !== webForChat(null, id) ||
      (Array.isArray(own.mcpServers) && !sameSet(own.mcpServers, listedServers()))
    )
  })

  /**
   * What this chat runs under, as a profile's settings. A skill's wording that
   * is only its own is left out, so the profile keeps up with it.
   * @returns {import('@/ai/profiles/index.js').ProfileSettings}
   */
  const chatAsProfile = () => {
    const own = chat.value || {}
    const worded = { ...selectedProfile.value?.settings?.skills, ...own.skills }
    const skills = Object.fromEntries(
      Object.entries(worded).filter(
        ([id, wording]) => wording?.prompt?.trim() && wording.prompt.trim() !== ownPrompt(id)
      )
    )
    return {
      prompt: prompt.value,
      disabledTools: [...(own.disabledTools || [])],
      disabledToolGroups: [...(own.disabledToolGroups || [])],
      rules: note.value || undefined,
      skills,
    }
  }

  /**
   * List a profile with the web search setup and each server as this chat
   * uses them: its own choice where it made one, and the profile it is on
   * where it did not. For a copy, so new chats on it start as this one runs;
   * and for a save, so the profile takes the chat's choice.
   * @param {string} id - The profile to list
   */
  const listAs = id => {
    const own = chat.value || {}
    const from = selectedProfileId.value
    const listed = webSearch.setup.value.profiles || []
    const web = typeof own.web === 'boolean' ? own.web : listed.includes(from)
    if (web !== listed.includes(id)) webSearch.setProfile(id, web)
    for (const server of mcp.servers.value) {
      const on = Array.isArray(own.mcpServers)
        ? own.mcpServers.includes(server.id)
        : (server.profiles || []).includes(from)
      if (on === (server.profiles || []).includes(id)) continue
      const others = (server.profiles || []).filter(one => one !== id)
      mcp.updateServer(server.id, { profiles: on ? [...others, id] : others })
    }
  }

  /**
   * A profile of the writer's own made from this chat, named after the one it
   * is on, with the chat moved onto it. See `copyName` in useProfiles.
   * @returns {import('./useProfiles.js').ProfileEntry|null}
   */
  const copyToProfile = () => {
    const source = selectedProfile.value
    if (!source) return null
    const copy = profilesApi.saveProfile(profilesApi.copyName(source), chatAsProfile())
    listAs(copy.id)
    update(settingsForProfileSwitch(copy))
    return copy
  }

  /**
   * New profile: a copy of this chat's settings, which the chat moves onto.
   * The usual reason to reach for one is a variation on what is already there.
   */
  const forkProfile = () => {
    copyToProfile()
  }

  /**
   * Save this chat's settings to its profile, for every new chat on it. The
   * chats already on it keep their own.
   *
   * A built-in can't be changed, so its settings go to a copy, `Default -
   * Custom`, which takes the built-in's place wherever it was the one chats
   * start on: in the settings, and as this project's default.
   */
  const saveToProfile = async () => {
    const source = selectedProfile.value
    if (!source) return
    if (!source.readOnly) {
      profilesApi.updateProfile(source.id, { settings: chatAsProfile() })
      listAs(source.id)
      update({ prompt: undefined, skills: undefined, web: undefined, mcpServers: undefined })
      return
    }

    const resolves = (/** @type {string} */ id) => profilesApi.getProfile(id)?.id === source.id
    const startsChats = resolves(profilesApi.chatDefaultId())
    const startsCards = resolves(profilesApi.roleplayDefaultId())
    const story = storiesStore.getStory(storyId)
    const startsProject = !!story?.options?.profileId && resolves(story.options.profileId)

    const copy = copyToProfile()
    if (!copy) return
    if (startsChats) app.setChatProfileId(copy.id)
    if (startsCards) app.setRoleplayProfileId(copy.id)
    if (startsProject && story) {
      await storiesStore.updateStory(storyId, {
        options: { ...story.options, profileId: copy.id },
      })
    }
  }

  /** Put this chat back as its profile has it: its prompt, tools, note and all. */
  const resetToProfile = () => {
    if (selectedProfile.value) update(settingsForProfileSwitch(selectedProfile.value))
  }

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
    roleplay,
    isRoleplay,
    setUserName,
    setCharacterName,
    setRoleplayPrompt,
    setPostHistory,
    prompt,
    profilePrompt,
    setPrompt,
    skillPromptOf,
    setSkillPrompt,
    resetSkill,
    isSkillReworded,
    changed,
    forkProfile,
    saveToProfile,
    resetToProfile,
    setProfile,
    deleteProfile,
  }
}
