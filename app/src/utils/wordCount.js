/**
 * @module utils/wordCount
 * @description The words in a document's markdown.
 */

import { textAsItStands } from '../editor/suggestionText.js'
import { stripMarkdown } from './markdown.js'
import { replaceFormulas } from './tex.js'

/** A picture: `![alt](path)`, its alt text holding no `]` but an escaped one. */
const PICTURE = /(?<!\\)!\[(?:[^\]\\]|\\.)*\]\((?:<[^>\n]*>|[^)\s]*)(?:\s+"(?:[^"\\]|\\.)*")?\)/g

/**
 * Count words: what is left once the syntax is gone, split on whitespace,
 * keeping only runs with a letter or a digit in them — a rule, a bare dash, or
 * a stray `|` from a table is not a word. The writer's comments are not the
 * text, so what they said is left out and only their passages count; a
 * suggestion waiting on the writer has changed nothing yet, so the words it
 * would put in are not counted, and those it would take out are; a picture
 * is no words, its alt text included; and a formula in a sentence is a word,
 * and one on lines of its own none.
 *
 * @param {string|null|undefined} content - Markdown
 * @returns {number}
 */
export function countWords(content) {
  if (!content) return 0
  const text = replaceFormulas(textAsItStands(content).replace(PICTURE, ' '), found =>
    found.display ? ' ' : ' formula '
  )
  return stripMarkdown(text)
    .split(/\s+/)
    .filter(word => /[\p{L}\p{N}]/u.test(word)).length
}
