/**
 * @module composables/useGenerationSettings
 * @description Read and write a model's generation settings on a connection:
 * sampler parameters, seed, max tokens, how the model's reasoning shows, and
 * how many tool rounds a turn may take.
 *
 * Three layers: the app's defaults, then the samplers the model's makers say
 * it runs best at (its list's `defaults`), then the writer's changes, kept
 * sparsely: a key is present only once the writer has changed it, so an
 * untouched one keeps up with the layers below. The model's settings are
 * made the first time one is changed (`changeModelSettings` in useAIConfig).
 * `effective` is what a request would actually use.
 */

import { computed, toValue } from 'vue'
import { resolveAISettings } from '@/ai/defaults.js'
import { useAIConfig } from './useAIConfig.js'
import { useModelLists } from './useModelLists.js'

/**
 * @typedef {import('../ai/defaults.js').AIDefaults} AIDefaults
 * @typedef {import('../ai/defaults.js').AISettingsOverrides} AISettingsOverrides
 * @typedef {keyof AIDefaults['parameters']} ParameterKey
 * @typedef {'maxTokens'|'seed'|'reasoningEffort'|'showModelReasoning'|'maxToolRounds'} SettingKey
 */

/**
 * @param {import('vue').MaybeRefOrGetter<string|null|undefined>} providerId
 * @param {import('vue').MaybeRefOrGetter<string|null|undefined>} model
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
export function useGenerationSettings(providerId, model) {
  const aiConfig = useAIConfig()
  const { listOf } = useModelLists()

  const stored = computed(() => aiConfig.settingsOf(toValue(providerId), toValue(model)))
  const overrides = computed(() => stored.value?.generationOverrides || {})

  /** The samplers the model's list says it runs best at, where it says. */
  const modelDefaults = computed(() => {
    const id = toValue(providerId)
    const name = toValue(model) || ''
    const listed = id ? listOf(id)?.models : undefined
    return listed?.find(entry => entry.id === name)?.traits?.defaults
  })

  const effective = computed(() => resolveAISettings(overrides.value, modelDefaults.value))

  /**
   * Keep a whole overrides object, dropping an empty `parameters` bag so a
   * model with everything reset keeps `{}` rather than empty husks.
   * @param {AISettingsOverrides} next
   */
  const write = next => {
    const id = toValue(providerId)
    const name = toValue(model)
    if (!id || !name) return
    if (next.parameters && Object.keys(next.parameters).length === 0) delete next.parameters
    aiConfig.changeModelSettings(id, name, { generationOverrides: next })
  }

  /** @param {SettingKey|'parameters'} key */
  const isOverridden = key => key in overrides.value
  /** @param {ParameterKey} key */
  const isParameterOverridden = key => key in (overrides.value.parameters || {})

  /** @param {SettingKey} key @param {any} value */
  const setSetting = (key, value) => write({ ...overrides.value, [key]: value })

  /** @param {ParameterKey} key @param {number} value */
  const setParameter = (key, value) =>
    write({
      ...overrides.value,
      parameters: { ...(overrides.value.parameters || {}), [key]: value },
    })

  /** @param {Array<SettingKey|'parameters'>} keys */
  const resetSettings = keys => {
    const next = { ...overrides.value }
    for (const key of keys) delete next[key]
    write(next)
  }

  /** @param {ParameterKey} key */
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
