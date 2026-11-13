/**
 * @module ai/providers
 * @description What kind of server is on the other end of a connection.
 *
 * Most of what a connection needs is the same everywhere: an OpenAI-shaped
 * endpoint, a key, a list of models. The type exists for the places that
 * genuinely differ — where the API lives, which of the dozen reasoning
 * conventions the server speaks, whether an address has to be typed in at all.
 *
 * `generic` is the honest default and stays the fallback: an OpenAI-compatible
 * server we know nothing else about, spoken to in the subset everyone
 * implements. A named type earns its place by making a request different, so
 * adding one that changes nothing is worse than leaving the server on generic
 * — it is a setting that looks like it does something. LM Studio has no
 * reasoning parameter to send, so it is generic and should stay generic, and
 * so are vLLM, Ollama and KoboldCpp: the built-in connections to them differ
 * only in where they look.
 */

import { ConnectionNeededError, ProviderNotConfiguredError } from '@/utils/errors.js'

/**
 * @typedef {Object} ProviderType
 * @property {string} id - Stored on providers, so renaming one orphans every
 *   connection saved under it
 * @property {string} label - The short name, for a line that already says
 *   what it is naming
 * @property {string} menu - The name in the type menu, which has room to say more
 * @property {string} [address] - Where the API lives, for a hosted service
 *   whose address is known without asking. A type without one is a server
 *   someone runs, and is told where it is.
 * @property {boolean} [key] - Whether nothing gets through without an API key
 * @property {boolean} [hidden] - Left out of the type menu and the built-in
 *   connections: known here, but not offered yet
 * @property {RegExp} [notChat] - The models in the service's list that a chat
 *   cannot use (embeddings, speech, pictures, and OpenAI's that answer only its
 *   Responses API), which a model picker leaves out
 * @property {ReadonlyArray<ProviderKind>} [does] - What a connection of this
 *   type can be asked for; a chat alone when absent
 * @property {SignIn} [signIn] - Where the writer signs in to have a key made
 *   for them, for a service that offers it
 * @property {string} [credits] - Where an account buys more, for a service
 *   that answers 402 when it has run out
 */

/**
 * A service's sign-in, OAuth with PKCE as OpenRouter has it: the writer is
 * sent to `authorize` with a challenge, comes back with a code, and the code
 * is traded at `exchange` for an API key (`composables/useSignIn.js`).
 *
 * @typedef {Object} SignIn
 * @property {string} authorize - Where the writer is sent
 * @property {string} exchange - Where the code is traded for a key
 * @property {Record<string, string>} [params] - What else the sign-in is told
 */

/**
 * What a connection is asked for: a chat's replies, or speech, for narration
 * and reading aloud.
 *
 * @typedef {'chat'|'speech'} ProviderKind
 */

/**
 * Every connection type, in the order the settings menu offers them.
 *
 * @type {ProviderType[]}
 */
