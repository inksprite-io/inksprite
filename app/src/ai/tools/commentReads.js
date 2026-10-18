/**
 * @module ai/tools/commentReads
 * @description The comments a read lists after its text, as the model reads
 * them: where each passage is in the text without the markup and with the
 * chat's names filled in, and what has been said on it, by whom. Shared by
 * `read_document`, `list_comments` and the pinned documents of the project
 * block. Pure.
 */

import { passageInText, readableText } from '@/editor/comments.js'
import { substitute } from '@/cards/macros.js'

/** A passage longer than this is shown by its two ends in a read's list. */
const PASSAGE_LIMIT = 300

/**
 * Where each open comment's passage is in the text as the chat reads it:
 * without the markup, and with its names filled in.
 *
 * @param {import('@/types/models.js').Document|undefined} stored - The document as stored, markup and all
 * @param {import('@/cards/macros.js').Names|null} names
 * @returns {{text: string, placed: import('@/editor/comments.js').PlacedThread[]}}
 */
export function placedAsRead(stored, names) {
  const { text, placed } = readableText(stored?.content, stored?.comments)
  if (!names || placed.length === 0) return { text: names ? substitute(text, names) : text, placed }
  const at = (/** @type {number} */ offset) => substitute(text.slice(0, offset), names).length
  return {
    text: substitute(text, names),
    placed: placed.map(entry => ({ ...entry, start: at(entry.start), end: at(entry.end) })),
  }
}

/**
 * What has been said on a thread, by whom, as the model reads it.
 *
 * @param {import('@/types/models.js').CommentThread} thread
 * @param {import('@/cards/macros.js').Names|null} names
 */
export const postsOf = (thread, names) =>
  thread.posts.map(post => ({ author: post.author, text: substitute(post.text, names) }))

/**
 * The open comments whose passages end between two places in the text, as a
 * read lists them: each with its id, its passage told apart from any repeat
 * of its words, and its posts.
 *
 * @param {{text: string, placed: import('@/editor/comments.js').PlacedThread[]}} read
 * @param {import('@/cards/macros.js').Names|null} names
 * @param {number} from
 * @param {number} to
 */
export function commentsBetween({ text, placed }, names, from, to) {
  return placed
    .filter(({ end }) => end > from && end <= to)
    .map(({ id, thread, start, end }) => {
      const passage = text.slice(start, end)
      const where =
        passage.length > PASSAGE_LIMIT
          ? {
              passage: `${passage.slice(0, PASSAGE_LIMIT / 2)} … ${passage.slice(-PASSAGE_LIMIT / 2)}`,
            }
          : passageInText(text, start, end)
      return { id, ...where, posts: postsOf(thread, names) }
    })
}
