/**
 * @module composables/useGenerationSettings
 * @description Read and write the active profile's generation overrides —
 * sampler parameters, seed, max tokens, reasoning settings, and how far back
 * the model is shown its own dice and oracle calls.
 *
 * Overrides are stored sparsely: a key is present only once the user has
 * changed it, so untouched settings keep tracking AI_DEFAULTS if those are
 * retuned later. `effective` is what a request would actually use.
 */

import { computed } from 'vue'
import { resolveAISettings } from '@/ai/defaults.js'
import { useAIConfig } from './useAIConfig.js'

/**
 * @typedef {import('../ai/defaults.js').AIDefaults} AIDefaults
 * @typedef {import('../ai/defaults.js').AISettingsOverrides} AISettingsOverrides
 * @typedef {keyof AIDefaults['parameters']} ParameterKey
 * @typedef {'maxTokens'|'seed'|'reasoningEffort'|'showModelReasoning'|'replayTurns'|'maxToolRounds'} SettingKey
 *
 * @returns {{
 *   effective: import('vue').ComputedRef<AIDefaults>,
 *   isOverridden: (key: SettingKey|'parameters') => boolean,
 *   isParameterOverridden: (key: ParameterKey) => boolean,
 *   setSetting: (key: SettingKey, value: any) => void,
 *   setParameter: (key: ParameterKey, value: number) => void,
 *   resetSettings: (keys: Array<SettingKey|'parameters'>) => void,
 *   resetParameter: (key: ParameterKey) => void,
 * }}
 */
export function useGenerationSettings() {
  const aiConfig = useAIConfig()

  const profile = computed(() => aiConfig.activeAIPreset.value)
  const overrides = computed(() => profile.value?.generationOverrides || {})
  const effective = computed(() => resolveAISettings(overrides.value))

  /**
   * Persist a whole overrides object, dropping an empty `parameters` bag so a
   * fully reset profile stores `{}` rather than accumulating empty husks.
   * @param {AISettingsOverrides} next
   */
  const write = next => {
    if (!profile.value) return
    if (next.parameters && Object.keys(next.parameters).length === 0) delete next.parameters
    aiConfig.updatePreset(profile.value.id, { generationOverrides: next })
  }

  const isOverridden = key => key in overrides.value
  const isParameterOverridden = key => key in (overrides.value.parameters || {})

  const setSetting = (key, value) => write({ ...overrides.value, [key]: value })

  const setParameter = (key, value) =>
    write({
      ...overrides.value,
      parameters: { ...(overrides.value.parameters || {}), [key]: value },
    })

  const resetSettings = keys => {
    const next = { ...overrides.value }
    for (const key of keys) delete next[key]
    write(next)
  }

  const resetParameter = key => {
    const parameters = { ...(overrides.value.parameters || {}) }
    delete parameters[key]
    write({ ...overrides.value, parameters })
  }

  return {
    effective,
    isOverridden,
    isParameterOverridden,
    setSetting,
    setParameter,
    resetSettings,
    resetParameter,
  }
}
