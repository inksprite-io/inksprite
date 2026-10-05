/**
 * @typedef {import('../types/models.js').AIProvider} AIProvider
 * @typedef {{id: string, name: string}} AIModel
 */

import { useAIConfig } from '@/composables/useAIConfig'
import { resolveAISettings } from '@/ai/defaults.js'
import {
  ATTRIBUTION_HEADERS,
  buildCompletionBody,
  chatCompletionsUrl,
  modelsUrl,
} from '@/ai/wire.js'

/**
 * Parse models response from API
 * @param {Response} response - Fetch response
 * @param {string} providerName - Provider name for logging
 * @returns {Promise<AIModel[]>} Parsed and sorted models
 * @throws {Error} When response is invalid
 */
async function parseModelsResponse(response, providerName) {
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Connection failed' }))
    throw new Error(error.error?.message || error.error || `HTTP ${response.status}`)
  }

  const data = await response.json()

  // Verify we got models back
  if (!data.data || !Array.isArray(data.data)) {
    throw new Error('Invalid response format from provider')
  }

  // Log models to console for debugging
  console.log(`Found ${data.data.length} models from ${providerName}:`, data.data)

  // Sort models alphabetically and return simplified format
  const models = data.data
    .map(model => ({
      id: model.id,
      name: model.name || model.id,
    }))
    .sort((a, b) => {
      const nameA = a.name.toLowerCase()
      const nameB = b.name.toLowerCase()
      return nameA.localeCompare(nameB)
    })

  return models
}

/**
 * @typedef {import('../types/models.js').AIPreset} AIPreset
 * @typedef {import('../ai/defaults.js').AIDefaults} AIDefaults
 * @typedef {import('../ai/defaults.js').AISettingsOverrides} AISettingsOverrides
 * @typedef {import('../ai/tools/registry.js').ToolDefinition} ToolDefinition
 * @typedef {import('../ai/tools/registry.js').ToolCall} ToolCall
 *
 * @typedef {Object} AIConfig
 * @property {string} providerId - Provider ID
 * @property {string} model - Model identifier
 */

/**
 * What the streaming callback is handed. Content and reasoning are the piece
 * that just arrived; `toolCalls` is every call so far, whole, each time any
 * of them grows — the arguments are a JSON text mid-arrival, and the chat
 * reads them as such.
 *
 * @typedef {Object} StreamChunk
 * @property {string} content
 * @property {string|null} reasoning
 * @property {import('../types/models.js').PendingToolCall[]} [toolCalls]
 */

/**
 * Accumulate streaming tool call deltas into complete tool calls
 * Tool calls stream as indexed deltas that need merging
 * @param {ToolCall[]} accumulated - Array of accumulated tool calls
 * @param {Array<{index: number, id?: string, type?: string, function?: {name?: string, arguments?: string}}>} deltas - Deltas to merge
 */
function accumulateToolCalls(accumulated, deltas) {
  for (const delta of deltas) {
    const index = delta.index
    if (!accumulated[index]) {
      accumulated[index] = {
        id: '',
        type: /** @type {const} */ ('function'),
        function: { name: '', arguments: '' },
      }
    }
    if (delta.id) accumulated[index].id = delta.id
    if (delta.type) accumulated[index].type = /** @type {'function'} */ (delta.type)
    if (delta.function?.name) accumulated[index].function.name += delta.function.name
    if (delta.function?.arguments) accumulated[index].function.arguments += delta.function.arguments
  }
}

/**
 * Reasoning detail entry from OpenRouter extended thinking.
 *
 * The fields below are the ones we know by name; the shape varies by reasoning
 * type — a summarized or encrypted block carries an opaque payload instead of
 * readable text. Anything a provider sends is passed through untouched, since
 * a block that has lost a field it was signed with is a block the provider
 * will reject when the turn continues.
 *
 * @typedef {Object} ReasoningDetail
 * @property {string} type - Type of reasoning (e.g., 'reasoning.text')
 * @property {string} [text] - Reasoning text content
 * @property {string} [signature] - Cryptographic signature for continuation
 * @property {string} [format] - Format identifier (e.g., 'anthropic-claude-v1')
 * @property {number} index - Index in the reasoning chain
 */

/**
 * Accumulate reasoning_details from streaming deltas, merged by index.
 *
 * Only `text` arrives in pieces. Everything else — signatures, formats,
 * encrypted payloads, whatever a provider names its own fields — comes whole,
 * so the later value wins and unrecognised fields ride along. Naming the
 * fields we keep would quietly gut any block that isn't plain text, and the
 * failure shows up later, mid-tool-loop, as a rejected continuation.
 *
 * @param {ReasoningDetail[]} accumulated - Array of accumulated reasoning details
 * @param {ReasoningDetail[]} deltas - Deltas to merge
 */