export const PROVIDER_TYPES = [
  {
    id: 'openrouter',
    label: 'OpenRouter',
    menu: 'OpenRouter',
    address: 'https://openrouter.ai/api/v1/',
    key: true,
    does: ['chat', 'speech'],
    signIn: {
      authorize: 'https://openrouter.ai/auth',
      exchange: 'https://openrouter.ai/api/v1/auth/keys',
    },
    credits: 'https://openrouter.ai/settings/credits',
  },
  {
    // Not OpenAI-shaped at all: spoken to in its own API, by ai/anthropic.js.
    id: 'anthropic',
    label: 'Anthropic',
    menu: 'Anthropic',
    address: 'https://api.anthropic.com/v1/',
    key: true,
  },
  {
    // Its own type for the address and `max_completion_tokens` (the
    // reasoning models refuse `max_tokens`).
    id: 'openai',
    label: 'OpenAI',
    menu: 'OpenAI',
    address: 'https://api.openai.com/v1/',
    key: true,
    does: ['chat', 'speech'],
    notChat:
      /embedding|tts|whisper|transcribe|dall-e|gpt-image|moderation|realtime|audio|davinci|babbage|instruct|sora|codex|-pro\b|computer-use|deep-research/,
  },
  {
    // OpenRouter's request, near enough: its `reasoning` object, the samplers
    // passed on to whoever serves the model, a list anyone may read. The list
    // says less of each model, and prices by the million (ai/models.js).
    id: 'nanogpt',
    label: 'NanoGPT',
    menu: 'NanoGPT',
    address: 'https://api.nano-gpt.com/api/v1/',
    key: true,
    does: ['chat', 'speech'],
    signIn: {
      authorize: 'https://nano-gpt.com/auth',
      exchange: 'https://nano-gpt.com/api/v1/auth/keys',
      params: {
        client_name: 'inksprite',
        scope: 'api.use models.read',
        // inksprite's referral link (nano-gpt.com/r/GNjxyGKL). An account
        // made during the sign-in is referred, if the writer leaves NanoGPT's
        // checkbox for it ticked: they get 5% off, and inksprite a share of
        // what they spend. An account made before is never referred.
        invitation_code: 'GNjxyGKL',
      },
    },
    credits: 'https://nano-gpt.com/balance',
  },
  {
    // Gemini's OpenAI-compatible endpoint. It takes `reasoning_effort`, and
    // answers a browser only when the request carries no headers it has not
    // heard of, so OpenRouter's attribution stays with OpenRouter. Hidden
    // until it has been tried with a key: Gemini 3 signs its thinking, and
    // may want the signature on a tool call back, which nothing keeps yet.
    id: 'gemini',
    label: 'Gemini',
    menu: 'Google Gemini',
    address: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    key: true,
    hidden: true,
    notChat: /embedding|imagen|veo|aqa|tts|image|live|native-audio/,
  },
  { id: 'llamacpp', label: 'llama.cpp', menu: 'llama.cpp (llama-server)' },
  // A server nothing else is known of may chat, speak, or both: it is offered
  // for both, and says so if it can't.
  {
    id: 'generic',
    label: 'Generic',
    menu: 'Generic (OpenAI compatible)',
    does: ['chat', 'speech'],
  },
]

/**
 * The connections every install has, in the order the provider menus list
 * them: the hosted services, then the servers people run at home, each at the
 * address it listens on when started without being told. They are created on
 * start when missing and can't be deleted or renamed; an address or a key is
 * the writer's to change.
 *
 * `id` is what presets point at, so it never changes. `server` names the
 * server behind a generic connection, for what it takes (ai/capabilities.js),
 * and `does` what it can be asked for, where that is less than its type's.
 *
 * @type {ReadonlyArray<{id: string, name: string, type: import('@/types/models.js').AIProvider['type'], endpoint?: string, server?: string, does?: ReadonlyArray<ProviderKind>}>}
 */
export const BUILT_IN_PROVIDERS = Object.freeze([
  { id: 'provider_openrouter_default', name: 'OpenRouter', type: 'openrouter' },
  { id: 'provider_anthropic_default', name: 'Anthropic', type: 'anthropic' },
  { id: 'provider_openai_default', name: 'OpenAI', type: 'openai' },
  {
    id: 'provider_lmstudio_default',
    name: 'LM Studio',
    type: 'generic',
    endpoint: 'http://localhost:1234/v1',
    server: 'lmstudio',
    does: ['chat'],
  },
  {
    id: 'provider_ollama_default',
    name: 'Ollama',
    type: 'generic',
    endpoint: 'http://localhost:11434/v1',
    server: 'ollama',
    does: ['chat'],
  },
  {
    id: 'provider_llamacpp_default',
    name: 'llama.cpp',
    type: 'llamacpp',
    endpoint: 'http://localhost:9931/v1',
  },
  {
    id: 'provider_vllm_default',
    name: 'vLLM',
    type: 'generic',
    endpoint: 'http://localhost:8000/v1',
    server: 'vllm',
    does: ['chat'],
  },
  {
    id: 'provider_koboldcpp_default',
    name: 'KoboldCpp',
    type: 'generic',
    endpoint: 'http://localhost:5001/v1',
    server: 'koboldcpp',
    does: ['chat'],
  },
  {
    // Kokoro-FastAPI, where it listens when run as its README runs it. It
    // speaks and can't chat.
    id: 'provider_kokoro_default',
    name: 'Kokoro',
    type: 'generic',
    endpoint: 'http://localhost:8880/v1',
    server: 'kokoro',
    does: ['speech'],
  },
])

