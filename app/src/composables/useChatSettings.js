/**
 * @module composables/useChatSettings
 * @description One chat's settings, and the profile it runs on, for everything
 * that shows or changes them: the settings and the chips under the message
 * box.
 *
 * The chat can be the story's unstarted one, whose settings are kept in memory
 * until something is sent in it. Reading and writing go to whichever it is, so
 * nothing showing them has to know.
 */

import { computed, toValue } from 'vue'
import { useChats } from './useChats.js'
import { useProfiles } from './useProfiles.js'
import { useApplicationState } from './useApplicationState.js'
import { useAIConfig } from './useAIConfig.js'
import { DEFAULT_CHAT_PROMPT } from '@/ai/prompts/index.js'
import {
  getBuiltInProfile,
  noteOnProfile,
  settingsForProfileSwitch,
  ROLEPLAY_NSFW_PROFILE_ID,
  ROLEPLAY_PROFILE_ID,
} from '@/ai/profiles/index.js'
import { ownPrompt, skillPrompt } from '@/ai/skills/index.js'
import { resolveAISettings } from '@/ai/defaults.js'
import { copyChoice, switchGroups, switchTool, toolsSwitchedOff } from '@/ai/tools/choice.js'

/** @typedef {import('../types/models.js').Chat} Chat */

/**
 * @param {string} storyId
 * @param {import('vue').MaybeRefOrGetter<string>} chatId
 */