function accumulateReasoningDetails(accumulated, deltas) {
  for (const delta of deltas) {
    const index = delta.index ?? 0
    const previous = accumulated[index]

    if (!previous) {
      accumulated[index] = { type: 'reasoning.text', ...delta, index }
      continue
    }

    accumulated[index] = { ...previous, ...delta, index }
    if (previous.text || delta.text) {
      accumulated[index].text = (previous.text || '') + (delta.text || '')
    }
  }
}

/**
 * @typedef {{slug: string, name: string}} OpenRouterProvider
 */

/**
 * The upstream providers OpenRouter can route to. Public — no key needed — and
 * stable enough to cache for the life of the page, since the routing panel
 * re-reads it every time it opens.
 *
 * @type {Promise<OpenRouterProvider[]>|null}
 */
let openRouterProvidersPromise = null

/**
 * Fetch the OpenRouter provider directory, so the routing panel can offer real
 * names instead of asking the user to know slugs.
 *
 * @returns {Promise<OpenRouterProvider[]>} Providers sorted by display name
 * @throws {Error} When the request fails or returns an unexpected shape
 */
function listOpenRouterProviders() {
  if (!openRouterProvidersPromise) {
    openRouterProvidersPromise = (async () => {
      const response = await fetch('https://openrouter.ai/api/v1/providers')
      if (!response.ok) throw new Error(`HTTP ${response.status}`)

      const data = await response.json()
      if (!Array.isArray(data?.data)) {
        throw new Error('Invalid response format from OpenRouter')
      }

      return data.data
        .filter(entry => typeof entry?.slug === 'string' && entry.slug.length > 0)
        .map(entry => ({ slug: entry.slug, name: entry.name || entry.slug }))
        .sort((a, b) => a.name.localeCompare(b.name))
    })().catch(error => {
      // Don't cache a failure — a flaky network shouldn't leave the panel
      // permanently unable to offer names.
      openRouterProvidersPromise = null
      throw error
    })
  }
  return openRouterProvidersPromise
}

/**
 * Say what a provider's refusal actually means, when it means the reasoning.
 *
 * Two ways a request gets refused over thinking, and they need different
 * advice. Extended thinking blocks come back signed, and a provider refuses a
 * continuation whose signature it cannot verify. Separately, a model whose
 * thinking is a switch rather than a dial refuses an effort level outright —
 * DeepSeek answers "thinking mode openai_effort is not supported" — and that
 * one fails on the first request of the turn, before any reasoning has been
 * echoed anywhere.
 *
 * From the writer's side both are a turn that died quoting a field they have
 * never heard of, so name it and say what to change. Also warns, since the
 * message the provider sent is worth having in full.
 *
 * The third is routing. A connection's policy — the privacy and precision
 * floor it has by default — can exclude every endpoint that serves a model,
 * and OpenRouter answers with a 404 that names the filter and nothing else.
 * The writer never set that filter, so say where it lives.
 *
 * @param {unknown} reported - What the provider said
 * @param {{sentReasoning: boolean, askedForEffort: boolean, routed?: boolean}} request - What this request carried
 * @returns {string}
 */
function explainFailure(reported, { sentReasoning, askedForEffort, routed = false }) {
  const message = typeof reported === 'string' ? reported : JSON.stringify(reported)

  if (routed && /no endpoints found/i.test(message)) {
    console.warn('No endpoint passed the routing policy this request carried:', message)
    return `${message} — this connection's routing policy excludes every endpoint that serves this model. Open the connection's Provider Routing settings and lower the precision or zero-data-retention floor to reach it.`
  }

  if (!/signature|thinking|reasoning|effort/i.test(message)) return message

  if (askedForEffort && /effort/i.test(message)) {
    console.warn('Provider rejected the reasoning effort this request asked for:', message)
    return `${message} — this request asked for a reasoning effort level and this model does not take one. Set Reasoning Effort to Enabled for this profile to let the provider choose, or Disabled to turn thinking off.`
  }

  if (sentReasoning) {
    console.warn('Provider rejected the reasoning sent back to continue the turn:', message)
    return `${message} — this turn sent the model's own reasoning back to continue it, and the provider rejected it. Set Reasoning Effort to Disabled for this connection if it keeps happening.`
  }

  return message
}

