/**
 * @module editor/suggestionText
 * @description Suggestions in markdown, for what holds a document's text
 * rather than its editor state: whether a text has any, the text as one
 * reader sees it, that text with one suggestion the other way, and text
 * from outside with any markup of theirs read as meant.
 *
 * The markup is CriticMarkup holding an id (see `suggestions.js`), and only
 * the parser tells a half that pairs from one that is text, so a text with
 * suggestions is read as a document and written out again. A text without
 * any comes back as it was, untouched.
 *
 * Every reader but the editor reads the text as it stands: the word count,
 * explore's digests, a document exported, and the model's reads, its own
 * suggestions made in its chat. Narration and the spelling checker read the
 * editor's document and leave the marks out there (`tts/script.js`,
 * `editor/spelling.js`).
 */

import { withoutComments } from './comments.js'
import { DOLLAR_MARKS, parseMarkdown, serializeMarkdown } from './markdown.js'
import { blockSeen, docOf, seeing, suggestionRanges } from './suggestions.js'

/** @typedef {import('prosemirror-model').Node} Node */

/** The close of either half, which a text with a suggestion has. */
const CLOSE = /(?:\+\+|--)\}\{>>[a-z0-9]{4,12}<<\}/

/** A half put in, with what it puts in. */
const INSERTED = /\{\+\+([\s\S]*?)\+\+\}\{>>[a-z0-9]{4,12}<<\}/g

/** A half taken out. */
const DELETED = /\{--[\s\S]*?--\}\{>>[a-z0-9]{4,12}<<\}/g

/**
 * Whether a text may hold a suggestion: it has a half's close.
 *
 * @param {string|null|undefined} content
 * @returns {boolean}
 */
export function holdsSuggestions(content) {
  return CLOSE.test(content || '')
}

/**
 * Markdown as one reader sees it: the suggestions `accepted` names accepted,
 * every other rejected, and comments' markup kept. With none named, the text
 * as it stands, which is what every reader but the editor reads.
 *
 * @param {string} content
 * @param {string[]} [accepted]
 * @returns {string}
 */
export function seenMarkdown(content, accepted = []) {
  if (!holdsSuggestions(content)) return content
  const seen = seeing(parseMarkdown(content), accepted)
  return seen.docChanged ? serializeMarkdown(seen.doc) : content
}

/**
 * Markdown as a reader of the text reads it, a word count or a digest: as
 * it stands, each suggestion rejected, and without comments' markup.
 *
 * @param {string} content
 * @returns {string}
 */
export function textAsItStands(content) {
  return withoutComments(seenMarkdown(content))
}

/**
 * Text from outside with suggestions' markup read as meant: what a half
 * takes out gone, and what one puts in kept. A model writing the markup
 * means the change it marks, and what it writes is never a suggestion of
 * its own: the tools make those.
 *
 * @param {string} text
 * @returns {string}
 */
export function withoutSuggestionMarkup(text) {
  if (!holdsSuggestions(text)) return text
  return text.replace(DELETED, '').replace(INSERTED, '$1')
}

/**
 * A reader's text with one suggestion the other way.
 *
 * @typedef {Object} Turned
 * @property {string} text
 * @property {number} start - How many characters, at least, it shares with
 *   the reader's text at the start
 * @property {number} end - And at the end
 */

/**
 * A document as one reader has it, and as they would with any one of its
 * suggestions the other way.
 *
 * @typedef {Object} Reading
 * @property {string} text - The reader's text, without comments' markup
 * @property {(id: string) => Turned} turned - That text with one suggestion
 *   made where the reader's has it not, or not made where it has
 */

/**
 * Blocks written as a document of their own, as a read gives it: without
 * comments' markup, and without the blocks a reader has nothing of.
 *
 * @param {Array<Node|null>} blocks
 * @returns {string}
 */
const written = blocks =>
  withoutComments(serializeMarkdown(docOf(/** @type {Node[]} */ (blocks.filter(Boolean)))))

