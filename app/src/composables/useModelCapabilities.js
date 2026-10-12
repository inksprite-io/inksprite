/**
 * @module composables/useModelCapabilities
 * @description What the generation settings can ask of a connection and
 * model, for the settings that show only what it takes.
 *
 * Reads the list the model pickers share (useModelLists), so a model is known
 * better once its connection's list has come back; until then the connection
 * is offered what its kind of server takes. See ai/capabilities.js.
 */

import { computed, toValue } from 'vue'
import { capabilitiesOf } from '@/ai/capabilities.js'
import { useAIConfig } from './useAIConfig.js'
import { useModelLists } from './useModelLists.js'

/**
 * @param {import('vue').MaybeRefOrGetter<string|null|undefined>} providerId
 * @param {import('vue').MaybeRefOrGetter<string|null|undefined>} model
 * @returns {import('vue').ComputedRef<import('@/ai/capabilities.js').Capabilities>}
 */
export function useModelCapabilities(providerId, model) {
  const aiConfig = useAIConfig()
  const { listOf } = useModelLists()

  return computed(() => {
    const id = toValue(providerId)
    const name = toValue(model) || ''
    const provider = (id && aiConfig.getProvider(id)) || {}
    const listed = id ? listOf(id)?.models : undefined
    // A variant OpenRouter routes by (`:nitro`) is listed as its model.
    const entry =
      listed?.find(item => item.id === name) ??
      listed?.find(item => item.id === name.replace(/:[^/]*$/, ''))
    return capabilitiesOf(provider, name, entry?.traits)
  })
}
