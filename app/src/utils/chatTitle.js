/**
 * @module utils/chatTitle
 * @description What a chat is called before it has a name, and a title the
 * model wrote, made plain.
 */

/** What a chat is called until the model or the writer names it. */
export const DEFAULT_CHAT_TITLE = 'Untitled chat'

/**
 * What chats were called by default before there was one name for it. Chats
 * saved under them are still waiting for a name.
 */
const EARLIER_DEFAULTS = ['Untitled Chat', 'New Chat']

/**
 * Whether a chat has yet to be named: it carries the default, or a default it
 * was saved with before this one, or nothing at all.
 *
 * @param {string|null|undefined} title
 * @returns {boolean}
 */
export function isDefaultChatTitle(title) {
  const name = (title || '').trim()
  return !name || name === DEFAULT_CHAT_TITLE || EARLIER_DEFAULTS.includes(name)
}

/**
 * What a chat is shown as: its title, or the default while it has none of
 * its own.
 *
 * @param {string|null|undefined} title
 * @returns {string}
 */
export function shownChatTitle(title) {
  return isDefaultChatTitle(title) ? DEFAULT_CHAT_TITLE : /** @type {string} */ (title)
}

/**
 * A line of the model's as a title: without the markdown it was dressed in,
 * a "Title:" it was introduced with, or the quotes it was put in.
 *
 * A title is shown as text everywhere it appears, so `## Part 1` would be
 * read with its hashes and `**not**` with its stars.
 *
 * @param {string} line
 * @returns {string}
 */
export function plainTitle(line) {
  return (line || '')
    .trim()
    .replace(/^#{1,6}\s+/, '')
    .replace(/^(?:>\s*)+/, '')
    .replace(/^(?:[-*+]|\d+[.)])\s+/, '')
    .replace(/^title\s*:\s*/i, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__|~~)(.+?)\1/g, '$2')
    .replace(/\*(\S(?:.*?\S)?)\*/g, '$1')
    .replace(/(^|[^\w])_(\S(?:.*?\S)?)_(?![\w])/g, '$1$2')
    .replace(/`([^`]*)`/g, '$1')
    .trim()
    .replace(/^["'“‘]+|["'”’]+$/g, '')
    .trim()
}
