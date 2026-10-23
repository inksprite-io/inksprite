/**
 * @module ai/anthropic
 * @description Claude, spoken to in Anthropic's own API.
 *
 * Every other connection speaks OpenAI's chat completions, and the app's
 * conversation is kept in that shape. Anthropic's Messages API is shaped
 * differently, and is worth speaking for what the compatible endpoint it also
 * offers leaves out: prompt caching, the model's thinking, effort levels. So
 * this is the one place the conversation is said another way: the system
 * prompt beside the messages, tool calls and their results as blocks inside
 * them, and the thinking a turn did handed back with the signature it came
 * with.
 *
 * What a model can do is asked of the Models API, not listed here: which kinds
 * of thinking it takes, whether it can stop thinking at all, its effort levels,
 * how long an answer it can give, and whether it has a model to fall back on
 * when it declines. A request is built from that, so a model released after
 * this was written is spoken to the way it says it wants.
 *
 * The thinking travels on the message as `reasoning_details`, in the shape
 * OpenRouter gives Anthropic's (format `anthropic-claude-v1`), so a chat can
 * move between OpenRouter and Anthropic and keep it. Each entry's `index` is
 * where the block sat in the answer, which is where it goes back.
 *
 * The SDK is loaded the first time a connection to Anthropic is used.
 */

import { fetch } from '@/platform/fetch.js'
import { capabilitiesOf, fitSettings } from '@/ai/capabilities.js'
import { RATE_LIMITED, RateLimitedError, retryAfterOf } from '@/ai/gate.js'

/**
 * @typedef {import('@/types/models.js').AIProvider} AIProvider
 * @typedef {import('@/ai/defaults.js').AIDefaults} AISettings
 * @typedef {import('@/ai/tools/registry.js').ToolDefinition} ToolDefinition
 * @typedef {import('@/ai/tools/registry.js').ToolCall} ToolCall
 * @typedef {import('@/composables/useAIService.js').ReasoningDetail} ReasoningDetail
 * @typedef {import('@/composables/useAIService.js').StreamChunk} StreamChunk
 * @typedef {import('@/ai/capabilities.js').ModelTraits} ModelTraits
 */

/** What OpenRouter calls Anthropic's thinking, and so what it is called here. */
export const THINKING_FORMAT = 'anthropic-claude-v1'

/**
 * Lets a request say what to do with a thinking block whose conversation has
 * changed since: compaction, an edited message, the project block moving to
 * the latest turn. Dropping it costs the model that reasoning; refusing it
 * would cost the writer the turn.
 */
const BINDING_BETA = 'thinking-binding-controls-2026-08-01'

/** Lets a request name `fallbacks: 'default'`: the model's own choice of who answers when it declines. */
const FALLBACK_BETA = 'server-side-fallback-2026-07-01'

/** Makes the Models API say which models a model falls back to. */
const LISTED_FALLBACKS_BETA = 'server-side-fallback-2026-06-01'

/** Thinking budgets for a model that takes a budget rather than an effort level. */
const BUDGETS = { enabled: 8192, low: 2048, medium: 8192, high: 24576 }

/**
 * What a model can do, as the Models API describes it.
 *
 * @typedef {Object} ModelInfo
 * @property {string} id
 * @property {string} name - Its display name
 * @property {number} [maxTokens] - The longest answer it can give
 * @property {{adaptive: boolean, enabled: boolean, disabled: boolean} | null} thinking -
 *   Which kinds of thinking it takes: `adaptive` decides how much for itself,
 *   `enabled` takes a budget, `disabled` is not thinking at all. Null for a
 *   model that doesn't think.
 * @property {string[]} effort - The effort levels it takes, lowest first
 * @property {boolean} samplers - Whether it takes a temperature, a top-p or a
 *   top-k. The Models API doesn't say; the models that take a thinking budget
 *   are the ones that still take them, and only while not thinking.
 * @property {boolean} fallbacks - Whether it has models to fall back on when it declines
 */

/**
 * What is assumed of a model the Models API could not describe: the way the
 * current models are spoken to. A model that differs answers with an error
 * that says how.
 *
 * @type {Omit<ModelInfo, 'id' | 'name'>}
 */
