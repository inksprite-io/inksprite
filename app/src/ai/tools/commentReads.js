/**
 * @module ai/tools/commentReads
 * @description The comments a read lists after its text, as the model reads
 * them: where each passage is in the text without the markup, with the
 * chat's suggestions as it sees them and its names filled in, and what has
 * been said on it, by whom. Shared by `read_document`, `list_comments` and
 * the pinned documents of the project block. Pure.
 *
 * A chat sees its own pending suggestions made and everyone else's not, as
 * Docs shows a writer theirs: the change it suggested is the text it goes on
 * from. See editor/suggestions.js.
 */

import { passageInText, readableText } from '@/editor/comments.js'
import { holdsSuggestions, seenMarkdown } from '@/editor/suggestionText.js'
import { substitute } from '@/cards/macros.js'
import { isMine, nameOf } from '@/cloud/people.js'

/** A passage longer than this is shown by its two ends in a read's list. */
const PASSAGE_LIMIT = 300

/**
 * A chat's own pending suggestions in a document, oldest first: those its
 * model made that are still open.
 *
 * @param {Record<string, import('@/types/models.js').CommentThread>|undefined} threads
 * @param {string|null|undefined} chatId
 * @returns {string[]}
 */
export function ownSuggestions(threads, chatId) {
  if (!threads || !chatId) return []
  return Object.entries(threads)
    .filter(([, thread]) => thread.suggestion?.chat === chatId && thread.status === 'open')
    .sort(([, a], [, b]) => (a.suggestion?.created ?? 0) - (b.suggestion?.created ?? 0))
    .map(([id]) => id)
}

/**
 * A text document's markdown as a chat sees it, comments' markup kept: its
 * own pending suggestions made, everyone else's not. A plain one holds none.
 *
 * @param {import('@/types/models.js').Document} document - As stored
 * @param {string} content - Its text, the store's or the editor's
 * @param {string|null|undefined} chatId
 * @returns {string}
 */
export function seenText(document, content, chatId) {
  if (document.type !== 'text' || document.plain || !holdsSuggestions(content)) return content
  return seenMarkdown(content, ownSuggestions(document.comments, chatId))
}

/**
 * Where each open comment's passage is in the text as the chat reads it:
 * without the markup, with its suggestions as it sees them, and with its
 * names filled in.
 *
 * @param {import('@/types/models.js').Document|undefined} stored - The document as stored, markup and all
 * @param {import('@/cards/macros.js').Names|null} names
 * @param {string|null} [chatId]
 * @returns {{text: string, placed: import('@/editor/comments.js').PlacedThread[]}}
 */
export function placedAsRead(stored, names, chatId = null) {
  const content = stored ? seenText(stored, stored.content || '', chatId) : ''
  const { text, placed } = readableText(content, stored?.comments)
  if (!names || placed.length === 0) return { text: names ? substitute(text, names) : text, placed }
  const at = (/** @type {number} */ offset) => substitute(text.slice(0, offset), names).length
  return {
    text: substitute(text, names),
    placed: placed.map(entry => ({ ...entry, start: at(entry.start), end: at(entry.end) })),
  }
}

/**
 * What has been said on a thread, by whom, as the model reads it: someone in
 * a linked Google Doc by the name Google shows, and in a project shared,
 * someone the writer shares it with by the name they show.
 *
 * @param {import('@/types/models.js').CommentThread} thread
 * @param {import('@/cards/macros.js').Names|null} names
 * @param {import('@/cloud/people.js').People|null} [people] - Where the project is shared
 */
export const postsOf = (thread, names, people = null) =>
  thread.posts.map(post => ({
    author:
      post.author === 'person'
        ? post.name || 'someone'
        : post.author === 'writer' && people && !isMine(post, people)
          ? nameOf(post, people)
          : post.author,
    text: substitute(post.text, names),
  }))

/**
 * The open comments whose passages end between two places in the text, as a
 * read lists them: each with its id, its passage told apart from any repeat
 * of its words, and its posts.
 *
 * @param {{text: string, placed: import('@/editor/comments.js').PlacedThread[]}} read
 * @param {import('@/cards/macros.js').Names|null} names
 * @param {number} from
 * @param {number} to
 * @param {import('@/cloud/people.js').People|null} [people] - Where the project is shared
 */
export function commentsBetween({ text, placed }, names, from, to, people = null) {
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
      return { id, ...where, posts: postsOf(thread, names, people) }
    })
}
