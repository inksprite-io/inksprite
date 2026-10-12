/**
 * @module ai/models
 * @description What a connection serves, and what each of its models can do.
 *
 * The model pickers ask for a list (composables/useModelLists.js), and so,
 * for OpenRouter, does a request: OpenRouter's list is the only place that
 * says which parameters a model there takes and how it reasons, and a request
 * is fitted to that (ai/capabilities.js). Its answer is kept for the page, so
 * a request asks once at most, and not at all once a picker has.
 *
 * Anthropic's list is asked of its own API (ai/anthropic.js), which keeps what
 * each model can do itself.
 *
 * A connection that speaks has a second list, of the models narration can
 * read with, and what voices each has where that can be known
 * (`listSpeechModels`).
 */

import { fetch } from '@/platform/fetch.js'
import { attributionHeaders, modelsUrl } from '@/ai/wire.js'
import { BUILT_IN_PROVIDERS, providerDoes, servesChat } from '@/ai/providers.js'
import { LEVELS } from '@/ai/capabilities.js'
import { listAnthropicModels } from '@/ai/anthropic.js'

/**
 * @typedef {import('@/types/models.js').AIProvider} AIProvider
 * @typedef {import('@/ai/capabilities.js').ModelTraits} ModelTraits
 * @typedef {import('@/ai/capabilities.js').Sampler} Sampler
 */

/**
 * One model a connection serves.
 *
 * @typedef {Object} AIModel
 * @property {string} id
 * @property {string} name
 * @property {ModelTraits} [traits] - What the list says it can do, where it says
 * @property {string[]} [voices] - A speech model's voices, where its connection
 *   says which; otherwise they are asked of the server (`tts/client.js`)
 * @property {number} [inputLimit] - The most a speech model reads in one
 *   request, in characters, where that is known
 */

/** @type {Record<string, Sampler>} OpenRouter's parameter names, as the settings call them */
const SAMPLER_NAMES = {
  temperature: 'temperature',
  top_p: 'topP',
  top_k: 'topK',
  min_p: 'minP',
  top_a: 'topA',
  frequency_penalty: 'frequencyPenalty',
  presence_penalty: 'presencePenalty',
  repetition_penalty: 'repetitionPenalty',
  seed: 'seed',
}

/**
 * What OpenRouter's list says a model can do.
 *
 * `supported_parameters` is every parameter any of the model's providers
 * takes. `reasoning` says whether its reasoning can be turned off, which
 * efforts it takes, and which it reasons at untold. A model whose reasoning
 * is set by a token budget lists no efforts and says it takes `max_tokens`
 * instead, and OpenRouter sets the budget from an effort for it.
 *
 * @param {Record<string, any>} model - One entry of OpenRouter's `/models`
 * @returns {ModelTraits}
 */
export function openRouterTraits(model) {
  const parameters = Array.isArray(model.supported_parameters) ? model.supported_parameters : null
  /** @type {ModelTraits} */
  const traits = {}
  if (parameters) {
    traits.samplers = parameters.map(name => SAMPLER_NAMES[name]).filter(Boolean)
  }

  const reasoning = model.reasoning
  if (reasoning) {
    const efforts = Array.isArray(reasoning.supported_efforts) ? reasoning.supported_efforts : []
    /** @type {Array<import('@/ai/capabilities.js').ReasoningEffort>} */
    let levels = LEVELS.filter(level => efforts.includes(level))
    if (levels.length === 0 && reasoning.supports_max_tokens) levels = ['low', 'medium', 'high']
    traits.reasoning = {
      optional: !reasoning.mandatory,
      levels,
      defaultLevel: levels.find(level => level === reasoning.default_effort),
    }
  } else if (parameters && !parameters.includes('reasoning')) {
    traits.reasoning = null
  }
  return traits
}

/**
 * The entries of a `/models` answer, as the service gave them.
 *
 * @param {Response} response
 * @returns {Promise<Array<Record<string, any>>>}
 * @throws {Error} When the provider refused, or answered with no list
 */