const ASSUMED = {
  maxTokens: 32000,
  thinking: { adaptive: true, enabled: false, disabled: false },
  effort: ['low', 'medium', 'high'],
  samplers: false,
  fallbacks: false,
}

const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max']

/**
 * The index of the last item that passes, or -1.
 *
 * @template T
 * @param {T[]} items
 * @param {(item: T) => boolean} passes
 * @returns {number}
 */
function lastIndex(items, passes) {
  for (let i = items.length - 1; i >= 0; i--) if (passes(items[i])) return i
  return -1
}

/**
 * Read a model as the Models API lists it.
 *
 * @param {Record<string, any>} model - One entry of `/v1/models`
 * @returns {ModelInfo}
 */
export function modelInfo(model) {
  const capabilities = model.capabilities || {}
  const types = capabilities.thinking?.types || {}
  return {
    id: model.id,
    name: model.display_name || model.id,
    maxTokens: model.max_tokens || undefined,
    thinking: capabilities.thinking?.supported
      ? {
          adaptive: !!types.adaptive?.supported,
          enabled: !!types.enabled?.supported,
          disabled: !!types.disabled?.supported,
        }
      : null,
    effort: capabilities.effort?.supported
      ? EFFORT_LEVELS.filter(level => capabilities.effort[level]?.supported)
      : [],
    samplers: !capabilities.thinking?.supported || !!types.enabled?.supported,
    fallbacks: (model.allowed_fallback_models || []).length > 0,
  }
}

/**
 * Tool call ids as Anthropic takes them: letters, digits, `_` and `-`. A chat
 * that moved from another provider can carry ids with dots and colons in them.
 *
 * @param {string} [id]
 * @returns {string}
 */
function toolUseId(id) {
  return (id || 'call').replace(/[^a-zA-Z0-9_-]/g, '_')
}

/**
 * A tool call's arguments as the object a `tool_use` block holds. Ones that
 * came back cut off or broken go back as nothing, which is what the model was
 * told it called with.
 *
 * @param {string} [args]
 * @returns {Record<string, any>}
 */
