/**
 * @module ai/tools/commentReads
 * @description The comments a read lists after its text, as the model reads
 * them: where each passage is in the text without the markup, with the
 * chat's suggestions as it sees them and its names filled in, and what has
 * been said on it, by whom. Shared by `read_document` and `list_comments`.
 * Pure.
 *
 * A chat sees its own pending suggestions made and everyone else's not, as
 * Docs shows a writer theirs: the change it suggested is the text it goes on
 * from. See editor/suggestions.js.
 *
 * After the comments come the suggestions waiting in what was read
 * (`suggestionsAsRead`), whoever made them: whose each is, the change as a
 * pair of passages found in the reader's text, and what was said on it.
 */

import { passageInText, readableText } from '@/editor/comments.js'
import { holdsSuggestions, readingOf, seenMarkdown } from '@/editor/suggestionText.js'
import { parseMarkdown } from '@/editor/markdown.js'
import { suggestionsIn } from '@/editor/suggestions.js'
import { placedEdit } from '@/utils/edits.js'
import { substitute } from '@/cards/macros.js'
import { isMine, nameOf } from '@/cloud/people.js'

/** A passage longer than this is shown by its two ends in a read's list. */
const PASSAGE_LIMIT = 300

/**
 * Words as a list gives them: a long run by its two ends.
 * @param {string} words
 */
const clipped = words =>
  words.length > PASSAGE_LIMIT
    ? `${words.slice(0, PASSAGE_LIMIT / 2)} … ${words.slice(-PASSAGE_LIMIT / 2)}`
    : words

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
 * The words a read uses for who said or suggested something. No name from
 * outside may pass for one of them.
 */
const SPEAKERS = new Set(['you', 'writer', 'model', 'someone'])

/**
 * A name from outside as a read gives it: someone's in a linked Google Doc,
 * a connected app's, an account's in a shared project. It is whatever its
 * owner chose, so one that is a word a read uses for who is speaking is
 * said to be a name: a commenter called "writer" is not the writer.
 *
 * @param {string} name
 * @returns {string}
 */
export const asName = name =>
  SPEAKERS.has(name.trim().toLowerCase()) ? `someone named "${name.trim()}"` : name

/**
 * What has been said on a thread, by whom, as the model reads it: someone in
 * a linked Google Doc by the name Google shows, a connected app by its
 * connection's name, and in a project shared, someone the writer shares it
 * with by the name they show.
 *
 * @param {import('@/types/models.js').CommentThread} thread
 * @param {import('@/cards/macros.js').Names|null} names
 * @param {import('@/cloud/people.js').People|null} [people] - Where the project is shared
 */
export const postsOf = (thread, names, people = null) =>
  thread.posts.map(post => ({
    author:
      post.author === 'person'
        ? asName(post.name || 'someone')
        : post.author === 'writer' && people && !isMine(post, people)
          ? asName(nameOf(post, people))
          : post.author === 'model' && post.name
            ? asName(post.name)
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
          ? { passage: clipped(passage) }
          : passageInText(text, start, end)
      return { id, ...where, posts: postsOf(thread, names, people) }
    })
}

/** How many of a document's waiting suggestions one read tells of. */
export const SUGGESTIONS_MOST = 60

/**
 * A suggestion still waiting on the writer, as one reader is told of it:
 * the change it makes to the text that reader has, and where.
 *
 * @typedef {Object} PlacedSuggestion
 * @property {string} id
 * @property {import('@/types/models.js').CommentThread} thread
 * @property {boolean} own - The reader's: made in the text it reads
 * @property {string} from - The words without it, enough of them to be found
 * @property {string} to - The words with it
 * @property {number} start - Where it is in the text as read
 * @property {number} end
 */

