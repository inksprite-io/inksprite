/**
 * @module ai/complete
 * @description One request to a model, answered in full.
 *
 * The chat's service streams a turn into the conversation, its tool calls
 * and its thinking with it. A job wants none of that, and asks here instead —
 * the same wire shape, the same headers, its own abort signal — and gets the
 * whole answer back when the model is done, with a callback for anyone
 * showing progress as it streams.
 */

import { fetch } from '@/platform/fetch.js'
import { resolveAISettings } from './defaults.js'
import { ATTRIBUTION_HEADERS, buildCompletionBody, chatCompletionsUrl } from './wire.js'

/** @typedef {import('@/types/models.js').AIProvider} AIProvider */

/**
 * What came back.
 *
 * @typedef {Object} Completion
 * @property {string} content - The model's answer, whole
 * @property {{prompt_tokens?: number, completion_tokens?: number, total_tokens?: number}|null} usage
 * @property {string|null} finishReason - What ended the answer: `stop`, `length`, or a provider's word
 */

/**
 * Ask a model once and wait for all of its answer.
 *
 * @param {Object} args
 * @param {AIProvider} args.provider
 * @param {string} args.model
 * @param {string[]} [args.allowedProviders] - The only upstreams OpenRouter may route to
 * @param {Array<{role: string, content: string}>} args.messages
 * @param {import('./defaults.js').AISettingsOverrides} [args.overrides] - On top of AI_DEFAULTS
 * @param {AbortSignal} [args.signal]
 * @param {(text: string) => void} [args.onChunk] - Each piece of the answer as it streams
 * @returns {Promise<Completion>}
 * @throws {Error} When the provider refuses, fails mid-stream, or the request is aborted
 */
export async function complete({
  provider,
  model,
  allowedProviders,
  messages,
  overrides,
  signal,
  onChunk,
}) {
  /** @type {Record<string, string>} */
  const headers = {
    'Content-Type': 'application/json',
    ...ATTRIBUTION_HEADERS,
    Accept: 'text/event-stream',
  }
  if (provider.apiKey) headers.Authorization = `Bearer ${provider.apiKey}`

  const { body } = buildCompletionBody({
    messages,
    model,
    provider,
    allowedProviders,
    settings: resolveAISettings(overrides),
  })

  const response = await fetch(chatCompletionsUrl(provider), {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal,
  })
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Connection failed' }))
    const reported = error.error?.message || error.error || `HTTP ${response.status}`
    throw new Error(typeof reported === 'string' ? reported : JSON.stringify(reported))
  }
  if (!response.body) throw new Error('The provider sent no response body')

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let content = ''
  /** @type {Completion['usage']} */
  let usage = null
  /** @type {string|null} */
  let finishReason = null

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const data = line.slice(6)
      if (data === '[DONE]') continue
      let parsed
      try {
        parsed = JSON.parse(data)
      } catch {
        continue
      }
      if (parsed.error) {
        throw new Error(parsed.error.message || String(parsed.error))
      }
      const choice = parsed.choices?.[0]
      const piece = choice?.delta?.content
      if (typeof piece === 'string' && piece) {
        content += piece
        onChunk?.(piece)
      }
      if (choice?.finish_reason) finishReason = choice.finish_reason
      if (parsed.usage) usage = parsed.usage
    }
  }

  return { content, usage, finishReason }
}
