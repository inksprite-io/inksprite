/**
 * @module ai/tools/progress
 * @description What a tool call in flight is doing, for the chat to show
 * while the model is still writing the call.
 *
 * A model writing prose into a tool call is silent for as long as the prose
 * takes, because the words go into the call's arguments rather than the
 * message. This reads the arguments as they arrive — the path first, since it
 * is short and comes early, then the passage being written — so the writer
 * watches the chapter grow instead of a spinner.
 */

import { partialStrings } from '@/utils/partialJson.js'
import { narrowEdit } from '@/utils/edits.js'

/**
 * @typedef {Object} ToolProgress
 * @property {string} verb - What the call is doing, as a heading: "Editing"
 * @property {string} [path] - The document it is doing it to, once known
 * @property {string} [old] - For an edit, the passage being replaced
 * @property {string} [prose] - The text being written, as far as it has got
 */

/**
 * Which argument each writing tool's prose arrives in, and how to say it.
 * @type {Record<string, {verb: string, prose: string}>}
 */
const WRITING_TOOLS = {
  create_document: { verb: 'Creating', prose: 'content' },
  update_document: { verb: 'Updating', prose: 'content' },
  edit_document: { verb: 'Editing', prose: 'new' },
  append_document: { verb: 'Adding to', prose: 'text' },
}

/**
 * Whether a tool's call carries prose worth watching as it is written: the
 * chat shows those calls growing, and says the rest in the turn's status line.
 *
 * @param {string} name
 * @returns {boolean}
 */
export function writesProse(name) {
  return Object.hasOwn(WRITING_TOOLS, name)
}

/**
 * Tools whose call reads better as what it does than as a call, and the word
 * for it. Each takes a path, which the chip shows after the verb.
 * @type {Record<string, string>}
 */
const NAMED_TOOLS = {
  list_documents: 'Listing',
}

/**
 * Describe a change a turn recorded, the way a call in flight is described,
 * for the chat to show it with its Accept and Reject.
 *
 * A proposal is shown as the passages the model wrote. One that was accepted
 * carries the pair as it was applied, widened with whatever finds it in the
 * document again, and is shown cut back to what changed.
 *
 * @param {import('@/types/models.js').DocumentEdit} edit
 * @returns {ToolProgress}
 */
export function describeEdit(edit) {
  const writing = WRITING_TOOLS[edit.tool]
  const pair = edit.status === 'accepted' ? narrowEdit(edit) : edit
  return {
    verb: writing ? writing.verb : `Calling ${edit.tool}`,
    path: edit.path,
    ...(edit.tool === 'edit_document' && pair.old ? { old: pair.old } : {}),
    ...(pair.new ? { prose: pair.new } : {}),
  }
}

/**
 * Describe a call from its name and however much of its arguments has come.
 *
 * @param {string} name - Tool name
 * @param {string|null|undefined} argumentsText - The arguments JSON so far
 * @returns {ToolProgress}
 */
export function describeProgress(name, argumentsText) {
  const args = partialStrings(argumentsText)
  const writing = WRITING_TOOLS[name]
  if (!writing) {
    return {
      verb: NAMED_TOOLS[name] ?? `Calling ${name}`,
      ...(args.path ? { path: args.path } : {}),
    }
  }

  const prose = args[writing.prose]
  return {
    verb: writing.verb,
    ...(args.path ? { path: args.path } : {}),
    ...(name === 'edit_document' && args.old ? { old: args.old } : {}),
    ...(prose ? { prose } : {}),
  }
}

/**
 * How a round's calls read in the status line under a turn: while they run,
 * and once they have and the model is taking in what they returned. Present
 * and past, so the line can say which of the two the wait is.
 *
 * @type {Record<string, [string, string]>}
 */
const ROUND_VERBS = {
  read_document: ['Reading', 'Read'],
  describe_document: ['Looking over', 'Looked over'],
  list_documents: ['Listing', 'Listed'],
  search_documents: ['Searching for', 'Searched for'],
  create_document: ['Creating', 'Created'],
  create_folder: ['Creating', 'Created'],
  update_document: ['Updating', 'Updated'],
  edit_document: ['Editing', 'Edited'],
  append_document: ['Adding to', 'Added to'],
  roll_dice: ['Rolling dice', 'Rolled dice'],
  oracle: ['Asking the oracle', 'Asked the oracle'],
  roll_table: ['Rolling on a table', 'Rolled on a table'],
  generate_names: ['Generating names', 'Generated names'],
  director: ['Asking the director', 'Asked the director'],
  interpret: ['Interpreting a draw', 'Interpreted a draw'],
  use_skill: ['Loading', 'Loaded'],
}

/** What most calls do to: a document, and the tools that take a path. */
const PATH_NOUNS = { read_document: 'documents', edit_document: 'documents' }

/**
 * What a call was about, short: the last part of its path, or what it
 * searched for.
 *
 * @param {Record<string, string>} args
 * @returns {string}
 */
function objectOf(args) {
  if (args.path) return args.path.split('/').filter(Boolean).pop() || args.path
  if (args.query) return `“${args.query}”`
  // A skill being loaded, or one of its files read.
  if (args.file) return args.file.split('/').filter(Boolean).pop() || args.file
  if (args.name) return args.name
  return ''
}

/**
 * A call as the status line needs it: which tool, and however much of its
 * arguments has come.
 *
 * @typedef {{name: string, arguments?: string|null}} RoundCall
 */

/**
 * Say what a round of calls is doing, or did, in a few words: "Reading
 * Chapter 3", "Read 2 documents", "Ran 3 tools".
 *
 * @param {RoundCall[]} calls - The round's calls
 * @param {boolean} done - Whether they have run, rather than are running
 * @returns {string}
 */
export function describeRound(calls, done) {
  const tense = done ? 1 : 0
  if (calls.length === 0) return ''
  const [first] = calls
  const same = calls.every(call => call.name === first.name)
  const verbs = ROUND_VERBS[first.name]

  if (calls.length === 1) {
    if (!verbs) return `${done ? 'Ran' : 'Running'} ${first.name}`
    const object = objectOf(partialStrings(first.arguments))
    return object ? `${verbs[tense]} ${object}` : verbs[tense]
  }
  if (same && verbs && PATH_NOUNS[first.name]) {
    return `${verbs[tense]} ${calls.length} ${PATH_NOUNS[first.name]}`
  }
  return `${done ? 'Ran' : 'Running'} ${calls.length} tools`
}
