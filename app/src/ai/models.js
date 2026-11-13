/**
 * @module ai/models
 * @description What a connection serves, and what each of its models can do.
 *
 * The model pickers ask for a list (composables/useModelLists.js), and so,
 * for OpenRouter and NanoGPT, does a request: their lists are the only place
 * that says which parameters a model there takes and how it reasons, and a
 * request is fitted to that (ai/capabilities.js). The answer is kept for the
 * page, so a request asks once at most, and not at all once a picker has.
 *
 * Anthropic's list is asked of its own API (ai/anthropic.js), which keeps what
 * each model can do itself.
 *
 * A connection that speaks has a second list, of the models narration can
 * read with, and what voices each has where that can be known
 * (`listSpeechModels`).
 */

import { fetch } from '@/platform/fetch.js'
import { attributionHeaders, audioModelsUrl, modelsUrl } from '@/ai/wire.js'
import { BUILT_IN_PROVIDERS, providerDoes, servesChat } from '@/ai/providers.js'
import { LEVELS } from '@/ai/capabilities.js'
import { listAnthropicModels } from '@/ai/anthropic.js'
import { askProps } from '@/ai/llamacpp.js'

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
 * @property {boolean} [free] - OpenRouter: it costs nothing, and counts
 *   against the account's free requests
 * @property {{prompt: number, completion: number}} [pricing] - What a token
 *   costs, in dollars, read and written: OpenRouter's and NanoGPT's lists
 *   say, and for Anthropic's and OpenAI's, OpenRouter's public list
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
  if (model.context_length > 0) traits.contextLength = model.context_length
  if (parameters) traits.tools = parameters.includes('tools')
  const defaults = defaultsOf(model.default_parameters)
  if (defaults) traits.defaults = defaults
  return traits
}

/**
 * What NanoGPT's detailed list says a model can do: whether it calls tools,
 * how much it reads, and how it reasons. Not which samplers it takes, which
 * NanoGPT passes on to whoever serves the model.
 *
 * `reasoning_efforts` are the levels a model takes, `none` among them where
 * its reasoning can be turned off. A model that reasons and lists none of
 * them is described no further than OpenRouter's undescribed ones.
 *
 * @param {Record<string, any>} model - One entry of NanoGPT's
 *   `/models?detailed=true`
 * @returns {ModelTraits}
 */
export function nanoGptTraits(model) {
  /** @type {ModelTraits} */
  const traits = {}
  const capabilities = model.capabilities ?? {}
  const efforts = Array.isArray(model.reasoning_efforts) ? model.reasoning_efforts : []
  if (capabilities.reasoning === false) traits.reasoning = null
  else if (capabilities.reasoning && efforts.length > 0) {
    traits.reasoning = {
      optional: efforts.includes('none'),
      levels: LEVELS.filter(level => efforts.includes(level)),
    }
  }
  if (model.context_length > 0) traits.contextLength = model.context_length
  if (typeof capabilities.tool_calling === 'boolean') traits.tools = capabilities.tool_calling
  return traits
}

/**
 * One of the providers NanoGPT serves a model from, as a model's settings
 * offer it.
 *
 * @typedef {Object} NanoGptProvider
 * @property {string} slug - Its id, as NanoGPT's `provider.only` takes it
 * @property {string} name
 * @property {boolean} zdr - Whether NanoGPT classes it as keeping nothing
 * @property {{prompt: number, completion: number}} [pricing] - Dollars per
 *   token, NanoGPT's fee for choosing it included
 */

/**
 * Whether NanoGPT lets a model's providers be chosen, and the ones serving it
 * now.
 *
 * @typedef {Object} NanoGptProviders
 * @property {boolean} selectable
 * @property {NanoGptProvider[]} providers - By name
 */

/**
 * What NanoGPT's `/api/models/<id>/providers` says of a model. A model that
 * runs on a fixed route (Claude, GPT, Gemini) says it can't be chosen for and
 * lists nobody. A provider it lists as unavailable is left out: a choice of
 * it would only fail.
 *
 * @param {any} data
 * @returns {NanoGptProviders}
 */
export function nanoGptProvidersOf(data) {
  const listed = Array.isArray(data?.providers) ? data.providers : []
  const providers = listed
    .filter(entry => typeof entry?.provider === 'string' && entry.provider && entry.available)
    .map(entry => {
      /** @type {NanoGptProvider} */
      const provider = {
        slug: entry.provider,
        name:
          typeof entry.displayName === 'string' && entry.displayName
            ? entry.displayName
            : entry.provider,
        zdr: entry.privacy?.classification === 'zdr',
      }
      const prompt = Number(entry.pricing?.inputPer1kTokens)
      const completion = Number(entry.pricing?.outputPer1kTokens)
      if (Number.isFinite(prompt) && Number.isFinite(completion)) {
        provider.pricing = { prompt: prompt / 1000, completion: completion / 1000 }
      }
      return provider
    })
    .sort((a, b) => a.name.localeCompare(b.name))
  return { selectable: data?.supportsProviderSelection === true, providers }
}