/** A letter, a digit, or what joins them into one word. */
const WORDY = /[\p{L}\p{N}_'’]/u

/**
 * A pair that turns one text into another, grown to whole words: the least
 * pair ends where the two texts first differ, which is mid-word wherever
 * the words on either side share letters ("rope" to "wire" differ as "rop"
 * and "wir").
 *
 * @param {{old: string, new: string, at: number}} pair - With where it starts
 * @param {string} before - The text `pair.old` is in, there
 * @returns {{old: string, new: string, at: number}}
 */
function wholeWords(pair, before) {
  let left = pair.at
  let right = pair.at + pair.old.length
  const wordy = (/** @type {string|undefined} */ char) => Boolean(char) && WORDY.test(char ?? '')
  // An end is in a word when a letter is on both sides of it, in either text.
  if (wordy(pair.old[0]) || wordy(pair.new[0])) {
    while (left > 0 && wordy(before[left - 1])) left--
  }
  if (wordy(pair.old.at(-1)) || wordy(pair.new.at(-1))) {
    while (right < before.length && wordy(before[right])) right++
  }
  const [lead, trail] = [
    before.slice(left, pair.at),
    before.slice(pair.at + pair.old.length, right),
  ]
  return { old: `${lead}${pair.old}${trail}`, new: `${lead}${pair.new}${trail}`, at: left }
}

/**
 * The suggestions waiting in a document, as one reader is told of them, in
 * the text's order. Every one is there, whoever made it: a chat is asked
 * about another chat's, or a connected app's, and a suggestion is talked
 * over on its thread.
 *
 * Each is the change it makes, as a pair that can be found: the words as
 * they stand without it, and with it. The reader's own are made in the text
 * it reads, so its text has the second; anyone else's are not, and its text
 * has the first.
 *
 * @param {import('@/types/models.js').Document|undefined} stored - The document as stored, markup and all
 * @param {import('@/cards/macros.js').Names|null} names
 * @param {string|null} [chatId]
 * @returns {{placed: PlacedSuggestion[], more: number}} `more` is how many
 *   past `SUGGESTIONS_MOST` are left out
 */
export function suggestionsAsRead(stored, names, chatId = null) {
  const none = { placed: [], more: 0 }
  const threads = stored?.comments
  const content = stored?.type === 'text' && !stored.plain ? stored.content || '' : ''
  if (!threads || !holdsSuggestions(content)) return none
  const doc = parseMarkdown(content)
  const waiting = suggestionsIn(doc).filter(id => threads[id]?.suggestion)
  if (waiting.length === 0) return none

  const own = ownSuggestions(threads, chatId).filter(id => waiting.includes(id))
  const { text, turned } = readingOf(doc, own)
  const named = (/** @type {string} */ words) => (names ? substitute(words, names) : words)

  /** @type {PlacedSuggestion[]} */
  const placed = []
  for (const id of waiting.slice(0, SUGGESTIONS_MOST)) {
    const mine = own.includes(id)
    const other = turned(id)
    const [before, after] = mine ? [other.text, text] : [text, other.text]
    const least = placedEdit(before, after, other)
    if (!least) continue
    const pair = wholeWords(least, before)
    // The two texts are the same up to the pair, so it starts at the one
    // place in both, and so in the reader's, whichever of them that is.
    const here = mine ? pair.new : pair.old
    placed.push({
      id,
      thread: threads[id],
      own: mine,
      from: named(pair.old),
      to: named(pair.new),
      start: named(text.slice(0, pair.at)).length,
      end: named(text.slice(0, pair.at + here.length)).length,
    })
  }
  return {
    placed: placed.sort((a, b) => a.start - b.start),
    more: Math.max(0, waiting.length - SUGGESTIONS_MOST),
  }
}

/**
 * Who suggested a change, as a reader is told: `you` for the reader's own;
 * a connected app by its connection's name; someone in a linked Google Doc
 * by name, or `writer`; and `model` for the assistant in another chat.
 *
 * @param {import('@/types/models.js').CommentSuggestion} suggestion
 * @param {string|null|undefined} chatId - The reader's
 * @returns {string}
 */
export function suggestedBy(suggestion, chatId) {
  if (chatId && suggestion.chat === chatId) return 'you'
  if (suggestion.author === 'person') return suggestion.name ? asName(suggestion.name) : 'someone'
  if (suggestion.author === 'writer') return 'writer'
  return suggestion.name ? asName(suggestion.name) : 'model'
}

/**
 * A waiting suggestion as a read lists it: its id, who suggested it, the
 * words without it and with it, and what has been said on it.
 *
 * @param {PlacedSuggestion} suggestion
 * @param {Object} reader
 * @param {import('@/cards/macros.js').Names|null} reader.names
 * @param {string|null|undefined} reader.chatId
 * @param {import('@/cloud/people.js').People|null} [reader.people] - Where the project is shared
 * @param {(chatId: string) => string} [reader.chatTitle] - What another chat
 *   is called, for a suggestion its model made
 */
export function suggestionListed({ id, thread, from, to }, { names, chatId, people, chatTitle }) {
  const made = /** @type {import('@/types/models.js').CommentSuggestion} */ (thread.suggestion)
  const by = suggestedBy(made, chatId)
  const chat = by === 'model' && made.chat ? chatTitle?.(made.chat) : ''
  return {
    id,
    by,
    ...(chat ? { chat } : {}),
    from: clipped(from),
    to: clipped(to),
    ...(thread.posts.length > 0 ? { posts: postsOf(thread, names, people ?? null) } : {}),
  }
}

/**
 * The waiting suggestions that end between two places in the text, as a
 * read lists them after its comments.
 *
 * @param {PlacedSuggestion[]} placed
 * @param {number} from
 * @param {number} to
 * @param {Parameters<typeof suggestionListed>[1]} reader
 */
export function suggestionsBetween(placed, from, to, reader) {
  return placed
    .filter(({ end }) => end > from && end <= to)
    .map(each => suggestionListed(each, reader))
}