/** The connection narration speaks through until the writer picks another. */
export const DEFAULT_SPEECH_PROVIDER_ID = 'provider_kokoro_default'

/**
 * What the writer can connect to, as setup offers it: a hosted service, a
 * server of a kind they run at home, or any other that speaks OpenAI's API.
 * Each built-in connection was one of these, and the first connection of a
 * kind still takes its id, so presets made for it, and every device of the
 * writer's, find it there.
 *
 * @typedef {Object} ConnectionKind
 * @property {string} id
 * @property {string} name - What a connection of it is called to start with
 * @property {import('@/types/models.js').AIProvider['type']} type
 * @property {string} [endpoint] - Where a server of it listens when started
 *   without being told, or where a hosted service's API is, for the row
 * @property {string} [server] - The server behind a generic connection, for
 *   what it takes (ai/capabilities.js)
 * @property {ReadonlyArray<ProviderKind>} does - What it can be asked for
 * @property {string} [builtInId] - The built-in connection it was
 */

/** @type {ReadonlyArray<ConnectionKind>} */
const BUILT_IN_KINDS = BUILT_IN_PROVIDERS.map(entry => ({
  id: entry.server ?? entry.type,
  name: entry.name,
  type: entry.type,
  ...(entry.endpoint ? { endpoint: entry.endpoint } : {}),
  ...(entry.server ? { server: entry.server } : {}),
  does: entry.does ?? typeOf(entry.type)?.does ?? ['chat'],
  builtInId: entry.id,
}))

/** @type {ReadonlyArray<ConnectionKind>} */
export const CONNECTION_KINDS = Object.freeze([
  // The hosted services, then the servers people run at home.
  ...BUILT_IN_KINDS.filter(kind => knownAddress(kind.type)),
  {
    // Never built in, so no connection to it has a fixed id. Its address
    // is kept on the row as well, though this app knows it without: an app
    // from before NanoGPT was known then reaches it as any OpenAI-compatible
    // server, rather than as one with no address.
    id: 'nanogpt',
    name: 'NanoGPT',
    type: /** @type {const} */ ('nanogpt'),
    endpoint: 'https://api.nano-gpt.com/api/v1',
    does: ['chat', 'speech'],
  },
  ...BUILT_IN_KINDS.filter(kind => !knownAddress(kind.type)),
  {
    id: 'generic',
    name: 'OpenAI-compatible',
    type: /** @type {const} */ ('generic'),
    does: ['chat', 'speech'],
  },
])

/**
 * A kind by its id.
 * @param {string|null|undefined} id
 * @returns {ConnectionKind|undefined}
 */
export function connectionKind(id) {
  return CONNECTION_KINDS.find(kind => kind.id === id)
}

/**
 * What kind a connection is: the server it names, the built-in it is, else
 * its type, and an OpenAI-compatible server for anything else.
 *
 * @param {{id?: string, type?: string, server?: string}|null|undefined} provider
 * @returns {ConnectionKind}
 */
export function kindOf(provider) {
  const builtIn = BUILT_IN_PROVIDERS.find(entry => entry.id === provider?.id)
  const id = provider?.server ?? builtIn?.server ?? provider?.type
  return connectionKind(id) ?? /** @type {ConnectionKind} */ (connectionKind(DEFAULT_PROVIDER_TYPE))
}

/**
 * Whether a built-in connection is as every install made it, with nothing of
 * the writer's in it: not added by them, no key, no routing, its own
 * address. Since setup took their place they are made no more, but older
 * devices still make them. Neither sync nor a settings file carries one.
 *
 * @param {any} provider
 * @returns {boolean}
 */
