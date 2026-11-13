/**
 * @module composables/useChatPresets
 * @description Giving every chat and profile the model it runs on.
 *
 * A chat keeps the model it first answered on, and a pick in another chat
 * moves only what new chats on that profile start on. One from before chats
 * kept their own models names none, or only the preset it ran on, which is
 * no longer read: each is given the model it runs on, every chat on this
 * device once, the first time this version opens, and as a project's chats
 * load, any that came since from an older device, a backup or an import.
 *
 * The model is given only where the chat could run on it now. One whose
 * connection isn't set up yet follows its profile, so setup, which moves the
 * profiles, moves the chat too.
 *
 * Profiles are given the model their old preset was on, or where the writer
 * had chosen a preset for chats before each profile kept its own, that
 * one's, once, so they start their chats there on every device. Then the
 * presets that share a connection and model become one (`mergeDuplicates`).
 *
 * Design: `.llm/ai_setup_design.md`, "Step 1: a chat's model".
 */

import { useAIConfig } from './useAIConfig.js'
import { useProfiles } from './useProfiles.js'
import { useApplicationState } from './useApplicationState.js'
import { useAIPresetStore } from '@/stores/aiPresetStore'
import { useAIProvidersStore } from '@/stores/aiProvidersStore'
import { useChatProfileStore } from '@/stores/chatProfileStore'
import { useChatsStore } from '@/stores/chatsStore'
import { useStoriesStore } from '@/stores/storiesStore'
import { storage } from '@/storage/index.js'
import { BUILT_IN_PROFILES } from '@/ai/profiles/index.js'
import { DEFAULT_PRESET_ID } from '@/ai/defaults.js'
import { presetProblem } from '@/ai/providers.js'

/** @typedef {import('../types/models.js').Chat} Chat */

/**
 * Wait for what a chat's model is read from: the connections, the presets
 * and the writer's own profiles.
 * @returns {Promise<void>}
 */
async function presetsReady() {
  await Promise.all([
    useAIProvidersStore().ensureInitialized(),
    useAIPresetStore().ensureInitialized(),
    useProfiles().ready(),
  ])
}

/**
 * Whether a chat names its model.
 * @param {Partial<Chat>} chat
 */
const named = chat => Boolean(chat.providerId && chat.model)

/**
 * The model of the preset a chat or a profile named, from before a model's
 * settings were found by the model, where that preset is still here.
 *
 * @param {{presetId?: string}|null|undefined} holder
 * @returns {{providerId: string, model: string}|null}
 */
function legacyModel(holder) {
  const preset = holder?.presetId ? useAIPresetStore().getPreset(holder.presetId) : null
  return preset?.providerId && preset.model
    ? { providerId: preset.providerId, model: preset.model }
    : null
}

/**
 * What to write on a chat for it to keep the model it runs on: the one its
 * old preset was on, or else its profile's, or where that is gone its
 * project's, and then the app's; only where it could run on it now.
 *
 * @param {Partial<Chat>} chat
 * @returns {Partial<Chat>|null} Null when there is nothing to write
 */
export function stampFor(chat) {
  if (!chat || named(chat)) return null
  const profiles = useProfiles()
  const aiConfig = useAIConfig()
  const projectProfile = chat.storyId
    ? useStoriesStore().getStory(chat.storyId)?.options?.profileId
    : undefined
  const profile =
    profiles.getProfile(chat.profileId) ??
    profiles.getProfile(projectProfile) ??
    profiles.getProfile(profiles.chatDefaultId())
  const was = legacyModel(chat)
  const preset = was ? aiConfig.presetOf(was) : aiConfig.presetFor(chat, profile)
  if (!preset || presetProblem(preset, aiConfig.getProvider)) return null
  return { providerId: preset.providerId, model: preset.model }
}

/**
 * Give each of these chats, loaded in the store, what it runs on, where it
 * names it not.
 *
 * @param {Chat[]} chats
 * @returns {Promise<number>} How many were given any
 */
export async function stampChats(chats) {
  if (chats.every(named)) return 0
  await presetsReady()
  const store = useChatsStore()
  let stamped = 0
  for (const chat of chats) {
    const changes = stampFor(chat)
    if (!changes) continue
    store.updateChat(chat.id, changes)
    stamped++
  }
  return stamped
}

/**
 * Give every profile the model it starts chats on, where it names none: the
 * one its old preset was on, or where the writer had chosen a preset for
 * chats before profiles kept their own, that one's. The built-in one needs
 * no giving: a profile with none starts its chats there anyway.
 */
function giveProfilesModels() {
  const app = useApplicationState()
  const chosenId = app.legacyPresetId.value
  const chosen =
    chosenId && chosenId !== DEFAULT_PRESET_ID ? legacyModel({ presetId: chosenId }) : null
  for (const profile of BUILT_IN_PROFILES) {
    const choices = app.builtInProfiles.value[profile.id]
    if (named(choices ?? {})) continue
    const model = legacyModel(choices) ?? chosen
    if (model) app.setBuiltInProfile(profile.id, model)
  }
  const profiles = useChatProfileStore()
  for (const profile of profiles.getAllProfiles()) {
    if (named(profile.settings ?? {})) continue
    const model = legacyModel(profile.settings) ?? chosen
    // Merged into its settings by the store, the rest kept.
    if (model) profiles.updateProfile(profile.id, /** @type {any} */ ({ settings: model }))
  }
}

/**
 * Give every chat on this device what it runs on, once: those loaded through
 * the store, the rest where they are kept, in every project.
 *
 * @returns {Promise<void>}
 */
export async function stampEveryChat() {
  const app = useApplicationState()
  if (app.chatsStamped.value) return
  await presetsReady()
  const store = useChatsStore()
  const loaded = [...store.chats.values()]
  try {
    giveProfilesModels()
    await stampChats(loaded)
    const changed = await storage.updateEach('chats', chat =>
      store.chats.has(chat.id) ? null : stampFor(chat)
    )
    app.setChatsStamped(true)
    console.log(`Gave ${changed} chats the model they run on`)
  } catch (error) {
    console.error('Failed to give chats the models they run on:', error)
  }
  // Then one preset to a connection and model: the chats on the others have
  // their models now.
  useAIConfig().mergeDuplicates()
}

/**
 * Fill the model menu's recent models, once, from the models the writer used
 * before they were kept: those whose settings they changed, the latest first
 * (every preset from before was a model they set up), then those their
 * profiles start chats on.
 *
 * @returns {Promise<void>}
 */
export async function seedRecentModels() {
  const app = useApplicationState()
  await presetsReady()
  const aiConfig = useAIConfig()
  const tuned = [...aiConfig.presets.value]
    .filter(preset => preset.providerId && preset.model)
    .sort((a, b) => (b.updated ?? 0) - (a.updated ?? 0))
  // Every profile's, a roleplay one's too while roleplay is off.
  const started = [
    ...Object.values(app.builtInProfiles.value),
    ...useChatProfileStore()
      .getAllProfiles()
      .map(profile => profile.settings),
  ].filter(settings => settings?.providerId && settings.model)
  app.seedRecentModels(
    [...tuned, ...started].map(({ providerId, model }) => ({
      providerId: /** @type {string} */ (providerId),
      model: /** @type {string} */ (model),
    }))
  )
}
