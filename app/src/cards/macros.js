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
 * A macro filled in: where it is in the text as stored, and where its name
 * is in the filled text.
 *
 * @typedef {{from: number, to: number, at: number, until: number}} FilledSpan
 */

/**
 * A text with its macros filled in, and where each one was.
 *
 * @param {string} text - The document as stored
 * @param {Names} names
 * @returns {{filled: string, spans: FilledSpan[]}}
 */
function filledWith(text, names) {
  /** @type {FilledSpan[]} */
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
  return { filled, spans }
}

/**
 * A change to the stored text: the stretch of it that goes, and what goes
 * there.
 *
 * @typedef {{from: number, to: number, new: string}} StoredChange
 */

/**
 * Stretches of the filled text, each as the stretch of the stored text that
 * reads as it, and what a replacement for it becomes there. Where a stretch
 * starts or ends partway through a name, the stored one takes the whole
 * macro, and the replacement the part of the name left out.
 *
 * The stretches are changed the last first, each in the stored text the ones
 * after it left. A change that starts partway through a name writes the name
 * out up to there, so in that much of it the stored text reads as the filled,
 * and a stretch there is where it reads.
 *
 * @param {{filled: string, spans: FilledSpan[]}} filling
 * @param {number[]} places - Where each stretch starts in the filled text, in
 *   order, each past the end of the one before
 * @param {number} length - How long each is there
 * @param {string} replacement
 * @returns {StoredChange[]} One for each stretch, the last first
 */
function storedStretches({ filled, spans }, places, length, replacement) {
  /** How much longer the stored text is than the filled, up to each macro and past the last. */
  const longer = [0]
  for (const span of spans) {
    longer.push(longer[longer.length - 1] + span.to - span.from - span.until + span.at)
  }
  /** How many names start before a place in the filled text. */
  const namesBefore = (/** @type {number} */ offset) => {
    let low = 0
    let high = spans.length
    while (low < high) {
      const mid = (low + high) >> 1
      if (spans[mid].at < offset) low = mid + 1
      else high = mid
    }
    return low
  }
  /** The name a place in the filled text is partway through. */
  const inside = (/** @type {number} */ offset) => {
    const span = spans[namesBefore(offset) - 1]
    return span && offset < span.until ? span : undefined
  }

  /**
   * A name a change after this one wrote out, where it starts in each text:
   * from there to that change, the stored text reads as the filled.
   *
   * @type {{at: number, from: number}|null}
   */
  let written = null
  /** Where a place in the filled text is in the stored one, outside any name. */
  const stored = (/** @type {number} */ offset) =>
    written && offset >= written.at
      ? written.from + offset - written.at
      : offset + longer[namesBefore(offset)]

  /** @type {StoredChange[]} */
  const changes = []
  for (let i = places.length - 1; i >= 0; i--) {
    const at = places[i]
    const until = at + length
    const opening = written && at >= written.at ? undefined : inside(at)
    const closing = written && until >= written.at ? undefined : inside(until)
    changes.push({
      from: opening ? opening.from : stored(at),
      to: closing ? closing.to : stored(until),
      new: [
        opening ? filled.slice(opening.at, at) : '',
        replacement,
        closing ? filled.slice(until, closing.until) : '',
      ].join(''),
    })
    if (opening) written = { at: opening.at, from: opening.from }
    else if (written && at < written.at) written = null
  }
  return changes
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
  const filling = filledWith(text, names)
  const { filled, spans } = filling
  const count = passage ? filled.split(passage).length - 1 : 0
  if (count !== 1 || spans.length === 0) return { count, old: passage, new: replacement }

  const [stretch] = storedStretches(filling, [filled.indexOf(passage)], passage.length, replacement)
  return { count, old: text.slice(stretch.from, stretch.to), new: stretch.new }
}

/**
 * Every place a passage is in the filled text, as the document stores it:
 * what `storedPassage` gives for a passage that is there once, for one that
 * is there more than once and is changed at each. The places are changed the
 * last first, and each is where it is in the stored text once the ones after
 * it are changed.
 *
 * @param {string} text - The document as stored
 * @param {Names} names
 * @param {number[]} places - Where the passage is in the filled text, in order
 * @param {number} length - How long it is there
 * @param {string} replacement - What it should read instead
 * @returns {StoredChange[]} For each place, the last first: where the
 *   passage is in the stored text, and its replacement as it applies there
 */
export function storedPlaces(text, names, places, length, replacement) {
  return storedStretches(filledWith(text, names), places, length, replacement)
}
