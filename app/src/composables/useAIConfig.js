/**
 * @typedef {import('../types/models.js').AIProvider} AIProvider
 * @typedef {import('../types/models.js').AIPreset} AIPreset
 */

import { computed } from 'vue'
import { useAIProvidersStore } from '@/stores/aiProvidersStore'
import { useAIPresetStore } from '@/stores/aiPresetStore'
import { useApplicationState } from '@/composables/useApplicationState'

// The single AI preset is stored under the legacy "chat" ID so existing
// installs keep their config across the collapse from per-mode presets.
const DEFAULT_AI_PROFILE_ID = 'profile_default_chat'
const DEFAULT_OPENROUTER_PROVIDER_ID = 'provider_openrouter_default'

/**
 * Default settings for the AI preset. Sampler params, max tokens, and
 * reasoning settings come from src/ai/defaults.js, not from the preset.
 * @type {Partial<AIPreset>}
 */
const aiPresetDefaults = {
  type: 'chat',
}

/**
 * Composable for managing AI configuration (providers + the single preset).
 *
 * @returns {{
 *   init: () => Promise<void>,
 *   providers: import('vue').ComputedRef<AIProvider[]>,
 *   getProvider: (id: string) => AIProvider | null,
 *   createProvider: (provider: {name: string, type: 'openrouter'|'llamacpp'|'generic', endpoint?: string, apiKey?: string, rememberKey?: boolean, routing?: import('../ai/routing.js').OpenRouterRouting}) => AIProvider,
 *   updateProvider: (id: string, updates: Partial<AIProvider>) => AIProvider | null,
 *   deleteProvider: (id: string) => void,
 *   reloadProvider: (id: string) => Promise<AIProvider>,
 *   presets: import('vue').ComputedRef<AIPreset[]>,
 *   getPreset: (id: string) => AIPreset | null,
 *   createPreset: (name?: string) => AIPreset,
 *   updatePreset: (id: string, updates: Partial<AIPreset>) => AIPreset | null,
 *   deletePreset: (id: string) => boolean,
 *   activeAIPresetId: import('vue').ComputedRef<string>,
 *   activeAIPreset: import('vue').ComputedRef<AIPreset | null>,
 *   setActiveAIPreset: (presetId: string) => void,
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

    await ensureDefaultProvider()
    await ensureDefaultProfile()

    if (!activeAIPresetId.value || !getPreset(activeAIPresetId.value)) {
      setActiveAIPreset(DEFAULT_AI_PROFILE_ID)
    }
  }

  async function ensureDefaultProvider() {
    if (getProvider(DEFAULT_OPENROUTER_PROVIDER_ID)) return
    providersStore.createProvider({
      id: DEFAULT_OPENROUTER_PROVIDER_ID,
      name: 'OpenRouter',
      type: 'openrouter',
      endpoint: undefined,
      apiKey: undefined,
      isDefault: true,
    })
    console.log('Created default OpenRouter provider')
  }

  async function ensureDefaultProfile() {
    if (getPreset(DEFAULT_AI_PROFILE_ID)) return
    presetsStore.createPreset({
      ...aiPresetDefaults,
      id: DEFAULT_AI_PROFILE_ID,
      name: 'Claude Sonnet 4.5',
      providerId: DEFAULT_OPENROUTER_PROVIDER_ID,
      model: 'anthropic/claude-sonnet-4.5',
      isDefault: true,
    })
    console.log('Created default AI preset')
  }

  const providers = computed(() => providersStore.getAllProvidersOrdered())
  const getProvider = id => providersStore.getProvider(id)
  const createProvider = provider => providersStore.createProvider(provider)
  const updateProvider = (id, updates) => providersStore.updateProvider(id, updates)
  const deleteProvider = id => providersStore.deleteProvider(id)
  const reloadProvider = id => providersStore.reloadProvider(id)

  const presets = computed(() => presetsStore.getAllPresetsOrdered())
  const getPreset = id => presetsStore.getPreset(id)
  const updatePreset = (id, updates) => presetsStore.updatePreset(id, updates)

  /**
   * Create a preset and switch to it.
   *
   * Starts on the active preset's provider — a new preset is nearly always
   * Copied from the one in use, tuning and all, because that is what somebody
   * reaching for a new preset almost always wants: the same setup pointed at
   * another model. Starting blank meant re-entering a sampler tune every time,
   * which is what the old separate Duplicate was for.
   *
   * @param {string} [name] - Display name
   * @returns {AIPreset}
   */
  function createPreset(name = 'New preset') {
    const source = activeAIPreset.value

    const preset = presetsStore.createPreset({
      ...aiPresetDefaults,
      name,
      providerId: source?.providerId || DEFAULT_OPENROUTER_PROVIDER_ID,
      model: source?.model || '',
      toolsEnabled: source?.toolsEnabled !== false,
      generationOverrides: { ...(source?.generationOverrides || {}) },
    })
    setActiveAIPreset(preset.id)
    return preset
  }

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

    // Preset (single shared)
    presets,
    getPreset,
    createPreset,
    updatePreset,
    deletePreset,
    activeAIPresetId,
    activeAIPreset,
    setActiveAIPreset,
    aiPresetDefaults,
  }
}
