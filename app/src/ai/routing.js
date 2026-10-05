/**
 * @module ai/routing
 * @description OpenRouter provider routing — which upstream provider is allowed
 * to serve a request, and which ones are disqualified.
 *
 * Stored on the AIProvider rather than the AI profile: these describe an
 * OpenRouter *connection*, not a model. A privacy floor ("never route to an
 * endpoint that keeps my prompts") should hold for every request made through
 * that account, not be re-chosen each time a profile is created.
 *
 * @see https://openrouter.ai/docs/guides/routing/provider-selection
 */

/**
 * @typedef {Object} OpenRouterRouting
 * @property {string[]} only - Provider slugs allowed to serve the request. Empty = any.
 * @property {string[]} ignore - Provider slugs never routed to.
 * @property {'allow'|'deny'} dataCollection - Whether providers that may store prompts are eligible.
 * @property {boolean} zdr - Restrict routing to zero-data-retention endpoints.
 * @property {string[]} quantizations - Quantization levels eligible to serve. Empty = any.
 * @property {boolean} allowFallbacks - Whether OpenRouter may fall back past the allowed set.
 */

/**
 * The policy a connection has until someone changes it.
 *
 * Not the neutral one. Left to itself OpenRouter routes by price, to whichever
 * endpoint is cheapest this minute, including ones that keep a copy of the
 * prompt and ones that may train on it, at whatever precision they chose to
 * serve — and the cheapest is usually four-bit, which is a noisier model than
 * the one the writer picked. So a connection nobody has configured denies
 * data collection, routes only to zero-data-retention endpoints, and accepts
 * only eight-bit precision or better: a floor, held for every request through
 * the account, that the panel lets a writer lower on purpose. The cost is a
 * narrower pool: a model with no endpoint inside the floor cannot be reached
 * until the floor is lowered for that connection, and the request fails
 * saying so.
 *
 * One upstream is left out from the start: Morph. Serving GLM 5.2 in the
 * harness on 5 Oct 2026, it returned responses that were nothing but the same
 * tool call, hundreds of times over (harness/findings.md). A writer can take it
 * off the list like any other. The allowed list and the fallback switch stay
 * neutral: empty and permissive mean "don't constrain", and only those are
 * left out of the request.
 *
 * @type {OpenRouterRouting}
 */
export const ROUTING_DEFAULTS = {
  only: [],
  ignore: ['morph'],
  dataCollection: 'deny',
  zdr: true,
  quantizations: ['int8', 'fp8', 'mxfp8', 'fp16', 'bf16', 'fp32'],
  allowFallbacks: true,
}

/**
 * Quantization levels OpenRouter can filter on, ordered from most to least
 * lossy so the list reads as a precision ladder.
 *
 * @type {Array<{value: string, label: string}>}
 */
export const QUANTIZATIONS = [
  { value: 'int4', label: 'int4' },
  { value: 'fp4', label: 'fp4' },
  { value: 'mxfp4', label: 'mxfp4' },
  { value: 'nvfp4', label: 'nvfp4' },
  { value: 'fp6', label: 'fp6' },
  { value: 'int8', label: 'int8' },
  { value: 'fp8', label: 'fp8' },
  { value: 'mxfp8', label: 'mxfp8' },
  { value: 'fp16', label: 'fp16' },
  { value: 'bf16', label: 'bf16' },
  { value: 'fp32', label: 'fp32' },
  { value: 'unknown', label: 'Unknown' },
]

/**
 * Keep only usable slugs. Routing crosses the backup and sync boundary, where a
 * hand-edited file can hand us a string or a null where a list belongs — and a
 * malformed `only` would silently narrow routing to nothing.
 *
 * @param {unknown} value
 * @returns {string[]}
 */
function toSlugList(value) {
  if (!Array.isArray(value)) return []
  return value.filter(entry => typeof entry === 'string' && entry.length > 0)
}

