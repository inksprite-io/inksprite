/**
 * @module ai/wire
 * @description The request, as an OpenAI-compatible server should see it.
 *
 * Everything between the conversation this app keeps and the JSON a provider
 * is handed: which of a message's fields are ours and stop here, which are
 * renamed into the vocabulary this particular backend speaks, and how the
 * settings become sampler keys.
 *
 * Pure, and deliberately so. Nothing in here looks up a provider, holds a
 * connection, or knows a turn is running, which is what lets the same code
 * build the request the app sends and the one a harness sends
 * (scripts/chat-harness.js) — a harness that built its own lookalike body
 * would answer questions about itself.
 */

import { buildProviderRouting } from '@/ai/routing.js'
import { takesChatTemplateKwargs } from '@/ai/providers.js'

/**
 * @typedef {import('@/types/models.js').AIProvider} AIProvider
 * @typedef {import('@/ai/defaults.js').AIDefaults} AISettings
 * @typedef {import('@/ai/tools/registry.js').ToolDefinition} ToolDefinition
 */

/**
 * Join base URL and path.
 * @param {string} base
 * @param {string} path
 * @returns {string}
 */
function joinUrl(base, path) {
  return new URL(path, base.endsWith('/') ? base : base + '/').toString()
}

/**
 * Where this provider's API lives. OpenRouter is the one connection whose
 * address we know without being told.
 *
 * @param {AIProvider} provider
 * @returns {string}
 */
export function baseUrl(provider) {
  if (provider.type === 'openrouter') {
    return 'https://openrouter.ai/api/v1/'
  }
  return provider.endpoint
}

/**
 * @param {AIProvider} provider
 * @returns {string}
 */
export function modelsUrl(provider) {
  return joinUrl(baseUrl(provider), 'models')
}

/**
 * @param {AIProvider} provider
 * @returns {string}
 */
export function chatCompletionsUrl(provider) {
  return joinUrl(baseUrl(provider), 'chat/completions')
}

/**
 * Who is asking, for the provider's records.
 *
 * OpenRouter reads these two headers to attribute a request to an app — its
 * public rankings are built from them — and every other server ignores them.
 * On every request the app or a harness makes, so that a batch run from the
 * terminal counts the same as a turn in the browser.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const ATTRIBUTION_HEADERS = Object.freeze({
  'HTTP-Referer': 'https://inksprite.io',
  'X-Title': 'inksprite',
})

/**
 * Mark cache breakpoints so Anthropic (via OpenRouter) can reuse the
 * conversation prefix across turns at ~10% of input price. Cache writes
 * cost ~25% extra one-time but pay back after the first hit.
 *
 * Two breakpoints:
 *   1. The system message — stable per session; hits forever within
 *      the cache TTL. Survives even if the conversation cache is
 *      invalidated (e.g. user edits an old message).
 *   2. The message immediately before the latest user message — caches
 *      all completed turns. The latest user message itself is *not*
 *      cached because it carries the volatile current-scene prefix,
 *      which would force a miss next turn.
 *
 * Only applied to openrouter-typed providers; we don't know whether a
 * generic-typed provider's backend supports cache_control.
 *
 * @param {Array<any>} messages
 * @param {{ type: string }} provider
 * @returns {Array<any>}
 */
function withCacheControl(messages, provider) {
  if (provider.type !== 'openrouter') return messages
  if (!Array.isArray(messages) || messages.length === 0) return messages

  const out = messages.slice()
  const mark = i => {
    out[i] = { ...out[i], cache_control: { type: 'ephemeral' } }
  }

  if (out[0]?.role === 'system') {
    mark(0)
  }

  for (let i = out.length - 1; i >= 0; i--) {
    if (out[i]?.role === 'user') {
      // The latest user message. Cache everything before it — only if
      // there's actually something before (and it's not the system
      // message we already marked).
      if (i >= 2) mark(i - 1)
      break
    }
  }

  return out
}

/**
 * Say a turn's own thinking back to it in the vocabulary its backend speaks.
 *
 * A model that thinks, calls a tool, and is asked to carry on needs to see
 * that it was thinking — otherwise the continuation shows it a turn that
 * reached for a tool and never had a thought, and it carries on in kind. That
 * is why thinking stops after the first tool call against a local backend
 * while the same model interleaves happily in a client that keeps its own
 * conversation.
 *
 * There is no one field for it. `reasoning_details` is OpenRouter's
 * normalization over a dozen incompatible conventions and the only one
 * carrying Anthropic's signatures, which Anthropic needs echoed back
 * verbatim. Everyone else gets `reasoning_content`, the shape DeepSeek
 * defined and LM Studio, lmdeploy, and llama.cpp follow.
 *
 * `_reasoning` is ours, set by whoever ran the turn (see
 * composables/useAIChat.js) and never sent under that name. It is only ever
 * present when this same backend just streamed reasoning to us, so a strict
 * server that has never heard of any of this is never handed a field it would
 * answer with a 400.
 *
 * @param {Array<any>} messages
 * @param {{ type: string }} provider
 * @returns {Array<any>}
 */
function withSupportedReasoning(messages, provider) {
  if (!Array.isArray(messages)) return messages

  return messages.map(message => {
    if (!message?.reasoning_details && !message?._reasoning) return message

    const { reasoning_details: details, _reasoning: reasoning, ...rest } = message

    if (provider.type === 'openrouter') {
      return details ? { ...rest, reasoning_details: details } : rest
    }
    return reasoning ? { ...rest, reasoning_content: reasoning } : rest
  })
}

