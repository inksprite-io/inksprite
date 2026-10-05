/**
 * @module ai/skills/loads
 * @description Which skills a chat has loaded, read off the chat itself.
 *
 * A skill that joins the conversation is loaded once and followed from there.
 * The model loads one by calling `use_skill`; the writer loads one by typing
 * its name, when it is one the model could load too. Either way the record of
 * the load is where it happened — a call and its result on the assistant's
 * turn, or a command in the writer's — and nothing else keeps a list. What is
 * loaded is whatever those records say, so a turn rewound or deleted takes its
 * loads with it, and nothing can claim a skill is loaded whose text is gone.
 *
 * Three things read this:
 *
 * - the context builder, which sends every load back at the point it was
 *   made — not just in the last few turns, as dice are, since instructions
 *   that fell out of the window would stop being followed — and carries the
 *   loads a summary stood in for to just under it (ai/context/build.js);
 * - `use_skill`, which says a skill is already loaded rather than sending its
 *   text again (ai/tools/useSkill.js);
 * - the chat's settings, which list what is loaded and let the writer drop it.
 *
 * Dropping a skill means it is not kept past a summary, and nothing else. Its
 * records are marked and stay where they are, read there as anything else
 * said is, until a summary stands in for them; then it is not carried under
 * the summary, and is no longer loaded. Taking it out sooner would edit the
 * middle of the conversation, which costs the cached prefix from that point
 * on and leaves the words around it pointing at nothing. Once it is gone the
 * model may load it again, as it may read a document again after letting it
 * go.
 *
 * Nothing here reaches a store. It is handed messages and hands back what is
 * in them.
 */

import { compactionCover } from '../compaction.js'

/**
 * @typedef {import('../../types/models.js').Message} Message
 * @typedef {import('../../types/models.js').ApiMessage} ApiMessage
 * @typedef {import('../../types/models.js').ChatCommand} ChatCommand
 * @typedef {import('../../types/models.js').MessageSegment} MessageSegment
 * @typedef {import('../tools/registry.js').ToolCall} ToolCall
 */

/** The tool the model loads a skill with. */
export const USE_SKILL = 'use_skill'

/**
 * One load of a skill, where it happened.
 *
 * @typedef {Object} Load
 * @property {string} name - The skill
 * @property {string} messageId - The message holding the record
 * @property {'model'|'writer'} by - Who loaded it
 * @property {boolean} dropped - The writer dropped it
 * @property {ToolCall} [call] - The model's call, for a load it made
 * @property {ApiMessage} [result] - What the call returned
 * @property {number} [index] - Which of the writer's segments, for a load they made
 * @property {ChatCommand} [command] - The command they typed
 */

/**
 * @param {string} text
 * @returns {any}
 */
