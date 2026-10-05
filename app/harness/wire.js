/**
 * @module harness/wire
 * @description One chat completion, no streaming, no stores.
 *
 * The app's own request path is built for a UI that streams into a message and
 * for providers it has types for. An experiment that runs dozens of small
 * calls wants none of that, so this is the whole of it: a POST, the settings
 * the app would have resolved, and the text that came back.
 *
 * `reasoning` is the one field worth spelling out. `reasoning_effort: 'none'`
 * is what actually stops a thinking model thinking on LM Studio — the
 * OpenRouter-shaped `reasoning: {enabled: false}` is ignored there, and
 * `chat_template_kwargs.enable_thinking` is both ignored and harmful (the
 * model thinks anyway and the budget goes to a reasoning block that never
 * reaches an answer). On OpenRouter it is the other way round: `reasoning` is
 * the field, and the effort the app defaults to is sent so a probe here sees
 * the model the app sees.
 *
 * Tools are offered when asked for and handed back unexecuted: what a call
 * returned is the caller's to decide, and `reasoning_details` rides along so
 * an OpenRouter model that thinks between calls can be continued.
 *
 * An OpenRouter endpoint carries the app's routing policy, resolved the way
 * the app resolves it — so the privacy floor holds here too, and an entry in
 * `endpoints.local.json` can pin providers or precisions with a `routing`
 * block. What came back says which upstream served it, and that is returned,
 * because a batch run on an unknown quantization is a batch nobody can
 * compare with anything.
 */

import { ATTRIBUTION_HEADERS, chatCompletionsUrl } from '@/ai/wire.js'
import { resolveAISettings } from '@/ai/defaults.js'
import { buildProviderRouting } from '@/ai/routing.js'

/**
 * @typedef {Object} Completion
 * @property {string} content
 * @property {string} reasoning
 * @property {any[]} toolCalls - Tool calls the model made, in wire shape, or empty
 * @property {any} [reasoningDetails] - OpenRouter's reasoning blocks, to echo
 *   back on the assistant message when continuing after tool calls
 * @property {string} [provider] - The upstream that served it, when the server says
 * @property {{prompt: number, completion: number}} usage
 * @property {string} finish - Why generation stopped. `length` with empty
 *   content means the budget went to a reasoning block that never reached an
 *   answer, which is indistinguishable from a refusal without this field.
 * @property {number} ms
 */

/**
 * @param {object} opts
 * @param {import('./endpoints.js').Endpoint} opts.endpoint
 * @param {string} opts.model
 * @param {Array<{role: string, content: string}>} opts.messages
 * @param {boolean} [opts.thinking] - Default true; false asks the server to skip it
 * @param {import('@/ai/defaults.js').AISettingsOverrides} [opts.overrides]
 * @param {number} [opts.maxTokens]
 * @param {any[]} [opts.tools] - Tool definitions to offer, in wire shape
 * @returns {Promise<Completion>}
 */
export async function complete({
  endpoint,
  model,
  messages,
  thinking = true,
  overrides = {},
  maxTokens = 0,
  tools = [],
}) {
  const settings = resolveAISettings(overrides)
  const params = settings.parameters

  /** @type {Record<string, any>} */
  const body = {
    model,
    messages,
    temperature: params.temperature,
    top_p: params.topP,
    stream: false,
  }
  if (maxTokens > 0) body.max_tokens = maxTokens
  if (params.minP > 0) body.min_p = params.minP
  if (params.topK > 0) body.top_k = params.topK
  if (params.repetitionPenalty !== 1.0) body.repetition_penalty = params.repetitionPenalty
  if (tools.length > 0) body.tools = tools
  if (endpoint.type === 'openrouter') {
    body.reasoning = thinking ? { effort: settings.reasoningEffort } : { enabled: false }
    const routing = buildProviderRouting({ type: endpoint.type, routing: endpoint.routing })
    if (routing) body.provider = routing
  } else if (!thinking) {
    body.reasoning_effort = 'none'
  }

  /** @type {Record<string, string>} */
  const headers = { 'Content-Type': 'application/json', ...ATTRIBUTION_HEADERS }
  if (endpoint.apiKey) headers.Authorization = `Bearer ${endpoint.apiKey}`

  const started = Date.now()

  // A long call against a local server sometimes comes back as `fetch failed`
  // — the socket sits idle while the request waits its turn behind another
  // generation, and something between here and the host drops it. It costs one
  // retry to find out, and losing a ten-minute scene to a reset connection on
  // its last call is the alternative.
  let response
  for (let attempt = 0; ; attempt++) {
    try {
      response = await fetch(chatCompletionsUrl(endpoint), {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })
      break
    } catch (error) {
      if (attempt === 1) throw error
      await new Promise(wait => setTimeout(wait, 2000))
    }
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`)
  }
  const data = await response.json()
  const message = data.choices?.[0]?.message || {}

  return {
    content: (message.content || '').trim(),
    reasoning: (message.reasoning_content || message.reasoning || '').trim(),
    toolCalls: message.tool_calls || [],
    ...(message.reasoning_details ? { reasoningDetails: message.reasoning_details } : {}),
    ...(typeof data.provider === 'string' ? { provider: data.provider } : {}),
    finish: data.choices?.[0]?.finish_reason || 'unknown',
    usage: {
      prompt: data.usage?.prompt_tokens || 0,
      completion: data.usage?.completion_tokens || 0,
    },
    ms: Date.now() - started,
  }
}
