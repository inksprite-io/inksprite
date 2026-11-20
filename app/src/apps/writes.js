/**
 * @module apps/writes
 * @description What a connected app's writes have that a chat's don't: several
 * edits in a call, and an answer that says how the text was stored when that
 * isn't how it was sent.
 *
 * A chat's model makes one edit a call, and reads what it wrote back in the
 * conversation's own record. An app pays a round trip for each call, so it
 * may send `edits`, a list made in order as one write or not at all, and
 * `all`, for every place a passage appears. And it tends to edit from memory
 * of what it sent, where the document holds what the editor's Markdown made
 * of it: a table's spacing, a list's marker. So a write's answer carries the
 * passage as it now reads (`stored`) when that differs.
 */

import {
  documentForChat,
  executeEditDocument,
  executeUpdateDocument,
  nearestContext,
} from '@/ai/tools/documents.js'
import { quoteWithoutComments } from '@/editor/comments.js'
import { withoutSuggestionMarkup } from '@/editor/suggestionText.js'
import { useEditor } from '@/composables/useEditor.js'

/** @typedef {import('@/ai/tools/registry.js').ToolContext} ToolContext */

/**
 * One change to a passage, as an app asks for it.
 * @typedef {{old: string, new: string, all?: boolean}} AppEdit
 */

/** The longest a stored passage is sent back, in characters; past it, the app is told to read. */
export const STORED_MOST = 4000

/** What a write's answer says when the text was stored another way than it was sent. */
export const STORED_NOTE =
  'The editor writes Markdown its own way, so this is not quite as you sent it: `stored` is how it reads now. Quote from that.'

/** The same, where what changed is too long to send back. */
export const READ_AGAIN_NOTE =
  'The editor writes Markdown its own way, so parts of this are not quite as you sent them. Read the document before editing it further.'

/**
 * A document's text as an app reads it, or null when there is none there.
 *
 * @param {ToolContext} context
 * @param {string} path
 * @returns {Promise<string|null>}
 */
async function textAt(context, path) {
  // What was just typed is in the editor until a pause: have it written out.
  useEditor().flush()
  const found = await documentForChat(String(context.storyId), context.chatId, path)
  return found && found.document.type === 'text' ? found.document.content || '' : null
}

/**
 * The edits a call asks for, each checked, or what is wrong with them.
 *
 * @param {Record<string, any>} args
 * @returns {AppEdit[]|{error: string}}
 */
function editsOf(args) {
  const listed = Array.isArray(args.edits)
  if (listed && (args.old !== undefined || args.new !== undefined)) {
    return { error: 'Give the changes as "edits", or one as "old" and "new", not both.' }
  }
  const asked = listed ? args.edits : [{ old: args.old, new: args.new, all: args.all }]
  if (asked.length === 0) return { error: 'Give at least one change in "edits".' }
  /** @type {AppEdit[]} */
  const edits = []
  for (const [at, edit] of asked.entries()) {
    const which = listed ? `Edit ${at + 1}: ` : ''
    if (typeof edit?.old !== 'string' || !edit.old) {
      return {
        error: `${which}Give the passage to change as "old"; to add text, use append_document.`,
      }
    }
    if (typeof edit.new !== 'string') return { error: `${which}Give what it becomes as "new".` }
    edits.push({
      old: quoteWithoutComments(edit.old),
      new: quoteWithoutComments(withoutSuggestionMarkup(edit.new)),
      all: edit.all === true || (listed && args.all === true),
    })
  }
  return edits
}

/**
 * Change several passages of a document in one write, or every place a
 * passage appears. Each edit is made to the text the ones before it left,
 * and none is made unless all can be: a passage has to be there, and once
 * unless the edit says `all`.
 *
 * The text is written as a whole body is (`update_document`), so the
 * writer's comments stay on the passages that come through unchanged, and
 * those whose words changed are resolved, as one edit does.
 *
 * @param {Record<string, any>} args - `path`, and `edits` or `old`, `new` and `all`
 * @param {ToolContext} context
 * @returns {Promise<Record<string, any>>}
 */
