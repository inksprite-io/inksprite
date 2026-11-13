/**
 * @typedef {import('../types/models.js').AIProvider} AIProvider
 * @typedef {import('../types/models.js').AIPreset} AIPreset
 */

import { computed } from 'vue'
import { useAIProvidersStore } from '@/stores/aiProvidersStore'
import { useAIPresetStore } from '@/stores/aiPresetStore'
import { useApplicationState } from '@/composables/useApplicationState'
import { useProfiles } from '@/composables/useProfiles'
import {
  BUILT_IN_PROVIDERS,
  DEFAULT_SPEECH_PROVIDER_ID,
  inMenuOrder,
  kindOf,
} from '@/ai/providers.js'
import { recommendedRouting } from '@/ai/recommended.js'
import { DEFAULT_PRESET_ID } from '@/ai/defaults.js'
const DEFAULT_OPENROUTER_PROVIDER_ID = 'provider_openrouter_default'
const OPENAI_PROVIDER_ID = 'provider_openai_default'

/**
 * Default settings for the AI preset. Sampler params, max tokens, and
 * reasoning settings come from src/ai/defaults.js, not from the preset.
 * @type {Partial<AIPreset>}
 */
const aiPresetDefaults = {
  type: 'chat',
}

/**
 * What a chat or a profile names to run on: the connection and the model.
 * @typedef {{providerId?: string, model?: string}} ModelChoice
 */

/** How the made-up id of a model no preset is on starts. */
const MODEL_ALONE = 'model:'

/**
 * A model no preset is on, as a preset: the model on the app's settings. Its
 * id is made up, and names nothing stored.
 * @param {string} providerId
 * @param {string} model
 * @returns {AIPreset}
 */
const modelAlone = (providerId, model) => ({
  id: `${MODEL_ALONE}${providerId}/${model}`,
  name: model,
  providerId,
  model,
  generationOverrides: {},
  isDefault: false,
  version: 0,
  created: 0,
  updated: 0,
})

/**
 * Composable for managing AI configuration: the connections, and each
 * model's settings.
 *
 * A chat runs on the model it first answered on, or has been moved to since;
 * one that hasn't answered, on its profile's (`presetFor`). A model's
 * settings are a preset, one to a connection and model, made the first time
 * the writer changes one and holding only the changes (`runOn`). There is no
 * model for the app: each profile has one its chats start on (see
 * composables/useProfiles.js).
 *
 * @returns {{
 *   init: () => Promise<void>,
 *   providers: import('vue').ComputedRef<AIProvider[]>,
 *   getProvider: (id: string) => AIProvider | null,
 *   createProvider: (provider: {id?: string, name: string, type: 'openrouter'|'anthropic'|'openai'|'nanogpt'|'gemini'|'llamacpp'|'generic', endpoint?: string, apiKey?: string, rememberKey?: boolean, routing?: import('../ai/routing.js').OpenRouterRouting, server?: string, added?: boolean, isDefault?: boolean}) => AIProvider,
 *   updateProvider: (id: string, updates: Partial<AIProvider>) => AIProvider | null,
 *   deleteProvider: (id: string) => void,
 *   reloadProvider: (id: string) => Promise<AIProvider>,
 *   presets: import('vue').ComputedRef<AIPreset[]>,
 *   getPreset: (id: string) => AIPreset | null,
 *   updatePreset: (id: string, updates: Partial<AIPreset>) => AIPreset | null,
 *   settingsOf: (providerId: string|null|undefined, model: string|null|undefined) => AIPreset | null,
 *   runOn: (providerId: string, model: string) => AIPreset,
 *   changeModelSettings: (providerId: string, model: string, changes: Partial<AIPreset>) => AIPreset | null,
 *   mergeDuplicates: () => number,
 *   forgetModelSettings: (providerId: string) => void,
 *   startingPreset: import('vue').ComputedRef<AIPreset | null>,
 *   presetOf: (choice: ModelChoice|null|undefined) => AIPreset | null,
 *   presetFor: (chat: ModelChoice|null|undefined, profile: {settings?: ModelChoice}|null|undefined) => AIPreset | null,
 *   aiPresetDefaults: Partial<AIPreset>,
 * }}
 */