function toolInput(args) {
  try {
    const parsed = JSON.parse(args || '{}')
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

/**
 * The thinking a turn did, as the blocks Anthropic gave it. Only its own
 * format: another model's reasoning means nothing to Claude.
 *
 * @param {ReasoningDetail[]} [details]
 * @returns {Array<{index?: number, block: Record<string, any>}>}
 */
function thinkingBlocks(details) {
  if (!Array.isArray(details)) return []
  /** @type {Array<{index?: number, block: Record<string, any>}>} */
  const blocks = []
  for (const detail of details) {
    if (!detail || detail.format !== THINKING_FORMAT) continue
    if (detail.type === 'reasoning.text' && detail.signature) {
      blocks.push({
        index: detail.index,
        block: { type: 'thinking', thinking: detail.text || '', signature: detail.signature },
      })
    } else if (detail.type === 'reasoning.encrypted' && detail.data) {
      blocks.push({
        index: detail.index,
        block: { type: 'redacted_thinking', data: detail.data },
      })
    }
  }
  return blocks
}

/**
 * Put a turn's thinking back where it sat in the answer, among the text and
 * the tool calls. Blocks with no place of their own (OpenRouter numbers its
 * entries along the reasoning, not the answer) go first, where thinking was.
 *
 * @param {Array<{index?: number, block: Record<string, any>}>} thinking
 * @param {Array<Record<string, any>>} others - The text and tool calls, in order
 * @returns {Array<Record<string, any>>}
 */
function interleave(thinking, others) {
  const total = thinking.length + others.length
  const at = new Map()
  /** @type {Array<Record<string, any>>} */
  const unplaced = []
  for (const entry of thinking) {
    if (Number.isInteger(entry.index) && entry.index < total && !at.has(entry.index)) {
      at.set(entry.index, entry.block)
    } else {
      unplaced.push(entry.block)
    }
  }
  const rest = [...unplaced, ...others]
  /** @type {Array<Record<string, any>>} */
  const out = []
  for (let i = 0; i < total; i++) {
    out.push(at.has(i) ? at.get(i) : rest.shift())
  }
  return out.filter(Boolean)
}

/**
 * Mark a message's blocks as the end of a cached prefix. Thinking blocks
 * can't carry the mark, so it goes on the last one that can.
 *
 * @param {Array<Record<string, any>>} blocks
 */
function markCached(blocks) {
  for (let i = blocks.length - 1; i >= 0; i--) {
    if (blocks[i].type === 'thinking' || blocks[i].type === 'redacted_thinking') continue
    blocks[i] = { ...blocks[i], cache_control: { type: 'ephemeral' } }
    return
  }
}

/**
 * The conversation as the Messages API takes it.
 *
 * The leading system message becomes `system`. A tool's result goes in a user
 * message as a `tool_result` block, the results of one round together, as
 * Anthropic wants them. An assistant message's text, its tool calls and its
 * thinking become blocks in the order they came. Messages with nothing in
 * them are left out, since an empty block is refused.
 *
 * Cache breakpoints go where the OpenRouter path puts them, and for the same
 * reasons (see ai/wire.js): the system prompt, and the message before the
 * latest user message, which carries the volatile part of the turn. Also on
 * the last tool result while a turn is calling tools, so each round of it
 * reads the rounds before at the cached price.
 *
 * @param {Array<Record<string, any>>} messages - The conversation, in the app's shape
 * @param {{thinking?: boolean}} [options] - `thinking: false` leaves the
 *   turns' thinking out, for a request that asks for none
 * @returns {{system: Array<Record<string, any>>, messages: Array<Record<string, any>>}}
 */
export function toAnthropicMessages(messages, { thinking = true } = {}) {
  /** @type {Array<Record<string, any>>} */
  const system = []
  /** @type {Array<Record<string, any>>} */
  const out = []

  const latestUser = lastIndex(messages, message => message?.role === 'user')
  const cachedAt = new Set()
  if (latestUser >= 2) cachedAt.add(latestUser - 1)
  if (messages.at(-1)?.role === 'tool') cachedAt.add(messages.length - 1)

  messages.forEach((message, i) => {
    if (!message) return
    const text = typeof message.content === 'string' ? message.content : ''

    if (message.role === 'system') {
      if (out.length === 0 && text.trim()) {
        system.push({ type: 'text', text })
        return
      }
      // A system message anywhere else is said as the writer's. None is
      // built that way today.
      if (text.trim()) out.push({ role: 'user', content: [{ type: 'text', text }] })
      return
    }

    /** @type {Array<Record<string, any>>} */
    let blocks = []
    let role = message.role === 'assistant' ? 'assistant' : 'user'

    if (message.role === 'assistant') {
      const others = []
      if (text.trim()) others.push({ type: 'text', text })
      for (const call of message.tool_calls || []) {
        others.push({
          type: 'tool_use',
          id: toolUseId(call.id),
          name: call.function?.name || '',
          input: toolInput(call.function?.arguments),
        })
      }
      blocks = interleave(thinking ? thinkingBlocks(message.reasoning_details) : [], others)
    } else if (message.role === 'tool') {
      /** @type {Record<string, any>} */
      const result = { type: 'tool_result', tool_use_id: toolUseId(message.tool_call_id) }
      if (text) result.content = text
      blocks = [result]
    } else if (text.trim()) {
      blocks = [{ type: 'text', text }]
      role = 'user'
    }

    if (blocks.length === 0) return
    if (cachedAt.has(i)) markCached(blocks)

    // One round's results in one message, and a message after them in the
    // same turn joins them rather than standing as a second user message.
    const last = out.at(-1)
    if (
      message.role === 'tool' &&
      last?.role === 'user' &&
      last.content[0]?.type === 'tool_result'
    ) {
      last.content.push(...blocks)
      return
    }
    out.push({ role, content: blocks })
  })

  if (system.length) markCached(system)
  return { system, messages: out }
}

/**
 * What the settings can ask of a model, in the terms ai/capabilities.js
 * reads. A model on a thinking budget takes the three levels a budget is set
 * from; one that decides for itself, the efforts it lists.
 *
 * @param {Omit<ModelInfo, 'id' | 'name'>} info
 * @returns {ModelTraits}
 */
export function claudeTraits(info) {
  const kinds = info.thinking
  return {
    samplers: info.samplers ? ['temperature', 'topP', 'topK'] : [],
    reasoning: kinds
      ? {
          optional: kinds.disabled,
          levels: /** @type {any} */ (
            kinds.adaptive ? info.effort : kinds.enabled ? ['low', 'medium', 'high'] : []
          ),
          defaultLevel: kinds.adaptive ? 'high' : 'medium',
        }
      : null,
  }
}

/**
 * The thinking a request asks for, and at what effort, from settings already
 * fitted to the model (see ai/capabilities.js): Disabled reaches only a model
 * that can stop thinking, and a level only one that takes it. The newest
 * models always think, and Disabled on them has been fitted to their lowest
 * effort.
 *
 * Enabled asks for thinking and leaves the amount to the model. A level is an
 * effort level for a model that takes one, and a budget for an older model
 * that takes a budget instead.
 *
 * @param {AISettings} settings - Fitted to the model
 * @param {Omit<ModelInfo, 'id' | 'name'>} info
 * @param {number} maxTokens - The answer's cap, which a budget must stay under
 * @returns {{thinking?: Record<string, any>, effort?: string}}
 */
export function reasoningFor(settings, info, maxTokens) {
  const kinds = info.thinking
  if (!kinds) return {}
  const level = settings.reasoningEffort
  const display = settings.showModelReasoning ? 'summarized' : 'omitted'
  const takes = /** @param {string} effort */ effort => info.effort.includes(effort)

  if (level === 'disabled') return kinds.disabled ? { thinking: { type: 'disabled' } } : {}

  if (kinds.adaptive) {
    const effort = level !== 'enabled' && takes(level) ? level : undefined
    return { thinking: { type: 'adaptive', display }, effort }
  }

  if (kinds.enabled) {
    const budget = Math.min(
      BUDGETS[/** @type {keyof typeof BUDGETS} */ (level)] ?? BUDGETS.enabled,
      maxTokens - 1
    )
    if (budget < 1024) return {}
    const effort = level !== 'enabled' && takes(level) ? level : undefined
    return { thinking: { type: 'enabled', budget_tokens: budget }, effort }
  }

  return {}
}

/**
 * The whole request for a streamed answer.
 *
 * "Unlimited" is the model's own cap: the Messages API needs a number. The
 * settings are fitted to the model first: of the samplers, only the three
 * Claude has, on the older models that take them, while they aren't thinking,
 * and a temperature rather than a top-p when both are set.
 *
 * @param {Object} args
 * @param {Array<Record<string, any>>} args.messages - The conversation, in the app's shape
 * @param {string} args.model
 * @param {Omit<ModelInfo, 'id' | 'name'>} args.info - What the model can do
 * @param {AISettings} args.settings - Already resolved over AI_DEFAULTS
 * @param {ToolDefinition[]} [args.tools]
 * @param {'auto'|'none'} [args.toolChoice]
 * @returns {{params: Record<string, any>, betas: string[], askedForEffort: boolean}}
 */
export function toAnthropicRequest({ messages, model, info, settings: chosen, tools, toolChoice }) {
  const settings = fitSettings(
    chosen,
    capabilitiesOf({ type: 'anthropic' }, model, claudeTraits(info))
  )
  const cap = info.maxTokens ?? ASSUMED.maxTokens
  const maxTokens = settings.maxTokens > 0 ? Math.min(settings.maxTokens, cap) : cap
  const { thinking, effort } = reasoningFor(settings, info, maxTokens)
  const thinks = !!thinking && thinking.type !== 'disabled'
  const { system, messages: wire } = toAnthropicMessages(messages, { thinking: thinks })

  /** @type {Record<string, any>} */
  const params = { model, max_tokens: maxTokens, messages: wire }
  /** @type {string[]} */
  const betas = []
  if (system.length) params.system = system

  if (thinking) {
    params.thinking = thinks
      ? { ...thinking, block_binding: { prefix_mismatch_behavior: 'drop_block' } }
      : thinking
    if (thinks) betas.push(BINDING_BETA)
  }
  if (effort) params.output_config = { effort }

  const { temperature, topP, topK } = settings.parameters
  if (temperature !== 1.0) params.temperature = temperature
  if (topP !== 1.0) params.top_p = topP
  if (topK > 0) params.top_k = topK

  if (tools && tools.length > 0) {
    params.tools = tools.map(tool => ({
      name: tool.function.name,
      description: tool.function.description,
      input_schema: { type: 'object', properties: {}, ...(tool.function.parameters || {}) },
      // A document the model writes arrives as it is written, not in one
      // piece at the end; the chat shows it coming.
      eager_input_streaming: true,
    }))
    if (toolChoice) params.tool_choice = { type: toolChoice }
  }

  // When the model declines, the model Anthropic names for it answers
  // instead, rather than the turn ending with nothing.
  if (info.fallbacks) {
    params.fallbacks = 'default'
    betas.push(FALLBACK_BETA)
  }

  return { params, betas, askedForEffort: !!effort }
}

/**
 * What ended an answer, in the words the rest of the app uses for it.
 *
 * @param {string|null} reason - Anthropic's `stop_reason`
 * @returns {string|null}
 */
function finishReasonOf(reason) {
  switch (reason) {
    case 'end_turn':
    case 'stop_sequence':
      return 'stop'
    case 'tool_use':
      return 'tool_calls'
    case 'max_tokens':
    case 'model_context_window_exceeded':
      return 'length'
    default:
      return reason
  }
}

/**
 * Said when the model declines and nothing answered in its place.
 */
export class RefusalError extends Error {
  /** @param {string|null} [category] - What Anthropic says it declined over */
  constructor(category) {
    super(
      category
        ? `Claude declined to answer this (${category.replace(/_/g, ' ')}).`
        : 'Claude declined to answer this.'
    )
    this.name = 'RefusalError'
    this.category = category || null
  }
}

/**
 * Reads the events of one streamed answer into what the rest of the app
 * expects of one: the text and thinking as they arrive, through `onChunk`,
 * and at the end the tool calls, the thinking to hand back, usage, and what
 * ended it.
 *
 * Tool arguments are kept as the JSON text they streamed as, which is what
 * every other provider gives and what the tool runner reads.
 *
 * When the model declines part-way and another answers in its place, a
 * `fallback` block marks where. What the first model said stays; its
 * thinking and its tool calls are let go, since nothing can hand them back.
 *
 * @param {(chunk: StreamChunk) => void} onChunk
 * @param {{showReasoning?: boolean}} [options] - `showReasoning: false` keeps
 *   thinking out of the chunks, for a model that sends it whatever it is asked
 */
export function createStreamReader(onChunk, { showReasoning = true } = {}) {
  /** @type {Array<Record<string, any>>} */
  const blocks = []
  /** @type {Record<string, any>} */
  let usage = {}
  /** @type {string|null} */
  let stopReason = null
  /** @type {Record<string, any>|null} */
  let stopDetails = null
  /** @type {string|null} */
  let servedBy = null

  const pendingCalls = () =>
    blocks
      .slice(lastIndex(blocks, block => block?.type === 'fallback') + 1)
      .filter(block => block.type === 'tool_use')
      .map(block => ({ id: block.id, name: block.name, arguments: block.json }))

  /** @param {Record<string, any>} event */
  function push(event) {
    switch (event.type) {
      case 'message_start':
        usage = { ...usage, ...(event.message?.usage || {}) }
        servedBy = event.message?.model || servedBy
        break
      case 'content_block_start': {
        const start = event.content_block || {}
        /** @type {Record<string, any>} */
        const block = { type: start.type }
        if (start.type === 'text') block.text = start.text || ''
        if (start.type === 'thinking') {
          block.thinking = start.thinking || ''
          block.signature = start.signature || ''
        }
        if (start.type === 'redacted_thinking') block.data = start.data
        if (start.type === 'tool_use') {
          block.id = start.id
          block.name = start.name
          block.json = ''
        }
        blocks[event.index] = block
        if (start.type === 'tool_use' || start.type === 'fallback') {
          onChunk({ content: '', reasoning: null, toolCalls: pendingCalls() })
        }
        break
      }
      case 'content_block_delta': {
        const block = blocks[event.index]
        const delta = event.delta || {}
        if (!block) break
        if (delta.type === 'text_delta') {
          block.text += delta.text
          onChunk({ content: delta.text, reasoning: null })
        } else if (delta.type === 'thinking_delta') {
          block.thinking += delta.thinking
          if (showReasoning && delta.thinking) onChunk({ content: '', reasoning: delta.thinking })
        } else if (delta.type === 'signature_delta') {
          block.signature += delta.signature
        } else if (delta.type === 'input_json_delta') {
          block.json += delta.partial_json
          onChunk({ content: '', reasoning: null, toolCalls: pendingCalls() })
        }
        break
      }
      case 'message_delta':
        if (event.delta?.stop_reason) stopReason = event.delta.stop_reason
        if (event.delta?.stop_details !== undefined) stopDetails = event.delta.stop_details
        usage = {
          ...usage,
          ...Object.fromEntries(
            Object.entries(event.usage || {}).filter(([, value]) => value != null)
          ),
        }
        break
    }
  }

  /**
   * The answer, whole.
   *
   * @returns {{usage: {prompt_tokens: number, completion_tokens: number, total_tokens: number}, toolCalls?: ToolCall[], reasoningDetails?: ReasoningDetail[], finishReason: string|null, servedBy: string|null}}
   * @throws {RefusalError} When the model declined and nothing answered instead
   */
  function finish() {
    if (stopReason === 'refusal') throw new RefusalError(stopDetails?.category)

    const boundary = lastIndex(blocks, block => block?.type === 'fallback')
    const kept = blocks.filter(
      (block, i) => block && block.type !== 'fallback' && (i > boundary || block.type === 'text')
    )

    // An answer cut off by its length can end in a call cut off with it,
    // whose arguments are only part of what the model meant.
    if (stopReason === 'max_tokens' && kept.at(-1)?.type === 'tool_use') kept.pop()

    /** @type {ToolCall[]} */
    const toolCalls = []
    /** @type {ReasoningDetail[]} */
    const reasoningDetails = []
    // Positions as `toAnthropicMessages` rebuilds the answer: one text block,
    // where the first one was, with the thinking and the calls around it.
    let position = 0
    let textPlaced = false
    for (const block of kept) {
      if (block.type === 'text') {
        if (!block.text.trim() || textPlaced) continue
        textPlaced = true
        position++
      } else if (block.type === 'thinking') {
        reasoningDetails.push({
          type: 'reasoning.text',
          text: block.thinking,
          signature: block.signature,
          format: THINKING_FORMAT,
          index: position++,
        })
      } else if (block.type === 'redacted_thinking') {
        reasoningDetails.push(
          /** @type {ReasoningDetail} */ ({
            type: 'reasoning.encrypted',
            data: block.data,
            format: THINKING_FORMAT,
            index: position++,
          })
        )
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          type: 'function',
          function: { name: block.name, arguments: block.json || '{}' },
        })
        position++
      }
    }

    const prompt =
      (usage.input_tokens || 0) +
      (usage.cache_creation_input_tokens || 0) +
      (usage.cache_read_input_tokens || 0)
    const completion = usage.output_tokens || 0

    return {
      usage: {
        prompt_tokens: prompt,
        completion_tokens: completion,
        total_tokens: prompt + completion,
      },
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      reasoningDetails: reasoningDetails.length > 0 ? reasoningDetails : undefined,
      finishReason: finishReasonOf(stopReason),
      servedBy,
    }
  }

  return { push, finish }
}

