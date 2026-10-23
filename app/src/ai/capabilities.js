/**
 * @module ai/capabilities
 * @description Which generation settings a request can carry, on this
 * connection and this model: the samplers it takes, the reasoning efforts it
 * knows, whether it can be told to keep its reasoning to itself. The settings
 * show only those, and a request sends only those.
 *
 * Three sources, the most particular first:
 * - What the provider's list says of the model. OpenRouter lists each model's
 *   parameters and how it reasons; Anthropic's Models API says how each Claude
 *   thinks and at which efforts. These arrive as {@link ModelTraits}.
 * - What the API was found to take, family by family, where its list says
 *   nothing: OpenAI's samplers.
 * - What the server takes at all. A server someone runs answers to the names
 *   it was written to read and ignores the rest, so a setting it ignores is
 *   one it doesn't have. A server we know nothing of is offered everything.
 *
 * A setting the model can't take is not shown and not sent. A stored choice it
 * can't take (a level it lacks, Disabled on a model that always thinks) reads
 * and is sent as the nearest one it can, and stays stored, so going back to a
 * model that takes it finds it as it was.
 */

import { AI_DEFAULTS } from '@/ai/defaults.js'
import { BUILT_IN_PROVIDERS } from '@/ai/providers.js'

/**
 * @typedef {import('@/ai/defaults.js').AIDefaults} AISettings
 * @typedef {keyof AISettings['parameters'] | 'seed'} Sampler
 * @typedef {AISettings['reasoningEffort']} ReasoningEffort
 */

/**
 * What a provider's list says about one of its models. A field the list says
 * nothing about is absent.
 *
 * @typedef {Object} ModelTraits
 * @property {Sampler[]} [samplers] - The samplers it takes
 * @property {ReasoningTraits|null} [reasoning] - How it reasons; null for a
 *   model that doesn't
 * @property {number} [contextLength] - How many tokens it reads and writes in
 *   one request, its answer among them
 */

/**
 * @typedef {Object} ReasoningTraits
 * @property {boolean} optional - Whether it can be asked not to reason
 * @property {ReasoningEffort[]} levels - The effort levels it takes, lowest
 *   first. None for reasoning that is only on or off.
 * @property {ReasoningEffort} [defaultLevel] - The level it reasons at untold
 */

/**
 * What a request on this connection and model can carry.
 *
 * @typedef {Object} Capabilities
 * @property {ReadonlySet<Sampler>} samplers - The samplers it takes
 * @property {boolean} samplersWhileThinking - Whether it takes them while it
 *   reasons. Older Claude models take a temperature only when not thinking.
 * @property {ReadonlyArray<readonly [Sampler, Sampler]>} exclusive - Pairs of
 *   samplers it takes only one of at a time; the first wins
 * @property {ReasoningEffort[]} efforts - What Reasoning effort offers, in the
 *   menu's order. None when a request says nothing of reasoning; one when
 *   there is nothing to choose.
 * @property {ReasoningEffort} [defaultEffort] - The level it reasons at untold
 * @property {boolean} reasons - Whether the model may reason at all
 * @property {boolean} reasoningDisplay - Whether the provider can be asked to
 *   keep the reasoning to itself, which is what Show reasoning does
 * @property {Partial<Record<Sampler, string>>} names - The key a server reads a
 *   sampler under, where it isn't OpenAI's name for it
 */

/** The effort levels, lowest first. */
export const LEVELS = /** @type {const} */ (['minimal', 'low', 'medium', 'high', 'xhigh', 'max'])

/** @type {Sampler[]} */
const ALL_SAMPLERS = [
  'temperature',
  'topP',
  'topK',
  'minP',
  'topA',
  'frequencyPenalty',
  'presencePenalty',
  'repetitionPenalty',
  'seed',
]

/** What a model nobody has described is offered: everything there was before. */
/** @type {ReasoningEffort[]} */
const UNDESCRIBED_EFFORTS = ['disabled', 'enabled', 'low', 'medium', 'high']

/**
 * The samplers OpenAI's chat completions take on the models that take them:
 * the ones that came before reasoning, and the GPT-5 releases that reason only
 * when asked. The rest refuse anything but their defaults. Its model list says
 * none of this; this is what each model answered on 12 October 2026, and a
 * model released since is taken to be like the newest ones.
 */
const OPENAI_SAMPLING_MODELS = /^(gpt-3\.5|gpt-4|gpt-5\.[124](-|$))/