export function untouchedBuiltIn(provider) {
  const builtIn = BUILT_IN_PROVIDERS.find(entry => entry.id === provider?.id)
  if (!builtIn || provider.added) return false
  return (
    !provider.apiKey && !provider.routing && (provider.endpoint || '') === (builtIn.endpoint || '')
  )
}

/**
 * The connections the provider menus list, in their order: the built-in ones
 * first, in their own order, then the writer's, in the order given. One of a
 * type not offered yet is left out: Gemini was a built-in for a while, and an
 * install that made it then can't delete it.
 *
 * @template {{id: string, type?: string}} T
 * @param {T[]} providers
 * @returns {T[]}
 */
export function inMenuOrder(providers) {
  const rank = new Map(BUILT_IN_PROVIDERS.map((entry, index) => [entry.id, index]))
  const last = BUILT_IN_PROVIDERS.length
  return providers
    .filter(provider => !typeOf(provider.type)?.hidden)
    .map((provider, index) => ({ provider, index }))
    .sort(
      (a, b) =>
        (rank.get(a.provider.id) ?? last) - (rank.get(b.provider.id) ?? last) || a.index - b.index
    )
    .map(({ provider }) => provider)
}

/**
 * @param {string} [type]
 * @returns {ProviderType | undefined}
 */
function typeOf(type) {
  return PROVIDER_TYPES.find(entry => entry.id === type)
}

/**
 * Whether a connection can be asked for this: from which built-in it is, else
 * its type. So Kokoro is never offered to a chat, and Anthropic never to
 * narration.
 *
 * @param {{id?: string, type?: string} | null | undefined} provider
 * @param {ProviderKind} kind
 * @returns {boolean}
 */
export function providerDoes(provider, kind) {
  if (!provider) return false
  const builtIn = BUILT_IN_PROVIDERS.find(entry => entry.id === provider.id)
  // A type not known here reads as generic, as its label does.
  const type = typeOf(provider.type) ?? typeOf(DEFAULT_PROVIDER_TYPE)
  return (builtIn?.does ?? type?.does ?? ['chat']).includes(kind)
}

/** The type a connection falls back to when it does not say, or says something unknown. */
export const DEFAULT_PROVIDER_TYPE = 'generic'

/**
 * What to call a connection of this type.
 *
 * A type saved before it was known here — or after it stopped being — reads as
 * generic rather than as nothing, because a connection with a blank type in
 * front of it looks broken when it is merely unfamiliar.
 *
 * @param {string} [type]
 * @returns {string}
 */
export function providerLabel(type) {
  return (typeOf(type) || { label: 'Generic' }).label
}

/**
 * Where a hosted service's API lives, or undefined for a server someone runs,
 * whose address is on the connection.
 *
 * @param {string} [type]
 * @returns {string | undefined}
 */
export function knownAddress(type) {
  return typeOf(type)?.address
}

/**
 * Whether this type has to be told where to find its API.
 *
 * A hosted service's address is known without being asked. Everything else is
 * a server someone is running, and a connection to one with no endpoint has
 * nowhere to go — so this is what validation asks, rather than naming the
 * types one at a time and forgetting the next one.
 *
 * @param {string} [type]
 * @returns {boolean}
 */
export function needsEndpoint(type) {
  return !knownAddress(type)
}

/**
 * Whether this type gets nothing through without an API key. A server someone
 * runs may ask for one, and the connection then has it, but goes without by
 * default.
 *
 * @param {string} [type]
 * @returns {boolean}
 */
export function needsKey(type) {
  return !!typeOf(type)?.key
}

/**
 * What a connection is still missing before a request can go through it, or
 * null when nothing is. `key` is a hosted service with no API key; `endpoint`
 * is a self-hosted server with no address. The settings show it beside the
 * connection, so nothing looks ready that is not.
 *
 * @param {{ type?: string, apiKey?: string, endpoint?: string } | null | undefined} provider
 * @returns {'key'|'endpoint'|null}
 */
export function connectionGap(provider) {
  if (!provider) return null
  if (needsKey(provider.type) && !provider.apiKey) return 'key'
  if (needsEndpoint(provider.type) && !provider.endpoint) return 'endpoint'
  return null
}

