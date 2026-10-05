/**
 * @module cards/card
 * @description A card, or a lorebook, as one shape whatever it arrived as.
 *
 * Four things can turn up and three of them are the same data:
 *
 * - **V1** — a flat object of the six original fields.
 * - **V2** — `{ spec: 'chara_card_v2', data: {...} }`, which added the lorebook,
 *   the alternate greetings, and the two prompt overrides.
 * - **V3** — the same wrapper under `chara_card_v3`, with `nickname`, the
 *   creation dates, assets, and `character_book` renamed to `lorebook`.
 * - **A lorebook on its own** — SillyTavern's World Info export, which is the
 *   book without a character around it, serialised the way ST holds it rather
 *   than the way the card spec wrote it down.
 *
 * Everything downstream sees one shape, so the importer has no idea which of
 * these it was handed. What could not be understood is not dropped: the
 * original goes to the sidecar whole, and export merges over it.
 */

/**
 * A card, flattened.
 *
 * @typedef {Object} Card
 * @property {string} name - The character's, and what `{{char}}` becomes
 * @property {string} title - What to call the folder: the nickname when there
 *   is one, because that is what the card is known by where people browse for
 *   it, and on a scenario card it has nothing to do with the character's name
 * @property {string} description
 * @property {string} personality
 * @property {string} scenario
 * @property {string} examples - `mes_example`
 * @property {string[]} greetings - `first_mes` first, then the alternates
 * @property {string} systemPrompt - Rare, usually an ST preset's scaffolding
 * @property {string} rules - `post_history_instructions`: the card's author's
 *   note, which a chat on it starts with. See `overOriginal`.
 * @property {string[]} tags
 * @property {string} creator
 * @property {LoreEntry[]} lore
 * @property {any} raw - Exactly what arrived, for the sidecar
 *
 * @typedef {Object} LoreEntry
 * @property {string} title - `comment` or `name`; the memo ST shows in its list
 * @property {string} content
 * @property {string[]} keys
 * @property {boolean} constant - Always in context, rather than looked up
 */

/**
 * The fields that say "character" and could not say anything else. `name` is
 * not among them: a lorebook has one too, and it is the book's title.
 */
const CHARACTER_FIELDS = ['description', 'personality', 'scenario', 'first_mes', 'mes_example']

/**
 * What a file holds, without trusting its extension.
 *
 * Both a card and a lorebook arrive as `.json`, and a card also arrives inside
 * a `.png`. What tells them apart is what is in them: a card has a name and a
 * greeting, a book has entries and no character.
 *
 * @param {any} value - Parsed JSON, or a card pulled out of a PNG
 * @returns {'card'|'lorebook'|null}
 */
export function shapeOf(value) {
  if (!value || typeof value !== 'object') return null

  const spec = typeof value.spec === 'string' ? value.spec : ''
  if (spec.startsWith('chara_card_')) return 'card'
  if (spec.startsWith('lorebook_')) return 'lorebook'

  const data = value.data && typeof value.data === 'object' ? value.data : value

  // Entries first. A World Info export carries a top-level `description` — the
  // book's, about the book — and a card's own book is nested under
  // `character_book`, never at the top. So entries at the top is the one
  // unambiguous mark, and testing the character fields first reads every
  // lorebook that came with a description as a card.
  if (data.entries && typeof data.entries === 'object') return 'lorebook'
  if (CHARACTER_FIELDS.some(field => typeof data[field] === 'string')) return 'card'

  return null
}

/**
 * A card of any version, flattened.
 *
 * @param {any} value - A V1, V2 or V3 card
 * @returns {Card}
 */
export function readCard(value) {
  const data = value?.data && typeof value.data === 'object' ? value.data : value || {}

  const name = text(data.name) || 'Unnamed'
  const greetings = [text(data.first_mes), ...list(data.alternate_greetings).map(text)].filter(
    Boolean
  )

  return {
    name,
    title: text(data.nickname) || name,
    description: text(data.description),
    personality: text(data.personality),
    scenario: text(data.scenario),
    examples: text(data.mes_example),
    greetings,
    systemPrompt: text(data.system_prompt),
    rules: text(data.post_history_instructions),
    tags: list(data.tags).map(text).filter(Boolean),
    creator: text(data.creator),
    // V3 renamed it; a V3 file written by something that also wanted to be read
    // by a V2 app carries both, and they are the same book.
    lore: readLorebook(data.lorebook || data.character_book).entries,
    raw: value,
  }
}

/**
 * A book of lore, however it was serialised.
 *
 * A card's `character_book` has `entries` as a list. ST's own export has it as
 * an object keyed by index, and each entry carries ST's field names beside the
 * spec's — `key` next to `keys`, `disable` next to `enabled`. Either way the
 * four things that matter are in there under one name or the other.
 *
 * Entries with nothing in them are left out. ST's World Info is a flat list
 * with no headings, so a book with any structure to it is full of entries whose
 * whole job is to draw a line across somebody else's editor; they would import
 * as empty documents that say nothing to anyone.
 *
 * @param {any} value - A `character_book`, a `lorebook`, or a World Info export
 * @returns {{name: string, entries: LoreEntry[], raw: any}}
 */
export function readLorebook(value) {
  if (!value || typeof value !== 'object') return { name: '', entries: [], raw: null }

  const data = value.data && typeof value.data === 'object' ? value.data : value
  const source = data.entries
  const rows = Array.isArray(source) ? source : source ? Object.values(source) : []

  /** @type {LoreEntry[]} */
  const entries = []
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    if (row.enabled === false || row.disable === true) continue

    const content = text(row.content)
    if (!content) continue

    const keys = [...list(row.keys), ...list(row.key)].map(text).filter(Boolean)

    entries.push({
      title: text(row.comment) || text(row.name) || keys[0] || 'Untitled',
      content,
      keys: [...new Set(keys)],
      constant: row.constant === true,
    })
  }

  return { name: text(data.name), entries, raw: value }
}

