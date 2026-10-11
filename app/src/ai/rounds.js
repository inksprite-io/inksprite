/**
 * @module ai/rounds
 * @description Which of the calls a round asked for it runs.
 *
 * A model can come apart in the middle of a response and ask for the same call
 * over and over. On 5 Oct 2026 GLM 5.2, served by one upstream, asked for one
 * listing 253 times in a single response, and in another for each of 37 reads
 * over a hundred times: 1,257 calls in one round. Every call ran, every answer
 * went into the conversation, and since a turn's document calls stay there
 * until a summary, every later request carried all of them, half a million
 * tokens a turn.
 *
 * So a round runs each distinct call once, and at most ROUND_LIMIT of them.
 * What it leaves out is answered with one error on the first call it left out,
 * which tells the model, and the rest are taken off the record: nothing was
 * run for them, and the request that follows has no call without an answer.
 *
 * Nor does a round run a call to a tool its request did not offer. Every call
 * a chat made goes back with it, so a model sees the tools it was offered once
 * and can reach for one after the writer has switched it off: on 10 Oct 2026
 * GLM 5.2, in a chat that had searched the web and then had the web switched
 * off, searched five more times, and the registry, which runs any tool it
 * holds, ran every search. Each such call is answered with an error of its own.
 */

/** @typedef {import('./tools/registry.js').ToolCall} ToolCall */
/** @typedef {import('./tools/registry.js').ToolDefinition} ToolDefinition */

/**
 * The most calls one round runs. More than a model reading a handful of papers
 * at once needs, and far fewer than a response that has come apart asks for.
 */
export const ROUND_LIMIT = 20

/**
 * A call as what it asks for: its tool and its arguments, however they were
 * spaced.
 *
 * @param {ToolCall} call
 * @returns {string}
 */
function asked(call) {
  const text = call.function?.arguments || '{}'
  let args = text
  try {
    args = JSON.stringify(JSON.parse(text))
  } catch {
    // Not JSON: compared as written.
  }
  return `${call.function?.name}\n${args}`
}

/**
 * The calls a round runs, and the first one it does not, with how many it
 * leaves out in all.
 *
 * @param {ToolCall[]} calls - What the model asked for, in order
 * @param {number} [limit]
 * @returns {{run: ToolCall[], refused: ToolCall|null, left: number}}
 */
export function trimRound(calls, limit = ROUND_LIMIT) {
  const seen = new Set()
  /** @type {ToolCall[]} */
  const run = []
  /** @type {ToolCall[]} */
  const over = []
  for (const call of calls || []) {
    const key = asked(call)
    if (seen.has(key) || run.length >= limit) {
      over.push(call)
      continue
    }
    seen.add(key)
    run.push(call)
  }
  return { run, refused: over[0] || null, left: over.length }
}

/**
 * The answer to the first call a round left out, which speaks for all of them.
 *
 * @param {ToolCall} call
 * @param {number} left - How many calls the round left out, this one included
 * @param {number} [limit]
 * @returns {{role: 'tool', tool_call_id: string, content: string}}
 */
export function refusedAnswer(call, left, limit = ROUND_LIMIT) {
  const others = left - 1
  return {
    role: 'tool',
    tool_call_id: call.id,
    content: JSON.stringify({
      error: `Not run${others > 0 ? `, and nor were ${others} more calls in this round` : ''}: repeats of a call already made in it, or more than ${limit} at once. Make the calls you still need, a few at a time.`,
    }),
  }
}

/**
 * The calls among these to a tool the request offered, which run, and the
 * rest, which are answered without running.
 *
 * @param {ToolCall[]} calls
 * @param {ToolDefinition[]} tools - What the request that asked for them offered
 * @returns {{offered: ToolCall[], unoffered: ToolCall[]}}
 */
export function splitOffered(calls, tools) {
  const names = new Set(tools.map(tool => tool.function.name))
  /** @type {ToolCall[]} */
  const offered = []
  /** @type {ToolCall[]} */
  const unoffered = []
  for (const call of calls) (names.has(call.function?.name) ? offered : unoffered).push(call)
  return { offered, unoffered }
}

/**
 * The answer to a call to a tool the request did not offer.
 *
 * @param {ToolCall} call
 * @returns {{role: 'tool', tool_call_id: string, content: string}}
 */
export function unofferedAnswer(call) {
  return {
    role: 'tool',
    tool_call_id: call.id,
    content: JSON.stringify({
      error: `Not run: ${call.function?.name} is not one of the tools this chat offers now.`,
    }),
  }
}
