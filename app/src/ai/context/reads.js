/**
 * @module ai/context/reads
 * @description What the model has read of the project that is still in the
 * conversation, and which of it has changed since.
 *
 * A turn's calls to the document tools go back with the conversation on every
 * later turn, where they were made (ai/context/build.js). A read is a record of
 * one moment, though: a chapter read and then edited would be quoted as it
 * was. So each read leaves three notes on its result in the stored trajectory
 * (the document, its path, and a hash of the text it read), and two things
 * read them:
 *
 * - the project block, which lists what has changed since its latest read:
 *   edited, moved, or gone;
 * - `read_document`, which answers that a document is unchanged rather than
 *   send a second copy of a read still in view.
 *
 * A read a summary stands in for is not in view, and nothing here counts it.
 * A turn written before document calls stayed in the conversation is not
 * marked, and its reads are not in view either: none of them go back.
 *
 * Nothing here reaches a store. It is handed messages and hands back what is in
 * them. See .llm/project_context_design.md.
 */

import { applyCompaction } from '../compaction.js'

/**
 * @typedef {import('../../types/models.js').Message} Message
 *
 * @typedef {Object} Read
 * @property {string} id - The document read
 * @property {string} path - Its path when it was read
 * @property {string} hash - A hash of the text it had then
 * @property {Record<string, any>} args - What the read asked for
 *
 * @typedef {Object} Located
 * @property {string} path - Where the document is now
 * @property {string} text - What it says now
 */

/**
 * Whether a turn's document calls go back with the conversation: every turn
 * written since they began to, which says so on its metadata.
 *
 * @param {Message} message
 * @returns {boolean}
 */
export function keepsDocumentCalls(message) {
  return message?.metadata?.documentCallsKept === true
}

/**
 * A short hash of a document's text, to tell whether it has changed since a
 * read. FNV-1a: not for security, only for telling two texts apart.
 *
 * @param {string} text
 * @returns {string}
 */
export function textHash(text) {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return `${text.length.toString(36)}.${(hash >>> 0).toString(36)}`
}

/**
 * @param {string|undefined} text
 * @returns {Record<string, any>}
 */
function parsedArgs(text) {
  try {
    const value = JSON.parse(text || '{}')
    return value && typeof value === 'object' ? value : {}
  } catch {
    return {}
  }
}

/**
 * The reads in these turns, in order: the results that say which document
 * they read, each with what its call asked for.
 *
 * @param {Message[]} messages
 * @returns {Read[]}
 */
function readsIn(messages) {
  /** @type {Read[]} */
  const reads = []
  for (const message of messages) {
    if (!keepsDocumentCalls(message)) continue
    const trajectory = message.metadata?.apiTrajectory || []
    /** @type {Map<string, any>} */
    const calls = new Map()
    for (const item of trajectory) {
      for (const call of item?.tool_calls || []) calls.set(call.id, call)
    }
    for (const item of trajectory) {
      if (item?.role !== 'tool' || typeof item._document !== 'string') continue
      reads.push({
        id: item._document,
        path: item._path || '',
        hash: item._hash || '',
        args: parsedArgs(calls.get(item.tool_call_id)?.function?.arguments),
      })
    }
  }
  return reads
}

/**
 * The reads still in the conversation the model is sent: in marked turns that
 * no summary stands in for.
 *
 * @param {Message[]} messages - The chat, in order, before compaction
 * @returns {Read[]}
 */
export function readsInView(messages) {
  return readsIn(applyCompaction(messages || []))
}

/**
 * What a read took of a document: the section, offset or page. Two reads of
 * the same text that took the same part read the same thing.
 *
 * @param {Record<string, any>} args
 * @returns {string}
 */
function partOf(args) {
  const section = typeof args?.section === 'string' ? args.section.trim().toLowerCase() : ''
  return JSON.stringify([section, Number(args?.from) || 0, Number(args?.page) || 0])
}

/**
 * Whether a read asked for now would send what a read still in view already
 * did: the same document, the same part of it, and the same text.
 *
 * @param {Message[]} messages - The chat, in order, before compaction
 * @param {string} id - The document
 * @param {Record<string, any>} args - What the read asks for
 * @param {string} hash - A hash of the document's text now
 * @returns {boolean}
 */
export function readInView(messages, id, args, hash) {
  const part = partOf(args)
  return readsInView(messages).some(
    read => read.id === id && read.hash === hash && partOf(read.args) === part
  )
}

/**
 * The documents read in view that have changed since the latest read of each,
 * by the path the model read them at: edited, moved, or gone.
 *
 * @param {Message[]} messages - The chat, in order, before compaction
 * @param {(id: string) => Located|null} locate - Where a document is now and
 *   what it says, or null when the chat can no longer see it
 * @returns {Array<{path: string, since: string}>} In the order they were
 *   last read
 */
export function changedSinceRead(messages, locate) {
  /** @type {Map<string, Read>} */
  const latest = new Map()
  for (const read of readsInView(messages)) {
    latest.delete(read.id)
    latest.set(read.id, read)
  }

  const changed = []
  for (const read of latest.values()) {
    const now = locate(read.id)
    if (!now) {
      changed.push({ path: read.path, since: 'deleted or hidden' })
      continue
    }
    const edited = textHash(now.text) !== read.hash
    if (now.path !== read.path) {
      changed.push({ path: read.path, since: `moved to ${now.path}${edited ? ' and edited' : ''}` })
    } else if (edited) {
      changed.push({ path: read.path, since: 'edited' })
    }
  }
  return changed
}