/**
 * Drop the fields that are ours.
 *
 * A message picks up notes on its way through this app — which document a
 * result put in front of the model, what the model thought while producing it
 * — and they ride on the same object the API is about to be handed. Anything
 * still carrying a leading underscore here has already had its chance to be
 * translated into something a provider knows, so what is left is ours alone.
 * Sending it is at best noise in someone's context and at worst a 400 from a
 * strict server, on every tool-using turn.
 *
 * @param {Array<any>} messages
 * @returns {Array<any>}
 */
function withoutPrivateFields(messages) {
  if (!Array.isArray(messages)) return messages

  return messages.map(message => {
    if (!message || !Object.keys(message).some(key => key.startsWith('_'))) return message
    return Object.fromEntries(Object.entries(message).filter(([key]) => !key.startsWith('_')))
  })
}

/**
 * The conversation, as this provider should receive it.
 *
 * Order matters. Reasoning is translated first, since that is what turns a
 * private note into a field a provider knows; whatever is still ours after it
 * goes no further; cache breakpoints are marked last, on what will actually be
 * sent.
 *
 * @param {Array<any>} messages
 * @param {{ type: string }} provider
 * @returns {Array<any>}
 */
export function toWireMessages(messages, provider) {
  return withCacheControl(
    withoutPrivateFields(withSupportedReasoning(messages, provider)),
    provider
  )
}

/**
 * The whole request body for a streamed chat completion.
 *
 * Sampler values at their neutral value — 1.0 for temperature, top-p and a
 * penalty that multiplies, 0 for the rest — are left out rather than sent,
 * because a backend that has never heard of the key rejects the request, one
 * that has may take the neutral value as a deliberate override of its own
 * default, and some refuse keys they know: Claude takes a temperature or a
 * top-p but not both, and its newest models take neither. So temperature at
 * 1.0 is the server's own default, which on a local server may be cooler.
 *
 * Also reports the two things about this body a provider can refuse over in
 * terms that won't explain themselves, so the caller can say what happened.
 *
 * @param {Object} args
 * @param {Array<any>} args.messages - The conversation, before wire translation
 * @param {string} args.model
 * @param {AIProvider} args.provider
 * @param {string[]} [args.allowedProviders] - The preset's: the only upstreams
 *   OpenRouter may route this model to. Empty or absent allows any.
 * @param {AISettings} args.settings - Already resolved over AI_DEFAULTS
 * @param {ToolDefinition[]} [args.tools]
 * @param {'auto'|'none'} [args.toolChoice] - `none` for a request that must
 *   answer without calling anything, with the tools still declared: a
 *   conversation that has called them is refused by some providers once they
 *   are not
 * @returns {{body: Record<string, any>, sentReasoning: boolean, askedForEffort: boolean}}
 */
export function buildCompletionBody({
  messages,
  model,
  provider,
  allowedProviders,
  settings,
  tools,
  toolChoice,
}) {
  const params = settings.parameters

  /** @type {Record<string, any>} */
  const body = {
    model,
    messages: toWireMessages(messages, provider),
    stream: true,
    // OpenRouter sends usage on a streamed response anyway; OpenAI and most
    // local servers only do when asked, and without it there's nothing to
    // report context size from.
    stream_options: { include_usage: true },
  }

  if (settings.maxTokens > 0) body.max_tokens = settings.maxTokens
  if (params.temperature !== 1.0) body.temperature = params.temperature
  if (params.topP !== 1.0) body.top_p = params.topP
  if (params.frequencyPenalty !== 0) body.frequency_penalty = params.frequencyPenalty
  if (params.presencePenalty !== 0) body.presence_penalty = params.presencePenalty
  if (params.minP > 0) body.min_p = params.minP
  if (params.repetitionPenalty !== 1.0) body.repetition_penalty = params.repetitionPenalty
  if (params.topK > 0) body.top_k = params.topK
  if (params.topA > 0) body.top_a = params.topA
  if (settings.seed > 0) body.seed = settings.seed

  if (tools && tools.length > 0) {
    body.tools = tools
    if (toolChoice) body.tool_choice = toolChoice
  }

  // Not every thinking model takes an effort level. Some only have a switch,
  // and answer an effort with a refusal — so `enabled` asks for thinking
  // without saying how much and lets the provider decide.
  const askedForEffort =
    provider.type === 'openrouter' &&
    settings.reasoningEffort !== 'disabled' &&
    settings.reasoningEffort !== 'enabled'

  // Saying nothing is not saying no: a model that thinks by default goes on
  // thinking, and `disabled` reads on the settings panel like a switch that
  // did something. So it says so, explicitly. There is no `exclude` on that
  // branch because there is nothing to exclude.
  if (provider.type === 'openrouter') {
    body.reasoning =
      settings.reasoningEffort === 'disabled'
        ? { enabled: false }
        : {
            ...(askedForEffort ? { effort: settings.reasoningEffort } : { enabled: true }),
            exclude: !settings.showModelReasoning,
          }
  } else if (takesChatTemplateKwargs(provider.type) && settings.reasoningEffort === 'disabled') {
    // The same intent, said in the only way this server can hear it. Nothing
    // goes out at the other settings: asking for thinking is the template's
    // default, and a level is OpenRouter's word, not one llama-server has.
    body.chat_template_kwargs = { enable_thinking: false }
  }

  // Provider routing: the connection's policy, and the providers the preset
  // allows for this model.
  const routing = buildProviderRouting(provider, model, allowedProviders)
  if (routing) body.provider = routing

  return {
    body,
    sentReasoning: body.messages.some(message => message?.reasoning_details),
    askedForEffort,
  }
}