/**
 * Put the character's name and the writer's in, once, so that nothing
 * downstream has to carry a template language.
 *
 * Card text is full of `{{char}}` and `{{user}}`, and the alternative to
 * substituting here is an editor where the writer has to know not to type two
 * braces. The documents become their copy; the sidecar still says what the
 * card said.
 *
 * Case and inner spacing vary between authors, and both are accepted.
 * Nothing else is: `{{date}}`, `{{random::…}}`, `{{roll:d20}}` and the rest are
 * left for the model to read, which says what they are for better than a value
 * frozen at import would — the date would be wrong within a day, and a coin
 * flip that always comes up heads is not one. `{{original}}` is resolved when
 * a chat starts; see `overOriginal`.
 *
 * @param {string} value
 * @param {{char: string, user: string}} names
 * @returns {string}
 */
export function substitute(value, names) {
  if (!value) return ''
  return value
    .replace(/\{\{\s*char\s*\}\}/gi, names.char)
    .replace(/\{\{\s*user\s*\}\}/gi, names.user)
}

/**
 * Take out what a card's author wrote for other people rather than the model.
 *
 * `{{// …}}` is a comment: ST drops it before anything is sent, and authors
 * leave notes in it — "tweak this if…" — that were never meant to be read by
 * the model. The one macro where leaving it as written does harm. A comment on
 * a line of its own takes the line with it. The sidecar keeps them.
 *
 * @param {string} value
 * @returns {string}
 */
export function uncomment(value) {
  if (!value) return ''
  return value
    .replace(/^[ \t]*\{\{\/\/[\s\S]*?\}\}[ \t]*(?:\r?\n|$)/gm, '')
    .replace(/\{\{\/\/[\s\S]*?\}\}/g, '')
}

/** Where what a card overrides goes, as ST writes it. */
const ORIGINAL = /\{\{\s*original\s*\}\}/i

/**
 * A card's override over what it overrides.
 *
 * ST's rule, and the one worth keeping: a card's post-history instructions, or
 * its system prompt, replace the defaults — unless they say `{{original}}`,
 * which is where the defaults go. So a card that wants the writer's standing
 * instructions plus a line of its own says so, and a card whose author wrote a
 * whole set of their own is not read beside a second set that argues with it.
 *
 * Resolved once, when a chat starts, into plain text: nothing downstream reads
 * a template, and the card's own document keeps saying what the card said.
 *
 * @param {string} value - What the card says, if anything
 * @param {string} [under] - What it would otherwise replace
 * @returns {string} What the chat starts with
 */
export function overOriginal(value, under = '') {
  if (!value?.trim()) return under
  if (!ORIGINAL.test(value)) return value.trim()
  return value
    .split(ORIGINAL)
    .join(under.trim())
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Titles arrive decorated — `═══════[World]═══════`, `[☰] The Realm [☰]`,
 * `[📆]────↓Festivals↓────[📆]` — because World Info is a flat list and drawing a
 * box is the only way an author has to suggest a heading.
 *
 * The decoration comes off and the name stays. What is stripped is punctuation
 * and symbols at either end; letters, digits and the spaces between them are
 * untouched, so a title that is only decoration keeps whatever it had rather
 * than becoming empty.
 *
 * @param {string} title
 * @returns {string}
 */
export function undecorate(title) {
  const whole = text(title)
  let bare = whole

  for (let last = ''; last !== bare; ) {
    last = bare
    bare = stripEnds(bare)
    bare = stripEmptyGroups(bare)
    bare = unwrap(bare)
  }

  return bare.trim() || whole
}

/** What ends a title rather than decorating it. */
const KEEP_AT_END = /[\p{L}\p{N}.!?"')\]}]/u

/** Runs of decoration at either end: box drawing, arrows, dashes, spaces. */
function stripEnds(value) {
  // A quotation mark can open a title — `"Bent Nail" Tobin's Forge` — and
  // taking it off leaves the closing one behind looking like a mistake.
  let bare = value.replace(/^[^\p{L}\p{N}([{"']+/u, '')
  while (bare.length > 0 && !KEEP_AT_END.test(bare[bare.length - 1])) bare = bare.slice(0, -1)
  return bare
}

/**
 * A bracketed group with no letter or digit in it — `[☰]`, `[📆]`, `[›]` — at
 * either end. An author drawing a heading in a list that has none.
 */
function stripEmptyGroups(value) {
  const empty = String.raw`[^\p{L}\p{N}]*`
  return value
    .replace(new RegExp(String.raw`^\s*[([{]${empty}[)\]}]\s*`, 'u'), '')
    .replace(new RegExp(String.raw`\s*[([{]${empty}[)\]}]\s*$`, 'u'), '')
}

/**
 * Brackets around the whole title, and only those. `[World]` is a box somebody
 * drew; `Tiger (Wild, Wild Pussycats)` is a name, and the difference is
 * whether the opener's own match is the last character.
 */
function unwrap(value) {
  const closer = { '(': ')', '[': ']', '{': '}' }[value[0]]
  if (!closer) return value

  let depth = 0
  for (let at = 0; at < value.length; at++) {
    if (value[at] === value[0]) depth++
    else if (value[at] === closer && --depth === 0) {
      return at === value.length - 1 ? value.slice(1, -1) : value
    }
  }
  return value
}

/**
 * @param {any} value
 * @returns {string}
 */
function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * @param {any} value
 * @returns {any[]}
 */
function list(value) {
  return Array.isArray(value) ? value : []
}