/** @type {Promise<typeof import('@anthropic-ai/sdk').default> | null} */
let sdk = null

/**
 * A client for this connection. The key goes from the writer's browser
 * straight to Anthropic, which is what the SDK's browser switch is for.
 *
 * @param {AIProvider} provider
 */
async function clientFor(provider) {
  sdk ??= import('@anthropic-ai/sdk').then(module => module.default)
  const Anthropic = await sdk
  return new Anthropic({ apiKey: provider.apiKey, dangerouslyAllowBrowser: true, fetch })
}

/**
 * What the API said went wrong, without the SDK's status-and-JSON wrapping.
 *
 * @param {any} error
 * @returns {Error}
 */
function plainly(error) {
  if (error?.status === 429) return new RateLimitedError(RATE_LIMITED, retryAfterOf(error.headers))
  const said = error?.error?.error?.message
  return said ? new Error(said) : error
}

/** @type {Map<string, Promise<ModelInfo|null>>} What each model can do, by connection and model, for the page. */
const described = new Map()

/**
 * Every model the connection's key can use, newest first, as Anthropic lists
 * them. What each can do is kept for the requests that follow.
 *
 * @param {AIProvider} provider
 * @returns {Promise<Array<{id: string, name: string}>>}
 */
export async function listAnthropicModels(provider) {
  const client = await clientFor(provider)
  /** @type {Array<{id: string, name: string, traits: ModelTraits}>} */
  const models = []
  try {
    for await (const model of client.beta.models.list({ betas: [LISTED_FALLBACKS_BETA] })) {
      const info = modelInfo(/** @type {any} */ (model))
      described.set(`${provider.id}:${info.id}`, Promise.resolve(info))
      models.push({ id: info.id, name: info.name, traits: claudeTraits(info) })
    }
  } catch (error) {
    throw plainly(error)
  }
  return models
}