/**
 * A document's text as one reader has it, and that text with any one of its
 * suggestions the other way: the two differ by the change the suggestion
 * makes.
 *
 * The document is written whole once. A suggestion the other way changes
 * only the blocks its marks are in, so only they are written again, between
 * the nearest block on each side that the reader has words of: what is
 * written between two blocks hangs on both, and on nothing further off.
 * Where those blocks are in the text is found by writing the text up to
 * them again, a stretch at a time.
 *
 * The whole document is written the other way instead where blocks written
 * alone are not what it would have of them. One case is known: a text that
 * holds every character the serializer marks a dollar by has all its dollars
 * escaped, which blocks written without those characters would not. And
 * should a stretch written alone not be what the reader's text has there,
 * a block's markdown has come to hang on more than its neighbours.
 *
 * @param {Node} doc - As parsed, suggestions' marks and all
 * @param {string[]} accepted - The suggestions the reader sees made
 * @returns {Reading}
 */
export function readingOf(doc, accepted) {
  /** @type {Node[]} */
  const blocks = []
  doc.forEach(block => blocks.push(block))

  // Which suggestions each block holds, and which blocks each one is in.
  /** @type {Array<Set<string>|undefined>} */
  const held = []
  /** @type {Map<string, {first: number, last: number}>} */
  const spans = new Map()
  let at = 0
  let end = blocks[0]?.nodeSize ?? 0
  for (const range of suggestionRanges(doc)) {
    while (range.from >= end) end += blocks[++at].nodeSize
    held[at] = (held[at] ?? new Set()).add(range.id)
    const span = spans.get(range.id)
    if (span) span.last = at
    else spans.set(range.id, { first: at, last: at })
  }

  const seen = blocks.map((block, index) => (held[index] ? blockSeen(block, accepted) : block))
  const text = written(seen)
  const marks = DOLLAR_MARKS.map(mark => text.includes(mark))

  /** @type {Array<boolean|undefined>} */
  const says = []
  /**
   * The nearest block the reader has words of, before a block or after it:
   * -1 or `blocks.length` where there is none. One left standing with
   * nothing written for it, an empty paragraph, is no place to write from:
   * what follows it is written by what came before it.
   *
   * @param {number} from
   * @param {-1|1} step
   * @returns {number}
   */
  const nearest = (from, step) => {
    let index = from + step
    while (index >= 0 && index < blocks.length) {
      says[index] ??= seen[index] !== null && written([seen[index]]) !== ''
      if (says[index]) break
      index += step
    }
    return index
  }

  // The blocks whose ends in the text are known, in order: at first, none.
  const known = [{ block: -1, end: 0 }]
  /**
   * Where a block with words of its own ends in the text: the blocks from
   * the nearest one known before it, written alone, are what the text has
   * next, after the empty lines between. Undefined where it has not.
   *
   * @param {number} block
   * @returns {number|undefined}
   */
  const endOf = block => {
    let last = known.length - 1
    while (known[last].block > block) last--
    if (known[last].block === block) return known[last].end
    const stretch = written(seen.slice(known[last].block + 1, block + 1))
    const found = text.indexOf(stretch, known[last].end)
    if (found === -1 || /[^\n]/.test(text.slice(known[last].end, found))) return undefined
    known.splice(last + 1, 0, { block, end: found + stretch.length })
    return found + stretch.length
  }

  return {
    text,
    turned(id) {
      const span = spans.get(id)
      if (!span) return { text, start: text.length, end: 0 }
      const other = accepted.includes(id) ? accepted.filter(each => each !== id) : [...accepted, id]
      const first = Math.max(0, nearest(span.first, -1))
      const after = nearest(span.last, 1)
      const until = after < blocks.length ? endOf(after) : text.length
      const here = written(seen.slice(first, after + 1))
      const there = written(
        blocks
          .slice(first, after + 1)
          .map((block, index) =>
            held[first + index]?.has(id) ? blockSeen(block, other) : seen[first + index]
          )
      )
      const alone =
        until !== undefined &&
        until >= here.length &&
        text.startsWith(here, until - here.length) &&
        !DOLLAR_MARKS.every((mark, index) => marks[index] || there.includes(mark))
      if (!alone) {
        return {
          text: withoutComments(serializeMarkdown(seeing(doc, other).doc)),
          start: 0,
          end: 0,
        }
      }
      const start = until - here.length
      return {
        text: text.slice(0, start) + there + text.slice(until),
        start,
        end: text.length - until,
      }
    },
  }
}