/**
 * Fill a stored routing record out to a complete one. Records written before a
 * knob existed simply don't carry it, so every read goes through here.
 *
 * A missing knob takes the default, which for the three floor knobs is the
 * strict value: a record from before the floor existed gets the floor, and one
 * with no ignore list leaves out the upstreams the default does. A
 * record that carries the permissive value keeps it — the panel writes the
 * whole policy on every change, so a writer who turned the floor off has
 * `false`, `'allow'`, and an empty precision list stored, not nothing.
 *
 * @param {Partial<OpenRouterRouting>} [routing]
 * @returns {OpenRouterRouting}
 */
export function resolveRouting(routing) {
  return {
    only: toSlugList(routing?.only),
    ignore: Array.isArray(routing?.ignore)
      ? toSlugList(routing.ignore)
      : [...ROUTING_DEFAULTS.ignore],
    dataCollection: routing?.dataCollection === 'allow' ? 'allow' : 'deny',
    zdr: routing?.zdr !== false,
    quantizations: Array.isArray(routing?.quantizations)
      ? toSlugList(routing.quantizations)
      : [...ROUTING_DEFAULTS.quantizations],
    allowFallbacks: routing?.allowFallbacks !== false,
  }
}

/**
 * Whether a single knob has been moved off its default, for the reset
 * affordance in the settings UI.
 *
 * @param {Partial<OpenRouterRouting>|undefined} routing
 * @param {keyof OpenRouterRouting} key
 * @returns {boolean}
 */
export function isRoutingOverridden(routing, key) {
  const value = resolveRouting(routing)[key]
  const fallback = ROUTING_DEFAULTS[key]
  if (Array.isArray(value) && Array.isArray(fallback)) {
    return value.length !== fallback.length || value.some((entry, i) => entry !== fallback[i])
  }
  return value !== fallback
}

/**
 * Build the `provider` field of an OpenRouter chat completion request.
 *
 * Only knobs that constrain routing are sent: the permissive values are what
 * OpenRouter does anyway, so a connection with the whole floor lowered and
 * nothing else set yields `undefined` and the field is omitted. A connection
 * at the defaults sends the floor, because the floor is not OpenRouter's
 * default. Every filter sent is a hard one — `allow_fallbacks` lets
 * OpenRouter try the next eligible provider when the cheapest is down, never
 * one outside the filters.
 *
 * The quantization floor is for open weights, which any provider may serve at
 * any precision. A vendor serving its own closed model — Anthropic, OpenAI,
 * Google — reports no quantization, and a floor on it finds no endpoint at
 * all; so for those the floor is left out, and the rest of the policy holds.
 *
 * @param {{type?: string, routing?: Partial<OpenRouterRouting>}} provider
 * @param {string} [model] - The model asked for, to tell closed weights from open
 * @returns {Object|undefined} The `provider` field, or undefined to omit it
 */
/** Vendors whose models on OpenRouter are closed weights, served by themselves. */
const CLOSED_VENDORS = [
  'anthropic/',
  'openai/',
  'google/',
  'x-ai/',
  'amazon/',
  'cohere/',
  'perplexity/',
]

/**
 * Whether a model id names closed weights, which no quantization applies to.
 * @param {string} [model]
 * @returns {boolean}
 */
export function isClosedWeights(model) {
  const id = (model || '').toLowerCase().replace(/^~/, '')
  return CLOSED_VENDORS.some(vendor => id.startsWith(vendor))
}

export function buildProviderRouting(provider, model) {
  if (provider?.type !== 'openrouter') return undefined

  const routing = resolveRouting(provider.routing)

  /** @type {Record<string, any>} */
  const field = {}
  if (routing.only.length > 0) field.only = routing.only
  if (routing.ignore.length > 0) field.ignore = routing.ignore
  if (routing.quantizations.length > 0 && !isClosedWeights(model)) {
    field.quantizations = routing.quantizations
  }
  if (routing.dataCollection === 'deny') field.data_collection = 'deny'
  if (routing.zdr) field.zdr = true
  if (!routing.allowFallbacks) field.allow_fallbacks = false

  return Object.keys(field).length > 0 ? field : undefined
}