/**
 * What stands between a preset and a request through it, as the error the
 * request would fail with, or null when nothing does: no connection, no
 * model, or a connection still missing its key or address. What a chat says
 * above its box.
 *
 * @param {{ providerId?: string, model?: string } | null | undefined} preset
 * @param {(id: string) => { id: string, name?: string, type?: string, apiKey?: string, endpoint?: string } | null | undefined} findProvider
 * @returns {Error|null}
 */
export function presetProblem(preset, findProvider) {
  const provider = preset?.providerId ? findProvider(preset.providerId) : null
  if (!preset || !provider) return new ProviderNotConfiguredError('No AI provider is connected.')
  if (!preset.model) return new Error('Choose a model for this chat.')
  if (connectionGap(provider)) {
    return new ConnectionNeededError(`${provider.name} isn't connected.`, provider.id)
  }
  return null
}

/**
 * Whether the connection can be asked what it serves. A server needs its
 * address; a hosted service needs its key, except OpenRouter and NanoGPT,
 * whose lists are public.
 *
 * @param {{ type?: string, apiKey?: string, endpoint?: string } | null | undefined} provider
 * @returns {boolean}
 */
export function canListModels(provider) {
  if (!provider) return false
  const gap = connectionGap(provider)
  return !gap || (gap === 'key' && listsPublicly(provider.type))
}

/**
 * Whether this service's list of models is public, asked without a key, and
 * so says nothing of whether a key is good.
 *
 * @param {string} [type]
 * @returns {boolean}
 */
export function listsPublicly(type) {
  return type === 'openrouter' || type === 'nanogpt'
}

/**
 * Where the writer signs in to this service to have a key made, or undefined
 * for one that offers no sign-in.
 *
 * @param {string} [type]
 * @returns {SignIn|undefined}
 */
export function signInOf(type) {
  return typeOf(type)?.signIn
}

/**
 * Where an account with this service buys more, or undefined for a service
 * that doesn't sell by the request.
 *
 * @param {string} [type]
 * @returns {string|undefined}
 */
export function creditsPage(type) {
  return typeOf(type)?.credits
}

/**
 * Whether a request to this service is told about reasoning as OpenRouter
 * tells it: a `reasoning` object, with an effort, `enabled` and `exclude`.
 * NanoGPT took the same shape.
 *
 * @param {string} [type]
 * @returns {boolean}
 */
export function speaksOpenRouterReasoning(type) {
  return type === 'openrouter' || type === 'nanogpt'
}

/**
 * Whether a model in this service's list is one a chat can use. Most lists
 * are only chat models; OpenAI's and Gemini's carry their embeddings, speech
 * and picture models too, which answer a chat with an error.
 *
 * @param {string | undefined} type
 * @param {string} id - The model's id, as the service lists it
 * @returns {boolean}
 */
export function servesChat(type, id) {
  const notChat = typeOf(type)?.notChat
  return !notChat || !notChat.test(id.toLowerCase())
}

/**
 * Whether a request to this service may name a reasoning effort level, as
 * `reasoning_effort`. OpenRouter says it its own way, in `reasoning`.
 *
 * Not OpenAI's chat completions, though they have the field: the models that
 * don't reason refuse it, and the newest ones refuse it alongside tools,
 * which the chat always offers ("use /v1/responses"). Each model reasons at
 * its own default instead, which works on every one of them.
 *
 * @param {string} [type]
 * @returns {boolean}
 */
export function takesReasoningEffort(type) {
  return type === 'gemini'
}

/**
 * Whether a request to this server may carry `chat_template_kwargs`.
 *
 * llama-server passes that object into the Jinja chat template it renders. A
 * template that reads `enable_thinking` — Qwen3's does, and it is the way its
 * thinking is meant to be switched off — emits an empty think block instead of
 * inviting one, which is what actually stops the model reasoning. A template
 * that has never heard of the key ignores it: it is an argument to a template,
 * not a field the server has to recognise, so nothing 400s over it.
 *
 * @param {string} [type]
 * @returns {boolean}
 */
export function takesChatTemplateKwargs(type) {
  return type === 'llamacpp'
}
