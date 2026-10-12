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
 * Whether the connection can be asked what it serves. A server needs its
 * address; a hosted service needs its key, except OpenRouter, whose list is
 * public.
 *
 * @param {{ type?: string, apiKey?: string, endpoint?: string } | null | undefined} provider
 * @returns {boolean}
 */
export function canListModels(provider) {
  if (!provider) return false
  const gap = connectionGap(provider)
  return !gap || (gap === 'key' && provider.type === 'openrouter')
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