async function entriesOf(response) {
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Connection failed' }))
    throw new Error(error.error?.message || error.error || `HTTP ${response.status}`)
  }

  const data = await response.json()
  if (!data.data || !Array.isArray(data.data)) {
    throw new Error('Invalid response format from provider')
  }
  // Gemini lists its models under their resource names, `models/gemini-…`,
  // and is asked for them by the bare id.
  return data.data.map(model => ({ ...model, id: String(model.id).replace(/^models\//, '') }))
}

/**
 * @param {AIModel[]} models
 * @returns {AIModel[]}
 */
const byName = models =>
  models.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))

/**
 * The models in a `/models` answer that a chat can use, by name.
 *
 * @param {Response} response
 * @param {AIProvider} provider - Whose list it is
 * @returns {Promise<AIModel[]>}
 * @throws {Error} When the provider refused, or answered with no list
 */
async function parseModelsResponse(response, provider) {
  const entries = await entriesOf(response)
  console.log(`Found ${entries.length} models from ${provider.name}:`, entries)
  return byName(
    entries
      .filter(model => servesChat(provider.type, model.id))
      .map(model => {
        /** @type {AIModel} */
        const entry = { id: model.id, name: model.name || model.id }
        if (provider.type === 'openrouter') entry.traits = openRouterTraits(model)
        return entry
      })
  )
}

/**
 * @param {AIProvider} provider
 * @returns {Record<string, string>}
 */
function listHeaders(provider) {
  /** @type {Record<string, string>} */
  const headers = { 'Content-Type': 'application/json', ...attributionHeaders(provider) }
  if (provider.apiKey) headers.Authorization = `Bearer ${provider.apiKey}`
  return headers
}

/** @type {Map<string, Promise<Map<string, AIModel>>>} Each OpenRouter connection's list, by its id */
const catalogs = new Map()

/**
 * @param {AIModel[]} models
 * @returns {Map<string, AIModel>}
 */
const byId = models => new Map(models.map(model => [model.id, model]))

/**
 * Ask a connection what it serves.
 *
 * @param {AIProvider} provider
 * @returns {Promise<AIModel[]>} Those a chat can use, by name
 * @throws {Error} When it can't be reached or refuses
 */
export async function listModels(provider) {
  if (provider.type === 'anthropic') return listAnthropicModels(provider)

  const response = await fetch(modelsUrl(provider), {
    method: 'GET',
    headers: listHeaders(provider),
  })
  const models = await parseModelsResponse(response, provider)
  if (provider.type === 'openrouter') catalogs.set(provider.id, Promise.resolve(byId(models)))
  return models
}

/**
 * What the connection's list says of a model, for the one connection whose
 * list says what a request needs: OpenRouter's. Asked for once, the first
 * time a request needs it and no picker has asked yet; a list that couldn't
 * be had is nothing known, and is asked for again next time.
 *
 * @param {AIProvider} provider
 * @param {string} [model]
 * @returns {Promise<ModelTraits|undefined>}
 */
export async function traitsOf(provider, model) {
  if (provider.type !== 'openrouter' || !model) return undefined
  let catalog = catalogs.get(provider.id)
  if (!catalog) {
    catalog = listModels(provider).then(byId)
    catalogs.set(provider.id, catalog)
  }
  try {
    const models = await catalog
    // A variant OpenRouter routes by (`:nitro`, `:floor`) isn't listed apart
    // from its model.
    return (models.get(model) ?? models.get(model.replace(/:[^/]*$/, '')))?.traits
  } catch (error) {
    if (catalogs.get(provider.id) === catalog) catalogs.delete(provider.id)
    console.warn(`Could not ask ${provider.name} what ${model} takes:`, error)
    return undefined
  }
}

/**
 * OpenAI's voices, which it has no list of to ask: the ones its speech guide
 * names. `tts-1` and `tts-1-hd` read in the first nine; the four after them
 * are newer, and `gpt-4o-mini-tts` alone has them.
 */
const OPENAI_VOICES = Object.freeze([
  'alloy',
  'ash',
  'coral',
  'echo',
  'fable',
  'nova',
  'onyx',
  'sage',
  'shimmer',
  'ballad',
  'verse',
  'marin',
  'cedar',
])

/** The most OpenAI's speech endpoint reads in one request, in characters. */
const OPENAI_INPUT_LIMIT = 4096

/**
 * @param {string} id
 * @returns {string[]}
 */
const openAIVoices = id => [...(/^tts-1/.test(id) ? OPENAI_VOICES.slice(0, 9) : OPENAI_VOICES)]

/**
 * Ask a connection which models it reads aloud with, by name. OpenRouter
 * lists them apart from its chat models, each with its voices; OpenAI lists
 * them among everything else, and its voices are known here; any other server
 * lists what it lists, and is asked for its voices when they are wanted.
 * Kokoro-FastAPI lists one model under four names, the three besides `kokoro`
 * being OpenAI's for clients that ask for those; only `kokoro` is shown.
 *
 * @param {AIProvider} provider
 * @returns {Promise<AIModel[]>}
 * @throws {Error} When it can't be reached or refuses
 */
export async function listSpeechModels(provider) {
  if (!providerDoes(provider, 'speech')) return []

  const url =
    provider.type === 'openrouter'
      ? `${modelsUrl(provider)}?output_modalities=speech`
      : modelsUrl(provider)
  const response = await fetch(url, { method: 'GET', headers: listHeaders(provider) })
  const entries = await entriesOf(response)

  if (provider.type === 'openrouter') {
    return byName(
      entries.map(model => {
        /** @type {AIModel} */
        const entry = { id: model.id, name: model.name || model.id }
        if (Array.isArray(model.supported_voices) && model.supported_voices.length > 0) {
          entry.voices = model.supported_voices.filter(voice => typeof voice === 'string')
        }
        if (model.context_length > 0) entry.inputLimit = model.context_length
        return entry
      })
    )
  }
  if (provider.type === 'openai') {
    return byName(
      entries
        .filter(model => /tts/.test(model.id))
        .map(model => ({
          id: model.id,
          name: model.id,
          voices: openAIVoices(model.id),
          inputLimit: OPENAI_INPUT_LIMIT,
        }))
    )
  }
  const server = BUILT_IN_PROVIDERS.find(entry => entry.id === provider.id)?.server
  const listed = entries.map(model => ({ id: model.id, name: model.name || model.id }))
  if (server === 'kokoro' && listed.some(model => model.id === 'kokoro')) {
    return listed.filter(model => model.id === 'kokoro')
  }
  return byName(listed)
}
