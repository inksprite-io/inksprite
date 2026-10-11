/**
 * Default AI request parameters.
 *
 * These were previously editable via the settings UI (parameter sliders,
 * presets, profile overrides). The UI is gone; values are now defined
 * here. Edit this file to tune them. Future advanced settings could
 * re-expose a subset.
 *
 * @typedef {Object} AIDefaults
 * @property {number} maxTokens - Max response tokens. 0 = let provider decide.
 * @property {number} seed - Deterministic seed. 0 = disabled.
 * @property {'disabled'|'enabled'|'low'|'medium'|'high'} reasoningEffort - OpenRouter extended thinking. `enabled` asks for thinking without naming a level, for models whose thinking is a switch rather than a dial.
 * @property {boolean} showModelReasoning - Whether to surface reasoning tokens.
 * @property {number} maxToolRounds - How many rounds of tool calls a turn may make before it has to answer. 0 = no limit. See runCompletionLoop in composables/useAIChat.js.
 * @property {AISamplerParameters} parameters - Sampler parameters. Fields with sentinel values are omitted from requests.
 *
 * @typedef {Object} AISamplerParameters
 * @property {number} temperature - 1.0 = omitted.
 * @property {number} topP - 1.0 = omitted.
 * @property {number} minP - 0 = omitted.
 * @property {number} topA - 0 = omitted.
 * @property {number} topK - 0 = omitted.
 * @property {number} frequencyPenalty - 0 = omitted.
 * @property {number} presencePenalty - 0 = omitted.
 * @property {number} repetitionPenalty - 1.0 = omitted.
 */

/**
 * The reasoning efforts a request can ask for, as a settings menu lists them.
 * One list for every menu that offers them, so they read the same.
 */
export const REASONING_EFFORT_OPTIONS = [
  { value: 'disabled', label: 'Disabled' },
  // For a model whose thinking is a switch, not a dial. Naming a level to one
  // of those is refused outright.
  { value: 'enabled', label: 'Enabled' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
]

/** @type {AIDefaults} */
export const AI_DEFAULTS = {
  maxTokens: 0,
  seed: 0,
  reasoningEffort: 'medium',
  showModelReasoning: true,
  // A guard, not a budget: a long job — a folder read through, a server's
  // tools chained — runs well past a dozen rounds, and the turn that reaches
  // this still answers. What it guards against is a model going round.
  maxToolRounds: 100,
  parameters: {
    temperature: 1.0,
    topP: 1.0,
    minP: 0,
    topA: 0,
    topK: 0,
    frequencyPenalty: 0,
    presencePenalty: 0,
    repetitionPenalty: 1.0,
  },
}

/**
 * A sparse override on AI_DEFAULTS. Every key is optional, including the
 * individual sampler parameters — `Partial<AIDefaults>` alone would still
 * demand a complete `parameters` bag whenever that key is present.
 *
 * @typedef {Omit<Partial<AIDefaults>, 'parameters'> & { parameters?: Partial<AISamplerParameters> }} AISettingsOverrides
 */

/**
 * Merge sparse overrides over AI_DEFAULTS to get the settings a request should
 * actually use. `parameters` merges one level deep so an override touching a
 * single sampler value doesn't drop the rest.
 *
 * @param {AISettingsOverrides} [overrides]
 * @returns {AIDefaults}
 */
export function resolveAISettings(overrides) {
  if (!overrides) return AI_DEFAULTS
  return {
    ...AI_DEFAULTS,
    ...overrides,
    parameters: { ...AI_DEFAULTS.parameters, ...(overrides.parameters || {}) },
  }
}

/**
 * Lay one sparse override over another, keeping both sparse.
 *
 * Not the same as resolving: the result is still an override bag, so what
 * neither side mentions stays unmentioned and AI_DEFAULTS still decides it.
 * For a caller with settings of its own that should not throw away the ones
 * the writer tuned for their model — a skill wanting a cooler temperature is
 * saying something about temperature, not about top-k.
 *
 * `parameters` merges one level deep, the same way resolveAISettings does it.
 *
 * @param {AISettingsOverrides} [base]
 * @param {AISettingsOverrides} [over] - Wins where the two overlap
 * @returns {AISettingsOverrides|undefined}
 */
export function mergeAISettings(base, over) {
  if (!base) return over
  if (!over) return base

  const merged = { ...base, ...over }
  if (base.parameters || over.parameters) {
    merged.parameters = { ...base.parameters, ...over.parameters }
  }
  return merged
}

/**
 * Title-generation request overrides. Short, and no sampler values: these go
 * to whatever model the chat is on, instead of the writer's, and a strict
 * server refuses the whole request over one it doesn't take — Claude over a
 * temperature and a top-p together. A title comes out fine at the defaults.
 * @type {AISettingsOverrides}
 */
export const TITLE_DEFAULTS = {
  // A ceiling, not a spend: a plain model still answers in a handful of
  // tokens. The headroom is for models that think first — reasoningEffort
  // below is only sent to OpenRouter, so a local model reasons regardless and
  // a tight cap would leave nothing but a truncated <think> block.
  maxTokens: 500,
  reasoningEffort: 'disabled',
  showModelReasoning: false,
}