/**
 * What the model can do, asked once a page.
 *
 * @param {AIProvider} provider
 * @param {string} model
 * @returns {Promise<ModelInfo|null>} Null when the Models API doesn't know it
 */
function describe(provider, model) {
  const key = `${provider.id}:${model}`
  if (!described.has(key)) {
    const asking = clientFor(provider)
      .then(client => client.beta.models.retrieve(model, { betas: [LISTED_FALLBACKS_BETA] }))
      .then(found => modelInfo(/** @type {any} */ (found)))
      .catch(error => {
        console.warn(`Could not ask Anthropic what ${model} can do:`, error)
        described.delete(key)
        return null
      })
    described.set(key, asking)
  }
  return /** @type {Promise<ModelInfo|null>} */ (described.get(key))
}

/**
 * One streamed answer from Claude.
 *
 * @param {Object} args
 * @param {AIProvider} args.provider
 * @param {string} args.model
 * @param {Array<Record<string, any>>} args.messages - The conversation, in the app's shape
 * @param {AISettings} args.settings - Already resolved over AI_DEFAULTS
 * @param {ToolDefinition[]} [args.tools]
 * @param {'auto'|'none'} [args.toolChoice]
 * @param {AbortSignal} [args.signal]
 * @param {(chunk: StreamChunk) => void} args.onChunk
 * @returns {Promise<ReturnType<ReturnType<typeof createStreamReader>['finish']>>}
 * @throws {Error} What the API said, a {@link RefusalError}, or the signal's
 *   reason when it is stopped
 */
export async function streamAnthropic({
  provider,
  model,
  messages,
  settings,
  tools,
  toolChoice,
  signal,
  onChunk,
}) {
  const info = (await describe(provider, model)) || ASSUMED
  const { params, betas } = toAnthropicRequest({
    messages,
    model,
    info,
    settings,
    tools,
    toolChoice,
  })
  const reader = createStreamReader(onChunk, { showReasoning: settings.showModelReasoning })
  const client = await clientFor(provider)

  try {
    const stream = client.beta.messages.stream(
      /** @type {any} */ ({ ...params, ...(betas.length ? { betas } : {}) }),
      { signal }
    )
    for await (const event of stream) reader.push(/** @type {any} */ (event))
  } catch (error) {
    if (signal?.aborted) throw signal.reason
    throw plainly(error)
  }

  const result = reader.finish()
  if (result.servedBy && result.servedBy !== model) {
    console.log(`${model} declined, and ${result.servedBy} answered instead`)
  }
  return result
}
