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
 * Where `needle` is in `text` when it is at one place and no other, or -1.
 * A match is counted wherever it starts: `111` is at two places in `1111`,
 * and a passage put back at the first of them is put back one place off.
 * @param {string} text
 * @param {string} needle
 * @returns {number}
 */
const onlyAt = (text, needle) => {
  if (!needle) return -1
  const at = text.indexOf(needle)
  return at !== -1 && text.indexOf(needle, at + 1) === -1 ? at : -1
}

/**
 * Whether `needle` is in `text` at one place and no other.
 * @param {string} text
 * @param {string} needle
 * @returns {boolean}
 */
const once = (text, needle) => onlyAt(text, needle) !== -1

/**
 * The least count from 0 to `most` that is enough, or `most` when none below
 * it is. For a question that stays yes once it is yes: it is asked of 0, 1,
 * 2, 4, 8 and on, then of the counts between the last no and the first yes,
 * so a count in the thousands is found in a couple of dozen askings rather
 * than thousands. `most` is taken without asking.
 *
 * @param {number} most
 * @param {(count: number) => boolean} enough
 * @returns {number}
 */
export function leastEnough(most, enough) {
  if (most <= 0 || enough(0)) return 0
  let short = 0
  let reach = 1
  while (reach < most && !enough(reach)) {
    short = reach
    reach = Math.min(most, reach * 2)
  }
  while (reach - short > 1) {
    const middle = short + Math.floor((reach - short) / 2)
    if (enough(middle)) reach = middle
    else short = middle
  }
  return reach
}

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
  const placed = placedEdit(before, after)
  return placed && { old: placed.old, new: placed.new }
}

/**
 * The pair `diffEdit` gives, and where it starts: the same place in both
 * texts, since all before it is the same in both.
 *
 * A caller that made one text from the other by changing a stretch of it
 * knows how much the two share at each end, and says so in `same`: at least
 * that much is not compared again, which keeps the comparing to the stretch
 * in a long text.
 *
 * @param {string} before
 * @param {string} after
 * @param {{start?: number, end?: number}} [same] - How many characters the
 *   two are known to share at the start, and at the end
 * @returns {{old: string, new: string, at: number}|null} Null when nothing changed
 */
export function placedEdit(before, after, same = {}) {
  const [start, end] = [same.start ?? 0, same.end ?? 0]
  if (before.slice(start, before.length - end) === after.slice(start, after.length - end)) {
    return null
  }

  const max = Math.min(before.length, after.length)
  let prefix = Math.min(start, max)
  while (prefix < max && before[prefix] === after[prefix]) prefix++
  let suffix = Math.min(end, max - prefix)
  while (
    suffix < max - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) {
    suffix++
  }

  /** The pair with so many characters of context taken in on each side. */
  const padded = (/** @type {number} */ pad) => {
    const at = Math.max(0, prefix - pad)
    const cut = Math.max(0, suffix - pad)
    return {
      old: before.slice(at, before.length - cut),
      new: after.slice(at, after.length - cut),
      at,
    }
  }
  /**
   * Whether one side of the pair is found once in its text, with so many
   * steps of context. More context never loses that and less never gains
   * it, so a side is searched for only where it has not answered already.
   *
   * @param {string} text
   * @param {'old'|'new'} side
   * @returns {(count: number) => boolean}
   */
  const foundOnce = (text, side) => {
    let yes = Infinity
    let no = -1
    return count => {
      if (count >= yes) return true
      if (count <= no) return false
      const found = once(text, padded(count * CONTEXT_STEP)[side])
      if (found) yes = count
      else no = count
      return found
    }
  }
  const [newOnce, oldOnce] = [foundOnce(after, 'new'), foundOnce(before, 'old')]
  // The least context that finds both is searched for, not stepped up to:
  // in a text that repeats itself, stepping reads the whole text at every
  // step. A side with nothing in it is not looked for.
  const steps = leastEnough(Math.ceil(Math.max(prefix, suffix) / CONTEXT_STEP), count => {
    const pair = padded(count * CONTEXT_STEP)
    return pair.new !== '' && pair.old !== '' && newOnce(count) && oldOnce(count)
  })
  return padded(steps * CONTEXT_STEP)
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
 * what it wrote, which has to be there exactly once. So is a suggestion,
 * whichever tool made it: an append's may have gone into one before the end.
 *
 * @param {string} content - The document now
 * @param {DocumentEdit} edit
 * @returns {string|null}
 */
export function reverseEdit(content, edit) {
  if (!edit.new) return null
  if (edit.tool === 'append_document' && !edit.suggested) {
    return content.endsWith(edit.new)
      ? content.slice(0, content.length - edit.new.length) + edit.old
      : null
  }
  const at = onlyAt(content, edit.new)
  if (at === -1) return null
  return content.slice(0, at) + edit.old + content.slice(at + edit.new.length)
}

/**
 * The document with the edit made again, or null when the passage it
 * replaced is not there to replace — the writer has been there since.
 *
 * The mirror of `reverseEdit`. An append goes back onto the end, which has
 * to still read as it did; anything else, a suggestion among them, where the
 * old passage is, which has to be there exactly once. A pair that replaced nothing was written onto an
 * empty document, and goes back onto one.
 *
 * @param {string} content - The document now
 * @param {DocumentEdit} edit
 * @returns {string|null}
 */
export function applyEdit(content, edit) {
  if (edit.tool === 'append_document' && !edit.suggested) {
    return content.endsWith(edit.old)
      ? content.slice(0, content.length - edit.old.length) + edit.new
      : null
  }
  if (edit.old === '') return content === '' ? edit.new : null
  const at = onlyAt(content, edit.old)
  if (at === -1) return null
  return content.slice(0, at) + edit.new + content.slice(at + edit.old.length)
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
