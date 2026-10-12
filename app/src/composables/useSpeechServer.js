/**
 * @module composables/useSpeechServer
 * @description What documents are read aloud through: a project's
 * connection and model (`useNarration` says which), as a request needs them,
 * and the voices the model has, for the narration panel to pick from.
 *
 * A model's voices come with its connection's list where the connection says
 * which (OpenRouter, OpenAI). Any other server is asked at `audio/voices`, as
 * Kokoro-FastAPI answers, when the panel first opens on it: never as an
 * address or key is typed, since a half-typed address is no server to ask.
 */

import { computed, ref } from 'vue'
import { useAIConfig } from './useAIConfig.js'
import { useApplicationState } from './useApplicationState.js'
import { useModelLists } from './useModelLists.js'
import { canListModels, connectionGap, providerDoes } from '@/ai/providers.js'
import { listVoices, speechConnectionOf } from '@/tts/client.js'

/** @type {import('vue').Ref<string[]>} What `audio/voices` gave, once asked */
const asked = ref([])

/** The connection the voices were asked of, so a changed one is asked again. */
const askedOf = ref('')

/**
 * @param {string|undefined} providerId
 * @param {import('@/tts/client.js').SpeechConnection} server
 */
const askedOfOf = (providerId, server) =>
  `${providerId}\n${server.endpoint}\n${server.apiKey ?? ''}`

/**
 * @param {() => import('./useApplicationState.js').NarrationChoice} [chosen] - The
 *   connection and model; the last chosen anywhere when absent
 * @returns {{
 *   provider: import('vue').ComputedRef<import('@/types/models.js').AIProvider|null>,
 *   connection: import('vue').ComputedRef<import('@/tts/client.js').SpeechConnection|null>,
 *   configured: import('vue').ComputedRef<boolean>,
 *   via: import('vue').ComputedRef<string>,
 *   voices: import('vue').ComputedRef<string[]>,
 *   mixes: import('vue').ComputedRef<boolean>,
 *   load: () => Promise<string[]>,
 * }}
 */
export function useSpeechServer(chosen) {
  const appState = useApplicationState()
  const narration = computed(() => (chosen ? chosen() : appState.narration.value))
  const aiConfig = useAIConfig()
  const modelLists = useModelLists()

  const provider = computed(() => {
    const id = narration.value.providerId
    const found = id ? aiConfig.getProvider(id) : null
    return found && providerDoes(found, 'speech') ? found : null
  })

  /** The model as its connection lists it, once the list is in. */
  const listed = computed(() => {
    const id = provider.value?.id
    if (!id) return undefined
    return modelLists.listOf(id, 'speech')?.models.find(m => m.id === narration.value.model)
  })

  /** Whether there is somewhere to send a request: a connection that speaks, ready, and a model. */
  const configured = computed(
    () => !!provider.value && !connectionGap(provider.value) && !!narration.value.model
  )

  const connection = computed(() =>
    configured.value && provider.value
      ? speechConnectionOf(
          provider.value,
          /** @type {string} */ (narration.value.model),
          listed.value
        )
      : null
  )

  /** The connection and model, for what audio was made by. */
  const via = computed(() => `${narration.value.providerId ?? ''}\n${narration.value.model ?? ''}`)

  /** What the connection's list says, else what the server said, of the voices. */
  const voices = computed(() => {
    if (listed.value?.voices) return listed.value.voices
    const server = connection.value
    return server && askedOf.value === askedOfOf(provider.value?.id, server) ? asked.value : []
  })

  /**
   * Whether the model takes several voices mixed with `+`: Kokoro, by its
   * name, wherever it is served.
   */
  const mixes = computed(() => /kokoro/i.test(narration.value.model ?? ''))

  /**
   * The voices, asked for if they have not been: the connection's list of
   * models first, then, for a model it says no voices of, the server. A
   * server that cannot be reached offers nothing; the writer can still type
   * a voice.
   * @returns {Promise<string[]>}
   */
  async function load() {
    const current = provider.value
    if (!current || !canListModels(current)) return []
    if (!modelLists.listOf(current.id, 'speech')) {
      await modelLists.load(current.id, 'speech').catch(error => {
        console.warn('Could not list the speech models:', error)
      })
    }
    if (listed.value?.voices) return listed.value.voices
    // OpenRouter and OpenAI say a model's voices or don't; neither answers `audio/voices`.
    if (current.type === 'openrouter' || current.type === 'openai') return []
    const server = connection.value
    if (!server) return []
    const key = askedOfOf(current.id, server)
    if (askedOf.value === key) return asked.value
    try {
      asked.value = await listVoices(server)
      askedOf.value = key
    } catch (error) {
      asked.value = []
      askedOf.value = ''
      console.warn('Could not list the speech server voices:', error)
    }
    return asked.value
  }

  return { provider, connection, configured, via, voices, mixes, load }
}