export const useAIConfig = () => {
  const providersStore = useAIProvidersStore()
  const presetsStore = useAIPresetStore()
  const appState = useApplicationState()
  const profiles = useProfiles()

  async function init() {
    await Promise.all([providersStore.ensureInitialized(), presetsStore.ensureInitialized()])

    moveSpeechServer()
    await ensureDefaultProfile()
  }

  /**
   * The speech server Settings › Narration had fields of its own for, before
   * speech went through the connections, moved onto one, once: OpenAI's
   * address onto the OpenAI connection, any other onto Kokoro's, each made
   * where it is missing. A key goes with it where the connection has none.
   */
  function moveSpeechServer() {
    const old = appState.state.value.narration
    if (!old || typeof old.endpoint !== 'string') return
    const endpoint = old.endpoint.trim()
    const apiKey = typeof old.apiKey === 'string' ? old.apiKey.trim() : ''
    const openAI = /^https:\/\/api\.openai\.com\//.test(endpoint)
    const providerId = openAI ? OPENAI_PROVIDER_ID : DEFAULT_SPEECH_PROVIDER_ID
    const provider = getProvider(providerId)
    if (provider) {
      /** @type {Partial<AIProvider>} */
      const updates = {}
      if (!openAI && endpoint && endpoint !== provider.endpoint) updates.endpoint = endpoint
      if (apiKey && !provider.apiKey) updates.apiKey = apiKey
      if (Object.keys(updates).length > 0) updateProvider(providerId, updates)
    } else {
      const builtIn = /** @type {(typeof BUILT_IN_PROVIDERS)[number]} */ (
        BUILT_IN_PROVIDERS.find(entry => entry.id === providerId)
      )
      createProvider({
        id: providerId,
        name: builtIn.name,
        type: builtIn.type,
        endpoint: openAI ? undefined : endpoint || builtIn.endpoint,
        apiKey: apiKey || undefined,
        added: true,
      })
    }
    const model =
      (typeof old.model === 'string' && old.model.trim()) || (openAI ? 'tts-1' : 'kokoro')
    appState.state.value.narration = { providerId, model }
    console.log(`Moved the speech server onto the ${provider?.name ?? providerId} connection`)
  }

  async function ensureDefaultProfile() {
    if (getPreset(DEFAULT_PRESET_ID)) return
    presetsStore.createPreset({
      ...aiPresetDefaults,
      id: DEFAULT_PRESET_ID,
      name: 'Default',
      providerId: DEFAULT_OPENROUTER_PROVIDER_ID,
      model: '~anthropic/claude-sonnet-latest',
      isDefault: true,
    })
    console.log('Created default AI preset')
  }

  const providers = computed(() => inMenuOrder(providersStore.getAllProvidersOrdered()))
  const getProvider = id => providersStore.getProvider(id)
  const createProvider = provider => providersStore.createProvider(provider)
  const updateProvider = (id, updates) => providersStore.updateProvider(id, updates)
  const deleteProvider = id => providersStore.deleteProvider(id)
  const reloadProvider = id => providersStore.reloadProvider(id)

  const presets = computed(() => presetsStore.getAllPresetsOrdered())
  const getPreset = id => presetsStore.getPreset(id)
  const updatePreset = (id, updates) => presetsStore.updatePreset(id, updates)

  /**
   * A model's settings on a connection, as the writer changed them: its
   * preset, one per connection and model. Null for one never changed.
   *
   * @param {string|null|undefined} providerId
   * @param {string|null|undefined} model
   * @returns {AIPreset|null}
   */
  const settingsOf = (providerId, model) =>
    (providerId &&
      model &&
      presets.value.find(preset => preset.providerId === providerId && preset.model === model)) ||
    null

  /**
   * What a request on a model runs with, as a preset: the writer's changes to
   * its settings, over the routing it is recommended with, over the app's
   * defaults. Its samplers' own defaults join as the request is made
   * (useAIService). Its id is the stored settings', or made up for a model
   * never changed.
   *
   * @param {string} providerId
   * @param {string} model
   * @returns {AIPreset}
   */
  function runOn(providerId, model) {
    const stored = settingsOf(providerId, model)
    const recommended =
      recommendedRouting(kindOf(getProvider(providerId) ?? { id: providerId }).id, model) ?? {}
    /** @param {'allowedProviders'|'ignoredProviders'|'fallbacks'} field */
    const routed = field => (stored?.[field] !== undefined ? stored[field] : recommended[field])
    const run = stored ? { ...stored } : modelAlone(providerId, model)
    for (const field of /** @type {const} */ ([
      'allowedProviders',
      'ignoredProviders',
      'fallbacks',
    ])) {
      const value = routed(field)
      if (value === undefined) delete run[field]
      else run[field] = /** @type {any} */ (value)
    }
    return run
  }

  /**
   * Change a model's settings, made the first time any is changed.
   *
   * @param {string} providerId
   * @param {string} model
   * @param {Partial<AIPreset>} changes
   * @returns {AIPreset|null}
   */
  function changeModelSettings(providerId, model, changes) {
    const stored =
      settingsOf(providerId, model) ??
      presetsStore.createPreset({ ...aiPresetDefaults, name: model, providerId, model })
    return updatePreset(stored.id, changes)
  }

  /**
   * What a chat or a profile runs on, by the model it names: that model, on
   * its settings. Null for one that names none.
   *
   * @param {ModelChoice|null|undefined} choice
   * @returns {AIPreset|null}
   */
  const presetOf = choice =>
    choice?.providerId && choice.model ? runOn(choice.providerId, choice.model) : null

  /**
   * What a profile never picked on starts chats on: the model of the preset
   * chats ran on by default before, while it is there, and otherwise of the
   * built-in one (`startingPresetId` in useProfiles).
   *
   * @returns {AIPreset|null}
   */
  function startingRun() {
    const preset = getPreset(profiles.startingPresetId() ?? '')
    return preset?.providerId && preset.model ? runOn(preset.providerId, preset.model) : null
  }

  /**
   * What a chat runs on: the model it names, or where it names none, its
   * profile's, and then what a profile never picked on starts chats on.
   *
   * @param {ModelChoice|null|undefined} chat
   * @param {{settings?: ModelChoice}|null|undefined} profile - The one it runs on
   * @returns {AIPreset|null}
   */
  const presetFor = (chat, profile) =>
    presetOf(chat) || presetOf(profile?.settings) || startingRun()

  /**
   * What new chats start on where nothing else says: the profile new chats
   * start on's model. What a conversion runs on until one is picked for it.
   */
  const startingPreset = computed(() =>
    presetFor(null, profiles.getProfile(profiles.chatDefaultId()))
  )

  /**
   * One preset to a connection and model: where there are more, from before
   * a preset was a model's settings, the last changed wins, and the others
   * go. The built-in one is kept in the winner's place where it is one of
   * them, with the winner's settings, since an older device would only make
   * it again.
   *
   * @returns {number} How many went
   */
  function mergeDuplicates() {
    /** @type {Map<string, AIPreset[]>} */
    const groups = new Map()
    for (const preset of presets.value) {
      if (!preset.providerId || !preset.model) continue
      const key = `${preset.providerId}\n${preset.model}`
      groups.set(key, [...(groups.get(key) ?? []), preset])
    }
    let removed = 0
    for (const group of groups.values()) {
      if (group.length < 2) continue
      const latest = [...group].sort((a, b) => (b.updated ?? 0) - (a.updated ?? 0))[0]
      const keep = group.find(preset => preset.id === DEFAULT_PRESET_ID) ?? latest
      if (keep !== latest) {
        updatePreset(keep.id, {
          generationOverrides: { ...(latest.generationOverrides || {}) },
          toolsEnabled: latest.toolsEnabled,
          allowedProviders: latest.allowedProviders,
          ignoredProviders: latest.ignoredProviders,
          fallbacks: latest.fallbacks,
        })
      }
      for (const preset of group) {
        if (preset.id === keep.id) continue
        presetsStore.deletePreset(preset.id)
        removed++
      }
    }
    if (removed > 0) console.log(`Merged ${removed} presets into the settings of their models`)
    return removed
  }

  /**
   * Let a connection's model settings go with it. The built-in preset stays,
   * since an older device would only make it again.
   * @param {string} providerId
   */
  function forgetModelSettings(providerId) {
    for (const preset of presets.value) {
      if (preset.providerId === providerId && preset.id !== DEFAULT_PRESET_ID) {
        presetsStore.deletePreset(preset.id)
      }
    }
  }

  return {
    init,

    // Providers
    providers,
    getProvider,
    createProvider,
    updateProvider,
    deleteProvider,
    reloadProvider,

    // A model's settings
    presets,
    getPreset,
    updatePreset,
    settingsOf,
    runOn,
    changeModelSettings,
    mergeDuplicates,
    forgetModelSettings,
    startingPreset,
    presetOf,
    presetFor,
    aiPresetDefaults,
  }
}
