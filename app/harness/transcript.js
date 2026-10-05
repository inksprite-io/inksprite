/**
 * @module harness/transcript
 * @description A chat as a markdown file: what was said, what the model
 * called on the way, and what it cost. The file a reader scores.
 */

import { formatCommand } from '@/ai/commands.js'

/** @typedef {import('@/types/models.js').Message} Message */
/** @typedef {import('@/types/models.js').ApiMessage} ApiMessage */

/**
 * @param {Message[]} messages - The chat, in order
 * @param {{title: string, lines?: string[]}} head - Title and any lines to put under it
 * @returns {string}
 */
export function renderTranscript(messages, head) {
  const out = [`# ${head.title}`, '']
  if (head.lines?.length) out.push(...head.lines, '')

  for (const message of messages) {
    if (message.role === 'user') {
      out.push('## User', '', message.content.trim(), '')
      continue
    }

    out.push('## Assistant', '')
    // A command's message is what it was asked, then what came back: the line
    // that asked it goes first, since nothing else in the chat records it.
    const command = message.metadata?.command
    if (command) out.push(`\`${formatCommand(command)}\``, '')
    const reasoning = message.reasoningContent?.trim()
    if (reasoning) {
      out.push('<details><summary>Reasoning</summary>', '', reasoning, '', '</details>', '')
    }
    const direction = message.metadata?.director
    if (direction?.direction || direction?.error) {
      out.push('**Director**', '')
      out.push(direction.error ? `_error: ${direction.error}_` : direction.direction.trim(), '')
    }
    const calls = toolCalls(message.metadata?.apiTrajectory || [])
    if (calls.length > 0) {
      out.push('**Tools**', '')
      for (const call of calls) out.push(`- ${call}`)
      out.push('')
    }
    out.push(message.content.trim() || '_(no reply)_', '')
    const usage = message.metadata?.usage
    if (usage) {
      const requests = `${usage.requests} request${usage.requests === 1 ? '' : 's'}`
      out.push(
        `_${usage.promptTokens} prompt · ${usage.completionTokens} completion · ${requests}_`,
        ''
      )
    }
  }

  return out.join('\n')
}

/**
 * Each tool call on one line with what came back, shortened.
 *
 * @param {ApiMessage[]} trajectory
 * @returns {string[]}
 */
function toolCalls(trajectory) {
  /** @type {Map<string, string>} */
  const results = new Map()
  for (const message of trajectory) {
    if (message.role === 'tool' && message.tool_call_id) {
      results.set(message.tool_call_id, message.content || '')
    }
  }

  const lines = []
  for (const message of trajectory) {
    for (const call of message.tool_calls || []) {
      const result = results.get(call.id) ?? ''
      const args = short(call.function.arguments, 80)
      lines.push(
        `\`${call.function.name}(${args})\` → ${short(result, 100)} (${result.length} chars)`
      )
    }
  }
  return lines
}

/**
 * @param {unknown} text
 * @param {number} limit
 * @returns {string}
 */
function short(text, limit) {
  const one = String(text).replace(/\s+/g, ' ').trim()
  return one.length <= limit ? one : `${one.slice(0, limit - 1)}…`
}

/**
 * Words in a piece of prose, for the run summary.
 * @param {string} text
 * @returns {number}
 */
export function wordCount(text) {
  return (text.match(/\S+/g) || []).length
}