/** @type {Sampler[]} */
const OPENAI_SAMPLERS = ['temperature', 'topP', 'frequencyPenalty', 'presencePenalty']

/**
 * A kind of server, with what it takes beyond the commonest: samplers taken
 * while reasoning, nothing to say of reasoning, and nothing renamed.
 *
 * @param {Partial<Omit<Capabilities, 'samplers'>> & {samplers: Sampler[]}} described
 * @returns {Omit<Capabilities, 'samplers'> & {samplers: Sampler[]}}
 */
const server = described => ({
  samplersWhileThinking: true,
  exclusive: [],
  efforts: [],
  reasons: true,
  reasoningDisplay: false,
  names: {},
  ...described,
})

/**
 * What each kind of server takes, before anything is known of the model.
 *
 * For the servers someone runs, it is what each reads off a chat completion,
 * in its own source (LM Studio's, which is closed, in its documentation) as of
 * October 2026. llama-server and LM Studio read the repetition penalty as
 * `repeat_penalty`; Ollama's OpenAI endpoint reads no top-k, min-p or
 * repetition penalty; KoboldCpp's reads a frequency penalty only as a
 * presence penalty. None of them is sent a reasoning setting except
 * llama-server, whose chat template can be told to leave thinking out.
 */
const SERVERS = {
  openrouter: server({
    samplers: ALL_SAMPLERS,
    efforts: UNDESCRIBED_EFFORTS,
    reasoningDisplay: true,
  }),
  anthropic: server({
    // Until the Models API has said otherwise: the current models, which
    // take no samplers and always think.
    samplers: [],
    samplersWhileThinking: false,
    exclusive: [['temperature', 'topP']],
    efforts: ['low', 'medium', 'high'],
    defaultEffort: 'high',
    reasoningDisplay: true,
  }),
  // Chat completions sends no reasoning back and takes no effort beside
  // tools (see ai/providers.js).
  openai: server({ samplers: ['seed'], reasons: false }),
  // Not offered yet, and not tried with a key.
  gemini: server({
    samplers: ['temperature', 'topP'],
    efforts: ['enabled', 'low', 'medium', 'high'],
  }),
  llamacpp: server({
    samplers: ALL_SAMPLERS.filter(sampler => sampler !== 'topA'),
    efforts: ['disabled', 'enabled'],
    names: { repetitionPenalty: 'repeat_penalty' },
  }),
  lmstudio: server({
    samplers: [
      'temperature',
      'topP',
      'topK',
      'frequencyPenalty',
      'presencePenalty',
      'repetitionPenalty',
      'seed',
    ],
    names: { repetitionPenalty: 'repeat_penalty' },
  }),
  ollama: server({
    samplers: ['temperature', 'topP', 'frequencyPenalty', 'presencePenalty', 'seed'],
  }),
  vllm: server({ samplers: ALL_SAMPLERS.filter(sampler => sampler !== 'topA') }),
  koboldcpp: server({
    samplers: ALL_SAMPLERS.filter(sampler => sampler !== 'frequencyPenalty'),
  }),
  // A server we know nothing of: everything, as before there was this.
  generic: server({ samplers: ALL_SAMPLERS }),
}

/**
 * Which kind of server a connection reaches. Its type, except for the built-in
 * connections to servers that speak the generic dialect: those are known by
 * which built-in they are.
 *
 * @param {{id?: string, type?: string}} provider
 * @returns {string}
 */
export function serverOf(provider) {
  const builtIn = BUILT_IN_PROVIDERS.find(entry => entry.id === provider.id)
  const server = builtIn?.server ?? provider.type
  return server && server in SERVERS ? server : 'generic'
}

/**
 * What a request on this connection and model can carry.
 *
 * @param {{id?: string, type?: string}} provider
 * @param {string} [model]
 * @param {ModelTraits} [traits] - What the provider's list says of the model
 * @returns {Capabilities}
 */
export function capabilitiesOf(provider, model, traits) {
  const server = serverOf(provider)
  const base = SERVERS[server]

  let samplers = base.samplers
  if (server === 'openai') {
    samplers = OPENAI_SAMPLING_MODELS.test(model || '') ? [...OPENAI_SAMPLERS, 'seed'] : ['seed']
  }
  if (traits?.samplers) samplers = traits.samplers

  let { efforts, defaultEffort, reasons } = base
  if (traits?.reasoning === null) {
    efforts = []
    defaultEffort = undefined
    reasons = false
  } else if (traits?.reasoning) {
    const { optional, levels, defaultLevel } = traits.reasoning
    efforts = [...(optional ? ['disabled'] : []), ...(levels.length ? levels : ['enabled'])]
    defaultEffort = defaultLevel
    reasons = true
  }

  return {
    ...base,
    samplers: new Set(samplers),
    efforts: /** @type {ReasoningEffort[]} */ (efforts),
    defaultEffort,
    reasons,
  }
}