export async function editMany(args, context) {
  const edits = editsOf(args)
  if ('error' in edits) return edits

  const text = await textAt(context, args.path)
  // No document there, a folder or a file: said as one edit says it.
  if (text === null) {
    return executeEditDocument({ path: args.path, old: edits[0].old, new: edits[0].new }, context)
  }

  let next = text
  for (const [at, edit] of edits.entries()) {
    const which = edits.length > 1 ? `Edit ${at + 1}: ` : ''
    const after = at > 0 ? ' once the edits before it were made' : ''
    const none = edits.length > 1 ? ' None of the edits was made.' : ''
    const count = next.split(edit.old).length - 1
    if (count === 0) {
      return {
        error: `${which}"old" was not found in "${args.path}"${after}. Quote the passage exactly as read_document gave it; the nearest lines are in "nearest".${none}`,
        nearest: nearestContext(next, edit.old),
      }
    }
    if (count > 1 && !edit.all) {
      return {
        error: `${which}"old" appears ${count} times in "${args.path}"${after}. Include more of the surrounding text so it matches once, or set "all" to change every one.${none}`,
      }
    }
    // The function form, so a `$` in the replacement is a dollar sign.
    next = edit.all ? next.split(edit.old).join(edit.new) : next.replace(edit.old, () => edit.new)
  }

  if (next !== text) {
    const written = await executeUpdateDocument({ path: args.path, content: next }, context)
    if ('error' in written) return written
    return { ...written, edits: edits.length }
  }
  const found = await documentForChat(String(context.storyId), context.chatId, args.path)
  return {
    success: true,
    document: found ? { id: found.document.id, title: found.document.title, path: found.path } : {},
    edits: edits.length,
    note: 'Nothing changed: each passage already read that way.',
  }
}

/**
 * What a write sent to be in the document, by the tool that wrote it.
 *
 * @param {string} name
 * @param {Record<string, any>} args
 * @returns {string[]}
 */
function sentBy(name, args) {
  const sent =
    name === 'edit_document'
      ? Array.isArray(args.edits)
        ? args.edits.map((/** @type {any} */ edit) => edit?.new)
        : [args.new]
      : name === 'append_document'
        ? [args.text]
        : [args.content]
  return sent.filter(text => typeof text === 'string').map(text => text.trim())
}

/**
 * The lines of a text that differ from what it was: from the first that
 * changed to the last, whole. Empty when nothing did.
 *
 * @param {string} before
 * @param {string} after
 * @returns {string}
 */
export function changedLines(before, after) {
  if (before === after) return ''
  const most = Math.min(before.length, after.length)
  let head = 0
  while (head < most && before[head] === after[head]) head++
  let tail = 0
  while (tail < most - head && before.at(-1 - tail) === after.at(-1 - tail)) tail++

  // Whole lines: back to where the first changed line starts and on to
  // where the last ends, unless the change itself starts or ends at a line's
  // edge, as what is added to the end does.
  let from = head
  if (after[from] === '\n') while (after[from] === '\n') from++
  else from = after.lastIndexOf('\n', head - 1) + 1
  let to = after.length - tail
  if (to > from && after[to - 1] === '\n') while (to > from && after[to - 1] === '\n') to--
  else {
    const next = after.indexOf('\n', to)
    to = next === -1 ? after.length : next
  }
  return after.slice(from, Math.max(from, to))
}

/**
 * Run a write, and say in its answer how the text reads now where that is
 * not how it was sent: the lines that changed, or, where they are many, that
 * the document is to be read again. A write that was suggested says so too,
 * of the text as the app reads it, its suggestions made.
 *
 * @param {string} name - The tool: one that writes a document's text
 * @param {Record<string, any>} args
 * @param {ToolContext} context
 * @param {() => Promise<any>} write - Makes the call
 * @returns {Promise<any>}
 */
export async function answeringStored(name, args, context, write) {
  const path = typeof args.path === 'string' ? args.path : ''
  const before = name === 'create_document' ? null : await textAt(context, path)
  const result = await write()
  // Made, or suggested: either way the app reads the text with it in.
  if (!result || typeof result !== 'object' || 'error' in result) return result
  if (!result.success && !result.suggested) return result

  const after = await textAt(context, result.document?.path ?? path)
  if (after === null) return result
  if (sentBy(name, args).every(sent => after.includes(sent))) return result
  const stored = changedLines(before ?? '', after)
  if (!stored) return result
  return stored.length > STORED_MOST
    ? { ...result, note: READ_AGAIN_NOTE }
    : { ...result, stored, note: STORED_NOTE }
}