/**
 * The samplers a model's makers say it runs best at, as OpenRouter lists
 * them, under the settings' names. What a model's settings show and send
 * until the writer changes them.
 * @param {any} listed - The model's `default_parameters`
 * @returns {Partial<Record<Sampler, number>>|undefined}
 */
function defaultsOf(listed) {
  if (!listed || typeof listed !== 'object') return undefined
  /** @type {Partial<Record<Sampler, number>>} */
  const defaults = {}
  for (const [name, value] of Object.entries(listed)) {
    const sampler = SAMPLER_NAMES[name]
    if (sampler && sampler !== 'seed' && typeof value === 'number') defaults[sampler] = value
  }
  return Object.keys(defaults).length > 0 ? defaults : undefined
}

/**
 * What a model costs a token, read and written, or undefined where the list
 * doesn't say.
 * @param {any} pricing - The model's `pricing`
 * @param {number} [per] - How many tokens the list prices: OpenRouter's one,
 *   as strings, NanoGPT's a million, as numbers
 * @returns {{prompt: number, completion: number}|undefined}
 */
function pricingOf(pricing, per = 1) {
  if (pricing?.prompt == null || pricing?.completion == null) return undefined
  const prompt = Number(pricing.prompt) / per
  const completion = Number(pricing.completion) / per
  return Number.isFinite(prompt) && Number.isFinite(completion) && prompt >= 0 && completion >= 0
    ? { prompt, completion }
    : undefined
}

/**
 * Whether OpenRouter charges nothing for a model, in or out.
 * @param {any} pricing - The model's `pricing`, prices as strings
 * @returns {boolean}
 */
function isFree(pricing) {
  return Boolean(pricing) && Number(pricing.prompt) === 0 && Number(pricing.completion) === 0
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
    // With its status, for whoever has to tell a refused key from the rest.
    throw Object.assign(
      new Error(error.error?.message || error.error || `HTTP ${response.status}`),
      { status: response.status }
    )
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
        if (provider.type === 'openrouter') {
          entry.traits = openRouterTraits(model)
          if (isFree(model.pricing)) entry.free = true
          const pricing = pricingOf(model.pricing)
          if (pricing) entry.pricing = pricing
        }
        if (provider.type === 'nanogpt') {
          entry.traits = nanoGptTraits(model)
          const pricing = pricingOf(model.pricing, 1e6)
          if (pricing) entry.pricing = pricing
        }
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

/** @type {Map<string, Promise<Map<string, AIModel>>>} Each OpenRouter and NanoGPT connection's list, by its id */
const catalogs = new Map()

/**
 * Whether this service's list says what a request needs to know of a model,
 * and so is asked by a request no picker has asked yet.
 * @param {string} [type]
 * @returns {boolean}
 */
const describesModels = type => type === 'openrouter' || type === 'nanogpt'

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
  if (provider.type === 'anthropic')
    return withPrices('anthropic', await listAnthropicModels(provider))

  // NanoGPT's says nothing of a model but its id unless asked for the rest.
  const url =
    provider.type === 'nanogpt' ? `${modelsUrl(provider)}?detailed=true` : modelsUrl(provider)
  const response = await fetch(url, { method: 'GET', headers: listHeaders(provider) })
  const models = await parseModelsResponse(response, provider)
  if (describesModels(provider.type)) catalogs.set(provider.id, Promise.resolve(byId(models)))
  return provider.type === 'openai' ? withPrices('openai', models) : models
}

/**
 * A model's id without its maker, its date, or how its version is written:
 * Anthropic's `claude-sonnet-4-5-20250929` and OpenRouter's
 * `anthropic/claude-sonnet-4.5` are both `claude-sonnet-4-5`.
 * @param {string} id
 * @returns {string}
 */
