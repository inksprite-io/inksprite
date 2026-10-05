/**
 * @module utils/edits
 * @description A change to a document as a reversible pair, and how to undo
 * one later — or make it again — without touching what changed around it.
 *
 * A turn that rewrote a chapter is recorded as the passage it replaced and
 * the passage it wrote, cut as small as the two versions allow. Undoing it is
 * finding the written passage and putting the replaced one back — which works
 * after the writer has edited elsewhere in the document, and refuses, rather
 * than guessing, when they have edited the passage itself. The same way a
 * commit is reverted. Making it again is the same move the other way: a
 * message with more than one answer switches between them, and the answer
 * being switched to has to put back what it did.
 */

/**
 * @typedef {import('../types/models.js').DocumentEdit} DocumentEdit
 */

/** How much more context to take in when a pair needs to be findable. */
const CONTEXT_STEP = 20

/**
 * How many times `needle` occurs in `text`.
 * @param {string} text
 * @param {string} needle
 * @returns {number}
 */
const occurrences = (text, needle) => (needle ? text.split(needle).length - 1 : 0)

/**
 * The smallest pair that turns `before` into `after`: the text between the
 * longest shared prefix and suffix, on each side.
 *
 * Widened with context until each side can be found once in the version it
 * belongs to. What was written would otherwise be empty for a pure deletion,
 * and what was replaced empty for a pure insertion — nothing to find on the
 * way back, or the way forward again — and either could occur more than once,
 * which is one place too many to put the other text.
 *
 * @param {string} before
 * @param {string} after
 * @returns {{old: string, new: string}|null} Null when nothing changed
 */
export function diffEdit(before, after) {
  if (before === after) return null

  const max = Math.min(before.length, after.length)
  let prefix = 0
  while (prefix < max && before[prefix] === after[prefix]) prefix++
  let suffix = 0
  while (
    suffix < max - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) {
    suffix++
  }

  let pad = 0
  for (;;) {
    const p = Math.max(0, prefix - pad)
    const s = Math.max(0, suffix - pad)
    const pair = { old: before.slice(p, before.length - s), new: after.slice(p, after.length - s) }
    const findable =
      pair.new !== '' &&
      occurrences(after, pair.new) === 1 &&
      pair.old !== '' &&
      occurrences(before, pair.old) === 1
    if (findable || (p === 0 && s === 0)) return pair
    pad += CONTEXT_STEP
  }
}

/**
 * The pair for an append: nothing replaced, and what arrived at the end.
 *
 * An append needs no context to be found again — it is undone from the end
 * and made again onto it — so the pair stays what was appended, which is
 * also what the chat shows as the change. When the end did not survive the
 * append as it was (a trailing blank line settled away), it is a pair like
 * any other.
 *
 * @param {string} before
 * @param {string} after
 * @returns {{old: string, new: string}|null} Null when nothing changed
 */
export function diffAppend(before, after) {
  if (before === after) return null
  if (after.startsWith(before)) return { old: '', new: after.slice(before.length) }
  return diffEdit(before, after)
}

/**
 * The pair cut to what changed, for showing: the context it was widened
 * with is what finds it in a document, and is not the change.
 *
 * @param {{old: string, new: string}} pair
 * @returns {{old: string, new: string}}
 */
export function narrowEdit(pair) {
  const before = pair.old
  const after = pair.new
  const max = Math.min(before.length, after.length)
  let prefix = 0
  while (prefix < max && before[prefix] === after[prefix]) prefix++
  let suffix = 0
  while (
    suffix < max - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) {
    suffix++
  }
  return {
    old: before.slice(prefix, before.length - suffix),
    new: after.slice(prefix, after.length - suffix),
  }
}

/**
 * The document as it was before the edit, or null when the edit's text is
 * no longer where it was put — the writer has been there since, and their
 * version stands.
 *
 * An append is undone from the end, where it went; anything else by finding
 * what it wrote, which has to be there exactly once.
 *
 * @param {string} content - The document now
 * @param {DocumentEdit} edit
 * @returns {string|null}
 */
export function reverseEdit(content, edit) {
  if (!edit.new) return null
  if (edit.tool === 'append_document') {
    return content.endsWith(edit.new)
      ? content.slice(0, content.length - edit.new.length) + edit.old
      : null
  }
  if (occurrences(content, edit.new) !== 1) return null
  return content.replace(edit.new, () => edit.old)
}

/**
 * The document with the edit made again, or null when the passage it
 * replaced is not there to replace — the writer has been there since.
 *
 * The mirror of `reverseEdit`. An append goes back onto the end, which has
 * to still read as it did; anything else where the old passage is, which has
 * to be there exactly once. A pair that replaced nothing was written onto an
 * empty document, and goes back onto one.
 *
 * @param {string} content - The document now
 * @param {DocumentEdit} edit
 * @returns {string|null}
 */
export function applyEdit(content, edit) {
  if (edit.tool === 'append_document') {
    return content.endsWith(edit.old)
      ? content.slice(0, content.length - edit.old.length) + edit.new
      : null
  }
  if (edit.old === '') return content === '' ? edit.new : null
  if (occurrences(content, edit.old) !== 1) return null
  return content.replace(edit.old, () => edit.new)
}

/**
 * A turn's record of its changes, with the writer's decisions kept.
 *
 * A turn writes its record as it goes, and the writer can accept or reject a
 * proposal before the turn is over — the prose arrives, and the model is
 * still explaining it. The turn's next write must not put that proposal back
 * to proposed. Matched by id: an entry the writer has decided is theirs, as
 * they left it, applied pair and all.
 *
 * @param {DocumentEdit[]} fresh - The turn's own record
 * @param {DocumentEdit[]|undefined} stored - The message's record as it stands
 * @returns {DocumentEdit[]}
 */
export function keepDecisions(fresh, stored) {
  if (!Array.isArray(stored) || stored.length === 0) return fresh
  const decided = new Map(
    stored
      .filter(edit => edit?.id && edit.status && edit.status !== 'proposed')
      .map(edit => [edit.id, edit])
  )
  if (decided.size === 0) return fresh
  return fresh.map(edit => decided.get(edit.id) || edit)
}
