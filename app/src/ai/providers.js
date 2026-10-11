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
 * reasoning parameter to send, so it is generic and should stay generic.
 */

/**
 * Every connection type, in the order the settings menu offers them.
 *
 * `id` is stored on providers, so renaming one orphans every connection saved
 * under it. `label` is the short name, for a line that already says what it is
 * naming; `menu` has room to say more.
 *
 * @type {Array<{id: string, label: string, menu: string}>}
 */
export const PROVIDER_TYPES = [
  { id: 'openrouter', label: 'OpenRouter', menu: 'OpenRouter' },
  { id: 'llamacpp', label: 'llama.cpp', menu: 'llama.cpp (llama-server)' },
  { id: 'generic', label: 'Generic', menu: 'Generic (OpenAI compatible)' },
]

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
  return (PROVIDER_TYPES.find(entry => entry.id === type) || { label: 'Generic' }).label
}

/**
 * Whether this type has to be told where to find its API.
 *
 * OpenRouter is the one address known without being asked. Everything else is
 * a server someone is running, and a connection to one with no endpoint has
 * nowhere to go — so this is what validation asks, rather than naming the
 * types one at a time and forgetting the next one.
 *
 * @param {string} [type]
 * @returns {boolean}
 */
export function needsEndpoint(type) {
  return type !== 'openrouter'
}

/**
 * What a connection is still missing before a request can go through it, or
 * null when nothing is. `key` is an OpenRouter connection with no API key;
 * `endpoint` is a self-hosted server with no address. The settings show it
 * beside the connection, so nothing looks ready that is not.
 *
 * @param {{ type?: string, apiKey?: string, endpoint?: string } | null | undefined} provider
 * @returns {'key'|'endpoint'|null}
 */
export function connectionGap(provider) {
  if (!provider) return null
  if (provider.type === 'openrouter' && !provider.apiKey) return 'key'
  if (needsEndpoint(provider.type) && !provider.endpoint) return 'endpoint'
  return null
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