export function plainModelId(id) {
  return id
    .toLowerCase()
    .replace(/^[^/]+\//, '')
    .replace(/-(\d{8}|\d{4}-\d{2}-\d{2})$/, '')
    .replace(/\./g, '-')
}

/** @type {Promise<Array<Record<string, any>>>|null} OpenRouter's public list, asked for once */
let publicList = null

/**
 * What each of a maker's models costs, by its plain id, from OpenRouter's
 * public list: Anthropic and OpenAI list their models without prices, and
 * OpenRouter charges what they do.
 * @param {'anthropic'|'openai'} maker
 * @returns {Promise<Map<string, {prompt: number, completion: number}>>}
 */
async function pricesOf(maker) {
  publicList ??= fetch('https://openrouter.ai/api/v1/models', { method: 'GET' })
    .then(entriesOf)
    .catch(error => {
      publicList = null
      throw error
    })
  const prices = new Map()
  for (const model of await publicList) {
    if (!String(model.id).startsWith(`${maker}/`) || String(model.id).endsWith(':batch')) continue
    const pricing = pricingOf(model.pricing)
    if (pricing && !prices.has(plainModelId(model.id))) prices.set(plainModelId(model.id), pricing)
  }
  return prices
}

/**
 * A maker's models with what each costs, where OpenRouter's list has it.
 * Without the list, they are as they came.
 * @param {'anthropic'|'openai'} maker
 * @param {AIModel[]} models
 * @returns {Promise<AIModel[]>}
 */
async function withPrices(maker, models) {
  try {
    const prices = await pricesOf(maker)
    return models.map(model => {
      const pricing = prices.get(plainModelId(model.id))
      return pricing ? { ...model, pricing } : model
    })
  } catch (error) {
    console.warn(`Could not ask OpenRouter what ${maker}'s models cost:`, error)
    return models
  }
}

/**
 * What the connection's list says of a model, for the connections whose
 * lists say what a request needs: OpenRouter's and NanoGPT's. Asked for once,
 * the first time a request needs it and no picker has asked yet; a list that
 * couldn't be had is nothing known, and is asked for again next time.
 *
 * @param {AIProvider} provider
 * @param {string} [model]
 * @returns {Promise<ModelTraits|undefined>}
 */
export async function traitsOf(provider, model) {
  if (!describesModels(provider.type) || !model) return undefined
  let catalog = catalogs.get(provider.id)
  if (!catalog) {
    catalog = listModels(provider).then(byId)
    catalogs.set(provider.id, catalog)
  }
  try {
    const models = await catalog
    // A variant routed by a suffix (OpenRouter's `:nitro`, NanoGPT's
    // `:online`) isn't listed apart from its model.
    return (models.get(model) ?? models.get(model.replace(/:[^/]*$/, '')))?.traits
  } catch (error) {
    if (catalogs.get(provider.id) === catalog) catalogs.delete(provider.id)
    console.warn(`Could not ask ${provider.name} what ${model} takes:`, error)
    return undefined
  }
}

/**
 * How many tokens a model reads and writes in one request, where its
 * connection says: OpenRouter's or NanoGPT's list, or what a llama.cpp server
 * says each of its slots holds. Nothing for any other.
 *
 * @param {AIProvider} provider
 * @param {string} [model]
 * @returns {Promise<number|undefined>}
 */
export async function contextOf(provider, model) {
  if (describesModels(provider.type)) return (await traitsOf(provider, model))?.contextLength
  if (provider.type === 'llamacpp') return (await askProps(provider)).context
  return undefined
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
 * and NanoGPT list them apart from their chat models, each with its voices;
 * OpenAI lists them among everything else, and its voices are known here; any
 * other server lists what it lists, and is asked for its voices when they are
 * wanted. NanoGPT's list of what speaks has music and transcription in it too.
 * Kokoro-FastAPI lists one model under four names, the three besides `kokoro`
 * being OpenAI's for clients that ask for those; only `kokoro` is shown.
 *
 * @param {AIProvider} provider
 * @returns {Promise<AIModel[]>}
 * @throws {Error} When it can't be reached or refuses
 */
export async function listSpeechModels(provider) {
  if (!providerDoes(provider, 'speech')) return []
  if (provider.type === 'nanogpt') return listNanoGptSpeech(provider)

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

/**
 * NanoGPT's models that read aloud, each with its voices and the most it
 * reads at once where its list says.
 *
 * @param {AIProvider} provider
 * @returns {Promise<AIModel[]>}
 */
async function listNanoGptSpeech(provider) {
  const response = await fetch(audioModelsUrl(provider), {
    method: 'GET',
    headers: listHeaders(provider),
  })
  const entries = await entriesOf(response)
  return byName(
    entries
      .filter(model => model.capabilities?.text_to_speech === true)
      .map(model => {
        /** @type {AIModel} */
        const entry = { id: model.id, name: model.name || model.id }
        const { voices, max_chars: limit } = model.supported_parameters ?? {}
        if (Array.isArray(voices) && voices.length > 0) {
          entry.voices = voices.filter(voice => typeof voice === 'string')
        }
        if (limit > 0) entry.inputLimit = limit
        return entry
      })
  )
}
