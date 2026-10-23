/**
 * @module editor/suggestionText
 * @description Suggestions in markdown, for what holds a document's text
 * rather than its editor state: whether a text has any, the text as one
 * reader sees it, and text from outside with any markup of theirs read as
 * meant.
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
import { parseMarkdown, serializeMarkdown } from './markdown.js'
import { seeing } from './suggestions.js'

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
