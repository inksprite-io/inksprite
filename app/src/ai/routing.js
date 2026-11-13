/**
 * @module ai/routing
 * @description OpenRouter provider routing — which upstream provider is allowed
 * to serve a request, and which ones are disqualified — and NanoGPT's one
 * piece of it, zero data retention.
 *
 * Two owners. The policy here is stored on the AIProvider: it describes an
 * OpenRouter *connection*, not a model. A privacy floor ("never route to an
 * endpoint that keeps my prompts") should hold for every request made through
 * that account, not be re-chosen each time a preset is created. Which
 * providers may serve is the other way round: it is a choice about a model —
 * the one upstream that serves it well, or the few that serve it at all — so
 * it is the preset's `allowedProviders`, beside the model it was chosen for,
 * and handed in with the request. So is the one upstream that serves this
 * model badly: the preset's `ignoredProviders` are left out as well as the
 * connection's, which still hold for every model.
 *
 * NanoGPT routes among upstreams too, and takes the same `provider` field.
 * Only its zero-data-retention floor is the connection's, stored as
 * OpenRouter's `zdr` is and on by default as it is. The providers a model
 * prefers and ignores are the model's, as on OpenRouter; NanoGPT bills a
 * request that names any as pay-as-you-go, with a markup, off a
 * subscription, so they go only where the writer chose some.
 *
 * @see https://openrouter.ai/docs/guides/routing/provider-selection
 * @see https://docs.nano-gpt.com/api-reference/miscellaneous/provider-selection
 */

/**
 * @typedef {Object} OpenRouterRouting
 * @property {string[]} ignore - Provider slugs never routed to.
 * @property {'allow'|'deny'} dataCollection - Whether providers that may store prompts are eligible.
 * @property {boolean} zdr - Restrict routing to zero-data-retention endpoints.
 * @property {string[]} quantizations - Quantization levels eligible to serve. Empty = any.
 * @property {boolean} allowFallbacks - Whether OpenRouter may fall back past the allowed set.
 */

/**
 * What a preset says of the upstreams for its model, on top of the
 * connection's policy. A preset is one, and so is a workflow on a model of its
 * own. Either list may come from a backup, so junk in them is dropped.
 *
 * @typedef {Object} ModelUpstreams
 * @property {string[]} [allowedProviders] - The model's preferred providers, tried first and in this order; empty or absent prefers none
 * @property {boolean} [fallbacks] - Whether any other provider that passes the connection's floor may serve once the preferred ones can't. Absent, as on a list from before it was asked, the preferred are the only ones
 * @property {string[]} [ignoredProviders] - Never routed to for the model, besides the connection's `ignore`
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
 * off the list like any other. The fallback switch stays neutral: permissive
 * means "don't constrain", and is left out of the request.
 *
 * @type {OpenRouterRouting}
 */
export const ROUTING_DEFAULTS = {
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
 * malformed allowed list would silently narrow routing to nothing.
 *
 * @param {unknown} value
 * @returns {string[]}
 */
export function toSlugList(value) {
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

/**
 * What left a request with no endpoint, from the step OpenRouter names when
 * it refuses one (`error.metadata.failed_routing_step`, a 404): the
 * connection's floor, the providers the model is limited to, or the model
 * itself, which can't use tools. Null for a step not known here, or none.
 *
 * OpenRouter's steps as it named them on 11 Nov 2026: "Filter by Data
 * Policy" (zero data retention, data collection), "Filter by Quantization",
 * "Filter by Ignored Providers", "Filter by Allowed Providers", "Filter by
 * Tool Compatibility". A model it has dropped names none.
 *
 * Ignored providers are the connection's and the model's both; the
 * connection's are the ones a writer is likelier to have widened.
 *
 * @param {unknown} step
 * @returns {'connection'|'model'|'tools'|null}
 */
export function routingFilterOf(step) {
  if (typeof step !== 'string') return null
  if (/allowed providers/i.test(step)) return 'model'
  if (/tool/i.test(step)) return 'tools'
  if (/data policy|quantization|ignored providers/i.test(step)) return 'connection'
  return null
}

/**
 * Build the `provider` field of an OpenRouter or NanoGPT request.
 *
 * NanoGPT's holds `zdr`, sent while the connection asks for zero data
 * retention: NanoGPT then serves through providers that keep nothing, its
 * fallbacks too, and fails a request none of them can serve rather than
 * relax it. Beside it go the model's preferred and ignored providers, as
 * OpenRouter's do; NanoGPT has no connection-wide list of its own here, and
 * none of OpenRouter's other knobs.
 *
 * Only knobs that constrain routing are sent: the permissive values are what
 * OpenRouter does anyway, so a connection with the whole floor lowered, on a
 * model that prefers no provider, yields `undefined` and the field is
 * omitted. A connection at the defaults sends the floor, because the floor is
 * not OpenRouter's default. Every filter sent is a hard one — `allow_fallbacks` lets
 * OpenRouter try the next eligible provider when the cheapest is down, never
 * one outside the filters. The model's ignored providers join the
 * connection's in one `ignore`; neither takes the other's away.
 *
 * The model's preferred providers go as `order`, tried first, where it may
 * fall back to others, and as `only` where it may not.
 *
 * The quantization floor is for open weights, which any provider may serve at
 * any precision. A vendor serving its own closed model — Anthropic, OpenAI,
 * Google — reports no quantization, and a floor on it finds no endpoint at
 * all; so for those the floor is left out, and the rest of the policy holds.
 *
 * @param {{type?: string, routing?: Partial<OpenRouterRouting>}} provider
 * @param {string} [model] - The model asked for, to tell closed weights from open
 * @param {ModelUpstreams} [upstreams] - The preset's allowed and ignored providers
 * @returns {Object|undefined} The `provider` field, or undefined to omit it
 */
export function buildProviderRouting(provider, model, upstreams) {
  if (provider?.type !== 'openrouter' && provider?.type !== 'nanogpt') return undefined

  const routing = resolveRouting(provider.routing)
  const preferred = toSlugList(upstreams?.allowedProviders)
  const ordered = preferred.length > 0 && upstreams?.fallbacks === true
  const connectionIgnores = provider.type === 'openrouter' ? routing.ignore : []
  const ignore = [...new Set([...connectionIgnores, ...toSlugList(upstreams?.ignoredProviders)])]

  /** @type {Record<string, any>} */
  const field = {}
  if (preferred.length > 0) field[ordered ? 'order' : 'only'] = preferred
  if (ignore.length > 0) field.ignore = ignore
  if (provider.type === 'nanogpt') {
    if (routing.zdr) field.zdr = true
    return Object.keys(field).length > 0 ? field : undefined
  }
  if (routing.quantizations.length > 0 && !isClosedWeights(model)) {
    field.quantizations = routing.quantizations
  }
  if (routing.dataCollection === 'deny') field.data_collection = 'deny'
  if (routing.zdr) field.zdr = true
  // A model that may fall back past its preferred ones has to be let.
  if (!routing.allowFallbacks && !ordered) field.allow_fallbacks = false

  return Object.keys(field).length > 0 ? field : undefined
}
