/**
 * @module apps/writes
 * @description What a connected app's write is answered that a chat's isn't:
 * how the text was stored, when that isn't how it was sent.
 *
 * A chat's model reads what it wrote back in the conversation's own record.
 * An app tends to edit from memory of what it sent, where the document holds
 * what the editor's Markdown made of it: a table's spacing, a list's marker.
 * So a write's answer carries the passage as it now reads (`stored`) when
 * that differs.
 */

/** @typedef {import('./revisions.js').DocumentState} DocumentState */

/** The longest a stored passage is sent back, in characters; past it, the app is told to read. */
export const STORED_MOST = 4000

/** What a write's answer says when the text was stored another way than it was sent. */
export const STORED_NOTE =
  'The editor writes Markdown its own way, so this is not quite as you sent it: `stored` is how it reads now. Quote from that.'

/** The same, where what changed is too long to send back. */
export const READ_AGAIN_NOTE =
  'The editor writes Markdown its own way, so parts of this are not quite as you sent them. Read the document before editing it further.'

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
 * A write's answer, saying how the text reads now where that is not how it
 * was sent: the lines that changed, or, where they are many, that the
 * document is to be read again. A write that was suggested says so too, of
 * the text as the app reads it, its suggestions made. From the document as
 * it was before the write and as it is after, which the call took
 * (`apps/tools.js`).
 *
 * @param {string} name - The tool: one that writes a document's text
 * @param {Record<string, any>} args
 * @param {{before: DocumentState|null, after: DocumentState|null}} states -
 *   The document before the write, where there was one, and after it
 * @param {any} answer - What the tool answered
 * @returns {any}
 */
export function withStored(name, args, { before, after }, answer) {
  // Made, or suggested: either way the app reads the text with it in.
  if (!answer || typeof answer !== 'object' || 'error' in answer) return answer
  if (!answer.success && !answer.suggested) return answer

  const text = after?.text ?? null
  if (text === null) return answer
  if (sentBy(name, args).every(sent => text.includes(sent))) return answer
  const stored = changedLines(before?.text ?? '', text)
  if (!stored) return answer
  return stored.length > STORED_MOST
    ? { ...answer, note: READ_AGAIN_NOTE }
    : { ...answer, stored, note: STORED_NOTE }
}
