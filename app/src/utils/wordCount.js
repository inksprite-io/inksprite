/**
 * @module utils/wordCount
 * @description The words in a document's markdown.
 */

import { withoutComments } from '../editor/comments.js'
import { stripMarkdown } from './markdown.js'

/**
 * Count words: what is left once the syntax is gone, split on whitespace,
 * keeping only runs with a letter or a digit in them — a rule, a bare dash, or
 * a stray `|` from a table is not a word. The writer's comments are not the
 * text, so what they said is left out and only their passages count.
 *
 * @param {string|null|undefined} content - Markdown
 * @returns {number}
 */
export function countWords(content) {
  if (!content) return 0
  return stripMarkdown(withoutComments(content))
    .split(/\s+/)
    .filter(word => /[\p{L}\p{N}]/u.test(word)).length
}
