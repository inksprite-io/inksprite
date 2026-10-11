/**
 * @module cards/macros
 * @description `{{char}}` and `{{user}}`, filled in for the chat that plays a
 * card.
 *
 * A card's documents say what the card says, macros and all. They are the card,
 * and a writer building one or changing one works with the macros the way every
 * other card tool does. What a macro becomes belongs to the chat: the
 * character's name, and the name the writer gave when they started it. So it
 * is filled in between the documents and that chat's model — in what its tools
 * read, the project block, the prompt and the author's note — and nowhere else.
 *
 * Only a chat with names fills anything in. A chat on the Default profile,
 * where the writer works on the card, has none, and reads and writes the
 * macros as they are.
 *
 * Nothing goes back the other way. What the model writes in a chat that fills
 * names in is written as it wrote it: a chat that plays a card is for play,
 * and in play a name is a name. `storedPassage` only finds where a passage the
 * model quoted is in the document.
 *
 * Case and inner spacing vary between authors, and both are accepted. Nothing
 * else is: `{{date}}`, `{{random::…}}`, `{{roll:d20}}` and the rest are left
 * for the model to read, which says what they are for better than a value
 * frozen when the chat started would.
 */

/** The two macros a chat has names for. */
const MACRO = /\{\{\s*(char|user)\s*\}\}/gi

/**
 * What the macros become in one chat. Either can be empty: a macro with no
 * name to become is left as it is.
 *
 * @typedef {Object} Names
 * @property {string} char - What `{{char}}` becomes: the character's name
 * @property {string} user - What `{{user}}` becomes: the writer's, in this chat
 */

/**
 * The names a chat fills its macros in with, or null for a chat that reads
 * them as written.
 *
 * @param {{userName?: string, characterName?: string}|null|undefined} chat
 * @returns {Names|null}
 */
export function namesOf(chat) {
  const user = chat?.userName?.trim() || ''
  const char = chat?.characterName?.trim() || ''
  return user || char ? { char, user } : null
}

/**
 * @param {string} which - `char` or `user`, in any case
 * @param {Names} names
 * @returns {string}
 */
const nameFor = (which, names) => (which.toLowerCase() === 'char' ? names.char : names.user)

/**
 * Text with its macros filled in.
 *
 * @param {string|null|undefined} value
 * @param {Names|null} [names] - Nothing is filled in without them
 * @returns {string}
 */
export function substitute(value, names) {
  if (!value) return ''
  if (!names) return value
  // The function form, so a `$` in a name is a dollar sign.
  return value.replace(MACRO, (macro, which) => nameFor(which, names) || macro)
}

/**
 * A passage the model quoted from the filled text, as the document stores it.
 *
 * The model reads names where the document has macros, so the passage it
 * quotes to `edit_document` is not in the document as written. This finds it
 * in the filled text and gives back the stretch of the document that reads
 * as it. Where the passage starts or ends partway through a name, the stretch
 * takes the whole macro, and the replacement the part of the name the model
 * left out, so that what the document says afterwards is what the model asked
 * for.
 *
 * Counted in the filled text, which is the one the model can see: a passage
 * that is there twice once the names are in is a quote that says too little,
 * even where the document spells the two differently.
 *
 * @param {string} text - The document as stored
 * @param {Names} names
 * @param {string} passage - As the model quoted it
 * @param {string} replacement - What it should read instead
 * @returns {{count: number, old: string, new: string}} The passage and its
 *   replacement as they apply to the stored text, when the count is one
 */
export function storedPassage(text, names, passage, replacement) {
  /** Each macro filled in: where it is in `text`, and where its name is in `filled`. */
  const spans = []
  let filled = ''
  let last = 0
  for (const match of text.matchAll(MACRO)) {
    const name = nameFor(match[1], names)
    if (!name) continue
    const from = /** @type {number} */ (match.index)
    filled += text.slice(last, from)
    spans.push({
      from,
      to: from + match[0].length,
      at: filled.length,
      until: filled.length + name.length,
    })
    filled += name
    last = from + match[0].length
  }
  filled += text.slice(last)

  const count = passage ? filled.split(passage).length - 1 : 0
  if (count !== 1 || spans.length === 0) return { count, old: passage, new: replacement }

  const at = filled.indexOf(passage)
  const until = at + passage.length

  // Where a place in the filled text is in the stored one, outside any name.
  const stored = (/** @type {number} */ offset) => {
    let shift = 0
    for (const span of spans) {
      if (span.until > offset) break
      shift += span.to - span.from - (span.until - span.at)
    }
    return offset + shift
  }

  const opening = spans.find(span => span.at < at && at < span.until)
  const closing = spans.find(span => span.at < until && until < span.until)

  return {
    count,
    old: text.slice(opening ? opening.from : stored(at), closing ? closing.to : stored(until)),
    new: [
      opening ? filled.slice(opening.at, at) : '',
      replacement,
      closing ? filled.slice(until, closing.until) : '',
    ].join(''),
  }
}