/**
 * Composable for AI service operations (model listing, completions, chat)
 *
 * @returns {{
 *   listModels: (providerId: string) => Promise<AIModel[]>,
 *   listOpenRouterProviders: () => Promise<OpenRouterProvider[]>,
 *   generateChatCompletion: (messages: Array<{role: string, content: string|null, tool_call_id?: string, tool_calls?: ToolCall[], reasoning_details?: ReasoningDetail[]}>, config: AIConfig, onChunk: (chunk: StreamChunk) => void, options?: {tools?: ToolDefinition[], toolChoice?: 'auto'|'none', overrides?: AISettingsOverrides, signal?: AbortSignal}) => Promise<{usage?: {prompt_tokens: number, completion_tokens: number, total_tokens: number}, toolCalls?: ToolCall[], reasoningDetails?: ReasoningDetail[], finishReason?: string|null}>,
 *   validateOpenRouterKey: (apiKey: string) => Promise<boolean>,
 *   exchangeOAuthCode: (code: string, codeVerifier: string) => Promise<string>
 * }}
 */
export const useAIService = () => {
  const aiConfig = useAIConfig()

  /**
   * List available models for a specific provider
   * @param {string} providerId - The provider ID
   * @returns {Promise<AIModel[]>} Array of available models
   * @throws {Error} When provider not found or API call fails
   */
  async function listModels(providerId) {
    const provider = aiConfig.getProvider(providerId)
    if (!provider) {
      throw new Error(`Provider ${providerId} not found`)
    }

    try {
      const url = modelsUrl(provider)

      // Build headers
      /** @type {Record<string, string>} */
      const headers = { 'Content-Type': 'application/json', ...ATTRIBUTION_HEADERS }
      if (provider.apiKey) {
        headers.Authorization = `Bearer ${provider.apiKey}`
      }

      // Make the API request
      const response = await fetch(url, {
        method: 'GET',
        headers,
      })

      return await parseModelsResponse(response, provider.name)
    } catch (error) {
      console.error(`Failed to list models for provider ${provider.name}:`, error)
      throw error
    }
  }

  /**
   * Generate chat completion with streaming.
   *
   * `config` only needs `providerId` and `model`. Sampler/reasoning/maxTokens
   * come from AI_DEFAULTS, optionally adjusted by `options.overrides` (used
   * for short auxiliary calls like title generation).
   *
   * @param {Array<{role: string, content: string|null, tool_call_id?: string, tool_calls?: ToolCall[], reasoning_details?: ReasoningDetail[]}>} messages - Chat messages
   * @param {AIConfig} config - Active AI configuration (providerId + model)
   * @param {(chunk: StreamChunk) => void} onChunk - Callback for each streamed chunk
   * @param {Object} [options] - Additional options
   * @param {ToolDefinition[]} [options.tools] - Tool definitions to include
   * @param {'auto'|'none'} [options.toolChoice] - `none` to have it answer without calling any
   * @param {AISettingsOverrides} [options.overrides] - Per-call overrides on top of AI_DEFAULTS
   * @param {AbortSignal} [options.signal] - Stops the request. Each caller
   *   brings its own, so a chat, a summary and a skill can all be asking at
   *   once and stopping one stops only that one.
   * @returns {Promise<{usage?: {prompt_tokens: number, completion_tokens: number, total_tokens: number}, toolCalls?: ToolCall[], reasoningDetails?: ReasoningDetail[], finishReason?: string}>}
   * @throws {Error} When provider not found or API call fails, and the
   *   signal's `AbortError` when it is stopped
   */
  async function generateChatCompletion(messages, config, onChunk, options = {}) {
    const provider = aiConfig.getProvider(config.providerId)
    if (!provider) {
      throw new Error(`Provider ${config.providerId} not found`)
    }

    try {
      const url = chatCompletionsUrl(provider)

      /** @type {Record<string, string>} */
      const headers = {
        'Content-Type': 'application/json',
        ...ATTRIBUTION_HEADERS,
        Accept: 'text/event-stream',
      }
      if (provider.apiKey) {
        headers.Authorization = `Bearer ${provider.apiKey}`
      }

      // The two things in this request a provider can reject for reasons its
      // error message won't explain on its own come back alongside the body.
      const { body, sentReasoning, askedForEffort } = buildCompletionBody({
        messages,
        model: config.model,
        provider,
        settings: resolveAISettings(options.overrides),
        tools: options.tools,
        toolChoice: options.toolChoice,
      })

      // Make the API request
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: options.signal,
      })

      if (!response.ok) {
        // Handle rate limiting with a user-friendly message
        if (response.status === 429) {
          throw new Error(
            'Rate limit exceeded. Please wait a moment and try again, or consider using a different model.'
          )
        }
        const error = await response.json().catch(() => ({ error: 'Connection failed' }))
        const reported = error.error?.message || error.error || `HTTP ${response.status}`
        throw new Error(
          explainFailure(reported, {
            sentReasoning,
            askedForEffort,
            routed: Boolean(body.provider),
          })
        )
      }

      // Process the streaming response
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let usageInfo = null
      /** @type {ToolCall[]} */
      const toolCalls = []
      /** @type {ReasoningDetail[]} */
      const reasoningDetails = []
      let finishReason = null
      /** Set when a provider fails part-way through and closes the stream. */
      let streamError = null

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6)
            if (data === '[DONE]') continue

            try {
              const parsed = JSON.parse(data)

              // A provider that fails after the response headers reports it as
              // an event and closes. Nothing below reads it, so the turn would
              // otherwise end with no content and nothing said about why.
              if (parsed.error) {
                streamError = parsed.error.message || parsed.error
                break
              }

              const delta = parsed.choices?.[0]?.delta
              const content = delta?.content

              // Two names in the wild for the same channel: `reasoning`
              // (OpenRouter, current vLLM) and `reasoning_content` (DeepSeek's
              // shape, which LM Studio and lmdeploy follow).
              const reasoning = delta?.reasoning ?? delta?.reasoning_content

              // Accumulate tool call deltas, and say so: the prose a model
              // writes into a call would otherwise be silence until it ends.
              if (delta?.tool_calls) {
                accumulateToolCalls(toolCalls, delta.tool_calls)
                onChunk({
                  content: '',
                  reasoning: null,
                  toolCalls: toolCalls.map(call => ({
                    id: call.id,
                    name: call.function.name,
                    arguments: call.function.arguments,
                  })),
                })
              }

              // Accumulate reasoning_details for extended thinking continuation
              if (delta?.reasoning_details?.length > 0) {
                accumulateReasoningDetails(reasoningDetails, delta.reasoning_details)
              }

              // Capture finish reason
              if (parsed.choices?.[0]?.finish_reason) {
                finishReason = parsed.choices[0].finish_reason
              }

              // Pass both content and reasoning to callback
              if (content || reasoning) {
                onChunk({
                  content: content || '',
                  reasoning: reasoning || null,
                })
              }

              // Capture usage info if available (OpenRouter provides this)
              if (parsed.usage) {
                usageInfo = {
                  prompt_tokens: parsed.usage.prompt_tokens || 0,
                  completion_tokens: parsed.usage.completion_tokens || 0,
                  total_tokens: parsed.usage.total_tokens || 0,
                }
              }
            } catch (e) {
              console.warn('Failed to parse streaming chunk:', e)
            }
          }
        }

        if (streamError) break
      }

      if (streamError) {
        await reader.cancel().catch(() => {})
        throw new Error(explainFailure(streamError, { sentReasoning, askedForEffort }))
      }

      // Indexed writes leave holes when a provider starts numbering above
      // zero, and a hole serializes to a null the next request has to carry.
      const details = reasoningDetails.filter(Boolean)

      return {
        usage: usageInfo,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        reasoningDetails: details.length > 0 ? details : undefined,
        finishReason,
      }
    } catch (error) {
      // Stopped is not failed: whoever stopped it knows.
      if (!options.signal?.aborted) console.error('Failed to generate chat completion:', error)
      throw error
    }
  }

  /**
   * Validate an OpenRouter API key by checking the auth endpoint
   * @param {string} apiKey - The API key to validate
   * @returns {Promise<boolean>} True if valid, false otherwise
   */
  async function validateOpenRouterKey(apiKey) {
    if (!apiKey || !apiKey.trim()) {
      return false
    }

    try {
      const response = await fetch('https://openrouter.ai/api/v1/auth/key', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      })

      if (response.ok) {
        const data = await response.json()
        // Check if we got a valid response with data property
        return data && typeof data === 'object'
      }
      return false
    } catch (error) {
      console.error('Failed to validate OpenRouter API key:', error)
      return false
    }
  }

  /**
   * Exchange OAuth authorization code for an API key
   * @param {string} code - Authorization code from OAuth callback
   * @param {string} codeVerifier - PKCE code verifier
   * @returns {Promise<string>} The API key
   * @throws {Error} When exchange fails
   */
  async function exchangeOAuthCode(code, codeVerifier) {
    try {
      const response = await fetch('https://openrouter.ai/api/v1/auth/keys', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          code,
          code_verifier: codeVerifier,
          code_challenge_method: 'S256',
        }),
      })

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Failed to exchange code' }))
        throw new Error(error.error?.message || error.error || `HTTP ${response.status}`)
      }

      const data = await response.json()

      if (!data.key) {
        throw new Error('No API key returned from OAuth exchange')
      }

      return data.key
    } catch (error) {
      console.error('Failed to exchange OAuth code:', error)
      throw error
    }
  }

  return {
    listModels,
    listOpenRouterProviders,
    generateChatCompletion,
    validateOpenRouterKey,
    exchangeOAuthCode,
  }
}