function parsed(text) {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/**
 * The calls to `use_skill` on an assistant turn, each with its result and what
 * it asked for.
 *
 * @param {Message} message
 * @returns {Array<{call: ToolCall, result: ApiMessage|undefined, name: string, file: string}>}
 */
function skillCalls(message) {
  const trajectory = message?.metadata?.apiTrajectory
  if (!Array.isArray(trajectory)) return []

  /** @type {Map<string, ApiMessage>} */
  const results = new Map()
  for (const item of trajectory) {
    if (item?.role === 'tool' && item.tool_call_id) results.set(item.tool_call_id, item)
  }

  const out = []
  for (const item of trajectory) {
    if (item?.role !== 'assistant' || !Array.isArray(item.tool_calls)) continue
    for (const call of item.tool_calls) {
      if (call?.function?.name !== USE_SKILL) continue
      const args = parsed(call.function.arguments || '{}') || {}
      out.push({
        call,
        result: results.get(call.id),
        name: typeof args.name === 'string' ? args.name : '',
        file: typeof args.file === 'string' ? args.file : '',
      })
    }
  }
  return out
}

/**
 * The loads one message holds: the model's on an assistant turn, the writer's
 * on theirs. A call that read one of a skill's files rather than loading it is
 * not a load, and nor is one that failed or found the skill already loaded.
 *
 * @param {Message} message
 * @returns {Load[]}
 */
export function loadsIn(message) {
  if (message?.role === 'user') {
    /** @type {Load[]} */
    const loads = []
    for (const [index, segment] of (message.segments || []).entries()) {
      if (segment.type !== 'command') continue
      const { command } = segment
      if (!command.load || !command.result) continue
      loads.push({
        name: command.name,
        messageId: message.id,
        by: 'writer',
        dropped: command.dropped === true,
        index,
        command,
      })
    }
    return loads
  }

  return skillCalls(message)
    .filter(({ name, file, result }) => {
      if (!name || file || !result) return false
      return typeof parsed(String(result.content ?? ''))?.instructions === 'string'
    })
    .map(({ call, result, name }) => ({
      name,
      messageId: message.id,
      by: /** @type {const} */ ('model'),
      dropped: result?._dropped === true,
      call,
      result,
    }))
}

/**
 * What a chat has loaded, as text to read: each skill's instructions as last
 * loaded, and the files of it the model read since. A dropped one is here
 * until a summary stands in for where it was loaded.
 *
 * For a reader that is not a party to the conversation — a skill consulted
 * inside it reads it as a transcript of what was said, and a load is a call,
 * not something said. A house style the chat follows should be followed by
 * the skill that writes the scene too.
 *
 * @param {Message[]} messages - The chat, in order, before compaction
 * @returns {Array<Load & {instructions: string, files: Array<{path: string, content: string}>}>}
 *   In the order they were first loaded
 */
export function loadedText(messages) {
  const covered = compactionCover(messages || [])
  /** @type {Map<string, Load & {instructions: string, files: Array<{path: string, content: string}>}>} */
  const loaded = new Map()
  for (const [at, message] of (messages || []).entries()) {
    for (const load of loadsIn(message)) {
      if (load.dropped && covered.has(at)) {
        loaded.delete(load.name)
        continue
      }
      const instructions = load.command
        ? load.command.result
        : parsed(String(load.result?.content ?? ''))?.instructions || ''
      loaded.set(load.name, { ...load, instructions, files: loaded.get(load.name)?.files || [] })
    }
    for (const read of skillCalls(message)) {
      const entry = loaded.get(read.name)
      if (!read.file || !entry || !read.result) continue
      const answer = parsed(String(read.result.content ?? ''))
      if (typeof answer?.content !== 'string') continue
      entry.files = [
        ...entry.files.filter(file => file.path !== answer.file),
        { path: answer.file || read.file, content: answer.content },
      ]
    }
  }
  return [...loaded.values()]
}

/**
 * The skills a chat has loaded, in the order they were first loaded. A
 * dropped one is loaded until a summary stands in for where it was loaded.
 *
 * @param {Message[]} messages - The chat, in order
 * @returns {string[]}
 */
export function loadedSkills(messages) {
  const covered = compactionCover(messages || [])
  const names = new Set()
  for (const [at, message] of (messages || []).entries()) {
    for (const load of loadsIn(message)) {
      if (load.dropped && covered.has(at)) names.delete(load.name)
      else names.add(load.name)
    }
  }
  return [...names]
}

/**
 * The loaded skills the writer has dropped, which go at the next summary:
 * every load of each that is still read is marked. One loaded again since is
 * kept.
 *
 * @param {Message[]} messages - The chat, in order
 * @returns {string[]}
 */
export function droppedSkills(messages) {
  const covered = compactionCover(messages || [])
  const kept = new Set()
  const dropped = new Set()
  for (const [at, message] of (messages || []).entries()) {
    for (const load of loadsIn(message)) {
      if (load.dropped && covered.has(at)) continue
      ;(load.dropped ? dropped : kept).add(load.name)
    }
  }
  return [...dropped].filter(name => !kept.has(name))
}

/**
 * The loads the newest summary stands in for, which the model would otherwise
 * stop reading the moment the chat was compacted. The latest of each skill,
 * left out where it is loaded again below the summary, since that one is read
 * where it is.
 *
 * @param {Message[]} messages - The chat, in order, before compaction
 * @returns {Load[]} In the order they were loaded
 */
export function carriedLoads(messages) {
  const covered = compactionCover(messages || [])
  if (covered.size === 0) return []

  /** @type {Map<string, Load>} */
  const carried = new Map()
  const readBelow = new Set()
  for (const [at, message] of messages.entries()) {
    for (const load of loadsIn(message)) {
      if (load.dropped) continue
      if (covered.has(at)) {
        carried.delete(load.name)
        carried.set(load.name, load)
      } else {
        readBelow.add(load.name)
      }
    }
  }

  return [...carried.values()].filter(load => !readBelow.has(load.name))
}

/**
 * A message with a skill dropped from it: every load of it marked, so none is
 * kept past a summary. Null when the message has none to drop.
 *
 * @param {Message} message
 * @param {string} name - The skill
 * @returns {{metadata: Record<string, any>}|{segments: MessageSegment[]}|null}
 */
export function droppedFrom(message, name) {
  if (message?.role === 'user') {
    let changed = false
    const segments = (message.segments || []).map(segment => {
      if (segment.type !== 'command') return segment
      const { command } = segment
      if (!command.load || command.name !== name || command.dropped) return segment
      changed = true
      return { ...segment, command: { ...command, dropped: /** @type {const} */ (true) } }
    })
    return changed ? { segments } : null
  }

  const ids = new Set(
    loadsIn(message)
      .filter(load => load.name === name && !load.dropped && load.call)
      .map(load => load.call?.id)
  )
  if (ids.size === 0) return null

  const trajectory = message.metadata.apiTrajectory.map(item =>
    item?.role === 'tool' && ids.has(item.tool_call_id) ? { ...item, _dropped: true } : item
  )
  return { metadata: { ...message.metadata, apiTrajectory: trajectory } }
}