/**
 * The effort a request on this model is sent: the one chosen when the model
 * takes it, or the nearest it does. Disabled on a model that always reasons
 * is its lowest level, as little as it can; Enabled on one with levels is the
 * level it reasons at untold; a level it lacks is its nearest, the higher of
 * two as near.
 *
 * @param {ReasoningEffort} effort
 * @param {Capabilities} capabilities
 * @returns {ReasoningEffort}
 */
export function fitEffort(effort, { efforts, defaultEffort }) {
  if (efforts.length === 0 || efforts.includes(effort)) return effort
  const levels = efforts.filter(entry => rank(entry) >= 0)
  const fallback = efforts.includes('enabled') ? 'enabled' : efforts[0]

  if (effort === 'disabled') return levels[0] ?? fallback
  if (levels.length === 0) return fallback

  const wanted = effort === 'enabled' ? (defaultEffort ?? 'medium') : effort
  if (levels.includes(wanted)) return wanted
  return levels.reduce((best, level) => {
    const gap = Math.abs(rank(level) - rank(wanted))
    const bestGap = Math.abs(rank(best) - rank(wanted))
    return gap < bestGap || (gap === bestGap && rank(level) > rank(best)) ? level : best
  })
}

/**
 * @param {string} effort
 * @returns {number} Its place among the levels, or -1 for Disabled and Enabled
 */
function rank(effort) {
  return LEVELS.indexOf(/** @type {any} */ (effort))
}

/**
 * The samplers a request with this effort can carry: none, on a model that
 * takes them only while it isn't reasoning and is going to be.
 *
 * @param {Capabilities} capabilities
 * @param {ReasoningEffort} effort - Already fitted
 * @returns {ReadonlySet<Sampler>}
 */
export function samplersAt(capabilities, effort) {
  const thinking = capabilities.reasons && capabilities.efforts.length > 0 && effort !== 'disabled'
  return thinking && !capabilities.samplersWhileThinking ? new Set() : capabilities.samplers
}

/**
 * The sampler that keeps this one from being sent, being set itself: the one
 * it pairs with on a model that takes only one of the two.
 *
 * @param {Capabilities} capabilities
 * @param {Sampler} sampler
 * @param {AISettings} settings
 * @returns {Sampler|undefined}
 */
export function blockedBy(capabilities, sampler, settings) {
  for (const [first, second] of capabilities.exclusive) {
    if (second === sampler && isSet(first, settings)) return first
  }
  return undefined
}

/**
 * @param {Sampler} sampler
 * @param {AISettings} settings
 * @returns {boolean} Whether it is moved off the value that leaves it out
 */
function isSet(sampler, settings) {
  if (sampler === 'seed') return settings.seed !== AI_DEFAULTS.seed
  return settings.parameters[sampler] !== AI_DEFAULTS.parameters[sampler]
}

/**
 * The settings as a request on this model should carry them: the effort
 * fitted to what it takes, and every sampler it can't take back at the value
 * that leaves it out of the request.
 *
 * @param {AISettings} settings - Already resolved over AI_DEFAULTS
 * @param {Capabilities} capabilities
 * @returns {AISettings}
 */
export function fitSettings(settings, capabilities) {
  const reasoningEffort = fitEffort(settings.reasoningEffort, capabilities)
  const allowed = samplersAt(capabilities, reasoningEffort)
  const keys = /** @type {Array<keyof AISettings['parameters']>} */ (
    Object.keys(settings.parameters)
  )

  const parameters = { ...settings.parameters }
  for (const key of keys) {
    if (!allowed.has(key)) parameters[key] = AI_DEFAULTS.parameters[key]
  }
  const fitted = {
    ...settings,
    reasoningEffort,
    seed: allowed.has('seed') ? settings.seed : AI_DEFAULTS.seed,
    parameters,
  }

  // Only once the ones it can't take are gone: a temperature that isn't sent
  // keeps nothing else from being.
  for (const key of keys) {
    if (blockedBy(capabilities, key, fitted)) parameters[key] = AI_DEFAULTS.parameters[key]
  }
  return fitted
}