export function useChatSettings(storyId, chatId) {
  const chatsApi = useChats(storyId)
  const profilesApi = useProfiles()
  const app = useApplicationState()
  const aiConfig = useAIConfig()

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

  // Only the writer's own can be renamed or removed; the built-ins ship with
  // the app, and are saved to in place.
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
   * What the chat runs on: its model, on that model's settings (`runOn` in
   * useAIConfig). Null where there is none.
   */
  const preset = computed(() => aiConfig.presetFor(chat.value, selectedProfile.value))

  /**
   * Leave a choice on the chat and on its profile: the chat runs with it, and
   * the next chat started on the profile starts with it. Every other chat
   * goes on as it was.
   * @param {import('./useProfiles.js').ProfileChoices} choices
   */
  const choose = choices => {
    update(choices)
    profilesApi.setProfileChoices(selectedProfileId.value, choices)
  }

  /**
   * Run the chat on a model, and start the profile's next chats there. It is
   * kept among the models the writer chose lately, for the model menu.
   * @param {string} providerId
   * @param {string} model
   */
  const setModel = (providerId, model) => {
    if (!providerId || !model) return
    choose({ providerId, model })
    app.rememberModel(providerId, model)
  }

  /**
   * How hard the model thinks in this chat: its own choice, or, for a chat
   * that has made none, its preset's, and then the app's. Fitted to the
   * model as it is sent.
   */
  const reasoningEffort = computed(
    () =>
      chat.value?.reasoningEffort ||
      resolveAISettings(preset.value?.generationOverrides).reasoningEffort
  )

  /**
   * Have the model think this hard in this chat, and in the profile's next.
   * @param {string} effort
   */
  const setReasoningEffort = effort => {
    if (effort) choose({ reasoningEffort: effort })
  }

  /**
   * Switch groups of tools on or off in this chat, and in its profile's next
   * chats: the profile takes the same switch on its own tools, not the chat's
   * whole list, so what another chat on it switched since stays.
   * @param {string[]} groups
   * @param {boolean} on
   */
  const setToolGroups = (groups, on) => {
    update(switchGroups(chat.value, groups, on))
    const profile = selectedProfile.value
    if (profile)
      profilesApi.setProfileChoices(profile.id, switchGroups(profile.settings, groups, on))
  }

  /**
   * Switch one tool on or off in this chat, and in its profile's next chats,
   * as a group is.
   * @param {string} name
   * @param {boolean} on
   */
  const setTool = (name, on) => {
    update(switchTool(chat.value, name, on))
    const profile = selectedProfile.value
    if (profile) profilesApi.setProfileChoices(profile.id, switchTool(profile.settings, name, on))
  }

  /** Whether the chat's tools are on at all, whatever each is switched to. */
  const toolsOn = computed(() => !toolsSwitchedOff(chat.value))

  /**
   * Switch every tool off in this chat, and in its profile's next chats, or
   * back on: each group and tool comes back as it was switched.
   * @param {boolean} on
   */
  const setToolsOn = on => choose({ toolsOff: on ? undefined : true })

  /** Whether the chat's edits wait for the writer: its own choice, or the app's from before. */
  const applyEdits = computed(() => app.applyEditsFor(chat.value))

  /**
   * Have this chat's edits wait, or go in, and the profile's next chats too.
   * @param {'auto'|'ask'} mode
   */
  const setApplyEdits = mode => {
    if (mode === 'auto' || mode === 'ask') choose({ applyEdits: mode })
  }

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
   * What a skill runs under in this chat: its profile's wording, or the
   * skill's own where the profile has none. A chat that was given wording of
   * its own, before a skill's wording was its profile's alone, runs under
   * that until it is changed here. See `skillPrompt`.
   * @param {string} id
   */
  const skillPromptOf = id =>
    skillPrompt(id, {
      skills: { ...selectedProfile.value?.settings?.skills, ...chat.value?.skills },
    })

  /**
   * What a skill runs under on this profile before the writer rewords it
   * there: the wording a built-in profile ships with, as Roleplay does
   * Compact, and the skill's own otherwise.
   * @param {string} id
   */
  const shippedSkillPrompt = id =>
    getBuiltInProfile(selectedProfileId.value)?.settings.skills?.[id]?.prompt?.trim() ||
    ownPrompt(id)

  /**
   * Change what a skill runs under, on the profile: as the model and the
   * tools are, it is no one chat's, and every chat on the profile reads it.
   * Typed back to what it was before any rewording, the profile keeps none
   * of its own, so it keeps up with that wording as it changes; the chat's
   * own, from before, gives way.
   * @param {string} id
   * @param {string} text
   */
  const setSkillPrompt = (id, text) => {
    /** @type {Record<string, {prompt?: string}>} */
    const skills = { ...selectedProfile.value?.settings?.skills }
    const shipped = getBuiltInProfile(selectedProfileId.value)?.settings.skills?.[id]
    if (text.trim() !== shippedSkillPrompt(id)) skills[id] = { prompt: text }
    else if (shipped) skills[id] = shipped
    else delete skills[id]
    writeToProfile({ skills })
    if (chat.value?.skills?.[id]) {
      const own = { ...chat.value.skills }
      delete own[id]
      update({ skills: Object.keys(own).length > 0 ? own : undefined })
    }
  }

  /**
   * Put a skill back on the wording it had before the profile reworded it.
   * @param {string} id
   */
  const resetSkill = id => setSkillPrompt(id, shippedSkillPrompt(id))

  /** @param {string} id */
  const isSkillReworded = id => skillPromptOf(id) !== shippedSkillPrompt(id)

  /** Whether the chat's system prompt is its own, which Save carries to the profile. */
  const promptUnsaved = computed(() => prompt.value !== profilePrompt.value)

  /** Whether the chat's author's note differs from its profile's. */
  const noteUnsaved = computed(
    () => (note.value || '') !== (selectedProfile.value?.settings?.rules || '')
  )

  /**
   * What this chat runs under, as a profile's settings, its profile's
   * wording of the skills with them.
   * @returns {import('@/ai/profiles/index.js').ProfileSettings}
   */
  const chatAsProfile = () => {
    const own = chat.value || {}
    const skills = Object.fromEntries(
      Object.entries({ ...selectedProfile.value?.settings?.skills, ...own.skills }).filter(
        ([id, wording]) => wording?.prompt?.trim() && wording.prompt.trim() !== ownPrompt(id)
      )
    )
    return {
      prompt: prompt.value,
      ...copyChoice(own),
      rules: note.value || undefined,
      skills,
      providerId: preset.value?.providerId || undefined,
      model: preset.value?.model || undefined,
      reasoningEffort: own.reasoningEffort || undefined,
      applyEdits: own.applyEdits || undefined,
    }
  }

  /**
   * New profile: a copy of this chat's settings, under the name given, made
   * free where another profile has it, which the chat moves onto. The usual
   * reason to reach for one is a variation on what is already there.
   * @param {string} [name]
   * @returns {import('./useProfiles.js').ProfileEntry|null}
   */
  const newProfile = (name = '') => {
    if (!selectedProfile.value) return null
    const copy = profilesApi.saveProfile(
      profilesApi.freeProfileName(name.trim() || 'New Profile'),
      chatAsProfile()
    )
    update(settingsForProfileSwitch(copy))
    return copy
  }

  /**
   * Carry texts to the chat's profile, for every new chat on it, and for
   * every chat on it that has none of its own. A built-in takes them in
   * place, beside it (`system.builtInProfiles`); a text that is the one it
   * ships with is kept as none, so the built-in keeps up with the app's
   * improvements to it.
   * @param {{prompt?: string, rules?: string, skills?: Record<string, {prompt?: string}>}} texts
   */
  const writeToProfile = texts => {
    const source = selectedProfile.value
    if (!source) return
    const shipped = getBuiltInProfile(source.id)?.settings
    if (!shipped) {
      profilesApi.updateProfile(source.id, { settings: texts })
      return
    }
    /** @type {Partial<import('@/ai/profiles/index.js').ProfileSettings>} */
    const kept = {}
    if ('prompt' in texts) kept.prompt = texts.prompt === shipped.prompt ? undefined : texts.prompt
    if ('rules' in texts)
      kept.rules = (texts.rules || '') === (shipped.rules || '') ? undefined : texts.rules
    if ('skills' in texts)
      kept.skills =
        JSON.stringify(texts.skills) === JSON.stringify(shipped.skills || {})
          ? undefined
          : texts.skills
    app.setBuiltInProfile(source.id, kept)
  }

  /** Save the chat's system prompt to its profile; the chat reads the profile's again. */
  const savePrompt = () => {
    writeToProfile({ prompt: prompt.value })
    update({ prompt: undefined })
  }

  /** Save the chat's author's note to its profile, for the chats started on it next. */
  const saveNote = () => writeToProfile({ rules: note.value || undefined })

  /**
   * Point the chat at a profile.
   *
   * Only the prompt follows the profile from here. Everything the profile also
   * carries — its tools, its context switches, its author's note, its model —
   * is stamped on in place of whatever the chat had, because a chat that
   * silently retooled itself when its profile changed would be a chat whose
   * settings nobody could trust.
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
    preset,
    setModel,
    reasoningEffort,
    setReasoningEffort,
    applyEdits,
    setApplyEdits,
    setToolGroups,
    setTool,
    toolsOn,
    setToolsOn,
    skillPromptOf,
    setSkillPrompt,
    resetSkill,
    isSkillReworded,
    promptUnsaved,
    noteUnsaved,
    newProfile,
    savePrompt,
    saveNote,
    setProfile,
    deleteProfile,
  }
}
