/**
 * @module composables/useModelLists
 * @description The models each provider serves, app-wide, so every model
 * picker and the provider's Connect button share one list.
 *
 * A list is asked for when the writer presses Connect or Refresh, and the
 * first time a picker shows a provider that has an address and no list yet.
 * Never as the address or key is typed: the field saves on each keystroke,
 * and a half-typed address is no server to ask. A changed address or key
 * lets the old list go instead, until the next Connect.
 *
 * A connection that speaks has two lists, its chat models and the models it
 * reads aloud with, each asked for apart: OpenRouter lists them apart.
 */

import { reactive } from 'vue'
import { useAIService } from './useAIService.js'

/** @typedef {import('./useAIService.js').AIModel} AIModel */
/** @typedef {import('@/ai/providers.js').ProviderKind} ProviderKind */

/**
 * @typedef {Object} ModelList
 * @property {AIModel[]} models - The last list the provider gave
 * @property {boolean} loading - Whether it is being asked again
 * @property {boolean} failed - Whether the last asking failed
 */

/** @type {Map<string, ModelList>} The lists asked for, by provider id and kind */
const lists = reactive(new Map())

/** Which asking is the latest, by list, so a slow answer to an older one is dropped. */
const latest = new Map()

/** @type {ReadonlyArray<ProviderKind>} */
const KINDS = ['chat', 'speech']

/**
 * @param {string} providerId
 * @param {ProviderKind} kind
 */
const keyOf = (providerId, kind) => (kind === 'chat' ? providerId : `${providerId}\n${kind}`)

/**
 * @returns {{
 *   listOf: (providerId: string, kind?: ProviderKind) => ModelList | undefined,
 *   load: (providerId: string, kind?: ProviderKind) => Promise<AIModel[]>,
 *   forget: (providerId: string) => void,
 * }}
 */
export function useModelLists() {
  const aiService = useAIService()

  /**
   * The provider's list, if it has been asked for.
   * @param {string} providerId
   * @param {ProviderKind} [kind]
   */
  const listOf = (providerId, kind = 'chat') => lists.get(keyOf(providerId, kind))

  /**
   * Ask the provider what it serves, and keep the answer for every picker.
   * @param {string} providerId
   * @param {ProviderKind} [kind]
   * @returns {Promise<AIModel[]>}
   * @throws {Error} When the provider cannot be reached or refuses
   */
  async function load(providerId, kind = 'chat') {
    const key = keyOf(providerId, kind)
    const asking = (latest.get(key) ?? 0) + 1
    latest.set(key, asking)
    if (!lists.has(key)) lists.set(key, { models: [], loading: true, failed: false })
    const list = /** @type {ModelList} */ (lists.get(key))
    list.loading = true
    try {
      const models = (await aiService.listModels(providerId, kind)) || []
      if (latest.get(key) === asking) {
        list.models = models
        list.failed = false
      }
      return models
    } catch (error) {
      if (latest.get(key) === asking) {
        list.models = []
        list.failed = true
      }
      throw error
    } finally {
      if (latest.get(key) === asking) list.loading = false
    }
  }

  /**
   * Let the provider's lists go, its address or key having changed: they
   * were another server's answer, and the next Connect asks the new one.
   * @param {string} providerId
   */
  function forget(providerId) {
    for (const kind of KINDS) {
      const key = keyOf(providerId, kind)
      latest.set(key, (latest.get(key) ?? 0) + 1)
      lists.delete(key)
    }
  }

  return { listOf, load, forget }
}
