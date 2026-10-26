/**
 * @typedef {import('../types/models.js').AIProvider} AIProvider
 * @typedef {import('../types/models.js').AIPreset} AIPreset
 */

import { computed, ref } from 'vue'
import { useAIProvidersStore } from '@/stores/aiProvidersStore'
import { useAIPresetStore } from '@/stores/aiPresetStore'
import { useApplicationState } from '@/composables/useApplicationState'
import { BUILT_IN_PROVIDERS, DEFAULT_SPEECH_PROVIDER_ID, inMenuOrder } from '@/ai/providers.js'
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
 * The preset Settings › AI shows, by id: whichever the writer picked there or
 * asked a chat to edit. Absent, or naming one since deleted, it shows the
 * default. One for the app, as the settings are.
 * @type {import('vue').Ref<string|null>}
 */
const shownPresetId = ref(null)

/**
 * Composable for managing AI configuration: the providers, and the presets.
 *
 * A chat runs on the preset it names, or its profile names, or the default:
 * `activeAIPreset`, the one chats run on when neither says. Settings › AI
 * shows one preset at a time to edit, `shownPreset`, which picking it there
 * does not make the default; Settings › System › Chats does that.
 *
 * @returns {{
 *   init: () => Promise<void>,
 *   providers: import('vue').ComputedRef<AIProvider[]>,
 *   getProvider: (id: string) => AIProvider | null,
 *   createProvider: (provider: {id?: string, name: string, type: 'openrouter'|'anthropic'|'openai'|'gemini'|'llamacpp'|'generic', endpoint?: string, apiKey?: string, rememberKey?: boolean, routing?: import('../ai/routing.js').OpenRouterRouting, isDefault?: boolean}) => AIProvider,
 *   updateProvider: (id: string, updates: Partial<AIProvider>) => AIProvider | null,
 *   deleteProvider: (id: string) => void,
 *   reloadProvider: (id: string) => Promise<AIProvider>,
 *   presets: import('vue').ComputedRef<AIPreset[]>,
 *   getPreset: (id: string) => AIPreset | null,
 *   createPreset: (name?: string, source?: AIPreset|null) => AIPreset,
 *   updatePreset: (id: string, updates: Partial<AIPreset>) => AIPreset | null,
 *   deletePreset: (id: string) => boolean,
 *   activeAIPresetId: import('vue').ComputedRef<string>,
 *   activeAIPreset: import('vue').ComputedRef<AIPreset | null>,
 *   setActiveAIPreset: (presetId: string) => void,
 *   shownPreset: import('vue').ComputedRef<AIPreset | null>,
 *   showPreset: (presetId: string) => void,
 *   presetFor: (chat: {presetId?: string}|null|undefined, profile: {settings?: {presetId?: string}}|null|undefined) => AIPreset | null,
 *   aiPresetDefaults: Partial<AIPreset>,
 * }}
 */
export const useAIConfig = () => {
  const providersStore = useAIProvidersStore()
  const presetsStore = useAIPresetStore()
  const appState = useApplicationState()

  const activeAIPresetId = appState.activeAIPresetId
  const setActiveAIPreset = appState.setActiveAIPresetId

  const activeAIPreset = computed(() => {
    return activeAIPresetId.value ? getPreset(activeAIPresetId.value) : null
  })

  async function init() {
    await Promise.all([providersStore.ensureInitialized(), presetsStore.ensureInitialized()])

    ensureBuiltInProviders()
    moveSpeechServer()
    await ensureDefaultProfile()

    if (!activeAIPresetId.value || !getPreset(activeAIPresetId.value)) {
      setActiveAIPreset(DEFAULT_PRESET_ID)
    }
  }

  /**
   * Create each built-in connection that is missing: all of them on a first
   * start, and the ones added since on an install that had only OpenRouter.
   * One that is there is left as it is, its address and key the writer's.
   */
  function ensureBuiltInProviders() {
    for (const { id, name, type, endpoint } of BUILT_IN_PROVIDERS) {
      if (getProvider(id)) continue
      providersStore.createProvider({ id, name, type, endpoint, isDefault: true })
      console.log(`Created the built-in ${name} provider`)
    }
  }

  /**
   * The speech server Settings › Narration had fields of its own for, before
   * speech went through the connections, moved onto one, once: OpenAI's
   * address onto the OpenAI connection, any other onto Kokoro's. A key goes
   * with it where the connection has none.
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
   * Create a preset, and show it in Settings › AI.
   *
   * A copy of one, tuning and all, because that is what somebody reaching for
   * a new preset almost always wants: the same setup pointed at another
   * model. Starting blank meant re-entering a sampler tune every time, which
   * is what the old separate Duplicate was for. Chats go on as they were: the
   * copy is the one that chooses it.
   *
   * @param {string} [name] - Display name
   * @param {AIPreset|null} [source] - What it copies: the one Settings › AI shows, unless named
   * @returns {AIPreset}
   */
  function createPreset(name = 'New preset', source = shownPreset.value) {
    const preset = presetsStore.createPreset({
      ...aiPresetDefaults,
      name,
      providerId: source?.providerId || DEFAULT_OPENROUTER_PROVIDER_ID,
      model: source?.model || '',
      // The same model, so the same providers serve it, and serve it badly.
      allowedProviders: source?.allowedProviders ? [...source.allowedProviders] : undefined,
      ignoredProviders: source?.ignoredProviders ? [...source.ignoredProviders] : undefined,
      toolsEnabled: source?.toolsEnabled !== false,
      generationOverrides: { ...(source?.generationOverrides || {}) },
    })
    showPreset(preset.id)
    return preset
  }

  /** The preset Settings › AI shows: the one picked there, or the default. */
  const shownPreset = computed(() => getPreset(shownPresetId.value) || activeAIPreset.value)

  /** @param {string} presetId - The preset for Settings › AI to show */
  const showPreset = presetId => {
    shownPresetId.value = presetId
  }

  /**
   * The preset a chat runs on: its own choice, or else its profile's, or else
   * the default. One that names a preset not here, deleted or never synced to
   * this device, reads as the next one down, as a deleted profile reads as
   * the project's default.
   *
   * @param {{presetId?: string}|null|undefined} chat
   * @param {{settings?: {presetId?: string}}|null|undefined} profile - The one it runs on
   * @returns {AIPreset|null}
   */
  const presetFor = (chat, profile) =>
    getPreset(chat?.presetId ?? '') ||
    getPreset(profile?.settings?.presetId ?? '') ||
    activeAIPreset.value

  /**
   * Delete a preset, moving off it first if it's the active one so the app is
   * never left pointing at a deleted preset.
   *
   * @param {string} presetId - Preset to delete
   * @returns {boolean} True if deleted
   */
  function deletePreset(presetId) {
    if (activeAIPresetId.value === presetId) {
      const survivor = presets.value.find(p => p.id !== presetId)
      if (!survivor) return false
      setActiveAIPreset(survivor.id)
    }
    return presetsStore.deletePreset(presetId)
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

    // Presets
    presets,
    getPreset,
    createPreset,
    updatePreset,
    deletePreset,
    activeAIPresetId,
    activeAIPreset,
    setActiveAIPreset,
    shownPreset,
    showPreset,
    presetFor,
    aiPresetDefaults,
  }
}
